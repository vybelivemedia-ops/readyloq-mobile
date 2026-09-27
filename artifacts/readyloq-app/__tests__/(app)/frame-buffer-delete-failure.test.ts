/**
 * Voice-context frame buffer — deleteAsync failure contract
 *
 * Tests the real createFrameBuffer() export from lib/voice-context/frame-buffer.ts.
 * Confirms that:
 *
 *   ✓ getLastUri() advances to the new URI even when deleteFile rejects
 *   ✓ After N interval cycles with permanently-failing deleteFile, getLastUri()
 *     always holds the latest URI (at most 1 temp file tracked at a time)
 *   ✓ deleteFile is called with the OLD uri before the buffer advances
 *   ✓ stop() nulls getLastUri() regardless of whether the final deleteFile succeeds
 *   ✓ A successful camera write followed by a failing delete still advances the buffer
 *   ✓ In-flight captures that resolve after stop() self-delete their file (orphan-safe)
 *   ✓ Baseline: successful deletes behave correctly (regression guard)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFrameBuffer,
  FRAME_BUFFER_INTERVAL_MS,
  type FrameBufferDeps,
} from "../../lib/voice-context/frame-buffer";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Creates a plain vi.fn() deleteFile spy (resolves by default) and casts it to
 * satisfy FrameBufferDeps["deleteFile"] for the createFrameBuffer call site.
 * The raw spy is returned for expect() assertions.
 */
function makeDeleteSpy() {
  return vi.fn().mockResolvedValue(undefined);
}

/**
 * Returns { takePicture, raw } where takePicture satisfies FrameBufferDeps and
 * raw is the underlying vi.fn() so we can assert call counts.
 * `uris` is consumed in order; the last entry repeats for any additional calls.
 * Pass an Error instance to simulate a rejection on that tick.
 */
function makeTakePicture(uris: Array<string | null | Error>): ReturnType<typeof vi.fn> {
  let idx = 0;
  return vi.fn().mockImplementation(async () => {
    const next = uris[Math.min(idx++, uris.length - 1)];
    if (next instanceof Error) throw next;
    return next ?? null;
  });
}

/** Casts a plain vi.fn() spy to FrameBufferDeps["deleteFile"]. */
function asDeleteFile(spy: ReturnType<typeof vi.fn>): FrameBufferDeps["deleteFile"] {
  return spy as unknown as FrameBufferDeps["deleteFile"];
}

/** Casts a plain vi.fn() spy to FrameBufferDeps["takePicture"]. */
function asTakePicture(spy: ReturnType<typeof vi.fn>): FrameBufferDeps["takePicture"] {
  return spy as unknown as FrameBufferDeps["takePicture"];
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── Interval tick: deleteFile failure does not block ref update ───────────────

describe("createFrameBuffer — interval tick: deleteFile failure does not block ref update", () => {
  it("getLastUri() advances to the new URI even when deleteFile rejects", async () => {
    const deleteSpy = makeDeleteSpy().mockRejectedValue(new Error("permission denied"));
    const takeSpy = makeTakePicture([
      "file:///tmp/frame-0001.jpg",
      "file:///tmp/frame-0002.jpg",
    ]);

    const buf = createFrameBuffer({
      takePicture: asTakePicture(takeSpy),
      deleteFile: asDeleteFile(deleteSpy),
    });
    buf.start();

    // First tick — no previous URI yet; ref is set to first URI
    await vi.advanceTimersByTimeAsync(FRAME_BUFFER_INTERVAL_MS);
    expect(buf.getLastUri()).toBe("file:///tmp/frame-0001.jpg");

    // Second tick — deleteFile rejects on the old URI; ref must still advance
    await vi.advanceTimersByTimeAsync(FRAME_BUFFER_INTERVAL_MS);
    expect(buf.getLastUri()).toBe("file:///tmp/frame-0002.jpg");

    buf.stop();
  });

  it("deleteFile is called with the OLD uri before the buffer advances", async () => {
    const deleteSpy = makeDeleteSpy().mockRejectedValue(new Error("storage fault"));
    const takeSpy = makeTakePicture([
      "file:///tmp/frame-A.jpg",
      "file:///tmp/frame-B.jpg",
      "file:///tmp/frame-C.jpg",
    ]);

    const buf = createFrameBuffer({
      takePicture: asTakePicture(takeSpy),
      deleteFile: asDeleteFile(deleteSpy),
    });
    buf.start();

    await vi.advanceTimersByTimeAsync(FRAME_BUFFER_INTERVAL_MS); // tick 1 → A stored
    // No previous URI on first tick
    expect(deleteSpy).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(FRAME_BUFFER_INTERVAL_MS); // tick 2 → B stored
    expect(deleteSpy).toHaveBeenCalledWith("file:///tmp/frame-A.jpg", { idempotent: true });

    await vi.advanceTimersByTimeAsync(FRAME_BUFFER_INTERVAL_MS); // tick 3 → C stored
    expect(deleteSpy).toHaveBeenCalledWith("file:///tmp/frame-B.jpg", { idempotent: true });

    // deleteFile must NOT have been called with the newest URI
    expect(deleteSpy).not.toHaveBeenCalledWith("file:///tmp/frame-C.jpg", expect.anything());
    expect(buf.getLastUri()).toBe("file:///tmp/frame-C.jpg");

    buf.stop();
  });

  it("after N cycles with permanently-failing deleteFile, getLastUri() holds the latest URI", async () => {
    const deleteSpy = makeDeleteSpy().mockRejectedValue(new Error("io error"));
    const N = 8;
    const uris = Array.from(
      { length: N },
      (_, i) => `file:///tmp/frame-${String(i).padStart(4, "0")}.jpg`,
    );
    const takeSpy = makeTakePicture(uris);

    const buf = createFrameBuffer({
      takePicture: asTakePicture(takeSpy),
      deleteFile: asDeleteFile(deleteSpy),
    });
    buf.start();

    for (let i = 0; i < N; i++) {
      await vi.advanceTimersByTimeAsync(FRAME_BUFFER_INTERVAL_MS);
    }

    // Must point to the last URI — never stale
    expect(buf.getLastUri()).toBe(uris[N - 1]);
    // Each tick except the first attempts a delete
    expect(deleteSpy).toHaveBeenCalledTimes(N - 1);

    buf.stop();
  });

  it("successful camera write followed by failing delete still advances the buffer", async () => {
    const deleteSpy = makeDeleteSpy().mockRejectedValue(new Error("disk full"));
    const takeSpy = makeTakePicture([
      "file:///tmp/good-frame-1.jpg",
      "file:///tmp/good-frame-2.jpg",
    ]);

    const buf = createFrameBuffer({
      takePicture: asTakePicture(takeSpy),
      deleteFile: asDeleteFile(deleteSpy),
    });
    buf.start();

    await vi.advanceTimersByTimeAsync(FRAME_BUFFER_INTERVAL_MS);
    expect(buf.getLastUri()).toBe("file:///tmp/good-frame-1.jpg");

    // Delete of frame-1 fails but buffer must still advance to frame-2
    await vi.advanceTimersByTimeAsync(FRAME_BUFFER_INTERVAL_MS);
    expect(buf.getLastUri()).toBe("file:///tmp/good-frame-2.jpg");

    buf.stop();
  });
});

// ─── stop(): ref nulled regardless of deleteFile outcome ─────────────────────

describe("createFrameBuffer — stop(): getLastUri() is null regardless of deleteFile outcome", () => {
  it("getLastUri() is null after stop() even when deleteFile rejects", async () => {
    const deleteSpy = makeDeleteSpy().mockRejectedValue(new Error("device not available"));
    const takeSpy = makeTakePicture(["file:///tmp/last-frame.jpg"]);

    const buf = createFrameBuffer({
      takePicture: asTakePicture(takeSpy),
      deleteFile: asDeleteFile(deleteSpy),
    });
    buf.start();

    await vi.advanceTimersByTimeAsync(FRAME_BUFFER_INTERVAL_MS);
    expect(buf.getLastUri()).toBe("file:///tmp/last-frame.jpg");

    buf.stop();
    // stop() synchronously nulls the URI; a rejected deleteFile must not undo this
    await Promise.resolve();
    await Promise.resolve();
    expect(buf.getLastUri()).toBeNull();
  });

  it("deleteFile is called with the buffered URI when stop() fires", async () => {
    const deleteSpy = makeDeleteSpy().mockRejectedValue(new Error("io error"));
    const takeSpy = makeTakePicture(["file:///tmp/buffered.jpg"]);

    const buf = createFrameBuffer({
      takePicture: asTakePicture(takeSpy),
      deleteFile: asDeleteFile(deleteSpy),
    });
    buf.start();

    await vi.advanceTimersByTimeAsync(FRAME_BUFFER_INTERVAL_MS);
    buf.stop();

    expect(deleteSpy).toHaveBeenCalledWith("file:///tmp/buffered.jpg", { idempotent: true });
    expect(buf.getLastUri()).toBeNull();
  });

  it("stop() with no buffered frame does not call deleteFile", async () => {
    const deleteSpy = makeDeleteSpy();
    const buf = createFrameBuffer({
      takePicture: asTakePicture(vi.fn()),
      deleteFile: asDeleteFile(deleteSpy),
    });

    buf.start();
    buf.stop(); // stopped before any tick fired

    await Promise.resolve();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(buf.getLastUri()).toBeNull();
  });
});

// ─── In-flight tick fires AFTER stop(): orphan-safe ──────────────────────────

describe("createFrameBuffer — in-flight capture after stop() self-deletes", () => {
  it("a capture that resolves after stop() calls deleteFile on its own URI and does not update the ref", async () => {
    // Hold the capture promise until we release it manually
    let releasePicture!: (uri: string) => void;
    const slowCapture = new Promise<string>((resolve) => {
      releasePicture = resolve;
    });
    const takeSpy = vi.fn().mockReturnValue(slowCapture);
    const deleteSpy = makeDeleteSpy();

    const buf = createFrameBuffer({
      takePicture: asTakePicture(takeSpy),
      deleteFile: asDeleteFile(deleteSpy),
    });
    buf.start();

    // Advance timer so the interval fires — capture is in-flight but not yet resolved
    vi.advanceTimersByTime(FRAME_BUFFER_INTERVAL_MS);

    // stop() fires before the camera resolves
    buf.stop();
    expect(buf.getLastUri()).toBeNull();

    // Now the slow capture resolves — must self-delete its file, not store it
    releasePicture("file:///tmp/orphan.jpg");
    // Drain microtasks
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(deleteSpy).toHaveBeenCalledWith("file:///tmp/orphan.jpg", { idempotent: true });
    expect(buf.getLastUri()).toBeNull();
  });

  it("does not adopt an old capture after stop followed by a new start", async () => {
    let resolveOld!: (uri: string) => void;
    const takeSpy = vi.fn().mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveOld = resolve;
      }),
    );
    const deleteSpy = makeDeleteSpy();
    const buf = createFrameBuffer({
      takePicture: asTakePicture(takeSpy),
      deleteFile: asDeleteFile(deleteSpy),
    });

    buf.start();
    vi.advanceTimersByTime(FRAME_BUFFER_INTERVAL_MS);
    buf.stop();
    buf.start();
    resolveOld("file:///tmp/old-session.jpg");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(buf.getLastUri()).toBeNull();
    expect(deleteSpy).toHaveBeenCalledWith("file:///tmp/old-session.jpg", {
      idempotent: true,
    });
    buf.stop();
  });
});

// ─── Baseline: successful deletes work correctly ──────────────────────────────

describe("createFrameBuffer — baseline: successful deletes", () => {
  it("first tick stores URI without calling deleteFile", async () => {
    const deleteSpy = makeDeleteSpy();
    const takeSpy = makeTakePicture(["file:///tmp/frame-0.jpg"]);

    const buf = createFrameBuffer({
      takePicture: asTakePicture(takeSpy),
      deleteFile: asDeleteFile(deleteSpy),
    });
    buf.start();

    await vi.advanceTimersByTimeAsync(FRAME_BUFFER_INTERVAL_MS);
    expect(buf.getLastUri()).toBe("file:///tmp/frame-0.jpg");
    expect(deleteSpy).toHaveBeenCalledTimes(0);

    buf.stop();
  });

  it("second tick deletes the first URI and stores the second", async () => {
    const deleteSpy = makeDeleteSpy();
    const takeSpy = makeTakePicture([
      "file:///tmp/frame-0.jpg",
      "file:///tmp/frame-1.jpg",
    ]);

    const buf = createFrameBuffer({
      takePicture: asTakePicture(takeSpy),
      deleteFile: asDeleteFile(deleteSpy),
    });
    buf.start();

    await vi.advanceTimersByTimeAsync(FRAME_BUFFER_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(FRAME_BUFFER_INTERVAL_MS);

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(deleteSpy).toHaveBeenCalledWith("file:///tmp/frame-0.jpg", { idempotent: true });
    expect(buf.getLastUri()).toBe("file:///tmp/frame-1.jpg");

    buf.stop();
  });

  it("start() is idempotent — a second call does not start a second interval", async () => {
    const takeSpy = makeTakePicture(Array(10).fill("file:///tmp/frame.jpg"));

    const buf = createFrameBuffer({
      takePicture: asTakePicture(takeSpy),
      deleteFile: asDeleteFile(makeDeleteSpy()),
    });
    buf.start();
    buf.start(); // second call — must be a no-op

    await vi.advanceTimersByTimeAsync(FRAME_BUFFER_INTERVAL_MS);
    // If two intervals were running, takePicture would be called twice
    expect(takeSpy).toHaveBeenCalledTimes(1);

    buf.stop();
  });

  it("skips interval ticks while a rolling capture is still in flight", async () => {
    let resolveFirst!: (uri: string) => void;
    const first = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const takeSpy = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValue("file:///tmp/frame-next.jpg");
    const buf = createFrameBuffer({
      takePicture: asTakePicture(takeSpy),
      deleteFile: asDeleteFile(makeDeleteSpy()),
    });
    buf.start();

    await vi.advanceTimersByTimeAsync(FRAME_BUFFER_INTERVAL_MS * 3);
    expect(takeSpy).toHaveBeenCalledTimes(1);

    resolveFirst("file:///tmp/frame-first.jpg");
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(FRAME_BUFFER_INTERVAL_MS);
    expect(takeSpy).toHaveBeenCalledTimes(2);
    buf.stop();
  });

  it("returns the buffered frame without starting another camera request", async () => {
    const takeSpy = makeTakePicture([
      "file:///tmp/frame-buffered.jpg",
      "file:///tmp/frame-should-not-run.jpg",
    ]);
    const buf = createFrameBuffer({
      takePicture: asTakePicture(takeSpy),
      deleteFile: asDeleteFile(makeDeleteSpy()),
    });
    buf.start();
    await vi.advanceTimersByTimeAsync(FRAME_BUFFER_INTERVAL_MS);

    await expect(buf.getFrame()).resolves.toBe("file:///tmp/frame-buffered.jpg");
    expect(takeSpy).toHaveBeenCalledTimes(1);
    buf.stop();
  });

  it("reuses an in-flight rolling capture when no buffered frame exists", async () => {
    let resolvePicture!: (uri: string) => void;
    const takeSpy = vi.fn().mockReturnValue(
      new Promise<string>((resolve) => {
        resolvePicture = resolve;
      }),
    );
    const buf = createFrameBuffer({
      takePicture: asTakePicture(takeSpy),
      deleteFile: asDeleteFile(makeDeleteSpy()),
    });
    buf.start();
    vi.advanceTimersByTime(FRAME_BUFFER_INTERVAL_MS);

    const frame = buf.getFrame();
    expect(takeSpy).toHaveBeenCalledTimes(1);
    resolvePicture("file:///tmp/frame-shared.jpg");
    await expect(frame).resolves.toBe("file:///tmp/frame-shared.jpg");
    expect(takeSpy).toHaveBeenCalledTimes(1);
    buf.stop();
  });
});
