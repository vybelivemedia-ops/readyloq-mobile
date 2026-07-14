import { describe, expect, it } from "vitest";
import type { Finding } from "@workspace/db";
import {
  ZONE_SLUGS,
  computeCoverage,
  normalizePropertyType,
  normalizeZone,
  zonesFromFinding,
} from "./zone-coverage";

const slugs = (zones: { slug: string }[]) => zones.map((z) => z.slug).sort();

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

describe("normalizePropertyType", () => {
  it("maps mobile's 8-value picker onto the 5 matrix columns", () => {
    expect(normalizePropertyType("Residential")).toBe("Single Family");
    expect(normalizePropertyType("Multi-Family")).toBe("Multifamily");
    expect(normalizePropertyType("Commercial")).toBe("Commercial");
    expect(normalizePropertyType("Restaurant")).toBe("Restaurant");
    expect(normalizePropertyType("Warehouse")).toBe("Warehouse");
    expect(normalizePropertyType("School")).toBe("Commercial");
    expect(normalizePropertyType("Healthcare")).toBe("Commercial");
    expect(normalizePropertyType("Hospitality")).toBe("Commercial");
  });

  it("maps derivePropertyType's looser fallback strings", () => {
    expect(normalizePropertyType("Restaurant / Food Service")).toBe("Restaurant");
    expect(normalizePropertyType("Multi-Family")).toBe("Multifamily");
    // The generic unknown fallback leads with 'Commercial'.
    expect(normalizePropertyType("Commercial / Residential")).toBe("Commercial");
    expect(normalizePropertyType(null)).toBe("Commercial");
    expect(normalizePropertyType("")).toBe("Commercial");
    expect(normalizePropertyType("something unknown")).toBe("Commercial");
  });
});

describe("normalizeZone", () => {
  it("accepts taxonomy slugs and rejects anything else", () => {
    expect(normalizeZone("kitchen_sanitation")).toBe("kitchen_sanitation");
    expect(normalizeZone("KITCHEN_SANITATION")).toBe("kitchen_sanitation");
    expect(normalizeZone("not_a_zone")).toBeNull();
    expect(normalizeZone(null)).toBeNull();
    expect(normalizeZone(42)).toBeNull();
  });
});

describe("computeCoverage — requirement matrix", () => {
  it("selects the property-type column and only counts Required zones", () => {
    const cov = computeCoverage({
      propertyType: "Single Family",
      pestTypes: [],
      coveredZoneSlugs: [],
    });
    // SF: waste_dumpster + loading_dock are n/a; attic_roofline is recommended.
    expect(slugs(cov.requiredZones)).toEqual(
      [
        "exterior_perimeter",
        "interior_areas",
        "kitchen_sanitation",
        "moisture_sources",
        "harborage_storage",
        "structural_conducive",
        "crawlspace_subfloor",
      ].sort(),
    );
    expect(slugs(cov.requiredZones)).not.toContain("waste_dumpster");
    expect(cov.suggested.map((z) => z.slug)).toContain("attic_roofline");
    expect(cov.completenessPct).toBe(0);
  });
});

describe("computeCoverage — pest overlays", () => {
  it("promotes attic + crawlspace to Required for a rodent job even on a Restaurant", () => {
    const base = computeCoverage({
      propertyType: "Restaurant",
      pestTypes: [],
      coveredZoneSlugs: [],
    });
    // Restaurant attic is normally n/a.
    expect(slugs(base.requiredZones)).not.toContain("attic_roofline");

    const withRodents = computeCoverage({
      propertyType: "Restaurant",
      pestTypes: ["Rodents"],
      coveredZoneSlugs: [],
    });
    expect(slugs(withRodents.requiredZones)).toContain("attic_roofline");
    expect(slugs(withRodents.requiredZones)).toContain("crawlspace_subfloor");
  });

  it("matches pest keywords case-insensitively as substrings", () => {
    const cov = computeCoverage({
      propertyType: "Commercial",
      pestTypes: ["German cockroach infestation"],
      coveredZoneSlugs: [],
    });
    expect(slugs(cov.requiredZones)).toContain("kitchen_sanitation");
  });
});

describe("computeCoverage — completeness math & clean photos", () => {
  it("clean photos (zones with no finding) still count toward coverage", () => {
    const required = new Set(
      computeCoverage({ propertyType: "Single Family", pestTypes: [], coveredZoneSlugs: [] }).requiredZones.map(
        (z) => z.slug,
      ),
    );
    const cov = computeCoverage({
      propertyType: "Single Family",
      pestTypes: [],
      // Pretend two clean photos mapped to these zones — no findings at all.
      coveredZoneSlugs: ["exterior_perimeter", "moisture_sources"],
    });
    expect(cov.coveredRequired.map((z) => z.slug).sort()).toEqual(
      ["exterior_perimeter", "moisture_sources"].sort(),
    );
    expect(cov.uncoveredRequired.length).toBe(required.size - 2);
    expect(cov.completenessPct).toBe(Math.round((2 / required.size) * 100));
  });

  it("reports 100% when every required zone is covered", () => {
    const required = computeCoverage({
      propertyType: "Warehouse",
      pestTypes: [],
      coveredZoneSlugs: [],
    }).requiredZones.map((z) => z.slug);
    const cov = computeCoverage({
      propertyType: "Warehouse",
      pestTypes: [],
      coveredZoneSlugs: required,
    });
    expect(cov.completenessPct).toBe(100);
    expect(cov.uncoveredRequired).toHaveLength(0);
  });

  it("ignores unknown / duplicate covered slugs", () => {
    const cov = computeCoverage({
      propertyType: "Single Family",
      pestTypes: [],
      coveredZoneSlugs: ["exterior_perimeter", "exterior_perimeter", "not_a_zone", ""],
    });
    expect(cov.coveredRequired.map((z) => z.slug)).toEqual(["exterior_perimeter"]);
  });
});

describe("zonesFromFinding", () => {
  it("derives zones from finding attributes and its own zone", () => {
    expect(zonesFromFinding(finding({ moisture: "leak under sink" }))).toContain("moisture_sources");
    expect(zonesFromFinding(finding({ harborage: "cluttered storage" }))).toContain("harborage_storage");
    expect(zonesFromFinding(finding({ structuralIssue: "foundation crack" }))).toContain("structural_conducive");
    expect(zonesFromFinding(finding({ exclusionOpportunity: true }))).toContain("exterior_perimeter");
    expect(zonesFromFinding(finding({ species: "house mouse" }))).toContain("interior_areas");
    expect(zonesFromFinding(finding({ zone: "attic_roofline" }))).toContain("attic_roofline");
    expect(zonesFromFinding(finding({ zone: "bogus" }))).not.toContain("bogus");
  });
});

describe("taxonomy", () => {
  it("exposes exactly 10 zone slugs", () => {
    expect(ZONE_SLUGS).toHaveLength(10);
    expect(new Set(ZONE_SLUGS).size).toBe(10);
  });
});
