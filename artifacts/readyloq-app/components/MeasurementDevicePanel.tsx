/**
 * MeasurementDevicePanel — shows connected physical measurement instruments
 * and lets a technician take live readings directly from the inspection screen.
 *
 * ─── Task #90 — Live readings ────────────────────────────────────────────────
 * As soon as a sensor connects, the panel automatically starts a subscription
 * via provider.subscribe() and updates the displayed value every poll interval.
 * The "Stamp Reading" button records the current live value so it can be
 * associated with the active inspection.
 *
 * ─── Provider access ─────────────────────────────────────────────────────────
 * Reads sensor providers from the DeviceRegistry (category "sensor") via the
 * shared DeviceRegistryContext. Both DeviceProvider (for events/status) and
 * MeasurementDeviceProvider (for read/subscribe) are passed to each DeviceRow.
 *
 * If no sensor devices are registered, the panel renders nothing.
 */

import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useDeviceRegistry } from "@/lib/platform/DeviceRegistryContext";
import { useColors } from "@/hooks/useColors";
import type { MeasurementReading } from "@platform/measurement-core";
import type { MeasurementDeviceProvider } from "@platform/measurement-core";
import type { DeviceProvider } from "@platform/device-core";

// ─── Label helpers ────────────────────────────────────────────────────────────

function deviceIcon(tokens: string[]): keyof typeof Ionicons.glyphMap {
  if (tokens.includes("sensor.moisture"))    return "water-outline";
  if (tokens.includes("sensor.distance"))    return "scan-outline";
  if (tokens.includes("sensor.temperature")) return "thermometer-outline";
  if (tokens.includes("sensor.co2"))         return "cloud-outline";
  if (tokens.includes("sensor.acoustic"))    return "ear-outline";
  return "hardware-chip-outline";
}

function kindLabel(tokens: string[]): string {
  if (tokens.includes("sensor.moisture"))    return "Moisture";
  if (tokens.includes("sensor.distance"))    return "Distance";
  if (tokens.includes("sensor.temperature")) return "Temp";
  if (tokens.includes("sensor.humidity"))    return "Humidity";
  if (tokens.includes("sensor.co2"))         return "CO₂";
  if (tokens.includes("sensor.acoustic"))    return "Acoustic";
  return "Sensor";
}

function readingLabel(reading: MeasurementReading): string {
  const { kind, value, unit } = reading;
  switch (kind) {
    case "thickness":    return `${value.toFixed(1)} %WME`;
    case "distance":     return `${value.toFixed(3)} m`;
    case "temperature":  return `${value.toFixed(1)} °C`;
    case "humidity":     return `${value.toFixed(1)} %RH`;
    case "co2":          return `${value} ppm`;
    case "acoustic":     return `${value} /1000`;
    default:             return `${value} ${unit}`;
  }
}

function liveIndicatorColor(kind: MeasurementReading["kind"], value: number): string {
  if (kind === "thickness"   && value >= 20) return "#ef4444"; // damp alarm
  if (kind === "temperature" && value >= 30) return "#f59e0b"; // hot
  if (kind === "co2"         && value >= 1000) return "#f59e0b"; // elevated
  if (kind === "acoustic"    && value >= 700) return "#ef4444"; // high activity
  return "#22c55e";
}

function formatReadingTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

// ─── Live pulse animation ─────────────────────────────────────────────────────

function usePulse(active: boolean) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active) { opacity.setValue(1); return; }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.3, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(opacity, { toValue: 1.0, duration: 700, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [active, opacity]);
  return opacity;
}

// ─── Per-device row ───────────────────────────────────────────────────────────

interface DeviceRowProps {
  provider:            DeviceProvider;
  measurementProvider: MeasurementDeviceProvider | undefined;
  onStamp?:            (reading: MeasurementReading) => void;
}

function DeviceRow({ provider, measurementProvider, onStamp }: DeviceRowProps) {
  const colors     = useColors();
  const tokens     = provider.capabilities.tokens;

  const [connected,  setConnected]  = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [reading,    setReading]    = useState<MeasurementReading | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [live,       setLive]       = useState(false);

  const unsubRef = useRef<(() => void) | null>(null);
  const pulseOpacity = usePulse(live);

  // ── Subscription management ─────────────────────────────────────────────────

  const startLive = useCallback(() => {
    if (!measurementProvider || !connected) return;
    unsubRef.current?.();
    unsubRef.current = measurementProvider.subscribe((r) => setReading(r));
    setLive(true);
  }, [measurementProvider, connected]);

  const stopLive = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = null;
    setLive(false);
  }, []);

  // Stop subscription on unmount
  useEffect(() => () => { unsubRef.current?.(); }, []);

  // ── Connect / disconnect ────────────────────────────────────────────────────

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
    stopLive();
    setReading(null);
    try {
      await provider.disconnect();
      setConnected(false);
    } catch {
      setConnected(false);
    }
  }, [provider, stopLive]);

  // ── Auto-start live subscription when connected ─────────────────────────────

  useEffect(() => {
    if (connected) {
      startLive();
    } else {
      stopLive();
    }
  }, [connected, startLive, stopLive]);

  // ── Device events ───────────────────────────────────────────────────────────

  useEffect(() => {
    const u1 = provider.on("device.connected",    () => setConnected(true));
    const u2 = provider.on("device.disconnected", () => { setConnected(false); stopLive(); });
    return () => { u1(); u2(); };
  }, [provider, stopLive]);

  // ── Reading color ───────────────────────────────────────────────────────────

  const readingColor = reading
    ? liveIndicatorColor(reading.kind, reading.value)
    : "#22c55e";

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Header */}
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
            {live ? (
              <Animated.View style={[styles.dot, { backgroundColor: readingColor, opacity: pulseOpacity }]} />
            ) : (
              <View style={[styles.dot, { backgroundColor: connected ? "#22c55e" : "#6b7280" }]} />
            )}
            <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
              {connecting ? "Connecting…" : live ? "Live" : connected ? "Connected" : "Disconnected"}
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
            {connecting
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.connectText}>Connect</Text>
            }
          </Pressable>
        )}
      </View>

      {/* Live reading display */}
      {connected && (
        <View style={styles.readingArea}>
          {reading ? (
            <View style={styles.readingDisplay}>
              <Text style={[styles.readingValue, { color: colors.foreground }]}>
                {readingLabel(reading)}
              </Text>
              <Text style={[styles.readingTime, { color: colors.mutedForeground }]}>
                {live ? "live · " : ""}at {formatReadingTime(reading.capturedAt)}
              </Text>
            </View>
          ) : (
            <Text style={[styles.noReading, { color: colors.mutedForeground }]}>
              {live ? "Waiting for first reading…" : "No reading yet"}
            </Text>
          )}

          {onStamp && reading ? (
            <Pressable
              onPress={() => onStamp(reading)}
              style={styles.stampBtn}
            >
              <Ionicons name="pin-outline" size={14} color="#17c4d3" />
              <Text style={styles.stampBtnText}>Stamp</Text>
            </Pressable>
          ) : null}
        </View>
      )}

      {/* Error */}
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

interface MeasurementDevicePanelProps {
  /** Called when a technician stamps a live reading into the inspection. */
  onStamp?: (reading: MeasurementReading) => void;
}

export function MeasurementDevicePanel({ onStamp }: MeasurementDevicePanelProps = {}) {
  const { registry, plugin } = useDeviceRegistry();
  const sensors = registry.findByCategory("sensor");

  if (sensors.length === 0) return null;

  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Ionicons name="hardware-chip-outline" size={16} color="#17c4d3" />
        <Text style={styles.panelTitle}>Measurement Devices</Text>
      </View>
      {sensors.map((p) => (
        <DeviceRow
          key={p.id}
          provider={p}
          measurementProvider={plugin.getMeasurementDevice(p.id)}
          onStamp={onStamp}
        />
      ))}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  panel:        { gap: 10 },
  panelHeader:  { flexDirection: "row", alignItems: "center", gap: 6 },
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
  rowHeader:   { flexDirection: "row", alignItems: "center", gap: 10 },
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
  statusRow:   { flexDirection: "row", alignItems: "center", gap: 6 },
  dot:         { width: 6, height: 6, borderRadius: 3 },
  statusText:  { fontFamily: "Inter_400Regular", fontSize: 12 },
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
  connectText:   { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 13 },
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
  readingValue:   { fontFamily: "Inter_700Bold", fontSize: 22 },
  readingTime:    { fontFamily: "Inter_400Regular", fontSize: 11 },
  noReading:      { fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 },

  stampBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: "#17c4d3",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    minWidth: 80,
    justifyContent: "center",
  },
  stampBtnText: { color: "#17c4d3", fontFamily: "Inter_600SemiBold", fontSize: 13 },

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
