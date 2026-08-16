/**
 * useMeasurementScaling
 *
 * React hook that wires the interactive reference-scaling UI to the
 * BurstMeasurementManager computation layer.
 *
 * ─── Workflow ───────────────────────────────────────────────────────────────
 *
 *   1. Technician drags across a known reference object (e.g. credit card):
 *        handleReferenceSelected(p1, p2)
 *
 *   2. Technician drags across the target dimension (e.g. crack width):
 *        handleTargetSelected(p1, p2, depthMeters, focalLengthPx)
 *        → computes and stores BlendedMeasurementResult
 *
 *   3. Optionally drag a second pair for height:
 *        handleHeightSelected(p1, p2, depthMeters, focalLengthPx)
 *        → re-runs computation and populates heightMm
 *
 *   4. Call clearMeasurement() to reset between subjects.
 *
 * ─── Reference object ───────────────────────────────────────────────────────
 *   Defaults to a credit card (85.6 mm).
 *   Call setReferenceObject(REFERENCE_OBJECTS.coin_quarter) to switch, or
 *   supply any {widthMm} object.
 *
 * ─── Depth source ───────────────────────────────────────────────────────────
 *   Pass `depthMeters` from a connected BLE laser distance meter
 *   (available via useMeasurementBridge / MeasurementDevicePanel) for highest
 *   accuracy, or from BurstMeasurementPipeline's ReferenceScaleAnchor when
 *   running fully software-based.
 */

import { useCallback, useRef, useState } from "react";

import { REFERENCE_OBJECTS } from "@platform/measurement-core";

import {
  burstMeasurementManager,
  type BlendedMeasurementResult,
} from "@/lib/measurement/BurstMeasurementManager";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Point {
  x: number;
  y: number;
}

interface ReferenceObjectSpec {
  widthMm: number;
  label?: string;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMeasurementScaling(options?: {
  /** Initial reference object. Defaults to credit card (85.6 mm). */
  initialReference?: ReferenceObjectSpec;
  /** Camera focal length in pixels. Defaults to 800. */
  focalLengthPx?: number;
  /**
   * Native image dimensions used for reference-clipping detection.
   * When provided, `computeScaledDimensions` checks whether either reference
   * endpoint lies at an image edge (within 2 px) and emits a warning if so.
   * Typically the full-resolution JPEG size from expo-camera (e.g. 4032×3024).
   */
  imageDimensions?: { w: number; h: number };
}) {
  const focalLengthPx = options?.focalLengthPx ?? 800;
  const imageDimensions = options?.imageDimensions;

  // ── Reference object ───────────────────────────────────────────────────────
  const [referenceObject, setReferenceObject] = useState<ReferenceObjectSpec>(
    options?.initialReference ?? {
      widthMm: REFERENCE_OBJECTS["credit_card"].widthMm,
      label:   "Credit card",
    },
  );

  // ── Tap/drag state ────────────────────────────────────────────────────────
  const [refPoints,    setRefPoints]    = useState<Point[]>([]);
  const [targetPoints, setTargetPoints] = useState<Point[]>([]);
  const [heightPoints, setHeightPoints] = useState<Point[]>([]);

  // ── Result ────────────────────────────────────────────────────────────────
  const [result, setResult] = useState<BlendedMeasurementResult | null>(null);

  // Internal: the last known depth + height endpoints for re-computation
  const lastDepthRef = useRef<number>(1.5);
  const heightPtsRef = useRef<{ p1: Point; p2: Point } | null>(null);

  // ── Computation helper ────────────────────────────────────────────────────

  const _compute = useCallback(
    (
      widthP1: Point,
      widthP2: Point,
      refP1: Point,
      refP2: Point,
      depthMeters: number,
      hp1?: Point,
      hp2?: Point,
    ) => {
      const refPixelLength = Math.hypot(refP2.x - refP1.x, refP2.y - refP1.y);
      if (refPixelLength < 2) return; // reference too short — ignore

      const computed = burstMeasurementManager.computeScaledDimensions(
        widthP1,
        widthP2,
        referenceObject.widthMm,
        refPixelLength,
        depthMeters,
        focalLengthPx,
        hp1,
        hp2,
        // Pass reference endpoints + image dimensions so the manager can
        // detect whether the reference object was partially out of frame.
        imageDimensions
          ? {
              referenceP1:  refP1,
              referenceP2:  refP2,
              imageWidthPx: imageDimensions.w,
              imageHeightPx: imageDimensions.h,
            }
          : undefined,
      );
      setResult(computed);
    },
    [referenceObject.widthMm, focalLengthPx, imageDimensions],
  );

  // ── Public handlers ───────────────────────────────────────────────────────

  /**
   * Call when the technician finishes dragging across the reference object.
   * If a target was already set, immediately re-computes dimensions.
   */
  const handleReferenceSelected = useCallback(
    (p1: Point, p2: Point) => {
      setRefPoints([p1, p2]);

      if (targetPoints.length === 2) {
        _compute(
          targetPoints[0], targetPoints[1],
          p1, p2,
          lastDepthRef.current,
          heightPtsRef.current?.p1,
          heightPtsRef.current?.p2,
        );
      }
    },
    [targetPoints, _compute],
  );

  /**
   * Call when the technician finishes dragging across the target dimension.
   * Triggers a fresh dimension computation if a reference is already set.
   *
   * @param p1            Near endpoint of the target.
   * @param p2            Far endpoint of the target.
   * @param depthMeters   Subject depth (from BLE laser or SfM anchor).
   * @param focalLPx      Override focal length for this call (optional).
   */
  const handleTargetSelected = useCallback(
    (p1: Point, p2: Point, depthMeters: number, focalLPx?: number) => {
      setTargetPoints([p1, p2]);
      lastDepthRef.current = depthMeters;

      if (refPoints.length === 2) {
        _compute(
          p1, p2,
          refPoints[0], refPoints[1],
          depthMeters,
          heightPtsRef.current?.p1,
          heightPtsRef.current?.p2,
        );
      }
    },
    [refPoints, _compute],
  );

  /**
   * Call when the technician drags a second pair for height measurement.
   * Adds heightMm to the existing result without clearing widthMm.
   */
  const handleHeightSelected = useCallback(
    (p1: Point, p2: Point, depthMeters?: number) => {
      setHeightPoints([p1, p2]);
      heightPtsRef.current = { p1, p2 };
      const depth = depthMeters ?? lastDepthRef.current;

      if (refPoints.length === 2 && targetPoints.length === 2) {
        _compute(
          targetPoints[0], targetPoints[1],
          refPoints[0],    refPoints[1],
          depth,
          p1, p2,
        );
      }
    },
    [refPoints, targetPoints, _compute],
  );

  /** Reset all drag points and the computed result. */
  const clearMeasurement = useCallback(() => {
    setRefPoints([]);
    setTargetPoints([]);
    setHeightPoints([]);
    setResult(null);
    heightPtsRef.current = null;
  }, []);

  return {
    // ── State ────────────────────────────────────────────────────────────
    refPoints,
    targetPoints,
    heightPoints,
    result,
    referenceObject,

    // ── Actions ──────────────────────────────────────────────────────────
    setReferenceObject,
    handleReferenceSelected,
    handleTargetSelected,
    handleHeightSelected,
    clearMeasurement,

    // ── Derived ──────────────────────────────────────────────────────────
    isReady:        refPoints.length === 2,
    hasMeasurement: result !== null,
    /** Warnings from the last computation (empty array when none). */
    warnings:       result?.warnings ?? [],
    /** True when the last computation detected a clipped reference object. */
    referenceClipped: result?.clipped ?? false,
  };
}
