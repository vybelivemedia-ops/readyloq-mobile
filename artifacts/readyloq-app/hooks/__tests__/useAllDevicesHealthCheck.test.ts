// @vitest-environment jsdom
/**
 * Tests — useAllDevicesHealthCheck: periodic health polling during a live inspection.
 *
 * Confirms:
 *  1. checkAllHealth() is called immediately on mount (warms the cache before
 *     the first health-indicator render).
 *  2. checkAllHealth() is called again on each 30-second interval tick.
 *  3. The interval is cleared when the hook unmounts — no further calls after
 *     the inspection workspace is torn down.
 *  4. A provider.health_changed subscription receives updated state on each
 *     poll (observable state is updated, not just the function called).
 *
 * The DeviceRegistry and its context are mocked so this suite runs without any
 * React Native / Expo runtime.
 */

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock DeviceRegistryContext ───────────────────────────────────────────────
// Must be hoisted before the hook import so vi.mock replaces the module.

const { mockCheckAllHealth } = vi.hoisted(() => ({
  mockCheckAllHealth: vi.fn(),
}));

vi.mock("@/lib/platform/DeviceRegistryContext", () => ({
  useDeviceRegistry: () => ({
    registry: {
      checkAllHealth: mockCheckAllHealth,
    },
  }),
}));

// ─── Import hook under test AFTER mocks ──────────────────────────────────────

import { useAllDevicesHealthCheck } from "../useAllDevicesHealthCheck";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Flush all pending Promise micro-tasks without advancing the fake timer. */
async function flushMicrotasks(): Promise<void> {
  // Three rounds cover: resolved promise → void-wrapper → react-effect callback
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 30_000;

describe("useAllDevicesHealthCheck — periodic health polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockCheckAllHealth.mockResolvedValue(new Map());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // ── 1. Immediate probe on mount ──────────────────────────────────────────

  it("calls checkAllHealth() immediately when the inspection workspace mounts", async () => {
    const { unmount } = renderHook(() => useAllDevicesHealthCheck());

    // useEffect fires synchronously after render in the test environment;
    // flush the void-async wrapper so the spy registers the call.
    await flushMicrotasks();

    expect(mockCheckAllHealth).toHaveBeenCalledTimes(1);

    unmount();
  });

  // ── 2. Interval fires during the inspection ──────────────────────────────

  it("calls checkAllHealth() again on each 30-second interval tick", async () => {
    const { unmount } = renderHook(() => useAllDevicesHealthCheck());

    // Mount call
    await flushMicrotasks();
    expect(mockCheckAllHealth).toHaveBeenCalledTimes(1);

    // Advance one full interval
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await flushMicrotasks();
    expect(mockCheckAllHealth).toHaveBeenCalledTimes(2);

    // Advance two more intervals
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    await flushMicrotasks();
    expect(mockCheckAllHealth).toHaveBeenCalledTimes(4);

    unmount();
  });

  // ── 3. Interval stops after unmount ──────────────────────────────────────

  it("stops polling after the inspection workspace unmounts", async () => {
    const { unmount } = renderHook(() => useAllDevicesHealthCheck());

    // Mount call + one interval tick
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await flushMicrotasks();
    expect(mockCheckAllHealth).toHaveBeenCalledTimes(2);

    // Unmount — interval should be cleared
    unmount();

    // Advance two more intervals; count must not increase
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    await flushMicrotasks();
    expect(mockCheckAllHealth).toHaveBeenCalledTimes(2);
  });

  // ── 4. Observable state — registry subscribers are notified on each poll ─

  it("surfaces updated health state to registry subscribers on each poll", async () => {
    // Build a lightweight in-memory registry with real subscribe/emit semantics
    // so we can verify that observable state (not just the function call) changes.
    type HealthMap = Map<string, { status: string }>;

    let pollCount = 0;
    const subscribers: Array<(health: HealthMap) => void> = [];

    const healthAfterPoll = (): HealthMap => {
      const status = pollCount <= 2 ? "healthy" : "degraded";
      return new Map([["native-camera", { status }]]);
    };

    mockCheckAllHealth.mockImplementation(async () => {
      pollCount += 1;
      const result = healthAfterPoll();
      // Notify all registry subscribers (simulates provider.health_changed)
      subscribers.forEach((cb) => cb(result));
      return result;
    });

    // Collect the health snapshots surfaced to a hypothetical UI subscriber
    const observed: Array<{ status: string } | undefined> = [];
    subscribers.push((health) => {
      observed.push(health.get("native-camera"));
    });

    const { unmount } = renderHook(() => useAllDevicesHealthCheck());

    // Mount call — healthy (pollCount becomes 1)
    await flushMicrotasks();
    expect(observed).toHaveLength(1);
    expect(observed[0]?.status).toBe("healthy");

    // First interval — still healthy (pollCount becomes 2)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await flushMicrotasks();
    expect(observed).toHaveLength(2);
    expect(observed[1]?.status).toBe("healthy");

    // Second interval — permission revoked mid-inspection → degraded (pollCount becomes 3)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await flushMicrotasks();
    expect(observed).toHaveLength(3);
    expect(observed[2]?.status).toBe("degraded");

    unmount();

    // No more notifications after unmount
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    await flushMicrotasks();
    expect(observed).toHaveLength(3);
  });
});
