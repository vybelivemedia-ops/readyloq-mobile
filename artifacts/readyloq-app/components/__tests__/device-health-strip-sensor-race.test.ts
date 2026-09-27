// @vitest-environment jsdom
/**
 * Tests — DeviceHealthStrip sensor chip visibility during a live inspection
 * (task #908: "Confirm sensor status chips reappear immediately once a
 * peripheral connects mid-inspection").
 *
 * BLE sensor providers (Protimeter/moisture, Bosch GLM/distance,
 * temperature+humidity, CO2, acoustic) are registered at app startup in a
 * disconnected state and only pair on demand from the Connections tab /
 * DeviceScannerModal while an inspection is already in progress. The
 * `useActiveOnlySlots` hook in DeviceHealthStrip.tsx is what decides whether
 * a chip is visible, driven by "device.connected" / "device.disconnected"
 * events plus an initial `getStatus()` probe per provider.
 *
 * Covers:
 *  1. A sensor connected mid-session (event fired after mount) becomes
 *     visible without waiting for a remount or poll — the core behavior the
 *     capture screen relies on (portrait + landscape both mount the same
 *     component/hook, so this is layout-agnostic).
 *  2. Disconnecting hides the chip again.
 *  3. Two sensors are tracked independently — connecting one never surfaces
 *     or hides another that hasn't changed state.
 *  4. Race regression: if the mount-time `getStatus()` probe resolves AFTER
 *     a "device.connected" event's own `getStatus()` call (e.g. a slower
 *     provider, or events firing back-to-back), the stale/older response
 *     must never clobber the fresher one — the chip must end up reflecting
 *     the LATEST known state, not whichever async call happened to resolve
 *     last.
 *  5. Unsubscription on unmount — no state update (and no act() warning)
 *     fires after the hook has torn down, matching the portrait/landscape
 *     remount that happens on device rotation.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  Text: () => null,
  View: () => null,
}));

vi.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

// DeviceHealthStrip.tsx also imports useDeviceRegistry (which transitively
// pulls in the DevicePlugin and every concrete hardware provider — expo-camera,
// ble-plx, etc.). useActiveOnlySlots itself never calls it; stub it out so this
// suite only exercises the hook's own event/state logic.
vi.mock("@/lib/platform/DeviceRegistryContext", () => ({
  useDeviceRegistry: () => {
    throw new Error("not used by useActiveOnlySlots");
  },
}));

import { useActiveOnlySlots } from "../DeviceHealthStrip";

// ─────────────────────────────────────────────────────────────────────────────
// Mock DeviceProvider — minimal, controllable implementation of the
// @platform/device-core DeviceProvider contract used by useActiveOnlySlots.
// ─────────────────────────────────────────────────────────────────────────────

type ConnectionState = "connected" | "disconnected" | "error";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeMockProvider(id: string, name: string) {
  const listeners: Record<string, Array<() => void>> = {
    "device.connected": [],
    "device.disconnected": [],
  };
  let state: ConnectionState = "disconnected";
  // When set, the next getStatus() call returns this deferred instead of
  // resolving immediately — lets a test control resolution order explicitly.
  let pendingStatus: Deferred<{ connection: { state: ConnectionState } }> | null = null;

  const provider = {
    id,
    name,
    capabilities: { tokens: [] as string[] },
    on(event: "device.connected" | "device.disconnected", listener: () => void) {
      listeners[event].push(listener);
      return () => {
        listeners[event] = listeners[event].filter((l) => l !== listener);
      };
    },
    async getStatus() {
      if (pendingStatus) {
        const d = pendingStatus;
        pendingStatus = null;
        return d.promise;
      }
      return { operational: "idle", connection: { state } } as any;
    },
    // Test helpers (not part of the real DeviceProvider contract) ------------
    __setState(next: ConnectionState) {
      state = next;
    },
    __emitConnected() {
      state = "connected";
      listeners["device.connected"].forEach((l) => l());
    },
    __emitDisconnected() {
      state = "disconnected";
      listeners["device.disconnected"].forEach((l) => l());
    },
    /** Makes the NEXT getStatus() call hang until the returned resolve() is called. */
    __armDeferredStatus(): (result: { connection: { state: ConnectionState } }) => void {
      const d = defer<{ connection: { state: ConnectionState } }>();
      pendingStatus = d;
      return d.resolve;
    },
  };

  return provider;
}

const iconFor = () => "hardware-chip-outline" as const;

/** Flush pending microtasks (promise resolutions + the resulting setState). */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("useActiveOnlySlots — sensor chip appears/disappears with connection events", () => {
  it("stays empty for a disconnected sensor at mount (no clutter before pairing)", async () => {
    const moisture = makeMockProvider("moisture", "Protimeter");
    // Providers array is hoisted with a stable reference, mirroring the real
    // `sensors` list (memoized on `registry` in DeviceHealthStrip) — a fresh
    // array literal on every render would retrigger the effect forever.
    const providers = [moisture as any];
    const { result } = renderHook(() => useActiveOnlySlots(providers, iconFor));

    await flush();

    expect(result.current).toHaveLength(0);
  });

  it("shows the chip promptly once the sensor connects mid-inspection", async () => {
    const moisture = makeMockProvider("moisture", "Protimeter");
    const providers = [moisture as any];
    const { result } = renderHook(() => useActiveOnlySlots(providers, iconFor));

    await flush();
    expect(result.current).toHaveLength(0);

    // Simulate pairing from the Connections tab / DeviceScannerModal while
    // the capture screen (and this hook) is already mounted.
    act(() => {
      moisture.__emitConnected();
    });
    await flush();

    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({ id: "moisture", name: "Protimeter", status: "healthy" });
  });

  it("shows an already-connected sensor immediately on mount — covers the portrait/landscape remount on rotation", async () => {
    // Portrait and landscape render DeviceHealthStrip in two separate JSX
    // branches in new-inspection.tsx, so rotating the device unmounts one and
    // mounts the other fresh. A sensor connected before the rotation must
    // show up immediately in the new layout without waiting for another
    // "device.connected" event, since none fires on a pure remount.
    const moisture = makeMockProvider("moisture", "Protimeter");
    moisture.__setState("connected");
    const providers = [moisture as any];

    const { result } = renderHook(() => useActiveOnlySlots(providers, iconFor));
    await flush();

    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({ id: "moisture", status: "healthy" });
  });

  it("hides the chip again promptly on disconnect", async () => {
    const laser = makeMockProvider("laser", "Bosch GLM");
    const providers = [laser as any];
    const { result } = renderHook(() => useActiveOnlySlots(providers, iconFor));

    await flush();
    act(() => laser.__emitConnected());
    await flush();
    expect(result.current).toHaveLength(1);

    act(() => laser.__emitDisconnected());
    await flush();

    expect(result.current).toHaveLength(0);
  });

  it("tracks multiple sensors independently — connecting one doesn't affect another", async () => {
    const moisture = makeMockProvider("moisture", "Protimeter");
    const co2 = makeMockProvider("co2", "CO2 Sensor");
    const providers = [moisture as any, co2 as any];
    const { result } = renderHook(() => useActiveOnlySlots(providers, iconFor));

    await flush();
    expect(result.current).toHaveLength(0);

    act(() => moisture.__emitConnected());
    await flush();

    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe("moisture");

    act(() => co2.__emitConnected());
    await flush();

    expect(result.current.map((s) => s.id).sort()).toEqual(["co2", "moisture"]);

    act(() => moisture.__emitDisconnected());
    await flush();

    expect(result.current.map((s) => s.id)).toEqual(["co2"]);
  });

  // ── Race regression ─────────────────────────────────────────────────────

  it("does not let a stale mount-time getStatus() resolution clobber a fresher connected event", async () => {
    const moisture = makeMockProvider("moisture", "Protimeter");
    const providers = [moisture as any];

    // Arm the FIRST getStatus() call (the mount-time probe) to hang.
    const resolveMountProbe = moisture.__armDeferredStatus();

    const { result } = renderHook(() => useActiveOnlySlots(providers, iconFor));

    // The mount-time probe is now in flight but unresolved. Before it
    // resolves, the sensor connects mid-inspection — this issues a SECOND
    // getStatus() call (from the "device.connected" listener), which
    // resolves immediately with connected state.
    act(() => {
      moisture.__emitConnected();
    });
    await flush();

    // The connected event's own getStatus() call already resolved and
    // reported the chip.
    expect(result.current).toHaveLength(1);

    // Now the STALE mount-time probe finally resolves, reporting the OLD
    // (disconnected) state it captured before the connection happened.
    act(() => {
      resolveMountProbe({ connection: { state: "disconnected" } });
    });
    await flush();

    // The stale response must not un-render the chip — the sequence guard
    // must have discarded it because a newer request had already landed.
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({ id: "moisture", status: "healthy" });
  });

  it("does not let a stale disconnect resolution resurrect a chip after a fresher connect", async () => {
    const moisture = makeMockProvider("moisture", "Protimeter");
    const providers = [moisture as any];
    const { result } = renderHook(() => useActiveOnlySlots(providers, iconFor));
    await flush();

    // Arm the disconnect-triggered getStatus() call to hang.
    const resolveDisconnectProbe = moisture.__armDeferredStatus();
    act(() => moisture.__emitDisconnected());

    // Before that probe resolves, a fresh connect event fires and its own
    // getStatus() call resolves immediately.
    act(() => moisture.__emitConnected());
    await flush();

    expect(result.current).toHaveLength(1);

    // The stale disconnect probe now resolves.
    act(() => {
      resolveDisconnectProbe({ connection: { state: "disconnected" } });
    });
    await flush();

    // Must still show connected — the later request wins regardless of
    // resolution order.
    expect(result.current).toHaveLength(1);
    expect(result.current[0].status).toBe("healthy");
  });

  it("stops updating state after unmount (no stale update after teardown, e.g. on orientation flip)", async () => {
    const moisture = makeMockProvider("moisture", "Protimeter");
    const providers = [moisture as any];
    const resolveProbe = moisture.__armDeferredStatus();

    const { result, unmount } = renderHook(() => useActiveOnlySlots(providers, iconFor));

    unmount();

    // Resolve the in-flight probe after teardown — must not throw or warn,
    // and must not be observable (there's nothing left to observe, but the
    // resolve call itself must be safe).
    await act(async () => {
      resolveProbe({ connection: { state: "connected" } });
      await Promise.resolve();
    });

    // result.current still reflects the last rendered value pre-unmount.
    expect(result.current).toHaveLength(0);
  });
});
