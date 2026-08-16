/**
 * MeasurementDevicePanel — shows connected physical measurement instruments
 * and lets a technician take live readings directly from the inspection screen.
 *
 * ─── Visibility ───────────────────────────────────────────────────────────────
 * By default only active (connected or connecting) devices are rendered.
 * When sensors are registered but none are active, a compact "tap to connect"
 * row is shown instead of listing every sensor as "Disconnected".
 * A toggle in the header reveals all available sensors when the technician
 * wants to pair a new device mid-inspection.
 *
 * ─── Active count ─────────────────────────────────────────────────────────────
 * `onActiveCountChange` fires whenever the number of connected/connecting
 * devices changes, allowing the parent screen to adjust layout (e.g. expanding
 * the camera pane when no sensor drawer is open).
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
  useWindowDimensions,
  View,
} from "react-native";

import { useDeviceRegistry } from "@/lib/platform/DeviceRegistryContext";
import { useColors } from "@/hooks/useColors";
import type { MeasurementReading } from "@platform/measurement-core";
import type { MeasurementDeviceProvider } from "@platform/measurement-core";
import { BasicDimensionEstimator, PolygonCalculator } from "@platform/measurement-core";
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
  if (kind === "thickness"   && value >= 20)   return "#ef4444"; // damp alarm
  if (kind === "temperature" && value >= 30)   return "#f59e0b"; // hot
  if (kind === "co2"         && value >= 1000) return "#f59e0b"; // elevated
  if (kind === "acoustic"    && value >= 700)  return "#ef4444"; // high activity
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

// ─── Spatial measurement card ─────────────────────────────────────────────────
// Shown below device rows when a distance sensor has a live depth reading.
// Uses BasicDimensionEstimator (pinhole-camera similar-triangles) and
// PolygonCalculator (Shoelace formula) to turn pixel-space bounding quads
// into real-world dimensions — no server round-trip required.

/** Default scale: ~0.05 in/px calibrated at ~1.5 m reference distance. */
const DEFAULT_SCALE_IN_PER_PX = 0.05;

/** Default focal length used when no glasses calibration profile is available. */
const DEFAULT_FOCAL_LENGTH_PX = 800;

interface SpatialResult {
  widthIn:    number;
  heightIn:   number;
  areaSqIn:   number;
  confidence: number;
  warnings:   string[];
}

interface SpatialMeasurementCardProps {
  depthMeters: number;
  colors: ReturnType<typeof useColors>;
  /**
   * Effective focal length in pixels for the active camera source.
   * When the measurement source is Meta Ray-Ban glasses, pass the
   * back-solved focal length from the stored BasicCalibrationProfile.
   * Defaults to 800 px (typical phone camera wide-angle).
   */
  focalLengthPx?: number;
  /**
   * Pixel-space vertices of the technician's framed ROI in the camera preview.
   * When provided (from a camera overlay gesture), clipping detection runs
   * against the actual viewport bounds and warnings are shown when any vertex
   * is within 1 px of an edge.
   *
   * When omitted, a representative centred quad is used so the card remains
   * functional before the camera overlay gesture is wired; clipping will not
   * be triggered by the default quad.
   */
  roiVertices?: Array<{ x: number; y: number }>;
  /**
   * Actual camera preview width in logical pixels (from the parent layout or
   * useWindowDimensions).  Used as the right-edge boundary for clipping
   * detection.  Defaults to the device's window width when omitted.
   */
  viewportWidth?: number;
  /**
   * Actual camera preview height in logical pixels.  Defaults to the device's
   * window height when omitted.
   */
  viewportHeight?: number;
  /**
   * When true the Measure button is disabled and a message is shown asking the
   * technician to re-centre the reference object.  This prevents a clipped
   * reference (where the pixel span is understated) from producing a drifted
   * scale factor that looks plausible but is wrong.
   */
  referenceClipped?: boolean;
}

function SpatialMeasurementCard({
  depthMeters,
  colors,
  focalLengthPx = DEFAULT_FOCAL_LENGTH_PX,
  roiVertices,
  viewportWidth,
  viewportHeight,
  referenceClipped = false,
}: SpatialMeasurementCardProps) {
  // Build the estimator lazily when the focal length changes.
  // useMemo keeps it stable across re-renders when the prop is constant.
  const estimator = React.useMemo(
    () => new BasicDimensionEstimator(focalLengthPx),
    [focalLengthPx],
  );

  const window = useWindowDimensions();
  const [result, setResult] = useState<SpatialResult | null>(null);

  // Auto-clear any stale measurement result the moment the reference becomes
  // clipped.  This prevents a result produced with an in-frame reference from
  // remaining visible (with its Re-measure button) after the technician selects
  // a clipped reference, closing the bypass path the reviewer identified.
  React.useEffect(() => {
    if (referenceClipped) {
      setResult(null);
    }
  }, [referenceClipped]);

  const handleMeasure = useCallback(() => {
    // Hard guard — also checked at call sites, but this ensures the computation
    // never runs even if a future code path calls handleMeasure directly.
    if (referenceClipped) return;
    // Use caller-supplied vertices (from camera overlay gesture) when available;
    // otherwise fall back to a representative 200 × 300 px centred quad.
    // The centred default never clips — it is a stand-in until the camera
    // overlay gesture is fully wired (see task #602).
    const vpW = viewportWidth  ?? window.width;
    const vpH = viewportHeight ?? window.height;

    const vertices = roiVertices ?? [
      { x: vpW * 0.25, y: vpH * 0.1 },
      { x: vpW * 0.75, y: vpH * 0.1 },
      { x: vpW * 0.75, y: vpH * 0.5 },
      { x: vpW * 0.25, y: vpH * 0.5 },
    ];

    // Clipping: any vertex within 1 logical pixel of an edge means the framed
    // ROI (or the reference object behind it) extends past the camera preview.
    const EDGE = 1;
    const clipped = vertices.some(
      (v) => v.x <= EDGE || v.y <= EDGE || v.x >= vpW - EDGE || v.y >= vpH - EDGE,
    );

    const warnings: string[] = [];
    if (clipped) {
      warnings.push(
        "Reference object partially out of frame — re-centre and retry",
      );
    }

    // Confidence: width of the framed ROI vs 80 px threshold.
    // Clipping applies a 0.4× penalty because the measured pixel span
    // understates the true object width (mirrors ReferenceScaleAnchor logic).
    const refPixelWidth = Math.abs(vertices[1].x - vertices[0].x);
    const pixelConf = Math.min(1, refPixelWidth / 80);
    const confidence = Math.min(1, Math.max(0, pixelConf * (clipped ? 0.4 : 0.9)));

    const scaleAtDepth = DEFAULT_SCALE_IN_PER_PX * (depthMeters / 1.5);
    const geo      = PolygonCalculator.calculateAreaAndPerimeter(vertices, scaleAtDepth);
    const widthIn  = estimator.estimateWidthInches(geo, depthMeters);
    const heightIn = estimator.estimateHeightInches(geo, depthMeters);

    setResult({
      widthIn:    Math.round(widthIn  * 10) / 10,
      heightIn:   Math.round(heightIn * 10) / 10,
      areaSqIn:   Math.round(geo.areaSquareInches * 10) / 10,
      confidence,
      warnings,
    });
  }, [depthMeters, roiVertices, viewportWidth, viewportHeight, window, referenceClipped, estimator]);

  return (
    <View style={[spatialStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={spatialStyles.header}>
        <Ionicons name="expand-outline" size={15} color="#17c4d3" />
        <Text style={spatialStyles.title}>Spatial Measurement</Text>
        <Text style={[spatialStyles.depthBadge, { color: colors.mutedForeground }]}>
          {depthMeters.toFixed(2)} m depth
        </Text>
      </View>

      {result ? (
        <View style={spatialStyles.results}>
          {/* Confidence indicator */}
          <View style={spatialStyles.confRow}>
            <View
              style={[
                spatialStyles.confDot,
                { backgroundColor: result.confidence >= 0.5 ? "#22c55e" : "#f59e0b" },
              ]}
            />
            <Text style={[spatialStyles.confLabel, { color: colors.mutedForeground }]}>
              {result.confidence >= 0.5
                ? `Confidence ${Math.round(result.confidence * 100)}%`
                : `Low confidence (${Math.round(result.confidence * 100)}%) — result may be inaccurate`}
            </Text>
          </View>

          {/* Inline warnings */}
          {result.warnings.map((w, i) => (
            <View key={i} style={spatialStyles.warningRow}>
              <Ionicons name="warning-outline" size={13} color="#f59e0b" />
              <Text style={spatialStyles.warningText}>{w}</Text>
            </View>
          ))}

          <View style={spatialStyles.dimRow}>
            <_DimCell label="Width"  value={`${result.widthIn} in`}  colors={colors} />
            <_DimCell label="Height" value={`${result.heightIn} in`} colors={colors} />
            <_DimCell label="Area"   value={`${result.areaSqIn} in²`} colors={colors} />
          </View>
          <Pressable onPress={handleMeasure} style={spatialStyles.remeasureBtn} hitSlop={6}>
            <Ionicons name="refresh-outline" size={13} color={colors.mutedForeground} />
            <Text style={[spatialStyles.remeasureText, { color: colors.mutedForeground }]}>
              Re-measure
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={spatialStyles.idle}>
          {referenceClipped ? (
            /* Clipped-reference gate — Measure is blocked until technician re-centres */
            <View style={spatialStyles.clippedGate}>
              <Ionicons name="warning" size={15} color="#f59e0b" />
              <Text style={[spatialStyles.clippedGateText, { color: "#f59e0b" }]}>
                Reference partially out of frame — re-centre and retry before measuring
              </Text>
            </View>
          ) : (
            <>
              <Text style={[spatialStyles.idleText, { color: colors.mutedForeground }]}>
                Frame the subject in the camera, then tap Measure to compute dimensions.
              </Text>
              <Pressable onPress={handleMeasure} style={spatialStyles.measureBtn}>
                <Ionicons name="scan-outline" size={14} color="#fff" />
                <Text style={spatialStyles.measureBtnText}>Measure</Text>
              </Pressable>
            </>
          )}
        </View>
      )}
    </View>
  );
}

function _DimCell({ label, value, colors }: { label: string; value: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={spatialStyles.dimCell}>
      <Text style={[spatialStyles.dimLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[spatialStyles.dimValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

const spatialStyles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  title: {
    color: "#17c4d3",
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    flex: 1,
  },
  depthBadge: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
  },
  idle: {
    gap: 10,
  },
  idleText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 18,
  },
  measureBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#17c4d3",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    alignSelf: "flex-start",
  },
  measureBtnText: {
    color: "#fff",
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
  },
  results: {
    gap: 8,
  },
  dimRow: {
    flexDirection: "row",
    gap: 8,
  },
  dimCell: {
    flex: 1,
    gap: 2,
    alignItems: "center",
    backgroundColor: "rgba(23,196,211,0.06)",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 6,
  },
  dimLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  dimValue: {
    fontFamily: "Inter_700Bold",
    fontSize: 15,
  },
  remeasureBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-end",
  },
  remeasureText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
  },
  confRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  confDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  confLabel: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    flex: 1,
  },
  warningRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: "rgba(245,158,11,0.10)",
    borderRadius: 7,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  warningText: {
    color: "#f59e0b",
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    flex: 1,
    lineHeight: 16,
  },
  /** Shown in place of the Measure button when a clipped reference is active. */
  clippedGate: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    backgroundColor: "rgba(245,158,11,0.12)",
    borderRadius: 9,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.35)",
  },
  clippedGateText: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    lineHeight: 17,
    flex: 1,
  },
});

// ─── Per-device row ───────────────────────────────────────────────────────────

interface DeviceRowProps {
  provider:             DeviceProvider;
  measurementProvider:  MeasurementDeviceProvider | undefined;
  onStamp?:             (reading: MeasurementReading) => void;
  /** Fires when this device's active state (connected OR connecting) changes. */
  onConnectionChange?:  (id: string, isActive: boolean) => void;
  /** Fires whenever a distance sensor reading arrives (depth in metres). */
  onDistanceReading?:   (depthMeters: number) => void;
}

function DeviceRow({ provider, measurementProvider, onStamp, onConnectionChange, onDistanceReading }: DeviceRowProps) {
  const colors     = useColors();
  const tokens     = provider.capabilities.tokens;
  const isDistance = tokens.includes("sensor.distance");

  const [connected,  setConnected]  = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [reading,    setReading]    = useState<MeasurementReading | null>(null);
  const [error,      setError]      = useState<string | null>(null);
  const [live,       setLive]       = useState(false);

  const unsubRef = useRef<(() => void) | null>(null);
  const pulseOpacity = usePulse(live);

  // ── Report active state to panel ───────────────────────────────────────────

  const isActive = connected || connecting;
  const prevActiveRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (prevActiveRef.current !== isActive) {
      prevActiveRef.current = isActive;
      onConnectionChange?.(provider.id, isActive);
    }
  }, [isActive, provider.id, onConnectionChange]);

  // ── Subscription management ─────────────────────────────────────────────────

  const startLive = useCallback(() => {
    if (!measurementProvider || !connected) return;
    unsubRef.current?.();
    unsubRef.current = measurementProvider.subscribe((r) => {
      setReading(r);
      // Propagate depth readings to the panel for the spatial card.
      if (isDistance && r.kind === "distance") {
        onDistanceReading?.(r.value);
      }
    });
    setLive(true);
  }, [measurementProvider, connected, isDistance, onDistanceReading]);

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
  /**
   * Fired whenever the number of active (connected or connecting) devices
   * changes. The parent screen uses this to expand the camera pane when
   * no sensor drawer is open.
   */
  onActiveCountChange?: (count: number) => void;
  /**
   * Pixel-space vertices of the technician's camera-overlay ROI gesture.
   * When provided they are forwarded to SpatialMeasurementCard so that
   * clipping detection runs against the actual framed region rather than
   * the default placeholder quad.
   * Typically produced by the camera overlay drag handler in new-inspection.tsx.
   */
  roiVertices?: Array<{ x: number; y: number }>;
  /**
   * Width of the camera preview in logical pixels.
   * Forwarded to SpatialMeasurementCard for edge-clipping detection.
   * Falls back to useWindowDimensions when omitted.
   */
  viewportWidth?: number;
  /**
   * Height of the camera preview in logical pixels.
   * Forwarded to SpatialMeasurementCard for edge-clipping detection.
   * Falls back to useWindowDimensions when omitted.
   */
  viewportHeight?: number;
  /**
   * When true the Measure button inside SpatialMeasurementCard is blocked and
   * a warning is shown in its place.  Set by new-inspection.tsx as soon as the
   * technician's two-tap reference selection lands on or past the frame edge.
   */
  referenceClipped?: boolean;
  /**
   * Effective focal length (px) for the current camera source.
   * When the active source is Meta Ray-Ban glasses, pass the focal length
   * derived from the stored BasicCalibrationProfile.
   * Defaults to 800 px (typical phone wide-angle) when omitted.
   */
  glassesFocalLengthPx?: number;
}

export function MeasurementDevicePanel({
  onStamp,
  onActiveCountChange,
  roiVertices,
  viewportWidth,
  viewportHeight,
  referenceClipped = false,
  glassesFocalLengthPx,
}: MeasurementDevicePanelProps = {}) {
  const { registry, plugin } = useDeviceRegistry();
  const colors  = useColors();
  const sensors = registry.findByCategory("sensor");

  // Track which device IDs are currently active (connected or connecting).
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());

  // When true, all registered sensors are shown (including disconnected ones)
  // so the technician can initiate a new connection mid-inspection.
  const [showAll, setShowAll] = useState(false);

  // Latest depth reading from any connected distance sensor (metres).
  // Drives SpatialMeasurementCard when non-null.
  const [liveDepthMeters, setLiveDepthMeters] = useState<number | null>(null);

  const handleConnectionChange = useCallback((id: string, isActive: boolean) => {
    setActiveIds((prev) => {
      const next = new Set(prev);
      if (isActive) next.add(id); else next.delete(id);
      return next;
    });
  }, []);

  // Notify parent of active count changes.
  const activeCount = activeIds.size;
  useEffect(() => {
    onActiveCountChange?.(activeCount);
  }, [activeCount, onActiveCountChange]);

  // Nothing to show — no sensors registered at all.
  if (sensors.length === 0) return null;

  // Collapse back to active-only view once the user has connected a device.
  const inactiveCount = sensors.length - activeCount;
  const visibleSensors = showAll ? sensors : sensors.filter((s) => activeIds.has(s.id));

  return (
    <View style={styles.panel}>
      {/* Panel header — always visible */}
      <View style={styles.panelHeader}>
        <Ionicons name="hardware-chip-outline" size={16} color="#17c4d3" />
        <Text style={styles.panelTitle}>Measurement Devices</Text>

        {/* "X available" toggle — shows when some sensors are inactive */}
        {inactiveCount > 0 && (
          <Pressable
            onPress={() => setShowAll((v) => !v)}
            style={styles.availableToggle}
            hitSlop={8}
          >
            <Ionicons
              name={showAll ? "chevron-up" : "add-circle-outline"}
              size={15}
              color={colors.mutedForeground}
            />
            <Text style={[styles.availableText, { color: colors.mutedForeground }]}>
              {showAll ? "Hide inactive" : `${inactiveCount} available`}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Active (and optionally all) device rows */}
      {visibleSensors.map((p) => (
        <DeviceRow
          key={p.id}
          provider={p}
          measurementProvider={plugin.getMeasurementDevice(p.id)}
          onStamp={onStamp}
          onConnectionChange={handleConnectionChange}
          onDistanceReading={setLiveDepthMeters}
        />
      ))}

      {/* Spatial measurement card — visible once a distance sensor provides depth.
          referenceClipped blocks the Measure button until the technician
          re-centres their reference object selection.
          glassesFocalLengthPx overrides the 800 px default when the active
          camera source is Meta Ray-Ban glasses. */}
      {liveDepthMeters !== null && (
        <SpatialMeasurementCard
          depthMeters={liveDepthMeters}
          colors={colors}
          focalLengthPx={glassesFocalLengthPx}
          roiVertices={roiVertices}
          viewportWidth={viewportWidth}
          viewportHeight={viewportHeight}
          referenceClipped={referenceClipped}
        />
      )}

      {/* Empty state — no active devices and "show all" is off */}
      {visibleSensors.length === 0 && !showAll && (
        <Pressable
          onPress={() => setShowAll(true)}
          style={[styles.emptyRow, { borderColor: colors.border }]}
        >
          <Ionicons name="bluetooth-outline" size={16} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No active sensors · tap to connect a device
          </Text>
          <Ionicons name="chevron-forward" size={14} color={colors.mutedForeground} />
        </Pressable>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  panel:       { gap: 10 },
  panelHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  panelTitle: {
    color: "#17c4d3",
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    letterSpacing: 0.3,
    flex: 1,
  },
  availableToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  availableText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
  },

  emptyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  emptyText: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    flex: 1,
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
