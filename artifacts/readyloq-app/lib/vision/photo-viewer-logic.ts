/**
 * Pure utility functions that drive the full-screen photo viewer in
 * InspectionDetail.tsx (#110 / #117).
 *
 * Extracting these from the component makes them importable by unit tests so
 * that test coverage is directly coupled to production behaviour.
 */

/** Minimum allowed zoom level (1× = no zoom). */
export const VIEWER_MIN_SCALE = 1;

/** Maximum allowed zoom level (8× = maximum pinch-in zoom). */
export const VIEWER_MAX_SCALE = 8;

/**
 * Compute the new live scale during a pinch gesture.
 *
 * Mirrors the Gesture.Pinch().onUpdate() handler:
 *   viewerScale.value = clampZoom(viewerBaseScale.value, e.scale)
 *
 * @param baseScale  The scale committed at the end of the previous pinch gesture.
 * @param gestureScale The raw `e.scale` from the pinch event (ratio relative to
 *                     the gesture start, not accumulated).
 * @returns Clamped scale in [VIEWER_MIN_SCALE, VIEWER_MAX_SCALE].
 */
export function clampZoom(baseScale: number, gestureScale: number): number {
  "worklet";
  return Math.max(VIEWER_MIN_SCALE, Math.min(baseScale * gestureScale, VIEWER_MAX_SCALE));
}

/**
 * Compute the new live translation on one axis during a pan gesture.
 *
 * Mirrors both the X and Y branches of Gesture.Pan().onUpdate():
 *   const maxX = (screenW * (scale - 1)) / 2;
 *   viewerTranslateX.value = clampViewerTranslation(viewerBaseTX.value, e.translationX, screenW, scale)
 *
 * @param baseTN       The translation committed at the end of the previous pan gesture.
 * @param translationN The raw `e.translationX` / `e.translationY` from the pan event.
 * @param screenDim    Screen width (for X) or screen height (for Y).
 * @param scale        Current zoom level — larger zoom = larger pan boundary.
 * @returns Clamped translation in [−max, +max] where max = (screenDim * (scale − 1)) / 2.
 */
export function clampViewerTranslation(
  baseTN: number,
  translationN: number,
  screenDim: number,
  scale: number,
): number {
  "worklet";
  const max = (screenDim * (scale - 1)) / 2;
  return Math.max(-max, Math.min(baseTN + translationN, max));
}

/**
 * Commit the live scale as the new base at the end of a pinch gesture.
 *
 * Mirrors Gesture.Pinch().onEnd():
 *   viewerBaseScale.value = commitPinch(viewerScale.value)
 */
export function commitPinch(liveScale: number): number {
  "worklet";
  return liveScale;
}

/**
 * Commit the live translations as the new bases at the end of a pan gesture.
 *
 * Mirrors Gesture.Pan().onEnd():
 *   viewerBaseTX.value = commitPan(viewerTranslateX.value)
 *   viewerBaseTY.value = commitPan(viewerTranslateY.value)
 */
export function commitPan(liveTranslation: number): number {
  "worklet";
  return liveTranslation;
}

/**
 * The identity (reset) transform that the viewer returns to when:
 *  - the double-tap gesture fires, or
 *  - the viewer closes (viewerPath → null useEffect).
 *
 * All shared-value targets in InspectionDetail.tsx ultimately land on these
 * values (immediately on close, via withTiming on double-tap).
 */
export interface ViewerResetTransform {
  scale: number;
  baseScale: number;
  translateX: number;
  translateY: number;
  baseTX: number;
  baseTY: number;
}

/** Returns the identity transform that represents "no zoom, centred". */
export function viewerIdentityTransform(): ViewerResetTransform {
  "worklet";
  return {
    scale: VIEWER_MIN_SCALE,
    baseScale: VIEWER_MIN_SCALE,
    translateX: 0,
    translateY: 0,
    baseTX: 0,
    baseTY: 0,
  };
}
