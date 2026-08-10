/**
 * useAllDevicesHealthCheck — calls DeviceRegistry.checkAllHealth() on mount
 * and every 30 seconds while the capture screen is open.
 *
 * This warms the health cache used by DeviceRegistry.getPrimary(), fires
 * "provider.health_changed" registry events (so subscribers update), and
 * ensures degraded/unhealthy providers surface in the DeviceHealthStrip and
 * NativeCameraHealthBadge without waiting for a manual probe.
 *
 * Runs a single shared timer for all registered providers — cheaper than
 * each chip polling independently via checkHealth().
 */

import { useEffect } from "react";

import { useDeviceRegistry } from "@/lib/platform/DeviceRegistryContext";

const POLL_INTERVAL_MS = 30_000;

export function useAllDevicesHealthCheck(): void {
  const { registry } = useDeviceRegistry();

  useEffect(() => {
    // Immediate probe on mount so the health cache is warm before the first
    // render of health indicators.
    void registry.checkAllHealth();

    const id = setInterval(() => {
      void registry.checkAllHealth();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [registry]);
}
