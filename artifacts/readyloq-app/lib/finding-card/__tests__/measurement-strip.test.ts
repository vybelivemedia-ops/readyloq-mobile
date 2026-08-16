/**
 * Unit tests — FindingCard measurement strip logic
 *
 * Imports the pure-logic helpers that FindingCard.tsx uses to decide whether
 * and how to render the stamped measurement block.  Regressions in the strip's
 * visibility or amber-flag logic will be caught here without requiring a full
 * React Native render.
 *
 * Covers the three contracts from the task spec:
 *  (a) burst-reference captureMetadata present → strip variant is "burst",
 *      W / H / area are all available on the laser object
 *  (b) no captureMetadata (offline / partial sync) → variant is "absent",
 *      strip must not render
 *  (c) low-confidence captureMetadata (< 50 %) → isLowConfidence returns true,
 *      amber flag is shown
 *
 * Relevant source files:
 *   artifacts/readyloq-app/lib/finding-card/measurement-strip-logic.ts ← imported here
 *   artifacts/readyloq-app/components/FindingCard.tsx                   ← imports same module
 */

import { describe, it, expect } from "vitest";
import {
  resolveLaserMeasurement,
  isBurstMeasurement,
  measurementConfidence,
  isLowConfidence,
  measurementStripVariant,
  type LaserMeasurement,
} from "../measurement-strip-logic";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const BURST_METADATA: Record<string, unknown> = {
  laserMeasurement: {
    kind: "laser",
    value: 12.5,
    unit: "in",
    signalQuality: 0.91,
    metadata: {
      method: "burst_reference",
      heightInches: 8.3,
      areaSqInches: 103.75,
      confidence: 0.87,
      warnings: [],
    },
  },
};

const LASER_ONLY_METADATA: Record<string, unknown> = {
  laserMeasurement: {
    kind: "laser",
    value: 6.0,
    unit: "in",
    signalQuality: 0.72,
    // no metadata.method → not a burst measurement
  },
};

const LOW_CONF_BURST_METADATA: Record<string, unknown> = {
  laserMeasurement: {
    kind: "laser",
    value: 9.1,
    unit: "in",
    signalQuality: 0.3,
    metadata: {
      method: "burst_reference",
      heightInches: 5.5,
      areaSqInches: 50.05,
      confidence: 0.41,            // < 0.5 → amber
      warnings: ["low light", "motion blur"],
    },
  },
};

const LOW_CONF_SIGNAL_ONLY_METADATA: Record<string, unknown> = {
  laserMeasurement: {
    kind: "laser",
    value: 4.0,
    unit: "in",
    signalQuality: 0.2,           // < 0.5, no inner confidence
  },
};

// ---------------------------------------------------------------------------
// (a) Burst-reference captureMetadata → strip renders with W / H / area
// ---------------------------------------------------------------------------

describe("resolveLaserMeasurement — burst-reference captureMetadata", () => {
  it("returns a non-null LaserMeasurement when captureMetadata has a laserMeasurement key", () => {
    const laser = resolveLaserMeasurement(BURST_METADATA);
    expect(laser).not.toBeNull();
  });

  it("preserves the width value (laser.value)", () => {
    const laser = resolveLaserMeasurement(BURST_METADATA)!;
    expect(laser.value).toBe(12.5);
  });

  it("preserves heightInches in laser.metadata", () => {
    const laser = resolveLaserMeasurement(BURST_METADATA)!;
    expect(laser.metadata?.heightInches).toBe(8.3);
  });

  it("preserves areaSqInches in laser.metadata", () => {
    const laser = resolveLaserMeasurement(BURST_METADATA)!;
    expect(laser.metadata?.areaSqInches).toBe(103.75);
  });

  it("preserves the burst-reference method string", () => {
    const laser = resolveLaserMeasurement(BURST_METADATA)!;
    expect(laser.metadata?.method).toBe("burst_reference");
  });
});

describe("isBurstMeasurement — burst-reference detection", () => {
  it("returns true for a burst_reference laser measurement", () => {
    const laser = resolveLaserMeasurement(BURST_METADATA)!;
    expect(isBurstMeasurement(laser)).toBe(true);
  });

  it("returns false when method is absent (laser-only measurement)", () => {
    const laser = resolveLaserMeasurement(LASER_ONLY_METADATA)!;
    expect(isBurstMeasurement(laser)).toBe(false);
  });

  it("returns false when method is a non-burst string", () => {
    const laser: LaserMeasurement = { metadata: { method: "single_shot" } };
    expect(isBurstMeasurement(laser)).toBe(false);
  });

  it("returns false when metadata is absent entirely", () => {
    const laser: LaserMeasurement = { value: 5 };
    expect(isBurstMeasurement(laser)).toBe(false);
  });
});

describe("measurementStripVariant — burst captureMetadata → 'burst'", () => {
  it("returns 'burst' for a burst_reference captureMetadata object", () => {
    expect(measurementStripVariant(BURST_METADATA)).toBe("burst");
  });

  it("returns 'laser' for a laser-only captureMetadata (method absent)", () => {
    expect(measurementStripVariant(LASER_ONLY_METADATA)).toBe("laser");
  });
});

// ---------------------------------------------------------------------------
// (b) No captureMetadata (offline / partial sync) → strip absent
// ---------------------------------------------------------------------------

describe("resolveLaserMeasurement — absent / null captureMetadata", () => {
  it("returns null when captureMetadata is null", () => {
    expect(resolveLaserMeasurement(null)).toBeNull();
  });

  it("returns null when captureMetadata is undefined", () => {
    expect(resolveLaserMeasurement(undefined)).toBeNull();
  });

  it("returns null when captureMetadata exists but has no laserMeasurement key", () => {
    expect(resolveLaserMeasurement({ someOtherField: "value" })).toBeNull();
  });

  it("returns null when laserMeasurement is null", () => {
    expect(resolveLaserMeasurement({ laserMeasurement: null })).toBeNull();
  });

  it("returns null when laserMeasurement is a non-object primitive", () => {
    expect(resolveLaserMeasurement({ laserMeasurement: 42 })).toBeNull();
  });
});

describe("measurementStripVariant — absent captureMetadata → 'absent'", () => {
  it("returns 'absent' for null captureMetadata", () => {
    expect(measurementStripVariant(null)).toBe("absent");
  });

  it("returns 'absent' for undefined captureMetadata", () => {
    expect(measurementStripVariant(undefined)).toBe("absent");
  });

  it("returns 'absent' when captureMetadata has no laserMeasurement key", () => {
    expect(measurementStripVariant({ notes: "clean unit" })).toBe("absent");
  });

  it("returns 'absent' when laserMeasurement is null inside captureMetadata", () => {
    expect(measurementStripVariant({ laserMeasurement: null })).toBe("absent");
  });

  it("returns 'absent' when laserMeasurement is a primitive (corrupted record)", () => {
    expect(measurementStripVariant({ laserMeasurement: "bad" })).toBe("absent");
  });
});

// ---------------------------------------------------------------------------
// (c) Low-confidence captureMetadata (< 50 %) → amber flag shown
// ---------------------------------------------------------------------------

describe("measurementConfidence — inner metadata.confidence preferred over signalQuality", () => {
  it("returns metadata.confidence (inner) when present", () => {
    const laser = resolveLaserMeasurement(BURST_METADATA)!;
    expect(measurementConfidence(laser)).toBe(0.87);
  });

  it("falls back to signalQuality when metadata.confidence is absent", () => {
    const laser = resolveLaserMeasurement(LASER_ONLY_METADATA)!;
    expect(measurementConfidence(laser)).toBe(0.72);
  });

  it("returns null when neither confidence source is present", () => {
    const laser: LaserMeasurement = { value: 3.0 };
    expect(measurementConfidence(laser)).toBeNull();
  });

  it("returns 0 (not null) when confidence is explicitly 0", () => {
    const laser: LaserMeasurement = { metadata: { confidence: 0 } };
    expect(measurementConfidence(laser)).toBe(0);
  });
});

describe("isLowConfidence — amber-flag threshold at 50 %", () => {
  it("returns false for high confidence (0.87 > 0.5)", () => {
    expect(isLowConfidence(0.87)).toBe(false);
  });

  it("returns false for exactly 0.5 (boundary: not low)", () => {
    expect(isLowConfidence(0.5)).toBe(false);
  });

  it("returns true for confidence just below 0.5 (0.499…)", () => {
    expect(isLowConfidence(0.499)).toBe(true);
  });

  it("returns true for low-burst confidence (0.41)", () => {
    const laser = resolveLaserMeasurement(LOW_CONF_BURST_METADATA)!;
    expect(isLowConfidence(measurementConfidence(laser))).toBe(true);
  });

  it("returns true for low signalQuality-only confidence (0.2)", () => {
    const laser = resolveLaserMeasurement(LOW_CONF_SIGNAL_ONLY_METADATA)!;
    expect(isLowConfidence(measurementConfidence(laser))).toBe(true);
  });

  it("returns true for zero confidence", () => {
    expect(isLowConfidence(0)).toBe(true);
  });

  it("returns false (not flagged) when confidence is null (absent)", () => {
    expect(isLowConfidence(null)).toBe(false);
  });
});

describe("amber flag end-to-end — low-confidence burst measurement", () => {
  it("low-conf burst: strip variant is still 'burst' (it renders, just amber)", () => {
    expect(measurementStripVariant(LOW_CONF_BURST_METADATA)).toBe("burst");
  });

  it("low-conf burst: confidence resolves to 0.41 (below 0.5 threshold)", () => {
    const laser = resolveLaserMeasurement(LOW_CONF_BURST_METADATA)!;
    expect(measurementConfidence(laser)).toBe(0.41);
  });

  it("low-conf burst: isLowConfidence is true → amber accent colour applied", () => {
    const laser = resolveLaserMeasurement(LOW_CONF_BURST_METADATA)!;
    expect(isLowConfidence(measurementConfidence(laser))).toBe(true);
  });

  it("low-conf burst: warnings array is preserved for display", () => {
    const laser = resolveLaserMeasurement(LOW_CONF_BURST_METADATA)!;
    expect(laser.metadata?.warnings).toEqual(["low light", "motion blur"]);
  });

  it("high-conf burst: isLowConfidence is false → info colour applied (not amber)", () => {
    const laser = resolveLaserMeasurement(BURST_METADATA)!;
    expect(isLowConfidence(measurementConfidence(laser))).toBe(false);
  });
});
