import { describe, expect, it } from "vitest";
import type { CompanyPlaybook } from "@workspace/db";
import type { Finding } from "@workspace/db";
import { evaluatePlaybookCompliance } from "./playbook-compliance";

// ── Helpers ──────────────────────────────────────────────────────────────────

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 1,
    category: "rodent",
    description: "Droppings observed",
    confidence: 0.9,
    severity: "high",
    location: null,
    imageUrl: null,
    treatment: null,
    exclusionOpportunity: null,
    ...overrides,
  };
}

function playbook(overrides: Partial<CompanyPlaybook> = {}): CompanyPlaybook {
  return {
    id: 1,
    companyId: 42,
    title: "Rodent Protocol",
    targetPests: ["rodent"],
    requiredSteps: [],
    chemicalRestrictions: [],
    notes: null,
    isActive: true,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("evaluatePlaybookCompliance", () => {
  it("returns compliant when there are no playbooks", () => {
    const result = evaluatePlaybookCompliance(
      [finding()],
      [],
      [],
    );
    expect(result.compliant).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("returns compliant when no findings match any playbook's target pests", () => {
    const result = evaluatePlaybookCompliance(
      [finding({ category: "cockroach", species: null })],
      [],
      [playbook({ targetPests: ["rodent"] })],
    );
    expect(result.compliant).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("matches target pests by finding category (case-insensitive)", () => {
    const result = evaluatePlaybookCompliance(
      [finding({ category: "RODENT", species: null })],
      [],
      [playbook({
        targetPests: ["rodent"],
        requiredSteps: [{ id: "bait", label: "Apply bait stations" }],
      })],
    );
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].type).toBe("missing_step");
  });

  it("matches target pests by finding species (case-insensitive)", () => {
    const result = evaluatePlaybookCompliance(
      [finding({ category: "pest", species: "Norway Rat" })],
      [],
      [playbook({
        targetPests: ["norway rat"],
        requiredSteps: [{ id: "bait", label: "Apply bait stations" }],
      })],
    );
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].missingStep).toBe("Apply bait stations");
  });

  it("uses substring matching for target pest names", () => {
    // "rodent" matches a finding with category "rodent droppings"
    const result = evaluatePlaybookCompliance(
      [finding({ category: "rodent droppings", species: null })],
      [],
      [playbook({
        targetPests: ["rodent"],
        requiredSteps: [{ id: "exclusion", label: "Seal entry points" }],
      })],
    );
    expect(result.violations).toHaveLength(1);
  });

  it("does not flag required steps when the playbook is out of scope", () => {
    const result = evaluatePlaybookCompliance(
      [finding({ category: "cockroach", species: null })],
      [],
      [playbook({
        targetPests: ["rodent"],
        requiredSteps: [{ id: "bait", label: "Apply bait stations" }],
      })],
    );
    expect(result.compliant).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("flags a missing required step with severity WARNING", () => {
    const result = evaluatePlaybookCompliance(
      [finding({ category: "rodent", treatment: null })],
      [],
      [playbook({
        targetPests: ["rodent"],
        requiredSteps: [{ id: "bait", label: "Apply bait stations" }],
      })],
    );

    expect(result.compliant).toBe(false);
    expect(result.violations).toHaveLength(1);
    const v = result.violations[0];
    expect(v.type).toBe("missing_step");
    expect(v.severity).toBe("WARNING");
    expect(v.missingStep).toBe("Apply bait stations");
    expect(v.playbookTitle).toBe("Rodent Protocol");
    expect(v.message).toContain("Apply bait stations");
    expect(v.message).toContain("Rodent Protocol");
  });

  it("does not flag a required step that appears in a finding's treatment text", () => {
    const result = evaluatePlaybookCompliance(
      [finding({ category: "rodent", treatment: "Apply bait stations in crawl space" })],
      [],
      [playbook({
        targetPests: ["rodent"],
        requiredSteps: [{ id: "bait", label: "Apply bait stations" }],
      })],
    );
    expect(result.compliant).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("matches required step label against treatment text case-insensitively", () => {
    const result = evaluatePlaybookCompliance(
      [finding({ category: "rodent", treatment: "APPLY BAIT STATIONS near exterior" })],
      [],
      [playbook({
        targetPests: ["rodent"],
        requiredSteps: [{ id: "bait", label: "apply bait stations" }],
      })],
    );
    expect(result.compliant).toBe(true);
  });

  it("flags only the missing steps, not those already evidenced", () => {
    const result = evaluatePlaybookCompliance(
      [finding({ category: "rodent", treatment: "Apply bait stations in kitchen" })],
      [],
      [playbook({
        targetPests: ["rodent"],
        requiredSteps: [
          { id: "bait", label: "Apply bait stations" },   // evidenced
          { id: "seal", label: "Seal entry points" },     // missing
        ],
      })],
    );
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].missingStep).toBe("Seal entry points");
  });

  it("flags a restricted chemical with severity ERROR", () => {
    const result = evaluatePlaybookCompliance(
      [finding({ category: "rodent" })],
      ["Fipronil SC 9.1%"],
      [playbook({
        targetPests: ["rodent"],
        chemicalRestrictions: [{ name: "Fipronil", reason: "Not approved for food-handling areas" }],
      })],
    );

    expect(result.compliant).toBe(false);
    expect(result.violations).toHaveLength(1);
    const v = result.violations[0];
    expect(v.type).toBe("restricted_chemical");
    expect(v.severity).toBe("ERROR");
    expect(v.restrictedChemical).toBe("Fipronil");
    expect(v.message).toContain("Fipronil");
    expect(v.message).toContain("Not approved for food-handling areas");
  });

  it("includes the restriction reason in the violation message when present", () => {
    const result = evaluatePlaybookCompliance(
      [finding({ category: "rodent" })],
      ["Chlorpyrifos EC"],
      [playbook({
        targetPests: ["rodent"],
        chemicalRestrictions: [{ name: "Chlorpyrifos", reason: "Banned under state law" }],
      })],
    );
    expect(result.violations[0].message).toContain("Banned under state law");
  });

  it("omits reason from the message when not provided", () => {
    const result = evaluatePlaybookCompliance(
      [finding({ category: "rodent" })],
      ["Fipronil SC"],
      [playbook({
        targetPests: ["rodent"],
        chemicalRestrictions: [{ name: "Fipronil" }],
      })],
    );
    const msg = result.violations[0].message;
    expect(msg).not.toContain("Reason:");
  });

  it("does not flag a restricted chemical when the playbook is out of scope", () => {
    const result = evaluatePlaybookCompliance(
      [finding({ category: "cockroach", species: null })],
      ["Fipronil SC"],
      [playbook({
        targetPests: ["rodent"],
        chemicalRestrictions: [{ name: "Fipronil" }],
      })],
    );
    expect(result.compliant).toBe(true);
  });

  it("uses substring matching for chemical restriction names (case-insensitive)", () => {
    const result = evaluatePlaybookCompliance(
      [finding({ category: "rodent" })],
      ["Termidor SC (Fipronil 9.1%)"],
      [playbook({
        targetPests: ["rodent"],
        chemicalRestrictions: [{ name: "FIPRONIL" }],
      })],
    );
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].type).toBe("restricted_chemical");
  });

  it("accumulates violations from multiple in-scope playbooks", () => {
    const rodentPlaybook = playbook({
      id: 1,
      title: "Rodent Protocol",
      targetPests: ["rodent"],
      requiredSteps: [{ id: "bait", label: "Apply bait stations" }],
    });
    const chemicalPlaybook = playbook({
      id: 2,
      title: "Chemical SOP",
      targetPests: ["rodent"],
      chemicalRestrictions: [{ name: "Fipronil" }],
    });

    const result = evaluatePlaybookCompliance(
      [finding({ category: "rodent", treatment: null })],
      ["Fipronil SC"],
      [rodentPlaybook, chemicalPlaybook],
    );

    expect(result.compliant).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations.some((v) => v.type === "missing_step")).toBe(true);
    expect(result.violations.some((v) => v.type === "restricted_chemical")).toBe(true);
  });

  it("only evaluates in-scope playbooks, skipping those whose pests don't match", () => {
    const rodentPlaybook = playbook({
      id: 1,
      title: "Rodent Protocol",
      targetPests: ["rodent"],
      requiredSteps: [{ id: "bait", label: "Apply bait stations" }],
    });
    const cockroachPlaybook = playbook({
      id: 2,
      title: "Cockroach Protocol",
      targetPests: ["cockroach"],
      requiredSteps: [{ id: "gel", label: "Apply gel bait" }],
    });

    // Only rodent findings — cockroach playbook should be skipped.
    const result = evaluatePlaybookCompliance(
      [finding({ category: "rodent", treatment: null, species: null })],
      [],
      [rodentPlaybook, cockroachPlaybook],
    );

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].playbookTitle).toBe("Rodent Protocol");
  });

  it("sets the playbookId correctly on each violation", () => {
    const result = evaluatePlaybookCompliance(
      [finding({ category: "rodent" })],
      [],
      [playbook({
        id: 99,
        targetPests: ["rodent"],
        requiredSteps: [{ id: "bait", label: "Apply bait stations" }],
      })],
    );
    expect(result.violations[0].playbookId).toBe(99);
  });

  it("handles an empty findings array — no violations for any playbook", () => {
    const result = evaluatePlaybookCompliance(
      [],
      ["Fipronil SC"],
      [playbook({
        targetPests: ["rodent"],
        requiredSteps: [{ id: "bait", label: "Apply bait stations" }],
        chemicalRestrictions: [{ name: "Fipronil" }],
      })],
    );
    // No findings → no playbook is in scope → no violations.
    expect(result.compliant).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("handles a playbook with no required steps and no restrictions — always compliant when in scope", () => {
    const result = evaluatePlaybookCompliance(
      [finding({ category: "rodent" })],
      [],
      [playbook({ targetPests: ["rodent"], requiredSteps: [], chemicalRestrictions: [] })],
    );
    expect(result.compliant).toBe(true);
  });
});
