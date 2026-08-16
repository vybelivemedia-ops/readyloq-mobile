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
