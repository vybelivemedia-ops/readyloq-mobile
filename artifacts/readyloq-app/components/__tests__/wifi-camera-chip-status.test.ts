// @vitest-environment jsdom
/**
 * Tests — DeviceHealthStrip's statusFromDeviceStatus() mapping for the Wi-Fi
 * camera chip (task #909: "Fix the Wi-Fi camera chip showing a healthy dot
 * when it's only reachable, not connected").
 *
 * wifi-camera-provider.ts's getStatus() used to report connection.state:
 * "connected" whenever the camera endpoint merely responded to an HTTP probe,
 * even if the provider had never been connect()-ed (or had since been
 * disconnect()-ed). statusFromDeviceStatus() only inspects connection.state,
 * so that shape rendered a green "healthy" chip for a camera that wasn't
 * actually in use. The provider fix (see camera-health.test.ts) now reports
 * "disconnected" for that reachable-but-idle case; these tests guard the
 * DeviceHealthStrip side of the contract so the two can't silently drift back
 * out of sync.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  Text: () => null,
  View: () => null,
}));

vi.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

vi.mock("@/lib/platform/DeviceRegistryContext", () => ({
  useDeviceRegistry: () => {
    throw new Error("not used by statusFromDeviceStatus");
  },
}));

import { statusFromDeviceStatus } from "../DeviceHealthStrip";
import type { DeviceStatus } from "@platform/device-core";

describe("statusFromDeviceStatus — Wi-Fi camera reachable-vs-connected accuracy", () => {
  it("is NOT healthy for a reachable-but-never-connected camera (operational: unavailable, connection: disconnected)", () => {
    const status = {
      operational: "unavailable",
      connection: { state: "disconnected", transport: "wifi" },
      lastSeenAt: new Date().toISOString(),
    } as DeviceStatus;

    expect(statusFromDeviceStatus(status)).not.toBe("healthy");
  });

  it("is healthy once the camera is actually connected (operational: idle, connection: connected)", () => {
    const status = {
      operational: "idle",
      connection: { state: "connected", transport: "wifi" },
      lastSeenAt: new Date().toISOString(),
    } as DeviceStatus;

    expect(statusFromDeviceStatus(status)).toBe("healthy");
  });

  it("is degraded (not healthy) when the camera is fully unreachable", () => {
    const status = {
      operational: "error",
      connection: { state: "error", transport: "wifi", error: "unreachable" },
      lastSeenAt: new Date().toISOString(),
    } as DeviceStatus;

    expect(statusFromDeviceStatus(status)).not.toBe("healthy");
    expect(statusFromDeviceStatus(status)).toBe("degraded");
  });
});
