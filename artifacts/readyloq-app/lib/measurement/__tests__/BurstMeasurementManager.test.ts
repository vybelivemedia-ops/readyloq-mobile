/**
 * BurstMeasurementManager — unit tests
 *
 * Covers clipping detection, confidence penalty, warning propagation, and
 * the core pixel→mm scale computation.
 *
 * Run with: pnpm --filter @workspace/readyloq-app test
 * (or vitest directly from the artifact directory)
 */

import { describe, it, expect } from "vitest";

// BurstMeasurementManager is exported only as a singleton — import the class
// behaviour through the singleton for simplicity (the class is not exported).
import {
  burstMeasurementManager,
  _deriveFocalLengthPxFromExif,
} from "../BurstMeasurementManager";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PT = (x: number, y: number) => ({ x, y });

/** Minimal valid call: 100 px reference, 85.6 mm credit card, 1.5 m depth. */
function baseCompute(overrides: {
  referencePixelLength?: number;
  estimatedDepthMeters?: number;
  options?: Parameters<typeof burstMeasurementManager.computeScaledDimensions>[8];
}) {
  return burstMeasurementManager.computeScaledDimensions(
    PT(50,  200), // widthP1
    PT(250, 200), // widthP2
    85.6,         // credit card width (mm)
    overrides.referencePixelLength ?? 200,
    overrides.estimatedDepthMeters ?? 1.5,
    800,          // focalLengthPx
    undefined,
    undefined,
    overrides.options,
  );
}

// ─── Core scale computation ───────────────────────────────────────────────────

describe("BurstMeasurementManager.computeScaledDimensions — core scale", () => {
  it("returns widthMm > 0 for valid inputs", () => {
    const result = baseCompute({});
    expect(result.widthMm).toBeGreaterThan(0);
  });

  it("throws when referencePixelLength <= 0", () => {
    expect(() =>
      burstMeasurementManager.computeScaledDimensions(
        PT(0, 0), PT(100, 0), 85.6, 0, 1.5,
      ),
    ).toThrow("referencePixelLength must be > 0");
  });

  it("heightMm is null when no height endpoints are supplied", () => {
    const result = baseCompute({});
    expect(result.heightMm).toBeNull();
  });

  it("heightMm is a number when height endpoints are supplied", () => {
    const result = burstMeasurementManager.computeScaledDimensions(
      PT(50, 200), PT(250, 200),
      85.6, 200, 1.5, 800,
      PT(50, 200), PT(50, 400), // 200 px vertical
    );
    expect(typeof result.heightMm).toBe("number");
    expect(result.heightMm).toBeGreaterThan(0);
  });

  it("confidence is in [0, 1]", () => {
    const result = baseCompute({});
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

// ─── Clipping detection ───────────────────────────────────────────────────────

describe("BurstMeasurementManager.computeScaledDimensions — clipping detection", () => {
  it("clipped:false and no warnings for a fully in-frame reference", () => {
    const result = baseCompute({
      options: {
        referenceP1:  PT(100, 400),
        referenceP2:  PT(300, 400),
        imageWidthPx: 1080,
        imageHeightPx: 1920,
      },
    });
    expect(result.clipped).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("clipped:true and warning when reference P1 is at the left edge (x ≤ 2 px)", () => {
    const result = baseCompute({
      options: {
        referenceP1:  PT(0, 400),   // x=0 — at the left edge
        referenceP2:  PT(300, 400),
        imageWidthPx: 1080,
        imageHeightPx: 1920,
      },
    });
    expect(result.clipped).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toMatch(/out of frame/i);
  });

  it("clipped:true when reference P2 is at the right edge (x ≥ imageWidth − 2 px)", () => {
    const result = baseCompute({
      options: {
        referenceP1:  PT(800, 400),
        referenceP2:  PT(1079, 400), // within 2 px of right edge (1080)
        imageWidthPx: 1080,
        imageHeightPx: 1920,
      },
    });
    expect(result.clipped).toBe(true);
    expect(result.warnings[0]).toMatch(/re-centre/i);
  });

  it("clipped:true when reference P1 is at the top edge (y ≤ 2 px)", () => {
    const result = baseCompute({
      options: {
        referenceP1:  PT(200, 1),  // y=1 — top edge
        referenceP2:  PT(400, 100),
        imageWidthPx: 1080,
        imageHeightPx: 1920,
      },
    });
    expect(result.clipped).toBe(true);
  });

  it("clipped:true when reference P2 is at the bottom edge (y ≥ imageHeight − 2 px)", () => {
    const result = baseCompute({
      options: {
        referenceP1:  PT(200, 1500),
        referenceP2:  PT(400, 1919), // within 2 px of bottom edge (1920)
        imageWidthPx: 1080,
        imageHeightPx: 1920,
      },
    });
    expect(result.clipped).toBe(true);
  });

  it("applies 0.4× confidence penalty when clipped vs identical in-frame reference", () => {
    const inFrame = baseCompute({
      referencePixelLength: 200,
      options: {
        referenceP1:  PT(100, 400),
        referenceP2:  PT(300, 400),
        imageWidthPx: 1080,
        imageHeightPx: 1920,
      },
    });
    const clipped = baseCompute({
      referencePixelLength: 200,
      options: {
        referenceP1:  PT(0, 400),   // left-edge clip
        referenceP2:  PT(200, 400),
        imageWidthPx: 1080,
        imageHeightPx: 1920,
      },
    });
    expect(inFrame.clipped).toBe(false);
    expect(clipped.clipped).toBe(true);
    expect(clipped.confidence).toBeLessThan(inFrame.confidence);
    // The penalty should be close to 0.4× (within floating-point tolerance)
    const ratio = clipped.confidence / inFrame.confidence;
    expect(ratio).toBeCloseTo(0.4, 1);
  });

  it("clipped:false when no options are supplied (cannot determine clipping)", () => {
    const result = baseCompute({ options: undefined });
    expect(result.clipped).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("clipped:false when options are supplied but image dims are missing", () => {
    const result = baseCompute({
      options: {
        referenceP1: PT(0, 400),
        referenceP2: PT(200, 400),
        // imageWidthPx / imageHeightPx intentionally omitted
      },
    });
    // Without image dimensions we cannot detect clipping.
    expect(result.clipped).toBe(false);
  });
});

// ─── EXIF focal-length derivation ────────────────────────────────────────────
//
// All test EXIF payloads use PixelXDimension=1080 (a common 1080p capture
// width) so the derived focal lengths land in the plausible 250–2500 px range.
//   formula:  focalLengthPx = (FocalLenIn35mmFilm / 36) × PixelXDimension
//
// Typical 35mm-equivalent focal lengths for common phone cameras:
//   iOS (iPhone 13 main, 26 mm): (26/36)×1080 ≈ 780 px
//   Android Pixel 6 (27 mm):     (27/36)×1080 ≈ 810 px
//   Samsung S22 (23 mm):         (23/36)×1080 ≈ 690 px

describe("_deriveFocalLengthPxFromExif", () => {
  // ── Valid EXIF — iOS ────────────────────────────────────────────────────────
  it("returns a value in the plausible range for a typical iOS EXIF payload", () => {
    // iPhone 13 main camera: 26 mm 35mm-equiv, 1080 px wide capture
    const result = _deriveFocalLengthPxFromExif({
      FocalLenIn35mmFilm: 26,
      PixelXDimension: 1080,
    });
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThanOrEqual(250);
    expect(result!).toBeLessThanOrEqual(2500);
    // (26/36)×1080 ≈ 780
    expect(result!).toBeCloseTo((26 / 36) * 1080, 1);
  });

  // ── Valid EXIF — Android Pixel ──────────────────────────────────────────────
  it("returns a value in the plausible range for a Pixel-style Android EXIF payload", () => {
    // Google Pixel 6: 27 mm 35mm-equiv
    const result = _deriveFocalLengthPxFromExif({
      FocalLenIn35mmFilm: 27,
      PixelXDimension: 1080,
    });
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThanOrEqual(250);
    expect(result!).toBeLessThanOrEqual(2500);
    expect(result!).toBeCloseTo((27 / 36) * 1080, 1);
  });

  // ── Valid EXIF — Samsung ────────────────────────────────────────────────────
  it("returns a value in the plausible range for a Samsung-style Android EXIF payload", () => {
    // Samsung Galaxy S22 main: 23 mm 35mm-equiv
    const result = _deriveFocalLengthPxFromExif({
      FocalLenIn35mmFilm: 23,
      PixelXDimension: 1080,
    });
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThanOrEqual(250);
    expect(result!).toBeLessThanOrEqual(2500);
    expect(result!).toBeCloseTo((23 / 36) * 1080, 1);
  });

  // ── Missing FocalLenIn35mmFilm ──────────────────────────────────────────────
  it("returns null when FocalLenIn35mmFilm is absent from EXIF", () => {
    const result = _deriveFocalLengthPxFromExif({
      PixelXDimension: 1080,
      // FocalLenIn35mmFilm deliberately omitted
    });
    expect(result).toBeNull();
  });

  // ── FocalLenIn35mmFilm = 0 ──────────────────────────────────────────────────
  it("returns null when FocalLenIn35mmFilm is 0", () => {
    const result = _deriveFocalLengthPxFromExif({
      FocalLenIn35mmFilm: 0,
      PixelXDimension: 1080,
    });
    expect(result).toBeNull();
  });

  // ── FocalLenIn35mmFilm negative ─────────────────────────────────────────────
  it("returns null when FocalLenIn35mmFilm is negative", () => {
    const result = _deriveFocalLengthPxFromExif({
      FocalLenIn35mmFilm: -26,
      PixelXDimension: 1080,
    });
    expect(result).toBeNull();
  });

  // ── Derived value below sanity floor (< 250 px) ────────────────────────────
  it("returns null when the derived px value falls below the 250 px sanity floor", () => {
    // fl35=8, imagePx=1080 → (8/36)×1080 = 240 < 250
    const result = _deriveFocalLengthPxFromExif({
      FocalLenIn35mmFilm: 8,
      PixelXDimension: 1080,
    });
    expect(result).toBeNull();
  });

  // ── Derived value above sanity ceiling (> 2500 px) ─────────────────────────
  it("returns null when the derived px value exceeds the 2500 px sanity ceiling", () => {
    // fl35=300, imagePx=1080 → (300/36)×1080 = 9000 > 2500
    const result = _deriveFocalLengthPxFromExif({
      FocalLenIn35mmFilm: 300,
      PixelXDimension: 1080,
    });
    expect(result).toBeNull();
  });

  // ── Missing PixelXDimension ─────────────────────────────────────────────────
  it("returns null when PixelXDimension is absent from EXIF", () => {
    const result = _deriveFocalLengthPxFromExif({
      FocalLenIn35mmFilm: 26,
      // PixelXDimension deliberately omitted
    });
    expect(result).toBeNull();
  });

  // ── PixelXDimension = 0 ─────────────────────────────────────────────────────
  it("returns null when PixelXDimension is 0", () => {
    const result = _deriveFocalLengthPxFromExif({
      FocalLenIn35mmFilm: 26,
      PixelXDimension: 0,
    });
    expect(result).toBeNull();
  });

  // ── Non-numeric EXIF fields ─────────────────────────────────────────────────
  it("returns null when EXIF fields are present but non-numeric strings", () => {
    const result = _deriveFocalLengthPxFromExif({
      FocalLenIn35mmFilm: "26mm", // OEM formatting oddity
      PixelXDimension: "1080",
    });
    expect(result).toBeNull();
  });

  // ── Completely empty EXIF object ────────────────────────────────────────────
  it("returns null for an empty EXIF object", () => {
    const result = _deriveFocalLengthPxFromExif({});
    expect(result).toBeNull();
  });

  // ── Formula accuracy ────────────────────────────────────────────────────────
  it("produces an accurate focalLengthPx for a known input (26 mm / 1080 px)", () => {
    const expected = (26 / 36) * 1080; // ≈ 780 px
    const result = _deriveFocalLengthPxFromExif({
      FocalLenIn35mmFilm: 26,
      PixelXDimension: 1080,
    });
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(expected, 5);
  });

  // ── Sanity-range boundary: just inside the floor ────────────────────────────
  it("accepts a derived value exactly at the 250 px floor", () => {
    // fl35 and imagePx chosen so that (fl35/36)×imagePx == 250 exactly
    // fl35=9, imagePx=1000 → (9/36)×1000 = 250
    const result = _deriveFocalLengthPxFromExif({
      FocalLenIn35mmFilm: 9,
      PixelXDimension: 1000,
    });
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(250, 5);
  });

  // ── Sanity-range boundary: just inside the ceiling ─────────────────────────
  it("accepts a derived value exactly at the 2500 px ceiling", () => {
    // fl35=90, imagePx=1000 → (90/36)×1000 = 2500
    const result = _deriveFocalLengthPxFromExif({
      FocalLenIn35mmFilm: 90,
      PixelXDimension: 1000,
    });
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(2500, 5);
  });
});
