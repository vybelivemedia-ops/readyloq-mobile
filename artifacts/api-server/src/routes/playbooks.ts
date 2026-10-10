/**
 * Company Playbooks — SOPs, target-pest protocols, required steps, and
 * chemical restrictions that the Learning Engine enforces at inspection time.
 *
 * Routes (all require auth + company + beta):
 *   GET  /playbooks/active              — fetch active playbooks (all roles)
 *   GET  /playbooks/compliance          — evaluate compliance for an inspection (all roles)
 *   GET  /playbooks                     — list all playbooks incl. inactive (manager+)
 *   POST /playbooks                     — create a new playbook (owner only)
 *   PUT  /playbooks/:id                 — update a playbook (owner only)
 *   DELETE /playbooks/:id               — deactivate a playbook (owner only)
 */

import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  companyPlaybooksTable,
  analysisResultsTable,
  treatmentLogsTable,
  productsTable,
  inspectionsTable,
} from "@workspace/db";

// ── Validation schemas ────────────────────────────────────────────────────────
// Defined here because drizzle-zod cannot infer .$type<>() JSONB generics
// at runtime, so we own the validation for the complex array columns.

const requiredStepSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

const chemicalRestrictionSchema = z.object({
  name: z.string().min(1),
  reason: z.string().optional(),
});

const playbookInputSchema = z.object({
  title: z.string().min(1).max(200),
  targetPests: z.array(z.string()).default([]),
  requiredSteps: z.array(requiredStepSchema).default([]),
  chemicalRestrictions: z.array(chemicalRestrictionSchema).default([]),
  notes: z.string().max(2000).nullish(),
  isActive: z.boolean().default(true),
});
import { requireRole } from "../middleware/require-auth";
import { evaluatePlaybookCompliance } from "../lib/playbook-compliance";
import type { Finding } from "@workspace/db";

const router = Router();

// ── GET /playbooks/active ─────────────────────────────────────────────────────
// Returns only active playbooks for the company. Used by technicians before
// and during inspections to pull down current SOPs.
router.get("/active", async (req, res) => {
  const companyId = req.user!.companyId!;
  try {
    const playbooks = await db
      .select()
      .from(companyPlaybooksTable)
      .where(
        and(
          eq(companyPlaybooksTable.companyId, companyId),
          eq(companyPlaybooksTable.isActive, true),
        ),
      )
      .orderBy(companyPlaybooksTable.title);

    return res.json({ success: true, playbooks });
  } catch (err) {
    logger.error({ err }, "[playbooks] GET /active error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /playbooks/compliance?inspectionId=N ──────────────────────────────────
// Runs the Learning Engine against an inspection's findings and returns any
// playbook violations. The inspection must belong to the caller's company.
router.get("/compliance", async (req, res) => {
  const companyId = req.user!.companyId!;
  const inspectionId = Number(req.query.inspectionId);

  if (!inspectionId || isNaN(inspectionId)) {
    return res
      .status(400)
      .json({ error: "inspectionId query param is required" });
  }

  try {
    // Verify inspection belongs to the company.
    const [inspection] = await db
      .select({ id: inspectionsTable.id })
      .from(inspectionsTable)
      .where(
        and(
          eq(inspectionsTable.id, inspectionId),
          eq(inspectionsTable.companyId, companyId),
        ),
      )
      .limit(1);

    if (!inspection) {
      return res.status(404).json({ error: "Inspection not found" });
    }

    // Load findings from the latest analysis result.
    const [analysis] = await db
      .select({ findings: analysisResultsTable.findings })
      .from(analysisResultsTable)
      .where(eq(analysisResultsTable.inspectionId, inspectionId))
      .orderBy(analysisResultsTable.id)
      .limit(1);

    const findings: Finding[] = (analysis?.findings as Finding[]) ?? [];

    // Load chemical product names from treatment logs.
    const logs = await db
      .select({ productName: productsTable.name })
      .from(treatmentLogsTable)
      .leftJoin(productsTable, eq(treatmentLogsTable.productId, productsTable.id))
      .where(eq(treatmentLogsTable.inspectionId, inspectionId));

    const productNames: string[] = logs
      .map((l: { productName: string | null }) => l.productName)
      .filter((n: string | null): n is string => n != null);

    // Load active playbooks.
    const playbooks = await db
      .select()
      .from(companyPlaybooksTable)
      .where(
        and(
          eq(companyPlaybooksTable.companyId, companyId),
          eq(companyPlaybooksTable.isActive, true),
        ),
      );

    const result = evaluatePlaybookCompliance(findings, productNames, playbooks);

    return res.json({ success: true, ...result });
  } catch (err) {
    logger.error({ err }, "[playbooks] GET /compliance error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /playbooks ────────────────────────────────────────────────────────────
// Full list including inactive — managers and owners reviewing SOPs.
router.get("/", requireRole("manager"), async (req, res) => {
  const companyId = req.user!.companyId!;
  try {
    const playbooks = await db
      .select()
      .from(companyPlaybooksTable)
      .where(eq(companyPlaybooksTable.companyId, companyId))
      .orderBy(companyPlaybooksTable.title);

    return res.json({ success: true, playbooks });
  } catch (err) {
    logger.error({ err }, "[playbooks] GET / error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /playbooks ───────────────────────────────────────────────────────────
router.post("/", requireRole("owner"), async (req, res) => {
  const parsed = playbookInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid playbook data", issues: parsed.error.issues });
  }

  const companyId = req.user!.companyId!;
  try {
    const [created] = await db
      .insert(companyPlaybooksTable)
      .values({ ...parsed.data, companyId, notes: parsed.data.notes ?? null })
      .returning();

    return res.status(201).json({ success: true, playbook: created });
  } catch (err) {
    logger.error({ err }, "[playbooks] POST / error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── PUT /playbooks/:id ────────────────────────────────────────────────────────
router.put("/:id", requireRole("owner"), async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const companyId = req.user!.companyId!;

  const updateSchema = playbookInputSchema.partial();
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid playbook data", issues: parsed.error.issues });
  }

  try {
    const [updated] = await db
      .update(companyPlaybooksTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(
        and(
          eq(companyPlaybooksTable.id, id),
          eq(companyPlaybooksTable.companyId, companyId),
        ),
      )
      .returning();

    if (!updated) return res.status(404).json({ error: "Playbook not found" });
    return res.json({ success: true, playbook: updated });
  } catch (err) {
    logger.error({ err }, "[playbooks] PUT /:id error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── DELETE /playbooks/:id ─────────────────────────────────────────────────────
// Soft-deletes by setting isActive = false. Hard deletes are not exposed.
router.delete("/:id", requireRole("owner"), async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const companyId = req.user!.companyId!;
  try {
    const [deactivated] = await db
      .update(companyPlaybooksTable)
      .set({ isActive: false, updatedAt: new Date() })
      .where(
        and(
          eq(companyPlaybooksTable.id, id),
          eq(companyPlaybooksTable.companyId, companyId),
        ),
      )
      .returning();

    if (!deactivated)
      return res.status(404).json({ error: "Playbook not found" });
    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "[playbooks] DELETE /:id error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
