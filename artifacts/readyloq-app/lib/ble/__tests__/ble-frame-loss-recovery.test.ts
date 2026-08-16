// @vitest-environment jsdom
/**
 * Tests — useSmartGlassesBleFrames: dropped-frame warning auto-clear
 *
 * Covers the reconnect-recovery state machine introduced in Task #541:
 *
 *   ✓ droppedFrameCount resets (to 0 or post-reconnect residual) on first
 *     successful frame after a disconnect → reconnect transition
 *   ✓ reconnectNotice is set with the correct count and auto-clears after 5 s
 *   ✓ A new drop during the notice window cancels it immediately so the red
 *     warning appears — no false "recovery" signal
 *   ✓ Drops that occur between the reconnect event and the first successful
 *     frame are preserved in the new session's droppedFrameCount (not lost)
 *   ✓ If no frames were dropped before reconnect, no notice is shown
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DroppedFrameCallback,
  FrameCallback,
  GlassesConnectionState,
  SmartGlassesBleState,
  StateChangeCallback,
} from "../smart-glasses-ble";

// ─────────────────────────────────────────────────────────────────────────────
// BLE mock — same shape as ble-frame-resubscribe.test.ts
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
  emitDroppedFrame: (count?: number) => void;
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
      const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff]);
      frameCallbacks.forEach((cb) => cb(fakeJpeg));
    },

    emitDroppedFrame(count = 1, reason: "disconnect" | "timeout" = "disconnect") {
      droppedFrameCallbacks.forEach((cb) => cb(count, reason));
    },

    frameSubscriberCount: () => frameCallbacks.size,
    stateSubscriberCount: () => stateSubscribers.size,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks
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
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function importHook() {
  const { useSmartGlassesBleFrames } = await import(
    "@/hooks/useSmartGlassesBleFrames"
  );
  return useSmartGlassesBleFrames;
}

async function mountHook(
  useSmartGlassesBleFrames: Awaited<ReturnType<typeof importHook>>,
  options: { active: boolean; onFrame?: (uri: string) => Promise<void> | void },
) {
  const onFrame = options.onFrame ?? vi.fn().mockResolvedValue(undefined);
  const rendered = renderHook(() =>
    useSmartGlassesBleFrames({ active: options.active, onFrame }),
  );
  // Flush the async startup effect (getInfoAsync → makeDirectoryAsync → setSetupComplete)
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return rendered;
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

let useSmartGlassesBleFrames: Awaited<ReturnType<typeof importHook>>;

beforeEach(async () => {
  vi.useFakeTimers();
  mockBle = buildMockBle("idle");
  vi.clearAllMocks();
  const fs = await import("expo-file-system/legacy");
  vi.mocked(fs.getInfoAsync).mockResolvedValue({ exists: false } as never);
  vi.mocked(fs.readDirectoryAsync).mockResolvedValue([]);
  vi.mocked(fs.makeDirectoryAsync).mockResolvedValue(undefined as never);
  vi.mocked(fs.writeAsStringAsync).mockResolvedValue(undefined as never);
  vi.mocked(fs.deleteAsync).mockResolvedValue(undefined as never);
  useSmartGlassesBleFrames = await importHook();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Reconnect with prior drops → reset + notice
// ─────────────────────────────────────────────────────────────────────────────

describe("reconnect-recovery — droppedFrameCount resets after reconnect + first good frame", () => {
  it("droppedFrameCount becomes 0 after reconnect when no new drops occurred", async () => {
    mockBle = buildMockBle("connected");
    const { result, unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
    });

    // Record driver-level drops
    act(() => {
      mockBle.emitDroppedFrame(3);
    });
    expect(result.current.droppedFrameCount).toBe(3);

    // Disconnect → reconnect
    act(() => {
      mockBle.setConnectionState("idle");
      mockBle.setConnectionState("connected");
    });

    // First successful frame after reconnect should reset the counter
    await act(async () => {
      mockBle.emitFrame();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.droppedFrameCount).toBe(0);
    unmount();
  });

  it("reconnectNotice is set with the correct lost count", async () => {
    mockBle = buildMockBle("connected");
    const { result, unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
    });

    act(() => {
      mockBle.emitDroppedFrame(2);
    });

    act(() => {
      mockBle.setConnectionState("idle");
      mockBle.setConnectionState("connected");
    });

    await act(async () => {
      mockBle.emitFrame();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.reconnectNotice).toContain("2 frames lost");
    expect(result.current.reconnectNotice).toContain("Reconnected");
    unmount();
  });

  it("reconnectNotice uses singular 'frame' when only 1 was lost", async () => {
    mockBle = buildMockBle("connected");
    const { result, unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
    });

    act(() => {
      mockBle.emitDroppedFrame(1);
    });

    act(() => {
      mockBle.setConnectionState("idle");
      mockBle.setConnectionState("connected");
    });

    await act(async () => {
      mockBle.emitFrame();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.reconnectNotice).toContain("1 frame lost");
    // must NOT say "1 frames lost"
    expect(result.current.reconnectNotice).not.toContain("1 frames");
    unmount();
  });

  it("reconnectNotice auto-clears after 5 seconds", async () => {
    mockBle = buildMockBle("connected");
    const { result, unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
    });

    act(() => {
      mockBle.emitDroppedFrame(4);
      mockBle.setConnectionState("idle");
      mockBle.setConnectionState("connected");
    });

    await act(async () => {
      mockBle.emitFrame();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.reconnectNotice).not.toBeNull();

    // Advance past the 5-second auto-clear timer
    act(() => {
      vi.advanceTimersByTime(5_001);
    });

    expect(result.current.reconnectNotice).toBeNull();
    unmount();
  });

  it("no reconnectNotice when glasses reconnect with zero prior drops", async () => {
    mockBle = buildMockBle("connected");
    const { result, unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
    });

    // No drops recorded — disconnect → reconnect
    act(() => {
      mockBle.setConnectionState("idle");
      mockBle.setConnectionState("connected");
    });

    await act(async () => {
      mockBle.emitFrame();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.reconnectNotice).toBeNull();
    expect(result.current.droppedFrameCount).toBe(0);
    unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// New drop during the notice window → notice cancelled, red warning appears
// ─────────────────────────────────────────────────────────────────────────────

describe("reconnect-recovery — new drop during notice window cancels the notice", () => {
  it("reconnectNotice is cleared immediately when a driver-level drop fires during the notice", async () => {
    mockBle = buildMockBle("connected");
    const { result, unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
    });

    act(() => {
      mockBle.emitDroppedFrame(2);
      mockBle.setConnectionState("idle");
      mockBle.setConnectionState("connected");
    });

    // Establish the notice
    await act(async () => {
      mockBle.emitFrame();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.reconnectNotice).not.toBeNull();

    // A new drop during the 5-second window must cancel it immediately
    act(() => {
      mockBle.emitDroppedFrame(1);
    });

    expect(result.current.reconnectNotice).toBeNull();
    expect(result.current.droppedFrameCount).toBeGreaterThan(0);
    unmount();
  });

  it("droppedFrameCount is non-zero immediately after the notice is cancelled by a new drop", async () => {
    mockBle = buildMockBle("connected");
    const { result, unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
    });

    act(() => {
      mockBle.emitDroppedFrame(3);
      mockBle.setConnectionState("idle");
      mockBle.setConnectionState("connected");
    });

    await act(async () => {
      mockBle.emitFrame();
      await Promise.resolve();
      await Promise.resolve();
    });

    // New drop while notice is active
    act(() => {
      mockBle.emitDroppedFrame(2);
    });

    // Notice gone, red counter visible
    expect(result.current.reconnectNotice).toBeNull();
    expect(result.current.droppedFrameCount).toBe(2);
    unmount();
  });

  it("notice is cancelled before 5 s if a frame write fails during the notice window", async () => {
    const fs = await import("expo-file-system/legacy");
    vi.mocked(fs.writeAsStringAsync)
      .mockResolvedValueOnce(undefined as never) // first frame succeeds (triggers notice)
      .mockRejectedValueOnce(new Error("disk full")); // second frame fails

    mockBle = buildMockBle("connected");
    const { result, unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
    });

    act(() => {
      mockBle.emitDroppedFrame(1);
      mockBle.setConnectionState("idle");
      mockBle.setConnectionState("connected");
    });

    // First frame succeeds → notice appears
    await act(async () => {
      mockBle.emitFrame();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.reconnectNotice).not.toBeNull();

    // Second frame write fails → drop counted → notice cancelled
    await act(async () => {
      mockBle.emitFrame();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.reconnectNotice).toBeNull();
    expect(result.current.droppedFrameCount).toBeGreaterThan(0);
    unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Drops between reconnect event and first successful frame are preserved
// ─────────────────────────────────────────────────────────────────────────────

describe("reconnect-recovery — drops between reconnect event and first frame preserved", () => {
  it("a driver-level drop after reconnect but before the first good frame appears in the new session count", async () => {
    mockBle = buildMockBle("connected");
    const { result, unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
    });

    // 2 drops before disconnect
    act(() => {
      mockBle.emitDroppedFrame(2);
    });

    act(() => {
      mockBle.setConnectionState("idle");
      mockBle.setConnectionState("connected");
    });

    // 1 additional drop AFTER reconnect but BEFORE the first successful frame
    act(() => {
      mockBle.emitDroppedFrame(1);
    });

    // Now emit the first successful frame — triggers recovery
    await act(async () => {
      mockBle.emitFrame();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The notice reports the 2 pre-reconnect drops
    expect(result.current.reconnectNotice).toContain("2 frames lost");

    // The new session keeps the 1 post-reconnect drop — not silently discarded
    expect(result.current.droppedFrameCount).toBe(1);
    unmount();
  });

  it("droppedFrameCount is 0 after clean reconnect with no post-reconnect drops", async () => {
    mockBle = buildMockBle("connected");
    const { result, unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
    });

    act(() => {
      mockBle.emitDroppedFrame(5);
      mockBle.setConnectionState("idle");
      mockBle.setConnectionState("connected");
    });

    // First successful frame — no drops between reconnect and this frame
    await act(async () => {
      mockBle.emitFrame();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.droppedFrameCount).toBe(0);
    unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Race: pre-reconnect frame completes AFTER the reconnect transition
// ─────────────────────────────────────────────────────────────────────────────

describe("reconnect-recovery — pre-reconnect frame completing after reconnect does not clear warning", () => {
  it("a slow-ingesting frame that started before disconnect does not trigger recovery", async () => {
    // Give the first frame a deferred onFrame callback that we resolve manually.
    let resolveFirstFrame!: () => void;
    const firstFramePromise = new Promise<void>((resolve) => {
      resolveFirstFrame = resolve;
    });

    const fs = await import("expo-file-system/legacy");
    // writeAsStringAsync resolves normally but onFrame blocks until we release it
    vi.mocked(fs.writeAsStringAsync).mockResolvedValue(undefined as never);

    let callCount = 0;
    const onFrame = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First frame: simulate slow ingest that outlasts the disconnect+reconnect
        return firstFramePromise;
      }
      return Promise.resolve();
    });

    mockBle = buildMockBle("connected");
    const { result, unmount } = await mountHook(useSmartGlassesBleFrames, {
      active: true,
      onFrame,
    });

    // Record some drops so recovery would show a notice if it fires
    act(() => {
      mockBle.emitDroppedFrame(3);
    });

    // Emit the first frame — it starts processing but the ingest callback is blocked
    act(() => {
      mockBle.emitFrame();
    });
    // Let write complete but NOT the ingest (firstFramePromise still pending)
    await act(async () => {
      await Promise.resolve(); // write resolves
    });

    // Disconnect + reconnect while first frame is still ingesting
    act(() => {
      mockBle.setConnectionState("idle");
      mockBle.setConnectionState("connected");
    });

    // Now the first (pre-reconnect) frame's ingest completes — recovery must NOT fire
    await act(async () => {
      resolveFirstFrame();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Warning still showing — the old frame must not have cleared it
    expect(result.current.reconnectNotice).toBeNull();  // no false "reconnected" notice
    expect(result.current.droppedFrameCount).toBe(3);   // counter not reset

    // Now emit a genuinely post-reconnect frame — THIS should trigger recovery
    await act(async () => {
      mockBle.emitFrame();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.reconnectNotice).toContain("Reconnected");
    expect(result.current.droppedFrameCount).toBe(0);
    unmount();
  });
});
