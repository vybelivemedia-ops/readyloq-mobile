import { describe, expect, it } from "vitest";
import type { Finding, VideoEvidence } from "@workspace/db";
import { computeEvidenceSummary } from "./evidence-summary";

function finding(overrides: Partial<Finding>): Finding {
  return {
    id: 1,
    category: "test",
    description: "test",
    confidence: 0.9,
    severity: "low",
    location: null,
    imageUrl: null,
    treatment: null,
    exclusionOpportunity: null,
    ...overrides,
  };
}

const video = (overrides: Partial<VideoEvidence> = {}): VideoEvidence => ({
  url: "vid",
  filename: null,
  durationSec: null,
  label: null,
  frameAnalysisStatus: "pending",
  ...overrides,
});

const group = (summary: ReturnType<typeof computeEvidenceSummary>, key: string) =>
  summary.groups.find((g) => g.key === key);

describe("computeEvidenceSummary", () => {
  it("returns a zeroed, never-null object for empty / missing findings", () => {
    for (const input of [[], null, undefined]) {
      const s = computeEvidenceSummary(input as Finding[] | null | undefined);
      expect(s).toEqual({ totalEvidence: 0, photoEvidence: 0, videoEvidence: 0, groups: [] });
    }
  });

  it("tallies pest species case-insensitively, keeping the first casing", () => {
    const s = computeEvidenceSummary([
      finding({ id: 1, species: "Rodent" }),
      finding({ id: 2, species: "rodent" }),
      finding({ id: 3, species: "RODENT" }),
      finding({ id: 4, species: "German Roach" }),
      finding({ id: 5, species: "German roach" }),
    ]);
    const pests = group(s, "pests");
    expect(pests?.total).toBe(5);
    // Sorted by count desc: Rodent (3) then German Roach (2). First casing kept.
    expect(pests?.items).toEqual([
      { key: "rodent", label: "Rodent", count: 3 },
      { key: "german roach", label: "German Roach", count: 2 },
    ]);
  });

  it("tallies structural defects and moisture by their own attributes", () => {
    const s = computeEvidenceSummary([
      finding({ id: 1, structuralIssue: "Pipe gap" }),
      finding({ id: 2, moisture: "Standing water" }),
      finding({ id: 3, moisture: "Leak under sink" }),
      finding({ id: 4, moisture: "Standing water" }),
    ]);
    expect(group(s, "structural")?.total).toBe(1);
    expect(group(s, "structural")?.items).toEqual([{ key: "pipe gap", label: "Pipe gap", count: 1 }]);
    const moisture = group(s, "moisture");
    expect(moisture?.total).toBe(3);
    expect(moisture?.items[0]).toEqual({ key: "standing water", label: "Standing water", count: 2 });
  });

  it("counts exclusion opportunities only when exclusionOpportunity is exactly true", () => {
    const s = computeEvidenceSummary([
      finding({ id: 1, exclusionOpportunity: true }),
      finding({ id: 2, exclusionOpportunity: true }),
      finding({ id: 3, exclusionOpportunity: false }),
      finding({ id: 4, exclusionOpportunity: null }),
    ]);
    const exclusion = group(s, "exclusion");
    expect(exclusion?.total).toBe(2);
    expect(exclusion?.items).toEqual([{ key: "exclusion", label: "Exclusion opportunity", count: 2 }]);
  });

  it("lets one finding contribute to multiple groups without inflating totalEvidence", () => {
    // A single photo shows a roach AND moisture AND an entry point.
    const s = computeEvidenceSummary([
      finding({ id: 1, species: "German Roach", moisture: "Damp", exclusionOpportunity: true, structuralIssue: "Gap" }),
    ]);
    expect(group(s, "pests")?.total).toBe(1);
    expect(group(s, "moisture")?.total).toBe(1);
    expect(group(s, "structural")?.total).toBe(1);
    expect(group(s, "exclusion")?.total).toBe(1);
    // Only ONE distinct evidence item, even though it lands in four groups.
    expect(s.totalEvidence).toBe(1);
    expect(s.photoEvidence).toBe(1);
  });

  it("counts attached videos toward totalEvidence but not findings", () => {
    const s = computeEvidenceSummary([finding({ id: 1, species: "Rat" })], [video(), video()]);
    expect(s.photoEvidence).toBe(1);
    expect(s.videoEvidence).toBe(2);
    expect(s.totalEvidence).toBe(3);
  });

  it("emits only non-empty groups in a stable order", () => {
    const s = computeEvidenceSummary([
      finding({ id: 1, exclusionOpportunity: true }),
      finding({ id: 2, species: "Mouse" }),
      finding({ id: 3, moisture: "Leak" }),
    ]);
    // Stable order regardless of finding order: pests, structural, moisture, exclusion.
    expect(s.groups.map((g) => g.key)).toEqual(["pests", "moisture", "exclusion"]);
  });

  it("ignores empty / whitespace / non-string attribute values", () => {
    const s = computeEvidenceSummary([
      finding({ id: 1, species: "" }),
      finding({ id: 2, species: "   " }),
      finding({ id: 3, moisture: undefined }),
      // Malformed value that could arrive via the untyped POST /analysis body.
      finding({ id: 4, structuralIssue: 123 as unknown as string }),
    ]);
    expect(s.groups).toEqual([]);
    expect(s.photoEvidence).toBe(4);
    expect(s.totalEvidence).toBe(4);
  });
});
