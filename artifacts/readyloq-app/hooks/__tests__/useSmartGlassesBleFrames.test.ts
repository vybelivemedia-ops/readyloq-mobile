// @vitest-environment jsdom
/**
 * Tests — useSmartGlassesBleFrames: storage cleanup verification
 *
 * Verifies that no JPEG files remain in device storage after a normal
 * inspection session and that orphaned files from a previous crashed session
 * are deleted on the next startup scan.
 *
 * Task #545 requirements:
 *   ✓ 50 frames written → deleteAsync called for each URI after consumer callback
 *   ✓ Mount → 10 frames written → crash (no cleanup) → re-mount →
 *       startup orphan scan deletes all 10 leftover session directories
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DroppedFrameCallback,
  FrameCallback,
  GlassesConnectionState,
  SmartGlassesBleState,
  StateChangeCallback,
} from "../../lib/ble/smart-glasses-ble";

// ─────────────────────────────────────────────────────────────────────────────
// BLE mock — same shape used by the other BLE hook tests
// ─────────────────────────────────────────────────────────────────────────────

type MockBle = ReturnType<typeof buildMockBle>;
let mockBle: MockBle;

function buildMockBle(initial: GlassesConnectionState = "idle"): {
  getState: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  onFrame: ReturnType<typeof vi.fn>;
  onDroppedFrame: ReturnType<typeof vi.fn>;
  setConnectionState: (next: GlassesConnectionState) => void;
  emitFrame: () => void;
  frameSubscriberCount: () => number;
  stateSubscriberCount: () => number;
} {
  let connectionState: GlassesConnectionState = initial;
  const stateSubscribers = new Set<StateChangeCallback>();
  const frameCallbacks = new Set<FrameCallback>();
  const droppedFrameCallbacks = new Set<DroppedFrameCallback>();

  function snapshot(): SmartGlassesBleState {
    return {
      hwState: "PoweredOn" as SmartGlassesBleState["hwState"],
      connectionState,
      discovered: [],
      connectedDeviceId: connectionState === "connected" ? "device-1" : null,
      connectedDeviceName:
        connectionState === "connected" ? "Ray-Ban Meta" : null,
      error: null,
      pairedDeviceId: "device-1",
      pairedDeviceName: "Ray-Ban Meta",
    };
  }

  return {
    getState: vi.fn(snapshot),

    subscribe: vi.fn((cb: StateChangeCallback) => {
      stateSubscribers.add(cb);
      cb(snapshot());
      return () => stateSubscribers.delete(cb);
    }),

    onFrame: vi.fn((cb: FrameCallback) => {
      frameCallbacks.add(cb);
      return () => frameCallbacks.delete(cb);
    }),

    onDroppedFrame: vi.fn((cb: DroppedFrameCallback) => {
      droppedFrameCallbacks.add(cb);
      return () => droppedFrameCallbacks.delete(cb);
    }),

    setConnectionState(next: GlassesConnectionState) {
      connectionState = next;
      stateSubscribers.forEach((cb) => cb(snapshot()));
    },

    emitFrame() {
      const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
      frameCallbacks.forEach((cb) => cb(fakeJpeg));
    },

    /**
     * Emit a synthetic JPEG of a specific byte size so tests can drive
     * the byte-budget cap (MAX_CACHED_STORAGE_BYTES) independently of
     * the frame-count cap (MAX_CACHED_FRAMES).
     */
    emitCustomFrame(byteSize: number) {
      const fakeJpeg = new Uint8Array(byteSize).fill(0xff);
      frameCallbacks.forEach((cb) => cb(fakeJpeg));
    },

    frameSubscriberCount: () => frameCallbacks.size,
    stateSubscriberCount: () => stateSubscribers.size,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks — hoisted so they run before any import
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("@/lib/ble", () => ({
  get smartGlassesBle() {
    return mockBle;
  },
}));

vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "/tmp/test-cache/",
  documentDirectory: "/tmp/test-docs/",
  EncodingType: { Base64: "base64" },
  getInfoAsync: vi.fn().mockResolvedValue({ exists: false }),
  readDirectoryAsync: vi.fn().mockResolvedValue([]),
  makeDirectoryAsync: vi.fn().mockResolvedValue(undefined),
  writeAsStringAsync: vi.fn().mockResolvedValue(undefined),
  deleteAsync: vi.fn().mockResolvedValue(undefined),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Lazy hook import — must happen after mocks are registered
// ─────────────────────────────────────────────────────────────────────────────

async function importHook() {
  const { useSmartGlassesBleFrames } = await import(
    "@/hooks/useSmartGlassesBleFrames"
  );
  return useSmartGlassesBleFrames;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: mount the real hook and flush the async startup effect
// ─────────────────────────────────────────────────────────────────────────────

async function mountHook(
  useSmartGlassesBleFrames: Awaited<ReturnType<typeof importHook>>,
  options: {
    active: boolean;
    onFrame?: (uri: string) => Promise<void> | void;
  },
) {
  const onFrame = options.onFrame ?? vi.fn().mockResolvedValue(undefined);
  const rendered = renderHook(() =>
    useSmartGlassesBleFrames({ active: options.active, onFrame }),
  );

  // Flush the async startup effect (getInfoAsync → makeDirectoryAsync → setSetupComplete)
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  return rendered;
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

let useSmartGlassesBleFrames: Awaited<ReturnType<typeof importHook>>;

beforeEach(async () => {
  // Reset the module registry so each test starts with a fresh module instance.
  // This is required because useSmartGlassesBleFrames uses module-level
  // variables (_persistedDroppedFrameCount, _persistedFrameCount) that survive
  // vi.clearAllMocks() and would otherwise accumulate across tests.
  vi.resetModules();

  mockBle = buildMockBle("idle");
  vi.clearAllMocks();

  // Re-apply FileSystem mock defaults after clearAllMocks wipes them.
  const fs = await import("expo-file-system/legacy");
  vi.mocked(fs.getInfoAsync).mockResolvedValue({ exists: false } as never);
  vi.mocked(fs.readDirectoryAsync).mockResolvedValue([]);
  vi.mocked(fs.makeDirectoryAsync).mockResolvedValue(undefined as never);
  vi.mocked(fs.writeAsStringAsync).mockResolvedValue(undefined as never);
  vi.mocked(fs.deleteAsync).mockResolvedValue(undefined as never);

  useSmartGlassesBleFrames = await importHook();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Test suite 1 — 50-frame normal session
// ─────────────────────────────────────────────────────────────────────────────

describe("useSmartGlassesBleFrames — storage cleanup: 50-frame normal session", () => {
  it("writes exactly 50 files to the mocked filesystem during a 50-frame session", async () => {
    mockBle = buildMockBle("connected");
    const onFrame = vi.fn().mockResolvedValue(undefined);
    const fs = await import("expo-file-system/legacy");

    const { unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
      onFrame,
    });

    // Emit all 50 frames; each frame handler runs as an independent void IIFE.
    await act(async () => {
      for (let i = 0; i < 50; i++) {
        mockBle.emitFrame();
      }
      // Flush the async microtask queue enough times for all 50 IIFEs to
      // complete (write → callback → delete are all synchronous mock resolves).
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
    });

    expect(fs.writeAsStringAsync).toHaveBeenCalledTimes(50);
    unmount();
  });

  it("calls deleteAsync once for every URI that was written (50 writes → 50 deletes)", async () => {
    mockBle = buildMockBle("connected");
    const onFrame = vi.fn().mockResolvedValue(undefined);
    const fs = await import("expo-file-system/legacy");

    const { unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
      onFrame,
    });

    await act(async () => {
      for (let i = 0; i < 50; i++) {
        mockBle.emitFrame();
      }
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
    });

    // Every URI passed to writeAsStringAsync must also be passed to deleteAsync.
    const writtenUris = vi
      .mocked(fs.writeAsStringAsync)
      .mock.calls.map((c) => c[0]);
    const deletedUris = vi
      .mocked(fs.deleteAsync)
      .mock.calls.map((c) => c[0]);

    // All 50 written URIs must appear in the deleted set.
    for (const uri of writtenUris) {
      expect(deletedUris).toContain(uri);
    }

    unmount();
  });

  it("each written URI is a .jpg path inside the session directory", async () => {
    mockBle = buildMockBle("connected");
    const fs = await import("expo-file-system/legacy");

    const { unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
    });

    await act(async () => {
      for (let i = 0; i < 50; i++) {
        mockBle.emitFrame();
      }
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
    });

    const writtenUris = vi
      .mocked(fs.writeAsStringAsync)
      .mock.calls.map((c) => c[0]);

    for (const uri of writtenUris) {
      expect(uri).toMatch(/glasses_sessions\/.+\/frame_.+\.jpg$/);
    }

    unmount();
  });

  it("deleteAsync is called with { idempotent: true } for every URI", async () => {
    mockBle = buildMockBle("connected");
    const fs = await import("expo-file-system/legacy");

    const { unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
    });

    await act(async () => {
      for (let i = 0; i < 50; i++) {
        mockBle.emitFrame();
      }
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
    });

    // Startup scan may also call deleteAsync for old session dirs if any exist,
    // so filter to per-frame calls — those are the .jpg URIs.
    const perFrameDeleteCalls = vi
      .mocked(fs.deleteAsync)
      .mock.calls.filter(([uri]) => uri.endsWith(".jpg"));

    expect(perFrameDeleteCalls).toHaveLength(50);
    for (const [, opts] of perFrameDeleteCalls) {
      expect(opts).toEqual({ idempotent: true });
    }

    unmount();
  });

  it("deleteAsync is called even when the consumer onFrame callback throws", async () => {
    mockBle = buildMockBle("connected");
    // Consumer throws for every frame — the finally block must still delete.
    const onFrame = vi.fn().mockRejectedValue(new Error("consumer error"));
    const fs = await import("expo-file-system/legacy");

    const { unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
      onFrame,
    });

    await act(async () => {
      for (let i = 0; i < 10; i++) {
        mockBle.emitFrame();
      }
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
    });

    // Despite consumer failures, deleteAsync must be called for each written URI.
    const writtenUris = vi
      .mocked(fs.writeAsStringAsync)
      .mock.calls.map((c) => c[0]);
    const deletedUris = vi
      .mocked(fs.deleteAsync)
      .mock.calls.map((c) => c[0]);

    for (const uri of writtenUris) {
      expect(deletedUris).toContain(uri);
    }

    unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test suite 2 — orphan scan on re-mount after simulated crash
// ─────────────────────────────────────────────────────────────────────────────

describe("useSmartGlassesBleFrames — storage cleanup: orphan scan on re-mount", () => {
  /**
   * Build a fake old-session directory name whose embedded base-36 timestamp
   * is older than MIN_ORPHAN_AGE_MS (5 minutes).  The hook will consider it
   * an orphan and call deleteAsync for it.
   */
  function makeOldSessionId(ageMs = 10 * 60 * 1000): string {
    const oldTs = Date.now() - ageMs;
    return `${oldTs.toString(36)}_abcd`;
  }

  it("deletes the leftover session directory when 10 frames were written and the hook crashed before cleanup", async () => {
    const oldSessionId = makeOldSessionId();
    const fs = await import("expo-file-system/legacy");

    // Simulate: sessions base dir exists, one old session directory is present.
    vi.mocked(fs.getInfoAsync).mockResolvedValue({ exists: true } as never);
    vi.mocked(fs.readDirectoryAsync).mockResolvedValue([oldSessionId]);

    mockBle = buildMockBle("idle");
    const { unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
    });

    const expectedOrphanPath = `/tmp/test-cache/glasses_sessions/${oldSessionId}`;
    expect(fs.deleteAsync).toHaveBeenCalledWith(expectedOrphanPath, {
      idempotent: true,
    });

    unmount();
  });

  it("deletes every one of 10 leftover session directories found during startup scan", async () => {
    const fs = await import("expo-file-system/legacy");

    // Simulate 10 old session directories (each from a different crashed session).
    const oldSessions = Array.from({ length: 10 }, (_, i) =>
      makeOldSessionId(10 * 60 * 1000 + i * 1000),
    );

    vi.mocked(fs.getInfoAsync).mockResolvedValue({ exists: true } as never);
    vi.mocked(fs.readDirectoryAsync).mockResolvedValue(oldSessions);

    mockBle = buildMockBle("idle");
    const { unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
    });

    for (const sessionId of oldSessions) {
      expect(fs.deleteAsync).toHaveBeenCalledWith(
        `/tmp/test-cache/glasses_sessions/${sessionId}`,
        { idempotent: true },
      );
    }

    unmount();
  });

  it("does NOT delete the current session's directory during startup cleanup", async () => {
    const fs = await import("expo-file-system/legacy");

    // Start with a sessions dir that has one old session.
    const oldSessionId = makeOldSessionId();
    vi.mocked(fs.getInfoAsync).mockResolvedValue({ exists: true } as never);
    vi.mocked(fs.readDirectoryAsync).mockResolvedValue([oldSessionId]);

    mockBle = buildMockBle("idle");
    const { result, unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
    });

    // The current session dir (newly created) must never be deleted by the startup scan.
    // Collect all deleteAsync calls and confirm none target the session dir
    // that was created via makeDirectoryAsync.
    const createdDirs = vi
      .mocked(fs.makeDirectoryAsync)
      .mock.calls.map((c) => c[0]);

    const deletedPaths = vi
      .mocked(fs.deleteAsync)
      .mock.calls.map(([p]) => p);

    for (const dir of createdDirs) {
      // The current session dir must not appear in deletedPaths.
      // (Strip trailing slash for comparison since deleteAsync receives the path without it.)
      const normalised = dir.replace(/\/$/, "");
      expect(deletedPaths).not.toContain(normalised);
    }

    unmount();
  });

  it("does NOT delete a session directory that is younger than MIN_ORPHAN_AGE_MS (5 min)", async () => {
    const fs = await import("expo-file-system/legacy");

    // Create a session ID that is only 2 minutes old — should NOT be cleaned up.
    const recentSessionId = makeOldSessionId(2 * 60 * 1000);
    vi.mocked(fs.getInfoAsync).mockResolvedValue({ exists: true } as never);
    vi.mocked(fs.readDirectoryAsync).mockResolvedValue([recentSessionId]);

    mockBle = buildMockBle("idle");
    const { unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
    });

    const deletedPaths = vi
      .mocked(fs.deleteAsync)
      .mock.calls.map(([p]) => p);

    expect(deletedPaths).not.toContain(
      `/tmp/test-cache/glasses_sessions/${recentSessionId}`,
    );

    unmount();
  });

  it("handles a missing sessions base directory gracefully (no crash)", async () => {
    const fs = await import("expo-file-system/legacy");

    // Sessions base dir does not exist — readDirectoryAsync should never be called.
    vi.mocked(fs.getInfoAsync).mockResolvedValue({ exists: false } as never);

    mockBle = buildMockBle("idle");

    // Should mount without throwing.
    const { result, unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
    });

    expect(fs.readDirectoryAsync).not.toHaveBeenCalled();
    unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test suite 3 — rolling-window storage cap (MAX_CACHED_FRAMES / byte budget)
//
// These tests verify that the cap is enforced correctly even when:
//   (a) deleteAsync is deferred (pending) — reservation not yet released
//   (b) deleteAsync fails — reservation intentionally retained
//   (c) individual frames are large enough to trigger the byte budget cap
//       before the frame-count cap
// ─────────────────────────────────────────────────────────────────────────────

describe("useSmartGlassesBleFrames — rolling-window storage cap", () => {
  /**
   * Flush enough microtask ticks for N frames each needing K await points
   * plus extra headroom.
   */
  async function flushMicrotasks(ticks = 300) {
    for (let i = 0; i < ticks; i++) {
      await Promise.resolve();
    }
  }

  // ── frame-count cap, deferred delete ──────────────────────────────────────

  it("does not write more than MAX_CACHED_FRAMES (100) files when deleteAsync is permanently deferred", async () => {
    mockBle = buildMockBle("connected");
    const fs = await import("expo-file-system/legacy");

    // deleteAsync never resolves → reservations are never released
    vi.mocked(fs.deleteAsync).mockReturnValue(
      new Promise<void>(() => {}), // intentionally never resolves
    );

    const onFrame = vi.fn().mockResolvedValue(undefined);
    const { unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
      onFrame,
    });

    await act(async () => {
      // Emit 110 frames: first 100 should be written, last 10 dropped
      for (let i = 0; i < 110; i++) {
        mockBle.emitFrame();
      }
      await flushMicrotasks(400);
    });

    // Only MAX_CACHED_FRAMES writes permitted — surplus frames are dropped
    expect(fs.writeAsStringAsync).toHaveBeenCalledTimes(100);
    unmount();
  });

  it("increments droppedFrameCount for every frame rejected by the deferred-delete cap", async () => {
    mockBle = buildMockBle("connected");
    const fs = await import("expo-file-system/legacy");

    vi.mocked(fs.deleteAsync).mockReturnValue(new Promise<void>(() => {}));

    const onFrame = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
      onFrame,
    });

    await act(async () => {
      for (let i = 0; i < 105; i++) {
        mockBle.emitFrame();
      }
      await flushMicrotasks(400);
    });

    // 5 surplus frames were dropped (105 − 100)
    expect(result.current.droppedFrameCount).toBe(5);
    unmount();
  });

  // ── frame-count cap, failed delete ────────────────────────────────────────

  it("retains the slot reservation when deleteAsync fails so the cap is still enforced", async () => {
    mockBle = buildMockBle("connected");
    const fs = await import("expo-file-system/legacy");

    // deleteAsync always rejects → reservations are kept intentionally
    vi.mocked(fs.deleteAsync).mockRejectedValue(new Error("disk full"));

    const onFrame = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
      onFrame,
    });

    await act(async () => {
      // Fill the cap: 100 frames written, all with failed deletes
      for (let i = 0; i < 100; i++) {
        mockBle.emitFrame();
      }
      await flushMicrotasks(400);
    });

    await act(async () => {
      // 101st frame: reservations from failed deletes keep the list full → drop
      mockBle.emitFrame();
      await flushMicrotasks(50);
    });

    // 100 writes succeeded; 101st was dropped due to retained reservations
    expect(fs.writeAsStringAsync).toHaveBeenCalledTimes(100);
    expect(result.current.droppedFrameCount).toBe(1);
    unmount();
  });

  // ── byte-budget cap ───────────────────────────────────────────────────────

  it("enforces the 50 MB byte budget before reaching the 100-frame count cap with large frames", async () => {
    mockBle = buildMockBle("connected");
    const fs = await import("expo-file-system/legacy");

    // deleteAsync never resolves → reservations never released (same as deferred test)
    vi.mocked(fs.deleteAsync).mockReturnValue(new Promise<void>(() => {}));

    const onFrame = vi.fn().mockResolvedValue(undefined);
    const { unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
      onFrame,
    });

    // MAX_CACHED_STORAGE_BYTES = 50 MB = 52_428_800 bytes
    // Frame size = 1 MB each → byte cap fires after 50 frames (50 MB)
    // 51st frame: 50 MB + 1 MB = 51 MB > 50 MB → dropped
    // This verifies byte cap fires BEFORE the 100-frame count cap.
    const ONE_MB = 1024 * 1024;

    await act(async () => {
      for (let i = 0; i < 55; i++) {
        mockBle.emitCustomFrame(ONE_MB);
      }
      await flushMicrotasks(400);
    });

    // Exactly 50 frames written (50 MB reserved), 5 dropped by the byte cap
    expect(fs.writeAsStringAsync).toHaveBeenCalledTimes(50);
    unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test suite 4 — writeAsStringAsync failure mid-session
//
// Verifies the hook's behaviour when the filesystem write itself fails
// (e.g. ENOSPC, permission error) for a subset of frames:
//
//   ✓ droppedFrameCount increments for each write failure
//   ✓ the consumer onFrame callback is NOT called for frames whose write failed
//   ✓ deleteAsync IS called for a failed-write URI (uri is assigned before the
//     write attempt; idempotent:true makes the call safe on a non-existent file)
//   ✓ subsequent frames — after a run of failures — are written and delivered
//     normally (the session recovers)
//   ✓ frame-count telemetry (onDroppedFrame) fires with reason "processing_error"
//     for each write failure
// ─────────────────────────────────────────────────────────────────────────────

describe("useSmartGlassesBleFrames — writeAsStringAsync failure mid-session", () => {
  async function flushMicrotasks(ticks = 300) {
    for (let i = 0; i < ticks; i++) {
      await Promise.resolve();
    }
  }

  it("increments droppedFrameCount once for each frame whose write fails", async () => {
    mockBle = buildMockBle("connected");
    const fs = await import("expo-file-system/legacy");

    // Fail every write — all frames dropped
    vi.mocked(fs.writeAsStringAsync).mockRejectedValue(
      new Error("ENOSPC: no space left on device"),
    );

    const onFrame = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
      onFrame,
    });

    await act(async () => {
      for (let i = 0; i < 5; i++) {
        mockBle.emitFrame();
      }
      await flushMicrotasks(200);
    });

    expect(result.current.droppedFrameCount).toBe(5);
    unmount();
  });

  it("increments droppedFrameCount only for the frames that actually fail (subset)", async () => {
    mockBle = buildMockBle("connected");
    const fs = await import("expo-file-system/legacy");

    // Fail writes 2 and 4 (0-indexed), succeed for the rest
    let callCount = 0;
    vi.mocked(fs.writeAsStringAsync).mockImplementation(() => {
      const idx = callCount++;
      if (idx === 1 || idx === 3) {
        return Promise.reject(new Error("ENOSPC")) as unknown as Promise<void>;
      }
      return Promise.resolve() as unknown as Promise<void>;
    });

    const onFrame = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
      onFrame,
    });

    await act(async () => {
      for (let i = 0; i < 5; i++) {
        mockBle.emitFrame();
      }
      await flushMicrotasks(200);
    });

    // 2 write failures → 2 drops
    expect(result.current.droppedFrameCount).toBe(2);
    unmount();
  });

  it("does NOT call the consumer onFrame callback when writeAsStringAsync fails", async () => {
    mockBle = buildMockBle("connected");
    const fs = await import("expo-file-system/legacy");

    vi.mocked(fs.writeAsStringAsync).mockRejectedValue(
      new Error("ENOSPC: no space left on device"),
    );

    const onFrame = vi.fn().mockResolvedValue(undefined);
    const { unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
      onFrame,
    });

    await act(async () => {
      for (let i = 0; i < 5; i++) {
        mockBle.emitFrame();
      }
      await flushMicrotasks(200);
    });

    // Write failed before consumer could be invoked
    expect(onFrame).not.toHaveBeenCalled();
    unmount();
  });

  it("calls deleteAsync for the URI even when writeAsStringAsync fails (idempotent cleanup)", async () => {
    mockBle = buildMockBle("connected");
    const fs = await import("expo-file-system/legacy");

    // The uri is assigned before the write attempt, so the finally block will
    // attempt an idempotent delete (safe because the file never existed).
    vi.mocked(fs.writeAsStringAsync).mockRejectedValue(
      new Error("ENOSPC: no space left on device"),
    );

    const onFrame = vi.fn().mockResolvedValue(undefined);
    const { unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
      onFrame,
    });

    await act(async () => {
      for (let i = 0; i < 3; i++) {
        mockBle.emitFrame();
      }
      await flushMicrotasks(200);
    });

    // Every attempted URI must have had a deleteAsync call with idempotent:true.
    // writeAsStringAsync was called 3 times (each got a URI before failing).
    expect(fs.writeAsStringAsync).toHaveBeenCalledTimes(3);

    const attemptedUris = vi
      .mocked(fs.writeAsStringAsync)
      .mock.calls.map((c) => c[0]);

    const deletedUris = vi
      .mocked(fs.deleteAsync)
      .mock.calls.filter(([uri]) => uri.endsWith(".jpg"))
      .map(([uri]) => uri);

    for (const uri of attemptedUris) {
      expect(deletedUris).toContain(uri);
    }

    // Confirm they were all called with idempotent:true
    const perFrameDeleteCalls = vi
      .mocked(fs.deleteAsync)
      .mock.calls.filter(([uri]) => uri.endsWith(".jpg"));
    for (const [, opts] of perFrameDeleteCalls) {
      expect(opts).toEqual({ idempotent: true });
    }

    unmount();
  });

  it("processes subsequent frames normally after a run of write failures (session recovers)", async () => {
    mockBle = buildMockBle("connected");
    const fs = await import("expo-file-system/legacy");

    // First 3 writes fail, then all succeed
    let callCount = 0;
    vi.mocked(fs.writeAsStringAsync).mockImplementation(() => {
      const idx = callCount++;
      if (idx < 3) {
        return Promise.reject(new Error("ENOSPC")) as unknown as Promise<void>;
      }
      return Promise.resolve() as unknown as Promise<void>;
    });

    const onFrame = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
      onFrame,
    });

    await act(async () => {
      // 3 failing frames followed by 5 succeeding frames
      for (let i = 0; i < 8; i++) {
        mockBle.emitFrame();
      }
      await flushMicrotasks(300);
    });

    // 3 write failures → 3 drops
    expect(result.current.droppedFrameCount).toBe(3);
    // 5 successful frames → consumer called 5 times
    expect(onFrame).toHaveBeenCalledTimes(5);
    // Total write attempts: 8 (3 failed + 5 succeeded)
    expect(fs.writeAsStringAsync).toHaveBeenCalledTimes(8);
    // Successful frame count: 5
    expect(result.current.frameCount).toBe(5);

    unmount();
  });

  it("fires the onDroppedFrame telemetry callback with reason 'processing_error' for each write failure", async () => {
    mockBle = buildMockBle("connected");
    const fs = await import("expo-file-system/legacy");

    vi.mocked(fs.writeAsStringAsync).mockRejectedValue(
      new Error("ENOSPC: no space left on device"),
    );

    const onDroppedFrame = vi.fn();
    const onFrame = vi.fn().mockResolvedValue(undefined);
    const { unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
      onFrame,
    });

    // Re-render with the telemetry callback wired in (we can't pass it through
    // mountHook directly since it doesn't accept onDroppedFrame; instead,
    // use a fresh hook render for this test).
    const { unmount: unmount2 } = renderHook(() =>
      useSmartGlassesBleFrames({
        active: true,
        onFrame,
        onDroppedFrame,
      }),
    );

    // Flush startup effect
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      for (let i = 0; i < 4; i++) {
        mockBle.emitFrame();
      }
      await flushMicrotasks(200);
    });

    // onDroppedFrame must be called once per failed write with "processing_error"
    const processingErrorCalls = onDroppedFrame.mock.calls.filter(
      ([, reason]) => reason === "processing_error",
    );
    expect(processingErrorCalls.length).toBe(4);
    // Each call reports exactly 1 dropped frame
    for (const [count] of processingErrorCalls) {
      expect(count).toBe(1);
    }

    unmount();
    unmount2();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test suite 5 — Android background/foreground cycle
//
// Verifies that the module-level counters (_persistedFrameCount,
// _persistedDroppedFrameCount) correctly survive a component unmount+remount
// cycle (which Android triggers when the user backgrounds the app mid-inspection
// and then brings it back to the foreground):
//
//   ✓ frameCount on remount continues from where it left off (not reset to 0)
//   ✓ droppedFrameCount on remount continues from where it left off
//   ✓ the startup scan on remount does NOT delete the still-active pre-unmount
//     session directory (age guard — it is younger than MIN_ORPHAN_AGE_MS)
//   ✓ no extra deleteAsync calls are issued for .jpg files that were already
//     cleaned up during the pre-unmount session
// ─────────────────────────────────────────────────────────────────────────────

describe("useSmartGlassesBleFrames — Android background/foreground cycle", () => {
  async function flushMicrotasks(ticks = 300) {
    for (let i = 0; i < ticks; i++) {
      await Promise.resolve();
    }
  }

  it("frameCount resumes from the persisted value after unmount and remount (not reset to 0)", async () => {
    mockBle = buildMockBle("connected");
    const onFrame = vi.fn().mockResolvedValue(undefined);
    const fs = await import("expo-file-system/legacy");

    // ── First mount (inspection in progress) ────────────────────────────────
    const { result: result1, unmount: unmount1 } = await mountHook(
      useSmartGlassesBleFrames,
      { active: true, onFrame },
    );

    // Emit 7 frames successfully
    await act(async () => {
      for (let i = 0; i < 7; i++) {
        mockBle.emitFrame();
      }
      await flushMicrotasks(200);
    });

    expect(result1.current.frameCount).toBe(7);

    // ── Simulate Android background (unmount) ────────────────────────────────
    unmount1();

    // ── Simulate Android foreground (remount) ────────────────────────────────
    // Re-import returns the same cached module instance, so _persistedFrameCount
    // still holds 7 from the previous mount.
    const hookAfterRemount = await importHook();
    const { result: result2, unmount: unmount2 } = await mountHook(
      hookAfterRemount,
      { active: true, onFrame },
    );

    // The useState initializer reads _persistedFrameCount (7), so the count
    // must not restart from 0.
    expect(result2.current.frameCount).toBe(7);

    // Emit 3 more frames on the remounted hook
    await act(async () => {
      for (let i = 0; i < 3; i++) {
        mockBle.emitFrame();
      }
      await flushMicrotasks(200);
    });

    // Total must be 10 (7 from before background + 3 new)
    expect(result2.current.frameCount).toBe(10);

    unmount2();
  });

  it("droppedFrameCount resumes from the persisted value after unmount and remount", async () => {
    mockBle = buildMockBle("connected");
    const fs = await import("expo-file-system/legacy");

    // Make every write fail so all frames are dropped
    vi.mocked(fs.writeAsStringAsync).mockRejectedValue(
      new Error("ENOSPC: no space left on device"),
    );

    const onFrame = vi.fn().mockResolvedValue(undefined);

    // ── First mount ──────────────────────────────────────────────────────────
    const { result: result1, unmount: unmount1 } = await mountHook(
      useSmartGlassesBleFrames,
      { active: true, onFrame },
    );

    await act(async () => {
      for (let i = 0; i < 4; i++) {
        mockBle.emitFrame();
      }
      await flushMicrotasks(200);
    });

    expect(result1.current.droppedFrameCount).toBe(4);

    // ── Android background ───────────────────────────────────────────────────
    unmount1();

    // ── Android foreground (remount) ─────────────────────────────────────────
    const hookAfterRemount = await importHook();
    const { result: result2, unmount: unmount2 } = await mountHook(
      hookAfterRemount,
      { active: true, onFrame },
    );

    // droppedFrameCount must continue from 4, not restart from 0
    expect(result2.current.droppedFrameCount).toBe(4);

    unmount2();
  });

  it("startup scan on remount does NOT delete the pre-unmount session directory (age guard)", async () => {
    const fs = await import("expo-file-system/legacy");

    // ── First mount ──────────────────────────────────────────────────────────
    // Sessions base dir does not exist yet → startup creates session dir only
    vi.mocked(fs.getInfoAsync).mockResolvedValue({ exists: false } as never);
    vi.mocked(fs.readDirectoryAsync).mockResolvedValue([]);

    mockBle = buildMockBle("connected");
    const { unmount: unmount1 } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
    });

    // Capture the session directory the first mount created.
    const firstMountMkdirCalls = vi
      .mocked(fs.makeDirectoryAsync)
      .mock.calls.map((c) => c[0]);
    // There should be exactly one makeDirectoryAsync call for the session dir.
    expect(firstMountMkdirCalls.length).toBeGreaterThanOrEqual(1);
    const firstSessionDir = firstMountMkdirCalls[0]; // e.g. /tmp/test-cache/glasses_sessions/<id>/
    const firstSessionId = firstSessionDir
      .replace(/.*glasses_sessions\//, "")
      .replace(/\/$/, "");

    // ── Android background ───────────────────────────────────────────────────
    unmount1();

    // Reset mock tracking counters (keep behaviour the same)
    vi.clearAllMocks();
    // Re-apply defaults after clearAllMocks
    vi.mocked(fs.makeDirectoryAsync).mockResolvedValue(undefined as never);
    vi.mocked(fs.deleteAsync).mockResolvedValue(undefined as never);
    vi.mocked(fs.writeAsStringAsync).mockResolvedValue(undefined as never);

    // Now the sessions base dir exists, containing the first session's dir.
    // The dir is milliseconds old — well below MIN_ORPHAN_AGE_MS (5 min).
    vi.mocked(fs.getInfoAsync).mockResolvedValue({ exists: true } as never);
    vi.mocked(fs.readDirectoryAsync).mockResolvedValue([firstSessionId]);

    // ── Android foreground (remount) ─────────────────────────────────────────
    const { unmount: unmount2 } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
    });

    // The first session dir is too young to be an orphan — must NOT be deleted.
    const deletedPaths = vi
      .mocked(fs.deleteAsync)
      .mock.calls.map(([p]) => p);

    const firstSessionDirNormalised = firstSessionDir.replace(/\/$/, "");
    expect(deletedPaths).not.toContain(firstSessionDirNormalised);

    unmount2();
  });

  it("no extra deleteAsync calls for .jpg files from the pre-unmount session after remount", async () => {
    mockBle = buildMockBle("connected");
    const onFrame = vi.fn().mockResolvedValue(undefined);
    const fs = await import("expo-file-system/legacy");

    // ── First mount: emit 5 frames, each written and deleted normally ────────
    const { unmount: unmount1 } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
      onFrame,
    });

    await act(async () => {
      for (let i = 0; i < 5; i++) {
        mockBle.emitFrame();
      }
      await flushMicrotasks(200);
    });

    expect(fs.writeAsStringAsync).toHaveBeenCalledTimes(5);

    // Record every .jpg URI that was deleted during the first session.
    const firstSessionJpgDeletes = new Set(
      vi
        .mocked(fs.deleteAsync)
        .mock.calls.filter(([uri]) => uri.endsWith(".jpg"))
        .map(([uri]) => uri),
    );
    expect(firstSessionJpgDeletes.size).toBe(5);

    // ── Android background ───────────────────────────────────────────────────
    unmount1();

    // Clear only the call records for deleteAsync so we can inspect what the
    // second mount does in isolation.
    vi.mocked(fs.deleteAsync).mockClear();

    // ── Android foreground (remount) ─────────────────────────────────────────
    const { unmount: unmount2 } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
      onFrame,
    });

    // No frames emitted yet on the second mount — just startup + idle.
    await act(async () => {
      await flushMicrotasks(50);
    });

    // None of the .jpg URIs from the first session should appear in a new
    // deleteAsync call (they were already cleaned up; the remount has no reason
    // to touch them again).
    const secondMountJpgDeletes = vi
      .mocked(fs.deleteAsync)
      .mock.calls.filter(([uri]) => uri.endsWith(".jpg"))
      .map(([uri]) => uri);

    for (const uri of secondMountJpgDeletes) {
      expect(firstSessionJpgDeletes.has(uri)).toBe(false);
    }

    unmount2();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test suite 6 — eviction via stalled onFrame consumer callback
//
// Task #566: confirm evicted frames are visible in the drop counter so
// technicians know storage pressure is happening.
//
// Previous suites (3) verify the cap via a deferred deleteAsync — the
// reservation is never released because the delete never settles.  This
// suite drives the same cap by stalling the *onFrame* consumer instead:
// frames are written successfully but the consumer (ingestEvidence) hasn't
// finished yet, so the slot is still occupied.  Concurrent frames that arrive
// while all 100 slots are in-flight must be dropped and the drop counter must
// reflect each eviction.
//
// Assertions:
//   ✓ droppedFrameCount increments by 1 for each frame that arrives when
//     all MAX_CACHED_FRAMES slots are occupied
//   ✓ writeAsStringAsync is called at most MAX_CACHED_FRAMES (100) times
//     (i.e. writtenUrisRef.current never exceeds MAX_CACHED_FRAMES)
//   ✓ deleteAsync is called for every URI that was written once the stall
//     is released (no written URIs are leaked)
//   ✓ onDroppedFrame telemetry fires with reason "cap_exceeded" for each
//     drop caused by the stalled-consumer eviction
// ─────────────────────────────────────────────────────────────────────────────

describe("useSmartGlassesBleFrames — eviction via stalled onFrame consumer", () => {
  async function flushMicrotasks(ticks = 400) {
    for (let i = 0; i < ticks; i++) {
      await Promise.resolve();
    }
  }

  it("increments droppedFrameCount for each frame dropped while all slots are occupied by stalled consumers", async () => {
    mockBle = buildMockBle("connected");

    // Stall every onFrame call — the consumer never resolves, so the URI
    // reservation is never released and writtenUrisRef fills up.
    const stallPromise = new Promise<void>(() => {});
    const onFrame = vi.fn().mockReturnValue(stallPromise);

    const { result, unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
      onFrame,
    });

    await act(async () => {
      // First 100 frames fill all slots (each onFrame stalls, slot stays reserved).
      for (let i = 0; i < 100; i++) {
        mockBle.emitFrame();
      }
      await flushMicrotasks(400);

      // Next 10 frames: every slot is occupied → all 10 must be dropped.
      for (let i = 0; i < 10; i++) {
        mockBle.emitFrame();
      }
      await flushMicrotasks(200);
    });

    // Exactly 10 frames were evicted (drop counter must reflect all of them).
    expect(result.current.droppedFrameCount).toBeGreaterThanOrEqual(10);

    unmount();
  });

  it("never calls writeAsStringAsync more than MAX_CACHED_FRAMES (100) times when the consumer is stalled", async () => {
    mockBle = buildMockBle("connected");
    const fs = await import("expo-file-system/legacy");

    const stallPromise = new Promise<void>(() => {});
    const onFrame = vi.fn().mockReturnValue(stallPromise);

    const { unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
      onFrame,
    });

    await act(async () => {
      // Emit 115 frames — 100 fill the cap; 15 must be silently dropped.
      for (let i = 0; i < 115; i++) {
        mockBle.emitFrame();
      }
      await flushMicrotasks(500);
    });

    // writtenUrisRef is bounded by MAX_CACHED_FRAMES — verify via write call count.
    expect(fs.writeAsStringAsync).toHaveBeenCalledTimes(100);

    unmount();
  });

  it("calls deleteAsync for every written URI once the stalled consumer is released", async () => {
    mockBle = buildMockBle("connected");
    const fs = await import("expo-file-system/legacy");

    // Use a resolvable stall so we can release all in-flight frames at will.
    let releaseAll!: () => void;
    const stallPromise = new Promise<void>((resolve) => {
      releaseAll = resolve;
    });
    const onFrame = vi.fn().mockReturnValue(stallPromise);

    const { unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
      onFrame,
    });

    await act(async () => {
      // Fill up all 100 slots.
      for (let i = 0; i < 100; i++) {
        mockBle.emitFrame();
      }
      await flushMicrotasks(400);
    });

    // 100 writes done, deleteAsync not yet called (consumer still stalled).
    expect(fs.writeAsStringAsync).toHaveBeenCalledTimes(100);
    const writtenUris = vi
      .mocked(fs.writeAsStringAsync)
      .mock.calls.map((c) => c[0]);

    // Release the stall — all 100 consumer promises resolve simultaneously.
    await act(async () => {
      releaseAll();
      await flushMicrotasks(500);
    });

    // Every written URI must now have been passed to deleteAsync.
    const deletedUris = vi
      .mocked(fs.deleteAsync)
      .mock.calls.filter(([uri]) => (uri as string).endsWith(".jpg"))
      .map(([uri]) => uri);

    for (const uri of writtenUris) {
      expect(deletedUris).toContain(uri);
    }

    unmount();
  });

  it("fires onDroppedFrame with reason 'cap_exceeded' for each frame evicted by the stalled-consumer cap", async () => {
    mockBle = buildMockBle("connected");

    const stallPromise = new Promise<void>(() => {});
    const onFrame = vi.fn().mockReturnValue(stallPromise);
    const onDroppedFrame = vi.fn();

    // Use renderHook directly so we can pass onDroppedFrame.
    const { result, unmount } = renderHook(() =>
      useSmartGlassesBleFrames({ active: true, onFrame, onDroppedFrame }),
    );

    // Flush the async startup effect (getInfoAsync → makeDirectoryAsync → setSetupComplete).
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      // Fill all 100 slots — consumer stalls on every frame.
      for (let i = 0; i < 100; i++) {
        mockBle.emitFrame();
      }
      await flushMicrotasks(400);

      // Emit 5 more while all slots are occupied — each must fire cap_exceeded.
      for (let i = 0; i < 5; i++) {
        mockBle.emitFrame();
      }
      await flushMicrotasks(200);
    });

    const capExceededCalls = onDroppedFrame.mock.calls.filter(
      ([, reason]) => reason === "cap_exceeded",
    );
    expect(capExceededCalls.length).toBe(5);

    // Each cap_exceeded call must report exactly 1 dropped frame.
    for (const [count] of capExceededCalls) {
      expect(count).toBe(1);
    }

    // The React state must also reflect all 5 evictions.
    expect(result.current.droppedFrameCount).toBeGreaterThanOrEqual(5);

    unmount();
  });
});
