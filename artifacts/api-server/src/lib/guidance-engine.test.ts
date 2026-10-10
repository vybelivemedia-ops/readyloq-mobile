import { describe, expect, it } from "vitest";
import type { CoverageSnapshot, CoverageZone, Finding, MemoryHighlight } from "@workspace/db";
import { computeGuidance } from "./guidance-engine";

function highlight(overrides: Partial<MemoryHighlight> = {}): MemoryHighlight {
  return {
    id: "area_not_inspected:kitchen_sanitation",
    type: "area_not_inspected",
    zone: "kitchen_sanitation",
    label: "Kitchen",
    message: "Kitchen had activity previously.",
    lastSeen: null,
    ...overrides,
  };
}

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

describe("computeGuidance", () => {
  it("returns empty guidance when there is no coverage snapshot", () => {
    for (const input of [null, undefined]) {
      const g = computeGuidance(input, [], []);
      expect(g).toEqual({ next: null, queue: [], remaining: 0 });
    }
  });

  it("maps uncovered required zones to specialized categories and orders by fixed priority", () => {
    const g = computeGuidance(
      coverage({
        requiredZones: [zone("kitchen_sanitation"), zone("moisture_sources"), zone("exterior_perimeter")],
        uncoveredRequired: [
          zone("kitchen_sanitation", "Kitchen"),
          zone("moisture_sources", "Moisture"),
          zone("exterior_perimeter", "Exterior"),
        ],
      }),
      [],
      ["a", "b", "c"],
    );

    // Exterior (p10) beats moisture (p20) beats kitchen (p40).
    expect(g.queue.map((r) => r.category)).toEqual([
      "missing_exclusion",
      "missing_moisture",
      "missing_room",
    ]);
    expect(g.next).toBe(g.queue[0]);
    expect(g.next?.category).toBe("missing_exclusion");
    expect(g.next?.zone).toBe("exterior_perimeter");
    expect(g.remaining).toBe(2);
    // Stable, deterministic ids for React keys.
    expect(g.next?.id).toBe("missing_exclusion:exterior_perimeter");
  });

  it("falls back to a generic 'Capture {label}' task for an unknown required zone", () => {
    const g = computeGuidance(
      coverage({
        requiredZones: [zone("mystery_zone")],
        uncoveredRequired: [zone("mystery_zone", "Mystery Zone")],
      }),
      [],
      ["a"],
    );
    expect(g.next?.category).toBe("missing_room");
    expect(g.next?.title).toBe("Capture Mystery Zone");
    expect(g.next?.id).toBe("missing_room:mystery_zone");
  });

  it("adds a rodent bait-station task from real rodent species (case-insensitive keywords)", () => {
    for (const species of ["Norway rat", "House Mouse", "RODENT droppings", "field mice"]) {
      const g = computeGuidance(
        coverage({ requiredZones: [zone("interior_areas")], coveredRequired: [zone("interior_areas")] }),
        [finding({ species })],
        ["a"],
      );
      const bait = g.queue.find((r) => r.category === "bait_stations");
      expect(bait, species).toBeTruthy();
      expect(bait?.id).toBe("bait_stations:rodent");
    }
  });

  it("does NOT add a bait-station task for a non-rodent species", () => {
    const g = computeGuidance(
      coverage({ requiredZones: [zone("interior_areas")], coveredRequired: [zone("interior_areas")] }),
      [finding({ species: "German cockroach" })],
      ["a"],
    );
    expect(g.queue.some((r) => r.category === "bait_stations")).toBe(false);
  });

  it("emits at most one bait-station task even with multiple rodent findings", () => {
    const g = computeGuidance(
      coverage({ requiredZones: [zone("interior_areas")], coveredRequired: [zone("interior_areas")] }),
      [finding({ id: 1, species: "Norway rat" }), finding({ id: 2, species: "House mouse" })],
      ["a"],
    );
    expect(g.queue.filter((r) => r.category === "bait_stations")).toHaveLength(1);
  });

  it("prompts for thin documentation only when analyzed photos < required zones (not by finding count)", () => {
    const covered = {
      requiredZones: [zone("a"), zone("b"), zone("c")],
      coveredRequired: [zone("a"), zone("b"), zone("c")],
      uncoveredRequired: [] as CoverageZone[],
    };

    // Fully covered but only 1 analyzed photo for 3 required zones -> prompt.
    const thin = computeGuidance(coverage(covered), [], ["only-one"]);
    expect(thin.queue.some((r) => r.category === "missing_evidence")).toBe(true);

    // Enough photos (>= required zones) -> no prompt, guidance goes quiet.
    const enough = computeGuidance(coverage(covered), [], ["p1", "p2", "p3"]);
    expect(enough).toEqual({ next: null, queue: [], remaining: 0 });
  });

  it("keeps suggested zones as a low-priority tail below every required task", () => {
    const g = computeGuidance(
      coverage({
        requiredZones: [zone("moisture_sources")],
        uncoveredRequired: [zone("moisture_sources", "Moisture")],
        suggested: [zone("attic_roofline", "Attic")],
      }),
      [],
      ["a"],
    );
    expect(g.next?.category).toBe("missing_moisture");
    const last = g.queue[g.queue.length - 1];
    expect(last.category).toBe("suggested_room");
    expect(last.title).toBe("Consider capturing Attic");
    expect(g.next!.priority).toBeLessThan(last.priority);
  });

  it("surfaces a suggested task when all required zones are covered and documented", () => {
    const g = computeGuidance(
      coverage({
        requiredZones: [zone("a")],
        coveredRequired: [zone("a")],
        suggested: [zone("loading_dock", "Loading dock")],
      }),
      [],
      ["p1", "p2"], // enough photos -> no thin-documentation prompt
    );
    expect(g.queue).toHaveLength(1);
    expect(g.next?.category).toBe("suggested_room");
    expect(g.remaining).toBe(0);
  });

  it("is byte-identical whether memory is omitted, null, or empty (backward compatible)", () => {
    const cov = coverage({
      requiredZones: [zone("exterior_perimeter")],
      uncoveredRequired: [zone("exterior_perimeter", "Exterior")],
    });
    const base = computeGuidance(cov, [], ["a"]);
    expect(computeGuidance(cov, [], ["a"], null)).toEqual(base);
    expect(computeGuidance(cov, [], ["a"], [])).toEqual(base);
  });

  it("promotes a memory highlight above every generic capture task as the next task", () => {
    const g = computeGuidance(
      coverage({
        requiredZones: [zone("exterior_perimeter")],
        uncoveredRequired: [zone("exterior_perimeter", "Exterior")], // p10
      }),
      [],
      ["a"],
      [highlight({ type: "rodent_area_not_photographed", zone: "attic_roofline", label: "Attic" })],
    );
    expect(g.next?.category).toBe("memory_rodent");
    expect(g.next?.priority).toBe(4);
    expect(g.next?.id).toBe("memory_rodent:attic_roofline");
    expect(g.next?.zone).toBe("attic_roofline");
    // The grounded highlight message flows through verbatim as the reason.
    expect(g.next?.reason).toBe("Kitchen had activity previously.");
    // Generic exterior task is still queued, just below the memory task.
    expect(g.queue.some((r) => r.category === "missing_exclusion")).toBe(true);
  });

  it("orders memory tasks rodent(4) < bait(6) < activity(8)", () => {
    const g = computeGuidance(
      coverage({ requiredZones: [zone("a")], coveredRequired: [zone("a")] }),
      [],
      ["p1", "p2"],
      [
        highlight({ type: "area_not_inspected", zone: "z_activity", label: "Area" }),
        highlight({ type: "bait_station_missing", zone: "z_bait", label: "Bait" }),
        highlight({ type: "rodent_area_not_photographed", zone: "z_rodent", label: "Rodent" }),
      ],
    );
    expect(g.queue.map((r) => r.category)).toEqual([
      "memory_rodent",
      "memory_bait",
      "memory_activity",
    ]);
  });
});
