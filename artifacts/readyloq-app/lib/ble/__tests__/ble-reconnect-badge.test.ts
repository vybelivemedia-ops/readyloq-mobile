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
 * Task #544 requirements:
 *   ✓ Badge text flips BLE·direct → Cloud·relay → BLE·direct mid-inspection
 *   ✓ Badge colors (bg, border, dot, text) update on every transition
 *   ✓ BLE frame count preserved across reconnect (no reset to 0)
 */

import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  BLE_DIRECT_STYLE,
  CLOUD_RELAY_STYLE,
  getBleBadgeStyle,
  shouldShowBleBadge,
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

// ─────────────────────────────────────────────────────────────────────────────
// C. Badge state when glasses disconnect with frames already received
//
// These tests cover the case where the glasses have been actively used during
// the inspection (bleFrameCount > 0) and then lose their BLE link mid-session.
// The badge should switch to Cloud·relay (amber) — not disappear — because the
// session is still live via cloud relay.
// ─────────────────────────────────────────────────────────────────────────────

describe("badge transitions to Cloud·relay when glasses disconnect with bleFrameCount > 0", () => {
  it("badge shows 'BLE · direct' while connected and frames have been received", () => {
    const ble = buildMockBle("connected");
    const hook = simulateHook(ble, true);

    // Receive some frames while connected
    ble.emitFrame();
    ble.emitFrame();

    expect(hook.getBadge().label).toBe("BLE · direct");
    expect(hook.getBadge().dotColor).toBe("#22c55e"); // green
    hook.dispose();
  });

  it("badge label switches to 'Cloud · relay' on disconnect when bleFrameCount > 0", () => {
    const ble = buildMockBle("connected");
    const hook = simulateHook(ble, true);

    // Frames received before disconnect
    ble.emitFrame();
    ble.emitFrame();
    ble.emitFrame();
    expect(hook.getFrameCount()).toBe(3); // frames were accumulated

    // Glasses drop their BLE link mid-inspection
    ble.setConnectionState("idle");

    expect(hook.getBadge().label).toBe("Cloud · relay");
    hook.dispose();
  });

  it("badge dot switches to amber on disconnect when bleFrameCount > 0", () => {
    const ble = buildMockBle("connected");
    const hook = simulateHook(ble, true);

    ble.emitFrame();
    ble.setConnectionState("idle");

    expect(hook.getBadge().dotColor).toBe("#f59e0b"); // amber
    expect(hook.getBadge().bgColor).toBe("rgba(245,158,11,0.22)");
    hook.dispose();
  });

  it("badge style equals CLOUD_RELAY_STYLE exactly on disconnect with frames", () => {
    const ble = buildMockBle("connected");
    const hook = simulateHook(ble, true);

    ble.emitFrame();
    ble.setConnectionState("idle");

    expect(hook.getBadge()).toEqual(CLOUD_RELAY_STYLE);
    hook.dispose();
  });

  it("badge restores to 'BLE · direct' (green) when glasses reconnect after a mid-inspection drop", () => {
    const ble = buildMockBle("connected");
    const hook = simulateHook(ble, true);

    ble.emitFrame();
    ble.emitFrame();

    ble.setConnectionState("idle");      // drop — badge goes amber
    ble.setConnectionState("connected"); // reconnect — badge should go green

    expect(hook.getBadge().label).toBe("BLE · direct");
    expect(hook.getBadge().dotColor).toBe("#22c55e");
    hook.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. shouldShowBleBadge — badge visibility helper
//
// The badge is omitted from the HUD header when glasses have never been part
// of the session (isBleConnected=false AND bleFrameCount=0).  This prevents a
// spurious "Cloud · relay" badge from appearing for technicians who are not
// using smart glasses at all.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// E. CoPilotHUD badge rendering simulation
//
// Mirrors the exact rendering decision made in CoPilotHUD.tsx:
//
//   const visible = glassesSessionActive || shouldShowBleBadge(isBleConnected, bleFrameCount)
//   const badge   = getBleBadgeStyle(isBleConnected)
//
// Drives the BLE state-machine through connect → receive frames → disconnect →
// reconnect and asserts that:
//   • the badge is visible whenever it should be (no premature disappearance)
//   • the badge label/colors match the current connection mode
//
// This confirms that the component props (isBleConnected, bleFrameCount) that
// flow into the real CoPilotHUD produce the correct rendered output at every
// step of a mid-inspection reconnect.
// ─────────────────────────────────────────────────────────────────────────────

/** Mirrors the CoPilotHUD badge rendering logic exactly. */
function hudBadgeState(
  isBleConnected: boolean,
  bleFrameCount: number,
  glassesSessionActive: boolean,
) {
  const visible = glassesSessionActive || shouldShowBleBadge(isBleConnected, bleFrameCount);
  const badge = getBleBadgeStyle(isBleConnected);
  return { visible, badge };
}

describe("CoPilotHUD badge rendering simulation — full reconnect lifecycle", () => {
  it("badge is hidden before glasses connect (no session, no frames)", () => {
    const { visible } = hudBadgeState(false, 0, false);
    expect(visible).toBe(false);
  });

  it("badge appears as 'BLE · direct' (green) when glasses first connect", () => {
    const { visible, badge } = hudBadgeState(true, 0, false);
    expect(visible).toBe(true);
    expect(badge.label).toBe("BLE · direct");
    expect(badge.dotColor).toBe("#22c55e");
  });

  it("badge is still 'BLE · direct' (green) while connected and frames are flowing", () => {
    // bleFrameCount > 0, isBleConnected true
    const { visible, badge } = hudBadgeState(true, 12, false);
    expect(visible).toBe(true);
    expect(badge.label).toBe("BLE · direct");
  });

  it("badge stays visible as 'Cloud · relay' (amber) immediately after glasses disconnect with frames > 0", () => {
    // This is the critical regression check:
    // isBleConnected goes false but bleFrameCount is still > 0 → badge must NOT disappear
    const { visible, badge } = hudBadgeState(false, 12, false);
    expect(visible).toBe(true);
    expect(badge.label).toBe("Cloud · relay");
    expect(badge.dotColor).toBe("#f59e0b"); // amber
  });

  it("badge uses CLOUD_RELAY_STYLE exactly when disconnected mid-inspection", () => {
    const { badge } = hudBadgeState(false, 5, false);
    expect(badge).toEqual(CLOUD_RELAY_STYLE);
  });

  it("badge restores to 'BLE · direct' (green) when glasses reconnect mid-inspection", () => {
    // After reconnect: isBleConnected true, frameCount still > 0 from before
    const { visible, badge } = hudBadgeState(true, 12, false);
    expect(visible).toBe(true);
    expect(badge.label).toBe("BLE · direct");
    expect(badge.dotColor).toBe("#22c55e"); // green restored
  });

  it("badge hidden → BLE direct → Cloud relay → BLE direct: full mid-inspection reconnect sequence", () => {
    // Step 1: no glasses yet
    expect(hudBadgeState(false, 0, false).visible).toBe(false);

    // Step 2: glasses connect (no frames yet)
    expect(hudBadgeState(true, 0, false).badge.label).toBe("BLE · direct");

    // Step 3: frames flowing
    expect(hudBadgeState(true, 5, false).badge.label).toBe("BLE · direct");

    // Step 4: glasses drop mid-inspection
    const afterDrop = hudBadgeState(false, 5, false);
    expect(afterDrop.visible).toBe(true);         // badge stays visible
    expect(afterDrop.badge.label).toBe("Cloud · relay"); // amber fallback

    // Step 5: glasses reconnect
    const afterReconnect = hudBadgeState(true, 5, false);
    expect(afterReconnect.visible).toBe(true);
    expect(afterReconnect.badge.label).toBe("BLE · direct"); // green restored
  });

  it("badge is visible via glassesSessionActive even when shouldShowBleBadge would return false", () => {
    // Cloud-relay session active, but no BLE frames (e.g. Meta glasses cloud-only path)
    const { visible, badge } = hudBadgeState(false, 0, true /* glassesSessionActive */);
    expect(visible).toBe(true);
    expect(badge.label).toBe("Cloud · relay");
  });

  it("badge style equals BLE_DIRECT_STYLE by reference when connected", () => {
    const { badge } = hudBadgeState(true, 3, false);
    expect(badge).toBe(BLE_DIRECT_STYLE);
  });

  it("badge style equals CLOUD_RELAY_STYLE by reference when disconnected with frames", () => {
    const { badge } = hudBadgeState(false, 3, false);
    expect(badge).toBe(CLOUD_RELAY_STYLE);
  });
});

describe("shouldShowBleBadge — badge hidden when no glasses session is active", () => {
  it("returns false when not BLE-connected and no frames received (no glasses)", () => {
    expect(shouldShowBleBadge(false, 0)).toBe(false);
  });

  it("returns true when BLE-connected even with 0 frames (just paired)", () => {
    expect(shouldShowBleBadge(true, 0)).toBe(true);
  });

  it("returns true when not BLE-connected but frames were received (cloud relay)", () => {
    expect(shouldShowBleBadge(false, 1)).toBe(true);
  });

  it("returns true when BLE-connected and frames have been received", () => {
    expect(shouldShowBleBadge(true, 5)).toBe(true);
  });

  it("returns false only at the exact (false, 0) boundary — false for zero frames disconnected", () => {
    expect(shouldShowBleBadge(false, 0)).toBe(false);
    expect(shouldShowBleBadge(false, 1)).toBe(true); // one frame tips it over
  });

  it("badge stays visible (cloud-relay style) after disconnect when frames > 0", () => {
    // Simulate: was BLE-connected, received frames, now disconnected
    const visible = shouldShowBleBadge(false, 10);
    const badge = getBleBadgeStyle(false); // badge style for disconnected state

    expect(visible).toBe(true);
    expect(badge.label).toBe("Cloud · relay");
    expect(badge.dotColor).toBe("#f59e0b");
  });
});
