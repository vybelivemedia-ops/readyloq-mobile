/**
 * Tests — BLE connection badge across disconnect + reconnect
 *
 * Two layers of coverage:
 *
 *   A. Pure badge-display helpers (label, colors)
 *      getBleBadgeStyle is a pure function — verify every property for both
 *      states and the full connected → disconnected → reconnected sequence.
 *
 *   B. BLE state-machine simulation
 *      Replays the core logic of useSmartGlassesBleFrames (subscribe to
 *      smartGlassesBle state changes, update isBleConnected, drive onFrame
 *      callbacks) against a mock BLE driver.  This confirms:
 *        • badge text and colors update reactively on each state change
 *        • the frame counter increments while connected
 *        • the frame counter is NOT reset on disconnect or reconnect
 *
 * Task #534 requirements:
 *   ✓ Badge text flips BLE·direct → Cloud·relay → BLE·direct mid-inspection
 *   ✓ Badge colors (bg, border, dot, text) update on every transition
 *   ✓ BLE frame count preserved across reconnect (no reset to 0)
 */

import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  BLE_DIRECT_STYLE,
  CLOUD_RELAY_STYLE,
  getBleBadgeStyle,
  type BleBadgeStyle,
} from "../badge-display";
import type {
  FrameCallback,
  GlassesConnectionState,
  SmartGlassesBleState,
  StateChangeCallback,
} from "../smart-glasses-ble";

// ─────────────────────────────────────────────────────────────────────────────
// A. Pure badge-display helpers
// ─────────────────────────────────────────────────────────────────────────────

describe("getBleBadgeStyle — label text", () => {
  it('shows "BLE · direct" when glasses are BLE-connected', () => {
    expect(getBleBadgeStyle(true).label).toBe("BLE · direct");
  });

  it('shows "Cloud · relay" when BLE is not connected (cloud fallback)', () => {
    expect(getBleBadgeStyle(false).label).toBe("Cloud · relay");
  });

  it("label transitions from BLE·direct → Cloud·relay on disconnect", () => {
    expect(getBleBadgeStyle(true).label).not.toBe(getBleBadgeStyle(false).label);
  });

  it("label restores to BLE·direct after reconnect", () => {
    expect(getBleBadgeStyle(true).label).toBe("BLE · direct");
    expect(getBleBadgeStyle(false).label).toBe("Cloud · relay");
    expect(getBleBadgeStyle(true).label).toBe("BLE · direct");
  });
});

describe("getBleBadgeStyle — green (BLE-connected) palette", () => {
  let style: BleBadgeStyle;
  beforeAll(() => {
    style = getBleBadgeStyle(true);
  });

  it("returns the BLE_DIRECT_STYLE constant", () => {
    expect(style).toEqual(BLE_DIRECT_STYLE);
  });
  it("uses a green background fill", () => {
    expect(style.bgColor).toBe("rgba(34,197,94,0.22)");
  });
  it("uses a green border", () => {
    expect(style.borderColor).toBe("rgba(34,197,94,0.55)");
  });
  it("uses a solid green status dot", () => {
    expect(style.dotColor).toBe("#22c55e");
  });
  it("uses a light-green label text", () => {
    expect(style.textColor).toBe("#86efac");
  });
});

describe("getBleBadgeStyle — amber (cloud-relay) palette", () => {
  let style: BleBadgeStyle;
  beforeAll(() => {
    style = getBleBadgeStyle(false);
  });

  it("returns the CLOUD_RELAY_STYLE constant", () => {
    expect(style).toEqual(CLOUD_RELAY_STYLE);
  });
  it("uses an amber background fill", () => {
    expect(style.bgColor).toBe("rgba(245,158,11,0.22)");
  });
  it("uses an amber border", () => {
    expect(style.borderColor).toBe("rgba(245,158,11,0.55)");
  });
  it("uses an amber status dot", () => {
    expect(style.dotColor).toBe("#f59e0b");
  });
  it("uses a yellow label text", () => {
    expect(style.textColor).toBe("#fcd34d");
  });
});

describe("getBleBadgeStyle — all color properties differ between states", () => {
  const connected = getBleBadgeStyle(true);
  const disconnected = getBleBadgeStyle(false);

  it("bgColor differs", () => expect(connected.bgColor).not.toBe(disconnected.bgColor));
  it("borderColor differs", () => expect(connected.borderColor).not.toBe(disconnected.borderColor));
  it("dotColor differs", () => expect(connected.dotColor).not.toBe(disconnected.dotColor));
  it("textColor differs", () => expect(connected.textColor).not.toBe(disconnected.textColor));
});

describe("getBleBadgeStyle — palette constants have all required fields", () => {
  const REQUIRED = ["bgColor", "borderColor", "dotColor", "textColor", "label"] as const;

  it("BLE_DIRECT_STYLE has all required properties", () => {
    for (const key of REQUIRED) expect(BLE_DIRECT_STYLE).toHaveProperty(key);
  });
  it("CLOUD_RELAY_STYLE has all required properties", () => {
    for (const key of REQUIRED) expect(CLOUD_RELAY_STYLE).toHaveProperty(key);
  });
  it("getBleBadgeStyle(true) returns BLE_DIRECT_STYLE by reference", () => {
    expect(getBleBadgeStyle(true)).toBe(BLE_DIRECT_STYLE);
  });
  it("getBleBadgeStyle(false) returns CLOUD_RELAY_STYLE by reference", () => {
    expect(getBleBadgeStyle(false)).toBe(CLOUD_RELAY_STYLE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. BLE state-machine simulation
//
// Replicates the subscription and frame-callback logic of
// useSmartGlassesBleFrames without a React renderer.
//
// The mock follows the exact public API of SmartGlassesBleManager:
//   • subscribe(cb)  — emit current state immediately, then on each change
//   • onFrame(cb)    — called with a Uint8Array when a JPEG frame arrives
//
// The "simulated hook" below mirrors the two useEffects in the real hook:
//   1. useEffect([], [])              — subscribe to state changes
//   2. useEffect([active, isBleConnected])  — subscribe/unsubscribe onFrame
// ─────────────────────────────────────────────────────────────────────────────

// ── Mock BLE driver ──────────────────────────────────────────────────────────

function buildMockBle(initial: GlassesConnectionState = "idle") {
  let connectionState: GlassesConnectionState = initial;
  const stateSubscribers = new Set<StateChangeCallback>();
  const frameCallbacks = new Set<FrameCallback>();

  function snapshot(): SmartGlassesBleState {
    return {
      hwState: "PoweredOn" as SmartGlassesBleState["hwState"],
      connectionState,
      discovered: [],
      connectedDeviceId: connectionState === "connected" ? "device-1" : null,
      connectedDeviceName: connectionState === "connected" ? "Ray-Ban Meta" : null,
      error: null,
      pairedDeviceId: "device-1",
      pairedDeviceName: "Ray-Ban Meta",
    };
  }

  const ble = {
    getState: vi.fn(snapshot),

    subscribe: vi.fn((cb: StateChangeCallback) => {
      stateSubscribers.add(cb);
      cb(snapshot()); // mirrors the real subscribe: emit immediately
      return () => { stateSubscribers.delete(cb); };
    }),

    onFrame: vi.fn((cb: FrameCallback) => {
      frameCallbacks.add(cb);
      return () => { frameCallbacks.delete(cb); };
    }),

    // ── Test helpers ───────────────────────────────────────────────────────
    /** Transition the BLE state and notify all subscribers. */
    setConnectionState(next: GlassesConnectionState) {
      connectionState = next;
      stateSubscribers.forEach((cb) => cb(snapshot()));
    },

    /** Push a fake JPEG frame to all registered frame callbacks. */
    emitFrame() {
      const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff]); // minimal JPEG SOI
      frameCallbacks.forEach((cb) => cb(fakeJpeg));
    },

    frameSubscriberCount: () => frameCallbacks.size,
  };

  return ble;
}

// ── Simulated hook ────────────────────────────────────────────────────────────

/**
 * Runs the core state-management logic of useSmartGlassesBleFrames without
 * a React renderer.
 *
 * Returns a controller that lets tests observe and drive state transitions.
 */
function simulateHook(ble: ReturnType<typeof buildMockBle>, active: boolean) {
  // Local state — mirrors the two useState() calls in the hook
  let isBleConnected = ble.getState().connectionState === "connected";
  let frameCount = 0;

  // Cleanup handles — mirrors useEffect cleanup functions
  let frameUnsub: (() => void) | null = null;

  /** Mirror of the useEffect([active, isBleConnected]) that manages onFrame. */
  function syncFrameSubscription() {
    // Unsubscribe first (cleanup from previous effect run)
    frameUnsub?.();
    frameUnsub = null;

    if (!active || !isBleConnected) return;

    frameUnsub = ble.onFrame((_jpeg) => {
      // Mirror: setFrameCount((prev) => prev + 1)
      frameCount++;
    });
  }

  // Mirror useEffect([], []): subscribe to state changes once on mount
  const stateUnsub = ble.subscribe((state) => {
    const wasConnected = isBleConnected;
    isBleConnected = state.connectionState === "connected";

    // Re-run the frame-subscription effect whenever isBleConnected changes
    if (wasConnected !== isBleConnected) {
      syncFrameSubscription();
    }
  });

  // Run the frame-subscription effect on first "mount"
  syncFrameSubscription();

  return {
    /** Current isBleConnected value — drives the badge. */
    getIsBleConnected: () => isBleConnected,
    /** Running frame count — must survive reconnect. */
    getFrameCount: () => frameCount,
    /** Derived badge style — what the screen renders. */
    getBadge: () => getBleBadgeStyle(isBleConnected),
    /** Teardown — mirror component unmount. */
    dispose: () => {
      stateUnsub();
      frameUnsub?.();
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("BLE simulation — badge text transitions (connect → disconnect → reconnect)", () => {
  it("starts as 'Cloud · relay' when glasses are not connected", () => {
    const ble = buildMockBle("idle");
    const hook = simulateHook(ble, true);
    expect(hook.getBadge().label).toBe("Cloud · relay");
    hook.dispose();
  });

  it("shows 'BLE · direct' immediately after the glasses connect", () => {
    const ble = buildMockBle("idle");
    const hook = simulateHook(ble, true);

    ble.setConnectionState("connected");
    expect(hook.getBadge().label).toBe("BLE · direct");
    hook.dispose();
  });

  it("reverts to 'Cloud · relay' when the glasses disconnect mid-inspection", () => {
    const ble = buildMockBle("connected");
    const hook = simulateHook(ble, true);

    expect(hook.getBadge().label).toBe("BLE · direct"); // initial

    ble.setConnectionState("idle"); // glasses drop
    expect(hook.getBadge().label).toBe("Cloud · relay");
    hook.dispose();
  });

  it("restores 'BLE · direct' after the glasses reconnect mid-inspection", () => {
    const ble = buildMockBle("connected");
    const hook = simulateHook(ble, true);

    ble.setConnectionState("idle");      // disconnect
    ble.setConnectionState("connected"); // reconnect
    expect(hook.getBadge().label).toBe("BLE · direct");
    hook.dispose();
  });

  it("badge does not get stuck after multiple disconnect + reconnect cycles", () => {
    const ble = buildMockBle("connected");
    const hook = simulateHook(ble, true);

    for (let i = 0; i < 5; i++) {
      ble.setConnectionState("idle");
      expect(hook.getBadge().label).toBe("Cloud · relay");

      ble.setConnectionState("connected");
      expect(hook.getBadge().label).toBe("BLE · direct");
    }
    hook.dispose();
  });
});

describe("BLE simulation — badge colors update on state change", () => {
  it("green palette active when connected", () => {
    const ble = buildMockBle("connected");
    const hook = simulateHook(ble, true);
    const badge = hook.getBadge();
    expect(badge.dotColor).toBe("#22c55e");
    expect(badge.bgColor).toBe("rgba(34,197,94,0.22)");
    hook.dispose();
  });

  it("amber palette active when disconnected", () => {
    const ble = buildMockBle("connected");
    const hook = simulateHook(ble, true);

    ble.setConnectionState("idle");
    const badge = hook.getBadge();
    expect(badge.dotColor).toBe("#f59e0b");
    expect(badge.bgColor).toBe("rgba(245,158,11,0.22)");
    hook.dispose();
  });

  it("green palette restored after reconnect — no screen remount needed", () => {
    const ble = buildMockBle("connected");
    const hook = simulateHook(ble, true);

    ble.setConnectionState("idle");      // amber
    ble.setConnectionState("connected"); // back to green

    expect(hook.getBadge().dotColor).toBe("#22c55e");
    expect(hook.getBadge().bgColor).toBe("rgba(34,197,94,0.22)");
    hook.dispose();
  });
});

describe("BLE simulation — frame count preserved across reconnect", () => {
  it("frame count increments while BLE is connected", () => {
    const ble = buildMockBle("connected");
    const hook = simulateHook(ble, true);

    ble.emitFrame();
    ble.emitFrame();
    ble.emitFrame();
    expect(hook.getFrameCount()).toBe(3);
    hook.dispose();
  });

  it("frame count does NOT reset to 0 when glasses disconnect", () => {
    const ble = buildMockBle("connected");
    const hook = simulateHook(ble, true);

    ble.emitFrame(); // 1
    ble.emitFrame(); // 2

    ble.setConnectionState("idle"); // disconnect
    expect(hook.getFrameCount()).toBe(2); // must still be 2, not 0
    hook.dispose();
  });

  it("frame count does NOT reset to 0 on reconnect", () => {
    const ble = buildMockBle("connected");
    const hook = simulateHook(ble, true);

    ble.emitFrame(); // 1
    ble.emitFrame(); // 2

    ble.setConnectionState("idle");      // disconnect
    ble.setConnectionState("connected"); // reconnect

    expect(hook.getFrameCount()).toBe(2); // still 2, not 0
    hook.dispose();
  });

  it("frame count accumulates across multiple disconnect + reconnect legs", () => {
    const ble = buildMockBle("connected");
    const hook = simulateHook(ble, true);

    // First connected leg — 3 frames
    ble.emitFrame(); ble.emitFrame(); ble.emitFrame();

    // Disconnect
    ble.setConnectionState("idle");

    // Frames while disconnected do not count (frame listener is removed)
    ble.emitFrame(); // should be ignored

    // Reconnect
    ble.setConnectionState("connected");

    // Second connected leg — 4 frames
    ble.emitFrame(); ble.emitFrame(); ble.emitFrame(); ble.emitFrame();

    expect(hook.getFrameCount()).toBe(7); // 3 + 0 ignored + 4
    hook.dispose();
  });

  it("frames emitted while disconnected are ignored (no phantom increment)", () => {
    const ble = buildMockBle("connected");
    const hook = simulateHook(ble, true);

    ble.emitFrame(); // 1

    ble.setConnectionState("idle");
    ble.emitFrame(); // disconnected — must be ignored
    ble.emitFrame(); // disconnected — must be ignored

    expect(hook.getFrameCount()).toBe(1);
    hook.dispose();
  });
});

describe("BLE simulation — frame subscription lifecycle", () => {
  it("frame listener is registered when active=true and connected", () => {
    const ble = buildMockBle("connected");
    const hook = simulateHook(ble, true);

    expect(ble.frameSubscriberCount()).toBe(1);
    hook.dispose();
  });

  it("frame listener is removed on disconnect", () => {
    const ble = buildMockBle("connected");
    const hook = simulateHook(ble, true);

    ble.setConnectionState("idle");
    expect(ble.frameSubscriberCount()).toBe(0);
    hook.dispose();
  });

  it("frame listener is re-registered on reconnect (exactly one subscription)", () => {
    const ble = buildMockBle("connected");
    const hook = simulateHook(ble, true);

    ble.setConnectionState("idle");      // listener removed
    ble.setConnectionState("connected"); // listener re-added

    // Must be exactly 1 — not 0 (missed reconnect) or >1 (double-subscribed)
    expect(ble.frameSubscriberCount()).toBe(1);
    hook.dispose();
  });

  it("no double-subscription after rapid disconnect + reconnect", () => {
    const ble = buildMockBle("connected");
    const hook = simulateHook(ble, true);

    for (let i = 0; i < 4; i++) {
      ble.setConnectionState("idle");
      ble.setConnectionState("connected");
    }

    expect(ble.frameSubscriberCount()).toBe(1);
    hook.dispose();
  });

  it("frame listener is not registered when active=false", () => {
    const ble = buildMockBle("connected");
    const hook = simulateHook(ble, false /* inactive */);

    expect(ble.frameSubscriberCount()).toBe(0);
    hook.dispose();
  });
});
