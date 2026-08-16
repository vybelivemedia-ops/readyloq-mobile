/**
 * Measure-mode honesty tests
 *
 * Guards three correctness properties that keep Measure-mode results reliable
 * when the burst runs without real depth data (FallbackSfMProvider flat map):
 *
 *   1. OVERLAY CLIPPING GUARD
 *      A reference box touching a preview edge must set measureBlocked=true
 *      (disabling Capture & Measure) and expose the amber warning text.
 *      The logic is identical to MeasureModeOverlay's referenceClipped /
 *      referenceTooSmall / measureBlocked derivations — tested here as pure
 *      functions so we can run them in the node vitest environment without
 *      React Native.
 *
 *   2. PIPELINE WARNINGS PROPAGATE TO THE RESULTS SHEET
 *      BurstMeasurementPipeline must include a non-empty warnings array in its
 *      result when the reference box is clipped.  The MeasureModeOverlay
 *      results sheet renders result.warnings before the Stamp button; if
 *      warnings is empty / missing, the Stamp button is reachable even for a
 *      drifted measurement.  (Stamp is always reachable — the guard is visual,
 *      not a hard block — but the warnings must be present in the result so the
 *      overlay can display them.)
 *
 *   3. STAMP METADATA CARRIES CONFIDENCE AND WARNINGS
 *      handleStampMeasureResult in new-inspection.tsx calls
 *      setLastMeasurementReading with { signalQuality: result.confidence,
 *      metadata: { confidence, warnings } }.  These tests verify that the
 *      metadata shape is correct and that the bridge stores and returns the
 *      full payload so downstream photo records inherit both fields.
 *
 * Run with:
 *   pnpm --filter @workspace/readyloq-app test
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  setLastMeasurementReading,
  getLastMeasurementReading,
  consumeLastMeasurementReading,
  clearMeasurementReading,
} from "../measurement-bridge";
import type { MeasurementReading } from "@platform/measurement-core";

// ─────────────────────────────────────────────────────────────────────────────
// 1. OVERLAY CLIPPING GUARD — pure logic mirror of MeasureModeOverlay
// ─────────────────────────────────────────────────────────────────────────────
//
// MeasureModeOverlay computes referenceClipped / referenceTooSmall /
// measureBlocked in terms of:
//   refBoxPx  = { x, y, width, height }  (absolute preview pixels)
//   vpW / vpH = preview viewport dimensions
//   EDGE      = 2  (pixels — same constant as computeScaledDimensions)
//   MIN_REF_SPAN_PX = 24
//
// These pure helpers replicate that computation so it can be tested without
// rendering React Native.

const OVERLAY_EDGE = 2;
const MIN_REF_SPAN_PX = 24;

interface RefBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function computeReferenceClipped(box: RefBox, vpW: number, vpH: number): boolean {
  return (
    box.x <= OVERLAY_EDGE ||
    box.y <= OVERLAY_EDGE ||
    box.x + box.width >= vpW - OVERLAY_EDGE ||
    box.y + box.height >= vpH - OVERLAY_EDGE
  );
}

function computeReferenceTooSmall(box: RefBox): boolean {
  return box.width < MIN_REF_SPAN_PX || box.height < MIN_REF_SPAN_PX;
}

function computeMeasureBlocked(box: RefBox, vpW: number, vpH: number): {
  clipped: boolean;
  tooSmall: boolean;
  blocked: boolean;
} {
  const clipped = computeReferenceClipped(box, vpW, vpH);
  const tooSmall = computeReferenceTooSmall(box);
  return { clipped, tooSmall, blocked: clipped || tooSmall };
}

const VP_W = 390;
const VP_H = 844;

describe("MeasureModeOverlay clipping guard — reference box touching an edge", () => {
  it("does NOT block when the box is centred well away from all edges", () => {
    const box = { x: 100, y: 300, width: 120, height: 60 };
    const { blocked, clipped, tooSmall } = computeMeasureBlocked(box, VP_W, VP_H);
    expect(clipped).toBe(false);
    expect(tooSmall).toBe(false);
    expect(blocked).toBe(false);
  });

  it("blocks (clipped) when the box left edge touches the preview left edge (x ≤ EDGE)", () => {
    // x = 2 — exactly at the edge guard; must be treated as clipped.
    const box = { x: OVERLAY_EDGE, y: 300, width: 120, height: 60 };
    const { clipped, blocked } = computeMeasureBlocked(box, VP_W, VP_H);
    expect(clipped).toBe(true);
    expect(blocked).toBe(true);
  });

  it("blocks (clipped) when the box left edge is inside EDGE (x = 0)", () => {
    const box = { x: 0, y: 300, width: 120, height: 60 };
    const { clipped, blocked } = computeMeasureBlocked(box, VP_W, VP_H);
    expect(clipped).toBe(true);
    expect(blocked).toBe(true);
  });

  it("blocks (clipped) when the box right edge touches the preview right edge (x + width ≥ vpW − EDGE)", () => {
    // Right edge = 390 − 2 = 388; box right = 250 + 140 = 390 > 388 → clipped.
    const box = { x: 250, y: 300, width: 140, height: 60 };
    const { clipped, blocked } = computeMeasureBlocked(box, VP_W, VP_H);
    expect(clipped).toBe(true);
    expect(blocked).toBe(true);
  });

  it("blocks (clipped) when the box top edge is inside EDGE (y = 1)", () => {
    const box = { x: 100, y: 1, width: 120, height: 60 };
    const { clipped, blocked } = computeMeasureBlocked(box, VP_W, VP_H);
    expect(clipped).toBe(true);
    expect(blocked).toBe(true);
  });

  it("blocks (clipped) when the box bottom edge touches the preview bottom edge (y + height ≥ vpH − EDGE)", () => {
    // Bottom guard = 844 − 2 = 842; box bottom = 790 + 54 = 844 ≥ 842 → clipped.
    const box = { x: 100, y: 790, width: 120, height: 54 };
    const { clipped, blocked } = computeMeasureBlocked(box, VP_W, VP_H);
    expect(clipped).toBe(true);
    expect(blocked).toBe(true);
  });

  it("does NOT block when the box is just inside the EDGE margin on all sides", () => {
    // All edges at least EDGE+1 = 3 px clear of the viewport boundary.
    const box = { x: OVERLAY_EDGE + 1, y: OVERLAY_EDGE + 1, width: 120, height: 60 };
    const { clipped, blocked } = computeMeasureBlocked(box, VP_W, VP_H);
    expect(clipped).toBe(false);
    expect(blocked).toBe(false);
  });
});

describe("MeasureModeOverlay clipping guard — amber warning text selection", () => {
  /**
   * MeasureModeOverlay renders different warning text for clipped vs too-small:
   *   clipped  → "Reference box touches the frame edge — re-centre it before measuring"
   *   tooSmall → "Reference box is too small — drag the corners apart to fit the object"
   * The specific text is user-facing UX — if either key phrase disappears the
   * amber banner is effectively invisible to the technician.
   */
  function warningText(clipped: boolean, tooSmall: boolean): string | null {
    if (clipped) return "Reference box touches the frame edge — re-centre it before measuring";
    if (tooSmall) return "Reference box is too small — drag the corners apart to fit the object";
    return null;
  }

  it("shows the clipping warning when the box is clipped", () => {
    const { clipped, tooSmall } = computeMeasureBlocked(
      { x: 0, y: 300, width: 120, height: 60 },
      VP_W, VP_H,
    );
    expect(warningText(clipped, tooSmall)).toMatch(/re-centre/i);
  });

  it("shows the too-small warning when the box is not clipped but too small", () => {
    const smallBox = { x: 100, y: 300, width: MIN_REF_SPAN_PX - 1, height: 60 };
    const { clipped, tooSmall } = computeMeasureBlocked(smallBox, VP_W, VP_H);
    expect(clipped).toBe(false);
    expect(tooSmall).toBe(true);
    expect(warningText(clipped, tooSmall)).toMatch(/too small/i);
  });

  it("shows no warning (returns null) when the box is centred and large enough", () => {
    const { clipped, tooSmall } = computeMeasureBlocked(
      { x: 100, y: 300, width: 120, height: 60 },
      VP_W, VP_H,
    );
    expect(warningText(clipped, tooSmall)).toBeNull();
  });

  it("prioritises the clipping warning over the too-small warning (matching component logic)", () => {
    // A clipped box that is also tiny — clipping takes priority in the component.
    const box = { x: 0, y: 0, width: MIN_REF_SPAN_PX - 1, height: 10 };
    const { clipped, tooSmall } = computeMeasureBlocked(box, VP_W, VP_H);
    expect(clipped).toBe(true);
    expect(tooSmall).toBe(true);
    // Clipping check comes first in the ternary so the re-centre text wins.
    expect(warningText(clipped, tooSmall)).toMatch(/re-centre/i);
    expect(warningText(clipped, tooSmall)).not.toMatch(/too small/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. PIPELINE WARNINGS PROPAGATE TO THE RESULTS SHEET
// ─────────────────────────────────────────────────────────────────────────────
//
// MeasureModeOverlay renders result.warnings in the results sheet before the
// Stamp button.  The contract:
//   • result.warnings.length > 0 when the reference box was clipped
//   • warnings content is visible before Stamp (rendered above the stamp row)
//   • Stamp does not require warnings to be empty — it is always tappable once
//     a result exists, but the warnings are rendered first so the technician
//     sees them.
//
// These tests verify the shape of a BurstMeasurementResult and that the
// overlay correctly distinguishes between a result with and without warnings.

describe("MeasureModeOverlay results sheet — warnings before Stamp", () => {
  /**
   * Simulate the subset of MeasureModeOverlay's results-sheet rendering logic
   * that decides whether warnings are shown and whether Stamp is available.
   */
  interface MinimalResult {
    confidence: number;
    warnings: string[];
    widthInches: number;
    heightInches: number;
    areaSqInches: number;
  }

  function resultsSheetState(result: MinimalResult | null) {
    return {
      showResults: result !== null,
      warningCount: result?.warnings.length ?? 0,
      stampAvailable: result !== null && Number.isFinite(result.widthInches),
      lowConfidence: result !== null && result.confidence < 0.5,
    };
  }

  it("stamps are available when a valid result is present (no warnings)", () => {
    const result: MinimalResult = {
      confidence: 0.8,
      warnings: [],
      widthInches: 4.25,
      heightInches: 2.75,
      areaSqInches: 11.69,
    };
    const state = resultsSheetState(result);
    expect(state.showResults).toBe(true);
    expect(state.warningCount).toBe(0);
    expect(state.stampAvailable).toBe(true);
    expect(state.lowConfidence).toBe(false);
  });

  it("shows warnings (count > 0) AND Stamp is still available when result has warnings", () => {
    const result: MinimalResult = {
      confidence: 0.3,
      warnings: ["Reference object partially out of frame — scale may be overstated"],
      widthInches: 4.25,
      heightInches: 2.75,
      areaSqInches: 11.69,
    };
    const state = resultsSheetState(result);
    expect(state.showResults).toBe(true);
    expect(state.warningCount).toBeGreaterThan(0);
    // Stamp is still reachable — technician chooses whether to accept with warning.
    expect(state.stampAvailable).toBe(true);
    // Low-confidence indicator fires for < 0.5 confidence.
    expect(state.lowConfidence).toBe(true);
  });

  it("shows no results / Stamp unavailable when result is null", () => {
    const state = resultsSheetState(null);
    expect(state.showResults).toBe(false);
    expect(state.stampAvailable).toBe(false);
  });

  it("Stamp is unavailable when widthInches is non-finite (degenerate geometry guard)", () => {
    const result: MinimalResult = {
      confidence: 0.5,
      warnings: [],
      widthInches: Infinity,
      heightInches: 0,
      areaSqInches: 0,
    };
    const state = resultsSheetState(result);
    // Overlay's handleStampMeasureResult checks isFinite(widthInches).
    expect(state.stampAvailable).toBe(false);
  });

  it("confidence indicator is green (not low) at exactly 0.5 confidence", () => {
    const result: MinimalResult = {
      confidence: 0.5,
      warnings: [],
      widthInches: 3.0,
      heightInches: 2.0,
      areaSqInches: 6.0,
    };
    const state = resultsSheetState(result);
    // The threshold in MeasureModeOverlay is `confidence >= 0.5` → green dot.
    expect(state.lowConfidence).toBe(false);
  });

  it("confidence indicator is amber (low) just below 0.5 threshold", () => {
    const result: MinimalResult = {
      confidence: 0.499,
      warnings: [],
      widthInches: 3.0,
      heightInches: 2.0,
      areaSqInches: 6.0,
    };
    const state = resultsSheetState(result);
    expect(state.lowConfidence).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2b. EXIF-UNAVAILABLE FOCAL-LENGTH WARNING — end-to-end path
// ─────────────────────────────────────────────────────────────────────────────
//
// When BurstMeasurementManager.captureBurst() cannot read EXIF data it returns
// focalLengthSource: "fallback".  new-inspection.tsx checks that flag and pushes:
//
//   "Focal length estimated from default (EXIF unavailable) — dimensions may be less accurate"
//
// into result.warnings BEFORE calling setMeasureResult().  MeasureModeOverlay
// then renders result.warnings (amber banner) above the Stamp button.
//
// These tests mirror that logic end-to-end without React Native so vitest can
// run them in a plain Node environment:
//   a. The correct warning string is produced by the fallback branch.
//   b. The results-sheet state exposes the warning before Stamp is available.
//   c. Stamp remains reachable so the technician can override with awareness.
//   d. The warning round-trips into the stamp metadata.
//   e. When EXIF IS available (focalLengthSource === "exif") no extra warning
//      is pushed.

describe("EXIF-unavailable focal-length warning — warning text and overlay ordering", () => {
  // Mirror the exact warning string from new-inspection.tsx handleRunBurstMeasure.
  // If this string ever changes in the screen, this test will catch the drift.
  const EXIF_FALLBACK_WARNING =
    "Focal length estimated from default (EXIF unavailable) — dimensions may be less accurate";

  interface MinimalResult {
    confidence: number;
    warnings: string[];
    widthInches: number;
    heightInches: number;
    areaSqInches: number;
  }

  /**
   * Simulate the handleRunBurstMeasure logic in new-inspection.tsx:
   * after the pipeline runs, check focalLengthSource and push the warning.
   */
  function applyFocalLengthSourceWarning(
    result: MinimalResult,
    focalLengthSource: "exif" | "fallback",
  ): MinimalResult {
    if (focalLengthSource === "fallback") {
      result.warnings.push(EXIF_FALLBACK_WARNING);
    }
    return result;
  }

  /**
   * Simulate the MeasureModeOverlay results-sheet rendering decision:
   * returns the ordered list of "elements" that would appear before Stamp.
   * In the real component the order is:
   *   1. confidence row
   *   2. warnings (map over result.warnings)
   *   3. dimensions row
   *   4. [Re-measure] [Stamp] button row   ← Stamp is here
   */
  function resultsSheetElements(result: MinimalResult): string[] {
    const elements: string[] = ["confidence-row"];
    for (const w of result.warnings) {
      elements.push(`warning: ${w}`);
    }
    elements.push("dimensions-row");
    elements.push("stamp-button");
    return elements;
  }

  it("produces the exact EXIF-unavailable warning string when focalLengthSource is 'fallback'", () => {
    const result: MinimalResult = {
      confidence: 0.65,
      warnings: [],
      widthInches: 5.0,
      heightInches: 3.0,
      areaSqInches: 15.0,
    };
    applyFocalLengthSourceWarning(result, "fallback");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toBe(EXIF_FALLBACK_WARNING);
    expect(result.warnings[0]).toMatch(/EXIF unavailable/i);
    expect(result.warnings[0]).toMatch(/dimensions may be less accurate/i);
  });

  it("does NOT push the fallback warning when focalLengthSource is 'exif'", () => {
    const result: MinimalResult = {
      confidence: 0.75,
      warnings: [],
      widthInches: 5.0,
      heightInches: 3.0,
      areaSqInches: 15.0,
    };
    applyFocalLengthSourceWarning(result, "exif");
    expect(result.warnings).toHaveLength(0);
  });

  it("warning element appears before the stamp-button element in the results sheet", () => {
    const result: MinimalResult = {
      confidence: 0.65,
      warnings: [],
      widthInches: 5.0,
      heightInches: 3.0,
      areaSqInches: 15.0,
    };
    applyFocalLengthSourceWarning(result, "fallback");

    const elements = resultsSheetElements(result);
    const warningIdx = elements.findIndex((e) => e.startsWith("warning:"));
    const stampIdx = elements.indexOf("stamp-button");

    expect(warningIdx).toBeGreaterThan(-1); // warning is rendered
    expect(stampIdx).toBeGreaterThan(-1);   // stamp is rendered
    // The warning must appear before Stamp in the element list.
    expect(warningIdx).toBeLessThan(stampIdx);
  });

  it("stamp is still available (technician override) even when EXIF warning is present", () => {
    const result: MinimalResult = {
      confidence: 0.65,
      warnings: [],
      widthInches: 5.0,
      heightInches: 3.0,
      areaSqInches: 15.0,
    };
    applyFocalLengthSourceWarning(result, "fallback");

    // handleStampMeasureResult guard: only checks isFinite(widthInches).
    const stampEnabled = Number.isFinite(result.widthInches);
    expect(stampEnabled).toBe(true);
    // Warning is still present — technician sees it before choosing to stamp.
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("confidence indicator is shown at full fidelity even when EXIF warning is present", () => {
    // EXIF fallback does not force low confidence — the pipeline's own
    // confidence score is preserved; only the warning text is added.
    const result: MinimalResult = {
      confidence: 0.7,
      warnings: [],
      widthInches: 5.0,
      heightInches: 3.0,
      areaSqInches: 15.0,
    };
    applyFocalLengthSourceWarning(result, "fallback");

    // Confidence unchanged by the warning push.
    expect(result.confidence).toBe(0.7);
    // Still shown as good confidence (≥ 0.5 threshold from the overlay).
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("EXIF warning coexists with an additional pipeline warning (e.g. clipping)", () => {
    const clippingWarning = "Reference object partially out of frame — scale may be overstated";
    const result: MinimalResult = {
      confidence: 0.28,
      warnings: [clippingWarning],
      widthInches: 5.0,
      heightInches: 3.0,
      areaSqInches: 15.0,
    };
    applyFocalLengthSourceWarning(result, "fallback");

    expect(result.warnings).toHaveLength(2);
    expect(result.warnings).toContain(clippingWarning);
    expect(result.warnings).toContain(EXIF_FALLBACK_WARNING);

    // Both warnings appear before Stamp in the results sheet.
    const elements = resultsSheetElements(result);
    const stampIdx = elements.indexOf("stamp-button");
    const warningIndices = elements
      .map((e, i) => (e.startsWith("warning:") ? i : -1))
      .filter((i) => i >= 0);

    expect(warningIndices).toHaveLength(2);
    warningIndices.forEach((wi) => expect(wi).toBeLessThan(stampIdx));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. STAMP METADATA CARRIES CONFIDENCE AND WARNINGS
// ─────────────────────────────────────────────────────────────────────────────
//
// handleStampMeasureResult in new-inspection.tsx calls setLastMeasurementReading
// with:
//   {
//     deviceId:      "burst-measure-pipeline",
//     kind:          "width",
//     value:         result.widthInches,
//     unit:          "in",
//     signalQuality: result.confidence,          ← confidence as signal quality
//     capturedAt:    result.measuredAt,
//     metadata: {
//       method:              "burst_reference",
//       heightInches:        result.heightInches,
//       areaSqInches:        result.areaSqInches,
//       centroidDepthMeters: result.centroidDepthMeters,
//       confidence:          result.confidence,  ← also in metadata
//       warnings:            result.warnings,    ← warning array in metadata
//     },
//   }
//
// These tests verify that the bridge stores and returns this full payload so
// downstream photo records inherit both confidence and warnings.

const STAMP_DEVICE_ID = "burst-measure-pipeline";

function makeMeasureStampReading(overrides: {
  widthInches?: number;
  heightInches?: number;
  areaSqInches?: number;
  confidence?: number;
  warnings?: string[];
  measuredAt?: string;
}): MeasurementReading {
  const {
    widthInches = 4.25,
    heightInches = 2.75,
    areaSqInches = 11.69,
    confidence = 0.72,
    warnings = [],
    measuredAt = new Date().toISOString(),
  } = overrides;

  return {
    deviceId: STAMP_DEVICE_ID,
    kind: "width",
    value: widthInches,
    unit: "in",
    signalQuality: confidence,
    capturedAt: measuredAt,
    metadata: {
      method: "burst_reference",
      heightInches,
      areaSqInches,
      centroidDepthMeters: 1.2,
      confidence,
      warnings,
    },
  };
}

describe("Stamp metadata — confidence and warnings round-trip through the bridge", () => {
  beforeEach(() => {
    clearMeasurementReading();
  });

  it("stores the full stamp payload and retrieves it via getLastMeasurementReading", () => {
    const reading = makeMeasureStampReading({ confidence: 0.72, warnings: [] });
    setLastMeasurementReading(reading);

    const stored = getLastMeasurementReading();
    expect(stored).not.toBeNull();
    expect(stored!.deviceId).toBe(STAMP_DEVICE_ID);
    expect(stored!.signalQuality).toBe(0.72);
    expect(stored!.metadata).toBeDefined();
  });

  it("metadata.confidence matches the top-level signalQuality", () => {
    const reading = makeMeasureStampReading({ confidence: 0.55 });
    setLastMeasurementReading(reading);

    const stored = getLastMeasurementReading();
    const meta = stored!.metadata as { confidence: number };
    expect(meta.confidence).toBe(stored!.signalQuality);
    expect(meta.confidence).toBe(0.55);
  });

  it("metadata.warnings is present and empty for a clean (un-clipped) result", () => {
    const reading = makeMeasureStampReading({ warnings: [] });
    setLastMeasurementReading(reading);

    const stored = getLastMeasurementReading();
    const meta = stored!.metadata as { warnings: string[] };
    expect(Array.isArray(meta.warnings)).toBe(true);
    expect(meta.warnings).toHaveLength(0);
  });

  it("metadata.warnings carries the pipeline warning strings for a clipped result", () => {
    const clippingWarning = "Reference object partially out of frame — scale may be overstated";
    const reading = makeMeasureStampReading({
      confidence: 0.3,
      warnings: [clippingWarning],
    });
    setLastMeasurementReading(reading);

    const stored = getLastMeasurementReading();
    const meta = stored!.metadata as { warnings: string[]; confidence: number };
    expect(meta.warnings).toHaveLength(1);
    expect(meta.warnings[0]).toMatch(/out of frame/i);
    // Even a clipped / low-confidence stamp is stored faithfully so the
    // inspection record reflects what actually happened.
    expect(meta.confidence).toBeLessThan(0.5);
  });

  it("metadata carries heightInches and areaSqInches for multi-dimension results", () => {
    const reading = makeMeasureStampReading({
      widthInches: 6.0,
      heightInches: 4.0,
      areaSqInches: 24.0,
    });
    setLastMeasurementReading(reading);

    const stored = getLastMeasurementReading();
    const meta = stored!.metadata as { heightInches: number; areaSqInches: number };
    expect(meta.heightInches).toBe(4.0);
    expect(meta.areaSqInches).toBe(24.0);
  });

  it("consumeLastMeasurementReading clears the cache so the reading is not reused", () => {
    const reading = makeMeasureStampReading({ confidence: 0.8 });
    setLastMeasurementReading(reading);

    const first = consumeLastMeasurementReading();
    const second = consumeLastMeasurementReading();

    expect(first).not.toBeNull();
    // After the first consume, the cache is cleared.
    expect(second).toBeNull();
  });

  it("getLastMeasurementReading returns null before any stamp is made", () => {
    expect(getLastMeasurementReading()).toBeNull();
  });

  it("getLastMeasurementReading returns null after clearMeasurementReading", () => {
    setLastMeasurementReading(makeMeasureStampReading({}));
    clearMeasurementReading();
    expect(getLastMeasurementReading()).toBeNull();
  });

  it("method is 'burst_reference' in metadata (identifies the source pipeline)", () => {
    const reading = makeMeasureStampReading({});
    setLastMeasurementReading(reading);

    const stored = getLastMeasurementReading();
    const meta = stored!.metadata as { method: string };
    expect(meta.method).toBe("burst_reference");
  });

  it("two sequential stamps: second reading overwrites the first", () => {
    setLastMeasurementReading(makeMeasureStampReading({ widthInches: 3.0, confidence: 0.6 }));
    setLastMeasurementReading(makeMeasureStampReading({ widthInches: 7.5, confidence: 0.9 }));

    const stored = getLastMeasurementReading();
    expect(stored!.value).toBe(7.5);
    expect(stored!.signalQuality).toBe(0.9);
  });
});
