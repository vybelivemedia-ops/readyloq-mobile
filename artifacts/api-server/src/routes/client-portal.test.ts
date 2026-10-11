import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

/**
 * Client Portal isolation tests (Task #409).
 *
 * Confirms that a property manager authenticated as Company A's client cannot
 * see Company B's data — even when both companies have inspections at the same
 * siteAddress. Three attack vectors are exercised:
 *
 *   1. GET /client/buildings/:address/inspections
 *   2. GET /client/buildings/:address/reports
 *   3. GET /client/buildings/:address/trends
 *
 * Additionally confirms that the /client/invites management endpoints require
 * an authenticated portal user with the "manager" role and are blocked for
 * unauthenticated callers or callers without that role (e.g. technicians).
 */

// ─── Clerk mock ───────────────────────────────────────────────────────────────

const { authState } = vi.hoisted(() => ({
  authState: { userId: null as string | null },
}));

const { pdfTestState } = vi.hoisted(() => ({
  pdfTestState: {
    imageUrl: `/objects/client-portal-test/photo.png`,
    imageData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/S1sAAAAASUVORK5CYII=",
    omitFixturePhoto: false,
    imageMapRequests: [] as string[][],
    uploadedPath: null as string | null,
    uploadedBytes: null as Buffer | null,
    downloadedPath: null as string | null,
  },
}));

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    getAuth: () => authState,
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

// Object-storage mock — not needed for client-portal reads, but app.ts wires
// it up globally so tests fail to mount without it.
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
      return new Response("file-bytes");
    }
    async uploadReportPdf(companyId: number, reportId: number, buffer: Buffer, sourceHash: string) {
      const path = `/objects/companies/${companyId}/reports/${reportId}/client-portal-test-${sourceHash}.pdf`;
      pdfTestState.uploadedPath = path;
      pdfTestState.uploadedBytes = Buffer.from(buffer);
      return path;
    }
    async downloadReportPdf(companyId: number, reportId: number, path: string) {
      const expectedPrefix = `/objects/companies/${companyId}/reports/${reportId}/`;
      if (!path.startsWith(expectedPrefix) || path !== pdfTestState.uploadedPath || !pdfTestState.uploadedBytes) {
        throw new Error("Report PDF is missing from test storage");
      }
      pdfTestState.downloadedPath = path;
      return Buffer.from(pdfTestState.uploadedBytes);
    }
  }
  return { ...actual, ObjectStorageService };
});

vi.mock("../lib/report-html-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/report-html-server")>();
  return {
    ...actual,
    buildFindingImageMap: async (items: Array<{ imageUrl?: string | null }>) => {
      const imageUrls = items.flatMap((item) => item.imageUrl ? [item.imageUrl] : []);
      pdfTestState.imageMapRequests.push(imageUrls);
      if (!imageUrls.includes(pdfTestState.imageUrl)) {
        return actual.buildFindingImageMap(items);
      }
      return pdfTestState.omitFixturePhoto
        ? new Map<string, string>()
        : new Map([[pdfTestState.imageUrl, pdfTestState.imageData]]);
    },
  };
});

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import app from "../app";
import {
  db,
  usersTable,
  companiesTable,
  inspectionsTable,
  inspectionMediaTable,
  reportsTable,
  clientPortalAccessTable,
  analysisResultsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";

const execFileAsync = promisify(execFile);

// ─── Stable IDs ───────────────────────────────────────────────────────────────

// Company-portal users (owner / manager / technician) for Company A.
const CP_MANAGER_A  = "cp_mgr_a_clerk_id";
const CP_TECH_A     = "cp_tech_a_clerk_id";

// Property-manager Clerk IDs (client-portal users, not in usersTable).
const PM_USER_A     = "cp_pm_user_a_clerk_id"; // granted access under Company A
const PM_USER_B     = "cp_pm_user_b_clerk_id"; // granted access under Company B

// The shared siteAddress present in both companies.
const SHARED_ADDRESS = "42 Shared Blvd, Anytown";

// ─── State ────────────────────────────────────────────────────────────────────

let companyAId: number;
let companyBId: number;
let inspectionAId: number;
let inspectionBId: number;
let restrictedInspectionAId: number;
let reportAId: number;
let reportBId: number;
let mediaAId: number;
let restrictedMediaAId: number;

function asUser(id: string | null) {
  authState.userId = id;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function findOrCreateCompany(name: string, slug: string): Promise<number> {
  const [existing] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.slug, slug));
  if (existing) return existing.id;
  const [row] = await db.insert(companiesTable).values({ name, slug }).returning();
  return row.id;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

/**
 * Both companies get a *completed* inspection at SHARED_ADDRESS with distinct
 * pest types so that trends isolation can be verified by checking which pest
 * types appear (or don't) in each PM's response.
 *
 *   Company A pest type: "ants"
 *   Company B pest type: "termites"
 *
 * Inspections are inserted directly so we can control status, completedAt, and
 * pestTypes without going through the full HTTP lifecycle.
 */
beforeAll(async () => {
  companyAId = await findOrCreateCompany("CP Test Co A", "cp-test-co-a");
  companyBId = await findOrCreateCompany("CP Test Co B", "cp-test-co-b");

  // Tear down any leftover fixtures from previous runs (FK-safe order).
  await db.delete(clientPortalAccessTable).where(
    inArray(clientPortalAccessTable.companyId, [companyAId, companyBId]),
  );
  await db.delete(reportsTable).where(
    inArray(reportsTable.companyId, [companyAId, companyBId]),
  );
  await db.delete(inspectionsTable).where(
    inArray(inspectionsTable.companyId, [companyAId, companyBId]),
  );
  for (const id of [CP_MANAGER_A, CP_TECH_A]) {
    await db.delete(usersTable).where(eq(usersTable.clerkUserId, id));
  }

  // Seed Company A and B portal users.
  await db.insert(usersTable).values([
    { clerkUserId: CP_MANAGER_A, role: "manager",    companyId: companyAId },
    { clerkUserId: CP_TECH_A,    role: "technician", companyId: companyAId },
  ]);

  const completedAt = new Date(); // within the last 12 months → appears in trends

  // Company A: completed inspection with pest type "ants".
  const [inspA] = await db
    .insert(inspectionsTable)
    .values({
      companyId: companyAId,
      siteAddress: SHARED_ADDRESS,
      technicianName: "Tech A",
      clientName: "Client A",
      status: "completed",
      pestTypes: ["ants"],
      completedAt,
    })
    .returning();
  inspectionAId = inspA.id;

  // Company B: completed inspection with pest type "termites" (different from A).
  const [inspB] = await db
    .insert(inspectionsTable)
    .values({
      companyId: companyBId,
      siteAddress: SHARED_ADDRESS,
      technicianName: "Tech B",
      clientName: "Client B",
      status: "completed",
      pestTypes: ["termites"],
      completedAt,
    })
    .returning();
  inspectionBId = inspB.id;

  // Company A also has a separate building that PM_USER_A is not authorized
  // to view. This proves an otherwise-valid property manager cannot use an
  // inspection ID to fetch evidence outside their address grant.
  const [restrictedInspection] = await db
    .insert(inspectionsTable)
    .values({
      companyId: companyAId,
      siteAddress: "99 Restricted Ave, Anytown",
      technicianName: "Tech A",
      clientName: "Restricted Client",
      status: "completed",
      pestTypes: ["ants"],
      completedAt,
    })
    .returning();
  restrictedInspectionAId = restrictedInspection.id;

  const [mediaA] = await db
    .insert(inspectionMediaTable)
    .values({
      companyId: companyAId,
      inspectionId: inspectionAId,
      mediaType: "photo",
      url: `/objects/companies/${companyAId}/uploads/client-portal-a-photo.jpg`,
      filename: "client-portal-a-photo.jpg",
      caption: "Kitchen evidence",
    })
    .returning();
  mediaAId = mediaA.id;

  const [restrictedMedia] = await db
    .insert(inspectionMediaTable)
    .values({
      companyId: companyAId,
      inspectionId: restrictedInspectionAId,
      mediaType: "photo",
      url: `/objects/companies/${companyAId}/uploads/client-portal-restricted-photo.jpg`,
    })
    .returning();
  restrictedMediaAId = restrictedMedia.id;

  // Seed an approved report for each company at the shared address.
  const [repA] = await db
    .insert(reportsTable)
    .values({
      companyId: companyAId,
      inspectionId: inspectionAId,
      title: "Report A",
      status: "approved",
      siteAddress: SHARED_ADDRESS,
      technicianName: "Tech A",
      inspectionDate: completedAt.toISOString().slice(0, 10),
    })
    .returning();
  reportAId = repA.id;

  const [repB] = await db
    .insert(reportsTable)
    .values({
      companyId: companyBId,
      inspectionId: inspectionBId,
      title: "Report B",
      status: "approved",
      siteAddress: SHARED_ADDRESS,
      technicianName: "Tech B",
      inspectionDate: completedAt.toISOString().slice(0, 10),
    })
    .returning();
  reportBId = repB.id;

  // Grant PM_USER_A access to the shared address under Company A only.
  await db.insert(clientPortalAccessTable).values({
    companyId: companyAId,
    clerkUserId: PM_USER_A,
    email: "pm-a@example.com",
    label: "PM User A",
    siteAddresses: [SHARED_ADDRESS],
  });

  // Grant PM_USER_B access to the shared address under Company B.
  await db.insert(clientPortalAccessTable).values({
    companyId: companyBId,
    clerkUserId: PM_USER_B,
    email: "pm-b@example.com",
    label: "PM User B",
    siteAddresses: [SHARED_ADDRESS],
  });
});

beforeEach(() => {
  asUser(null);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/client/me", () => {
  it("returns 401 when no clerk user is authenticated", async () => {
    const res = await request(app).get("/api/client/me");
    expect(res.status).toBe(401);
  });

  it("returns Company A's access record for PM_USER_A", async () => {
    asUser(PM_USER_A);
    const res = await request(app).get("/api/client/me");
    expect(res.status).toBe(200);
    expect(res.body.siteAddresses).toContain(SHARED_ADDRESS);
    expect(res.body.company.id).toBe(companyAId);
  });
});


describe("GET /api/client/buildings/:address/inspections — cross-company isolation", () => {
  it("PM_USER_A can retrieve inspections at the shared address (returns Company A's data)", async () => {
    asUser(PM_USER_A);
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent(SHARED_ADDRESS)}/inspections`);
    expect(res.status).toBe(200);
    const ids: number[] = res.body.map((i: any) => i.id);
    // Must include Company A's inspection.
    expect(ids).toContain(inspectionAId);
    // Must NEVER include Company B's inspection.
    expect(ids).not.toContain(inspectionBId);
  });

  it("PM_USER_B can retrieve inspections at the shared address (returns Company B's data)", async () => {
    asUser(PM_USER_B);
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent(SHARED_ADDRESS)}/inspections`);
    expect(res.status).toBe(200);
    const ids: number[] = res.body.map((i: any) => i.id);
    // Must include Company B's inspection.
    expect(ids).toContain(inspectionBId);
    // Must NEVER include Company A's inspection.
    expect(ids).not.toContain(inspectionAId);
  });

  it("unauthenticated request is rejected with 401", async () => {
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent(SHARED_ADDRESS)}/inspections`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for an address not in the PM's access list", async () => {
    asUser(PM_USER_A);
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent("999 Unknown St")}/inspections`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/client/inspections/:inspectionId/media — evidence authorization", () => {
  it("returns only authorized photo metadata and a client-scoped image URL", async () => {
    asUser(PM_USER_A);
    const res = await request(app)
      .get(`/api/client/inspections/${inspectionAId}/media`)
      .expect(200);

    expect(res.body).toEqual([
      expect.objectContaining({
        id: mediaAId,
        filename: "client-portal-a-photo.jpg",
        caption: "Kitchen evidence",
        imageUrl: `/client/inspections/${inspectionAId}/media/${mediaAId}`,
      }),
    ]);
    expect(res.body[0]).not.toHaveProperty("url");
    expect(JSON.stringify(res.body)).not.toContain("/objects/companies/");
  });

  it("does not return another company's evidence at a shared address", async () => {
    asUser(PM_USER_B);
    await request(app)
      .get(`/api/client/inspections/${inspectionAId}/media`)
      .expect(404);
  });

  it("does not return evidence from an ungranted address in the same company", async () => {
    asUser(PM_USER_A);
    await request(app)
      .get(`/api/client/inspections/${restrictedInspectionAId}/media`)
      .expect(403);
  });
});

describe("GET /api/client/inspections/:inspectionId/media/:mediaId — evidence bytes", () => {
  it("streams a photo only for the authorized property", async () => {
    asUser(PM_USER_A);
    const res = await request(app)
      .get(`/api/client/inspections/${inspectionAId}/media/${mediaAId}`)
      .expect(200);

    expect(res.text).toBe("file-bytes");
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });

  it("blocks a different company and an ungranted address from retrieving image bytes", async () => {
    asUser(PM_USER_B);
    await request(app)
      .get(`/api/client/inspections/${inspectionAId}/media/${mediaAId}`)
      .expect(404);

    asUser(PM_USER_A);
    await request(app)
      .get(`/api/client/inspections/${restrictedInspectionAId}/media/${restrictedMediaAId}`)
      .expect(403);
  });
});

describe("GET /api/client/buildings/:address/reports — cross-company isolation", () => {
  it("PM_USER_A sees only Company A's reports for the shared address", async () => {
    asUser(PM_USER_A);
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent(SHARED_ADDRESS)}/reports`);
    expect(res.status).toBe(200);
    const ids: number[] = res.body.map((r: any) => r.id);
    expect(ids).toContain(reportAId);
    expect(ids).not.toContain(reportBId);
  });

  it("PM_USER_B sees only Company B's reports for the shared address", async () => {
    asUser(PM_USER_B);
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent(SHARED_ADDRESS)}/reports`);
    expect(res.status).toBe(200);
    const ids: number[] = res.body.map((r: any) => r.id);
    expect(ids).toContain(reportBId);
    expect(ids).not.toContain(reportAId);
  });

  it("unauthenticated request is rejected with 401", async () => {
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent(SHARED_ADDRESS)}/reports`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for an address not in the PM's access list", async () => {
    asUser(PM_USER_A);
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent("999 Unknown St")}/reports`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/client/buildings/:address/trends — cross-company isolation", () => {
  /**
   * Company A's completed inspection has pest_types=["ants"].
   * Company B's completed inspection has pest_types=["termites"].
   *
   * Both are at the SAME siteAddress so a naive (un-scoped) query would merge
   * both companies' pest types in the result. A correct, isolated query returns
   * only the calling PM's company data.
   */
  /**
   * db.execute() in Drizzle/node-postgres returns a QueryResult object.
   * The route passes it directly to res.json(), so the serialized shape is:
   *   { pestTrends: { rows: [...], rowCount: N, ... }, inspectionCounts: { rows: [...], ... } }
   *
   * We normalise with asTrendRows() to handle both shapes defensively.
   */
  function asTrendRows(raw: any): any[] {
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.rows)) return raw.rows;
    return [];
  }

  it("PM_USER_A trends contain 'ants' (Company A) and never 'termites' (Company B)", async () => {
    asUser(PM_USER_A);
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent(SHARED_ADDRESS)}/trends`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("pestTrends");
    expect(res.body).toHaveProperty("inspectionCounts");

    const pestTypes = asTrendRows(res.body.pestTrends).map((r: any) => r.pestType);
    // Must see Company A's pest type.
    expect(pestTypes).toContain("ants");
    // Must NOT see Company B's pest type — would indicate a cross-tenant data leak.
    expect(pestTypes).not.toContain("termites");

    // inspectionCounts must reflect only Company A's inspection (count = 1).
    const totalInspections = asTrendRows(res.body.inspectionCounts).reduce(
      (sum: number, r: any) => sum + Number(r.inspections),
      0,
    );
    expect(totalInspections).toBe(1);
  });

  it("PM_USER_B trends contain 'termites' (Company B) and never 'ants' (Company A)", async () => {
    asUser(PM_USER_B);
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent(SHARED_ADDRESS)}/trends`);
    expect(res.status).toBe(200);

    const pestTypes = asTrendRows(res.body.pestTrends).map((r: any) => r.pestType);
    // Must see Company B's pest type.
    expect(pestTypes).toContain("termites");
    // Must NOT see Company A's pest type.
    expect(pestTypes).not.toContain("ants");

    const totalInspections = asTrendRows(res.body.inspectionCounts).reduce(
      (sum: number, r: any) => sum + Number(r.inspections),
      0,
    );
    expect(totalInspections).toBe(1);
  });

  it("unauthenticated request is rejected with 401", async () => {
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent(SHARED_ADDRESS)}/trends`);
    expect(res.status).toBe(401);
  });

  it("returns 403 for an address not in the PM's access list", async () => {
    asUser(PM_USER_A);
    const res = await request(app)
      .get(`/api/client/buildings/${encodeURIComponent("999 Unknown St")}/trends`);
    expect(res.status).toBe(403);
  });
});

describe("/api/client/invites — manager-only access control", () => {
  it("POST /invites is blocked without authentication (401)", async () => {
    const res = await request(app)
      .post("/api/client/invites")
      .send({
        clerkUserId: "some-clerk-id",
        siteAddresses: [SHARED_ADDRESS],
      });
    expect(res.status).toBe(401);
  });

  it("POST /invites is blocked for a technician (403)", async () => {
    asUser(CP_TECH_A);
    const res = await request(app)
      .post("/api/client/invites")
      .send({
        clerkUserId: "some-clerk-id",
        siteAddresses: [SHARED_ADDRESS],
      });
    expect(res.status).toBe(403);
  });

  it("GET /invites is blocked without authentication (401)", async () => {
    const res = await request(app).get("/api/client/invites");
    expect(res.status).toBe(401);
  });

  it("GET /invites is blocked for a technician (403)", async () => {
    asUser(CP_TECH_A);
    const res = await request(app).get("/api/client/invites");
    expect(res.status).toBe(403);
  });

  it("DELETE /invites/:id is blocked without authentication (401)", async () => {
    const res = await request(app).delete("/api/client/invites/999");
    expect(res.status).toBe(401);
  });

  it("DELETE /invites/:id is blocked for a technician (403)", async () => {
    asUser(CP_TECH_A);
    const res = await request(app).delete("/api/client/invites/999");
    expect(res.status).toBe(403);
  });

  it("GET /invites succeeds for a manager and returns only Company A's records", async () => {
    asUser(CP_MANAGER_A);
    const res = await request(app).get("/api/client/invites");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // All returned records must belong to Company A.
    for (const record of res.body) {
      expect(record.companyId).toBe(companyAId);
    }
    // PM_USER_B (under Company B) must not appear in Company A's invite list.
    const clerkIds: string[] = res.body.map((r: any) => r.clerkUserId);
    expect(clerkIds).not.toContain(PM_USER_B);
  });
});

// ─── GET /api/client/reports/:id/html — measurement strip ────────────────────

describe("GET /api/client/reports/:id/html — laser measurement strip", () => {
  let LASER_PHOTO_URL: string;
  let measurementReportId: number;

  beforeAll(async () => {
    LASER_PHOTO_URL = `/objects/companies/${companyAId}/uploads/cp-laser-photo.jpg`;
    // Seed a photo media record with a burst-reference laser measurement
    await db.insert(inspectionMediaTable).values({
      companyId: companyAId,
      inspectionId: inspectionAId,
      mediaType: "photo",
      url: LASER_PHOTO_URL,
      filename: "cp-laser.jpg",
      captureMetadata: {
        laserMeasurement: {
          kind: "distance",
          value: 3.25,
          unit: "inches",
          signalQuality: 0.9,
          metadata: {
            method: "burst_reference",
            heightInches: 4.0,
            areaSqInches: 13.0,
            confidence: 0.78,
            warnings: ["edge_detected"],
          },
        },
      },
    });

    // Seed an approved report with a finding whose imageUrl references the photo
    const findingsJson = JSON.stringify([
      {
        id: 99,
        category: "Gap",
        description: "Gap at threshold",
        confidence: 0.85,
        severity: "high",
        location: "Front entrance",
        imageUrl: LASER_PHOTO_URL,
        exclusionOpportunity: true,
      },
    ]);
    const [repM] = await db
      .insert(reportsTable)
      .values({
        companyId: companyAId,
        inspectionId: inspectionAId,
        title: "Measurement Report A",
        status: "approved",
        siteAddress: SHARED_ADDRESS,
        technicianName: "Tech A",
        inspectionDate: new Date().toISOString().slice(0, 10),
        findings: JSON.parse(findingsJson),
      })
      .returning();
    measurementReportId = repM.id;
  });

  it("renders W/H/area measurement strip when the finding image has captureMetadata.laserMeasurement", async () => {
    asUser(PM_USER_A);
    const res = await request(app).get(`/api/client/reports/${measurementReportId}/html`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Laser Measurement");
    expect(res.text).toContain("W:");
    expect(res.text).toContain("H:");
    expect(res.text).toContain("Area:");
    // confidence 0.78 is above threshold — should NOT be labelled low confidence
    expect(res.text).not.toContain("low confidence");
    // Warning text should appear
    expect(res.text).toContain("edge_detected");
  });

  it("renders low-confidence label when measurement confidence < 0.5", async () => {
    const LOW_URL = `/objects/companies/${companyAId}/uploads/cp-low-conf.jpg`;
    await db.insert(inspectionMediaTable).values({
      companyId: companyAId,
      inspectionId: inspectionAId,
      mediaType: "photo",
      url: LOW_URL,
      filename: "cp-low.jpg",
      captureMetadata: {
        laserMeasurement: {
          kind: "distance",
          value: 0.5,
          unit: "inches",
          metadata: {
            method: "burst_reference",
            heightInches: 0.6,
            areaSqInches: 0.3,
            confidence: 0.4,
            warnings: ["low_signal"],
          },
        },
      },
    });

    const [repLow] = await db
      .insert(reportsTable)
      .values({
        companyId: companyAId,
        inspectionId: inspectionAId,
        title: "Low Conf Report",
        status: "approved",
        siteAddress: SHARED_ADDRESS,
        technicianName: "Tech A",
        inspectionDate: new Date().toISOString().slice(0, 10),
        findings: [
          {
            id: 100,
            category: "Crack",
            description: "Hairline crack",
            treatment: null,
            confidence: 0.7,
            severity: "medium",
            location: null,
            imageUrl: LOW_URL,
            exclusionOpportunity: false,
          },
        ],
      })
      .returning();

    asUser(PM_USER_A);
    const res = await request(app).get(`/api/client/reports/${repLow.id}/html`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Laser Measurement");
    expect(res.text).toContain("low confidence");
    expect(res.text).toContain("low_signal");
  });

  it("returns 403 for a PM who does not have access to this building", async () => {
    asUser(PM_USER_B);
    const res = await request(app).get(`/api/client/reports/${measurementReportId}/html`);
    // PM_USER_B is under Company B — cannot see Company A's report
    expect(res.status).toBe(404);
  });

  it("returns 404 for a non-approved report", async () => {
    const [draft] = await db
      .insert(reportsTable)
      .values({
        companyId: companyAId,
        inspectionId: inspectionAId,
        title: "Draft Report",
        status: "draft",
        siteAddress: SHARED_ADDRESS,
        technicianName: "Tech A",
        inspectionDate: new Date().toISOString().slice(0, 10),
      })
      .returning();

    asUser(PM_USER_A);
    const res = await request(app).get(`/api/client/reports/${draft.id}/html`);
    expect(res.status).toBe(404);
  });
});

describe("client report PDF generation and download", () => {
  const PDF_BUILDING_ADDRESS = SHARED_ADDRESS;
  const PDF_FINDING_DESCRIPTION = "Fresh rodent droppings beneath the pantry sink.";
  const PDF_IMAGE_CAPTION = "Pantry sink evidence photo";
  let pdfReportId: number;
  let restrictedPdfReportId: number;
  let companyBPhotoUrl: string;

  let pdfFinding: {
    id: number;
    category: string;
    description: string;
    confidence: number;
    severity: string;
    location: string;
    imageUrl: string;
    treatment: null;
    exclusionOpportunity: boolean;
  };

  beforeAll(async () => {
    pdfTestState.imageUrl =
      `/objects/companies/${companyAId}/uploads/client-portal-pdf-photo.png`;
    pdfFinding = {
      id: 701,
      category: "Rodent activity",
      description: PDF_FINDING_DESCRIPTION,
      confidence: 0.93,
      severity: "high",
      location: "Pantry",
      imageUrl: pdfTestState.imageUrl,
      treatment: null,
      exclusionOpportunity: false,
    };
    companyBPhotoUrl = `/objects/companies/${companyBId}/uploads/client-portal-b-private-photo.jpg`;
    await db.insert(inspectionMediaTable).values({
      companyId: companyBId,
      inspectionId: inspectionBId,
      mediaType: "photo",
      url: companyBPhotoUrl,
      filename: "company-b-private-photo.jpg",
    });

    const completedAt = new Date();
    const [inspection] = await db.insert(inspectionsTable).values({
      companyId: companyAId,
      siteAddress: PDF_BUILDING_ADDRESS,
      technicianName: "PDF Fixture Technician",
      clientName: "PDF Fixture Client",
      status: "completed",
      pestTypes: ["rodents"],
      completedAt,
    }).returning();

    await db.insert(analysisResultsTable).values({
      companyId: companyAId,
      inspectionId: inspection.id,
      status: "complete",
      findings: [pdfFinding],
      recommendations: ["Seal the pantry pipe gap."],
    });

    await db.insert(inspectionMediaTable).values({
      companyId: companyAId,
      inspectionId: inspection.id,
      mediaType: "photo",
      url: pdfTestState.imageUrl,
      filename: "pantry-sink-evidence.png",
      caption: PDF_IMAGE_CAPTION,
    });

    const [report] = await db.insert(reportsTable).values({
      companyId: companyAId,
      inspectionId: inspection.id,
      title: "PDF Regression Report",
      status: "approved",
      siteAddress: PDF_BUILDING_ADDRESS,
      technicianName: "PDF Fixture Technician",
      inspectionDate: completedAt.toISOString().slice(0, 10),
      findings: [pdfFinding],
    }).returning();
    pdfReportId = report.id;

    const [restrictedReport] = await db.insert(reportsTable).values({
      companyId: companyAId,
      inspectionId: inspection.id,
      title: "Restricted Building PDF Report",
      status: "approved",
      siteAddress: "99 Restricted Ave, Anytown",
      technicianName: "PDF Fixture Technician",
      inspectionDate: completedAt.toISOString().slice(0, 10),
      findings: [pdfFinding],
    }).returning();
    restrictedPdfReportId = restrictedReport.id;
  });

  beforeEach(async () => {
    pdfTestState.omitFixturePhoto = false;
    pdfTestState.imageMapRequests = [];
    pdfTestState.uploadedPath = null;
    pdfTestState.uploadedBytes = null;
    pdfTestState.downloadedPath = null;
    await db.update(reportsTable)
      .set({ pdfUrl: null })
      .where(eq(reportsTable.id, pdfReportId));
  });

  async function extractPdfText(pdf: Buffer): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "client-report-pdf-test-"));
    const pdfPath = join(directory, "report.pdf");
    try {
      await writeFile(pdfPath, pdf);
      const { stdout } = await execFileAsync("pdftotext", [pdfPath, "-"]);
      return stdout;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  it("generates a real PDF and serves the exact stored bytes to the authorized customer", async () => {
    asUser(PM_USER_A);
    const generated = await request(app)
      .post(`/api/client/reports/${pdfReportId}/pdf`)
      .expect(200);

    expect(generated.headers["cache-control"]).toBe("private, no-store");
    expect(generated.body.pdfUrl).toMatch(
      new RegExp(`^/api/client/reports/${pdfReportId}/pdf\\?artifact=client-portal-test-[0-9a-f]{64}\\.pdf$`),
    );
    expect(generated.body.byteSize).toBeGreaterThan(1024);
    expect(pdfTestState.uploadedBytes).not.toBeNull();
    expect(pdfTestState.uploadedBytes!.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdfTestState.uploadedPath).toBe(
      `/objects/companies/${companyAId}/reports/${pdfReportId}/${generated.body.pdfUrl.split("artifact=")[1]}`,
    );

    const [savedReport] = await db.select().from(reportsTable)
      .where(eq(reportsTable.id, pdfReportId));
    expect(savedReport.pdfUrl).toBe(pdfTestState.uploadedPath);

    const downloaded = await request(app)
      .get(generated.body.pdfUrl)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);

    const customerBytes = Buffer.from(downloaded.body);
    expect(downloaded.headers["content-type"]).toMatch(/^application\/pdf(?:;|$)/);
    expect(Number(downloaded.headers["content-length"])).toBe(customerBytes.length);
    expect(downloaded.headers["content-disposition"]).toBe(
      `attachment; filename="readyloq-report-${pdfReportId}.pdf"`,
    );
    expect(pdfTestState.downloadedPath).toBe(pdfTestState.uploadedPath);
    expect(customerBytes.equals(pdfTestState.uploadedBytes!)).toBe(true);
    expect(customerBytes.subarray(0, 5).toString()).toBe("%PDF-");

    const text = await extractPdfText(customerBytes);
    expect(text).toContain(`Inspection ID: #${savedReport.inspectionId}`);
    expect(text).toContain(PDF_FINDING_DESCRIPTION);
    expect(text).toContain(PDF_IMAGE_CAPTION);
  });

  it("enforces tenant and building authorization before PDF generation or download", async () => {
    asUser(PM_USER_B);
    await request(app).post(`/api/client/reports/${pdfReportId}/pdf`).expect(404);
    await request(app).get(`/api/client/reports/${pdfReportId}/pdf`).expect(404);

    asUser(PM_USER_A);
    await request(app).post(`/api/client/reports/${restrictedPdfReportId}/pdf`).expect(403);
    await request(app).get(`/api/client/reports/${restrictedPdfReportId}/pdf`).expect(403);
    expect(pdfTestState.uploadedBytes).toBeNull();
  });

  it("returns 503 without publishing a PDF when its required evidence photo is missing", async () => {
    pdfTestState.omitFixturePhoto = true;
    asUser(PM_USER_A);
    const response = await request(app)
      .post(`/api/client/reports/${pdfReportId}/pdf`)
      .expect(503);

    expect(response.body.error).toMatch(/PDF is unavailable/);
    expect(response.body).not.toHaveProperty("pdfUrl");
    expect(pdfTestState.uploadedBytes).toBeNull();
    const [savedReport] = await db.select().from(reportsTable)
      .where(eq(reportsTable.id, pdfReportId));
    expect(savedReport.pdfUrl).toBeNull();
  });

  it("refuses to serve a previously generated PDF after the report source changes", async () => {
    asUser(PM_USER_A);
    const generated = await request(app)
      .post(`/api/client/reports/${pdfReportId}/pdf`)
      .expect(200);
    await db.update(reportsTable)
      .set({ treatmentNotes: "Updated after PDF generation" })
      .where(eq(reportsTable.id, pdfReportId));
    try {
      await request(app).get(generated.body.pdfUrl).expect(409);
      expect(pdfTestState.downloadedPath).toBeNull();
    } finally {
      await db.update(reportsTable)
        .set({ treatmentNotes: null, pdfUrl: null })
        .where(eq(reportsTable.id, pdfReportId));
    }
  });

  it("fails closed for a finding that references a different company's photo", async () => {
    await db.update(reportsTable)
      .set({
        findings: [{
          ...pdfFinding,
          imageUrl: companyBPhotoUrl,
        }],
      })
      .where(eq(reportsTable.id, pdfReportId));

    asUser(PM_USER_A);
    const response = await request(app)
      .post(`/api/client/reports/${pdfReportId}/pdf`)
      .expect(503);

    expect(pdfTestState.imageMapRequests.flat()).not.toContain(companyBPhotoUrl);
    expect(JSON.stringify(response.body)).not.toContain(companyBPhotoUrl);
    expect(JSON.stringify(response.body)).not.toContain(pdfTestState.imageData);
    expect(pdfTestState.uploadedBytes).toBeNull();
    const [savedReport] = await db.select().from(reportsTable)
      .where(eq(reportsTable.id, pdfReportId));
    expect(savedReport.pdfUrl).toBeNull();
  });
});
