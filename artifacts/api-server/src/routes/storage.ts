import { Router, type IRouter, type Request, type Response } from "express";
import { appendProcessingMilestone } from "../lib/inspection-processing-events";
import { Readable } from "stream";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  companiesTable,
  inspectionMediaTable,
  inspectionUploadIntentsTable,
  inspectionsTable,
} from "@workspace/db";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  ObjectStorageService,
  ObjectNotFoundError,
  InspectionUploadConstraintError,
  InspectionUploadTimeoutError,
  objectPathCompanyScope,
} from "../lib/objectStorage";
import {
  requireAuth,
  requireCompany,
  requireBetaAccess,
  requireRole,
} from "../middleware/require-auth";
import { getCompanyId } from "../lib/tenant";
import { logErrorEvent } from "../lib/error-events";

// Objects uploaded before multi-tenancy carry no company segment and belong to
// the reserved "legacy" company. Cache its id so serve-time checks stay cheap.
let legacyCompanyIdCache: number | null = null;
async function getLegacyCompanyId(): Promise<number | null> {
  if (legacyCompanyIdCache != null) return legacyCompanyIdCache;
  const [row] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.slug, "legacy"));
  legacyCompanyIdCache = row?.id ?? null;
  return legacyCompanyIdCache;
}

const RequestUploadUrlBody = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().positive().max(150 * 1024 * 1024).optional(),
  contentType: z.string().min(1).max(255).optional(),
  purpose: z.enum(["generic", "inspection-evidence"]).optional(),
});
const InspectionUploadUrlBody = RequestUploadUrlBody.extend({
  purpose: z.literal("inspection-evidence"),
  inspectionId: z.number().int().positive(),
  mediaType: z.enum(["photo", "image", "video", "document", "audio", "voice"]),
  clientKey: z.string().trim().min(1).max(200),
  size: z.number().int().positive().max(150 * 1024 * 1024),
  contentType: z.string().min(1).max(255),
  checksum: z.object({
    algorithm: z.literal("md5"),
    value: z.string().regex(/^[A-Za-z0-9+/]{22}==$/),
  }).optional(),
});
const RequestUploadUrlResponse = z.object({
  uploadURL: z.string(),
  objectPath: z.string(),
  uploadIntentId: z.number().int().positive().optional(),
  metadata: z.object({ name: z.string(), size: z.number().optional(), contentType: z.string().optional() }).optional(),
});

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const MAX_ACTIVE_INSPECTION_UPLOADS = 16;
const MAX_ACTIVE_UPLOADS_PER_OWNER = 3;
let activeInspectionUploads = 0;
const activeUploadsByOwner = new Map<string, number>();

function canManageInspectionUploads(
  user: { role: string; clerkUserId: string },
  inspection: { technicianId: string | null },
): boolean {
  return (
    user.role === "manager" ||
    user.role === "owner" ||
    (user.role === "technician" && inspection.technicianId === user.clerkUserId)
  );
}

/**
 * POST /storage/uploads/request-url
 *
 * Request an upload URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Inspection evidence is streamed through an authenticated endpoint with a
 * GCS create-only generation precondition. Explicit generic assets retain
 * their separate presigned-URL flow.
 *
 * Requires authentication — only signed-in users (technicians uploading
 * inspection photos, managers uploading branding assets) may mint upload URLs.
 */
router.post(
  "/storage/uploads/request-url",
  requireAuth,
  requireCompany,
  requireBetaAccess,
  async (req: Request, res: Response) => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid required fields" });
      return;
    }

    try {
      const companyId = getCompanyId(req);
      const inspectionBody = InspectionUploadUrlBody.safeParse(req.body);

      if (req.body && typeof req.body === "object" && "inspectionId" in req.body) {
        if (!inspectionBody.success) {
          res.status(400).json({ error: "Invalid inspection upload reservation", detail: inspectionBody.error.issues });
          return;
        }
        const { name, size, contentType, inspectionId, mediaType, clientKey, checksum } =
          inspectionBody.data;
        const contentTypeLower = contentType.split(";")[0].trim().toLowerCase();
        const mediaTypeAcceptsContentType =
          ((mediaType === "photo" || mediaType === "image") && contentTypeLower.startsWith("image/")) ||
          (mediaType === "video" && contentTypeLower.startsWith("video/")) ||
          ((mediaType === "audio" || mediaType === "voice") && contentTypeLower.startsWith("audio/")) ||
          (mediaType === "document" &&
            (contentTypeLower === "application/pdf" || contentTypeLower.startsWith("image/")));
        if (!mediaTypeAcceptsContentType) {
          res.status(400).json({ error: "Media type and content type do not match" });
          return;
        }

        const [inspection] = await db
          .select({
            id: inspectionsTable.id,
            technicianId: inspectionsTable.technicianId,
          })
          .from(inspectionsTable)
          .where(and(
            eq(inspectionsTable.id, inspectionId),
            eq(inspectionsTable.companyId, companyId),
          ));
        if (!inspection) {
          res.status(404).json({ error: "Inspection not found" });
          return;
        }
        if (!canManageInspectionUploads(req.user!, inspection)) {
          res.status(403).json({
            error: "You can only upload evidence to your own inspections",
          });
          return;
        }

        const userId = req.user!.id;
        const [existing] = await db
          .select()
          .from(inspectionUploadIntentsTable)
          .where(and(
            eq(inspectionUploadIntentsTable.userId, userId),
            eq(inspectionUploadIntentsTable.companyId, companyId),
            eq(inspectionUploadIntentsTable.inspectionId, inspectionId),
            eq(inspectionUploadIntentsTable.clientKey, clientKey),
          ));
        const expectationsMatch = (intent: typeof inspectionUploadIntentsTable.$inferSelect) =>
          intent.mediaType === mediaType &&
          intent.contentType === contentTypeLower &&
          intent.expectedSize === size &&
          intent.checksumAlgorithm === (checksum?.algorithm ?? null) &&
          intent.checksumValue === (checksum?.value ?? null);

        if (existing && !expectationsMatch(existing)) {
          res.status(409).json({ error: "Upload key was already reserved for different evidence" });
          return;
        }
        if (existing?.state === "registered") {
          res.json({
            uploadURL: "",
            objectPath: existing.objectPath,
            uploadIntentId: existing.id,
          });
          return;
        }

        let intent = existing;
        if (!intent) {
          const objectPath = objectStorageService.createInspectionUploadPath(companyId);
          const inserted = await db.transaction(async (tx) => {
            const [created] = await tx
            .insert(inspectionUploadIntentsTable)
            .values({
              userId,
              companyId,
              inspectionId,
              clientKey,
              mediaType,
              contentType: contentTypeLower,
              expectedSize: size,
              checksumAlgorithm: checksum?.algorithm ?? null,
              checksumValue: checksum?.value ?? null,
              objectPath,
              expiresAt: new Date(Date.now() + 15 * 60 * 1000),
            })
            .onConflictDoNothing({
              target: [
                inspectionUploadIntentsTable.userId,
                inspectionUploadIntentsTable.companyId,
                inspectionUploadIntentsTable.inspectionId,
                inspectionUploadIntentsTable.clientKey,
              ],
            })
            .returning();
            if (created) await appendProcessingMilestone(tx, {
              companyId, inspectionId, eventType: "upload.reserved",
              sourceType: "inspection_upload_intents", sourceId: created.id,
              actor: `user:${userId}`, occurredAt: created.createdAt,
            });
            return created;
          });
          intent = inserted;
          if (!intent) {
            const [winner] = await db
              .select()
              .from(inspectionUploadIntentsTable)
              .where(and(
                eq(inspectionUploadIntentsTable.userId, userId),
                eq(inspectionUploadIntentsTable.companyId, companyId),
                eq(inspectionUploadIntentsTable.inspectionId, inspectionId),
                eq(inspectionUploadIntentsTable.clientKey, clientKey),
              ));
            if (!winner || !expectationsMatch(winner) || winner.state !== "reserved") {
              res.status(409).json({ error: "Upload reservation conflicts with an earlier request" });
              return;
            }
            intent = winner;
          }
        }

        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        const [refreshed] = await db
          .update(inspectionUploadIntentsTable)
          .set({ expiresAt })
          .where(and(
            eq(inspectionUploadIntentsTable.id, intent.id),
            eq(inspectionUploadIntentsTable.state, "reserved"),
          ))
          .returning({ id: inspectionUploadIntentsTable.id });
        if (!refreshed) {
          const [current] = await db
            .select()
            .from(inspectionUploadIntentsTable)
            .where(eq(inspectionUploadIntentsTable.id, intent.id));
          if (current?.state === "registered") {
            res.json({
              uploadURL: "",
              objectPath: current.objectPath,
              uploadIntentId: current.id,
            });
            return;
          }
          res.status(409).json({ error: "Upload reservation is no longer active" });
          return;
        }
        const uploadURL = `/api/storage/uploads/intents/${intent.id}/content`;
        res.json(RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath: intent.objectPath,
          uploadIntentId: intent.id,
          metadata: { name, size, contentType: contentTypeLower },
        }));
        return;
      }

      // Legacy callers did not identify whether they were uploading inspection
      // evidence or a non-evidence asset. First-party generic upload callers
      // now opt in explicitly; anything still using the ambiguous pre-intent
      // contract fails before receiving a URL. Old clients retain their local
      // bytes, but cannot sync until upgraded.
      if (parsed.data.purpose !== "generic") {
        res.setHeader("Upgrade", "inspection-upload-intents-v1");
        res.status(426).json({
          error: "Inspection evidence uploads require an updated client",
          code: "inspection_upload_upgrade_required",
          minimumClientContract: "inspection-upload-intents-v1",
          migration: "Upgrade the client to reserve an inspection upload intent before PUT; retry the retained local evidence after upgrading.",
        });
        return;
      }

      // Non-inspection objects (for example branding assets) keep their
      // existing upload behavior when explicitly marked as generic. Such paths
      // have no upload-intent and cannot be attached to inspection evidence.
      const { name, size, contentType } = parsed.data;
      const uploadURL = await objectStorageService.getObjectEntityUploadURL(companyId);
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, "Error generating upload URL");
      void logErrorEvent("upload", {
        companyId: req.user?.companyId ?? 0,
        userId: req.user?.id,
        message: "Failed to generate upload URL",
        context: { code: "request_url_failed" },
      });
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  },
);

router.put(
  "/storage/uploads/intents/:intentId/content",
  requireAuth,
  requireCompany,
  requireBetaAccess,
  async (req: Request, res: Response) => {
    const intentId = Number(req.params.intentId);
    if (!Number.isSafeInteger(intentId) || intentId <= 0) {
      req.resume();
      res.status(404).json({ error: "Upload reservation not found" });
      return;
    }
    try {
      const companyId = getCompanyId(req);
      const [intent] = await db
        .select()
        .from(inspectionUploadIntentsTable)
        .where(and(
          eq(inspectionUploadIntentsTable.id, intentId),
          eq(inspectionUploadIntentsTable.userId, req.user!.id),
          eq(inspectionUploadIntentsTable.companyId, companyId),
        ));
      if (!intent) {
        req.resume();
        res.status(404).json({ error: "Upload reservation not found" });
        return;
      }
      const [inspection] = await db
        .select({
          id: inspectionsTable.id,
          technicianId: inspectionsTable.technicianId,
        })
        .from(inspectionsTable)
        .where(and(
          eq(inspectionsTable.id, intent.inspectionId),
          eq(inspectionsTable.companyId, companyId),
        ));
      if (!inspection) {
        req.resume();
        res.status(404).json({ error: "Upload reservation not found" });
        return;
      }
      if (!canManageInspectionUploads(req.user!, inspection)) {
        req.resume();
        res.status(403).json({ error: "You can only upload evidence to your own inspections" });
        return;
      }
      if (intent.state !== "reserved" || intent.expiresAt <= new Date()) {
        req.resume();
        res.status(409).json({ error: "Upload reservation is no longer active" });
        return;
      }
      const contentType = (req.headers["content-type"] ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      if (contentType !== intent.contentType) {
        req.resume();
        res.status(400).json({ error: "Content type does not match upload reservation" });
        return;
      }
      if (req.headers["x-goog-if-generation-match"] !== "0") {
        req.resume();
        res.status(400).json({ error: "Create-only upload precondition is required" });
        return;
      }
      const contentLength = req.headers["content-length"];
      if (contentLength !== undefined && Number(contentLength) !== intent.expectedSize) {
        if (Number(contentLength) > intent.expectedSize) {
          res.setHeader("Connection", "close");
          res.once("finish", () => req.destroy());
          res.status(413).json({ error: "Content length exceeds upload reservation" });
          return;
        }
        req.resume();
        res.status(400).json({ error: "Content length does not match upload reservation" });
        return;
      }

      const ownerKey = `${companyId}:${req.user!.id}`;
      const ownerActive = activeUploadsByOwner.get(ownerKey) ?? 0;
      if (
        activeInspectionUploads >= MAX_ACTIVE_INSPECTION_UPLOADS ||
        ownerActive >= MAX_ACTIVE_UPLOADS_PER_OWNER
      ) {
        req.resume();
        res.setHeader("Retry-After", "30");
        res.status(429).json({ error: "Too many inspection uploads are active" });
        return;
      }
      activeInspectionUploads += 1;
      activeUploadsByOwner.set(ownerKey, ownerActive + 1);
      try {
        const uploadResult = await objectStorageService.uploadInspectionStream(companyId, intent.objectPath, req, {
          contentType: intent.contentType,
          expectedSize: intent.expectedSize,
          ...(intent.checksumAlgorithm === "md5" && intent.checksumValue
            ? { checksum: { algorithm: "md5" as const, value: intent.checksumValue } }
            : {}),
        });
        if (uploadResult === "already-exists") req.resume();
        res.status(204).end();
      } finally {
        activeInspectionUploads -= 1;
        const remainingOwnerUploads = (activeUploadsByOwner.get(ownerKey) ?? 1) - 1;
        if (remainingOwnerUploads <= 0) activeUploadsByOwner.delete(ownerKey);
        else activeUploadsByOwner.set(ownerKey, remainingOwnerUploads);
      }
    } catch (error) {
      if (error instanceof InspectionUploadConstraintError) {
        if (error.closeConnection) {
          res.setHeader("Connection", "close");
          res.once("finish", () => req.destroy());
          res.status(413).json({ error: error.message });
          return;
        }
        res.status(400).json({ error: error.message });
        return;
      }
      if (error instanceof InspectionUploadTimeoutError) {
        res.setHeader("Connection", "close");
        res.once("finish", () => req.destroy());
        res.status(408).json({ error: "Inspection upload timed out; retry the same reservation" });
        return;
      }
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Upload reservation object is invalid" });
        return;
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        Number((error as { code: unknown }).code) === 412
      ) {
        res.status(412).json({ error: "Object already exists with different upload metadata" });
        return;
      }
      req.log.error({ err: error }, "Error storing reserved inspection upload");
      res.status(500).json({
        error: "Failed to store inspection upload",
        code: "inspection_upload_storage_unavailable",
      });
    }
  },
);

const RECONCILIATION_PAGE_SIZE = 500;
async function listCompanyIntentRows(companyId: number) {
  const result: Array<{
    intent: typeof inspectionUploadIntentsTable.$inferSelect;
    inspectionExists: boolean;
  }> = [];
  let lastId = 0;
  while (true) {
    const page = await db.select({
      intent: inspectionUploadIntentsTable,
      inspectionExists: sql<boolean>`${inspectionsTable.id} IS NOT NULL`,
    })
      .from(inspectionUploadIntentsTable)
      .leftJoin(inspectionsTable, and(
        eq(inspectionsTable.id, inspectionUploadIntentsTable.inspectionId),
        eq(inspectionsTable.companyId, inspectionUploadIntentsTable.companyId),
      ))
      .where(and(
        eq(inspectionUploadIntentsTable.companyId, companyId),
        gt(inspectionUploadIntentsTable.id, lastId),
      ))
      .orderBy(inspectionUploadIntentsTable.id)
      .limit(RECONCILIATION_PAGE_SIZE);
    if (page.length === 0) break;
    result.push(...page);
    lastId = page[page.length - 1].intent.id;
    if (page.length < RECONCILIATION_PAGE_SIZE) break;
  }
  return result;
}

async function listCompanyInspectionMedia(companyId: number) {
  const result: Array<typeof inspectionMediaTable.$inferSelect> = [];
  let lastId = 0;
  while (true) {
    const page = await db.select()
      .from(inspectionMediaTable)
      .where(and(
        eq(inspectionMediaTable.companyId, companyId),
        gt(inspectionMediaTable.id, lastId),
      ))
      .orderBy(inspectionMediaTable.id)
      .limit(RECONCILIATION_PAGE_SIZE);
    if (page.length === 0) break;
    result.push(...page);
    lastId = page[page.length - 1].id;
    if (page.length < RECONCILIATION_PAGE_SIZE) break;
  }
  return result;
}

function mediaObjectPath(url: string): string {
  const normalized = url.replace(/^\/api\/storage/, "").trim();
  if (!normalized.startsWith("https://storage.googleapis.com/")) return normalized;
  try {
    const pathname = new URL(normalized).pathname;
    const objectIndex = pathname.indexOf("/objects/");
    return objectIndex >= 0 ? pathname.slice(objectIndex) : pathname;
  } catch {
    return normalized;
  }
}

router.get(
  "/storage/uploads/reconciliation",
  requireAuth,
  requireCompany,
  requireBetaAccess,
  requireRole("manager"),
  async (req: Request, res: Response) => {
    try {
      const companyId = getCompanyId(req);
      const [rows, mediaRows, storageObjects] = await Promise.all([
        listCompanyIntentRows(companyId),
        listCompanyInspectionMedia(companyId),
        objectStorageService.listCompanyUploadObjects(companyId),
      ]);
      const objectPaths = new Set(storageObjects.objectPaths);
      const byPath = new Map(rows.map(({ intent }) => [intent.objectPath, { intent }]));
      const intentByMediaId = new Map(
        rows.flatMap(({ intent }) =>
          intent.registeredMediaId == null ? [] : [[intent.registeredMediaId, intent] as const],
        ),
      );
      const mediaByPath = new Map<string, typeof mediaRows>();
      for (const media of mediaRows) {
        const path = mediaObjectPath(media.url);
        const references = mediaByPath.get(path) ?? [];
        references.push(media);
        mediaByPath.set(path, references);
      }
      const now = new Date();
      const findings = {
        intentWithoutObject: [] as Array<Record<string, unknown>>,
        objectWithoutCompletedRegistration: [] as Array<Record<string, unknown>>,
        registrationWithoutObject: [] as Array<Record<string, unknown>>,
        abandonedUpload: [] as Array<Record<string, unknown>>,
        inspectionDeleted: [] as Array<Record<string, unknown>>,
        mediaReferencedObject: [] as Array<Record<string, unknown>>,
        generatedReplacement: [] as Array<Record<string, unknown>>,
      };
      for (const { intent, inspectionExists } of rows) {
        const objectExists = objectPaths.has(intent.objectPath);
        const finding = {
          intentId: intent.id,
          inspectionId: intent.inspectionId,
          objectPath: intent.objectPath,
          state: intent.state,
          objectExists,
          expiresAt: intent.expiresAt.toISOString(),
        };
        if (!objectExists) findings.intentWithoutObject.push(finding);
        if (intent.state === "registered" && !objectExists) {
          findings.registrationWithoutObject.push(finding);
        }
        if (intent.state === "reserved" && intent.expiresAt <= now) {
          findings.abandonedUpload.push(finding);
        }
        if (!inspectionExists) findings.inspectionDeleted.push(finding);
      }
      for (const objectPath of objectPaths) {
        const intent = byPath.get(objectPath);
        const mediaReferences = mediaByPath.get(objectPath) ?? [];
        if (mediaReferences.length > 0) {
          const sourceIntent = mediaReferences
            .map((media) => intentByMediaId.get(media.id))
            .find((candidate) => candidate && candidate.objectPath !== objectPath);
          const mediaReference = {
            objectPath,
            mediaIds: mediaReferences.map((media) => media.id),
            inspectionIds: [...new Set(mediaReferences.map((media) => media.inspectionId))],
            sourceIntentId: sourceIntent?.id ?? null,
          };
          findings.mediaReferencedObject.push(mediaReference);
          if (sourceIntent) findings.generatedReplacement.push(mediaReference);
          continue;
        }
        if (!intent || intent.intent.state !== "registered") {
          findings.objectWithoutCompletedRegistration.push({
            objectPath,
            intentId: intent?.intent.id ?? null,
            state: intent?.intent.state ?? "no_intent",
          });
        }
      }
      res.json({
        destructiveCleanup: false,
        truncated: false,
        findings,
        counts: Object.fromEntries(
          Object.entries(findings).map(([key, value]) => [key, value.length]),
        ),
        note: "Read-only snapshot. Define retention, restore, and legal-hold policy before any cleanup.",
      });
    } catch (error) {
      req.log.error({ err: error }, "Failed to reconcile inspection upload intents");
      res.status(503).json({ error: "Upload reconciliation is temporarily unavailable" });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve private object entities (inspection photos, voice notes) from
 * PRIVATE_OBJECT_DIR. Requires auth + a company. Browser <img>/fetch requests
 * are same-origin, so the Clerk session cookie is sent automatically.
 *
 * Tenant boundary: an object's owning company is encoded in its path
 * (companies/{id}/...). Callers may only read objects belonging to their own
 * company; legacy (pre-tenancy) objects require legacy-company membership. Any
 * mismatch 404s — we never reveal that another company's object exists.
 */
router.get(
  "/storage/objects/*path",
  requireAuth,
  requireCompany,
  requireBetaAccess,
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.path;
      const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
      const objectPath = `/objects/${wildcardPath}`;

      const callerCompanyId = getCompanyId(req);
      const scope = objectPathCompanyScope(objectPath);
      if (scope === "legacy") {
        const legacyId = await getLegacyCompanyId();
        if (legacyId == null || callerCompanyId !== legacyId) {
          res.status(404).json({ error: "Object not found" });
          return;
        }
      } else if (scope !== callerCompanyId) {
        res.status(404).json({ error: "Object not found" });
        return;
      }

      const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

      const response = await objectStorageService.downloadObject(objectFile);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        req.log.warn({ err: error }, "Object not found");
        res.status(404).json({ error: "Object not found" });
        return;
      }
      req.log.error({ err: error }, "Error serving object");
      res.status(500).json({ error: "Failed to serve object" });
    }
  },
);

export default router;
