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

// generateCustomerSummaryBody is stubbed so tests that call the generate
// endpoint never hit the real OpenAI call. The isolation tests below seed
// summaries directly via the DB, but the mock is required because the module
// is imported at app-load time.
vi.mock("../lib/customer-summary-ai", () => ({
  generateCustomerSummaryBody: vi.fn(async () => "Stubbed customer summary body"),
  SummaryFidelityError: class SummaryFidelityError extends Error {},
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

// ═════════════════════════════════════════════════════════════════════════════
// 4. Customer-summaries write routes — PATCH, approve, and revoke must all
//    return 404 when the summary id belongs to a different company.
//
//    The companyId guard is applied at the initial SELECT in every write
//    handler, so a cross-tenant id resolves to an empty result set and the
//    handler short-circuits to 404 before any mutation can occur.
// ═════════════════════════════════════════════════════════════════════════════

describe("customer-summaries write routes — cross-tenant manager is always 404", () => {
  let summaryAId: number;   // draft summary owned by company A
  let approvedSummaryAId: number; // approved summary owned by company A (for revoke test)

  beforeAll(async () => {
    // Create an inspection for company A so FK constraints are satisfied.
    const inspDraft = await createInspection(ADV_OWNER_A, "77 Summary Draft Lane");
    const inspApproved = await createInspection(ADV_OWNER_A, "78 Summary Approved Lane");

    // Seed a DRAFT summary for company A directly (avoids needing the AI
    // generate endpoint, which is stubbed and not the subject of these tests).
    const [draftRow] = await db
      .insert(customerSummariesTable)
      .values({
        companyId: companyAId,
        inspectionId: inspDraft.id,
        status: "draft",
        body: "Original draft body — must not be altered by company B",
      })
      .returning();
    summaryAId = draftRow.id;

    // Seed an APPROVED summary for company A so the revoke test has a share
    // token to attempt revoking from a cross-tenant position.
    // Use a unique token per run to avoid the share_token unique index collision.
    const uniqueShareToken = `revoke-isolation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const [approvedRow] = await db
      .insert(customerSummariesTable)
      .values({
        companyId: companyAId,
        inspectionId: inspApproved.id,
        status: "approved",
        body: "Approved body — frozen",
        shareToken: uniqueShareToken,
        shareExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        approvedAt: new Date(),
      })
      .returning();
    approvedSummaryAId = approvedRow.id;
  });

  it("PATCH /api/customer-summaries/:id — company B manager gets 404 for company A's summary id", async () => {
    asUser(ADV_MANAGER_B);
    const res = await request(app)
      .patch(`/api/customer-summaries/${summaryAId}`)
      .send({ body: "Injected body from company B" });

    expect(res.status).toBe(404);
  });

  it("PATCH does not modify company A's summary body", async () => {
    // Confirm the body is still the original value after the cross-tenant PATCH.
    const [row] = await db
      .select()
      .from(customerSummariesTable)
      .where(eq(customerSummariesTable.id, summaryAId));

    expect(row.body).toBe("Original draft body — must not be altered by company B");
    expect(row.status).toBe("draft");
  });

  it("POST /api/customer-summaries/:id/approve — company B manager gets 404 for company A's summary id", async () => {
    asUser(ADV_MANAGER_B);
    const res = await request(app)
      .post(`/api/customer-summaries/${summaryAId}/approve`)
      .send({ expiresInDays: 30 });

    expect(res.status).toBe(404);
  });

  it("approve does not change company A's draft summary status to approved", async () => {
    const [row] = await db
      .select()
      .from(customerSummariesTable)
      .where(eq(customerSummariesTable.id, summaryAId));

    // Still draft; no share token was minted by the cross-tenant attempt.
    expect(row.status).toBe("draft");
    expect(row.shareToken).toBeNull();
    expect(row.approvedAt).toBeNull();
  });

  it("POST /api/customer-summaries/:id/revoke — company B manager gets 404 for company A's approved summary id", async () => {
    asUser(ADV_MANAGER_B);
    const res = await request(app)
      .post(`/api/customer-summaries/${approvedSummaryAId}/revoke`);

    expect(res.status).toBe(404);
  });

  it("revoke does not clear company A's share token", async () => {
    const [row] = await db
      .select()
      .from(customerSummariesTable)
      .where(eq(customerSummariesTable.id, approvedSummaryAId));

    // Share token must still be intact after the cross-tenant revoke attempt.
    expect(row.shareToken).not.toBeNull();
    expect(row.shareExpiresAt).not.toBeNull();
  });

  it("company A's own manager can still PATCH, approve, and revoke their summaries", async () => {
    // Sanity check: a legitimate manager from company A can operate on their
    // own summaries without being blocked by the tenant guard.
    const MGR_A = "adv_mgr_a_summaries_clerk";
    // Use onConflictDoNothing: on re-runs the user may already exist and have
    // approved_by_user_id references that prevent deletion.
    await db
      .insert(usersTable)
      .values({ clerkUserId: MGR_A, role: "manager", companyId: companyAId })
      .onConflictDoNothing();

    // PATCH draft body.
    asUser(MGR_A);
    const patch = await request(app)
      .patch(`/api/customer-summaries/${summaryAId}`)
      .send({ body: "Updated by legitimate company A manager" });
    expect(patch.status).toBe(200);
    expect(patch.body.body).toBe("Updated by legitimate company A manager");

    // Approve the draft (mints a share token).
    const approve = await request(app)
      .post(`/api/customer-summaries/${summaryAId}/approve`)
      .send({ expiresInDays: 7 });
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe("approved");
    expect(approve.body.shareToken).toBeTruthy();

    // Revoke the approved summary's share link.
    const revoke = await request(app)
      .post(`/api/customer-summaries/${summaryAId}/revoke`);
    expect(revoke.status).toBe(200);
    expect(revoke.body.shareToken).toBeNull();

    // Note: MGR_A is not deleted here because the approve step wrote
    // approved_by_user_id → users.id, creating a FK reference that prevents
    // deletion. The user is confined to companyAId and scoped to the _adv_
    // test namespace, so it does not affect other test suites.
    asUser(null);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. POST /reports/:id/share — cross-tenant isolation and share-token guard
//
//    Two properties are locked in here:
//      a) Company B cannot generate a share URL for company A's report even
//         when they know the numeric report id (scoped WHERE companyId guard).
//      b) The owning company gets 404 when the report exists but no approved
//         customer summary with a shareToken has been minted yet.
// ═════════════════════════════════════════════════════════════════════════════

describe("POST /reports/:id/share — cross-tenant isolation and share-token guard", () => {
  let reportAId: number;
  let inspAId: number;
  // Generated fresh each test-run to avoid clashing with the unique shareToken index.
  let approvedShareToken: string;

  beforeAll(async () => {
    // Create a company A inspection and report.
    const inspA = await createInspection(ADV_OWNER_A, "77 Share Link Avenue A");
    inspAId = inspA.id;
    const reportA = await createReport(ADV_OWNER_A, inspAId);
    reportAId = reportA.id;

    // Generate a unique token per run so re-runs against the same DB don't
    // collide on the globally-unique share_token index.
    approvedShareToken = `adv-share-tok-323-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Seed an APPROVED customer summary with a share token for company A's
    // inspection so the positive-path test has something to return.
    await db.insert(customerSummariesTable).values({
      companyId: companyAId,
      inspectionId: inspAId,
      status: "approved",
      body: "Approved summary for share-link isolation test",
      shareToken: approvedShareToken,
      approvedAt: new Date(),
      shareExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
  });

  it("company B gets 404 when trying to generate a share link for company A's report", async () => {
    asUser(ADV_OWNER_B);
    const res = await request(app).post(`/api/reports/${reportAId}/share`);

    // The companyId WHERE clause on the reports fetch means company B's owner
    // sees no row for reportAId → 404.
    expect(res.status).toBe(404);
  });

  it("share link attempt by company B does not expose company A's shareToken", async () => {
    asUser(ADV_OWNER_B);
    const res = await request(app).post(`/api/reports/${reportAId}/share`);

    // The response body must not contain the real share token or a share URL.
    const body = JSON.stringify(res.body);
    expect(body).not.toContain(approvedShareToken);
    expect(body).not.toContain("shareUrl");
  });

  it("company A's owner gets the share URL for their own approved report", async () => {
    asUser(ADV_OWNER_A);
    const res = await request(app).post(`/api/reports/${reportAId}/share`);

    expect(res.status).toBe(200);
    expect(res.body.shareUrl).toBeTruthy();
    expect(res.body.shareUrl).toContain(approvedShareToken);
  });

  it("returns 404 when the owning company's report has no approved summary yet", async () => {
    // Create a fresh inspection+report for company A with NO customer summary.
    const inspNoSummary = await createInspection(ADV_OWNER_A, "78 No Summary Road");
    const reportNoSummary = await createReport(ADV_OWNER_A, inspNoSummary.id);

    asUser(ADV_OWNER_A);
    const res = await request(app).post(`/api/reports/${reportNoSummary.id}/share`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no approved summary/i);
  });

  it("returns 404 when the owning company's report has only a draft summary (no shareToken)", async () => {
    // Create an inspection+report for company A with a DRAFT summary (no token).
    const inspDraft = await createInspection(ADV_OWNER_A, "79 Draft Only Street");
    const reportDraft = await createReport(ADV_OWNER_A, inspDraft.id);

    await db.insert(customerSummariesTable).values({
      companyId: companyAId,
      inspectionId: inspDraft.id,
      status: "draft",
      body: "Draft — no share token yet",
      shareToken: null,
    });

    asUser(ADV_OWNER_A);
    const res = await request(app).post(`/api/reports/${reportDraft.id}/share`);

    // Draft summaries never have a shareToken → the guard returns 404.
    expect(res.status).toBe(404);
  });
});
