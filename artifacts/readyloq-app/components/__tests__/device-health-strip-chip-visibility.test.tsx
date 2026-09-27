// @vitest-environment jsdom
/**
 * Tests — DeviceHealthStrip chip visibility rules (task #910: "Lock in when
 * camera and sensor health chips are allowed to appear in the viewfinder").
 *
 * DeviceHealthStrip bundles several distinct visibility rules that must not
 * silently regress:
 *
 *  1. BLE/peripheral sensors (Protimeter, Bosch GLM, temp/humidity, CO2,
 *     acoustic) are ALWAYS registered at startup but start disconnected — a
 *     chip only appears once the sensor is actually connected/paired (or
 *     erroring). An idle, registered-but-disconnected sensor must render
 *     nothing.
 *  2. The "media-import" camera provider is always registered and always
 *     reachable, so its chip is suppressed while photo-library access is
 *     healthy and only appears once actionable (permission missing or a
 *     health-check error) — there's already a dedicated Import button
 *     elsewhere, so a normal healthy state should never clutter the strip.
 *  3. Other camera providers (e.g. Wi-Fi camera) are registered lazily, only
 *     once the user has configured them. Once present in the registry their
 *     chip shows unconditionally (no health/connection gate like sensors),
 *     since the registration itself is the meaningful signal.
 *
 * This suite renders the real <DeviceHealthStrip /> component end-to-end
 * against a fake DeviceRegistry so a future change to any of these rules
 * (e.g. media-import clutter creeping back in, or a sensor chip appearing
 * before pairing) fails a test instead of silently shipping.
 */

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
  // Rendered as real DOM elements (not stubbed to null) so chip content is
  // queryable via testing-library's screen.getByText / queryByText.
  Text: ({ children }: { children?: React.ReactNode }) => children,
  View: ({ children }: { children?: React.ReactNode }) => children,
}));

vi.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Fake registry + provider stubs
// ─────────────────────────────────────────────────────────────────────────────

type Category = "camera" | "sensor";

function makeCameraProvider(opts: {
  id: string;
  name: string;
  connectionState: "connected" | "disconnected" | "error";
}) {
  return {
    id: opts.id,
    name: opts.name,
    category: "camera" as Category,
    capabilities: { tokens: [] as string[] },
    on: vi.fn(() => () => {}),
    getStatus: vi.fn().mockResolvedValue({
      operational: opts.connectionState === "connected" ? "idle" : "unavailable",
      connection: { state: opts.connectionState, transport: "wifi" },
      lastSeenAt: new Date().toISOString(),
    }),
  };
}

function makeMediaImportProvider(healthStatus: "healthy" | "degraded" | "unhealthy") {
  return {
    id: "media-import",
    name: "Import from device",
    category: "camera" as Category,
    capabilities: { tokens: [] as string[] },
    on: vi.fn(() => () => {}),
    getStatus: vi.fn().mockResolvedValue({
      operational: "idle",
      connection: { state: "connected", transport: "internal" },
      lastSeenAt: new Date().toISOString(),
    }),
    checkHealth: vi.fn().mockResolvedValue({
      status: healthStatus,
      message: healthStatus === "healthy" ? "Photo library access granted" : "Photo library permission not yet granted",
      checkedAt: new Date().toISOString(),
      latencyMs: 1,
    }),
  };
}

function makeSensorProvider(opts: {
  id: string;
  name: string;
  connectionState: "connected" | "disconnected" | "error";
}) {
  return {
    id: opts.id,
    name: opts.name,
    category: "sensor" as Category,
    capabilities: { tokens: [] as string[] },
    on: vi.fn(() => () => {}),
    getStatus: vi.fn().mockResolvedValue({
      operational: opts.connectionState === "connected" ? "idle" : "unavailable",
      connection: { state: opts.connectionState, transport: "ble" },
      lastSeenAt: new Date().toISOString(),
    }),
  };
}

function makeRegistry(providers: Array<{ category: Category }>) {
  return {
    findByCategory: (cat: Category) => providers.filter((p) => p.category === cat),
  };
}

let mockRegistry: ReturnType<typeof makeRegistry> = makeRegistry([]);

vi.mock("@/lib/platform/DeviceRegistryContext", () => ({
  useDeviceRegistry: () => ({ registry: mockRegistry }),
}));

// Imported after the mocks above so the module under test picks them up.
const { DeviceHealthStrip } = await import("../DeviceHealthStrip");

// ─────────────────────────────────────────────────────────────────────────────

describe("DeviceHealthStrip — chip visibility rules", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders no chip for an idle (healthy) media-import provider", async () => {
    mockRegistry = makeRegistry([makeMediaImportProvider("healthy")]);
    render(<DeviceHealthStrip />);

    // Give the async checkHealth() probe a tick to resolve.
    await waitFor(() => {
      expect(screen.queryByText("Import needs access")).toBeNull();
    });
    expect(screen.queryByText("Import from device")).toBeNull();
  });

  it("renders a chip once media-import is actionable (permission missing)", async () => {
    mockRegistry = makeRegistry([makeMediaImportProvider("degraded")]);
    render(<DeviceHealthStrip />);

    await waitFor(() => {
      expect(screen.getByText("Import needs access")).toBeTruthy();
    });
  });

  it("renders a chip once media-import is actionable (health-check error)", async () => {
    const provider = makeMediaImportProvider("healthy");
    provider.checkHealth = vi.fn().mockRejectedValue(new Error("permission check failed"));
    mockRegistry = makeRegistry([provider]);
    render(<DeviceHealthStrip />);

    await waitFor(() => {
      expect(screen.getByText("Import needs access")).toBeTruthy();
    });
  });

  it("renders no chip for an idle, registered-but-disconnected sensor", async () => {
    const moisture = makeSensorProvider({ id: "moisture", name: "Protimeter", connectionState: "disconnected" });
    mockRegistry = makeRegistry([moisture]);
    const { container } = render(<DeviceHealthStrip />);

    await waitFor(() => {
      // The strip itself renders nothing (returns null) when nothing is active.
      expect(container.textContent).toBe("");
    });
    expect(screen.queryByText("Protimeter")).toBeNull();
  });

  it("renders a chip for a connected sensor", async () => {
    const moisture = makeSensorProvider({ id: "moisture", name: "Protimeter", connectionState: "connected" });
    mockRegistry = makeRegistry([moisture]);
    render(<DeviceHealthStrip />);

    await waitFor(() => {
      expect(screen.getByText("Protimeter")).toBeTruthy();
    });
  });

  it("always shows a lazily-registered Wi-Fi camera's chip once present in the registry, even when not yet connected", async () => {
    const wifiCamera = makeCameraProvider({ id: "wifi-camera", name: "Wi-Fi Camera", connectionState: "disconnected" });
    mockRegistry = makeRegistry([wifiCamera]);
    render(<DeviceHealthStrip />);

    // No status/health gate applies to lazily-registered cameras — presence
    // in the registry alone is the signal, unlike sensors or media-import.
    await waitFor(() => {
      expect(screen.getByText("Wi-Fi Camera")).toBeTruthy();
    });
  });

  it("keeps showing the Wi-Fi camera chip once errored, same as when healthy", async () => {
    const wifiCamera = makeCameraProvider({ id: "wifi-camera", name: "Wi-Fi Camera", connectionState: "error" });
    mockRegistry = makeRegistry([wifiCamera]);
    render(<DeviceHealthStrip />);

    await waitFor(() => {
      expect(screen.getByText("Wi-Fi Camera")).toBeTruthy();
    });
  });

  it("suppresses the native-camera and healthy media-import providers together while still showing an unrelated connected sensor", async () => {
    const nativeCamera = makeCameraProvider({ id: "native-camera", name: "Native Camera", connectionState: "connected" });
    const mediaImport = makeMediaImportProvider("healthy");
    const co2 = makeSensorProvider({ id: "co2", name: "CO2 Sensor", connectionState: "connected" });
    mockRegistry = makeRegistry([nativeCamera, mediaImport, co2]);
    render(<DeviceHealthStrip />);

    await waitFor(() => {
      expect(screen.getByText("CO2 Sensor")).toBeTruthy();
    });
    expect(screen.queryByText("Native Camera")).toBeNull();
    expect(screen.queryByText("Import from device")).toBeNull();
    expect(screen.queryByText("Import needs access")).toBeNull();
  });
});
