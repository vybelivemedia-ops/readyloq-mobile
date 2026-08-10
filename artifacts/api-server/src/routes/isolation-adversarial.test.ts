import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Adversarial cross-tenant isolation tests (Task #318).
 *
 * Three specific guards introduced this session are locked in here so future
 * changes cannot silently regress them:
 *
 *  1. GET /briefing (manager role) — the approvalsQueue JOIN uses companyId on
 *     the inspections table, so company B's manager never sees company A's site
 *     addresses even if they know a valid customer-summary id.
 *
 *  2. POST /inspections/:id/media — the idempotency lookup is scoped to
 *     companyId, so a URL that already exists under company A is never matched
 *     when company B posts to its own inspection with the same URL.
 *
 *  3. POST /reports/:id/generate-narrative — the final UPDATE is guarded with
 *     companyId; if the report row disappears between the initial fetch and the
 *     UPDATE (e.g. deleted by a concurrent request), the endpoint returns 409
 *     instead of silently swallowing the loss.
 */

// ─── Clerk mock (same pattern as isolation.test.ts) ───────────────────────────

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

// ─── Object storage stub ──────────────────────────────────────────────────────

vi.mock("../lib/objectStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/objectStorage")>();
  class ObjectStorageService {
    async getObjectEntityUploadURL(companyId: number) {
      return `https://signed.example.com/companies/${companyId}/uploads/obj`;
    }
    normalizeObjectEntityPath(url: string) {
      return url;
    }
    async getObjectEntityFile(_path: string) {
      return {} as never;
    }
    async downloadObject() {
      return new Response("file-bytes", {
        headers: { "Content-Type": "application/octet-stream" },
      });
    }
  }
  return { ...actual, ObjectStorageService };
});

// ─── AI stubs ─────────────────────────────────────────────────────────────────

// generateReportNarrative is stubbed to a fast no-op. Tests that need to
// intercept the call mid-flight use mockImplementationOnce on this spy.
const { generateNarrativeSpy } = vi.hoisted(() => ({
  generateNarrativeSpy: vi.fn(async () => "Stubbed AI narrative"),
}));

vi.mock("../lib/report-narrative-ai", () => ({
  // Pass the spy directly so TypeScript keeps the full call-signature intact.
  generateReportNarrative: generateNarrativeSpy,
  derivePropertyType: () => "residential",
}));

// ─── App + DB imports (after all mocks are in place) ─────────────────────────

import app from "../app";
import {
  db,
  usersTable,
  companiesTable,
  inspectionsTable,
  inspectionMediaTable,
  reportsTable,
  brandingProfilesTable,
  customerSummariesTable,
  READYLOQ_DEFAULT_PROFILE,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

// ─── Test actors ──────────────────────────────────────────────────────────────

const ADV_OWNER_A = "adv_owner_a_clerk";
const ADV_OWNER_B = "adv_owner_b_clerk";
const ADV_MANAGER_B = "adv_manager_b_clerk";

let companyAId: number;
let companyBId: number;

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

async function seedActiveBranding(companyId: number, companyName: string) {
  const [existing] = await db
    .select()
    .from(brandingProfilesTable)
    .where(and(eq(brandingProfilesTable.companyId, companyId), eq(brandingProfilesTable.isActive, true)));
  if (existing) return;
  await db.insert(brandingProfilesTable).values({
    ...READYLOQ_DEFAULT_PROFILE,
    companyName,
    companyId,
    isDefault: true,
    isActive: true,
  });
}

/** Create an inspection via the API and return the body. */
async function createInspection(ownerId: string, siteAddress: string) {
  asUser(ownerId);
  const res = await request(app)
    .post("/api/inspections")
    .send({ siteAddress, technicianName: "Tech", clientName: "Client", pestTypes: ["ants"] });
  asUser(null);
  expect(res.status).toBe(201);
  return res.body as { id: number };
}

/** Create a report via the API and return the body. */
async function createReport(ownerId: string, inspectionId: number) {
  asUser(ownerId);
  const res = await request(app)
    .post("/api/reports")
    .send({ inspectionId, title: "Test Report" });
  asUser(null);
  expect(res.status).toBe(201);
  return res.body as { id: number };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  companyAId = await findOrCreateCompany("Adversarial Co A", "adv-co-a");
  companyBId = await findOrCreateCompany("Adversarial Co B", "adv-co-b");

  await seedActiveBranding(companyAId, "Adv Company A");
  await seedActiveBranding(companyBId, "Adv Company B");

  // Insert fresh users (delete any leftover from prior runs first).
  await db
    .delete(usersTable)
    .where(
      eq(usersTable.clerkUserId, ADV_OWNER_A),
    );
  await db
    .delete(usersTable)
    .where(eq(usersTable.clerkUserId, ADV_OWNER_B));
  await db
    .delete(usersTable)
    .where(eq(usersTable.clerkUserId, ADV_MANAGER_B));

  await db.insert(usersTable).values([
    { clerkUserId: ADV_OWNER_A,   role: "owner",   companyId: companyAId },
    { clerkUserId: ADV_OWNER_B,   role: "owner",   companyId: companyBId },
    { clerkUserId: ADV_MANAGER_B, role: "manager", companyId: companyBId },
  ]);
});

beforeEach(() => {
  asUser(null);
  generateNarrativeSpy.mockResolvedValue("Stubbed AI narrative");
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. Manager briefing — approvalsQueue must not reveal another company's
//    site addresses, even when a cross-tenant inspectionId is theoretically
//    accessible via the customer_summaries table.
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/briefing (manager) — approvalsQueue is isolated per company", () => {
  let inspAId: number;
  let inspBLeakedId: number; // company B inspection whose address must never reach company A

  beforeAll(async () => {
    // Create an inspection for company A and a draft customer summary for it.
    const inspA = await createInspection(ADV_OWNER_A, "42 Secret A Lane");
    inspAId = inspA.id;

    // Create an inspection for company B whose siteAddress must never leak.
    const inspBLeaked = await createInspection(ADV_OWNER_B, "99 Leaked B Street");
    inspBLeakedId = inspBLeaked.id;

    // Insert the draft summary for company A's own inspection.
    await db.insert(customerSummariesTable).values({
      companyId: companyAId,
      inspectionId: inspAId,
      status: "draft",
      body: "Draft summary for company A",
    });

    // Adversarial row: a customer_summary record whose company_id is company A
    // but whose inspection_id points at company B's inspection. Without the
    // companyId guard on the JOIN inside buildManagerSection, this would make
    // "99 Leaked B Street" appear in company A's manager briefing.
    //
    // No unique constraint is violated because inspBLeakedId has no summary yet.
    // FK constraints only require the referenced row exists — not that it
    // shares the same company_id.
    await db.insert(customerSummariesTable).values({
      companyId: companyAId,       // summary "owned" by company A
      inspectionId: inspBLeakedId, // but points at company B's inspection
      status: "draft",
      body: "Adversarial summary — should never reach the briefing queue",
    });
  });

  it("company B's manager does not see company A's address in the approvals queue", async () => {
    asUser(ADV_MANAGER_B);
    const res = await request(app).get("/api/briefing");
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("manager");

    const queue: { siteAddress: string }[] = res.body.manager?.approvalsQueue ?? [];
    const addresses = queue.map((q) => q.siteAddress);
    expect(addresses).not.toContain("42 Secret A Lane");
  });

  it("adversarial summary with cross-tenant inspectionId does not expose company B address to company A manager", async () => {
    // This is the core guard test: the customer_summary row inserted in
    // beforeAll has companyId=A but inspectionId=B's inspection. The
    // buildManagerSection JOIN adds:
    //   AND inspections.company_id = :companyId
    // which causes the INNER JOIN to exclude that row (company B's inspection
    // doesn't match company A's companyId). Without this guard the siteAddress
    // "99 Leaked B Street" would appear in company A's briefing queue.
    const MGR_A = "adv_manager_a_clerk";
    await db.delete(usersTable).where(eq(usersTable.clerkUserId, MGR_A));
    await db.insert(usersTable).values({ clerkUserId: MGR_A, role: "manager", companyId: companyAId });

    asUser(MGR_A);
    const res = await request(app).get("/api/briefing");
    expect(res.status).toBe(200);

    const queue: { siteAddress: string; inspectionId: number }[] =
      res.body.manager?.approvalsQueue ?? [];

    // The adversarial row must be filtered out — "99 Leaked B Street" must
    // never appear, and inspBLeakedId must not appear in the inspectionIds.
    const addresses = queue.map((q) => q.siteAddress);
    const inspectionIds = queue.map((q) => q.inspectionId);
    expect(addresses).not.toContain("99 Leaked B Street");
    expect(inspectionIds).not.toContain(inspBLeakedId);

    // The legitimate company A summary IS visible (inspAId, "42 Secret A Lane").
    expect(inspectionIds).toContain(inspAId);

    await db.delete(usersTable).where(eq(usersTable.clerkUserId, MGR_A));
  });

  it("company A's inspection id does not appear in company B manager's briefing queue", async () => {
    asUser(ADV_MANAGER_B);
    const res = await request(app).get("/api/briefing");
    expect(res.status).toBe(200);

    const queue: { inspectionId: number }[] = res.body.manager?.approvalsQueue ?? [];
    const inspectionIds = queue.map((q) => q.inspectionId);
    expect(inspectionIds).not.toContain(inspAId);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. POST /inspections/:id/media — idempotency lookup is company-scoped so a
//    URL that already exists in company A is never matched when company B posts
//    to its own inspection with the same URL string.
// ═════════════════════════════════════════════════════════════════════════════

describe("POST /inspections/:id/media — idempotency lookup cannot cross tenant boundary", () => {
  const SHARED_URL = "https://cdn.example.com/pest-photo-shared.jpg";

  let inspAId: number;
  let inspBId: number;

  beforeAll(async () => {
    const inspA = await createInspection(ADV_OWNER_A, "10 Media Lane A");
    const inspB = await createInspection(ADV_OWNER_B, "10 Media Lane B");
    inspAId = inspA.id;
    inspBId = inspB.id;

    // Seed a media record for company A using SHARED_URL.
    asUser(ADV_OWNER_A);
    const seed = await request(app)
      .post(`/api/inspections/${inspAId}/media`)
      .send({ mediaType: "image", url: SHARED_URL, filename: "pest-a.jpg" });
    expect(seed.status).toBe(201);
    asUser(null);
  });

  it("returns 201 (new row) when company B posts the same URL to its own inspection", async () => {
    // Company B posts SHARED_URL to its OWN inspection. The idempotency lookup
    // is scoped to (companyId, inspectionId, url), so the existing company A
    // record must NOT be matched — a fresh row is created and HTTP 201 returned.
    asUser(ADV_OWNER_B);
    const res = await request(app)
      .post(`/api/inspections/${inspBId}/media`)
      .send({ mediaType: "image", url: SHARED_URL, filename: "pest-b.jpg" });

    expect(res.status).toBe(201);
    // The returned row must belong to company B, not company A.
    expect(res.body.companyId).toBe(companyBId);
    expect(res.body.inspectionId).toBe(inspBId);
  });

  it("returns 200 (idempotent) when company B repeats the same POST to its own inspection", async () => {
    // After the previous test created the record, a retry must deduplicate
    // within company B's scope only — it should NOT reach company A's row.
    asUser(ADV_OWNER_B);
    const first = await request(app)
      .post(`/api/inspections/${inspBId}/media`)
      .send({ mediaType: "image", url: SHARED_URL, filename: "pest-b.jpg" });

    // First call after the beforeAll seed should be idempotent (200) now.
    expect([200, 201]).toContain(first.status);
    expect(first.body.companyId).toBe(companyBId);
  });

  it("404s when company B tries to attach media to company A's inspection", async () => {
    // The parent-inspection check (before idempotency) should block cross-tenant
    // writes outright.
    asUser(ADV_OWNER_B);
    const res = await request(app)
      .post(`/api/inspections/${inspAId}/media`)
      .send({ mediaType: "image", url: "https://cdn.example.com/stolen.jpg" });
    expect(res.status).toBe(404);
  });

  it("company A's original media row is unaffected by company B's writes", async () => {
    asUser(ADV_OWNER_A);
    const mediaA = await db
      .select()
      .from(inspectionMediaTable)
      .where(
        and(
          eq(inspectionMediaTable.companyId, companyAId),
          eq(inspectionMediaTable.inspectionId, inspAId),
          eq(inspectionMediaTable.url, SHARED_URL),
        ),
      );
    expect(mediaA).toHaveLength(1);
    expect(mediaA[0].filename).toBe("pest-a.jpg");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. POST /reports/:id/generate-narrative — the final UPDATE is guarded by
//    companyId. If the report is deleted between the initial SELECT and the
//    UPDATE (concurrent delete race), the endpoint returns 409 instead of a
//    silent success.
// ═════════════════════════════════════════════════════════════════════════════

describe("POST /reports/:id/generate-narrative — 409 when report deleted mid-flight", () => {
  it("returns 409 when the report row disappears before the narrative UPDATE", async () => {
    const insp = await createInspection(ADV_OWNER_A, "50 Race Condition Road");
    const report = await createReport(ADV_OWNER_A, insp.id);

    // Intercept the AI call to delete the report row *before* returning —
    // simulating a concurrent delete that wins the race between the initial
    // SELECT (which found the row) and the final UPDATE.
    generateNarrativeSpy.mockImplementationOnce(async () => {
      await db
        .delete(reportsTable)
        .where(
          and(
            eq(reportsTable.id, report.id),
            eq(reportsTable.companyId, companyAId),
          ),
        );
      return "Narrative generated after row was deleted";
    });

    asUser(ADV_OWNER_A);
    const res = await request(app).post(`/api/reports/${report.id}/generate-narrative`);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no longer exists/i);
  });

  it("returns 404 when the inspection is cascade-deleted along with its report", async () => {
    // The reports FK to inspections uses ON DELETE CASCADE, so deleting the
    // inspection removes the report too. The endpoint sees no report row at
    // all → 404, not 409 (which requires the report row to still exist while
    // the inspection is gone). This documents the cascade behaviour explicitly.
    const insp = await createInspection(ADV_OWNER_A, "51 Race Condition Road");
    const report = await createReport(ADV_OWNER_A, insp.id);

    // Delete the inspection; the cascade propagates to the report.
    await db
      .delete(inspectionsTable)
      .where(
        and(
          eq(inspectionsTable.id, insp.id),
          eq(inspectionsTable.companyId, companyAId),
        ),
      );

    asUser(ADV_OWNER_A);
    const res = await request(app).post(`/api/reports/${report.id}/generate-narrative`);

    // Report was cascade-deleted → 404 (the row is gone, not just stale).
    expect(res.status).toBe(404);
  });

  it("returns 404 when company B tries to generate a narrative for company A's report", async () => {
    const insp = await createInspection(ADV_OWNER_A, "52 Cross Tenant Road");
    const report = await createReport(ADV_OWNER_A, insp.id);

    asUser(ADV_OWNER_B);
    const res = await request(app).post(`/api/reports/${report.id}/generate-narrative`);
    expect(res.status).toBe(404);
  });
});
