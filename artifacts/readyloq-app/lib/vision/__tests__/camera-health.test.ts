/**
 * Unit tests — camera provider health checks and DeviceRegistry health lifecycle.
 *
 * Covers:
 *  1. NativeCameraProvider.checkHealth() — granted ✓, denied ✗
 *  2. MediaImportProvider.checkHealth() — granted ✓, denied ✗
 *  3. WifiCameraProvider.checkHealth()  — reachable ✓, unreachable ✗
 *  4. DeviceRegistry.checkAllHealth()   — updates cache + emits provider.health_changed
 *  5. DeviceRegistry.getPrimary("camera") — prefers highest-health provider
 *
 * All React Native / Expo modules are mocked so the suite runs in Node.js.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── vi.hoisted() ensures these functions exist before vi.mock factories run ───

const { mockGetCameraPermissions, mockGetMediaLibraryPermissions } = vi.hoisted(() => ({
  mockGetCameraPermissions: vi.fn(),
  mockGetMediaLibraryPermissions: vi.fn(),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("expo-camera", () => ({
  Camera: {
    getCameraPermissionsAsync: mockGetCameraPermissions,
    requestCameraPermissionsAsync: vi.fn().mockResolvedValue({ granted: false }),
  },
  CameraView: class {},
}));

vi.mock("expo-image-picker", () => ({
  default: {
    getMediaLibraryPermissionsAsync: mockGetMediaLibraryPermissions,
    requestMediaLibraryPermissionsAsync: vi.fn().mockResolvedValue({ granted: false }),
  },
  getMediaLibraryPermissionsAsync: mockGetMediaLibraryPermissions,
  requestMediaLibraryPermissionsAsync: vi.fn().mockResolvedValue({ granted: false }),
}));

// In-memory AsyncStorage used by wifi-camera-provider for config persistence
const _asyncStore = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => _asyncStore.get(key) ?? null,
    setItem: async (key: string, value: string) => { _asyncStore.set(key, value); },
    removeItem: async (key: string) => { _asyncStore.delete(key); },
  },
}));

let _uuidSeq = 0;
vi.mock("expo-crypto", () => ({
  randomUUID: () => `test-uuid-${++_uuidSeq}`,
}));

// ── Import modules under test AFTER mocks ─────────────────────────────────────

import { createNativeCameraProvider } from "../native-camera-provider";
import { createMediaImportProvider } from "../media-import-provider";
import {
  configureWifiCamera,
  clearWifiCameraConfig,
  createWifiCameraProvider,
} from "../wifi-camera-provider";
import { createDeviceRegistry } from "@platform/device-core";
import type { DeviceProvider, DeviceCapabilities } from "@platform/device-core";
import type { HealthCheckResult } from "@platform/provider-registry";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a minimal DeviceProvider stub for registry tests. */
function makeStubProvider(
  id: string,
  priority: number,
  healthStatus: HealthCheckResult["status"],
): DeviceProvider {
  return {
    id,
    name: id,
    priority,
    identity: { manufacturer: "Test", model: id },
    capabilities: {
      categories: ["camera"],
      transports: ["internal"],
      hasLivePreview: false,
      producesMedia: true,
      requiresPairing: false,
      supportsStreaming: false,
      supportsOffline: true,
      tokens: ["capture.photo"],
    } as DeviceCapabilities,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockResolvedValue({
      operational: "idle",
      connection: { state: "connected", transport: "internal" },
      lastSeenAt: new Date().toISOString(),
    }),
    checkHealth: vi.fn().mockResolvedValue({
      status: healthStatus,
      message: `${id} is ${healthStatus}`,
      checkedAt: new Date().toISOString(),
      latencyMs: 1,
    } satisfies HealthCheckResult),
    getPermissions: vi.fn().mockReturnValue({
      granted: true,
      required: [],
      request: async () => true,
    }),
    on: vi.fn().mockReturnValue(() => {}),
    emit: vi.fn(),
    initialize: vi.fn().mockResolvedValue(undefined),
    teardown: vi.fn().mockResolvedValue(undefined),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. NativeCameraProvider.checkHealth()
// ─────────────────────────────────────────────────────────────────────────────

describe("NativeCameraProvider.checkHealth()", () => {
  // cameraRef is irrelevant for health checks — pass a null ref
  const provider = createNativeCameraProvider({ current: null });

  it("returns healthy when camera permission is granted", async () => {
    mockGetCameraPermissions.mockResolvedValueOnce({ granted: true });

    const result = await provider.checkHealth();

    expect(result.status).toBe("healthy");
    expect(result.message).toMatch(/granted/i);
    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.checkedAt).toBeTruthy();
  });

  it("returns degraded when camera permission is denied", async () => {
    mockGetCameraPermissions.mockResolvedValueOnce({ granted: false });

    const result = await provider.checkHealth();

    expect(result.status).toBe("degraded");
    expect(result.message).toMatch(/not yet granted/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. MediaImportProvider.checkHealth()
// ─────────────────────────────────────────────────────────────────────────────

describe("MediaImportProvider.checkHealth()", () => {
  const provider = createMediaImportProvider();

  it("returns healthy when photo library permission is granted", async () => {
    mockGetMediaLibraryPermissions.mockResolvedValueOnce({ granted: true });

    const result = await provider.checkHealth();

    expect(result.status).toBe("healthy");
    expect(result.message).toMatch(/granted/i);
    expect(typeof result.latencyMs).toBe("number");
    expect(result.checkedAt).toBeTruthy();
  });

  it("returns degraded when photo library permission is denied", async () => {
    mockGetMediaLibraryPermissions.mockResolvedValueOnce({ granted: false });

    const result = await provider.checkHealth();

    expect(result.status).toBe("degraded");
    expect(result.message).toMatch(/not yet granted/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. WifiCameraProvider.checkHealth()
// ─────────────────────────────────────────────────────────────────────────────

describe("WifiCameraProvider.checkHealth()", () => {
  beforeEach(() => {
    clearWifiCameraConfig();
    _asyncStore.clear();
    vi.restoreAllMocks();
  });

  it("returns healthy when the camera endpoint is reachable", async () => {
    configureWifiCamera({ baseUrl: "http://10.0.0.1" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const provider = createWifiCameraProvider();
    const result = await provider.checkHealth();

    expect(result.status).toBe("healthy");
    expect(result.message).toMatch(/reachable/i);
    expect(typeof result.latencyMs).toBe("number");
    expect(result.checkedAt).toBeTruthy();
  });

  it("returns unhealthy when the camera endpoint is not reachable (network error)", async () => {
    configureWifiCamera({ baseUrl: "http://192.168.99.1" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network request failed")));

    const provider = createWifiCameraProvider();
    const result = await provider.checkHealth();

    expect(result.status).toBe("unhealthy");
    expect(result.message).toBeTruthy();
  });

  it("returns unhealthy when the camera responds with a server error", async () => {
    configureWifiCamera({ baseUrl: "http://192.168.1.200" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    const provider = createWifiCameraProvider();
    const result = await provider.checkHealth();

    expect(result.status).toBe("unhealthy");
    expect(result.message).toMatch(/500/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. DeviceRegistry.checkAllHealth()
// ─────────────────────────────────────────────────────────────────────────────

describe("DeviceRegistry.checkAllHealth()", () => {
  it("updates the health cache for each registered provider", async () => {
    const registry = createDeviceRegistry();
    registry.register(makeStubProvider("cam-a", 100, "healthy"));
    registry.register(makeStubProvider("cam-b", 50, "degraded"));

    // Before checkAllHealth the cache is empty
    expect(registry.getHealth("cam-a")).toBeUndefined();
    expect(registry.getHealth("cam-b")).toBeUndefined();

    await registry.checkAllHealth();

    expect(registry.getHealth("cam-a")?.status).toBe("healthy");
    expect(registry.getHealth("cam-b")?.status).toBe("degraded");
  });

  it("emits a provider.health_changed event for each provider checked", async () => {
    const registry = createDeviceRegistry();
    registry.register(makeStubProvider("cam-ha", 100, "healthy"));
    registry.register(makeStubProvider("cam-hb", 75, "unhealthy"));

    const changedIds: string[] = [];
    registry.subscribe((event) => {
      if (event.kind === "provider.health_changed" && event.health != null) {
        changedIds.push(event.providerId);
      }
    });

    await registry.checkAllHealth();

    expect(changedIds).toContain("cam-ha");
    expect(changedIds).toContain("cam-hb");
    expect(changedIds).toHaveLength(2);
  });

  it("records unhealthy and still emits when checkHealth throws (permission revoked)", async () => {
    const registry = createDeviceRegistry();
    const flakyProvider = makeStubProvider("cam-flaky", 80, "healthy");
    (flakyProvider.checkHealth as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Permission revoked mid-session"),
    );
    registry.register(flakyProvider);

    const emitted: Array<{ id: string; status: string }> = [];
    registry.subscribe((event) => {
      if (event.kind === "provider.health_changed" && event.health != null) {
        emitted.push({ id: event.providerId, status: event.health.status });
      }
    });

    await registry.checkAllHealth();

    expect(registry.getHealth("cam-flaky")?.status).toBe("unhealthy");
    expect(emitted).toHaveLength(1);
    expect(emitted[0].status).toBe("unhealthy");
  });

  it("returns a results Map containing all checked providers", async () => {
    const registry = createDeviceRegistry();
    registry.register(makeStubProvider("cam-x", 100, "healthy"));
    registry.register(makeStubProvider("cam-y", 50, "degraded"));

    const results = await registry.checkAllHealth();

    expect(results.size).toBe(2);
    expect(results.get("cam-x")?.status).toBe("healthy");
    expect(results.get("cam-y")?.status).toBe("degraded");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. DeviceRegistry.getPrimary("camera") — prefers highest-health provider
// ─────────────────────────────────────────────────────────────────────────────

describe("DeviceRegistry.getPrimary()", () => {
  it("returns the healthy provider over a degraded one at the same priority", async () => {
    const registry = createDeviceRegistry();
    registry.register(makeStubProvider("cam-degraded", 100, "degraded"));
    registry.register(makeStubProvider("cam-healthy", 100, "healthy"));
    await registry.checkAllHealth();

    expect(registry.getPrimary("camera")?.id).toBe("cam-healthy");
  });

  it("returns the higher-priority provider when neither has been health-checked yet", () => {
    const registry = createDeviceRegistry();
    registry.register(makeStubProvider("cam-low", 50, "healthy"));
    registry.register(makeStubProvider("cam-high", 100, "healthy"));
    // No checkAllHealth — both have "unknown" health

    expect(registry.getPrimary("camera")?.id).toBe("cam-high");
  });

  it("prefers healthy over unhealthy even when unhealthy has higher priority", async () => {
    const registry = createDeviceRegistry();
    registry.register(makeStubProvider("cam-unhealthy", 200, "unhealthy"));
    registry.register(makeStubProvider("cam-healthy-low", 50, "healthy"));
    await registry.checkAllHealth();

    expect(registry.getPrimary("camera")?.id).toBe("cam-healthy-low");
  });

  it("prefers degraded over unhealthy", async () => {
    const registry = createDeviceRegistry();
    registry.register(makeStubProvider("cam-uh", 100, "unhealthy"));
    registry.register(makeStubProvider("cam-deg", 50, "degraded"));
    await registry.checkAllHealth();

    expect(registry.getPrimary("camera")?.id).toBe("cam-deg");
  });

  it("returns undefined when no camera providers are registered", () => {
    const registry = createDeviceRegistry();
    expect(registry.getPrimary("camera")).toBeUndefined();
  });

  it("updates the primary after a permission is revoked mid-inspection", async () => {
    const registry = createDeviceRegistry();
    const providerA = makeStubProvider("cam-a-mid", 100, "healthy");
    const providerB = makeStubProvider("cam-b-mid", 50, "healthy");

    registry.register(providerA);
    registry.register(providerB);

    // First check — both healthy; A wins on priority
    await registry.checkAllHealth();
    expect(registry.getPrimary("camera")?.id).toBe("cam-a-mid");

    // Simulate permission revoked mid-inspection: A degrades
    (providerA.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "degraded",
      message: "Camera permission revoked",
      checkedAt: new Date().toISOString(),
      latencyMs: 1,
    } satisfies HealthCheckResult);

    await registry.checkAllHealth();

    // B is now preferred — it is still healthy
    expect(registry.getPrimary("camera")?.id).toBe("cam-b-mid");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Health recovery: granted → revoked → re-granted
// ─────────────────────────────────────────────────────────────────────────────

describe("DeviceRegistry — permission recovery lifecycle", () => {
  it("returns to healthy and re-selects the provider after a revoked permission is re-granted", async () => {
    const registry = createDeviceRegistry();

    // Provider A (high-priority), Provider B (low-priority fallback)
    const providerA = makeStubProvider("cam-recover-a", 100, "healthy");
    const providerB = makeStubProvider("cam-recover-b", 50, "healthy");
    registry.register(providerA);
    registry.register(providerB);

    const emittedEvents: Array<{ id: string; status: string }> = [];
    registry.subscribe((event) => {
      if (event.kind === "provider.health_changed" && event.health != null) {
        emittedEvents.push({ id: event.providerId, status: event.health.status });
      }
    });

    // ── Phase 1: both granted ─────────────────────────────────────────────────
    await registry.checkAllHealth();

    expect(registry.getHealth("cam-recover-a")?.status).toBe("healthy");
    expect(registry.getHealth("cam-recover-b")?.status).toBe("healthy");
    // A wins on priority when both healthy
    expect(registry.getPrimary("camera")?.id).toBe("cam-recover-a");
    // health_changed emitted for both providers
    expect(emittedEvents.filter((e) => e.id === "cam-recover-a" && e.status === "healthy")).toHaveLength(1);
    expect(emittedEvents.filter((e) => e.id === "cam-recover-b" && e.status === "healthy")).toHaveLength(1);

    // ── Phase 2: A's permission revoked → degraded ────────────────────────────
    (providerA.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "degraded",
      message: "Camera permission revoked by user",
      checkedAt: new Date().toISOString(),
      latencyMs: 1,
    } satisfies HealthCheckResult);

    await registry.checkAllHealth();

    expect(registry.getHealth("cam-recover-a")?.status).toBe("degraded");
    expect(registry.getHealth("cam-recover-b")?.status).toBe("healthy");
    // B is now primary — A is degraded
    expect(registry.getPrimary("camera")?.id).toBe("cam-recover-b");
    // health_changed emitted for A with degraded status
    expect(emittedEvents.filter((e) => e.id === "cam-recover-a" && e.status === "degraded")).toHaveLength(1);

    // ── Phase 3: A's permission re-granted → healthy again ────────────────────
    (providerA.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "healthy",
      message: "Camera permission granted",
      checkedAt: new Date().toISOString(),
      latencyMs: 1,
    } satisfies HealthCheckResult);

    await registry.checkAllHealth();

    expect(registry.getHealth("cam-recover-a")?.status).toBe("healthy");
    expect(registry.getHealth("cam-recover-b")?.status).toBe("healthy");
    // A is re-selected as primary — higher priority, now healthy again
    expect(registry.getPrimary("camera")?.id).toBe("cam-recover-a");
    // health_changed emitted for A with healthy status (second time)
    expect(emittedEvents.filter((e) => e.id === "cam-recover-a" && e.status === "healthy")).toHaveLength(2);
  });

  it("emits health_changed on every transition — not only on first change", async () => {
    const registry = createDeviceRegistry();
    const provider = makeStubProvider("cam-transitions", 100, "healthy");
    registry.register(provider);

    const statuses: string[] = [];
    registry.subscribe((event) => {
      if (event.kind === "provider.health_changed" && event.health != null && event.providerId === "cam-transitions") {
        statuses.push(event.health.status);
      }
    });

    // Check 1 — healthy
    await registry.checkAllHealth();

    // Check 2 — degraded (permission revoked)
    (provider.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "degraded",
      message: "Permission denied",
      checkedAt: new Date().toISOString(),
      latencyMs: 1,
    } satisfies HealthCheckResult);
    await registry.checkAllHealth();

    // Check 3 — healthy again (permission re-granted)
    (provider.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "healthy",
      message: "Permission granted",
      checkedAt: new Date().toISOString(),
      latencyMs: 1,
    } satisfies HealthCheckResult);
    await registry.checkAllHealth();

    expect(statuses).toEqual(["healthy", "degraded", "healthy"]);
  });
});
