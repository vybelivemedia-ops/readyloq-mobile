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
  READYLOQ_DEFAULT_PROFILE,
} from "@workspace/db";
import { eq, isNull, or } from "drizzle-orm";

const OWNER_A_ID = "iso_owner_a_clerk_id";
const OWNER_B_ID = "iso_owner_b_clerk_id";

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
  // reports; deleting quizzes cascades to training_scores.
  await db.delete(inspectionsTable);
  await db.delete(quizzesTable);
  await db.delete(propertyProfilesTable);
  await db.delete(propertyNotesTable);
  await db.delete(datasetImagesTable);
  await db.delete(brandingProfilesTable);
  await db.delete(usersTable);

  await db.insert(usersTable).values([
    { clerkUserId: OWNER_A_ID, role: "owner", companyId: companyAId },
    { clerkUserId: OWNER_B_ID, role: "owner", companyId: companyBId },
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
