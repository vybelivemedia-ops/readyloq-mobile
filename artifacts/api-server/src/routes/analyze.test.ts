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

// Control the vision model per test. `analyzePhoto` is the failure-aware entry
// point used by /analysis/analyze (null => failure). `generateAiPrediction` and
// `fallbackPrediction` are exported for the intelligence-dataset contribute flow
// and are stubbed so the full app graph imports cleanly.
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
let companyId: number;

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
});

beforeEach(() => {
  asUser(null);
  analyzePhotoMock.mockReset();
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
