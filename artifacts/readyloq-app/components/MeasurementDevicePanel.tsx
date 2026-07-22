/**
 * MeasurementDevicePanel — shows connected physical measurement instruments
 * and lets a technician take readings directly from the inspection screen.
 *
 * Reads sensor providers from the DeviceRegistry (category "sensor") via the
 * shared DeviceRegistryContext. On "Take Reading" it calls provider.read()
 * through the DevicePlugin.getMeasurementDevice() helper so the full
 * MeasurementDeviceProvider interface is available.
 *
 * If no sensor devices are registered, the panel renders nothing so it
 * does not add visual noise to inspections without physical hardware.
 */

import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useDeviceRegistry } from "@/lib/platform/DeviceRegistryContext";
import { useColors } from "@/hooks/useColors";
import type { MeasurementReading } from "@platform/measurement-core";
import type { DeviceProvider } from "@platform/device-core";

// ─── Label helpers ────────────────────────────────────────────────────────────

function deviceIcon(tokens: string[]): keyof typeof Ionicons.glyphMap {
  if (tokens.includes("sensor.moisture")) return "water-outline";
  if (tokens.includes("sensor.distance")) return "scan-outline";
  return "hardware-chip-outline";
}

function readingLabel(reading: MeasurementReading): string {
  const { kind, value, unit } = reading;
  if (kind === "thickness") {
    return `${value} %WME`;
  }
  if (kind === "distance") {
    return `${value} m`;
  }
  return `${value} ${unit}`;
}

function kindLabel(tokens: string[]): string {
  if (tokens.includes("sensor.moisture")) return "Moisture";
  if (tokens.includes("sensor.distance")) return "Distance";
  return "Sensor";
}

function formatReadingTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

// ─── Per-device row ───────────────────────────────────────────────────────────

interface DeviceRowProps {
  provider: DeviceProvider;
  onRead: (id: string) => Promise<MeasurementReading | null>;
}

function DeviceRow({ provider, onRead }: DeviceRowProps) {
  const colors = useColors();
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [reading, setReading] = useState<MeasurementReading | null>(null);
  const [taking, setTaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokens = provider.capabilities.tokens;

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      await provider.connect();
      setConnected(true);
    } catch (e) {
      setError((e as Error).message ?? "Connection failed");
    } finally {
      setConnecting(false);
    }
  }, [provider]);

  const handleDisconnect = useCallback(async () => {
    try {
      await provider.disconnect();
      setConnected(false);
      setReading(null);
    } catch {
      setConnected(false);
    }
  }, [provider]);

  const handleRead = useCallback(async () => {
    setTaking(true);
    setError(null);
    try {
      const r = await onRead(provider.id);
      if (r) setReading(r);
    } catch (e) {
      setError((e as Error).message ?? "Read failed");
    } finally {
      setTaking(false);
    }
  }, [onRead, provider.id]);

  useEffect(() => {
    const unsub = provider.on("device.connected", () => setConnected(true));
    const unsub2 = provider.on("device.disconnected", () => setConnected(false));
    return () => { unsub(); unsub2(); };
  }, [provider]);

  return (
    <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.rowHeader}>
        <View style={[styles.iconWrap, { backgroundColor: connected ? "rgba(23,196,211,0.12)" : "rgba(156,163,175,0.1)" }]}>
          <Ionicons
            name={deviceIcon(tokens)}
            size={18}
            color={connected ? "#17c4d3" : colors.mutedForeground}
          />
        </View>

        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.deviceName, { color: colors.foreground }]} numberOfLines={1}>
            {provider.name}
          </Text>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: connected ? "#22c55e" : "#6b7280" }]} />
            <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
              {connecting ? "Connecting…" : connected ? "Connected" : "Disconnected"}
            </Text>
            <Text style={[styles.kindBadge, { color: "#17c4d3", borderColor: "#17c4d3" }]}>
              {kindLabel(tokens)}
            </Text>
          </View>
        </View>

        {connected ? (
          <Pressable onPress={handleDisconnect} style={styles.disconnectBtn} hitSlop={8}>
            <Ionicons name="close-circle-outline" size={20} color={colors.mutedForeground} />
          </Pressable>
        ) : (
          <Pressable
            onPress={handleConnect}
            disabled={connecting}
            style={[styles.connectBtn, connecting && { opacity: 0.5 }]}
          >
            {connecting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.connectText}>Connect</Text>
            )}
          </Pressable>
        )}
      </View>

      {connected ? (
        <View style={styles.readingArea}>
          {reading ? (
            <View style={styles.readingDisplay}>
              <Text style={[styles.readingValue, { color: colors.foreground }]}>
                {readingLabel(reading)}
              </Text>
              <Text style={[styles.readingTime, { color: colors.mutedForeground }]}>
                at {formatReadingTime(reading.capturedAt)}
              </Text>
            </View>
          ) : (
            <Text style={[styles.noReading, { color: colors.mutedForeground }]}>
              No reading yet — tap Take Reading
            </Text>
          )}
          <Pressable
            onPress={handleRead}
            disabled={taking}
            style={[styles.readBtn, taking && { opacity: 0.5 }]}
          >
            {taking ? (
              <ActivityIndicator size="small" color="#17c4d3" />
            ) : (
              <Ionicons name="radio-button-on" size={15} color="#17c4d3" />
            )}
            <Text style={styles.readBtnText}>
              {taking ? "Reading…" : "Take Reading"}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={14} color="#ef4444" />
          <Text style={styles.errorText} numberOfLines={2}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function MeasurementDevicePanel() {
  const { registry, plugin } = useDeviceRegistry();

  const sensors = registry.findByCategory("sensor");

  const handleRead = useCallback(
    async (id: string): Promise<MeasurementReading | null> => {
      const measurementDevice = plugin.getMeasurementDevice(id);
      if (!measurementDevice) {
        throw new Error(`Device "${id}" does not support measurement reads.`);
      }
      return measurementDevice.read();
    },
    [plugin],
  );

  if (sensors.length === 0) return null;

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Ionicons name="hardware-chip-outline" size={16} color="#17c4d3" />
        <Text style={styles.panelTitle}>Measurement Devices</Text>
      </View>
      {sensors.map((p) => (
        <DeviceRow key={p.id} provider={p} onRead={handleRead} />
      ))}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  panel: { gap: 10 },
  panelHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  panelTitle: {
    color: "#17c4d3",
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    letterSpacing: 0.3,
  },

  row: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  rowHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  deviceName: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontFamily: "Inter_400Regular", fontSize: 12 },
  kindBadge: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 10,
    letterSpacing: 0.4,
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    textTransform: "uppercase",
  },

  connectBtn: {
    backgroundColor: "#17c4d3",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    minWidth: 80,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
  },
  connectText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 13 },
  disconnectBtn: { padding: 4 },

  readingArea: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  readingDisplay: { flex: 1, gap: 2 },
  readingValue: { fontFamily: "Inter_700Bold", fontSize: 22 },
  readingTime: { fontFamily: "Inter_400Regular", fontSize: 11 },
  noReading: { fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 },
  readBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: "#17c4d3",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minWidth: 110,
    justifyContent: "center",
  },
  readBtnText: { color: "#17c4d3", fontFamily: "Inter_600SemiBold", fontSize: 13 },

  errorRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: "rgba(239,68,68,0.08)",
    borderRadius: 8,
    padding: 8,
  },
  errorText: { color: "#ef4444", fontFamily: "Inter_400Regular", fontSize: 12, flex: 1 },
});
