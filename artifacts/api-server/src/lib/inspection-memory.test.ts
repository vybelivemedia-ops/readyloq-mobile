import { describe, expect, it } from "vitest";
import type { CoverageSnapshot, CoverageZone, Finding } from "@workspace/db";
import { computeInspectionMemory, type PriorVisit } from "./inspection-memory";

const zone = (slug: string, label = slug): CoverageZone => ({ slug, label });

function coverage(overrides: Partial<CoverageSnapshot> = {}): CoverageSnapshot {
  return {
    propertyType: "Commercial",
    completenessPct: 0,
    requiredZones: [],
    coveredRequired: [],
    uncoveredRequired: [],
    suggested: [],
    ...overrides,
  };
}

function finding(overrides: Partial<Finding>): Finding {
  return {
    id: 1,
    category: "observation",
    description: "observation",
    confidence: 0.9,
    severity: "low",
    location: null,
    imageUrl: null,
    treatment: null,
    exclusionOpportunity: null,
    ...overrides,
  };
}

const DAY = 24 * 60 * 60 * 1000;
const older = new Date(Date.now() - 30 * DAY);
const newer = new Date(Date.now() - 7 * DAY);

describe("computeInspectionMemory", () => {
  it("returns empty memory (no prior visits) for null/empty prior visits", () => {
    for (const input of [null, undefined, []]) {
      const m = computeInspectionMemory(input, { findings: [] });
      expect(m.hasPriorVisits).toBe(false);
      expect(m.priorVisitCount).toBe(0);
      expect(m.highlights).toEqual([]);
      expect(m.pestActivity).toEqual([]);
    }
  });

  it("aggregates prior pest activity, entry points, treatments and recommendations", () => {
    const priors: PriorVisit[] = [
      {
        date: older,
        findings: [
          finding({ species: "House mouse", severity: "medium", zone: "kitchen_sanitation", treatment: "Seal gaps" }),
          finding({ exclusionOpportunity: true, description: "Gap under exterior door", zone: "exterior_perimeter" }),
        ],
        recommendations: ["Install door sweep"],
      },
      {
        date: newer,
        findings: [
          finding({ species: "House Mouse", severity: "high", zone: "kitchen_sanitation" }),
        ],
        recommendations: ["Install door sweep", "Trim vegetation"],
      },
    ];

    const m = computeInspectionMemory(priors, {
      // Everything covered today so no highlights distract these assertions.
      coverage: coverage({ coveredRequired: [zone("kitchen_sanitation"), zone("exterior_perimeter")] }),
      findings: [],
    });

    expect(m.hasPriorVisits).toBe(true);
    expect(m.priorVisitCount).toBe(2);
    // Species aggregated case-insensitively; count across both visits; max severity kept.
    expect(m.pestActivity).toHaveLength(1);
    expect(m.pestActivity[0].label).toBe("House mouse");
    expect(m.pestActivity[0].visits).toBe(2);
    expect(m.pestActivity[0].severity).toBe("high");
    // Entry point captured from exclusionOpportunity.
    expect(m.entryPoints.map((e) => e.description)).toContain("Gap under exterior door");
    // Recommendations deduped case-insensitively across visits.
    expect(m.recommendations.map((r) => r.text).sort()).toEqual(["Install door sweep", "Trim vegetation"]);
    // Treatments surfaced from finding.treatment.
    expect(m.treatments.map((t) => t.text)).toContain("Seal gaps");
    expect(m.highlights).toEqual([]);
  });

  it("grounds bait/monitoring memory in real rodent detections and never invents station numbers", () => {
    const priors: PriorVisit[] = [
      {
        date: newer,
        findings: [finding({ species: "Norway rat", description: "Rodent droppings near bait station", zone: "waste_dumpster" })],
        recommendations: [],
      },
    ];
    const m = computeInspectionMemory(priors, {
      coverage: coverage({ coveredRequired: [zone("waste_dumpster")] }),
      findings: [],
    });
    expect(m.baitStations).toHaveLength(1);
    expect(m.baitStations[0].description).toBe("Rodent droppings near bait station");
    // Honesty: nothing fabricates an enumerated "station #N".
    const blob = JSON.stringify(m);
    expect(blob).not.toMatch(/station #\d/i);
  });

  it("highlights a previously-active rodent zone that is NOT photographed today", () => {
    const priors: PriorVisit[] = [
      { date: newer, findings: [finding({ species: "House mouse", zone: "attic_roofline" })], recommendations: [] },
    ];
    const m = computeInspectionMemory(priors, {
      coverage: coverage({ requiredZones: [zone("attic_roofline", "Attic")], uncoveredRequired: [zone("attic_roofline", "Attic")] }),
      findings: [],
      photoZones: {},
    });
    expect(m.highlights).toHaveLength(1);
    expect(m.highlights[0].type).toBe("rodent_area_not_photographed");
    expect(m.highlights[0].zone).toBe("attic_roofline");
    expect(m.highlights[0].label).toBe("Attic");
  });

  it("highlights a previously-active NON-rodent area not inspected today", () => {
    const priors: PriorVisit[] = [
      { date: newer, findings: [finding({ category: "pest activity", species: "German cockroach", zone: "kitchen_sanitation" })], recommendations: [] },
    ];
    const m = computeInspectionMemory(priors, {
      coverage: coverage({ requiredZones: [zone("kitchen_sanitation", "Kitchen")], uncoveredRequired: [zone("kitchen_sanitation", "Kitchen")] }),
      findings: [],
    });
    expect(m.highlights).toHaveLength(1);
    expect(m.highlights[0].type).toBe("area_not_inspected");
  });

  it("does NOT highlight a prior zone that IS covered today (via coverage, finding, or photoZone)", () => {
    const priors: PriorVisit[] = [
      { date: newer, findings: [finding({ species: "House mouse", zone: "attic_roofline" })], recommendations: [] },
    ];
    // covered via coverage.coveredRequired
    expect(
      computeInspectionMemory(priors, {
        coverage: coverage({ coveredRequired: [zone("attic_roofline")] }),
        findings: [],
      }).highlights,
    ).toEqual([]);
    // covered via today's finding zone
    expect(
      computeInspectionMemory(priors, {
        coverage: coverage(),
        findings: [finding({ zone: "attic_roofline" })],
      }).highlights,
    ).toEqual([]);
    // covered via today's photoZones
    expect(
      computeInspectionMemory(priors, {
        coverage: coverage(),
        findings: [],
        photoZones: { "/objects/x.jpg": "attic_roofline" },
      }).highlights,
    ).toEqual([]);
  });

  it("never drives a highlight from a prior finding with an unknown (null) zone", () => {
    const priors: PriorVisit[] = [
      { date: newer, findings: [finding({ species: "House mouse", zone: null })], recommendations: [] },
    ];
    const m = computeInspectionMemory(priors, { coverage: coverage(), findings: [] });
    // The species still appears in the SHOW list...
    expect(m.pestActivity).toHaveLength(1);
    // ...but produces NO highlight because the zone can't be proven un-inspected.
    expect(m.highlights).toEqual([]);
  });

  it("emits only the strongest highlight per zone (rodent beats bait beats activity)", () => {
    const priors: PriorVisit[] = [
      {
        date: newer,
        findings: [
          finding({ id: 1, species: "Norway rat", description: "Bait station chewed", zone: "waste_dumpster" }),
        ],
        recommendations: [],
      },
    ];
    const m = computeInspectionMemory(priors, {
      coverage: coverage({ requiredZones: [zone("waste_dumpster", "Waste")], uncoveredRequired: [zone("waste_dumpster", "Waste")] }),
      findings: [],
    });
    expect(m.highlights).toHaveLength(1);
    expect(m.highlights[0].type).toBe("rodent_area_not_photographed");
  });
});
