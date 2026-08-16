/**
 * Unit tests — InspectionDetail url → captureMetadata cross-reference lookup
 *
 * InspectionDetail.tsx resolves a finding's captureMetadata by scanning the
 * inspection's photo array for an exact URL match:
 *
 *   const mediaMeta = f.imageUrl
 *     ? (photos.find((m) => m.url === f.imageUrl)
 *         ?.captureMetadata as Record<string, unknown> | null | undefined)
 *     : null;
 *
 * This test suite covers that lookup via the pure `lookupCaptureMetadata`
 * helper extracted to capture-metadata-lookup.ts.
 *
 * Relevant source files:
 *   artifacts/readyloq-app/lib/finding-card/capture-metadata-lookup.ts ← imported here
 *   artifacts/readyloq-app/components/InspectionDetail.tsx              ← uses same logic
 */

import { describe, it, expect } from "vitest";
import { lookupCaptureMetadata, type MediaRecord } from "../capture-metadata-lookup";

// ---------------------------------------------------------------------------
// Shared fixtures — a typical inspection photo array
// ---------------------------------------------------------------------------

const BURST_META: Record<string, unknown> = {
  laserMeasurement: {
    value: 10.0,
    metadata: { method: "burst_reference", heightInches: 6.0, areaSqInches: 60.0, confidence: 0.85 },
  },
};

const LASER_META: Record<string, unknown> = {
  laserMeasurement: { value: 5.5, signalQuality: 0.78 },
};

const PHOTOS: MediaRecord[] = [
  { url: "/api/media/photo-abc.jpg", captureMetadata: BURST_META },
  { url: "/api/media/photo-def.jpg", captureMetadata: LASER_META },
  { url: "/api/media/photo-ghi.jpg", captureMetadata: null },     // photo present, no metadata
  { url: "/api/media/photo-jkl.jpg" },                            // captureMetadata key absent
];

// ---------------------------------------------------------------------------
// Happy path — URL present and matching
// ---------------------------------------------------------------------------

describe("lookupCaptureMetadata — URL matches a photo with captureMetadata", () => {
  it("returns the captureMetadata object when the URL matches exactly", () => {
    const result = lookupCaptureMetadata(PHOTOS, "/api/media/photo-abc.jpg");
    expect(result).toEqual(BURST_META);
  });

  it("returns the correct metadata for the second photo in the array", () => {
    const result = lookupCaptureMetadata(PHOTOS, "/api/media/photo-def.jpg");
    expect(result).toEqual(LASER_META);
  });

  it("result contains laserMeasurement for a burst-reference photo", () => {
    const result = lookupCaptureMetadata(PHOTOS, "/api/media/photo-abc.jpg");
    expect(result?.laserMeasurement).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Null / absent captureMetadata on the matched record
// ---------------------------------------------------------------------------

describe("lookupCaptureMetadata — URL matches but captureMetadata is absent/null", () => {
  it("returns null when the matching photo has captureMetadata: null", () => {
    const result = lookupCaptureMetadata(PHOTOS, "/api/media/photo-ghi.jpg");
    expect(result).toBeNull();
  });

  it("returns null when the matching photo has no captureMetadata key at all", () => {
    const result = lookupCaptureMetadata(PHOTOS, "/api/media/photo-jkl.jpg");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// URL mismatch — partial offline sync or CDN rewrite
// ---------------------------------------------------------------------------

describe("lookupCaptureMetadata — URL mismatch (partial offline sync)", () => {
  it("returns null when the imageUrl has no match in the photos array", () => {
    const result = lookupCaptureMetadata(PHOTOS, "/api/media/not-uploaded-yet.jpg");
    expect(result).toBeNull();
  });

  it("returns null for a near-match URL (trailing slash difference)", () => {
    // URL normalisation must NOT happen silently — exact match only
    const result = lookupCaptureMetadata(PHOTOS, "/api/media/photo-abc.jpg/");
    expect(result).toBeNull();
  });

  it("returns null for a URL that differs only in protocol (http vs https)", () => {
    const photosWithHttps: MediaRecord[] = [
      { url: "https://cdn.example.com/photo-abc.jpg", captureMetadata: BURST_META },
    ];
    const result = lookupCaptureMetadata(photosWithHttps, "http://cdn.example.com/photo-abc.jpg");
    expect(result).toBeNull();
  });

  it("returns null for a URL that differs only in query string", () => {
    const photosWithQuery: MediaRecord[] = [
      { url: "/api/media/photo-abc.jpg?v=2", captureMetadata: BURST_META },
    ];
    const result = lookupCaptureMetadata(photosWithQuery, "/api/media/photo-abc.jpg");
    expect(result).toBeNull();
  });

  it("returns null for a case-differing URL (URL matching is case-sensitive)", () => {
    const result = lookupCaptureMetadata(PHOTOS, "/api/media/PHOTO-ABC.jpg");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Absent imageUrl on the finding (finding has no evidence photo)
// ---------------------------------------------------------------------------

describe("lookupCaptureMetadata — finding has no imageUrl", () => {
  it("returns null when imageUrl is null", () => {
    expect(lookupCaptureMetadata(PHOTOS, null)).toBeNull();
  });

  it("returns null when imageUrl is undefined", () => {
    expect(lookupCaptureMetadata(PHOTOS, undefined)).toBeNull();
  });

  it("returns null when imageUrl is an empty string", () => {
    expect(lookupCaptureMetadata(PHOTOS, "")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Empty photos array (full offline — no media synced yet)
// ---------------------------------------------------------------------------

describe("lookupCaptureMetadata — empty photos array (full offline)", () => {
  it("returns null when the photos array is empty", () => {
    const result = lookupCaptureMetadata([], "/api/media/photo-abc.jpg");
    expect(result).toBeNull();
  });

  it("does not throw for an empty array and a valid imageUrl", () => {
    expect(() => lookupCaptureMetadata([], "/api/media/photo-abc.jpg")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Multiple photos with the same URL (degenerate case — first match wins)
// ---------------------------------------------------------------------------

describe("lookupCaptureMetadata — duplicate URLs in the photos array", () => {
  it("returns the first matching record's captureMetadata (Array.find semantics)", () => {
    const META_A: Record<string, unknown> = { laserMeasurement: { value: 1 } };
    const META_B: Record<string, unknown> = { laserMeasurement: { value: 2 } };
    const photos: MediaRecord[] = [
      { url: "/api/media/dupe.jpg", captureMetadata: META_A },
      { url: "/api/media/dupe.jpg", captureMetadata: META_B },
    ];
    const result = lookupCaptureMetadata(photos, "/api/media/dupe.jpg");
    expect(result).toEqual(META_A);
  });
});
