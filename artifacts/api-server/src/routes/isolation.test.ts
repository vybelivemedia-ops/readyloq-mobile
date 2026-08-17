import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Two-company isolation tests (Task #10).
 *
 * These exercise the tenant boundary end-to-end through the HTTP layer: two
 * fully separate companies (A and B) with their own owners. Company B must never
 * be able to read, modify, or even learn of the existence of Company A's data —
 * via list endpoints, direct ids, child writes, analytics aggregates, branding,
 * or storage object URLs. We also assert the underlying DB invariant: every
 * tenant row carries a non-null company_id belonging to its creator.
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

// Keep the real tenant-boundary logic (objectPathCompanyScope, ObjectNotFoundError)
// but stub the GCS-touching methods so serving never hits real object storage.
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

// Stub the real vision call: the contribution endpoint runs an AI suggestion on
// create. We pin a deterministic prediction so the pipeline + agreement-rate math
// is reproducible and no test ever reaches the live model.
vi.mock("../lib/intelligence-ai", () => ({
  generateAiPrediction: vi.fn(async () => ({
    category: "pest",
    subcategory: "cockroach",
    confidence: 0.8,
    tags: ["roach", "kitchen"],
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
  inspectionMediaTable,
  analysisResultsTable,
  reportsTable,
  propertyProfilesTable,
  propertyNotesTable,
  datasetImagesTable,
  brandingProfilesTable,
  quizzesTable,
  trainingScoresTable,
  intelligenceRecordsTable,
  intelligenceTagsTable,
  intelligenceReviewsTable,
  intelligenceVotesTable,
  inspectionScorecardsTable,
  baitStationsTable,
  READYLOQ_DEFAULT_PROFILE,
} from "@workspace/db";
import { eq, isNull, or } from "drizzle-orm";

const OWNER_A_ID = "iso_owner_a_clerk_id";
const OWNER_B_ID = "iso_owner_b_clerk_id";
const TECH_A_ID = "iso_tech_a_clerk_id";

let companyAId: number;
let companyBId: number;
let platformCompanyId: number;

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
  await db.insert(brandingProfilesTable).values({
    ...READYLOQ_DEFAULT_PROFILE,
    companyName,
    companyId,
    isDefault: true,
    isActive: true,
  });
}

beforeAll(async () => {
  companyAId = await findOrCreateCompany("Isolation Co A", "iso-co-a");
  companyBId = await findOrCreateCompany("Isolation Co B", "iso-co-b");
  platformCompanyId = await findOrCreateCompany("ReadyLoq Platform", "platform");

  // Reset all tenant data. Deleting inspections cascades to media/analysis/
  // reports; deleting quizzes cascades to training_scores; deleting intelligence
  // records cascades to its tags/reviews/votes.
  await db.delete(inspectionsTable);
  await db.delete(quizzesTable);
  await db.delete(propertyProfilesTable);
  await db.delete(propertyNotesTable);
  await db.delete(datasetImagesTable);
  await db.delete(intelligenceRecordsTable);
  await db.delete(brandingProfilesTable);
  await db.delete(usersTable);

  // Sharing is opt-in; reset to the OFF default so the settings test starts clean
  // even across reruns against the same database.
  await db.update(companiesTable).set({ intelligenceSharingEnabled: false });

  await db.insert(usersTable).values([
    { clerkUserId: OWNER_A_ID, role: "owner", companyId: companyAId },
    { clerkUserId: OWNER_B_ID, role: "owner", companyId: companyBId },
    { clerkUserId: TECH_A_ID, role: "technician", companyId: companyAId },
  ]);

  await seedActiveBranding(platformCompanyId, "ReadyLoq");
  await seedActiveBranding(companyAId, "Company A Brand");
  await seedActiveBranding(companyBId, "Company B Brand");
});

beforeEach(() => {
  asUser(null);
});

/** Create an inspection as the given owner and return the response body. */
async function createInspection(ownerId: string, siteAddress: string) {
  asUser(ownerId);
  const res = await request(app)
    .post("/api/inspections")
    .send({ siteAddress, technicianName: "Tech", clientName: "Client", pestTypes: ["ants"] });
  asUser(null);
  expect(res.status).toBe(201);
  return res.body;
}

/**
 * Contribute an intelligence record as the given user. The image must live under
 * the caller's company namespace (the create endpoint enforces this), and the
 * mocked vision model attaches a deterministic AI suggestion.
 */
async function createIntelRecord(userId: string, companyId: number) {
  asUser(userId);
  const res = await request(app)
    .post("/api/intelligence-dataset/records")
    .send({
      imageUrl: `/objects/companies/${companyId}/uploads/intel-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`,
    });
  asUser(null);
  expect(res.status).toBe(201);
  return res.body;
}

describe("inspections are isolated per company", () => {
  it("lists only the caller company's inspections", async () => {
    const a = await createInspection(OWNER_A_ID, "100 A Street");
    const b = await createInspection(OWNER_B_ID, "200 B Street");

    asUser(OWNER_A_ID);
    const listA = await request(app).get("/api/inspections");
    expect(listA.status).toBe(200);
    const idsA = listA.body.map((r: { id: number }) => r.id);
    expect(idsA).toContain(a.id);
    expect(idsA).not.toContain(b.id);

    asUser(OWNER_B_ID);
    const listB = await request(app).get("/api/inspections");
    const idsB = listB.body.map((r: { id: number }) => r.id);
    expect(idsB).toContain(b.id);
    expect(idsB).not.toContain(a.id);
  });

  it("404s when reading another company's inspection by id", async () => {
    const a = await createInspection(OWNER_A_ID, "101 A Street");
    asUser(OWNER_B_ID);
    const res = await request(app).get(`/api/inspections/${a.id}`);
    expect(res.status).toBe(404);
  });

  it("cannot patch another company's inspection (404, unchanged)", async () => {
    const a = await createInspection(OWNER_A_ID, "102 A Street");
    asUser(OWNER_B_ID);
    const patch = await request(app)
      .patch(`/api/inspections/${a.id}`)
      .send({ status: "completed", notes: "hijacked" });
    expect(patch.status).toBe(404);

    asUser(OWNER_A_ID);
    const after = await request(app).get(`/api/inspections/${a.id}`);
    expect(after.body.status).toBe("pending");
    expect(after.body.notes).not.toBe("hijacked");
  });

  it("cannot delete another company's inspection (no-op, row survives)", async () => {
    const a = await createInspection(OWNER_A_ID, "103 A Street");
    asUser(OWNER_B_ID);
    const del = await request(app).delete(`/api/inspections/${a.id}`);
    expect(del.status).toBe(204); // scoped delete simply matches nothing

    asUser(OWNER_A_ID);
    const after = await request(app).get(`/api/inspections/${a.id}`);
    expect(after.status).toBe(200);
  });

  it("cannot attach media to another company's inspection (404)", async () => {
    const a = await createInspection(OWNER_A_ID, "104 A Street");
    asUser(OWNER_B_ID);
    const res = await request(app)
      .post(`/api/inspections/${a.id}/media`)
      .send({ mediaType: "photo", url: "https://x/y.jpg" });
    expect(res.status).toBe(404);
  });
});

describe("analysis results are isolated per company", () => {
  it("cannot create an analysis against another company's inspection (404)", async () => {
    const a = await createInspection(OWNER_A_ID, "110 A Street");
    asUser(OWNER_B_ID);
    const res = await request(app)
      .post("/api/analysis")
      .send({ inspectionId: a.id, findings: [], recommendations: [] });
    expect(res.status).toBe(404);
  });

  it("404s on direct-id read and excludes cross-company rows from the list", async () => {
    const a = await createInspection(OWNER_A_ID, "111 A Street");
    asUser(OWNER_A_ID);
    const created = await request(app)
      .post("/api/analysis")
      .send({ inspectionId: a.id, findings: [], recommendations: [], overallConfidence: 80 });
    expect(created.status).toBe(201);

    asUser(OWNER_B_ID);
    const read = await request(app).get(`/api/analysis/${created.body.id}`);
    expect(read.status).toBe(404);
    const list = await request(app).get("/api/analysis");
    const ids = list.body.map((r: { id: number }) => r.id);
    expect(ids).not.toContain(created.body.id);
  });
});

describe("reports are isolated per company", () => {
  it("cannot generate a report from another company's inspection (404)", async () => {
    const a = await createInspection(OWNER_A_ID, "120 A Street");
    asUser(OWNER_B_ID);
    const res = await request(app)
      .post("/api/reports")
      .send({ inspectionId: a.id, title: "Stolen Report" });
    expect(res.status).toBe(404);
  });

  it("404s on direct-id read and excludes cross-company rows from the list", async () => {
    const a = await createInspection(OWNER_A_ID, "121 A Street");
    asUser(OWNER_A_ID);
    const created = await request(app)
      .post("/api/reports")
      .send({ inspectionId: a.id, title: "Company A Report" });
    expect(created.status).toBe(201);

    asUser(OWNER_B_ID);
    const read = await request(app).get(`/api/reports/${created.body.id}`);
    expect(read.status).toBe(404);
    const list = await request(app).get("/api/reports");
    const ids = list.body.map((r: { id: number }) => r.id);
    expect(ids).not.toContain(created.body.id);
  });
});

describe("properties are isolated per company", () => {
  it("only surfaces the caller company's properties and notes", async () => {
    await createInspection(OWNER_A_ID, "55 Shared Road");
    await createInspection(OWNER_B_ID, "55 Shared Road");

    // Both companies happen to use the same street, but the address feed must
    // never bleed one company's notes/visits into the other. Resolve the
    // normalized address key via the lookup endpoint, then attach a note as A.
    asUser(OWNER_A_ID);
    const lookupA = await request(app)
      .get("/api/properties/lookup")
      .query({ siteAddress: "55 Shared Road" });
    expect(lookupA.body.matchStatus).toBe("exact");
    expect(lookupA.body.feed.visitHistory).toHaveLength(1);
    const addressKey: string = lookupA.body.feed.addressKey;

    const noteA = await request(app)
      .post(`/api/properties/${encodeURIComponent(addressKey)}/notes`)
      .send({ note: "A private note" });
    expect(noteA.status).toBe(201);

    asUser(OWNER_B_ID);
    const lookupB = await request(app)
      .get("/api/properties/lookup")
      .query({ siteAddress: "55 Shared Road" });
    expect(lookupB.body.matchStatus).toBe("exact");
    const feedB = lookupB.body.feed;
    const noteTexts = feedB.notes.map((n: { note: string }) => n.note);
    expect(noteTexts).not.toContain("A private note");
    // B sees only its own single visit at this address, not A's.
    expect(feedB.visitHistory).toHaveLength(1);
  });
});

describe("dataset images are isolated per company", () => {
  it("lists and counts only the caller company's images", async () => {
    await db.insert(datasetImagesTable).values([
      {
        companyId: companyAId,
        category: "pest_activity",
        title: "A image",
        imageUrl: "https://x/a.jpg",
        pestType: "ants",
      },
      {
        companyId: companyBId,
        category: "pest_activity",
        title: "B image",
        imageUrl: "https://x/b.jpg",
        pestType: "roaches",
      },
    ]);

    asUser(OWNER_A_ID);
    const list = await request(app).get("/api/dataset");
    expect(list.status).toBe(200);
    const titles = list.body.items.map((i: { title: string }) => i.title);
    expect(titles).toContain("A image");
    expect(titles).not.toContain("B image");
    expect(list.body.total).toBe(1);
  });
});

describe("analytics aggregate only the caller company", () => {
  it("dashboard totals reflect a single company's inspections", async () => {
    // Fresh slate for a deterministic count.
    await db.delete(inspectionsTable);
    await createInspection(OWNER_A_ID, "300 A Ave");
    await createInspection(OWNER_A_ID, "301 A Ave");
    await createInspection(OWNER_B_ID, "300 B Ave");

    asUser(OWNER_A_ID);
    const dashA = await request(app).get("/api/analytics/dashboard");
    expect(dashA.status).toBe(200);
    expect(dashA.body.totalInspections).toBe(2);

    asUser(OWNER_B_ID);
    const dashB = await request(app).get("/api/analytics/dashboard");
    expect(dashB.body.totalInspections).toBe(1);
  });
});

describe("branding is isolated per company", () => {
  it("activating a profile in one company never changes another's brand", async () => {
    asUser(OWNER_A_ID);
    const created = await request(app)
      .post("/api/branding/profiles")
      .send({ name: "A New Brand", companyName: "A New Brand" });
    expect(created.status).toBe(201);
    const activate = await request(app).post(
      `/api/branding/profiles/${created.body.id}/activate`,
    );
    expect(activate.status).toBe(200);

    // A now sees its new brand...
    const companyA = await request(app).get("/api/branding/company");
    expect(companyA.body.companyName).toBe("A New Brand");

    // ...B is untouched...
    asUser(OWNER_B_ID);
    const companyB = await request(app).get("/api/branding/company");
    expect(companyB.body.companyName).toBe("Company B Brand");

    // ...and the public pre-login (platform) brand is untouched.
    const publicBrand = await request(app).get("/api/branding/active");
    expect(publicBrand.body.companyName).toBe("ReadyLoq");
  });

  it("a manager cannot fetch or mutate another company's branding directly", async () => {
    asUser(OWNER_A_ID);
    const list = await request(app).get("/api/branding/profiles");
    const aProfileId = list.body[0].id;

    asUser(OWNER_B_ID);
    const read = await request(app).get(`/api/branding/profiles/${aProfileId}`);
    expect(read.status).toBe(404);
    const patch = await request(app)
      .patch(`/api/branding/profiles/${aProfileId}`)
      .send({ companyName: "hijacked" });
    expect(patch.status).toBe(404);
  });
});

describe("storage object URLs cannot cross companies", () => {
  it("serves an object to a member of its owning company", async () => {
    asUser(OWNER_A_ID);
    const res = await request(app).get(
      `/api/storage/objects/companies/${companyAId}/uploads/file-1`,
    );
    expect(res.status).toBe(200);
  });

  it("404s when another company requests the object", async () => {
    asUser(OWNER_B_ID);
    const res = await request(app).get(
      `/api/storage/objects/companies/${companyAId}/uploads/file-1`,
    );
    expect(res.status).toBe(404);
  });

  it("404s legacy (un-namespaced) objects for a non-legacy company", async () => {
    asUser(OWNER_A_ID);
    const res = await request(app).get("/api/storage/objects/uploads/legacy-file");
    expect(res.status).toBe(404);
  });

  it("requires authentication to serve a private object", async () => {
    asUser(null);
    const res = await request(app).get(
      `/api/storage/objects/companies/${companyAId}/uploads/file-1`,
    );
    expect(res.status).toBe(401);
  });
});

describe("intelligence dataset is isolated per company", () => {
  it("lists only the caller company's records", async () => {
    const a = await createIntelRecord(OWNER_A_ID, companyAId);
    const b = await createIntelRecord(OWNER_B_ID, companyBId);

    asUser(OWNER_A_ID);
    const listA = await request(app).get("/api/intelligence-dataset/records");
    expect(listA.status).toBe(200);
    const idsA = listA.body.items.map((r: { id: number }) => r.id);
    expect(idsA).toContain(a.id);
    expect(idsA).not.toContain(b.id);

    asUser(OWNER_B_ID);
    const listB = await request(app).get("/api/intelligence-dataset/records");
    const idsB = listB.body.items.map((r: { id: number }) => r.id);
    expect(idsB).toContain(b.id);
    expect(idsB).not.toContain(a.id);
  });

  it("attaches an AI suggestion on contribution (pending, level 1)", async () => {
    const a = await createIntelRecord(OWNER_A_ID, companyAId);
    expect(a.status).toBe("pending");
    expect(a.verificationLevel).toBe(1);
    expect(a.aiPrediction.category).toBe("pest");
    expect(a.aiConfidence).toBeCloseTo(0.8);
    // AI-sourced tags are persisted as a training signal.
    const aiTags = a.tags.filter((t: { source: string }) => t.source === "ai");
    expect(aiTags.length).toBeGreaterThan(0);
  });

  it("rejects an image that is not under the caller's company namespace", async () => {
    asUser(OWNER_B_ID);
    const res = await request(app)
      .post("/api/intelligence-dataset/records")
      .send({ imageUrl: `/objects/companies/${companyAId}/uploads/steal-me` });
    expect(res.status).toBe(400);
  });

  it("404s when reading another company's record by id", async () => {
    const a = await createIntelRecord(OWNER_A_ID, companyAId);
    asUser(OWNER_B_ID);
    const res = await request(app).get(`/api/intelligence-dataset/records/${a.id}`);
    expect(res.status).toBe(404);
  });

  it("cannot confirm another company's record (404)", async () => {
    const a = await createIntelRecord(OWNER_A_ID, companyAId);
    asUser(OWNER_B_ID);
    const res = await request(app)
      .patch(`/api/intelligence-dataset/records/${a.id}`)
      .send({ category: "pest" });
    expect(res.status).toBe(404);
  });

  it("cannot vote on another company's record (404)", async () => {
    const a = await createIntelRecord(OWNER_A_ID, companyAId);
    asUser(OWNER_B_ID);
    const res = await request(app)
      .post(`/api/intelligence-dataset/records/${a.id}/vote`)
      .send({ vote: "confirm" });
    expect(res.status).toBe(404);
  });

  it("cannot skip another company's record (404)", async () => {
    const a = await createIntelRecord(OWNER_A_ID, companyAId);
    asUser(OWNER_B_ID);
    const res = await request(app).post(
      `/api/intelligence-dataset/records/${a.id}/skip`,
    );
    expect(res.status).toBe(404);
  });

  it("a manager cannot review another company's record (404)", async () => {
    const a = await createIntelRecord(OWNER_A_ID, companyAId);
    asUser(OWNER_B_ID); // owner of B outranks manager, but the row is A's
    const res = await request(app)
      .post(`/api/intelligence-dataset/records/${a.id}/review`)
      .send({ action: "approve" });
    expect(res.status).toBe(404);
  });
});

describe("intelligence verification pipeline", () => {
  it("climbs L1 → L2 → L3 → L4 through confirm, multi-tech votes, and approval", async () => {
    const rec = await createIntelRecord(OWNER_A_ID, companyAId);
    expect(rec.verificationLevel).toBe(1);

    // Technician confirms agreeing with the AI ⇒ not corrected, status confirmed.
    asUser(OWNER_A_ID);
    const confirmed = await request(app)
      .patch(`/api/intelligence-dataset/records/${rec.id}`)
      .send({
        category: "pest",
        subcategory: "cockroach",
        severity: "moderate",
        treatmentOutcome: "pending",
        daysUntilFollowup: 14,
        tags: ["follow-up"],
      });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe("confirmed");
    expect(confirmed.body.verificationLevel).toBe(2);
    expect(confirmed.body.aiCorrected).toBe(false);
    expect(confirmed.body.confirmVotes).toBe(1); // implicit vote from confirmer
    expect(confirmed.body.treatmentOutcome).toBe("pending");
    expect(confirmed.body.daysUntilFollowup).toBe(14);

    // A second technician confirms ⇒ multi-tech agreement promotes to L3.
    asUser(TECH_A_ID);
    const voted = await request(app)
      .post(`/api/intelligence-dataset/records/${rec.id}/vote`)
      .send({ vote: "confirm" });
    expect(voted.status).toBe(200);
    expect(voted.body.confirmVotes).toBe(2);
    expect(voted.body.verificationLevel).toBe(3);

    // Manager approves ⇒ L4, eligible for training.
    asUser(OWNER_A_ID);
    const approved = await request(app)
      .post(`/api/intelligence-dataset/records/${rec.id}/review`)
      .send({ action: "approve", comment: "looks right" });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");
    expect(approved.body.verificationLevel).toBe(4);
    expect(approved.body.approvedForTraining).toBe(true);
  });

  it("a record beyond the default page size is still reachable and approvable", async () => {
    // Build a queue larger than the API's default page size (20).
    const recs = [];
    for (let i = 0; i < 22; i++) {
      recs.push(await createIntelRecord(OWNER_A_ID, companyAId));
    }
    asUser(OWNER_A_ID);
    for (const r of recs) {
      const confirmed = await request(app)
        .patch(`/api/intelligence-dataset/records/${r.id}`)
        .send({ category: "pest", subcategory: "cockroach" });
      expect(confirmed.status).toBe(200);
    }

    // Page 1 of the pending queue holds only the default 20 records.
    const page1 = await request(app).get(
      "/api/intelligence-dataset/records?status=confirmed&page=1&limit=20",
    );
    expect(page1.status).toBe(200);
    expect(page1.body.total).toBeGreaterThanOrEqual(22);
    expect(page1.body.items.length).toBe(20);

    // Page 2 exposes the remainder; approve a record found there.
    const page2 = await request(app).get(
      "/api/intelligence-dataset/records?status=confirmed&page=2&limit=20",
    );
    expect(page2.status).toBe(200);
    expect(page2.body.items.length).toBeGreaterThanOrEqual(2);
    const target = page2.body.items[0];

    const approved = await request(app)
      .post(`/api/intelligence-dataset/records/${target.id}/review`)
      .send({ action: "approve" });
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");
    expect(approved.body.verificationLevel).toBe(4);
    expect(approved.body.approvedForTraining).toBe(true);

    // It leaves the pending queue.
    const after = await request(app).get(
      "/api/intelligence-dataset/records?status=confirmed&page=1&limit=100",
    );
    expect(
      after.body.items.map((r: { id: number }) => r.id),
    ).not.toContain(target.id);
  });

  it("expert-verify promotes an approved record to L5", async () => {
    const rec = await createIntelRecord(OWNER_A_ID, companyAId);
    asUser(OWNER_A_ID);
    await request(app)
      .patch(`/api/intelligence-dataset/records/${rec.id}`)
      .send({ category: "pest" });
    const expert = await request(app)
      .post(`/api/intelligence-dataset/records/${rec.id}/review`)
      .send({ action: "expert_verify" });
    expect(expert.status).toBe(200);
    expect(expert.body.verificationLevel).toBe(5);
    expect(expert.body.approvedForTraining).toBe(true);
  });
});

describe("intelligence workflow guards", () => {
  it("accepts a display-prefixed (/api/storage) object URL from the upload UI", async () => {
    asUser(OWNER_A_ID);
    const res = await request(app)
      .post("/api/intelligence-dataset/records")
      .send({
        imageUrl: `/api/storage/objects/companies/${companyAId}/uploads/ui-${Date.now()}`,
      });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    expect(res.body.verificationLevel).toBe(1);
  });

  it("rejects a display-prefixed URL pointing at another company's namespace", async () => {
    asUser(OWNER_B_ID);
    const res = await request(app)
      .post("/api/intelligence-dataset/records")
      .send({
        imageUrl: `/api/storage/objects/companies/${companyAId}/uploads/steal`,
      });
    expect(res.status).toBe(400);
  });

  it("locks technician confirm/correct once a record is manager-approved (409)", async () => {
    const rec = await createIntelRecord(OWNER_A_ID, companyAId);
    asUser(OWNER_A_ID);
    await request(app)
      .patch(`/api/intelligence-dataset/records/${rec.id}`)
      .send({ category: "pest" });
    await request(app)
      .post(`/api/intelligence-dataset/records/${rec.id}/review`)
      .send({ action: "approve" });

    // A technician must not be able to re-confirm and silently downgrade it.
    asUser(TECH_A_ID);
    const reconfirm = await request(app)
      .patch(`/api/intelligence-dataset/records/${rec.id}`)
      .send({ category: "conducive_condition" });
    expect(reconfirm.status).toBe(409);

    // The manager verification is untouched.
    asUser(OWNER_A_ID);
    const after = await request(app).get(
      `/api/intelligence-dataset/records/${rec.id}`,
    );
    expect(after.body.status).toBe("approved");
    expect(after.body.verificationLevel).toBe(4);
    expect(after.body.approvedForTraining).toBe(true);
    expect(after.body.category).toBe("pest");
  });

  it("locks skip once a record is manager-approved (409)", async () => {
    const rec = await createIntelRecord(OWNER_A_ID, companyAId);
    asUser(OWNER_A_ID);
    await request(app)
      .patch(`/api/intelligence-dataset/records/${rec.id}`)
      .send({ category: "pest" });
    await request(app)
      .post(`/api/intelligence-dataset/records/${rec.id}/review`)
      .send({ action: "expert_verify" });

    asUser(TECH_A_ID);
    const skip = await request(app).post(
      `/api/intelligence-dataset/records/${rec.id}/skip`,
    );
    expect(skip.status).toBe(409);
  });
});

describe("intelligence role enforcement", () => {
  it("a technician cannot toggle the sharing setting (manager+ only)", async () => {
    asUser(TECH_A_ID);
    const res = await request(app)
      .patch("/api/intelligence-dataset/settings")
      .send({ sharingEnabled: true });
    expect(res.status).toBe(403);
  });

  it("a technician cannot run a manager review", async () => {
    const rec = await createIntelRecord(OWNER_A_ID, companyAId);
    asUser(TECH_A_ID);
    const res = await request(app)
      .post(`/api/intelligence-dataset/records/${rec.id}/review`)
      .send({ action: "approve" });
    expect(res.status).toBe(403);
  });
});

describe("intelligence sharing setting is opt-in and isolated", () => {
  it("defaults OFF, flips for one company, and never leaks to another", async () => {
    asUser(OWNER_A_ID);
    const initial = await request(app).get("/api/intelligence-dataset/settings");
    expect(initial.body.sharingEnabled).toBe(false);

    const enabled = await request(app)
      .patch("/api/intelligence-dataset/settings")
      .send({ sharingEnabled: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body.sharingEnabled).toBe(true);

    const afterA = await request(app).get("/api/intelligence-dataset/settings");
    expect(afterA.body.sharingEnabled).toBe(true);

    asUser(OWNER_B_ID);
    const afterB = await request(app).get("/api/intelligence-dataset/settings");
    expect(afterB.body.sharingEnabled).toBe(false);
  });
});

describe("intelligence analytics aggregate only the caller company", () => {
  it("computes agreement / correction / accuracy rates from a controlled set", async () => {
    // Deterministic slate scoped to company A.
    await db.delete(intelligenceRecordsTable);

    const r1 = await createIntelRecord(OWNER_A_ID, companyAId);
    const r2 = await createIntelRecord(OWNER_A_ID, companyAId);
    await createIntelRecord(OWNER_B_ID, companyBId); // noise for the other tenant

    // r1: technician agrees with the AI (pest/cockroach) → not corrected.
    asUser(OWNER_A_ID);
    await request(app)
      .patch(`/api/intelligence-dataset/records/${r1.id}`)
      .send({ category: "pest", subcategory: "cockroach" });
    // r2: technician corrects the AI to a different category → corrected.
    await request(app)
      .patch(`/api/intelligence-dataset/records/${r2.id}`)
      .send({ category: "conducive_condition" });
    // Manager approves r1 → ground truth for AI accuracy.
    await request(app)
      .post(`/api/intelligence-dataset/records/${r1.id}/review`)
      .send({ action: "approve" });

    const analytics = await request(app).get(
      "/api/intelligence-dataset/analytics",
    );
    expect(analytics.status).toBe(200);
    expect(analytics.body.totalRecords).toBe(2); // B's record excluded
    expect(analytics.body.aiVsTechnicianAgreementRate).toBe(50);
    expect(analytics.body.technicianCorrectionRate).toBe(50);
    expect(analytics.body.approvedRecords).toBe(1);
    expect(analytics.body.aiAccuracyRate).toBe(100); // approved r1: AI pest == final pest
    expect(analytics.body.pendingReview).toBe(1); // r2 still confirmed/awaiting

    asUser(OWNER_B_ID);
    const analyticsB = await request(app).get(
      "/api/intelligence-dataset/analytics",
    );
    expect(analyticsB.body.totalRecords).toBe(1);
  });
});

describe("executive inspections drill-down is isolated per company", () => {
  /** Seed a minimal scorecard row directly so we can test the endpoint without
   *  running the full analysis pipeline. */
  async function seedScorecard(
    companyId: number,
    inspectionId: number,
    riskLevel: "critical" | "high" | "medium" | "low",
  ) {
    await db.insert(inspectionScorecardsTable).values({
      companyId,
      inspectionId,
      technicianName: "Seeded Tech",
      qualityScore: riskLevel === "critical" ? 25 : riskLevel === "high" ? 45 : riskLevel === "medium" ? 65 : 85,
      riskScore: riskLevel === "critical" ? 90 : riskLevel === "high" ? 70 : riskLevel === "medium" ? 50 : 20,
      riskLevel,
      findingsCount: 3,
      photosAnalyzed: 5,
      components: { photoCoverage: 80, evidenceQuality: 70, avgConfidence: 60, recommendationCoverage: 50 },
      missedOpportunities: [],
    });
  }

  let inspAId: number;
  let inspBId: number;

  beforeAll(async () => {
    // Clean up any scorecards left by other suites.
    await db.delete(inspectionScorecardsTable);

    // Create one inspection per company.
    const aBody = await createInspection(OWNER_A_ID, "700 Exec A Street");
    const bBody = await createInspection(OWNER_B_ID, "700 Exec B Street");
    inspAId = aBody.id;
    inspBId = bBody.id;

    // Seed scorecards: A is critical, B is high.
    await seedScorecard(companyAId, inspAId, "critical");
    await seedScorecard(companyBId, inspBId, "high");
  });

  it("returns 401 when unauthenticated", async () => {
    asUser(null);
    const res = await request(app).get("/api/executive/inspections?riskLevel=critical");
    expect(res.status).toBe(401);
  });

  it("returns 403 when called by a technician (owner-only route)", async () => {
    asUser(TECH_A_ID);
    const res = await request(app).get("/api/executive/inspections?riskLevel=critical");
    expect(res.status).toBe(403);
  });

  it("returns 400 for a missing riskLevel param", async () => {
    asUser(OWNER_A_ID);
    const res = await request(app).get("/api/executive/inspections");
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid riskLevel value", async () => {
    asUser(OWNER_A_ID);
    const res = await request(app).get("/api/executive/inspections?riskLevel=extreme");
    expect(res.status).toBe(400);
  });

  it("returns only the calling company's inspections at the requested level", async () => {
    asUser(OWNER_A_ID);
    const res = await request(app).get("/api/executive/inspections?riskLevel=critical");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.riskLevel).toBe("critical");
    const ids = res.body.inspections.map((r: { inspectionId: number }) => r.inspectionId);
    // Company A's critical inspection is present.
    expect(ids).toContain(inspAId);
    // Company B's inspection is NOT present (different tenant and different risk level).
    expect(ids).not.toContain(inspBId);
  });

  it("company B sees its own high-risk inspection but not company A's critical one", async () => {
    asUser(OWNER_B_ID);
    const res = await request(app).get("/api/executive/inspections?riskLevel=high");
    expect(res.status).toBe(200);
    const ids = res.body.inspections.map((r: { inspectionId: number }) => r.inspectionId);
    expect(ids).toContain(inspBId);
    expect(ids).not.toContain(inspAId);
  });

  it("company A gets an empty list when querying a level it has no scorecards for", async () => {
    asUser(OWNER_A_ID);
    const res = await request(app).get("/api/executive/inspections?riskLevel=low");
    expect(res.status).toBe(200);
    expect(res.body.inspections).toHaveLength(0);
  });

  it("response rows include required fields", async () => {
    asUser(OWNER_A_ID);
    const res = await request(app).get("/api/executive/inspections?riskLevel=critical");
    expect(res.status).toBe(200);
    const row = res.body.inspections[0];
    expect(row).toHaveProperty("inspectionId");
    expect(row).toHaveProperty("siteAddress");
    expect(row).toHaveProperty("technicianName");
    expect(row).toHaveProperty("qualityScore");
    expect(row).toHaveProperty("riskLevel", "critical");
    expect(row).toHaveProperty("riskScore");
    expect(row).toHaveProperty("scoredAt");
    expect(row.siteAddress).toBe("700 Exec A Street");
  });

  it("does not surface another company's siteAddress when a cross-tenant inspectionId is seeded", async () => {
    // Create a fresh company B inspection that has no scorecard yet, so we can
    // insert a poisoned scorecard without hitting the unique constraint on inspection_id.
    const bExtra = await createInspection(OWNER_B_ID, "800 Exec B Leaked Street");
    const inspBExtraId: number = bExtra.id;

    // Simulate a data-migration bug: a scorecard row is written for company A
    // but its inspectionId points to an inspection that belongs to company B.
    // Without the companyId guard on the join, this would expose
    // "800 Exec B Leaked Street" to company A's owner.
    await db.insert(inspectionScorecardsTable).values({
      companyId: companyAId,      // scorecard owned by company A
      inspectionId: inspBExtraId, // but the inspection belongs to company B
      technicianName: "Poisoned Tech",
      qualityScore: 65,
      riskScore: 50,
      riskLevel: "medium",
      findingsCount: 1,
      photosAnalyzed: 1,
      components: { photoCoverage: 50, evidenceQuality: 50, avgConfidence: 50, recommendationCoverage: 50 },
      missedOpportunities: [],
    });

    asUser(OWNER_A_ID);
    const res = await request(app).get("/api/executive/inspections?riskLevel=medium");
    expect(res.status).toBe(200);

    // The poisoned scorecard must not expose company B's site address.
    // With the companyId constraint on the join, the row is excluded entirely.
    const addresses = res.body.inspections.map(
      (r: { siteAddress: string | null }) => r.siteAddress,
    );
    expect(addresses).not.toContain("800 Exec B Leaked Street");
  });
});

describe("executive inspections technicianName filter cannot cross tenant boundary", () => {
  /**
   * Both companies have a technician whose name is identical ("Shared Tech").
   * Filtering by that name as company A must only surface company A's rows.
   */

  const SHARED_TECH = "Shared Tech";

  let inspSharedAId: number;
  let inspSharedBId: number;

  async function seedScorecardForTech(
    companyId: number,
    inspectionId: number,
    techName: string,
    riskLevel: "critical" | "high" | "medium" | "low",
  ) {
    await db.insert(inspectionScorecardsTable).values({
      companyId,
      inspectionId,
      technicianName: techName,
      qualityScore: riskLevel === "critical" ? 20 : 80,
      riskScore: riskLevel === "critical" ? 95 : 15,
      riskLevel,
      findingsCount: 2,
      photosAnalyzed: 3,
      components: {
        photoCoverage: 70,
        evidenceQuality: 70,
        avgConfidence: 70,
        recommendationCoverage: 70,
      },
      missedOpportunities: [],
    });
  }

  beforeAll(async () => {
    // Create one critical-risk inspection per company, both attributed to the shared name.
    const aSharedBody = await createInspection(OWNER_A_ID, "900 Shared Tech A Street");
    const bSharedBody = await createInspection(OWNER_B_ID, "900 Shared Tech B Street");
    inspSharedAId = aSharedBody.id;
    inspSharedBId = bSharedBody.id;

    await seedScorecardForTech(companyAId, inspSharedAId, SHARED_TECH, "critical");
    await seedScorecardForTech(companyBId, inspSharedBId, SHARED_TECH, "critical");
  });

  it("company A filtered by shared tech name returns only company A's inspection", async () => {
    asUser(OWNER_A_ID);
    const res = await request(app).get(
      `/api/executive/inspections?riskLevel=critical&technicianName=${encodeURIComponent(SHARED_TECH)}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.filters.technicianName).toBe(SHARED_TECH);

    const ids = res.body.inspections.map((r: { inspectionId: number }) => r.inspectionId);
    // Company A's inspection is present.
    expect(ids).toContain(inspSharedAId);
    // Company B's inspection with the same technician name must NOT appear.
    expect(ids).not.toContain(inspSharedBId);
  });

  it("company B filtered by shared tech name returns only company B's inspection", async () => {
    asUser(OWNER_B_ID);
    const res = await request(app).get(
      `/api/executive/inspections?riskLevel=critical&technicianName=${encodeURIComponent(SHARED_TECH)}`,
    );
    expect(res.status).toBe(200);

    const ids = res.body.inspections.map((r: { inspectionId: number }) => r.inspectionId);
    expect(ids).toContain(inspSharedBId);
    expect(ids).not.toContain(inspSharedAId);
  });

  it("total count in the response reflects only the calling company's matches", async () => {
    asUser(OWNER_A_ID);
    const res = await request(app).get(
      `/api/executive/inspections?riskLevel=critical&technicianName=${encodeURIComponent(SHARED_TECH)}`,
    );
    expect(res.status).toBe(200);
    // The count must match the inspections array length (company-A rows only).
    expect(res.body.total).toBe(res.body.inspections.length);
    // And the site address must belong to company A, not B.
    const addresses = res.body.inspections.map((r: { siteAddress: string }) => r.siteAddress);
    expect(addresses).not.toContain("900 Shared Tech B Street");
  });
});

describe("bait-station writes are isolated per company", () => {
  let inspAId: number;
  let stationAId: number;

  beforeAll(async () => {
    // Clean up any bait stations from other suites.
    await db.delete(baitStationsTable);

    // Create a real inspection owned by company A.
    const insp = await createInspection(OWNER_A_ID, "300 Bait A Street");
    inspAId = insp.id;

    // Create a real bait station on that inspection as company A.
    asUser(OWNER_A_ID);
    const stationRes = await request(app)
      .post(`/api/inspections/${inspAId}/bait-stations`)
      .send({ label: "Station Alpha", status: "active" });
    expect(stationRes.status).toBe(201);
    stationAId = stationRes.body.id;
    asUser(null);
  });

  it("POST returns 404 when the parent inspection belongs to another company", async () => {
    asUser(OWNER_B_ID);
    const res = await request(app)
      .post(`/api/inspections/${inspAId}/bait-stations`)
      .send({ label: "Stolen Station", status: "active" });
    expect(res.status).toBe(404);
  });

  it("POST does not create a bait station when the inspection is cross-tenant", async () => {
    // Confirm the failed POST left no bait station behind.
    const rows = await db
      .select()
      .from(baitStationsTable)
      .then((r) => r.filter((s) => s.label === "Stolen Station"));
    expect(rows).toHaveLength(0);
  });

  it("PATCH returns 404 for a cross-tenant stationId", async () => {
    asUser(OWNER_B_ID);
    const res = await request(app)
      .patch(`/api/inspections/${inspAId}/bait-stations/${stationAId}`)
      .send({ status: "missing" });
    expect(res.status).toBe(404);
  });

  it("PATCH leaves the original bait station unchanged after a cross-tenant attempt", async () => {
    asUser(OWNER_A_ID);
    const res = await request(app).get(`/api/inspections/${inspAId}/bait-stations`);
    expect(res.status).toBe(200);
    const station = res.body.find((s: { id: number }) => s.id === stationAId);
    expect(station).toBeDefined();
    expect(station.status).toBe("active"); // not "missing"
  });

  it("DELETE returns 404 for a cross-tenant stationId", async () => {
    asUser(OWNER_B_ID);
    const res = await request(app).delete(
      `/api/inspections/${inspAId}/bait-stations/${stationAId}`,
    );
    expect(res.status).toBe(404);
  });

  it("DELETE leaves the original bait station intact after a cross-tenant attempt", async () => {
    asUser(OWNER_A_ID);
    const res = await request(app).get(`/api/inspections/${inspAId}/bait-stations`);
    expect(res.status).toBe(200);
    const ids = res.body.map((s: { id: number }) => s.id);
    expect(ids).toContain(stationAId);
  });

  it("GET returns 404 when the inspection belongs to another company", async () => {
    asUser(OWNER_B_ID);
    const res = await request(app).get(`/api/inspections/${inspAId}/bait-stations`);
    expect(res.status).toBe(404);
  });

  it("GET does not expose company A's bait-station data to company B", async () => {
    asUser(OWNER_B_ID);
    const res = await request(app).get(`/api/inspections/${inspAId}/bait-stations`);
    // Must be a 404, not an empty array that silently leaks the inspection's existence.
    expect(res.status).toBe(404);
    expect(Array.isArray(res.body)).toBe(false);
  });
});

describe("DB invariant: every tenant row has a non-null company_id", () => {
  it("no tenant table contains a null company_id, and ids belong to A or B", async () => {
    const valid = new Set([companyAId, companyBId, platformCompanyId]);

    const checks: Array<[string, { companyId: number | null }[]]> = [
      ["inspections", await db.select().from(inspectionsTable)],
      ["inspection_media", await db.select().from(inspectionMediaTable)],
      ["analysis_results", await db.select().from(analysisResultsTable)],
      ["reports", await db.select().from(reportsTable)],
      ["property_profiles", await db.select().from(propertyProfilesTable)],
      ["property_notes", await db.select().from(propertyNotesTable)],
      ["dataset_images", await db.select().from(datasetImagesTable)],
      ["branding_profiles", await db.select().from(brandingProfilesTable)],
      ["intelligence_records", await db.select().from(intelligenceRecordsTable)],
      ["intelligence_tags", await db.select().from(intelligenceTagsTable)],
      ["intelligence_reviews", await db.select().from(intelligenceReviewsTable)],
      ["intelligence_votes", await db.select().from(intelligenceVotesTable)],
    ];

    for (const [table, rows] of checks) {
      for (const row of rows) {
        expect(row.companyId, `${table} row has null company_id`).not.toBeNull();
        expect(valid.has(row.companyId as number), `${table} row has stray company_id`).toBe(
          true,
        );
      }
    }
  });

  it("guards against a regression that leaves company_id NULL", async () => {
    // Sanity: a direct scan for NULL company_id across the two FK-only child
    // tables returns nothing.
    const orphanInspections = await db
      .select()
      .from(inspectionsTable)
      .where(or(isNull(inspectionsTable.companyId)));
    expect(orphanInspections).toHaveLength(0);

    const orphanScores = await db
      .select()
      .from(trainingScoresTable)
      .where(isNull(trainingScoresTable.companyId));
    expect(orphanScores).toHaveLength(0);
  });
});
