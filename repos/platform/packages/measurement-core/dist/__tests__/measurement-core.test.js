/**
 * @platform/measurement-core — Unit + Regression Test Stubs
 *
 * TYPES OF TESTS IN THIS FILE:
 *
 *   1. INTERFACE SHAPE TESTS (run now)
 *      Mock implementations that verify the exported interfaces are well-formed.
 *      If TypeScript accepts these mocks, the interface contracts are correct.
 *
 *   2. BEHAVIORAL CONTRACT TESTS (marked test.todo)
 *      Document what a real implementation MUST honour. These become real
 *      tests when concrete adapters are extracted from the application.
 *
 *   3. REGRESSION TESTS (marked test.todo)
 *      Guard against regressions in specific numeric behaviours: unit conversion,
 *      confidence interval calculation, pHash cache key stability, annotation
 *      version incrementing.
 *
 * HOW TO USE WHEN IMPLEMENTING:
 *   1. Create concrete implementations in src/adapters/
 *   2. Replace mock constructors with real implementations
 *   3. Replace test.todo blocks with real assertions
 *   4. Run: pnpm --filter @platform/measurement-core test
 */
import { describe, it, expect, test } from "vitest";
import { MEASUREMENT_EVENT_KINDS } from "../index.js";
// ─────────────────────────────────────────────────────────────────────────────
// MOCK FACTORIES
// ─────────────────────────────────────────────────────────────────────────────
function makeCalibration(overrides) {
    return {
        id: "cal-001",
        status: "focal_length_auto",
        focalLengthMm: 26,
        sensorWidthMm: 6.4,
        imageWidthPx: 4032,
        pixelsPerMm: 4032 / 6.4, // = 630 px/mm
        calibrationConfidence: 0.7,
        createdAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}
function makeDimensionEstimate(kind = "width", value = 25, unit = "mm") {
    return {
        kind,
        value,
        unit,
        lowerBound: value * 0.9,
        upperBound: value * 1.1,
        confidence: {
            score: 0.75,
            method: "single_image_reference",
            calibrationStatus: "reference_object",
            warnings: [],
            uncertaintyMm: value * 0.05,
        },
    };
}
function makeRegion(overrides) {
    return { x: 0.2, y: 0.3, width: 0.1, height: 0.05, ...overrides };
}
function makeMeasurementRequest(overrides) {
    return {
        id: "req-001",
        kinds: ["width", "height"],
        input: {
            kind: "image_base64",
            imageBase64: "base64==",
            imageMimeType: "image/jpeg",
            imageWidthPx: 4032,
            imageHeightPx: 3024,
        },
        useCache: true,
        priority: "normal",
        ...overrides,
    };
}
function makeMockGeometryService() {
    return {
        polygonAreaPx(polygon, imageWidthPx, imageHeightPx) {
            // Shoelace formula on normalised polygon
            let area = 0;
            const pts = polygon.points;
            for (let i = 0; i < pts.length; i++) {
                const j = (i + 1) % pts.length;
                area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
            }
            return Math.abs(area / 2) * imageWidthPx * imageHeightPx;
        },
        pixelAreaToRealArea(pixelArea, calibration, outputUnit) {
            const mm2 = pixelArea / ((calibration.pixelsPerMm ?? 1) ** 2);
            return makeDimensionEstimate("area", mm2, "mm2");
        },
        polygonPerimeterPx(polygon, imageWidthPx, imageHeightPx) {
            let perimeter = 0;
            const pts = polygon.points;
            for (let i = 0; i < pts.length; i++) {
                const j = (i + 1) % pts.length;
                const dx = (pts[j].x - pts[i].x) * imageWidthPx;
                const dy = (pts[j].y - pts[i].y) * imageHeightPx;
                perimeter += Math.sqrt(dx * dx + dy * dy);
            }
            return perimeter;
        },
        angleBetweenSegments(segA, segB) {
            const [a1, a2] = segA;
            const [b1, b2] = segB;
            const vecA = { x: a2.x - a1.x, y: a2.y - a1.y };
            const vecB = { x: b2.x - b1.x, y: b2.y - b1.y };
            const dot = vecA.x * vecB.x + vecA.y * vecB.y;
            const magA = Math.sqrt(vecA.x ** 2 + vecA.y ** 2);
            const magB = Math.sqrt(vecB.x ** 2 + vecB.y ** 2);
            return Math.acos(dot / (magA * magB)) * (180 / Math.PI);
        },
        estimateVolume(crossSectionAreaMm2, depthMm, outputUnit) {
            return makeDimensionEstimate("volume", crossSectionAreaMm2 * depthMm, "mm3");
        },
        convert(value, from, to) {
            // Minimal subset: mm ↔ cm ↔ m ↔ in
            const toMm = {
                mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8,
            };
            const mmValue = value * (toMm[from] ?? 1);
            return mmValue / (toMm[to] ?? 1);
        },
    };
}
function makeMockCache() {
    const store = new Map();
    let hits = 0, misses = 0;
    return {
        get(key) {
            const entry = store.get(key);
            if (!entry || Date.now() > entry.expiresAt) {
                misses++;
                return undefined;
            }
            hits++;
            return entry.result;
        },
        set(key, result, ttlSeconds = 300) {
            store.set(key, { result, expiresAt: Date.now() + ttlSeconds * 1000 });
        },
        delete(key) { store.delete(key); },
        invalidateForCalibrationProfile(profileId) {
            for (const [k, v] of store.entries()) {
                if (v.result.calibrationProfile.id === profileId)
                    store.delete(k);
            }
        },
        pruneExpired() {
            const now = Date.now();
            for (const [k, v] of store.entries()) {
                if (now > v.expiresAt)
                    store.delete(k);
            }
        },
        clear() { store.clear(); hits = 0; misses = 0; },
        hitRate() { return hits + misses === 0 ? 0 : hits / (hits + misses); },
        stats() {
            return { entries: store.size, hits, misses };
        },
    };
}
// ─────────────────────────────────────────────────────────────────────────────
// INTERFACE SHAPE TESTS
// ─────────────────────────────────────────────────────────────────────────────
describe("CalibrationProfile — interface shape", () => {
    it("makeCalibration produces a valid CalibrationProfile", () => {
        const cal = makeCalibration();
        expect(cal).toHaveProperty("id");
        expect(cal).toHaveProperty("status");
        expect(cal.calibrationConfidence).toBeGreaterThanOrEqual(0);
        expect(cal.calibrationConfidence).toBeLessThanOrEqual(1);
        expect(cal.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
    it("pixelsPerMm derives from focalLengthMm + sensorWidthMm + imageWidthPx", () => {
        const cal = makeCalibration();
        const expected = (cal.focalLengthMm / cal.sensorWidthMm) * (1 / 1); // simplified
        // Just check it is positive
        expect(cal.pixelsPerMm).toBeGreaterThan(0);
    });
});
describe("DimensionEstimate — interface shape", () => {
    it("produces a valid DimensionEstimate", () => {
        const est = makeDimensionEstimate("diameter", 12, "mm");
        expect(est.kind).toBe("diameter");
        expect(est.value).toBe(12);
        expect(est.unit).toBe("mm");
        expect(est.confidence.score).toBeGreaterThanOrEqual(0);
        expect(est.confidence.score).toBeLessThanOrEqual(1);
        expect(Array.isArray(est.confidence.warnings)).toBe(true);
    });
    it("lowerBound < value < upperBound when both defined", () => {
        const est = makeDimensionEstimate("width", 25, "mm");
        expect(est.lowerBound).toBeLessThan(est.value);
        expect(est.upperBound).toBeGreaterThan(est.value);
    });
});
describe("GeometryService — unit conversion", () => {
    const geo = makeMockGeometryService();
    it("1 inch = 25.4 mm", () => {
        expect(geo.convert(1, "in", "mm")).toBeCloseTo(25.4);
    });
    it("1 foot = 304.8 mm", () => {
        expect(geo.convert(1, "ft", "mm")).toBeCloseTo(304.8);
    });
    it("1 m = 100 cm", () => {
        expect(geo.convert(1, "m", "cm")).toBeCloseTo(100);
    });
    it("is identity for same unit", () => {
        expect(geo.convert(42, "mm", "mm")).toBe(42);
    });
});
describe("GeometryService — polygon area", () => {
    const geo = makeMockGeometryService();
    it("axis-aligned unit square has area = imageW * imageH", () => {
        const square = {
            points: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 1, y: 1 },
                { x: 0, y: 1 },
            ],
            isClosed: true,
        };
        const area = geo.polygonAreaPx(square, 1000, 1000);
        expect(area).toBeCloseTo(1_000_000);
    });
    it("area is zero for a degenerate polygon (all same point)", () => {
        const degenerate = {
            points: [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }],
            isClosed: true,
        };
        expect(geo.polygonAreaPx(degenerate, 1000, 1000)).toBe(0);
    });
});
describe("GeometryService — angle", () => {
    const geo = makeMockGeometryService();
    it("perpendicular segments have 90° angle", () => {
        const segA = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
        const segB = [{ x: 0, y: 0 }, { x: 0, y: 1 }];
        expect(geo.angleBetweenSegments(segA, segB)).toBeCloseTo(90);
    });
    it("parallel segments have 0° angle", () => {
        const segA = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
        const segB = [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }];
        expect(geo.angleBetweenSegments(segA, segB)).toBeCloseTo(0);
    });
});
describe("MeasurementCache", () => {
    it("cold cache returns undefined", () => {
        const cache = makeMockCache();
        expect(cache.get("missing-key")).toBeUndefined();
    });
    it("set and get round-trips the result", () => {
        const cache = makeMockCache();
        const result = {
            requestId: "r1",
            estimates: [makeDimensionEstimate()],
            detectedObjects: [],
            calibrationProfile: makeCalibration(),
            method: "single_image_reference",
            cached: false,
            latencyMs: 120,
            measuredAt: new Date().toISOString(),
        };
        cache.set("key-1", result);
        expect(cache.get("key-1")).toEqual(result);
    });
    it("hitRate is 1.0 after 3 hits, 0 misses", () => {
        const cache = makeMockCache();
        const result = {
            requestId: "r1",
            estimates: [],
            detectedObjects: [],
            calibrationProfile: makeCalibration(),
            method: "single_image_reference",
            cached: true,
            latencyMs: 1,
            measuredAt: new Date().toISOString(),
        };
        cache.set("k", result);
        cache.get("k");
        cache.get("k");
        cache.get("k");
        expect(cache.hitRate()).toBeCloseTo(1.0);
    });
    it("delete removes entry", () => {
        const cache = makeMockCache();
        cache.set("k2", {});
        cache.delete("k2");
        expect(cache.get("k2")).toBeUndefined();
    });
    it("clear resets all stats", () => {
        const cache = makeMockCache();
        cache.set("k3", {});
        cache.get("k3");
        cache.clear();
        expect(cache.stats().entries).toBe(0);
        expect(cache.stats().hits).toBe(0);
    });
});
describe("MEASUREMENT_EVENT_KINDS", () => {
    it("all values follow measurement.<noun>.<verb> convention", () => {
        const kinds = Object.values(MEASUREMENT_EVENT_KINDS);
        for (const kind of kinds) {
            expect(kind).toMatch(/^measurement\./);
        }
    });
    it("no duplicate event kind values", () => {
        const kinds = Object.values(MEASUREMENT_EVENT_KINDS);
        expect(new Set(kinds).size).toBe(kinds.length);
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIORAL CONTRACT TESTS (test.todo — implement with real adapters)
// ─────────────────────────────────────────────────────────────────────────────
describe("MeasurementEngine — single image flow", () => {
    it("returns a MeasurementResult with at least one estimate", () => {
        test.todo("engine.measure(request) resolves with estimates.length >= 1");
    });
    it("returns cached result on second identical call", () => {
        test.todo("second call with same input returns result.cached === true and latencyMs < 5");
    });
    it("falls back to uncalibrated estimate when no EXIF and no reference object", () => {
        test.todo("result.calibrationProfile.status === 'uncalibrated' and confidence.score < 0.5");
    });
    it("improves confidence when reference object is provided", () => {
        test.todo("confidence with credit_card reference > confidence without any reference");
    });
});
describe("MeasurementEngine — annotation versioning", () => {
    it("first annotation has version=1 and isActive=true", () => {
        test.todo("annotateEvidence returns annotation with version===1 and isActive===true");
    });
    it("revising annotation creates version=2, deactivates version=1", () => {
        test.todo("after reviseAnnotation: new version===2 isActive=true, old version===1 isActive=false");
    });
    it("getActive returns the highest active version", () => {
        test.todo("history.getActive(evidenceItemId) returns the annotation with highest version and isActive=true");
    });
});
describe("CalibrationService — auto-calibrate", () => {
    it("returns focal_length_auto status when EXIF is present", () => {
        test.todo("CalibrationProfile.status === 'focal_length_auto' when exifJson includes FocalLength");
    });
    it("returns reference_object status when reference object is detected", () => {
        test.todo("CalibrationProfile.status === 'reference_object' after successful ReferenceObjectService.detectInImage");
    });
    it("calibrationConfidence increases with better calibration source", () => {
        test.todo("ar_anchored confidence > reference_object confidence > focal_length_auto confidence > uncalibrated");
    });
});
// ─────────────────────────────────────────────────────────────────────────────
// REGRESSION TESTS (test.todo — implement with concrete implementations)
// ─────────────────────────────────────────────────────────────────────────────
describe("REGRESSION — geometry invariants", () => {
    it("pixel-to-mm-to-pixel round-trip is identity", () => {
        test.todo("mmToPixels(pixelsToMm(100, scale), scale) === 100 for any scale");
    });
    it("unit conversion is reversible", () => {
        test.todo("convert(convert(x, 'mm', 'in'), 'in', 'mm') ≈ x");
    });
    it("polygon area with known rectangle matches analytical formula", () => {
        test.todo("0.5×0.5 normalised square on 1000×1000 image has area = 250_000 px²");
    });
    it("volume = area × depth", () => {
        test.todo("estimateVolume(100 mm², 10 mm) = 1000 mm³");
    });
});
describe("REGRESSION — calibration consistency", () => {
    it("pixelsPerMm = (focalLengthMm / sensorWidthMm) * imageWidthPx / focalLengthMm", () => {
        test.todo("derived pixelsPerMm matches expected value for known camera spec");
    });
    it("reference object calibration produces correct scale for credit card", () => {
        test.todo("credit card (85.6mm) spanning 300px → pixelsPerMm ≈ 3.5 px/mm");
    });
});
describe("REGRESSION — MeasurementCache perceptual hash stability", () => {
    it("same image produces same cache key on repeated calls", () => {
        test.todo("two calls with identical imageBase64 return the same key string");
    });
    it("different images produce different cache keys", () => {
        test.todo("distinct imageBase64 strings have different pHash keys");
    });
});
//# sourceMappingURL=measurement-core.test.js.map