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
