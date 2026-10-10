import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Task #332 — Risk-level drill-down: summary strip count reflects the filter.
 *
 * The executive risk inspections screen shows a "X of Y <risk> risk inspections"
 * summary strip where Y comes from `res.total` in the API response. When a
 * technician or date filter is active the strip must show the *filtered* total,
 * not the unfiltered one. A backend pagination bug or off-by-one could silently
 * mislead owners.
 *
 * Fixture design (company slug "risk-filt-a"):
 *   "Solo Tech"  → 1  critical scorecard   (single-result edge case)
 *   "Bulk Tech"  → 105 critical scorecards  (paginated edge case, PAGE_SIZE=100)
 *   "Wrong Risk" → 5  HIGH scorecards       (must be excluded when riskLevel=critical)
 *
 * Unfiltered critical total = 106 (1 + 105).
 *
 * All of the assertions below confirm that the `total` field (the value the
 * summary strip reads) equals the *filtered* count, never the raw 106.
 */

// ── Clerk mock ─────────────────────────────────────────────────────────────────

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

vi.mock("../lib/objectStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/objectStorage")>();
  class ObjectStorageService {
    async getObjectEntityUploadURL(companyId: number) {
      return `https://signed.example.com/companies/${companyId}/uploads/obj`;
    }
    normalizeObjectEntityPath(url: string) { return url; }
    async getObjectEntityFile(_path: string) { return {} as never; }
    async downloadObject() {
      return new Response("file-bytes", {
        headers: { "Content-Type": "application/octet-stream" },
      });
    }
  }
  return { ...actual, ObjectStorageService };
});

vi.mock("../lib/intelligence-ai", () => ({
  generateAiPrediction: vi.fn(async () => ({
    category: "pest",
    subcategory: "cockroach",
    confidence: 0.8,
    tags: [],
    possiblePest: "German cockroach",
    possibleConduciveCondition: null,
    possibleEntryPoint: null,
    suggestedCorrectiveAction: "Apply gel bait",
    rationale: "Visible roach near harborage",
  })),
  fallbackPrediction: () => ({
    category: null,
    subcategory: null,
    confidence: 0,
    tags: [],
    possiblePest: null,
    possibleConduciveCondition: null,
    possibleEntryPoint: null,
    suggestedCorrectiveAction: null,
    rationale: null,
  }),
}));

import app from "../app";
import {
  db,
  usersTable,
  companiesTable,
  inspectionsTable,
  inspectionScorecardsTable,
  brandingProfilesTable,
  READYLOQ_DEFAULT_PROFILE,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

// ── Constants ──────────────────────────────────────────────────────────────────

const OWNER_CLERK_ID = "risk_filt_owner_clerk_id";
const CO_SLUG        = "risk-filt-a";

/** Must match the PAGE_SIZE constant in executive.ts. */
const PAGE_SIZE = 100;

/** Unfiltered critical total across all technicians (1 Solo + 105 Bulk). */
const UNFILTERED_CRITICAL_TOTAL = 106;

const COMPONENTS = {
  photoCoverage: 60,
  evidenceQuality: 60,
  avgConfidence: 60,
  recommendationCoverage: 60,
};

let companyId: number;

function asUser(id: string | null) {
  authState.userId = id;
}

async function findOrCreateCompany(name: string, slug: string): Promise<number> {
  const [existing] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.slug, slug));
  if (existing) return existing.id;
  const [row] = await db.insert(companiesTable).values({ name, slug }).returning();
  return row.id;
}

async function ensureActiveBranding(cId: number, companyName: string) {
  const [existing] = await db
    .select()
    .from(brandingProfilesTable)
    .where(eq(brandingProfilesTable.companyId, cId));
  if (!existing) {
    await db.insert(brandingProfilesTable).values({
      ...READYLOQ_DEFAULT_PROFILE,
      companyName,
      companyId: cId,
      isDefault: true,
      isActive: true,
    });
  }
}

// ── One-time fixture setup ─────────────────────────────────────────────────────

beforeAll(async () => {
  companyId = await findOrCreateCompany("Risk Filter Test Co", CO_SLUG);
  await ensureActiveBranding(companyId, "Risk Filter Test Co");

  // Full idempotent teardown so repeated runs start from a clean state.
  await db
    .delete(inspectionScorecardsTable)
    .where(eq(inspectionScorecardsTable.companyId, companyId));
  await db
    .delete(inspectionsTable)
    .where(eq(inspectionsTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.clerkUserId, OWNER_CLERK_ID));

  await db.insert(usersTable).values({
    clerkUserId: OWNER_CLERK_ID,
    role: "owner",
    companyId,
  });

  // ── Seed inspections ──────────────────────────────────────────────────────────
  // 1 Solo Tech + 105 Bulk Tech + 5 Wrong Risk = 111 inspections total.
  const inspValues = [
    // Solo Tech — 1 critical inspection
    {
      companyId,
      siteAddress: "1 Solo Lane",
      technicianName: "Solo Tech",
      clientName: "Filter Client",
      pestTypes: [] as string[],
    },
    // Bulk Tech — 105 critical inspections
    ...Array.from({ length: 105 }, (_, i) => ({
      companyId,
      siteAddress: `${i + 100} Bulk Blvd`,
      technicianName: "Bulk Tech",
      clientName: "Filter Client",
      pestTypes: [] as string[],
    })),
    // Wrong Risk — 5 HIGH (not critical) inspections
    ...Array.from({ length: 5 }, (_, i) => ({
      companyId,
      siteAddress: `${i + 200} High St`,
      technicianName: "Wrong Risk Tech",
      clientName: "Filter Client",
      pestTypes: [] as string[],
    })),
  ];

  const insps = await db
    .insert(inspectionsTable)
    .values(inspValues)
    .returning({ id: inspectionsTable.id });

  // insps[0]       → Solo Tech (1 critical)
  // insps[1..105]  → Bulk Tech (105 critical)
  // insps[106..110]→ Wrong Risk Tech (5 high)

  const scorecardValues = [
    // Solo Tech — critical
    {
      companyId,
      inspectionId: insps[0].id,
      technicianName: "Solo Tech",
      qualityScore: 30,
      riskScore: 88,
      riskLevel: "critical" as const,
      components: COMPONENTS,
    },
    // Bulk Tech — critical (105 rows)
    ...insps.slice(1, 106).map((r) => ({
      companyId,
      inspectionId: r.id,
      technicianName: "Bulk Tech",
      qualityScore: 35,
      riskScore: 82,
      riskLevel: "critical" as const,
      components: COMPONENTS,
    })),
    // Wrong Risk Tech — HIGH (not critical)
    ...insps.slice(106, 111).map((r) => ({
      companyId,
      inspectionId: r.id,
      technicianName: "Wrong Risk Tech",
      qualityScore: 50,
      riskScore: 60,
      riskLevel: "high" as const,
      components: COMPONENTS,
    })),
  ];

  await db.insert(inspectionScorecardsTable).values(scorecardValues);
});

beforeEach(() => {
  asUser(null);
});

// ── Baseline: unfiltered total ─────────────────────────────────────────────────

describe("GET /executive/inspections — baseline (no filter)", () => {
  it("unfiltered critical total is 106 (1 Solo + 105 Bulk)", async () => {
    asUser(OWNER_CLERK_ID);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "critical" });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(UNFILTERED_CRITICAL_TOTAL);
  });
});

// ── Edge case 1: zero results ──────────────────────────────────────────────────

describe("GET /executive/inspections — zero-result filter", () => {
  it("summary strip total is 0 when technicianName matches nobody", async () => {
    asUser(OWNER_CLERK_ID);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "critical", technicianName: "No One" });

    expect(res.status).toBe(200);

    // The strip reads `total` — it must be 0, not the unfiltered 106.
    expect(res.body.total).toBe(0);
    expect(res.body.total).not.toBe(UNFILTERED_CRITICAL_TOTAL);
    expect(res.body.inspections).toHaveLength(0);
    expect(res.body.hasMore).toBe(false);
  });

  it("summary strip total is 0 when since is in the far future", async () => {
    asUser(OWNER_CLERK_ID);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "critical", since: "2099-01-01" });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.inspections).toHaveLength(0);
    expect(res.body.hasMore).toBe(false);
  });

  it("'Wrong Risk Tech' has no critical scorecards — total=0 when riskLevel=critical", async () => {
    // This tech has 5 HIGH scorecards. Filtering by critical must return 0,
    // proving the risk-level filter is applied to the count query too.
    asUser(OWNER_CLERK_ID);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "critical", technicianName: "Wrong Risk Tech" });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.inspections).toHaveLength(0);
  });
});

// ── Edge case 2: single result ─────────────────────────────────────────────────

describe("GET /executive/inspections — single-result filter", () => {
  it("summary strip total is 1 when technicianName=Solo Tech (not the unfiltered 106)", async () => {
    asUser(OWNER_CLERK_ID);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "critical", technicianName: "Solo Tech" });

    expect(res.status).toBe(200);

    // The strip must show 1, not the unfiltered 106.
    expect(res.body.total).toBe(1);
    expect(res.body.total).not.toBe(UNFILTERED_CRITICAL_TOTAL);
    expect(res.body.inspections).toHaveLength(1);
    expect(res.body.hasMore).toBe(false);

    // The single row must belong to the right tech.
    expect(res.body.inspections[0].technicianName).toBe("Solo Tech");
    expect(res.body.inspections[0].riskLevel).toBe("critical");
  });

  it("count and data-list length agree when there is exactly 1 result", async () => {
    asUser(OWNER_CLERK_ID);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "critical", technicianName: "Solo Tech" });

    expect(res.status).toBe(200);
    // Parallel count query and data query must agree.
    expect(res.body.total).toBe(res.body.inspections.length);
    expect(res.body.pagination.total).toBe(res.body.inspections.length);
  });
});

// ── Edge case 3: paginated results ────────────────────────────────────────────

describe("GET /executive/inspections — paginated filter (Bulk Tech, 105 rows)", () => {
  /**
   * Bulk Tech has 105 critical scorecards — one more than PAGE_SIZE=100.
   * Page 1 (offset=0):   100 rows, hasMore=true,  total=105
   * Page 2 (offset=100):   5 rows, hasMore=false, total=105
   *
   * The summary strip reads `total` from the first page — it must be 105
   * (the filtered count) never 106 (the unfiltered count including Solo Tech).
   */

  it("page 1 total=105 (not the unfiltered 106), hasMore=true", async () => {
    asUser(OWNER_CLERK_ID);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "critical", technicianName: "Bulk Tech", offset: 0 });

    expect(res.status).toBe(200);

    expect(res.body.total).toBe(105);
    expect(res.body.total).not.toBe(UNFILTERED_CRITICAL_TOTAL); // must not bleed Solo Tech's row
    expect(res.body.hasMore).toBe(true);
    expect(res.body.inspections).toHaveLength(PAGE_SIZE);

    // Every row on page 1 belongs to Bulk Tech.
    for (const row of res.body.inspections) {
      expect(row.technicianName).toBe("Bulk Tech");
      expect(row.riskLevel).toBe("critical");
    }
  });

  it("page 2 still reports total=105 and hasMore=false", async () => {
    asUser(OWNER_CLERK_ID);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "critical", technicianName: "Bulk Tech", offset: PAGE_SIZE });

    expect(res.status).toBe(200);

    // The count must be stable across pages.
    expect(res.body.total).toBe(105);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.inspections).toHaveLength(5); // 105 - 100
  });

  it("pages 1 + 2 together cover all 105 Bulk Tech rows with no duplicates", async () => {
    asUser(OWNER_CLERK_ID);

    const [res1, res2] = await Promise.all([
      request(app)
        .get("/api/executive/inspections")
        .query({ riskLevel: "critical", technicianName: "Bulk Tech", offset: 0 }),
      request(app)
        .get("/api/executive/inspections")
        .query({ riskLevel: "critical", technicianName: "Bulk Tech", offset: PAGE_SIZE }),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const ids1 = res1.body.inspections.map((r: { inspectionId: number }) => r.inspectionId);
    const ids2 = res2.body.inspections.map((r: { inspectionId: number }) => r.inspectionId);

    // No overlap between pages.
    const set1 = new Set<number>(ids1);
    for (const id of ids2) {
      expect(set1.has(id)).toBe(false);
    }

    // Combined coverage = exactly 105 unique ids.
    const allIds = new Set([...ids1, ...ids2]);
    expect(allIds.size).toBe(105);
  });

  it("count and data length agree across both pages (no count/data query divergence)", async () => {
    asUser(OWNER_CLERK_ID);

    const [res1, res2] = await Promise.all([
      request(app)
        .get("/api/executive/inspections")
        .query({ riskLevel: "critical", technicianName: "Bulk Tech", offset: 0 }),
      request(app)
        .get("/api/executive/inspections")
        .query({ riskLevel: "critical", technicianName: "Bulk Tech", offset: PAGE_SIZE }),
    ]);

    // Both pages must report the same stable total.
    expect(res1.body.total).toBe(res2.body.total);

    // Total must equal combined items across both pages.
    const combinedLength = res1.body.inspections.length + res2.body.inspections.length;
    expect(res1.body.total).toBe(combinedLength);
  });
});

// ── Filter isolates the count from other risk levels ──────────────────────────

describe("GET /executive/inspections — riskLevel isolation in count", () => {
  it("critical filter excludes Wrong Risk Tech's 5 HIGH rows from total", async () => {
    asUser(OWNER_CLERK_ID);
    const [critRes, highRes] = await Promise.all([
      request(app)
        .get("/api/executive/inspections")
        .query({ riskLevel: "critical" }),
      request(app)
        .get("/api/executive/inspections")
        .query({ riskLevel: "high" }),
    ]);

    expect(critRes.status).toBe(200);
    expect(highRes.status).toBe(200);

    // Critical total must be 106 (Solo 1 + Bulk 105), not 111 (which would
    // include the 5 high rows) — confirming the count query filters by riskLevel.
    expect(critRes.body.total).toBe(UNFILTERED_CRITICAL_TOTAL);
    expect(highRes.body.total).toBe(5);
  });
});

// ── Summary strip reads total, not inspections.length ────────────────────────

describe("GET /executive/inspections — summary strip field consistency", () => {
  /**
   * The screen reads res.total (top-level alias) for the summary strip and
   * res.pagination.total for the sub-object. Both must agree with each other
   * and with the actual row count across pages.
   */

  it("top-level total and pagination.total agree for a filtered request (Solo Tech)", async () => {
    asUser(OWNER_CLERK_ID);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "critical", technicianName: "Solo Tech" });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(res.body.pagination.total);
  });

  it("top-level total and pagination.total agree for a zero-result request", async () => {
    asUser(OWNER_CLERK_ID);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "critical", technicianName: "Ghost" });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.pagination.total).toBe(0);
  });

  it("top-level total and pagination.total agree for a paginated request (Bulk Tech, page 1)", async () => {
    asUser(OWNER_CLERK_ID);
    const res = await request(app)
      .get("/api/executive/inspections")
      .query({ riskLevel: "critical", technicianName: "Bulk Tech", offset: 0 });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(res.body.pagination.total);
    expect(res.body.total).toBe(105);
  });
});
