import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration tests for property-memory-writer.ts
 *
 * Covers:
 * - First write creates a memory row (correct pests, findings, lastVisitedAt)
 * - Rerunning the same inspection produces the same row (idempotent)
 * - Second completed inspection at same address: frequencies increment, new pests merged
 * - All-clear inspection (no findings): row created with empty pests/findings but valid date
 * - Different company at same address: independent memory rows (tenant isolation)
 * - Address-less inspection: skipped without error
 * - Technician-corrected species is preferred over AI display label
 */

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    getAuth: () => ({ userId: null }),
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

import {
  db,
  companiesTable,
  usersTable,
  inspectionsTable,
  analysisResultsTable,
  propertyMemoryTable,
  type Finding,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { writePropertyMemory } from "./property-memory-writer";
import { normalizeAddressKey } from "./property-intelligence";

// ── Shared test fixtures ──────────────────────────────────────────────────────

const ADDR = "123 Main Street, Springfield, IL 62701";
const ADDR_KEY = normalizeAddressKey(ADDR);

const SLUG_A = "pmw-company-a";
const SLUG_B = "pmw-company-b";

let companyAId: number;
let companyBId: number;

async function findOrCreateCompany(name: string, slug: string): Promise<number> {
  const [ex] = await db.select().from(companiesTable).where(eq(companiesTable.slug, slug));
  if (ex) return ex.id;
  const [row] = await db.insert(companiesTable).values({ name, slug }).returning();
  return row.id;
}

async function createCompletedInspection(
  companyId: number,
  siteAddress: string,
  completedAt?: Date,
): Promise<number> {
  const [row] = await db
    .insert(inspectionsTable)
    .values({
      companyId,
      siteAddress,
      status: "completed",
      technicianName: "Tech A",
      clientName: "Client",
      pestTypes: ["ants"],
      completedAt: completedAt ?? new Date(),
    })
    .returning();
  return row.id;
}

async function seedAnalysis(
  companyId: number,
  inspectionId: number,
  findings: Finding[],
): Promise<void> {
  await db.insert(analysisResultsTable).values({
    companyId,
    inspectionId,
    status: "complete",
    findings,
    recommendations: [],
    overallConfidence: 0.8,
  });
}

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 1,
    category: "Rodent Activity",
    description: "Mouse droppings observed",
    confidence: 0.85,
    severity: "high",
    location: "Kitchen",
    imageUrl: null,
    treatment: "Set snap traps",
    exclusionOpportunity: false,
    species: "House Mouse",
    ...overrides,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  companyAId = await findOrCreateCompany("PMW Test Co A", SLUG_A);
  companyBId = await findOrCreateCompany("PMW Test Co B", SLUG_B);
});

beforeEach(async () => {
  // Clean up memory rows and analysis data between tests.
  await db.delete(propertyMemoryTable);
  await db.delete(analysisResultsTable);
  await db.delete(inspectionsTable);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("writePropertyMemory", () => {
  it("creates a memory row on the first write with correct pests and findings", async () => {
    const inspId = await createCompletedInspection(companyAId, ADDR);
    await seedAnalysis(companyAId, inspId, [
      makeFinding({ id: 1, species: "House Mouse", category: "Rodent Activity", description: "Mouse droppings" }),
      makeFinding({ id: 2, species: "German Cockroach", category: "Pest Activity", description: "Cockroach egg cases" }),
    ]);

    await writePropertyMemory({ companyId: companyAId, inspectionId: inspId, siteAddress: ADDR });

    const [row] = await db
      .select()
      .from(propertyMemoryTable)
      .where(and(eq(propertyMemoryTable.companyId, companyAId), eq(propertyMemoryTable.addressKey, ADDR_KEY as string)));

    expect(row).toBeDefined();
    expect(row.lastInspectionId).toBe(inspId);
    expect(row.historicalPests).toContain("House Mouse");
    expect(row.historicalPests).toContain("German Cockroach");
    expect(row.historicalPests).toHaveLength(2);
    expect(row.historicalFindings).toHaveLength(2);
    const rdFinding = (row.historicalFindings as any[]).find((f: any) => f.category === "Rodent Activity");
    expect(rdFinding?.frequency).toBe(1);
  });

  it("is idempotent — rerunning for the same inspection does not change the row", async () => {
    const inspId = await createCompletedInspection(companyAId, ADDR);
    await seedAnalysis(companyAId, inspId, [
      makeFinding({ id: 1, species: "Norway Rat", category: "Rodent Activity", description: "Gnaw marks" }),
    ]);

    await writePropertyMemory({ companyId: companyAId, inspectionId: inspId, siteAddress: ADDR });
    await writePropertyMemory({ companyId: companyAId, inspectionId: inspId, siteAddress: ADDR });

    const rows = await db
      .select()
      .from(propertyMemoryTable)
      .where(eq(propertyMemoryTable.companyId, companyAId));

    expect(rows).toHaveLength(1);
    // Frequency must be 1, not 2, for one inspection.
    const findings = rows[0].historicalFindings as any[];
    expect(findings[0].frequency).toBe(1);
    expect(rows[0].historicalPests).toHaveLength(1);
  });

  it("increments frequency and merges pests when a second inspection is added at the same address", async () => {
    const visited1 = new Date("2026-01-10T10:00:00Z");
    const visited2 = new Date("2026-03-15T10:00:00Z");

    const insp1 = await createCompletedInspection(companyAId, ADDR, visited1);
    await seedAnalysis(companyAId, insp1, [
      makeFinding({ id: 1, species: "House Mouse", category: "Rodent Activity", description: "Mouse droppings" }),
    ]);

    const insp2 = await createCompletedInspection(companyAId, ADDR, visited2);
    await seedAnalysis(companyAId, insp2, [
      makeFinding({ id: 1, species: "Norway Rat", category: "Rodent Activity", description: "Mouse droppings" }),
      makeFinding({ id: 2, species: "German Cockroach", category: "Pest Activity", description: "Cockroach egg cases", severity: "medium" }),
    ]);

    // Write after first inspection.
    await writePropertyMemory({ companyId: companyAId, inspectionId: insp1, siteAddress: ADDR });
    // Write after second inspection (recomputes from both).
    await writePropertyMemory({ companyId: companyAId, inspectionId: insp2, siteAddress: ADDR });

    const [row] = await db
      .select()
      .from(propertyMemoryTable)
      .where(and(eq(propertyMemoryTable.companyId, companyAId), eq(propertyMemoryTable.addressKey, ADDR_KEY as string)));

    // "Mouse droppings" appeared in both inspections → frequency 2.
    const rdFinding = (row.historicalFindings as any[]).find((f: any) => f.description === "Mouse droppings");
    expect(rdFinding?.frequency).toBe(2);

    // New pest from second visit merged in.
    expect(row.historicalPests).toContain("German Cockroach");
    // Both visits' pests present.
    expect(row.historicalPests).toContain("House Mouse");
    expect(row.historicalPests).toContain("Norway Rat");

    // lastVisitedAt = most recent inspection.
    expect(new Date(row.lastVisitedAt!).toISOString()).toBe(visited2.toISOString());
    expect(row.lastInspectionId).toBe(insp2);
  });

  it("creates an empty-findings row for an all-clear inspection (no analysis)", async () => {
    const visited = new Date("2026-02-01T09:00:00Z");
    const inspId = await createCompletedInspection(companyAId, ADDR, visited);
    // No analysis row seeded.

    await writePropertyMemory({ companyId: companyAId, inspectionId: inspId, siteAddress: ADDR });

    const [row] = await db
      .select()
      .from(propertyMemoryTable)
      .where(and(eq(propertyMemoryTable.companyId, companyAId), eq(propertyMemoryTable.addressKey, ADDR_KEY as string)));

    expect(row).toBeDefined();
    expect(row.historicalPests).toEqual([]);
    expect(row.historicalFindings).toEqual([]);
    expect(row.lastVisitedAt?.toISOString()).toBe(visited.toISOString());
  });

  it("maintains separate memory rows for two companies at the same address (tenant isolation)", async () => {
    const inspA = await createCompletedInspection(companyAId, ADDR);
    await seedAnalysis(companyAId, inspA, [
      makeFinding({ id: 1, species: "Bed Bug", category: "Pest Activity", description: "Live bed bugs" }),
    ]);

    const inspB = await createCompletedInspection(companyBId, ADDR);
    await seedAnalysis(companyBId, inspB, [
      makeFinding({ id: 1, species: "Termite", category: "Pest Activity", description: "Termite damage" }),
    ]);

    await writePropertyMemory({ companyId: companyAId, inspectionId: inspA, siteAddress: ADDR });
    await writePropertyMemory({ companyId: companyBId, inspectionId: inspB, siteAddress: ADDR });

    const rowA = await db
      .select()
      .from(propertyMemoryTable)
      .where(and(eq(propertyMemoryTable.companyId, companyAId), eq(propertyMemoryTable.addressKey, ADDR_KEY as string)));
    const rowB = await db
      .select()
      .from(propertyMemoryTable)
      .where(and(eq(propertyMemoryTable.companyId, companyBId), eq(propertyMemoryTable.addressKey, ADDR_KEY as string)));

    expect(rowA).toHaveLength(1);
    expect(rowB).toHaveLength(1);
    expect(rowA[0].historicalPests).toContain("Bed Bug");
    expect(rowA[0].historicalPests).not.toContain("Termite");
    expect(rowB[0].historicalPests).toContain("Termite");
    expect(rowB[0].historicalPests).not.toContain("Bed Bug");
  });

  it("skips without error when siteAddress is empty", async () => {
    const inspId = await createCompletedInspection(companyAId, ADDR); // won't be queried
    await expect(
      writePropertyMemory({ companyId: companyAId, inspectionId: inspId, siteAddress: "" }),
    ).resolves.toBeUndefined();

    const rows = await db
      .select()
      .from(propertyMemoryTable)
      .where(eq(propertyMemoryTable.companyId, companyAId));
    expect(rows).toHaveLength(0);
  });

  it("prefers the technician-corrected species over the AI label when deduplicating pests", async () => {
    const inspId = await createCompletedInspection(companyAId, ADDR);
    await seedAnalysis(companyAId, inspId, [
      makeFinding({
        id: 1,
        species: "Possible: Norway Rat",
        reviewStatus: "corrected",
        technicianSpecies: "Roof Rat",
        category: "Rodent Activity",
        description: "Rat droppings",
      }),
    ]);

    await writePropertyMemory({ companyId: companyAId, inspectionId: inspId, siteAddress: ADDR });

    const [row] = await db
      .select()
      .from(propertyMemoryTable)
      .where(eq(propertyMemoryTable.companyId, companyAId));

    // Should store the corrected species, not the AI label.
    expect(row.historicalPests).toContain("Roof Rat");
    expect(row.historicalPests).not.toContain("Norway Rat");
    expect(row.historicalPests).not.toContain("Possible: Norway Rat");
  });

  it("deduplicates 'Possible: X' and 'X' labels for the same pest", async () => {
    const insp1 = await createCompletedInspection(companyAId, ADDR, new Date("2026-01-01"));
    await seedAnalysis(companyAId, insp1, [
      makeFinding({ id: 1, species: "Possible: Norway Rat", category: "Rodent Activity", description: "Gnaw marks" }),
    ]);

    const insp2 = await createCompletedInspection(companyAId, ADDR, new Date("2026-02-01"));
    await seedAnalysis(companyAId, insp2, [
      makeFinding({ id: 1, species: "Norway Rat", category: "Rodent Activity", description: "Gnaw marks" }),
    ]);

    await writePropertyMemory({ companyId: companyAId, inspectionId: insp2, siteAddress: ADDR });

    const [row] = await db
      .select()
      .from(propertyMemoryTable)
      .where(eq(propertyMemoryTable.companyId, companyAId));

    // Only one entry for Norway Rat despite two label variants.
    const ratEntries = (row.historicalPests as string[]).filter(
      (p) => p.toLowerCase().includes("norway rat"),
    );
    expect(ratEntries).toHaveLength(1);
  });
});
