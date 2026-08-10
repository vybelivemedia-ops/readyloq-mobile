/**
 * Treatment log routes — ReadyLoq
 *
 * Nested under /inspections/:inspectionId/ (mergeParams: true).
 *
 * POST /inspections/:inspectionId/treatment-logs   — record a new application
 * GET  /inspections/:inspectionId/treatment-logs   — list logs for an inspection
 *
 * Rate-limit guard: the POST handler validates that the submitted totalProductOz
 * applied over areaSqft does not exceed label_rules.maxRateOzPer1000Sqft. If it
 * does, a 422 is returned with structured error data so the mobile wizard can
 * display the correct label-based maximum to the technician.
 */

import { Router, type Request } from "express";
import { db } from "@workspace/db";
import {
  treatmentLogsTable,
  inspectionsTable,
  productsTable,
  productLabelRulesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import { z } from "zod/v4";

type Params = { inspectionId: string };
const router = Router({ mergeParams: true });

// ─── Validation schema ────────────────────────────────────────────────────────

const checklistItemSchema = z.object({
  label: z.string().min(1),
  checked: z.boolean(),
});

const createTreatmentLogSchema = z.object({
  productId: z.number().int().positive(),
  targetPest: z.string().min(1),
  siteClassification: z.string().min(1),
  areaSqft: z.number().positive().optional(),
  linearFt: z.number().positive().optional(),
  dilutionOzPerGallon: z.number().positive().optional(),
  totalProductOz: z.number().positive().optional(),
  equipmentUsed: z.string().optional(),
  checklistItems: z.array(checklistItemSchema).optional(),
  tempAtApplicationF: z.number().int().optional(),
  environmentalWarningAcknowledged: z.boolean().default(false),
  notes: z.string().optional(),
  appliedAt: z.string().datetime().optional(),
});

// ─── Serialiser ───────────────────────────────────────────────────────────────

function serializeLog(row: typeof treatmentLogsTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    appliedAt: row.appliedAt.toISOString(),
  };
}

// ─── POST /inspections/:inspectionId/treatment-logs ───────────────────────────

router.post("/", async (req: Request<Params>, res) => {
  try {
    const companyId = getCompanyId(req);
    const inspectionId = Number(req.params.inspectionId);
    if (Number.isNaN(inspectionId)) {
      return res.status(400).json({ error: "Invalid inspection ID" });
    }

    // Verify the inspection belongs to this company.
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
    if (!inspection) return res.status(404).json({ error: "Inspection not found" });

    const parse = createTreatmentLogSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: "Invalid body", detail: parse.error.issues });
    }

    const data = parse.data;

    // ── Rate-limit guard ──────────────────────────────────────────────────────
    // Fetch the label rules for the selected product to validate the submitted
    // rate before writing the log to the database.
    const [labelRulesRow] = await db
      .select({ labelRules: productLabelRulesTable, product: productsTable })
      .from(productLabelRulesTable)
      .innerJoin(productsTable, eq(productsTable.id, productLabelRulesTable.productId))
      .where(eq(productLabelRulesTable.productId, data.productId))
      .limit(1);

    if (!labelRulesRow) {
      return res.status(404).json({ error: "Product or label rules not found" });
    }

    const { labelRules, product } = labelRulesRow;
    const maxRate = labelRules.maxRateOzPer1000Sqft;

    // ── Required-inputs guard ─────────────────────────────────────────────────
    // When the product label defines a maximum application rate, require at
    // least one area measurement (sq ft or linear ft) AND product volume.
    // This prevents incomplete compliance records and bypassed rate validation.
    if (maxRate !== null) {
      const hasArea = data.areaSqft !== undefined || data.linearFt !== undefined;
      const hasVolume = data.totalProductOz !== undefined;
      if (!hasArea || !hasVolume) {
        return res.status(422).json({
          error: "rate_inputs_required",
          message:
            `${product.name} has a label-defined maximum application rate. ` +
            `At least one area measurement (sq ft or linear ft) and total product volume (fl oz) are required.`,
        });
      }
    }

    // ── Pest validation ───────────────────────────────────────────────────────
    // Reject off-label pest submissions so the compliance record is always
    // backed by the product label.
    const approvedPests = labelRules.approvedPestTypes ?? [];
    if (approvedPests.length > 0 && !approvedPests.includes(data.targetPest)) {
      return res.status(422).json({
        error: "pest_not_approved",
        message:
          `${product.name} is not labelled for "${data.targetPest}". ` +
          `Approved pests: ${approvedPests.join(", ")}.`,
      });
    }

    // ── Site classification validation ────────────────────────────────────────
    const approvedSites = labelRules.approvedSiteClassifications ?? [];
    if (approvedSites.length > 0 && !approvedSites.includes(data.siteClassification)) {
      return res.status(422).json({
        error: "site_not_approved",
        message:
          `${product.name} is not labelled for site "${data.siteClassification}". ` +
          `Approved sites: ${approvedSites.join(", ")}.`,
      });
    }

    // ── Pre-mix checklist completion ──────────────────────────────────────────
    // Reconstruct the expected checklist length from label rules and verify the
    // client submitted at least that many items, all checked.
    const expectedChecklistCount =
      (labelRules.requiredEquipmentTypes?.length ?? 0) +
      (labelRules.mixingSteps?.length ?? 0);

    if (expectedChecklistCount > 0) {
      const submitted = data.checklistItems ?? [];
      if (submitted.length < expectedChecklistCount) {
        return res.status(422).json({
          error: "checklist_incomplete",
          message:
            `Pre-mix safety checklist is incomplete. ` +
            `${submitted.length} of ${expectedChecklistCount} required items submitted.`,
        });
      }
      const allChecked = submitted.every((item) => item.checked);
      if (!allChecked) {
        return res.status(422).json({
          error: "checklist_items_unchecked",
          message:
            "All pre-mix safety checklist items must be checked before recording an application.",
        });
      }
    }

    // ── Environmental warning acknowledgement ─────────────────────────────────
    // If the application temperature exceeds the label maximum, or the product
    // carries phytotoxicity notes, the technician must explicitly acknowledge
    // the warning before the log can be recorded.
    const tempExceeded =
      labelRules.maxTempF !== null &&
      data.tempAtApplicationF !== undefined &&
      data.tempAtApplicationF > labelRules.maxTempF;
    const hasPhytoRisk = labelRules.phytotoxicityNotes !== null;
    if ((tempExceeded || hasPhytoRisk) && !data.environmentalWarningAcknowledged) {
      return res.status(422).json({
        error: "environmental_warning_not_acknowledged",
        message:
          "Environmental conditions exceed label guidance. " +
          "Technician must acknowledge the warning before this application can be recorded.",
      });
    }

    if (
      maxRate !== null &&
      data.totalProductOz !== undefined &&
      data.areaSqft !== undefined &&
      data.areaSqft > 0
    ) {
      const appliedRate = (data.totalProductOz / data.areaSqft) * 1000;
      if (appliedRate > maxRate) {
        return res.status(422).json({
          error: "rate_exceeds_label_maximum",
          message:
            `Application rate of ${appliedRate.toFixed(2)} oz/1,000 sq ft exceeds the ` +
            `label maximum of ${maxRate} oz/1,000 sq ft for ${product.name}.`,
          appliedRate: parseFloat(appliedRate.toFixed(4)),
          maxRate,
          productName: product.name,
        });
      }
    }

    // ── Write the log ─────────────────────────────────────────────────────────
    const [row] = await db
      .insert(treatmentLogsTable)
      .values({
        companyId,
        inspectionId,
        productId: data.productId,
        technicianId: req.user?.clerkUserId ?? null,
        targetPest: data.targetPest,
        siteClassification: data.siteClassification,
        areaSqft: data.areaSqft ?? null,
        linearFt: data.linearFt ?? null,
        dilutionOzPerGallon: data.dilutionOzPerGallon ?? null,
        totalProductOz: data.totalProductOz ?? null,
        equipmentUsed: data.equipmentUsed ?? null,
        checklistItems: data.checklistItems ?? [],
        tempAtApplicationF: data.tempAtApplicationF ?? null,
        environmentalWarningAcknowledged: data.environmentalWarningAcknowledged,
        notes: data.notes ?? null,
        appliedAt: data.appliedAt ? new Date(data.appliedAt) : new Date(),
      })
      .returning();

    if (!row) return res.status(500).json({ error: "Failed to create treatment log" });

    return res.status(201).json(serializeLog(row));
  } catch {
    return res.status(500).json({ error: "Failed to create treatment log" });
  }
});

// ─── GET /inspections/:inspectionId/treatment-logs ────────────────────────────

router.get("/", async (req: Request<Params>, res) => {
  try {
    const companyId = getCompanyId(req);
    const inspectionId = Number(req.params.inspectionId);
    if (Number.isNaN(inspectionId)) {
      return res.status(400).json({ error: "Invalid inspection ID" });
    }

    const rows = await db
      .select({
        log: treatmentLogsTable,
        product: productsTable,
      })
      .from(treatmentLogsTable)
      .leftJoin(productsTable, eq(productsTable.id, treatmentLogsTable.productId))
      .where(
        and(
          eq(treatmentLogsTable.inspectionId, inspectionId),
          eq(treatmentLogsTable.companyId, companyId),
        ),
      );

    return res.json(
      rows.map((r) => ({
        ...serializeLog(r.log),
        product: r.product
          ? {
              id: r.product.id,
              name: r.product.name,
              productType: r.product.productType,
              activeIngredients: r.product.activeIngredients,
              epaRegistrationNumber: r.product.epaRegistrationNumber,
            }
          : null,
      })),
    );
  } catch {
    return res.status(500).json({ error: "Failed to list treatment logs" });
  }
});

export default router;
