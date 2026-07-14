import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { db, objectUploadsTable } from "@workspace/db";
import { RequestUploadUrlBody } from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import { requireAuth } from "../middlewares/auth";
import {
  checkUploadUrlRateLimit,
  validateUploadMetadata,
} from "../lib/uploadRateLimit";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 * Requires authentication — prevents unauthenticated bucket writes.
 */
router.post("/storage/uploads/request-url", requireAuth, async (req: Request, res: Response) => {
  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  const { name, size, contentType } = parsed.data;

  const metaError = validateUploadMetadata(size, contentType);
  if (metaError) {
    res.status(400).json({ error: metaError });
    return;
  }

  if (!checkUploadUrlRateLimit(req.auth!.userId)) {
    res.status(429).json({ error: "Upload URL request rate limit exceeded. Please try again later." });
    return;
  }

  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL(contentType);
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    // Record the issuing user so server routes can later verify that a referenced
    // object was actually uploaded by this user before binding/serving it.
    await db
      .insert(objectUploadsTable)
      .values({ objectPath, userId: req.auth!.userId, contentType })
      .onConflictDoUpdate({
        target: objectUploadsTable.objectPath,
        set: { userId: req.auth!.userId, contentType },
      });

    res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

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
 * Serve object entities from PRIVATE_OBJECT_DIR.
 * Requires authentication and ACL ownership check — private objects are only
 * accessible to the user who owns them.
 */
router.get("/storage/objects/*path", requireAuth, async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    const canAccess = await objectStorageService.canAccessObjectEntity({
      userId: req.auth!.userId,
      objectFile,
      requestedPermission: ObjectPermission.READ,
    });
    if (!canAccess) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Post-upload enforcement: inspect actual GCS object metadata before serving.
    // Objects that exceed the size cap or carry a disallowed content-type are
    // quarantined (deleted from bucket) on first access so they cannot be used
    // even if they bypassed the declared-metadata check at URL-issuance time.
    const [objectMeta] = await objectFile.getMetadata();
    const metaError = validateUploadMetadata(
      Number(objectMeta["size"] ?? 0),
      String(objectMeta["contentType"] ?? "")
    );
    if (metaError) {
      req.log.warn(
        { objectPath, size: objectMeta["size"], contentType: objectMeta["contentType"] },
        "Quarantining non-compliant uploaded object on access"
      );
      objectFile.delete({ ignoreNotFound: true }).catch(() => {});
      res.status(404).json({ error: "Object not found" });
      return;
    }

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
});

export default router;
