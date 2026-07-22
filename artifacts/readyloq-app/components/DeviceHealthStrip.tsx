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
 */

import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";

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

// ─── Per-provider hook ────────────────────────────────────────────────────────

function useProviderSlot(provider: DeviceProvider, icon: keyof typeof Ionicons.glyphMap): DeviceSlot {
  const [status, setStatus] = useState<SlotStatus>("checking");

  const refresh = useCallback(async () => {
    try {
      const s: DeviceStatus = await provider.getStatus();
      const conn = s.connection.state;
      if (conn === "connected" || conn === "paired") {
        setStatus(s.operational === "error" ? "degraded" : "healthy");
      } else if (conn === "error") {
        setStatus("degraded");
      } else {
        setStatus("offline");
      }
    } catch {
      setStatus("offline");
    }
  }, [provider]);

  useEffect(() => {
    void refresh();
    const u1 = provider.on("device.connected", () => setStatus("healthy"));
    const u2 = provider.on("device.disconnected", () => setStatus("offline"));
    return () => {
      u1();
      u2();
    };
  }, [provider, refresh]);

  return { id: provider.id, name: provider.name, icon, status };
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
  const icon: keyof typeof Ionicons.glyphMap =
    provider.id === "wifi-camera"
      ? "wifi"
      : provider.id === "media-import"
        ? "images-outline"
        : "camera";
  const slot = useProviderSlot(provider, icon);
  return <DeviceChip slot={slot} />;
}

function SensorSlotChip({ provider }: { provider: DeviceProvider }) {
  const tokens = provider.capabilities.tokens;
  const icon: keyof typeof Ionicons.glyphMap = tokens.includes("sensor.moisture")
    ? "water-outline"
    : tokens.includes("sensor.distance")
      ? "scan-outline"
      : "hardware-chip-outline";
  const slot = useProviderSlot(provider, icon);
  return <DeviceChip slot={slot} />;
}

// ─── Strip ────────────────────────────────────────────────────────────────────

/**
 * Renders nothing when there is only the standard on-device native camera with
 * no supplemental hardware — keeps the camera UI uncluttered during basic
 * inspections and only surfaces the strip when it has actionable information.
 */
export function DeviceHealthStrip() {
  const { registry } = useDeviceRegistry();

  const cameras = registry.findByCategory("camera");
  const sensors = registry.findByCategory("sensor");

  const supplementalCameras = cameras.filter(
    (c) => c.id !== "native-camera",
  );

  const visibleCameras = supplementalCameras;
  const visibleSensors = sensors;

  if (visibleCameras.length === 0 && visibleSensors.length === 0) {
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
      {visibleCameras.map((p) => (
        <CameraSlotChip key={p.id} provider={p} />
      ))}
      {visibleSensors.map((p) => (
        <SensorSlotChip key={p.id} provider={p} />
      ))}
    </View>
  );
}
