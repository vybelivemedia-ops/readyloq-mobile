/**
 * FAIE (Field AI Image Engine) Ingest Routes
 *
 * Three endpoints that receive training data from the mobile app after field
 * photo uploads and finding reviews. All routes are intentionally unauthenticated
 * so the mobile app can post fire-and-forget without a token.
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

import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { faieTrainingImagesTable } from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const storage = new ObjectStorageService();

// ── Zod schemas ───────────────────────────────────────────────────────────────

const DatasetIngestBody = z.object({
  companyId: z.union([z.string(), z.number()]).optional(),
  findingId: z.string().optional(),
  label: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  imageBytes: z.string().min(1), // base64-encoded image
  timestamp: z.string().optional(),
});

const GlobalIngestBody = z.object({
  companyId: z.union([z.string(), z.number()]),
  technicianId: z.string(),
  source: z.string().default("mobile_upload"),
  imageBytes: z.string().min(1),
  timestamp: z.string().optional(),
});

const AnonymizedIngestBody = z.object({
  category: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  context: z.string().optional(),
  imageBytes: z.string().min(1),
  timestamp: z.string().optional(),
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
  return storage.uploadObjectBuffer(companyId, buffer, "image/jpeg");
}

/** Coerce a loose companyId value to a positive integer, or fall back to 0. */
function toCompanyId(raw: string | number | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

// ── POST /dataset/ingest ──────────────────────────────────────────────────────

router.post("/dataset/ingest", async (req, res) => {
  const parsed = DatasetIngestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.issues });
    return;
  }

  const { companyId: rawCompanyId, findingId, label, confidence, imageBytes } = parsed.data;
  const companyId = toCompanyId(rawCompanyId);

  try {
    const imageUrl = await storeBase64Image(imageBytes, companyId);

    await db.insert(faieTrainingImagesTable).values({
      recordType: "dataset",
      companyId,
      findingId: findingId ?? null,
      label: label ?? null,
      confidence: confidence ?? null,
      imageUrl,
    });

    logger.info({ companyId, findingId, label }, "[FAIE] dataset record ingested");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[FAIE] dataset/ingest failed");
    res.status(500).json({ error: "Ingest failed" });
  }
});

// ── POST /training/ingest-global ──────────────────────────────────────────────

router.post("/training/ingest-global", async (req, res) => {
  const parsed = GlobalIngestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.issues });
    return;
  }

  const { companyId: rawCompanyId, technicianId, source, imageBytes } = parsed.data;
  const companyId = toCompanyId(rawCompanyId);

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
  }
});

// ── POST /training/ingest-anonymized ─────────────────────────────────────────

/**
 * Platform company namespace for anonymized records that carry no company id.
 * Stored under companies/0/uploads/… in object storage to keep the path
 * consistent with the uploadObjectBuffer convention.
 */
const PLATFORM_COMPANY_ID = 0;

router.post("/training/ingest-anonymized", async (req, res) => {
  const parsed = AnonymizedIngestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payload", details: parsed.error.issues });
    return;
  }

  const { category, confidence, context, imageBytes } = parsed.data;

  try {
    const imageUrl = await storeBase64Image(imageBytes, PLATFORM_COMPANY_ID);

    await db.insert(faieTrainingImagesTable).values({
      recordType: "anonymized",
      companyId: null,
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
  }
});

export default router;
