/**
 * useCameraHealth — polls the native-camera DeviceProvider for health.
 *
 * The native camera's getStatus() checks camera permission:
 *   - operational "idle"        → permission granted  → healthy
 *   - operational "unavailable" → permission denied   → degraded
 *   - operational "error"       → runtime error       → degraded
 *
 * Status is probed immediately on mount and every 30 seconds thereafter.
 * Used by NativeCameraHealthBadge to surface degraded state in the
 * inspection capture UI without polluting the DeviceHealthStrip (which
 * is reserved for supplemental devices such as Wi-Fi cameras and BLE sensors).
 */

import { useCallback, useEffect, useState } from "react";

import { useDeviceRegistry } from "@/lib/platform/DeviceRegistryContext";

export type CameraHealthStatus = "checking" | "healthy" | "degraded" | "unavailable";

export interface CameraHealth {
  status: CameraHealthStatus;
  /** Short human-readable reason when not healthy; null when healthy or checking. */
  message: string | null;
}

const POLL_INTERVAL_MS = 30_000;

export function useCameraHealth(): CameraHealth {
  const { registry } = useDeviceRegistry();
  const [health, setHealth] = useState<CameraHealth>({ status: "checking", message: null });

  const probe = useCallback(async () => {
    const provider = registry.findByCategory("camera").find((p) => p.id === "native-camera");
    if (!provider) {
      setHealth({ status: "unavailable", message: "Camera not available on this device" });
      return;
    }

    try {
      const s = await provider.getStatus();

      if (s.operational === "unavailable") {
        setHealth({ status: "degraded", message: "Camera permission required" });
      } else if (s.operational === "error") {
        setHealth({ status: "degraded", message: "Camera error detected" });
      } else {
        // idle | active | busy | updating | calibrating — all considered healthy
        setHealth({ status: "healthy", message: null });
      }
    } catch {
      setHealth({ status: "degraded", message: "Camera health check failed" });
    }
  }, [registry]);

  useEffect(() => {
    void probe();
    const id = setInterval(() => { void probe(); }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [probe]);

  return health;
}
