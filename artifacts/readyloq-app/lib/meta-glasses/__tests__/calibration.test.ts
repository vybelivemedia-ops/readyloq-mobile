/**
 * lib/meta-glasses/__tests__/calibration.test.ts
 *
 * Unit tests for calibration.ts covering:
 *   1. backSolveFocalLength() — pinhole-camera back-solve formula
 *   2. buildCalibrationProfile() — assembles a complete BasicCalibrationProfile
 *   3. saveCalibrationProfile / loadCalibrationProfile — round-trip persistence
 *
 * expo-secure-store is mocked with an in-memory Map so no native module is
 * required in the vitest node environment.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BasicCalibrationProfile } from "@platform/measurement-core";
import {
  REFERENCE_OBJECTS,
  BurstMeasurementPipeline,
  FallbackSfMProvider,
} from "@platform/measurement-core";

// ─── Mock expo-secure-store ───────────────────────────────────────────────────
// Keep the store outside the factory so tests can inspect / manipulate it.
const _secureStore = new Map<string, string>();

vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => _secureStore.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    _secureStore.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    _secureStore.delete(key);
  },
}));

// ─── Import the module under test (after mock is registered) ─────────────────
import {
  backSolveFocalLength,
  buildCalibrationProfile,
  saveCalibrationProfile,
  loadCalibrationProfile,
  clearCalibrationProfile,
  DEFAULT_FOCAL_LENGTH_PX,
} from "../calibration";

// ─────────────────────────────────────────────────────────────────────────────
// backSolveFocalLength
// ─────────────────────────────────────────────────────────────────────────────

describe("backSolveFocalLength", () => {
  it("nominal: credit card at 0.6 m spanning 300 px gives correct focal length", () => {
    // focalLengthPx = 300 × 0.6 × 1000 / 85.6 ≈ 2102.8
    const fl = backSolveFocalLength(300, 0.6, "credit_card");
    expect(fl).toBeCloseTo(2102.8, 0);
  });

  it("halving the holding distance halves the focal length for the same pixel width", () => {
    const fl06 = backSolveFocalLength(300, 0.6);
    const fl03 = backSolveFocalLength(300, 0.3);
    // A 2× depth error causes a 2× focal-length error → 2× measurement error
    expect(fl03).toBeCloseTo(fl06 / 2, 5);
  });

  it("doubling the holding distance doubles the focal length", () => {
    const fl06 = backSolveFocalLength(300, 0.6);
    const fl12 = backSolveFocalLength(300, 1.2);
    expect(fl12).toBeCloseTo(fl06 * 2, 5);
  });

  it("very small distance (0.05 m) produces a positive finite focal length", () => {
    const fl = backSolveFocalLength(300, 0.05);
    // 300 × 0.05 × 1000 / 85.6 ≈ 175.2
    expect(fl).toBeCloseTo(175.2, 0);
    expect(fl).toBeGreaterThan(0);
    expect(Number.isFinite(fl)).toBe(true);
  });

  it("large distance (5.0 m) produces a large but finite focal length", () => {
    const fl = backSolveFocalLength(300, 5.0);
    // 300 × 5.0 × 1000 / 85.6 ≈ 17523.4
    expect(fl).toBeCloseTo(17523.4, 0);
    expect(Number.isFinite(fl)).toBe(true);
  });

  it("round-trips: back-solved focalLength recovers the original depth", () => {
    const pixelWidth  = 400;
    const depthMeters = 0.45;
    const fl          = backSolveFocalLength(pixelWidth, depthMeters, "credit_card");
    // depth = focalLengthPx × widthMm / (pixelWidth × 1000)
    const recoveredDepth =
      (fl * REFERENCE_OBJECTS["credit_card"]!.widthMm) / (pixelWidth * 1000);
    expect(recoveredDepth).toBeCloseTo(depthMeters, 10);
  });

  it("uses the reference object width — us_dollar result differs from credit_card by the right ratio", () => {
    const flCard   = backSolveFocalLength(300, 0.6, "credit_card");
    const flDollar = backSolveFocalLength(300, 0.6, "us_dollar");
    // focalLengthPx = pixelWidth × depth × 1000 / widthMm
    // flCard / flDollar = dollarWidthMm / cardWidthMm  (ratio is inverted from the widths)
    const expectedRatio =
      REFERENCE_OBJECTS["us_dollar"]!.widthMm /
      REFERENCE_OBJECTS["credit_card"]!.widthMm;
    expect(flCard / flDollar).toBeCloseTo(expectedRatio, 5);
  });

  it("throws for an unknown reference kind", () => {
    expect(() => backSolveFocalLength(300, 0.6, "banana")).toThrow(
      /unknown reference object/i,
    );
  });

  it("default referenceKind is credit_card", () => {
    const withDefault  = backSolveFocalLength(300, 0.6);
    const withExplicit = backSolveFocalLength(300, 0.6, "credit_card");
    expect(withDefault).toBe(withExplicit);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildCalibrationProfile
// ─────────────────────────────────────────────────────────────────────────────

describe("buildCalibrationProfile", () => {
  it("returns an object with all required BasicCalibrationProfile fields", () => {
    const profile = buildCalibrationProfile("mac-aabb", 2102.8, 1080, 0.6);
    expect(profile).toHaveProperty("deviceId", "mac-aabb");
    expect(profile).toHaveProperty("focalLengthPx", 2102.8);
    expect(profile).toHaveProperty("pixelToInchRatio");
    expect(profile).toHaveProperty("calibratedAt");
  });

  it("pixelToInchRatio is positive and finite", () => {
    const profile = buildCalibrationProfile("mac-aabb", 2102.8, 1080, 0.6);
    expect(profile.pixelToInchRatio).toBeGreaterThan(0);
    expect(Number.isFinite(profile.pixelToInchRatio)).toBe(true);
  });

  it("pixelToInchRatio scales linearly with depth", () => {
    const p06 = buildCalibrationProfile("dev", 2102.8, 1080, 0.6);
    const p12 = buildCalibrationProfile("dev", 2102.8, 1080, 1.2);
    // pixelToInchRatio = depth × 39.3701 / focalLengthPx → doubles with depth
    expect(p12.pixelToInchRatio).toBeCloseTo(p06.pixelToInchRatio * 2, 5);
  });

  it("calibratedAt is a recent timestamp (within the last 5 seconds)", () => {
    const before = Date.now() - 100;
    const profile = buildCalibrationProfile("dev", 2102.8, 1080, 0.6);
    const after   = Date.now() + 100;
    expect(profile.calibratedAt).toBeGreaterThanOrEqual(before);
    expect(profile.calibratedAt).toBeLessThanOrEqual(after);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// save / load / clear round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe("saveCalibrationProfile / loadCalibrationProfile — round-trip", () => {
  const DEVICE_ID = "test-device-aa:bb:cc";

  beforeEach(() => {
    _secureStore.clear();
  });

  it("loadCalibrationProfile returns null when nothing has been saved", async () => {
    const result = await loadCalibrationProfile(DEVICE_ID);
    expect(result).toBeNull();
  });

  it("saves and loads an identical profile (full round-trip)", async () => {
    const profile: BasicCalibrationProfile = {
      deviceId:         DEVICE_ID,
      focalLengthPx:    2102.8,
      pixelToInchRatio: 0.000285,
      calibratedAt:     1_700_000_000_000,
    };

    await saveCalibrationProfile(DEVICE_ID, profile);
    const loaded = await loadCalibrationProfile(DEVICE_ID);

    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(profile);
  });

  it("overwrites a previous profile for the same device", async () => {
    const first: BasicCalibrationProfile = {
      deviceId:         DEVICE_ID,
      focalLengthPx:    800,
      pixelToInchRatio: 0.001,
      calibratedAt:     1_000_000_000_000,
    };
    const second: BasicCalibrationProfile = {
      deviceId:         DEVICE_ID,
      focalLengthPx:    2102.8,
      pixelToInchRatio: 0.000285,
      calibratedAt:     2_000_000_000_000,
    };

    await saveCalibrationProfile(DEVICE_ID, first);
    await saveCalibrationProfile(DEVICE_ID, second);
    const loaded = await loadCalibrationProfile(DEVICE_ID);

    expect(loaded?.focalLengthPx).toBe(2102.8);
    expect(loaded?.calibratedAt).toBe(2_000_000_000_000);
  });

  it("profiles for different devices are stored independently", async () => {
    const deviceA = "device-aa";
    const deviceB = "device-bb";

    const profileA: BasicCalibrationProfile = {
      deviceId: deviceA, focalLengthPx: 800, pixelToInchRatio: 0.001, calibratedAt: 1,
    };
    const profileB: BasicCalibrationProfile = {
      deviceId: deviceB, focalLengthPx: 2102.8, pixelToInchRatio: 0.000285, calibratedAt: 2,
    };

    await Promise.all([
      saveCalibrationProfile(deviceA, profileA),
      saveCalibrationProfile(deviceB, profileB),
    ]);

    const [loadedA, loadedB] = await Promise.all([
      loadCalibrationProfile(deviceA),
      loadCalibrationProfile(deviceB),
    ]);

    expect(loadedA?.focalLengthPx).toBe(800);
    expect(loadedB?.focalLengthPx).toBe(2102.8);
  });

  it("clearCalibrationProfile causes subsequent load to return null", async () => {
    const profile: BasicCalibrationProfile = {
      deviceId: DEVICE_ID, focalLengthPx: 800, pixelToInchRatio: 0.001, calibratedAt: 1,
    };
    await saveCalibrationProfile(DEVICE_ID, profile);
    await clearCalibrationProfile(DEVICE_ID);
    const loaded = await loadCalibrationProfile(DEVICE_ID);
    expect(loaded).toBeNull();
  });

  it("load → buildCalibrationProfile preserves focalLengthPx exactly", async () => {
    // Simulate the full re-calibration save-and-use flow:
    // 1. Back-solve → build profile → save → load → extract focalLengthPx
    const pixelWidth  = 300;
    const depthMeters = 0.6;
    const fl          = backSolveFocalLength(pixelWidth, depthMeters);
    const original    = buildCalibrationProfile(DEVICE_ID, fl, 1080, depthMeters);

    await saveCalibrationProfile(DEVICE_ID, original);
    const loaded = await loadCalibrationProfile(DEVICE_ID);

    expect(loaded).not.toBeNull();
    expect(loaded!.focalLengthPx).toBe(fl);         // exact equality — no rounding in JSON
    expect(loaded!.deviceId).toBe(DEVICE_ID);
    expect(loaded!.calibratedAt).toBe(original.calibratedAt);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT_FOCAL_LENGTH_PX sanity
// ─────────────────────────────────────────────────────────────────────────────

describe("DEFAULT_FOCAL_LENGTH_PX", () => {
  it("is a positive finite number", () => {
    expect(DEFAULT_FOCAL_LENGTH_PX).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_FOCAL_LENGTH_PX)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RE-CALIBRATION ROUND-TRIP — END-TO-END PIPELINE ACCURACY (Task 607)
//
// Verifies the full chain:
//   backSolveFocalLength → buildCalibrationProfile → save → overwrite → load
//   → BurstMeasurementPipeline(loaded.focalLengthPx) → widthInches within ±5%
//
// Tests two physically consistent calibration distances to confirm that
// entering the correct pixel width for the actual holding distance always
// recovers the same true focal length, regardless of which distance was used.
// ─────────────────────────────────────────────────────────────────────────────

describe("Re-calibration round-trip — loaded focalLengthPx drives accurate pipeline", () => {
  const DEVICE_ID = "glasses-recal-e2e";
  const CARD      = REFERENCE_OBJECTS["credit_card"]!;
  const IMAGE_W   = 1080, IMAGE_H = 1920;

  // Fixed target polygon (600 × 300 px rectangle in the 1080×1920 image).
  const TARGET_VERTICES = [
    { x: 300, y: 400 }, { x: 900, y: 400 },
    { x: 900, y: 700 }, { x: 300, y: 700 },
  ];
  const FRAMES = [{ uri: "file://e2e.jpg", capturedAt: 0 }];

  /**
   * Compute the analytically expected widthInches for the target polygon.
   *
   * FallbackSfMProvider returns uniform relativeDepth=0.5.  With the
   * reference box at refPixW pixels:
   *   referenceDepthMeters = fl × 85.6 / (refPixW × 1000)
   *   metersPerRelativeUnit = refDepth / 0.5
   *   vertex depth (relDepth=0.5) = refDepth
   *   targetSpan = 600 px → widthM = 600 × refDepth / fl
   */
  function analyticalWidth(fl: number, refPixW: number): number {
    const refDepth    = (fl * CARD.widthMm) / (refPixW * 1000);
    const targetSpan  = TARGET_VERTICES[1].x - TARGET_VERTICES[0].x; // 600 px
    return (targetSpan * refDepth / fl) * 39.3701;
  }

  beforeEach(() => {
    _secureStore.clear();
  });

  it("physically consistent calibrations at 0.6 m and 0.3 m recover the same focalLengthPx", () => {
    // When pixel width scales proportionally with depth, the back-solve formula
    // always recovers the same true focal length.
    const fl_06m_300px = backSolveFocalLength(300, 0.6);
    const fl_03m_600px = backSolveFocalLength(600, 0.3);
    const fl_12m_150px = backSolveFocalLength(150, 1.2);
    expect(fl_06m_300px).toBeCloseTo(fl_03m_600px, 5);
    expect(fl_06m_300px).toBeCloseTo(fl_12m_150px, 5);
  });

  it("initial calibration (0.6 m / 300 px): loaded focalLengthPx drives pipeline within ±5%", async () => {
    const fl      = backSolveFocalLength(300, 0.6);
    const profile = buildCalibrationProfile(DEVICE_ID, fl, IMAGE_W, 0.6);
    await saveCalibrationProfile(DEVICE_ID, profile);

    const loaded = await loadCalibrationProfile(DEVICE_ID);
    expect(loaded).not.toBeNull();

    const pipeline = new BurstMeasurementPipeline(new FallbackSfMProvider(), loaded!.focalLengthPx);
    const result   = await pipeline.measure(FRAMES, TARGET_VERTICES, {
      box:    { x: 0.1, y: 0.1, width: 300 / IMAGE_W, height: 0.04 },
      object: CARD, imageWidthPx: IMAGE_W, imageHeightPx: IMAGE_H,
    });

    expect(Number.isFinite(result.widthInches)).toBe(true);
    expect(result.widthInches).toBeGreaterThan(0);
    const expected = analyticalWidth(fl, 300);
    expect(result.widthInches).toBeGreaterThanOrEqual(expected * 0.95);
    expect(result.widthInches).toBeLessThanOrEqual(expected * 1.05);
  });

  it("re-calibration at 0.3 m / 600 px overwrites old profile; loaded focalLengthPx drives pipeline within ±5%", async () => {
    // Step 1: save an initial calibration at 0.6 m / 300 px
    const fl_initial = backSolveFocalLength(300, 0.6);
    await saveCalibrationProfile(
      DEVICE_ID,
      buildCalibrationProfile(DEVICE_ID, fl_initial, IMAGE_W, 0.6),
    );

    // Step 2: technician moves to 0.3 m and re-calibrates (600 px observed)
    const fl_recal = backSolveFocalLength(600, 0.3);
    await saveCalibrationProfile(
      DEVICE_ID,
      buildCalibrationProfile(DEVICE_ID, fl_recal, IMAGE_W, 0.3),
    );

    // Step 3: load the re-calibrated profile
    const loaded = await loadCalibrationProfile(DEVICE_ID);
    expect(loaded).not.toBeNull();
    // Both calibrations should recover the same true focal length
    expect(loaded!.focalLengthPx).toBeCloseTo(fl_initial, 1);

    // Step 4: pipeline with loaded focal length must be accurate
    const pipeline = new BurstMeasurementPipeline(new FallbackSfMProvider(), loaded!.focalLengthPx);
    const result   = await pipeline.measure(FRAMES, TARGET_VERTICES, {
      box:    { x: 0.1, y: 0.1, width: 600 / IMAGE_W, height: 0.04 },
      object: CARD, imageWidthPx: IMAGE_W, imageHeightPx: IMAGE_H,
    });

    expect(Number.isFinite(result.widthInches)).toBe(true);
    expect(result.widthInches).toBeGreaterThan(0);
    const expected = analyticalWidth(fl_recal, 600);
    expect(result.widthInches).toBeGreaterThanOrEqual(expected * 0.95);
    expect(result.widthInches).toBeLessThanOrEqual(expected * 1.05);
  });

  it("re-calibrations at 0.3 m and 0.6 m produce identical pipeline output for the same in-scene reference", async () => {
    // The calibration step only determines focalLengthPx.  Physically consistent
    // calibrations (pixel width scales proportionally with depth) always recover
    // the same focalLengthPx.  Therefore, two pipelines that differ only in
    // which calibration distance was used must produce identical measurements
    // when given the SAME in-scene reference box during measurement.
    const fl_06m = backSolveFocalLength(300, 0.6);
    const fl_03m = backSolveFocalLength(600, 0.3);
    expect(fl_06m).toBeCloseTo(fl_03m, 5); // same true FL

    // Use the SAME in-scene reference box in both pipeline measure() calls.
    const SAME_REF = { box: { x: 0.1, y: 0.1, width: 300 / IMAGE_W, height: 0.04 },
                       object: CARD, imageWidthPx: IMAGE_W, imageHeightPx: IMAGE_H };

    const [r06, r03] = await Promise.all([
      (async () => {
        await saveCalibrationProfile("dev-a", buildCalibrationProfile("dev-a", fl_06m, IMAGE_W, 0.6));
        const p = await loadCalibrationProfile("dev-a");
        return new BurstMeasurementPipeline(new FallbackSfMProvider(), p!.focalLengthPx)
          .measure(FRAMES, TARGET_VERTICES, SAME_REF);
      })(),
      (async () => {
        await saveCalibrationProfile("dev-b", buildCalibrationProfile("dev-b", fl_03m, IMAGE_W, 0.3));
        const p = await loadCalibrationProfile("dev-b");
        return new BurstMeasurementPipeline(new FallbackSfMProvider(), p!.focalLengthPx)
          .measure(FRAMES, TARGET_VERTICES, SAME_REF);
      })(),
    ]);

    expect(r06.widthInches).toBeGreaterThan(0);
    expect(r03.widthInches).toBeGreaterThan(0);
    // Identical focalLengthPx → identical pipeline output (within rounding)
    expect(r03.widthInches).toBeGreaterThanOrEqual(r06.widthInches * 0.95);
    expect(r03.widthInches).toBeLessThanOrEqual(r06.widthInches * 1.05);
  });

  it("wrong holding distance (0.3 m entered for a 0.6 m shot) skews pipeline 2× without a reference", async () => {
    // Technician holds card at 0.6 m (300 px) but enters 0.3 m → focalLengthPx halved.
    // Pipeline WITH reference still corrects scale; WITHOUT reference it uses the
    // stored focalLengthPx directly and produces 2× wrong output.
    const correctFl = backSolveFocalLength(300, 0.6); // what it should be
    const wrongFl   = backSolveFocalLength(300, 0.3); // what gets stored by mistake

    // Save both profiles to storage to model a realistic re-calibration scenario
    await saveCalibrationProfile("dev-correct", buildCalibrationProfile("dev-correct", correctFl, IMAGE_W, 0.6));
    await saveCalibrationProfile("dev-wrong",   buildCalibrationProfile("dev-wrong",   wrongFl,   IMAGE_W, 0.3));

    const [pCorrect, pWrong] = await Promise.all([
      loadCalibrationProfile("dev-correct"),
      loadCalibrationProfile("dev-wrong"),
    ]);

    const [rCorrect, rWrong] = await Promise.all([
      new BurstMeasurementPipeline(new FallbackSfMProvider(), pCorrect!.focalLengthPx)
        .measure(FRAMES, TARGET_VERTICES), // no reference
      new BurstMeasurementPipeline(new FallbackSfMProvider(), pWrong!.focalLengthPx)
        .measure(FRAMES, TARGET_VERTICES), // no reference
    ]);

    // wrongFl = correctFl / 2 → estimator yields 2× larger widthInches
    const ratio = rWrong.widthInches / rCorrect.widthInches;
    expect(ratio).toBeCloseTo(2.0, 0);
  });
});
