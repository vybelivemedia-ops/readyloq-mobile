/**
 * DeviceHealthStrip — compact horizontal bar showing active hardware device
 * health during a live inspection session.
 *
 * Reads camera providers (category "camera") and sensors (category "sensor")
 * from the DeviceRegistry. Subscribes to device.connected / device.disconnected
 * events for live updates. Renders nothing when only the always-present native
 * camera is available and it is healthy — it only becomes visible when there is
 * something actionable for the technician to see (Wi-Fi camera, BLE sensors,
 * or a degraded device).
 *
 * Peripheral sensors (Protimeter/moisture, Bosch GLM/distance, temperature +
 * humidity, CO2, acoustic) are ALWAYS registered at app startup so their
 * health can be tracked, but they start disconnected and only connect on
 * demand from the Connections tab. To keep the main viewfinder overlay
 * distraction-free, a sensor chip is rendered ONLY once that peripheral is
 * actually connected/paired (or erroring) — never for a merely-registered,
 * idle sensor. That keeps every unused tool completely hidden by default.
 *
 * The "media-import" camera provider follows the same "don't clutter for a
 * normal, non-actionable state" rule, but for a different reason: it is
 * always registered and always reachable (it just opens the OS photo
 * picker), and there is already a dedicated Import button in the core
 * capture controls. So its chip is suppressed entirely while photo-library
 * access is granted and only appears once it becomes actionable (permission
 * missing or a health-check error) — see useMediaImportSlot below. Other
 * camera providers (e.g. Wi-Fi camera) are registered lazily, only once the
 * user has configured them, so their chip can keep showing unconditionally
 * once present — that registration gate already keeps them hidden by
 * default.
 */

import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { AppState, Text, View } from "react-native";

import { useDeviceRegistry } from "@/lib/platform/DeviceRegistryContext";
import type { DeviceProvider, DeviceStatus } from "@platform/device-core";

// ─── Types ────────────────────────────────────────────────────────────────────

type SlotStatus = "healthy" | "degraded" | "offline" | "checking";

interface DeviceSlot {
  id: string;
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  status: SlotStatus;
}

// Exported for unit testing (reachable-vs-connected chip accuracy coverage) —
// not part of the component's intended public surface for other screens.
export function statusFromDeviceStatus(s: DeviceStatus): SlotStatus {
  const conn = s.connection.state;
  if (conn === "connected" || conn === "paired") {
    return s.operational === "error" ? "degraded" : "healthy";
  }
  if (conn === "error") {
    return "degraded";
  }
  return "offline";
}

// ─── Per-provider hook (single chip that always renders, e.g. cameras) ───────

function useProviderSlot(provider: DeviceProvider, icon: keyof typeof Ionicons.glyphMap): DeviceSlot {
  const [status, setStatus] = useState<SlotStatus>("checking");

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      try {
        const s = await provider.getStatus();
        if (active) setStatus(statusFromDeviceStatus(s));
      } catch {
        if (active) setStatus("offline");
      }
    };

    void refresh();
    const u1 = provider.on("device.connected", () => setStatus("healthy"));
    const u2 = provider.on("device.disconnected", () => setStatus("offline"));
    return () => {
      active = false;
      u1();
      u2();
    };
  }, [provider]);

  return { id: provider.id, name: provider.name, icon, status };
}

function useMediaImportSlot(provider: DeviceProvider | undefined): DeviceSlot | null {
  const [actionable, setActionable] = useState(false);

  useEffect(() => {
    if (!provider) {
      setActionable(false);
      return;
    }
    let active = true;

    const refresh = async () => {
      try {
        const health = await provider.checkHealth();
        if (active) setActionable(health.status !== "healthy");
      } catch {
        if (active) setActionable(true);
      }
    };

    void refresh();

    // Photo-library permission can change while the app is backgrounded
    // (user grants/revokes it from OS Settings), so re-check on resume.
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void refresh();
    });

    return () => {
      active = false;
      sub.remove();
    };
  }, [provider]);

  if (!provider || !actionable) return null;
  return {
    id: provider.id,
    name: "Import needs access",
    icon: "images-outline",
    status: "degraded",
  };
}

// ─── Multi-provider hook: resolves every provider's status up front so the
// caller can filter out idle/never-connected peripherals before anything
// renders — this is what keeps disconnected sensors fully hidden. ───────────

// Exported for unit testing (race-condition regression coverage) — not part
// of the component's intended public surface for other screens.
export function useActiveOnlySlots(
  providers: DeviceProvider[],
  iconFor: (provider: DeviceProvider) => keyof typeof Ionicons.glyphMap,
): DeviceSlot[] {
  const [statuses, setStatuses] = useState<Record<string, SlotStatus>>({});

  useEffect(() => {
    let active = true;
    const unsubscribes: Array<() => void> = [];
    // Guards against out-of-order getStatus() resolution: a "device.connected"
    // event fired shortly after the initial mount-time check issues a second,
    // overlapping getStatus() call for the same provider. Nothing guarantees
    // those two promises resolve in request order (e.g. a provider whose
    // status check involves a network round-trip), so without a sequence
    // guard a slow, stale response could land after the fresh one and flip a
    // just-connected chip back to hidden. Only the response to the
    // most-recently-issued request per provider is allowed to update state.
    const requestSeq: Record<string, number> = {};

    const refreshOne = async (provider: DeviceProvider) => {
      const seq = (requestSeq[provider.id] = (requestSeq[provider.id] ?? 0) + 1);
      try {
        const s = await provider.getStatus();
        if (!active || requestSeq[provider.id] !== seq) return;
        setStatuses((prev) => ({ ...prev, [provider.id]: statusFromDeviceStatus(s) }));
      } catch {
        if (active && requestSeq[provider.id] === seq) {
          setStatuses((prev) => ({ ...prev, [provider.id]: "offline" }));
        }
      }
    };

    for (const provider of providers) {
      void refreshOne(provider);
      unsubscribes.push(provider.on("device.connected", () => void refreshOne(provider)));
      unsubscribes.push(provider.on("device.disconnected", () => void refreshOne(provider)));
    }

    return () => {
      active = false;
      unsubscribes.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers]);

  return providers
    .map((p) => ({ id: p.id, name: p.name, icon: iconFor(p), status: statuses[p.id] ?? "checking" }))
    .filter((slot) => slot.status === "healthy" || slot.status === "degraded");
}

// ─── Dot indicator ────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<SlotStatus, string> = {
  healthy: "#22c55e",
  degraded: "#f59e0b",
  offline: "#6b7280",
  checking: "#6b7280",
};

function HealthDot({ status }: { status: SlotStatus }) {
  return (
    <View
      style={{
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: STATUS_COLOR[status],
      }}
    />
  );
}

// ─── Single device chip ───────────────────────────────────────────────────────

function DeviceChip({ slot }: { slot: DeviceSlot }) {
  const color = STATUS_COLOR[slot.status];
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        backgroundColor: "rgba(0,0,0,0.5)",
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderWidth: 1,
        borderColor: slot.status === "healthy" ? "rgba(34,197,94,0.35)" : "rgba(107,114,128,0.3)",
      }}
    >
      <Ionicons name={slot.icon} size={11} color={color} />
      <HealthDot status={slot.status} />
      <Text
        style={{
          color: "#e5e7eb",
          fontFamily: "Inter_400Regular",
          fontSize: 10,
        }}
        numberOfLines={1}
      >
        {slot.name}
      </Text>
    </View>
  );
}

// ─── Camera slot (single provider, not a hook loop) ──────────────────────────

function CameraSlotChip({ provider }: { provider: DeviceProvider }) {
  const icon: keyof typeof Ionicons.glyphMap = provider.id === "wifi-camera" ? "wifi" : "camera";
  const slot = useProviderSlot(provider, icon);
  return <DeviceChip slot={slot} />;
}

function sensorIconFor(provider: DeviceProvider): keyof typeof Ionicons.glyphMap {
  const tokens = provider.capabilities.tokens;
  return tokens.includes("sensor.moisture")
    ? "water-outline"
    : tokens.includes("sensor.distance")
      ? "scan-outline"
      : "hardware-chip-outline";
}

// ─── Strip ────────────────────────────────────────────────────────────────────

/**
 * Renders nothing when there is only the standard on-device native camera with
 * no supplemental hardware in active use — keeps the camera UI uncluttered
 * during basic inspections and only surfaces the strip when it has actionable
 * information (a connected peripheral, or one that has gone into an error
 * state after being connected).
 */
export function DeviceHealthStrip() {
  const { registry } = useDeviceRegistry();

  // "media-import" is handled separately (useMediaImportSlot): it is always
  // registered but should stay hidden unless actionable, unlike other camera
  // providers (e.g. Wi-Fi camera) which are only ever registered once the
  // user has configured them, so their presence alone is meaningful.
  const cameras = useMemo(
    () =>
      registry
        .findByCategory("camera")
        .filter((c) => c.id !== "native-camera" && c.id !== "media-import"),
    [registry],
  );
  const mediaImportProvider = useMemo(
    () => registry.findByCategory("camera").find((c) => c.id === "media-import"),
    [registry],
  );
  const sensors = useMemo(() => registry.findByCategory("sensor"), [registry]);

  // Sensors are always registered at startup but start disconnected — only
  // surface a chip once the peripheral is actually connected/paired (or
  // erroring), so an idle Protimeter, Bosch GLM, temp/humidity, CO2, or
  // acoustic sensor never clutters the viewfinder.
  const activeSensorSlots = useActiveOnlySlots(sensors, sensorIconFor);
  const mediaImportSlot = useMediaImportSlot(mediaImportProvider);

  if (cameras.length === 0 && activeSensorSlots.length === 0 && !mediaImportSlot) {
    return null;
  }

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
      }}
    >
      {cameras.map((p) => (
        <CameraSlotChip key={p.id} provider={p} />
      ))}
      {mediaImportSlot && <DeviceChip slot={mediaImportSlot} />}
      {activeSensorSlots.map((slot) => (
        <DeviceChip key={slot.id} slot={slot} />
      ))}
    </View>
  );
}
