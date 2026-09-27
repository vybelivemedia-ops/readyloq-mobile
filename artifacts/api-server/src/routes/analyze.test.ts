import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * POST /analysis/analyze behavior tests.
 *
 * These pin the two data-integrity guarantees of the real vision pipeline:
 *   1. A photo whose analysis FAILS (storage/model/parse error -> analyzePhoto
 *      returns null) must NOT create a placeholder finding; it is counted in the
 *      additive `analysisErrors` field and surfaced to the technician.
 *   2. A photo that analyzes cleanly but carries no concrete classification (a
 *      "clean" photo) must NOT create a finding either — even though the prompt
 *      always makes the model emit a rationale + tags.
 * Only a content-bearing prediction (category / pest / conducive condition /
 * entry point / corrective action) becomes a finding.
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

// Keep the real tenant-boundary parser (objectPathCompanyScope) but stub the
// GCS-touching service so importing the full app graph never hits real storage.
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
  }
  return { ...actual, ObjectStorageService };
});

// Control the vision model per test. The route uses the legacy nullable
// analyzePhoto contract; production reports richer outcomes through its
// optional third-argument callback.
const { analyzePhotoMock } = vi.hoisted(() => ({ analyzePhotoMock: vi.fn() }));
vi.mock("../lib/intelligence-ai", () => {
  const empty = {
    category: null,
    subcategory: null,
    confidence: 0,
    tags: [] as string[],
    possiblePest: null,
    possibleConduciveCondition: null,
    possibleEntryPoint: null,
    suggestedCorrectiveAction: null,
    rationale: null,
  };
  return {
    analyzePhoto: analyzePhotoMock,
    generateAiPrediction: vi.fn(async () => ({ ...empty })),
    fallbackPrediction: () => ({ ...empty }),
  };
});

import app from "../app";
import {
  db,
  usersTable,
  companiesTable,
  inspectionsTable,
  inspectionMediaTable,
  analysisResultsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

const OWNER_ID = "analyze_owner_clerk_id";
const OWNER2_ID = "analyze_owner2_clerk_id";
let companyId: number;
let company2Id: number;

function asUser(id: string | null) {
  authState.userId = id;
}

/** A clean-but-successful prediction: every concrete classification is null. */
function cleanPrediction() {
  return {
    category: null,
    subcategory: null,
    confidence: 0.2,
    // The prompt ALWAYS emits these — they must NOT alone create a finding.
    tags: ["kitchen", "clean"],
    possiblePest: null,
    possibleConduciveCondition: null,
    possibleEntryPoint: null,
    suggestedCorrectiveAction: null,
    rationale: "No pest activity visible in this area.",
  };
}

/** A content-bearing prediction that SHOULD become a finding. */
function pestPrediction() {
  return {
    category: "pest",
    subcategory: "cockroach",
    confidence: 0.82,
    tags: ["roach", "kitchen"],
    possiblePest: "German cockroach",
    possibleConduciveCondition: null,
    possibleEntryPoint: null,
    suggestedCorrectiveAction: "Apply gel bait near harborage",
    rationale: "Visible roach near harborage",
  };
}

/**
 * Create a fresh inspection with one persisted, company-scoped media row.
 * Returns the inspection id and the image URL the client would send to /analyze
 * (the route only analyzes photos that were actually saved as media).
 */
async function createInspectionWithPhoto(suffix: string) {
  asUser(OWNER_ID);
  const created = await request(app)
    .post("/api/inspections")
    .send({ siteAddress: `${suffix} Analyze St`, technicianName: "Tech", clientName: "Client" });
  expect(created.status).toBe(201);
  const inspectionId = created.body.id as number;

  const imageUrl = `/api/storage/objects/companies/${companyId}/uploads/photo-${suffix}`;
  const media = await request(app)
    .post(`/api/inspections/${inspectionId}/media`)
    .send({ mediaType: "photo", url: imageUrl });
  expect(media.status).toBe(201);

  asUser(null);
  return { inspectionId, imageUrl };
}

async function createMobileInspectionWithFourImages(suffix: string) {
  asUser(OWNER_ID);
  const created = await request(app)
    .post("/api/inspections")
    .send({ siteAddress: `${suffix} Mobile St`, technicianName: "Tech", clientName: "Client" });
  expect(created.status).toBe(201);
  const inspectionId = created.body.id as number;
  const imageUrls: string[] = [];
  for (let index = 0; index < 4; index++) {
    const imageUrl = `/api/storage/objects/companies/${companyId}/uploads/${suffix}-${index}`;
    const media = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "image", url: imageUrl });
    expect(media.status).toBe(201);
    imageUrls.push(imageUrl);
  }
  return { inspectionId, imageUrls };
}

async function analyzeAndCheckPersisted(
  inspectionId: number,
  imageUrls: string[],
  expectedStatuses: string[],
) {
  asUser(OWNER_ID);
  const response = await request(app)
    .post("/api/analysis/analyze")
    .send({ inspectionId, draft: true, images: imageUrls.map((imageUrl) => ({ imageUrl })) });
  expect(response.status).toBe(201);
  expect(response.body.photoOutcomes.map((p: { status: string }) => p.status)).toEqual(expectedStatuses);
  const listed = await request(app).get(`/api/analysis?inspectionId=${inspectionId}`);
  expect(listed.status).toBe(200);
  expect(listed.body[0].id).toBe(response.body.id);
  expect(listed.body[0].photoOutcomes).toEqual(response.body.photoOutcomes);
  expect(listed.body[0].analyzedImagePaths).toEqual(response.body.analyzedImagePaths);
  expect(listed.body[0].coverage).toEqual(response.body.coverage);
  return response.body;
}

beforeAll(async () => {
  const slug = "analyze-co";
  const [existing] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.slug, slug));
  companyId = existing
    ? existing.id
    : (await db.insert(companiesTable).values({ name: "Analyze Co", slug }).returning())[0].id;

  await db.delete(usersTable).where(eq(usersTable.clerkUserId, OWNER_ID));
  await db.insert(usersTable).values({ clerkUserId: OWNER_ID, role: "owner", companyId });

  // A second, fully separate tenant — used to prove Inspection Memory never
  // crosses company boundaries even when two tenants share a street address.
  const slug2 = "analyze-co-2";
  const [existing2] = await db.select().from(companiesTable).where(eq(companiesTable.slug, slug2));
  company2Id = existing2
    ? existing2.id
    : (await db.insert(companiesTable).values({ name: "Analyze Co 2", slug: slug2 }).returning())[0]
        .id;
  await db.delete(usersTable).where(eq(usersTable.clerkUserId, OWNER2_ID));
  await db.insert(usersTable).values({ clerkUserId: OWNER2_ID, role: "owner", companyId: company2Id });
});

beforeEach(() => {
  asUser(null);
  analyzePhotoMock.mockReset();
});

describe("mobile image registration and per-photo analysis progress", () => {
  it("analyzes all 4/4 persisted mobile images and publishes findings and zone coverage", async () => {
    const { inspectionId, imageUrls } = await createMobileInspectionWithFourImages("four-success");
    analyzePhotoMock.mockImplementation(async () => ({ ...pestPrediction(), zone: "kitchen_sanitation" }));
    const result = await analyzeAndCheckPersisted(inspectionId, imageUrls, Array(4).fill("completed"));
    expect(analyzePhotoMock).toHaveBeenCalledTimes(4);
    expect(result.status).toBe("complete");
    expect(result.analyzedImagePaths).toHaveLength(4);
    expect(result.findings).toHaveLength(4);
    expect(result.photoZones).toHaveProperty(imageUrls[0].replace("/api/storage", ""), "kitchen_sanitation");
    expect(result.coverage.coveredRequired.length).toBeGreaterThan(0);
    expect(result.analysisErrors).toBe(0);
  });

  it("persists 3 successes and 1 failure without losing other findings", async () => {
    const { inspectionId, imageUrls } = await createMobileInspectionWithFourImages("four-partial");
    analyzePhotoMock.mockImplementation(async (path: string) =>
      path.endsWith("-1") ? null : { ...pestPrediction(), zone: "kitchen_sanitation" },
    );
    const result = await analyzeAndCheckPersisted(
      inspectionId, imageUrls, ["completed", "failed", "completed", "completed"],
    );
    expect(result.status).toBe("partial");
    expect(result.analysisErrors).toBe(1);
    expect(result.analyzedImagePaths).toHaveLength(3);
    expect(result.findings).toHaveLength(3);
  });

  it("keeps successful findings and coverage when mobile retries only the failed path", async () => {
    const { inspectionId, imageUrls } = await createMobileInspectionWithFourImages("four-retry");
    analyzePhotoMock.mockImplementation(async (path: string) =>
      path.endsWith("-1") ? null : { ...pestPrediction(), zone: "kitchen_sanitation" },
    );
    const first = await analyzeAndCheckPersisted(
      inspectionId, imageUrls, ["completed", "failed", "completed", "completed"],
    );
    analyzePhotoMock.mockClear();
    analyzePhotoMock.mockResolvedValue({ ...pestPrediction(), zone: "exterior_perimeter" });
    const second = await analyzeAndCheckPersisted(
      inspectionId, [imageUrls[1]], ["completed", "completed", "completed", "completed"],
    );
    expect(analyzePhotoMock).toHaveBeenCalledTimes(1);
    expect(second.status).toBe("complete");
    expect(second.analyzedImagePaths).toHaveLength(4);
    expect(second.findings).toHaveLength(4);
    expect(second.coverage.coveredRequired.length).toBeGreaterThanOrEqual(first.coverage.coveredRequired.length);
  });

  it("persists 3 successes when one provider call times out or defers", async () => {
    const { inspectionId, imageUrls } = await createMobileInspectionWithFourImages("four-timeout");
    analyzePhotoMock.mockImplementation(async (path: string, _note: unknown, options: { onOutcome: (status: string) => void }) => {
      if (path.endsWith("-2")) {
        options.onOutcome("deferred");
        return null;
      }
      return { ...pestPrediction(), zone: "kitchen_sanitation" };
    });
    const result = await analyzeAndCheckPersisted(
      inspectionId, imageUrls, ["completed", "completed", "deferred", "completed"],
    );
    expect(result.status).toBe("partial");
    expect(result.analysisErrors).toBe(1);
    expect(result.analyzedImagePaths).toHaveLength(3);
  });

  it("turns a thrown provider error into one failed photo, not a failed request", async () => {
    const { inspectionId, imageUrls } = await createMobileInspectionWithFourImages("four-provider-error");
    analyzePhotoMock.mockImplementation(async (path: string) => {
      if (path.endsWith("-3")) throw new Error("provider unavailable");
      return { ...pestPrediction(), zone: "kitchen_sanitation" };
    });
    const result = await analyzeAndCheckPersisted(
      inspectionId, imageUrls, ["completed", "completed", "completed", "failed"],
    );
    expect(result.status).toBe("partial");
    expect(result.analysisErrors).toBe(1);
    expect(result.analyzedImagePaths).toHaveLength(3);
  });
});

describe("POST /analysis/analyze does not fabricate findings", () => {
  it("counts a failed photo in analysisErrors and persists no placeholder finding", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("fail");
    analyzePhotoMock.mockResolvedValueOnce(null); // storage/model/parse failure

    asUser(OWNER_ID);
    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: [{ imageUrl }] });

    expect(res.status).toBe(201);
    expect(res.body.analysisErrors).toBe(1);
    expect(res.body.findings).toEqual([]);

    // Nothing fabricated at the row level either.
    const [row] = await db
      .select()
      .from(analysisResultsTable)
      .where(eq(analysisResultsTable.id, res.body.id));
    expect(row.findings).toEqual([]);
  });

  it("does not create a finding for a clean photo (rationale/tags are not content)", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("clean");
    analyzePhotoMock.mockResolvedValueOnce(cleanPrediction());

    asUser(OWNER_ID);
    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: [{ imageUrl }] });

    expect(res.status).toBe(201);
    expect(res.body.analysisErrors).toBe(0);
    expect(res.body.findings).toEqual([]);
  });

  it("creates exactly one finding for a content-bearing prediction", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("pest");
    analyzePhotoMock.mockResolvedValueOnce(pestPrediction());

    asUser(OWNER_ID);
    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: [{ imageUrl }] });

    expect(res.status).toBe(201);
    expect(res.body.analysisErrors).toBe(0);
    expect(res.body.findings).toHaveLength(1);
    expect(res.body.findings[0].category).toBe("pest");
    expect(res.body.findings[0].imageUrl).toBe(imageUrl);

    // The live evidence tally is derived on read and rides on every response.
    expect(res.body.evidence).toBeTruthy();
    expect(res.body.evidence.totalEvidence).toBe(1);
    expect(res.body.evidence.photoEvidence).toBe(1);
    const pests = res.body.evidence.groups.find((g: { key: string }) => g.key === "pests");
    expect(pests?.total).toBe(1);
    expect(pests?.items[0].label).toBe("German cockroach");

    // Live Guidance rides on every response too, derived on read. A single
    // kitchen roach photo leaves the (always-required) exterior perimeter
    // uncovered, so the top next-task is the exclusion inspection.
    expect(res.body.guidance).toBeTruthy();
    expect(res.body.guidance.next).toBeTruthy();
    expect(res.body.guidance.next).toEqual(res.body.guidance.queue[0]);
    expect(res.body.guidance.next.category).toBe("missing_exclusion");
    expect(res.body.guidance.remaining).toBe(res.body.guidance.queue.length - 1);
  });

  it("mixes a failure and a real finding in one request", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("mix1");
    const imageUrl2 = `/api/storage/objects/companies/${companyId}/uploads/photo-mix2`;
    asUser(OWNER_ID);
    const media2 = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "photo", url: imageUrl2 });
    expect(media2.status).toBe(201);

    // First image fails, second is a real pest.
    analyzePhotoMock.mockResolvedValueOnce(null).mockResolvedValueOnce(pestPrediction());

    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: [{ imageUrl }, { imageUrl: imageUrl2 }] });

    expect(res.status).toBe(201);
    expect(res.body.analysisErrors).toBe(1);
    expect(res.body.findings).toHaveLength(1);
    expect(res.body.findings[0].imageUrl).toBe(imageUrl2);
  });
});

describe("POST /analysis/analyze carries over late-flagged duplicates", () => {
  // The mobile pixel-dedupe pass is async: a photo analyzed in run N can be
  // flagged `duplicateOf` afterwards and dropped from run N+1's submitted
  // images[]. Its already-verified finding and per-photo zone must survive,
  // or completeness/coverage would silently regress.
  it("preserves a prior finding + zone when the photo drops out of a later run", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("carry");
    const storagePath = imageUrl.replace(/^\/api\/storage/, "");
    analyzePhotoMock.mockResolvedValueOnce({ ...pestPrediction(), zone: "kitchen" });

    asUser(OWNER_ID);
    const run1 = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: [{ imageUrl }] });
    expect(run1.status).toBe(201);
    expect(run1.body.findings).toHaveLength(1);
    expect(analyzePhotoMock).toHaveBeenCalledTimes(1);

    // Run 2: photo flagged duplicate client-side and omitted from images[], but
    // it is still a saved media row -> carry its verified result over verbatim.
    const run2 = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: [] });
    expect(run2.status).toBe(201);
    // No new model call — the result is reused, never regenerated.
    expect(analyzePhotoMock).toHaveBeenCalledTimes(1);
    expect(run2.body.findings).toHaveLength(1);
    expect(run2.body.findings[0].imageUrl).toBe(imageUrl);
    expect(run2.body.analyzedImagePaths).toContain(storagePath);
    expect(run2.body.photoZones[storagePath]).toBe("kitchen");
  });

  it("drops a prior result when the media row no longer exists", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("carrydel");
    const ghostPath = imageUrl.replace(/^\/api\/storage/, "");
    analyzePhotoMock.mockResolvedValueOnce({ ...pestPrediction(), zone: "kitchen" });

    asUser(OWNER_ID);
    const run1 = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: [{ imageUrl }] });
    expect(run1.status).toBe(201);
    expect(run1.body.findings).toHaveLength(1);

    // Simulate the photo being deleted between runs: remove its media row. The
    // carry-over must NOT resurrect a finding for a path that is no longer saved.
    await db.delete(inspectionMediaTable).where(eq(inspectionMediaTable.inspectionId, inspectionId));

    const run2 = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: [] });
    expect(run2.status).toBe(201);
    expect(run2.body.findings).toEqual([]);
    expect(run2.body.analyzedImagePaths).not.toContain(ghostPath);
  });
});

describe("POST /analysis/analyze records video as evidence but never as findings", () => {
  /** Persist a company-scoped video media row and return its storage URL. */
  async function addVideo(inspectionId: number, suffix: string) {
    asUser(OWNER_ID);
    const url = `/api/storage/objects/companies/${companyId}/uploads/video-${suffix}`;
    const media = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "video", url, filename: `clip-${suffix}.webm`, durationSec: 12 });
    expect(media.status).toBe(201);
    return url;
  }

  it("records a video-only inspection as videoEvidence with zero findings", async () => {
    const { inspectionId } = await createInspectionWithPhoto("vidonly");
    const videoUrl = await addVideo(inspectionId, "vidonly");

    asUser(OWNER_ID);
    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({
        inspectionId,
        images: [],
        videos: [{ url: videoUrl, filename: "clip-vidonly.webm", durationSec: 12, label: "Kitchen walkthrough" }],
      });

    expect(res.status).toBe(201);
    // analyzePhoto must never be invoked for video.
    expect(analyzePhotoMock).not.toHaveBeenCalled();
    expect(res.body.findings).toEqual([]);
    expect(res.body.videoEvidence).toHaveLength(1);
    expect(res.body.videoEvidence[0].url).toBe(videoUrl);
    expect(res.body.videoEvidence[0].durationSec).toBe(12);
    expect(res.body.videoEvidence[0].frameAnalysisStatus).toBe("pending");
  });

  it("keeps findings from photos only while still recording the video as evidence", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("vidmix");
    const videoUrl = await addVideo(inspectionId, "vidmix");
    analyzePhotoMock.mockResolvedValueOnce(pestPrediction());

    asUser(OWNER_ID);
    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({
        inspectionId,
        images: [{ imageUrl }],
        videos: [{ url: videoUrl, durationSec: 8 }],
      });

    expect(res.status).toBe(201);
    // Exactly one finding, and it came from the photo — never the video.
    expect(analyzePhotoMock).toHaveBeenCalledTimes(1);
    expect(res.body.findings).toHaveLength(1);
    expect(res.body.findings[0].imageUrl).toBe(imageUrl);
    expect(res.body.videoEvidence).toHaveLength(1);
    expect(res.body.videoEvidence[0].url).toBe(videoUrl);
  });

  it("ignores video metadata that is not a persisted, company-scoped media row", async () => {
    const { inspectionId } = await createInspectionWithPhoto("vidspoof");
    const spoofedUrl = `/api/storage/objects/companies/${companyId}/uploads/video-never-saved`;

    asUser(OWNER_ID);
    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: [], videos: [{ url: spoofedUrl, durationSec: 5 }] });

    expect(res.status).toBe(201);
    expect(res.body.findings).toEqual([]);
    // Not persisted as media -> excluded from evidence (same guard as photos).
    expect(res.body.videoEvidence).toEqual([]);
  });

  it("does not record a persisted PHOTO url as video evidence", async () => {
    // A photo media row exists for this inspection, but submitting its URL under
    // videos[] must NOT be accepted as video evidence — evidence integrity.
    const { imageUrl, inspectionId } = await createInspectionWithPhoto("vidasphoto");

    asUser(OWNER_ID);
    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: [], videos: [{ url: imageUrl, durationSec: 5 }] });

    expect(res.status).toBe(201);
    // analyzePhoto must never run for a videos[] entry, even a spoofed photo one.
    expect(analyzePhotoMock).not.toHaveBeenCalled();
    expect(res.body.findings).toEqual([]);
    expect(res.body.videoEvidence).toEqual([]);
  });
});

describe("POST /analysis/analyze remembers prior visits (Inspection Memory)", () => {
  /** A rodent prediction that becomes a zoned finding (drives rodent memory). */
  function rodentPrediction(zone: string) {
    return {
      category: "pest",
      subcategory: "rodent",
      confidence: 0.9,
      tags: ["rodent", "droppings"],
      possiblePest: "House mouse",
      possibleConduciveCondition: null,
      possibleEntryPoint: null,
      suggestedCorrectiveAction: "Set snap traps along the wall",
      rationale: "Fresh rodent droppings observed",
      zone,
    };
  }

  /**
   * Run a complete inspection visit end to end: create the inspection at
   * `address`, persist one company-scoped photo, and analyze it with the given
   * prediction. Each call queues exactly one analyzePhoto result, consumed by the
   * single submitted image. Returns the analyze response for assertions.
   */
  async function runVisit(opts: {
    user: string;
    cid: number;
    address: string;
    suffix: string;
    prediction: Record<string, unknown>;
  }) {
    asUser(opts.user);
    const created = await request(app)
      .post("/api/inspections")
      .send({ siteAddress: opts.address, technicianName: "Tech", clientName: "Client" });
    expect(created.status).toBe(201);
    const inspectionId = created.body.id as number;

    const imageUrl = `/api/storage/objects/companies/${opts.cid}/uploads/photo-${opts.suffix}`;
    const media = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "photo", url: imageUrl });
    expect(media.status).toBe(201);

    analyzePhotoMock.mockResolvedValueOnce(opts.prediction);
    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: [{ imageUrl }] });
    expect(res.status).toBe(201);
    return { inspectionId, imageUrl, res };
  }

  it("surfaces prior pest activity and drives a memory-driven next task for an un-photographed rodent zone", async () => {
    const address = "10 Recurring Way";
    // PRIOR visit: rodents in the attic.
    await runVisit({
      user: OWNER_ID,
      cid: companyId,
      address,
      suffix: "mem-prior",
      prediction: rodentPrediction("attic_roofline"),
    });

    // CURRENT visit at the SAME address: technician only photographs the kitchen,
    // leaving the previously-active attic un-photographed today.
    const { res } = await runVisit({
      user: OWNER_ID,
      cid: companyId,
      address,
      suffix: "mem-current",
      prediction: { ...pestPrediction(), zone: "kitchen_sanitation" },
    });

    const memory = res.body.memory;
    expect(memory).toBeTruthy();
    expect(memory.hasPriorVisits).toBe(true);
    expect(memory.priorVisitCount).toBe(1);
    // SHOW list: prior rodent activity remembered verbatim (no invented numbers).
    expect(memory.pestActivity.map((p: { label: string }) => p.label)).toContain("House mouse");
    expect(JSON.stringify(memory)).not.toMatch(/station #\d/i);
    // GAP: previously-active rodent zone not photographed today.
    const gap = memory.highlights.find(
      (h: { zone: string }) => h.zone === "attic_roofline",
    );
    expect(gap?.type).toBe("rodent_area_not_photographed");
    // The gap is promoted into the Live Guidance Engine as the top next task,
    // ahead of every generic capture prompt.
    expect(res.body.guidance.next.category).toBe("memory_rodent");
    expect(res.body.guidance.next.zone).toBe("attic_roofline");
    expect(res.body.guidance.next).toEqual(res.body.guidance.queue[0]);
  });

  it("does NOT remember visits at a DIFFERENT address (same company)", async () => {
    await runVisit({
      user: OWNER_ID,
      cid: companyId,
      address: "1 Alpha Street",
      suffix: "addr-a",
      prediction: rodentPrediction("attic_roofline"),
    });
    const { res } = await runVisit({
      user: OWNER_ID,
      cid: companyId,
      address: "2 Beta Avenue",
      suffix: "addr-b",
      prediction: { ...pestPrediction(), zone: "kitchen_sanitation" },
    });

    expect(res.body.memory.hasPriorVisits).toBe(false);
    expect(res.body.memory.highlights).toEqual([]);
    // With no memory, guidance falls back to the generic exterior prompt.
    expect(res.body.guidance.next.category).toBe("missing_exclusion");
  });

  it("does NOT remember another company's visit at the SAME address", async () => {
    const address = "500 Shared Boulevard";
    // Another tenant inspected this exact address and found rodents.
    await runVisit({
      user: OWNER2_ID,
      cid: company2Id,
      address,
      suffix: "xco-prior",
      prediction: rodentPrediction("attic_roofline"),
    });

    // Our tenant's first-ever visit here must see NO memory from the other tenant.
    const { res } = await runVisit({
      user: OWNER_ID,
      cid: companyId,
      address,
      suffix: "xco-current",
      prediction: { ...pestPrediction(), zone: "kitchen_sanitation" },
    });

    expect(res.body.memory.hasPriorVisits).toBe(false);
    expect(res.body.memory.highlights).toEqual([]);
    expect(res.body.guidance.next.category).toBe("missing_exclusion");
  });

  it("also attaches memory on the list route the mobile app polls (GET /?inspectionId=)", async () => {
    const address = "77 Polled Place";
    await runVisit({
      user: OWNER_ID,
      cid: companyId,
      address,
      suffix: "list-prior",
      prediction: rodentPrediction("attic_roofline"),
    });
    const { inspectionId } = await runVisit({
      user: OWNER_ID,
      cid: companyId,
      address,
      suffix: "list-current",
      prediction: { ...pestPrediction(), zone: "kitchen_sanitation" },
    });

    asUser(OWNER_ID);
    const list = await request(app).get(`/api/analysis?inspectionId=${inspectionId}`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    // The latest analysis row for this inspection carries the same memory the
    // /analyze response did — so it survives react-query refetches and resume.
    const latest = list.body[0];
    expect(latest.memory.hasPriorVisits).toBe(true);
    expect(latest.memory.highlights.some((h: { zone: string }) => h.zone === "attic_roofline")).toBe(
      true,
    );
    expect(latest.guidance.next.category).toBe("memory_rodent");
  });
});

// ---------------------------------------------------------------------------
// failureReason persistence and serialization
// ---------------------------------------------------------------------------

describe("POST /analysis/analyze — failureReason persistence", () => {
  it("persists a user-safe failureReason when all new photos fail, and returns it via GET /analysis", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("fr-all-fail");
    // Every analyzePhoto call returns null → all-failure scenario.
    analyzePhotoMock.mockResolvedValueOnce(null);

    asUser(OWNER_ID);
    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: [{ imageUrl }] });

    expect(res.status).toBe(201);
    expect(res.body.analysisErrors).toBe(1);
    expect(res.body.findings).toEqual([]);
    expect(res.body.status).toBe("failed");
    expect(res.body.analyzedImagePaths).toEqual([]);
    // The response must carry a non-null failureReason so the mobile
    // summary screen can surface it instead of the generic fallback.
    expect(typeof res.body.failureReason).toBe("string");
    expect(res.body.failureReason).toBeTruthy();

    // Verify the reason is also returned by the GET list endpoint
    // (failureReason is persisted in the DB row and serialized via ...row spread).
    const listRes = await request(app).get(`/api/analysis?inspectionId=${inspectionId}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body[0].failureReason).toBe(res.body.failureReason);
  });

  it("does NOT set failureReason when at least one photo succeeds (partial success)", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("fr-partial");
    const imageUrl2 = `/api/storage/objects/companies/${companyId}/uploads/photo-fr-partial2`;
    asUser(OWNER_ID);
    await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "photo", url: imageUrl2 });

    // First fails, second succeeds.
    analyzePhotoMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(pestPrediction());

    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: [{ imageUrl }, { imageUrl: imageUrl2 }] });

    expect(res.status).toBe(201);
    expect(res.body.analysisErrors).toBe(1);
    expect(res.body.status).toBe("partial");
    expect(res.body.analyzedImagePaths).toEqual([imageUrl2.replace("/api/storage", "")]);
    // Partial success → failureReason is null.
    expect(res.body.failureReason).toBeNull();
  });

  it("does NOT set failureReason when all photos succeed", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("fr-success");
    analyzePhotoMock.mockResolvedValueOnce(pestPrediction());

    asUser(OWNER_ID);
    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: [{ imageUrl }] });

    expect(res.status).toBe(201);
    expect(res.body.analysisErrors).toBe(0);
    expect(res.body.status).toBe("complete");
    expect(res.body.failureReason).toBeNull();
  });

  it("does NOT set failureReason when no new photos are submitted (cached run)", async () => {
    // First run: analyze one photo successfully.
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("fr-cached");
    analyzePhotoMock.mockResolvedValueOnce(pestPrediction());

    asUser(OWNER_ID);
    await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: [{ imageUrl }] });

    // Second run: same photo, now cached — no new analysis calls, no errors.
    analyzePhotoMock.mockReset(); // should not be called
    const res2 = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: [{ imageUrl }] });

    expect(res2.status).toBe(201);
    expect(res2.body.analysisErrors).toBe(0);
    expect(res2.body.failureReason).toBeNull();
  });
});

describe("POST /analysis/analyze — bounded photo concurrency", () => {
  it("processes a photo batch concurrently without exceeding three provider calls", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("concurrency-0");
    const imageUrls = [imageUrl];
    asUser(OWNER_ID);
    for (let i = 1; i < 12; i++) {
      const url = `/api/storage/objects/companies/${companyId}/uploads/photo-concurrency-${i}`;
      const media = await request(app)
        .post(`/api/inspections/${inspectionId}/media`)
        .send({ mediaType: "photo", url });
      expect(media.status).toBe(201);
      imageUrls.push(url);
    }

    let active = 0;
    let maxActive = 0;
    analyzePhotoMock.mockImplementation(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
      return cleanPrediction();
    });

    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: imageUrls.map((url) => ({ imageUrl: url })) });

    expect(res.status).toBe(201);
    expect(analyzePhotoMock).toHaveBeenCalledTimes(12);
    expect(maxActive).toBe(3);
    expect(res.body.status).toBe("complete");
    expect(res.body.analyzedImagePaths).toHaveLength(12);
  });
});

describe("POST /analysis/analyze — per-photo outcomes and single flight", () => {
  async function addPhotos(inspectionId: number, firstUrl: string, count: number) {
    const urls = [firstUrl];
    asUser(OWNER_ID);
    for (let i = 1; i < count; i++) {
      const url = `/api/storage/objects/companies/${companyId}/uploads/photo-outcome-${inspectionId}-${i}`;
      const media = await request(app)
        .post(`/api/inspections/${inspectionId}/media`)
        .send({ mediaType: "photo", url });
      expect(media.status).toBe(201);
      urls.push(url);
    }
    return urls;
  }

  it("returns partial for 10 completed and 2 failed photos without counting failures as analyzed", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("outcomes-mixed");
    const imageUrls = await addPhotos(inspectionId, imageUrl, 12);
    let call = 0;
    analyzePhotoMock.mockImplementation(async (
      _path: string,
      _note: string | null,
      options: { onOutcome?: (status: string) => void },
    ) => {
      call++;
      if (call <= 10) {
        options.onOutcome?.("completed");
        return cleanPrediction();
      }
      options.onOutcome?.("failed");
      return null;
    });

    asUser(OWNER_ID);
    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: imageUrls.map((url) => ({ imageUrl: url })) });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("partial");
    expect(res.body.analysisErrors).toBe(2);
    expect(res.body.analyzedImagePaths).toHaveLength(10);
    expect(res.body.photoOutcomes).toHaveLength(12);
    expect(res.body.photoOutcomes.filter((p: { status: string }) => p.status === "completed")).toHaveLength(10);
    expect(res.body.photoOutcomes.filter((p: { status: string }) => p.status === "failed")).toHaveLength(2);
  });

  it("persists explicit rate_limited and deferred outcomes as a failed run", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("outcomes-deferred");
    const imageUrls = await addPhotos(inspectionId, imageUrl, 2);
    analyzePhotoMock
      .mockImplementationOnce(async (
        _path: string,
        _note: string | null,
        options: { onOutcome?: (status: string) => void },
      ) => {
        options.onOutcome?.("rate_limited");
        return null;
      })
      .mockImplementationOnce(async (
        _path: string,
        _note: string | null,
        options: { onOutcome?: (status: string) => void },
      ) => {
        options.onOutcome?.("deferred");
        return null;
      });

    asUser(OWNER_ID);
    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: imageUrls.map((url) => ({ imageUrl: url })) });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("failed");
    expect(res.body.analyzedImagePaths).toEqual([]);
    expect(res.body.photoOutcomes.map((p: { status: string }) => p.status).sort()).toEqual([
      "deferred",
      "rate_limited",
    ]);
  });

  it("shares provider work and the persisted result across simultaneous requests", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("single-flight");
    analyzePhotoMock.mockImplementation(async (
      _path: string,
      _note: string | null,
      options: { onOutcome?: (status: string) => void },
    ) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      options.onOutcome?.("completed");
      return cleanPrediction();
    });

    asUser(OWNER_ID);
    const [first, second] = await Promise.all([
      request(app)
        .post("/api/analysis/analyze")
        .send({ inspectionId, images: [{ imageUrl }] }),
      request(app)
        .post("/api/analysis/analyze")
        .send({ inspectionId, images: [{ imageUrl }] }),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(analyzePhotoMock).toHaveBeenCalledTimes(1);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.photoOutcomes).toEqual(first.body.photoOutcomes);
  });

  it("does not share provider work for distinct payloads on one inspection", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("single-flight-distinct");
    analyzePhotoMock.mockImplementation(async (
      _path: string,
      _note: string | null,
      options: { onOutcome?: (status: string) => void },
    ) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      options.onOutcome?.("completed");
      return cleanPrediction();
    });

    asUser(OWNER_ID);
    const [first, second] = await Promise.all([
      request(app)
        .post("/api/analysis/analyze")
        .send({ inspectionId, images: [{ imageUrl, label: "Kitchen" }] }),
      request(app)
        .post("/api/analysis/analyze")
        .send({ inspectionId, images: [{ imageUrl, label: "Attic" }] }),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(analyzePhotoMock).toHaveBeenCalledTimes(2);
    expect(second.body.id).not.toBe(first.body.id);
  });

  it("deduplicates eligible paths and ignores invalid entries before the cap", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("cap-invalid-duplicate");
    const imageUrls = await addPhotos(inspectionId, imageUrl, 40);
    analyzePhotoMock.mockResolvedValue(cleanPrediction());

    asUser(OWNER_ID);
    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({
        inspectionId,
        images: [
          { imageUrl: `/api/storage/objects/companies/${companyId}/uploads/not-saved` },
          ...Array.from({ length: 8 }, () => ({ imageUrl })),
          ...imageUrls.map((url) => ({ imageUrl: url })),
        ],
      });

    expect(res.status).toBe(201);
    expect(analyzePhotoMock).toHaveBeenCalledTimes(40);
    expect(res.body.photoOutcomes).toHaveLength(40);
    expect(res.body.analysisErrors).toBe(0);
  });

  it("calls the provider and records one outcome for repeated eligible paths", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("dedupe-outcome");
    analyzePhotoMock.mockResolvedValue(cleanPrediction());

    asUser(OWNER_ID);
    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({
        inspectionId,
        images: [{ imageUrl }, { imageUrl, label: "same photo" }, { imageUrl }],
      });

    expect(res.status).toBe(201);
    expect(analyzePhotoMock).toHaveBeenCalledTimes(1);
    expect(res.body.photoOutcomes).toHaveLength(1);
    expect(res.body.photoOutcomes[0].imagePath).toBe(imageUrl.replace("/api/storage", ""));
  });

  it("defers unique eligible images beyond 40 and reports a partial result", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("overflow-deferred");
    const imageUrls = await addPhotos(inspectionId, imageUrl, 41);
    analyzePhotoMock.mockResolvedValue(cleanPrediction());

    asUser(OWNER_ID);
    const res = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: imageUrls.map((url) => ({ imageUrl: url })) });

    expect(res.status).toBe(201);
    expect(analyzePhotoMock).toHaveBeenCalledTimes(40);
    expect(res.body.photoOutcomes).toHaveLength(41);
    expect(res.body.photoOutcomes.filter((p: { status: string }) => p.status === "deferred"))
      .toHaveLength(1);
    expect(res.body.analysisErrors).toBe(1);
    expect(res.body.status).toBe("partial");
    expect(res.body.analyzedImagePaths).toHaveLength(40);
  });

  it("keeps a cached path in the overflow position completed", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("cached-overflow");
    const imageUrls = await addPhotos(inspectionId, imageUrl, 41);
    const cachedUrl = imageUrls[40];

    analyzePhotoMock.mockResolvedValueOnce(cleanPrediction());
    asUser(OWNER_ID);
    const first = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: [{ imageUrl: cachedUrl }] });
    expect(first.status).toBe(201);

    analyzePhotoMock.mockReset().mockResolvedValue(cleanPrediction());
    const second = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: imageUrls.map((url) => ({ imageUrl: url })) });

    expect(second.status).toBe(201);
    expect(analyzePhotoMock).toHaveBeenCalledTimes(40);
    expect(second.body.status).toBe("complete");
    expect(second.body.analysisErrors).toBe(0);
    expect(second.body.photoOutcomes).toHaveLength(41);
    const cachedOutcomes = second.body.photoOutcomes.filter(
      (photo: { imagePath: string }) => photo.imagePath === cachedUrl.replace("/api/storage", ""),
    );
    expect(cachedOutcomes).toHaveLength(1);
    expect(cachedOutcomes[0].status).toBe("completed");
    expect(cachedOutcomes.some((photo: { status: string }) => photo.status === "deferred")).toBe(false);
  });

  it("runs one new photo after 40 cached photos", async () => {
    const { inspectionId, imageUrl } = await createInspectionWithPhoto("cached-plus-new");
    const cachedUrls = await addPhotos(inspectionId, imageUrl, 40);

    analyzePhotoMock.mockResolvedValue(cleanPrediction());
    asUser(OWNER_ID);
    const first = await request(app)
      .post("/api/analysis/analyze")
      .send({ inspectionId, images: cachedUrls.map((url) => ({ imageUrl: url })) });
    expect(first.status).toBe(201);
    expect(first.body.analyzedImagePaths).toHaveLength(40);

    const newUrl = `/api/storage/objects/companies/${companyId}/uploads/photo-cached-plus-new-extra`;
    const media = await request(app)
      .post(`/api/inspections/${inspectionId}/media`)
      .send({ mediaType: "photo", url: newUrl });
    expect(media.status).toBe(201);

    analyzePhotoMock.mockReset().mockResolvedValue(cleanPrediction());
    const second = await request(app)
      .post("/api/analysis/analyze")
      .send({
        inspectionId,
        images: [...cachedUrls, newUrl].map((url) => ({ imageUrl: url })),
      });

    expect(second.status).toBe(201);
    expect(analyzePhotoMock).toHaveBeenCalledTimes(1);
    expect(second.body.status).toBe("complete");
    expect(second.body.analysisErrors).toBe(0);
    expect(second.body.photoOutcomes).toHaveLength(41);
    expect(second.body.photoOutcomes.filter(
      (photo: { imagePath: string; status: string }) =>
        photo.imagePath === newUrl.replace("/api/storage", "") && photo.status === "completed",
    )).toHaveLength(1);
  });
});
