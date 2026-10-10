/**
 * FAIE (Field AI Image Engine) Ingest Routes
 *
 * Three endpoints that receive training data from the mobile app after field
 * photo uploads and finding reviews. All routes require normal authenticated
 * company membership; client identity fields are assertions, never authority.
 *
 * POST /v1/faie/dataset/ingest
 *   Called when a technician accepts a finding (positive reinforcement per company).
 *
 * POST /v1/faie/training/ingest-global
 *   Called on every field photo upload (global training pool).
 *
 * POST /v1/faie/training/ingest-anonymized
 *   Called when a technician corrects a finding (no PII — category + context only).
 */

import { Router, json, type IRouter } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { faieTrainingImagesTable } from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";
import { requireAuth, requireCompany, requireBetaAccess } from "../middleware/require-auth";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const MAX_IMAGE_BYTES = 14 * 1024 * 1024;
const imageBytesSchema = z.string().min(1).max(Math.ceil(MAX_IMAGE_BYTES / 3) * 4)
  .refine((value) => value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value),
    "Expected standard base64 image bytes");
let activeRequests = 0;
const activeByCompany = new Map<number, number>();

router.use(requireAuth, requireCompany, requireBetaAccess);
// Bound simultaneous JSON bodies/decoded images and storage work, not merely
// HTTP responses. A disconnected client cannot release an ongoing upload slot.
router.use((req, res, next) => {
  const companyId = req.user!.companyId!;
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    res.status(403).json({ error: "Valid company membership required" }); return;
  }
  const companyActive = activeByCompany.get(companyId) ?? 0;
  if (activeRequests >= 4 || companyActive >= 2) {
    res.setHeader("Retry-After", "5");
    res.status(429).json({ error: "Training ingestion busy; retry later", code: "training_busy" }); return;
  }
  activeRequests++;
  activeByCompany.set(companyId, companyActive + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeRequests--;
    const remaining = (activeByCompany.get(companyId) ?? 1) - 1;
    if (remaining) activeByCompany.set(companyId, remaining);
    else activeByCompany.delete(companyId);
  };
  res.locals.releaseTrainingSlot = release;
  const onResponseEnd = () => { if (!res.locals.trainingWorkActive) release(); };
  res.once("finish", onResponseEnd);
  res.once("close", onResponseEnd);
  next();
});
router.use(json({ limit: "20mb" }));
router.use((req, res, next) => {
  // Accept matching legacy assertions, but never use them to select a tenant.
  for (const claim of [req.body?.companyId, req.query.companyId]) {
    if (claim === undefined) continue;
    const id = typeof claim === "number" ? claim
      : typeof claim === "string" && /^\d+$/.test(claim) ? Number(claim) : NaN;
    if (!Number.isSafeInteger(id) || id !== req.user!.companyId) {
      res.status(403).json({ error: "Company does not match authenticated membership" }); return;
    }
  }
  if (req.body?.technicianId !== undefined
    && req.body.technicianId !== req.user!.clerkUserId) {
    res.status(403).json({ error: "Technician does not match authenticated user" }); return;
  }
  next();
});

// ── Zod schemas ───────────────────────────────────────────────────────────────

const DatasetIngestBody = z.object({
  companyId: z.union([z.string(), z.number()]).optional(),
  findingId: z.string().max(128).optional(),
  label: z.string().max(256).optional(),
  confidence: z.number().min(0).max(1).optional(),
  imageBytes: imageBytesSchema,
  timestamp: z.string().max(128).optional(),
});

const GlobalIngestBody = z.object({
  companyId: z.union([z.string(), z.number()]).optional(),
  technicianId: z.string().max(200).optional(),
  source: z.string().max(128).default("mobile_upload"),
  imageBytes: imageBytesSchema,
  timestamp: z.string().max(128).optional(),
});

const AnonymizedIngestBody = z.object({
  category: z.string().max(256).optional(),
  confidence: z.number().min(0).max(1).optional(),
  context: z.string().max(4000).optional(),
  imageBytes: imageBytesSchema,
  timestamp: z.string().max(128).optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Decode a base64 image payload and persist it to object storage.
 * Returns the canonical /objects/… path.
 */
async function storeBase64Image(
  base64: string,
  companyId: number,
): Promise<string> {
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error("Training image exceeds byte limit");
  return storage.uploadObjectBuffer(companyId, buffer, "image/jpeg");
}

// ── POST /dataset/ingest ──────────────────────────────────────────────────────

router.post("/dataset/ingest", async (req, res) => {
  const parsed = DatasetIngestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.issues });
    return;
  }

  const { findingId, label, confidence, imageBytes } = parsed.data;
  const effectiveCompanyId = req.user!.companyId!;

  res.locals.trainingWorkActive = true;
  try {
    const imageUrl = await storeBase64Image(imageBytes, effectiveCompanyId);

    await db.insert(faieTrainingImagesTable).values({
      recordType: "dataset",
      companyId: effectiveCompanyId,
      findingId: findingId ?? null,
      label: label ?? null,
      confidence: confidence ?? null,
      imageUrl,
    });

    logger.info({ companyId: effectiveCompanyId, findingId, label }, "[FAIE] dataset record ingested");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[FAIE] dataset/ingest failed");
    res.status(500).json({ error: "Ingest failed" });
  } finally {
    res.locals.releaseTrainingSlot();
  }
});

// ── POST /training/ingest-global ──────────────────────────────────────────────

router.post("/training/ingest-global", async (req, res) => {
  const parsed = GlobalIngestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.issues });
    return;
  }

  const { source, imageBytes } = parsed.data;
  const companyId = req.user!.companyId!;
  const technicianId = req.user!.clerkUserId;

  res.locals.trainingWorkActive = true;
  try {
    const imageUrl = await storeBase64Image(imageBytes, companyId);

    await db.insert(faieTrainingImagesTable).values({
      recordType: "global",
      companyId,
      technicianId,
      source,
      imageUrl,
    });

    logger.info({ companyId, technicianId, source }, "[FAIE] global training record ingested");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[FAIE] training/ingest-global failed");
    res.status(500).json({ error: "Ingest failed" });
  } finally {
    res.locals.releaseTrainingSlot();
  }
});

// ── POST /training/ingest-anonymized ─────────────────────────────────────────

router.post("/training/ingest-anonymized", async (req, res) => {
  const parsed = AnonymizedIngestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.issues });
    return;
  }

  const { category, confidence, context, imageBytes } = parsed.data;
  const companyId = req.user!.companyId!;

  res.locals.trainingWorkActive = true;
  try {
    const imageUrl = await storeBase64Image(imageBytes, companyId);

    await db.insert(faieTrainingImagesTable).values({
      recordType: "anonymized",
      companyId,
      category: category ?? null,
      confidence: confidence ?? null,
      context: context ?? null,
      imageUrl,
    });

    logger.info({ category }, "[FAIE] anonymized training record ingested");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[FAIE] training/ingest-anonymized failed");
    res.status(500).json({ error: "Ingest failed" });
  } finally {
    res.locals.releaseTrainingSlot();
  }
});

export default router;
