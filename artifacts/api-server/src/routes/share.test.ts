import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Public share-link isolation tests (Task #436) + revocation timing (Task #437).
 *
 * GET /api/share/summary/:token is the ONLY unauthenticated window into
 * tenant data. These tests lock in the invariants that must always hold:
 *
 *  1. A valid, unexpired token returns exactly the right company's summary.
 *  2. An expired token is uniformly 404 — never serves stale data.
 *  3. An unknown or random token is uniformly 404.
 *  4. A revoked token is 404 IMMEDIATELY — not after any cache window.
 *
 * Cross-tenant re-play is structurally impossible (the token IS the credential
 * and the lookup is solely by token — no company IDs in the URL), so test 1
 * implicitly covers it: the handler returns whichever company minted the token.
 * We seed both companies' summaries and confirm each token resolves to the
 * correct owner.
 */

// ─── Clerk mock (same pattern as isolation-adversarial.test.ts) ──────────────
// The share router itself never calls getAuth, but the app-level middleware
// import requires the mock to exist so the module graph resolves cleanly.
// Tests in section 5 (revocation timing) DO call authenticated endpoints, so
// the authState is also used there.

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

// ─── Object storage stub (share route never touches storage, but the app
//     module graph imports ObjectStorageService at load time) ─────────────────

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

// ─── AI stubs (modules imported at app load time) ────────────────────────────

vi.mock("../lib/customer-summary-ai", () => ({
  generateCustomerSummaryBody: vi.fn(async () => "Stubbed customer summary body"),
  SummaryFidelityError: class SummaryFidelityError extends Error {},
}));

vi.mock("../lib/report-narrative-ai", () => ({
  generateReportNarrative: vi.fn(async () => "Stubbed AI narrative"),
  derivePropertyType: () => "residential",
}));

// ─── App + DB imports (after all mocks are in place) ─────────────────────────

import app from "../app";
import {
  db,
  companiesTable,
  inspectionsTable,
  customerSummariesTable,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function findOrCreateCompany(name: string, slug: string): Promise<number> {
  const [existing] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.slug, slug));
  if (existing) return existing.id;
  const [row] = await db.insert(companiesTable).values({ name, slug }).returning();
  return row.id;
}

/** Switches which Clerk user id the mock returns for the next request(s). */
function asUser(id: string | null) {
  authState.userId = id;
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

let companyAId: number;
let companyBId: number;

// A manager from company A used only in the revocation-timing test (section 5).
const SHARE_MGR_A = "share_mgr_a_clerk";

// Tokens are unique per run to avoid clashing on the globally-unique
// share_token index when the test DB is reused across runs.
const run = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const TOKEN_A_VALID     = `share-valid-a-${run}`;
const TOKEN_B_VALID     = `share-valid-b-${run}`;
const TOKEN_A_EXPIRED   = `share-expired-a-${run}`;
const TOKEN_A_DRAFT     = `share-draft-a-${run}`;

let inspAId: number;
let inspBId: number;
let inspExpiredId: number;
let inspDraftId: number;

const FUTURE  = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days out
const PAST    = new Date(Date.now() - 1);                         // 1 ms ago

beforeAll(async () => {
  companyAId = await findOrCreateCompany("Share Test Co A", "share-test-co-a");
  companyBId = await findOrCreateCompany("Share Test Co B", "share-test-co-b");

  // We need at least one user per company so the inspection POST auth works.
  // Use onConflictDoNothing so re-runs don't break on the unique clerk_user_id.
  await db
    .insert(usersTable)
    .values([
      { clerkUserId: "share_owner_a_clerk", role: "owner", companyId: companyAId },
      { clerkUserId: "share_owner_b_clerk", role: "owner", companyId: companyBId },
      // Manager used for revocation-timing tests (section 5).
      { clerkUserId: SHARE_MGR_A, role: "manager", companyId: companyAId },
    ])
    .onConflictDoNothing();

  // Seed inspections directly so we have FK-valid rows without going through
  // the authenticated inspection endpoint (avoids Clerk auth complexity here).
  const [inspA] = await db
    .insert(inspectionsTable)
    .values({
      companyId: companyAId,
      siteAddress: "1 Alpha Street",
      technicianName: "Tech A",
      clientName: "Client A",
      pestTypes: ["ants"],
    })
    .returning();
  inspAId = inspA.id;

  const [inspB] = await db
    .insert(inspectionsTable)
    .values({
      companyId: companyBId,
      siteAddress: "2 Beta Boulevard",
      technicianName: "Tech B",
      clientName: "Client B",
      pestTypes: ["roaches"],
    })
    .returning();
  inspBId = inspB.id;

  const [inspExpired] = await db
    .insert(inspectionsTable)
    .values({
      companyId: companyAId,
      siteAddress: "3 Expired Road",
      technicianName: "Tech A",
      clientName: "Client Expired",
      pestTypes: ["mice"],
    })
    .returning();
  inspExpiredId = inspExpired.id;

  const [inspDraft] = await db
    .insert(inspectionsTable)
    .values({
      companyId: companyAId,
      siteAddress: "4 Draft Lane",
      technicianName: "Tech A",
      clientName: "Client Draft",
      pestTypes: ["spiders"],
    })
    .returning();
  inspDraftId = inspDraft.id;

  // --- Company A valid approved summary (unexpired) ---
  await db.insert(customerSummariesTable).values({
    companyId: companyAId,
    inspectionId: inspAId,
    status: "approved",
    body: "Company A approved summary body.",
    shareToken: TOKEN_A_VALID,
    approvedAt: new Date(),
    shareExpiresAt: FUTURE,
  });

  // --- Company B valid approved summary (unexpired) ---
  await db.insert(customerSummariesTable).values({
    companyId: companyBId,
    inspectionId: inspBId,
    status: "approved",
    body: "Company B approved summary body.",
    shareToken: TOKEN_B_VALID,
    approvedAt: new Date(),
    shareExpiresAt: FUTURE,
  });

  // --- Company A expired approved summary ---
  await db.insert(customerSummariesTable).values({
    companyId: companyAId,
    inspectionId: inspExpiredId,
    status: "approved",
    body: "Company A expired summary body.",
    shareToken: TOKEN_A_EXPIRED,
    approvedAt: new Date(),
    shareExpiresAt: PAST,
  });

  // --- Company A draft summary (no share token) ---
  await db.insert(customerSummariesTable).values({
    companyId: companyAId,
    inspectionId: inspDraftId,
    status: "draft",
    body: "Company A draft body — must never be served publicly.",
    shareToken: TOKEN_A_DRAFT,
    // shareExpiresAt intentionally omitted (null) — draft never has one
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. Valid unexpired token — returns the correct summary
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/share/summary/:token — valid unexpired token", () => {
  it("returns 200 with company A's summary for company A's token", async () => {
    const res = await request(app).get(`/api/share/summary/${TOKEN_A_VALID}`);

    expect(res.status).toBe(200);
    expect(res.body.summary).toBe("Company A approved summary body.");
    expect(res.body.companyName).toBe("Share Test Co A");
    expect(res.body.propertyAddress).toBe("1 Alpha Street");
  });

  it("returns 200 with company B's summary for company B's token", async () => {
    const res = await request(app).get(`/api/share/summary/${TOKEN_B_VALID}`);

    expect(res.status).toBe(200);
    expect(res.body.summary).toBe("Company B approved summary body.");
    expect(res.body.companyName).toBe("Share Test Co B");
    expect(res.body.propertyAddress).toBe("2 Beta Boulevard");
  });

  it("response includes inspectionDate and approvedAt fields", async () => {
    const res = await request(app).get(`/api/share/summary/${TOKEN_A_VALID}`);

    expect(res.status).toBe(200);
    // ISO date string in YYYY-MM-DD format
    expect(res.body.inspectionDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("response contains no internal IDs, photos, or finding details", async () => {
    const res = await request(app).get(`/api/share/summary/${TOKEN_A_VALID}`);

    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    // Must NOT leak shareToken, IDs, or photo URLs
    expect(body).not.toContain(TOKEN_A_VALID);
    expect(body).not.toContain("inspectionId");
    expect(body).not.toContain("companyId");
    expect(body).not.toContain("photos");
    expect(body).not.toContain("findings");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. Expired token — always 404
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/share/summary/:token — expired token", () => {
  it("returns 404 when shareExpiresAt is in the past", async () => {
    const res = await request(app).get(`/api/share/summary/${TOKEN_A_EXPIRED}`);

    expect(res.status).toBe(404);
  });

  it("404 body uses the same uniform error message as an unknown token", async () => {
    const res = await request(app).get(`/api/share/summary/${TOKEN_A_EXPIRED}`);

    // The error text must be the same uniform message used for unknown tokens
    // so the caller cannot distinguish "token existed but expired" from
    // "token never existed" — preventing oracle attacks.
    expect(res.body.error).toBeTruthy();
    expect(res.body.error).toMatch(/invalid or has expired/i);

    const unknownRes = await request(app).get(`/api/share/summary/${"z".repeat(64)}`);
    expect(unknownRes.body.error).toBe(res.body.error);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. Unknown / random token — always 404
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/share/summary/:token — unknown or malformed token", () => {
  it("returns 404 for a random 64-char token that was never minted", async () => {
    const randomToken = "a".repeat(64);
    const res = await request(app).get(`/api/share/summary/${randomToken}`);

    expect(res.status).toBe(404);
  });

  it("returns 404 for a token that is too short to be valid", async () => {
    const res = await request(app).get("/api/share/summary/short");

    expect(res.status).toBe(404);
  });

  it("returns 404 for a draft summary's token (status is not approved)", async () => {
    // TOKEN_A_DRAFT is stored in the DB but the row has status='draft', so
    // the WHERE clause (status = 'approved') correctly excludes it.
    const res = await request(app).get(`/api/share/summary/${TOKEN_A_DRAFT}`);

    expect(res.status).toBe(404);
  });

  it("does not return 200 when the token segment is missing entirely", async () => {
    // Hitting the parent path without a token falls through (no matching route).
    // The exact status code varies by framework, but 200 must never be returned.
    const res = await request(app).get("/api/share/summary/");

    expect(res.status).not.toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. Cross-tenant replay — token from company A cannot serve company B's data
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/share/summary/:token — cross-tenant token replay is impossible", () => {
  it("company A's token returns company A's data, never company B's", async () => {
    const res = await request(app).get(`/api/share/summary/${TOKEN_A_VALID}`);

    expect(res.status).toBe(200);
    // Must be company A's summary, not company B's
    expect(res.body.summary).toBe("Company A approved summary body.");
    expect(res.body.companyName).toBe("Share Test Co A");
    expect(res.body.summary).not.toContain("Company B");
    expect(res.body.companyName).not.toContain("Share Test Co B");
  });

  it("company B's token returns company B's data, never company A's", async () => {
    const res = await request(app).get(`/api/share/summary/${TOKEN_B_VALID}`);

    expect(res.status).toBe(200);
    expect(res.body.summary).toBe("Company B approved summary body.");
    expect(res.body.companyName).toBe("Share Test Co B");
    expect(res.body.summary).not.toContain("Company A");
    expect(res.body.companyName).not.toContain("Share Test Co A");
  });

  it("neither token leaks the other company's site address", async () => {
    const resA = await request(app).get(`/api/share/summary/${TOKEN_A_VALID}`);
    const resB = await request(app).get(`/api/share/summary/${TOKEN_B_VALID}`);

    expect(resA.body.propertyAddress).toBe("1 Alpha Street");
    expect(resA.body.propertyAddress).not.toContain("Beta Boulevard");

    expect(resB.body.propertyAddress).toBe("2 Beta Boulevard");
    expect(resB.body.propertyAddress).not.toContain("Alpha Street");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. Revocation timing — share link is dead immediately after revoke (Task #437)
//
//    A manager revokes an approved summary's share link via the authenticated
//    POST /api/customer-summaries/:id/revoke endpoint. The very next request to
//    GET /api/share/summary/:token must return 404 — there must be no window
//    where the public endpoint continues to serve content for a revoked token
//    (e.g. due to caching or a missed WHERE clause).
// ═════════════════════════════════════════════════════════════════════════════

describe("GET /api/share/summary/:token — revoked token is 404 immediately", () => {
  // Each test in this section seeds its own summary so revocation state is
  // independent. The run-scoped suffix prevents global token collisions.
  let summaryId: number;
  let revokeToken: string;

  beforeAll(async () => {
    // Seed a fresh inspection for company A.
    const [insp] = await db
      .insert(inspectionsTable)
      .values({
        companyId: companyAId,
        siteAddress: "5 Revoke Court",
        technicianName: "Tech Revoke",
        clientName: "Client Revoke",
        pestTypes: ["termites"],
      })
      .returning();

    // Seed an approved summary with an active (non-expired) share token.
    revokeToken = `share-revoke-${run}`;
    const [summary] = await db
      .insert(customerSummariesTable)
      .values({
        companyId: companyAId,
        inspectionId: insp.id,
        status: "approved",
        body: "Approved body that will be revoked.",
        shareToken: revokeToken,
        approvedAt: new Date(),
        shareExpiresAt: FUTURE,
      })
      .returning();

    summaryId = summary.id;
  });

  it("the share link works before revocation", async () => {
    // Sanity-check: the token must be live before we revoke it.
    asUser(null);
    const res = await request(app).get(`/api/share/summary/${revokeToken}`);
    expect(res.status).toBe(200);
    expect(res.body.summary).toBe("Approved body that will be revoked.");
  });

  it("revoke returns 200 and clears the share token", async () => {
    asUser(SHARE_MGR_A);
    const res = await request(app).post(
      `/api/customer-summaries/${summaryId}/revoke`,
    );
    expect(res.status).toBe(200);
    expect(res.body.shareToken).toBeNull();
    asUser(null);
  });

  it("the public share endpoint returns 404 immediately after revocation — no cache window", async () => {
    // No delay. The very next request after revoke must be refused.
    asUser(null);
    const res = await request(app).get(`/api/share/summary/${revokeToken}`);
    expect(res.status).toBe(404);
  });

  it("the 404 body uses the same uniform error message as an unknown token", async () => {
    // Callers must not be able to distinguish "revoked" from "never existed".
    asUser(null);
    const revokedRes = await request(app).get(
      `/api/share/summary/${revokeToken}`,
    );
    const unknownRes = await request(app).get(
      `/api/share/summary/${"z".repeat(64)}`,
    );

    expect(revokedRes.status).toBe(404);
    expect(unknownRes.status).toBe(404);
    expect(revokedRes.body.error).toBe(unknownRes.body.error);
  });

  it("a second revoke call on the same summary returns 409 (no active link)", async () => {
    // Idempotency guard: revoking an already-revoked summary must fail clearly
    // rather than silently succeed with a misleading 200.
    asUser(SHARE_MGR_A);
    const res = await request(app).post(
      `/api/customer-summaries/${summaryId}/revoke`,
    );
    expect(res.status).toBe(409);
    asUser(null);
  });
});
