/**
 * MeasureModeOverlay — full-screen camera overlay for hardware-free spatial
 * measurement ("Measure" mode on the inspection camera screen).
 *
 * ─── Flow ─────────────────────────────────────────────────────────────────────
 *   1. Technician frames the subject with a draggable quad (area/width/height)
 *      OR taps "Gap / Crack" to switch to a two-endpoint line for narrow spans.
 *   2. Technician picks a reference object (credit card / outlet plate / coin)
 *      and drags the reference bounding box to fit the object in the preview.
 *   3. "Capture & Measure" triggers a 3–5 frame burst in the parent screen,
 *      which runs BurstMeasurementPipeline (FallbackSfMProvider +
 *      ReferenceScaleAnchor) on the JS thread and passes the result back in.
 *   4. Width / height / area appear inline; "Stamp" hands the result to the
 *      parent (same measurement-bridge path as MeasurementDevicePanel.onStamp)
 *      so it attaches to the next captured photo's finding record.
 *
 * ─── Clipping guard ───────────────────────────────────────────────────────────
 * When the reference box touches a preview edge the pixel span understates the
 * true object width, silently drifting the scale factor. The Measure button is
 * blocked and an amber warning is shown until the box is re-centred (mirrors
 * ReferenceScaleAnchor.clipped and the two-tap Select Ref flow).
 *
 * All geometry is in logical preview pixels; the reference box is normalised
 * to 0–1 coords before being handed to the parent (BoundingRegion contract).
 */

import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Line, Polygon, Rect } from "react-native-svg";

import type {
  BoundingRegion,
  BurstMeasurementResult,
  ReferenceObject,
} from "@platform/measurement-core";
import { REFERENCE_OBJECTS } from "@platform/measurement-core";

// ─── Reference-object catalogue for the picker ────────────────────────────────
// Outlet plate is not in the platform catalogue; standard US single-gang cover
// is 2.75 in × 4.5 in (69.9 mm × 114.3 mm).
const OUTLET_PLATE: ReferenceObject = { kind: "custom", widthMm: 69.9, heightMm: 114.3 };

const REF_CHOICES: Array<{ id: string; label: string; icon: keyof typeof Ionicons.glyphMap; object: ReferenceObject }> = [
  { id: "credit_card",  label: "Credit card",  icon: "card-outline",   object: REFERENCE_OBJECTS["credit_card"] },
  { id: "outlet_plate", label: "Outlet plate", icon: "apps-outline",   object: OUTLET_PLATE },
  { id: "coin_quarter", label: "Coin (25¢)",   icon: "ellipse-outline", object: REFERENCE_OBJECTS["coin_quarter"] },
];

type Pt = { x: number; y: number };
type TargetMode = "quad" | "line";

export interface MeasureModeOverlayProps {
  /** Camera preview width in logical pixels. */
  viewportWidth: number;
  /** Camera preview height in logical pixels. */
  viewportHeight: number;
  /** True while the burst capture + pipeline run is in flight. */
  measuring: boolean;
  /** Latest pipeline result, or null before the first run / after clearing. */
  result: BurstMeasurementResult | null;
  /**
   * Kick off the burst measurement. `targetVertices` are absolute preview px;
   * `reference.box` is a normalised (0–1) BoundingRegion.
   */
  onMeasure: (
    targetVertices: Pt[],
    reference: { box: BoundingRegion; object: ReferenceObject },
  ) => void;
  /** Stamp the current result into the inspection (measurement bridge). */
  onStamp: () => void;
  /** Discard the current result and return to framing. */
  onClearResult: () => void;
  /** Exit Measure mode entirely. */
  onClose: () => void;
}

// ─── Draggable handle ─────────────────────────────────────────────────────────

const HANDLE_SIZE = 30;

function DragHandle({
  point,
  onChange,
  clampW,
  clampH,
  color = "#17c4d3",
  shape = "circle",
}: {
  point: Pt;
  onChange: (p: Pt) => void;
  clampW: number;
  clampH: number;
  color?: string;
  shape?: "circle" | "square";
}) {
  const pointRef = useRef(point);
  pointRef.current = point;
  const startRef = useRef(point);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const clampRef = useRef({ w: clampW, h: clampH });
  clampRef.current = { w: clampW, h: clampH };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          startRef.current = pointRef.current;
        },
        onPanResponderMove: (_e, g) => {
          onChangeRef.current({
            x: Math.max(0, Math.min(clampRef.current.w, startRef.current.x + g.dx)),
            y: Math.max(0, Math.min(clampRef.current.h, startRef.current.y + g.dy)),
          });
        },
      }),
    [],
  );

  return (
    <View
      {...pan.panHandlers}
      style={{
        position: "absolute",
        left: point.x - HANDLE_SIZE / 2,
        top: point.y - HANDLE_SIZE / 2,
        width: HANDLE_SIZE,
        height: HANDLE_SIZE,
        borderRadius: shape === "circle" ? HANDLE_SIZE / 2 : 6,
        borderWidth: 2,
        borderColor: color,
        backgroundColor: "rgba(0,0,0,0.35)",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

// ─── Overlay ──────────────────────────────────────────────────────────────────

export function MeasureModeOverlay({
  viewportWidth: vpW,
  viewportHeight: vpH,
  measuring,
  result,
  onMeasure,
  onStamp,
  onClearResult,
  onClose,
}: MeasureModeOverlayProps) {
  const [targetMode, setTargetMode] = useState<TargetMode>("quad");

  // Target quad — initial centred region (order: TL, TR, BR, BL so vertices
  // 0→1 is the width edge and 0→3 the height edge, matching the pipeline).
  const [quad, setQuad] = useState<Pt[]>(() => [
    { x: vpW * 0.28, y: vpH * 0.22 },
    { x: vpW * 0.72, y: vpH * 0.22 },
    { x: vpW * 0.72, y: vpH * 0.5 },
    { x: vpW * 0.28, y: vpH * 0.5 },
  ]);

  // Gap/crack line — two endpoints.
  const [line, setLine] = useState<Pt[]>(() => [
    { x: vpW * 0.35, y: vpH * 0.38 },
    { x: vpW * 0.65, y: vpH * 0.38 },
  ]);

  // Reference object selection + drag-to-fit box (top-left + bottom-right).
  const [refId, setRefId] = useState<string>("credit_card");
  const refChoice = REF_CHOICES.find((c) => c.id === refId) ?? REF_CHOICES[0];
  const [refTL, setRefTL] = useState<Pt>(() => ({ x: vpW * 0.34, y: vpH * 0.62 }));
  const [refBR, setRefBR] = useState<Pt>(() => ({ x: vpW * 0.66, y: vpH * 0.74 }));

  const refBoxPx = useMemo(() => {
    const x = Math.min(refTL.x, refBR.x);
    const y = Math.min(refTL.y, refBR.y);
    return {
      x,
      y,
      width: Math.abs(refBR.x - refTL.x),
      height: Math.abs(refBR.y - refTL.y),
    };
  }, [refTL, refBR]);

  // Clipping: reference box touching (within 2 px of) any preview edge means
  // the pixel span understates the true object width — block measuring.
  const EDGE = 2;
  const referenceClipped =
    refBoxPx.x <= EDGE ||
    refBoxPx.y <= EDGE ||
    refBoxPx.x + refBoxPx.width >= vpW - EDGE ||
    refBoxPx.y + refBoxPx.height >= vpH - EDGE;

  // Degenerate-geometry guard: the two reference corners drag independently,
  // so they can be (nearly) aligned while staying away from the edges.  A
  // near-zero pixel width would make ReferenceScaleAnchor divide by ~0 and
  // produce Infinity/NaN dimensions that look stampable.  Require a meaningful
  // minimum span on both axes before Capture & Measure is allowed.
  const MIN_REF_SPAN_PX = 24;
  const referenceTooSmall =
    refBoxPx.width < MIN_REF_SPAN_PX || refBoxPx.height < MIN_REF_SPAN_PX;

  const measureBlocked = referenceClipped || referenceTooSmall;

  const targetVertices = targetMode === "quad" ? quad : line;

  const handleMeasurePress = useCallback(() => {
    if (measuring || measureBlocked) return;
    onMeasure(targetVertices, {
      box: {
        x: refBoxPx.x / vpW,
        y: refBoxPx.y / vpH,
        width: refBoxPx.width / vpW,
        height: refBoxPx.height / vpH,
      },
      object: refChoice.object,
    });
  }, [measuring, measureBlocked, onMeasure, targetVertices, refBoxPx, vpW, vpH, refChoice]);

  const setQuadCorner = useCallback((i: number) => (p: Pt) => {
    setQuad((prev) => prev.map((v, idx) => (idx === i ? p : v)));
  }, []);
  const setLineEnd = useCallback((i: number) => (p: Pt) => {
    setLine((prev) => prev.map((v, idx) => (idx === i ? p : v)));
  }, []);

  const showFraming = result == null;

  return (
    // pointerEvents="auto" (default) on a full-screen root claims the entire
    // hit-test region, so the camera controls underneath cannot be tapped
    // while Measure mode is open — the overlay is truly modal.
    <View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.001)" }]}>
      {/* Geometry render layer (non-interactive) */}
      <Svg
        width={vpW}
        height={vpH}
        style={{ position: "absolute", top: 0, left: 0 }}
        pointerEvents="none"
      >
        {showFraming && targetMode === "quad" && (
          <Polygon
            points={quad.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="rgba(23,196,211,0.10)"
            stroke="#17c4d3"
            strokeWidth={2}
          />
        )}
        {showFraming && targetMode === "line" && (
          <Line
            x1={line[0].x}
            y1={line[0].y}
            x2={line[1].x}
            y2={line[1].y}
            stroke="#17c4d3"
            strokeWidth={3}
            strokeDasharray="6 4"
          />
        )}
        {showFraming && (
          <Rect
            x={refBoxPx.x}
            y={refBoxPx.y}
            width={refBoxPx.width}
            height={refBoxPx.height}
            fill={referenceClipped ? "rgba(245,158,11,0.12)" : "rgba(255,255,255,0.06)"}
            stroke={referenceClipped ? "#f59e0b" : "#ffffff"}
            strokeWidth={2}
            strokeDasharray="8 5"
          />
        )}
      </Svg>

      {/* Drag handles */}
      {showFraming && targetMode === "quad" &&
        quad.map((p, i) => (
          <DragHandle key={`q${i}`} point={p} onChange={setQuadCorner(i)} clampW={vpW} clampH={vpH} />
        ))}
      {showFraming && targetMode === "line" &&
        line.map((p, i) => (
          <DragHandle key={`l${i}`} point={p} onChange={setLineEnd(i)} clampW={vpW} clampH={vpH} />
        ))}
      {showFraming && (
        <>
          <DragHandle
            point={refTL}
            onChange={setRefTL}
            clampW={vpW}
            clampH={vpH}
            color={referenceClipped ? "#f59e0b" : "#ffffff"}
            shape="square"
          />
          <DragHandle
            point={refBR}
            onChange={setRefBR}
            clampW={vpW}
            clampH={vpH}
            color={referenceClipped ? "#f59e0b" : "#ffffff"}
            shape="square"
          />
        </>
      )}

      {/* Top bar: title + close */}
      <View style={styles.topBar}>
        <View style={styles.titlePill}>
          <Ionicons name="resize-outline" size={14} color="#17c4d3" />
          <Text style={styles.titleText}>Measure</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
          <Ionicons name="close" size={20} color="#fff" />
        </Pressable>
      </View>

      {/* Bottom control sheet */}
      <View style={styles.sheet}>
        {result ? (
          // ── Results ────────────────────────────────────────────────────────
          <View style={{ gap: 10 }}>
            <View style={styles.confRow}>
              <View
                style={[
                  styles.confDot,
                  { backgroundColor: result.confidence >= 0.5 ? "#22c55e" : "#f59e0b" },
                ]}
              />
              <Text style={styles.confText}>
                {result.confidence >= 0.5
                  ? `Confidence ${Math.round(result.confidence * 100)}%`
                  : `Low confidence (${Math.round(result.confidence * 100)}%) — result may be inaccurate`}
              </Text>
            </View>
            {result.warnings.map((w, i) => (
              <View key={i} style={styles.warningRow}>
                <Ionicons name="warning-outline" size={13} color="#f59e0b" />
                <Text style={styles.warningText}>{w}</Text>
              </View>
            ))}
            <View style={styles.dimRow}>
              <View style={styles.dimCell}>
                <Text style={styles.dimLabel}>Width</Text>
                <Text style={styles.dimValue}>{result.widthInches} in</Text>
              </View>
              <View style={styles.dimCell}>
                <Text style={styles.dimLabel}>Height</Text>
                <Text style={styles.dimValue}>
                  {result.heightInches > 0 ? `${result.heightInches} in` : "—"}
                </Text>
              </View>
              <View style={styles.dimCell}>
                <Text style={styles.dimLabel}>Area</Text>
                <Text style={styles.dimValue}>
                  {result.areaSqInches > 0 ? `${result.areaSqInches} in²` : "—"}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable onPress={onClearResult} style={[styles.secondaryBtn, { flex: 1 }]}>
                <Ionicons name="refresh-outline" size={14} color="#fff" />
                <Text style={styles.secondaryBtnText}>Re-measure</Text>
              </Pressable>
              <Pressable onPress={onStamp} style={[styles.primaryBtn, { flex: 1 }]}>
                <Ionicons name="pin-outline" size={14} color="#fff" />
                <Text style={styles.primaryBtnText}>Stamp</Text>
              </Pressable>
            </View>
            <Text style={styles.hintText}>
              Stamp attaches these dimensions to your next captured photo.
            </Text>
          </View>
        ) : (
          // ── Framing controls ──────────────────────────────────────────────
          <View style={{ gap: 10 }}>
            {/* Target mode toggle */}
            <View style={styles.segmentRow}>
              <Pressable
                onPress={() => setTargetMode("quad")}
                style={[styles.segment, targetMode === "quad" && styles.segmentActive]}
              >
                <Ionicons name="scan-outline" size={13} color={targetMode === "quad" ? "#17c4d3" : "#9ca3af"} />
                <Text style={[styles.segmentText, targetMode === "quad" && styles.segmentTextActive]}>
                  Area
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setTargetMode("line")}
                style={[styles.segment, targetMode === "line" && styles.segmentActive]}
              >
                <Ionicons name="remove-outline" size={13} color={targetMode === "line" ? "#17c4d3" : "#9ca3af"} />
                <Text style={[styles.segmentText, targetMode === "line" && styles.segmentTextActive]}>
                  Gap / Crack
                </Text>
              </Pressable>
            </View>

            {/* Reference picker */}
            <View style={styles.refRow}>
              {REF_CHOICES.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => setRefId(c.id)}
                  style={[styles.refChip, refId === c.id && styles.refChipActive]}
                >
                  <Ionicons name={c.icon} size={13} color={refId === c.id ? "#17c4d3" : "#9ca3af"} />
                  <Text style={[styles.refChipText, refId === c.id && styles.refChipTextActive]}>
                    {c.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            {measureBlocked ? (
              <View style={styles.warningRow}>
                <Ionicons name="warning" size={14} color="#f59e0b" />
                <Text style={styles.warningText}>
                  {referenceClipped
                    ? "Reference box touches the frame edge — re-centre it before measuring"
                    : "Reference box is too small — drag the corners apart to fit the object"}
                </Text>
              </View>
            ) : (
              <Text style={styles.hintText}>
                Drag the cyan {targetMode === "quad" ? "corners around the subject" : "endpoints across the gap"},
                then fit the white box over your {refChoice.label.toLowerCase()}.
              </Text>
            )}

            <Pressable
              onPress={handleMeasurePress}
              disabled={measuring || measureBlocked}
              style={[
                styles.primaryBtn,
                (measuring || measureBlocked) && { opacity: 0.5 },
              ]}
            >
              {measuring ? (
                <>
                  <ActivityIndicator size="small" color="#fff" />
                  <Text style={styles.primaryBtnText}>Capturing burst…</Text>
                </>
              ) : (
                <>
                  <Ionicons name="camera-outline" size={15} color="#fff" />
                  <Text style={styles.primaryBtnText}>Capture &amp; Measure</Text>
                </>
              )}
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  topBar: {
    position: "absolute",
    top: 56,
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  titlePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(23,196,211,0.5)",
  },
  titleText: { color: "#17c4d3", fontFamily: "Inter_600SemiBold", fontSize: 13 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },

  sheet: {
    position: "absolute",
    bottom: 16,
    left: 12,
    right: 12,
    backgroundColor: "rgba(0,0,0,0.78)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    padding: 12,
  },

  segmentRow: { flexDirection: "row", gap: 8 },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  segmentActive: { borderColor: "#17c4d3", backgroundColor: "rgba(23,196,211,0.12)" },
  segmentText: { color: "#9ca3af", fontFamily: "Inter_600SemiBold", fontSize: 12 },
  segmentTextActive: { color: "#17c4d3" },

  refRow: { flexDirection: "row", gap: 6 },
  refChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },
  refChipActive: { borderColor: "#17c4d3", backgroundColor: "rgba(23,196,211,0.12)" },
  refChipText: { color: "#9ca3af", fontFamily: "Inter_500Medium", fontSize: 10.5 },
  refChipTextActive: { color: "#17c4d3" },

  hintText: {
    color: "rgba(255,255,255,0.65)",
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    lineHeight: 16,
  },

  warningRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: "rgba(245,158,11,0.12)",
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 9,
  },
  warningText: {
    color: "#f59e0b",
    fontFamily: "Inter_500Medium",
    fontSize: 11.5,
    lineHeight: 16,
    flex: 1,
  },

  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "#17c4d3",
    borderRadius: 10,
    paddingVertical: 11,
  },
  primaryBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 10,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  secondaryBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },

  confRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  confDot: { width: 8, height: 8, borderRadius: 4 },
  confText: { color: "rgba(255,255,255,0.8)", fontFamily: "Inter_400Regular", fontSize: 11.5, flex: 1 },

  dimRow: { flexDirection: "row", gap: 8 },
  dimCell: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    backgroundColor: "rgba(23,196,211,0.10)",
    borderRadius: 8,
    paddingVertical: 8,
  },
  dimLabel: {
    color: "rgba(255,255,255,0.55)",
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  dimValue: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 },
});
