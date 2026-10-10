import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Label-correction integrity: manager edits submitted alongside an approve action
 * must be persisted in the DB and reflected in the training export.
 *
 * Covers:
 *  1. POST /records/:id/review with action="approve" + label corrections
 *     (category, subcategory, possiblePest, severity) updates the record fields.
 *  2. The approved record ends up with verificationLevel=4 and
 *     approvedForTraining=true.
 *  3. The corrected labels appear verbatim in GET /corrections/export (JSON).
 *  4. The corrected labels appear verbatim in GET /corrections/export?format=ndjson.
 *  5. A review with no label corrections still produces verificationLevel=4 /
 *     approvedForTraining=true (regression guard: labels-only path must not break
 *     the baseline approve path).
 */

const { authState } = vi.hoisted(() => ({
  authState: { userId: null as string | null },
}));

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    getAuth: () => authState,
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) =>
      next(),
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
    confidence: 0.72,
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MANAGER_CLERK_ID = "lc_manager_clerk_id";
const TECH_CLERK_ID = "lc_tech_clerk_id";

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
  const [row] = await db
    .insert(companiesTable)
    .values({ name, slug })
    .returning();
  return row.id;
}

beforeAll(async () => {
  companyId = await findOrCreateCompany("Label Corrections Co", "lc-corrections-co");

  // Clean slate so export totals are deterministic across test runs.
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
    { clerkUserId: MANAGER_CLERK_ID, role: "manager", companyId },
    { clerkUserId: TECH_CLERK_ID, role: "technician", companyId },
  ]);

  await db.insert(brandingProfilesTable).values({
    ...READYLOQ_DEFAULT_PROFILE,
    companyName: "Label Corrections Co",
    companyId,
    isDefault: true,
    isActive: true,
  });
});

beforeEach(() => {
  asUser(null);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a fresh pending record (L1). */
async function createRecord(): Promise<{ id: number; status: string; verificationLevel: number }> {
  asUser(MANAGER_CLERK_ID);
  const res = await request(app)
    .post("/api/intelligence-dataset/records")
    .send({
      imageUrl: `/objects/companies/${companyId}/uploads/lc-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`,
    });
  asUser(null);
  expect(res.status).toBe(201);
  return res.body;
}

/**
 * Technician confirms (L1→L2) then manager votes (→L3).
 */
async function promoteToL3(recordId: number) {
  asUser(TECH_CLERK_ID);
  const confirmed = await request(app)
    .patch(`/api/intelligence-dataset/records/${recordId}`)
    .send({ category: "pest", subcategory: "cockroach" });
  expect(confirmed.status).toBe(200);
  expect(confirmed.body.verificationLevel).toBe(2);

  asUser(MANAGER_CLERK_ID);
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

describe("approve with label corrections saves corrected fields", () => {
  it("updates category, subcategory, possiblePest, and severity in the response", async () => {
    const rec = await createRecord();
    await promoteToL3(rec.id);

    asUser(MANAGER_CLERK_ID);
    const res = await request(app)
      .post(`/api/intelligence-dataset/records/${rec.id}/review`)
      .send({
        action: "approve",
        category: "conducive_condition",
        subcategory: "moisture",
        possiblePest: "subterranean_termite",
        severity: "high",
        comment: "Reclassified after closer inspection",
      });

    expect(res.status).toBe(200);

    // Label corrections must be reflected in the response.
    expect(res.body.category).toBe("conducive_condition");
    expect(res.body.subcategory).toBe("moisture");
    expect(res.body.possiblePest).toBe("subterranean_termite");
    expect(res.body.severity).toBe("high");

    // Approve must set verificationLevel=4 and approvedForTraining=true.
    expect(res.body.verificationLevel).toBe(4);
    expect(res.body.approvedForTraining).toBe(true);
    expect(res.body.status).toBe("approved");
  });

  it("persists corrected fields in the DB (not just the API response)", async () => {
    const rec = await createRecord();
    await promoteToL3(rec.id);

    asUser(MANAGER_CLERK_ID);
    await request(app)
      .post(`/api/intelligence-dataset/records/${rec.id}/review`)
      .send({
        action: "approve",
        category: "entry_point",
        subcategory: "gap",
        possiblePest: "house_mouse",
        severity: "critical",
      })
      .expect(200);

    // Read the record back directly from the DB to confirm persistence.
    const [dbRow] = await db
      .select()
      .from(intelligenceRecordsTable)
      .where(eq(intelligenceRecordsTable.id, rec.id));

    expect(dbRow).toBeDefined();
    expect(dbRow.category).toBe("entry_point");
    expect(dbRow.subcategory).toBe("gap");
    expect(dbRow.possiblePest).toBe("house_mouse");
    expect(dbRow.severity).toBe("critical");
    expect(dbRow.verificationLevel).toBe(4);
    expect(dbRow.approvedForTraining).toBe(true);
    expect(dbRow.status).toBe("approved");
  });
});

describe("corrected labels appear in training export", () => {
  let correctedId: number;
  const CORRECTED_CATEGORY = "conducive_condition";
  const CORRECTED_PEST = "norway_rat";
  const CORRECTED_SEVERITY = "critical";

  beforeAll(async () => {
    // Clear company records so the export assertions are deterministic.
    await db
      .delete(intelligenceRecordsTable)
      .where(eq(intelligenceRecordsTable.companyId, companyId));

    const rec = await createRecord();
    await promoteToL3(rec.id);

    asUser(MANAGER_CLERK_ID);
    const reviewed = await request(app)
      .post(`/api/intelligence-dataset/records/${rec.id}/review`)
      .send({
        action: "approve",
        category: CORRECTED_CATEGORY,
        possiblePest: CORRECTED_PEST,
        severity: CORRECTED_SEVERITY,
      });
    expect(reviewed.status).toBe(200);
    correctedId = rec.id;
    asUser(null);
  });

  it("JSON export includes the record with corrected labels in groundTruth", async () => {
    asUser(MANAGER_CLERK_ID);
    const res = await request(app).get(
      "/api/intelligence-dataset/corrections/export",
    );
    expect(res.status).toBe(200);

    const exported = (res.body.records as Array<{
      id: number;
      groundTruth: { category: string | null; possiblePest: string | null };
      approvedForTraining: boolean;
      verificationLevel: number;
    }>).find((r) => r.id === correctedId);

    expect(exported).toBeDefined();
    expect(exported!.groundTruth.category).toBe(CORRECTED_CATEGORY);
    expect(exported!.groundTruth.possiblePest).toBe(CORRECTED_PEST);
    expect(exported!.approvedForTraining).toBe(true);
    expect(exported!.verificationLevel).toBe(4);

    // Export count matches array length (no phantom rows).
    expect(res.body.count).toBe(res.body.records.length);
  });

  it("NDJSON export includes the record with corrected labels", async () => {
    asUser(MANAGER_CLERK_ID);
    const res = await request(app).get(
      "/api/intelligence-dataset/corrections/export?format=ndjson",
    );
    expect(res.status).toBe(200);

    const lines = (res.text as string)
      .split("\n")
      .filter(Boolean)
      .map(
        (l) =>
          JSON.parse(l) as {
            id: number;
            groundTruth: { category: string | null; possiblePest: string | null };
            approvedForTraining: boolean;
            verificationLevel: number;
          },
      );

    const row = lines.find((r) => r.id === correctedId);
    expect(row).toBeDefined();
    expect(row!.groundTruth.category).toBe(CORRECTED_CATEGORY);
    expect(row!.groundTruth.possiblePest).toBe(CORRECTED_PEST);
    expect(row!.approvedForTraining).toBe(true);
    expect(row!.verificationLevel).toBe(4);
  });
});

describe("approve without label corrections still promotes to verificationLevel 4", () => {
  it("sets verificationLevel=4 and approvedForTraining=true with no label fields", async () => {
    const rec = await createRecord();
    await promoteToL3(rec.id);

    asUser(MANAGER_CLERK_ID);
    const res = await request(app)
      .post(`/api/intelligence-dataset/records/${rec.id}/review`)
      .send({ action: "approve" });

    expect(res.status).toBe(200);
    expect(res.body.verificationLevel).toBe(4);
    expect(res.body.approvedForTraining).toBe(true);
    expect(res.body.status).toBe("approved");

    // Original technician labels should be unchanged.
    expect(res.body.category).toBe("pest");
    expect(res.body.subcategory).toBe("cockroach");
  });
});
