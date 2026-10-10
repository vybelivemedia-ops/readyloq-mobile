/**
 * Client portal — inspection signature-state assertions (task #628).
 *
 * Verifies that GET /api/client/buildings/:address/inspections surfaces
 * truthful technicianSigned / ownerSigned booleans for each signature state:
 *
 *   1. Both parties signed              → technicianSigned:true,  ownerSigned:true
 *   2. Technician only (awaiting owner) → technicianSigned:true,  ownerSigned:false
 *   3. Tech + owner N/A                 → technicianSigned:true,  ownerSigned:false, ownerNotAvailable:true
 *   4. Owner only (edge case)           → technicianSigned:false, ownerSigned:true
 *   5. Unsigned inspection              → technicianSigned:false, ownerSigned:false, signedAt:null
 *
 * Raw SVG signature strings are NEVER returned — only boolean presence flags.
 *
 * Cross-company isolation: a second company's inspections at the same address
 * must not appear in the response.
 *
 * Each run generates unique identifiers so reruns against a shared test DB
 * do not bind to stale rows from a previous run.
 */

import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// ── Clerk mock ────────────────────────────────────────────────────────────────
// vi.hoisted() ensures the mock is registered before any module that imports
// @clerk/express (including app.ts via its middleware chain).

const { authState } = vi.hoisted(() => ({
  authState: { userId: null as string | null },
}));

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    getAuth: () => authState,
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

// ── Imports (after mock registration) ────────────────────────────────────────

import app from "../../app";
import {
  db,
  companiesTable,
  inspectionsTable,
  clientPortalAccessTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

// ── Per-run unique identifiers ────────────────────────────────────────────────
// Using a timestamp suffix prevents cross-run fixture collisions in the shared
// test DB when tests are re-run without a DB wipe between runs.

const RUN_ID = Date.now();
const CLIENT_CLERK_ID = `test_sig_pm_${RUN_ID}`;
const ADDRESS = `123 Signature Test Ave ${RUN_ID}, Springfield, IL`;
const SVG_TECH = "<svg>tech-sig</svg>";
const SVG_OWNER = "<svg>owner-sig</svg>";
const SIGNED_AT = new Date("2026-08-05T10:00:00Z");

let companyId: number;
let otherCompanyId: number;
let accessId: number;

// ── Test DB setup / teardown ──────────────────────────────────────────────────

beforeAll(async () => {
  // Two companies: A owns the access record, B is the cross-company adversary.
  const [companyA] = await db
    .insert(companiesTable)
    .values({ name: `Sig Test Co A ${RUN_ID}`, slug: `sig-test-a-${RUN_ID}` })
    .returning();
  companyId = companyA.id;

  const [companyB] = await db
    .insert(companiesTable)
    .values({ name: `Sig Test Co B ${RUN_ID}`, slug: `sig-test-b-${RUN_ID}` })
    .returning();
  otherCompanyId = companyB.id;

  // Grant client-portal access to company A for the test address only.
  const [access] = await db
    .insert(clientPortalAccessTable)
    .values({
      companyId,
      clerkUserId: CLIENT_CLERK_ID,
      siteAddresses: [ADDRESS],
      email: `pm-${RUN_ID}@example.com`,
      label: `Test PM ${RUN_ID}`,
    })
    .returning();
  accessId = access.id;

  // Insert one inspection per signature state under company A, plus one
  // cross-company row that must never surface in company A's response.
  await db.insert(inspectionsTable).values([
    {
      // State 1: Both parties signed.
      companyId,
      siteAddress: ADDRESS,
      status: "completed",
      technicianName: "Alice",
      technicianSignature: SVG_TECH,
      ownerSignature: SVG_OWNER,
      ownerNotAvailable: false,
      signedAt: SIGNED_AT,
    },
    {
      // State 2: Technician only (owner has not yet signed).
      companyId,
      siteAddress: ADDRESS,
      status: "completed",
      technicianName: "Bob",
      technicianSignature: SVG_TECH,
      ownerSignature: null,
      ownerNotAvailable: false,
      signedAt: SIGNED_AT,
    },
    {
      // State 3: Technician signed; owner marked unavailable.
      companyId,
      siteAddress: ADDRESS,
      status: "completed",
      technicianName: "Carol",
      technicianSignature: SVG_TECH,
      ownerSignature: null,
      ownerNotAvailable: true,
      signedAt: SIGNED_AT,
    },
    {
      // State 4: Owner only (edge case — technician did not sign).
      companyId,
      siteAddress: ADDRESS,
      status: "completed",
      technicianName: "Dan",
      technicianSignature: null,
      ownerSignature: SVG_OWNER,
      ownerNotAvailable: false,
      signedAt: SIGNED_AT,
    },
    {
      // State 5: Unsigned inspection.
      companyId,
      siteAddress: ADDRESS,
      status: "in_progress",
      technicianName: "Eve",
      technicianSignature: null,
      ownerSignature: null,
      ownerNotAvailable: false,
      signedAt: null,
    },
    {
      // Cross-company row — must NEVER appear in company A's response.
      companyId: otherCompanyId,
      siteAddress: ADDRESS,
      status: "completed",
      technicianName: "OtherTech",
      technicianSignature: SVG_TECH,
      ownerSignature: SVG_OWNER,
      ownerNotAvailable: false,
      signedAt: SIGNED_AT,
    },
  ]);

  authState.userId = CLIENT_CLERK_ID;
});

afterAll(async () => {
  authState.userId = null;

  // Delete in dependency order: inspections → access → companies.
  await db
    .delete(inspectionsTable)
    .where(eq(inspectionsTable.siteAddress, ADDRESS));

  await db
    .delete(clientPortalAccessTable)
    .where(eq(clientPortalAccessTable.id, accessId));

  await db
    .delete(companiesTable)
    .where(eq(companiesTable.id, companyId));

  await db
    .delete(companiesTable)
    .where(eq(companiesTable.id, otherCompanyId));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/client/buildings/:address/inspections — signature fields", () => {
  let inspections: Array<Record<string, unknown>>;

  beforeAll(async () => {
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent(ADDRESS)}/inspections`)
      .expect(200);
    inspections = res.body as Array<Record<string, unknown>>;
  });

  it("returns only the 5 company-A rows (cross-company isolation)", () => {
    expect(inspections).toHaveLength(5);
    const names = inspections.map((i) => i.technicianName);
    expect(names).not.toContain("OtherTech");
  });

  it("never returns the raw SVG signature strings", () => {
    for (const insp of inspections) {
      expect(insp).not.toHaveProperty("technicianSignature");
      expect(insp).not.toHaveProperty("ownerSignature");
      expect(JSON.stringify(insp)).not.toContain("tech-sig");
      expect(JSON.stringify(insp)).not.toContain("owner-sig");
    }
  });

  it("state 1 (both signed): technicianSigned=true, ownerSigned=true", () => {
    const row = inspections.find((i) => i.technicianName === "Alice");
    expect(row).toBeDefined();
    expect(row!.technicianSigned).toBe(true);
    expect(row!.ownerSigned).toBe(true);
    expect(row!.ownerNotAvailable).toBe(false);
    expect(row!.signedAt).toBe(SIGNED_AT.toISOString());
  });

  it("state 2 (tech only): technicianSigned=true, ownerSigned=false", () => {
    const row = inspections.find((i) => i.technicianName === "Bob");
    expect(row).toBeDefined();
    expect(row!.technicianSigned).toBe(true);
    expect(row!.ownerSigned).toBe(false);
    expect(row!.ownerNotAvailable).toBe(false);
  });

  it("state 3 (owner N/A): technicianSigned=true, ownerSigned=false, ownerNotAvailable=true", () => {
    const row = inspections.find((i) => i.technicianName === "Carol");
    expect(row).toBeDefined();
    expect(row!.technicianSigned).toBe(true);
    expect(row!.ownerSigned).toBe(false);
    expect(row!.ownerNotAvailable).toBe(true);
  });

  it("state 4 (owner only): technicianSigned=false, ownerSigned=true", () => {
    const row = inspections.find((i) => i.technicianName === "Dan");
    expect(row).toBeDefined();
    expect(row!.technicianSigned).toBe(false);
    expect(row!.ownerSigned).toBe(true);
    expect(row!.ownerNotAvailable).toBe(false);
  });

  it("state 5 (unsigned): technicianSigned=false, ownerSigned=false, signedAt=null", () => {
    const row = inspections.find((i) => i.technicianName === "Eve");
    expect(row).toBeDefined();
    expect(row!.technicianSigned).toBe(false);
    expect(row!.ownerSigned).toBe(false);
    expect(row!.signedAt).toBeNull();
  });
});

describe("GET /api/client/buildings/:address/inspections — unauthenticated", () => {
  it("returns 401 when no Clerk session is present", async () => {
    const savedId = authState.userId;
    authState.userId = null;
    await request(app)
      .get(`/api/client/buildings/${encodeURIComponent(ADDRESS)}/inspections`)
      .expect(401);
    authState.userId = savedId;
  });
});
