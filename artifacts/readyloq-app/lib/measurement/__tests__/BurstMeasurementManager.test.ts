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
import { burstMeasurementManager } from "../BurstMeasurementManager";

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
