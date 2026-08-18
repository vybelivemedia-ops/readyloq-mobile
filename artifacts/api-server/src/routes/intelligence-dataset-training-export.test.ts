import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Training-export safety: rejected findings must never appear in a training export.
 *
 * Covers:
 *  1. Rejecting a confirmed L3 record sets approvedForTraining=false and
 *     status='rejected' while leaving verificationLevel untouched.
 *  2. Rejected records are excluded from GET /corrections/export (both JSON and
 *     NDJSON formats).
 *  3. A technician cannot re-confirm a rejected record to sneak it back into the
 *     approved pool (the endpoint returns 409).
 */

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

vi.mock("../lib/intelligence-ai", () => ({
  generateAiPrediction: vi.fn(async () => ({
    category: "pest",
    subcategory: "cockroach",
    confidence: 0.85,
    tags: ["roach"],
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
  intelligenceRecordsTable,
  brandingProfilesTable,
  READYLOQ_DEFAULT_PROFILE,
} from "@workspace/db";
import { eq } from "drizzle-orm";

// ── User fixtures ─────────────────────────────────────────────────────────────

const MANAGER_ID = "te_manager_clerk_id";
const TECH_ID = "te_tech_clerk_id";

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

beforeAll(async () => {
  companyId = await findOrCreateCompany("Training Export Co", "te-export-co");

  // Clean slate for deterministic assertions.
  await db
    .delete(intelligenceRecordsTable)
    .where(eq(intelligenceRecordsTable.companyId, companyId));
  await db
    .delete(usersTable)
    .where(eq(usersTable.companyId, companyId));
  await db
    .delete(brandingProfilesTable)
    .where(eq(brandingProfilesTable.companyId, companyId));

  await db.insert(usersTable).values([
    { clerkUserId: MANAGER_ID, role: "manager", companyId },
    { clerkUserId: TECH_ID, role: "technician", companyId },
  ]);

  await db.insert(brandingProfilesTable).values({
    ...READYLOQ_DEFAULT_PROFILE,
    companyName: "Training Export Co",
    companyId,
    isDefault: true,
    isActive: true,
  });
});

beforeEach(() => {
  asUser(null);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a fresh pending record (L1) as the manager. */
async function createRecord() {
  asUser(MANAGER_ID);
  const res = await request(app)
    .post("/api/intelligence-dataset/records")
    .send({
      imageUrl: `/objects/companies/${companyId}/uploads/te-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`,
    });
  asUser(null);
  expect(res.status).toBe(201);
  return res.body as { id: number; status: string; verificationLevel: number };
}

/**
 * Confirm a record as the technician (L1→L2) and cast a second vote to reach L3.
 * Returns the record after it reaches L3.
 */
async function promoteToL3(recordId: number) {
  // First confirm: tech sets category, record climbs to L2 with 1 vote.
  asUser(TECH_ID);
  const confirmed = await request(app)
    .patch(`/api/intelligence-dataset/records/${recordId}`)
    .send({ category: "pest", subcategory: "cockroach" });
  expect(confirmed.status).toBe(200);
  expect(confirmed.body.verificationLevel).toBe(2);

  // Manager casts a second confirm vote → recompute pushes to L3.
  asUser(MANAGER_ID);
  const voted = await request(app)
    .post(`/api/intelligence-dataset/records/${recordId}/vote`)
    .send({ vote: "confirm" });
  expect(voted.status).toBe(200);
  expect(voted.body.verificationLevel).toBe(3);
  asUser(null);
  return voted.body as {
    id: number;
    status: string;
    verificationLevel: number;
    approvedForTraining: boolean | null;
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("rejecting a finding sets the correct fields", () => {
  it("sets approvedForTraining=false and status='rejected'; verificationLevel stays at 3", async () => {
    const rec = await createRecord();
    await promoteToL3(rec.id);

    // Manager rejects the L3 record.
    asUser(MANAGER_ID);
    const rejected = await request(app)
      .post(`/api/intelligence-dataset/records/${rec.id}/review`)
      .send({ action: "reject", comment: "Blurry image, unreliable label" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe("rejected");
    expect(rejected.body.approvedForTraining).toBe(false);
    // verificationLevel is intentionally NOT promoted by a rejection — the
    // manager's explicit quality verdict is captured by approvedForTraining=false
    // rather than by a numeric level change.
    expect(rejected.body.verificationLevel).toBe(3);
  });
});

describe("rejected records are excluded from the corrections export", () => {
  let rejectedId: number;
  let approvedId: number;

  beforeAll(async () => {
    // Clear the company's records so the export totals are deterministic.
    await db
      .delete(intelligenceRecordsTable)
      .where(eq(intelligenceRecordsTable.companyId, companyId));

    // Create and reject one record.
    const toReject = await createRecord();
    await promoteToL3(toReject.id);
    asUser(MANAGER_ID);
    const rejRes = await request(app)
      .post(`/api/intelligence-dataset/records/${toReject.id}/review`)
      .send({ action: "reject" });
    expect(rejRes.body.status).toBe("rejected");
    rejectedId = toReject.id;

    // Create and approve a second record so the export is non-empty.
    const toApprove = await createRecord();
    await promoteToL3(toApprove.id);
    asUser(MANAGER_ID);
    const appRes = await request(app)
      .post(`/api/intelligence-dataset/records/${toApprove.id}/review`)
      .send({ action: "approve" });
    expect(appRes.body.approvedForTraining).toBe(true);
    approvedId = toApprove.id;
    asUser(null);
  });

  it("JSON export excludes the rejected record and includes the approved one", async () => {
    asUser(MANAGER_ID);
    const res = await request(app).get(
      "/api/intelligence-dataset/corrections/export",
    );
    expect(res.status).toBe(200);

    const ids: number[] = res.body.records.map((r: { id: number }) => r.id);
    expect(ids).toContain(approvedId);
    expect(ids).not.toContain(rejectedId);
    // The export count matches the array length.
    expect(res.body.count).toBe(res.body.records.length);
  });

  it("NDJSON export also excludes the rejected record", async () => {
    asUser(MANAGER_ID);
    const res = await request(app).get(
      "/api/intelligence-dataset/corrections/export?format=ndjson",
    );
    expect(res.status).toBe(200);

    const lines = (res.text as string)
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { id: number; approvedForTraining: boolean });

    const ids = lines.map((r) => r.id);
    expect(ids).toContain(approvedId);
    expect(ids).not.toContain(rejectedId);
    // Every row in the export carries approvedForTraining=true.
    for (const row of lines) {
      expect(row.approvedForTraining).toBe(true);
    }
  });
});

describe("a manager cannot re-approve a rejected record without force", () => {
  it("returns 409 when a manager sends action:approve on a rejected record without force", async () => {
    const rec = await createRecord();
    await promoteToL3(rec.id);

    asUser(MANAGER_ID);
    // First manager rejects.
    const rejected = await request(app)
      .post(`/api/intelligence-dataset/records/${rec.id}/review`)
      .send({ action: "reject", comment: "Bad quality image" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.status).toBe("rejected");

    // Second manager (or accidental double-click) tries to approve without force.
    const reapprove = await request(app)
      .post(`/api/intelligence-dataset/records/${rec.id}/review`)
      .send({ action: "approve" });
    expect(reapprove.status).toBe(409);
    expect(reapprove.body.error).toMatch(/force/i);

    // Record remains rejected.
    const after = await request(app).get(
      `/api/intelligence-dataset/records/${rec.id}`,
    );
    expect(after.body.status).toBe("rejected");
    expect(after.body.approvedForTraining).toBe(false);
  });

  it("returns 409 when a manager sends action:expert_verify on a rejected record without force", async () => {
    const rec = await createRecord();
    await promoteToL3(rec.id);

    asUser(MANAGER_ID);
    await request(app)
      .post(`/api/intelligence-dataset/records/${rec.id}/review`)
      .send({ action: "reject" });

    const reapprove = await request(app)
      .post(`/api/intelligence-dataset/records/${rec.id}/review`)
      .send({ action: "expert_verify" });
    expect(reapprove.status).toBe(409);

    const after = await request(app).get(
      `/api/intelligence-dataset/records/${rec.id}`,
    );
    expect(after.body.status).toBe("rejected");
    expect(after.body.approvedForTraining).toBe(false);
  });

  it("allows re-approval when force:true is supplied", async () => {
    const rec = await createRecord();
    await promoteToL3(rec.id);

    asUser(MANAGER_ID);
    await request(app)
      .post(`/api/intelligence-dataset/records/${rec.id}/review`)
      .send({ action: "reject" });

    // Deliberate override with force flag.
    const override = await request(app)
      .post(`/api/intelligence-dataset/records/${rec.id}/review`)
      .send({ action: "approve", force: true });
    expect(override.status).toBe(200);
    expect(override.body.status).toBe("approved");
    expect(override.body.approvedForTraining).toBe(true);
  });
});

describe("a technician cannot re-confirm a rejected record", () => {
  it("returns 409 when a technician tries to confirm/correct a rejected record", async () => {
    const rec = await createRecord();
    await promoteToL3(rec.id);

    // Manager rejects.
    asUser(MANAGER_ID);
    const rejected = await request(app)
      .post(`/api/intelligence-dataset/records/${rec.id}/review`)
      .send({ action: "reject" });
    expect(rejected.body.status).toBe("rejected");

    // Technician attempts to re-confirm (PATCH) to override the rejection.
    asUser(TECH_ID);
    const reconfirm = await request(app)
      .patch(`/api/intelligence-dataset/records/${rec.id}`)
      .send({ category: "conducive_condition" });
    expect(reconfirm.status).toBe(409);

    // The rejection is untouched: still rejected, still not approved for training.
    asUser(MANAGER_ID);
    const after = await request(app).get(
      `/api/intelligence-dataset/records/${rec.id}`,
    );
    expect(after.body.status).toBe("rejected");
    expect(after.body.approvedForTraining).toBe(false);
    // Category was NOT overwritten by the rejected confirm attempt.
    expect(after.body.category).toBe("pest");
  });

  it("returns 409 when a technician tries to skip a rejected record", async () => {
    const rec = await createRecord();
    await promoteToL3(rec.id);

    asUser(MANAGER_ID);
    await request(app)
      .post(`/api/intelligence-dataset/records/${rec.id}/review`)
      .send({ action: "reject" });

    asUser(TECH_ID);
    const skip = await request(app).post(
      `/api/intelligence-dataset/records/${rec.id}/skip`,
    );
    expect(skip.status).toBe(409);
  });
});
