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
  techInventoryTable,
  inspectionsTable,
  productsTable,
  productLabelRulesTable,
  inventoryTransactionsTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import { z } from "zod/v4";
import { recomputePredictiveRecommendationForProduct } from "../lib/predictive-restocking";
import { logger } from "../lib/logger";
import { logErrorEvent } from "../lib/error-events";
import {
  enqueuePestPacInventoryUsage,
  isPestPacBidirectionalSyncEnabled,
} from "../services/integration/pestpac-sync";

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
    const technicianId = req.user?.clerkUserId ?? null;
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

    // ── Write the log and atomically deduct inventory ─────────────────────────
    // The INSERT and the inventory UPDATE run inside a single transaction so a
    // crash between the two can never leave the audit log inconsistent with
    // on-hand quantities. If no inventory row exists for this tech+product
    // (i.e. the technician has not set a baseline) the UPDATE is a no-op and
    // updatedInventory is returned as null — not an error.
    type UpdatedInventory = { productId: number; quantityOnHand: number; unit: string } | null;
    // Set when the requested totalProductOz exceeded what was actually on hand
    // (the deduction was clamped at 0 rather than going negative) — the tech
    // may simply have restocked mid-route, so this is a warning event, not a
    // request-blocking error.
    type ClampedWarning = { requestedOz: number; availableOz: number; productId: number } | null;

    const { logRow, updatedInventory, clampedWarning } = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(treatmentLogsTable)
        .values({
          companyId,
          inspectionId,
          productId: data.productId,
          technicianId,
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

      if (!inserted) throw new Error("Failed to create treatment log");

      let updatedInventory: UpdatedInventory = null;
      let clampedWarning: ClampedWarning = null;
      let logRow = inserted;

      if (data.totalProductOz != null && technicianId) {
        // Unit guard: treatment logs always record totalProductOz in fluid
        // ounces.  We must only deduct from inventory rows that share a
        // compatible fluid-oz unit — skipping rows tracked in gallons, "unit"
        // counts, lbs, etc. prevents silent data corruption.  The WHERE clause
        // restricts to 'fl oz' and 'oz' (both mean the same thing in liquid
        // pesticide context); any other unit leaves updatedInventory as null.
        //
        // SELECT ... FOR UPDATE locks the row and gives us the pre-deduction
        // balance so we can compute — and persist — the ACTUAL amount taken
        // out of stock (which is capped at whatever was on hand). Storing that
        // actual amount on the log (rather than the requested totalProductOz)
        // is what lets DELETE reverse the deduction exactly, instead of
        // over-restoring stock when a technician applied more than they had.
        // Advisory-lock this technician's balance for this product — the
        // same lock key/order used by every other route that can mutate a
        // tech_inventory row (baseline, PATCH, restock-events, warehouse
        // transfer). Without this shared lock, a treatment deduction could
        // interleave with e.g. a baseline reset that reads the pre-deduction
        // quantity and then overwrites it with a stale absolute value,
        // silently undoing the deduction while the ledger still records it.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`truck:${companyId}:${technicianId}:${data.productId}`})::bigint)`,
        );

        const oz = data.totalProductOz;
        const before = await tx.execute(
          sql`SELECT quantity_on_hand, unit, restock_threshold
              FROM tech_inventory
              WHERE company_id    = ${companyId}
                AND technician_id = ${technicianId}
                AND product_id    = ${data.productId}
                AND unit          IN ('fl oz', 'oz')`,
        );

        if (before.rows.length > 0) {
          const b = before.rows[0] as {
            quantity_on_hand: number;
            unit: string;
            restock_threshold: number | null;
          };
          const actualDeduction = Math.min(oz, b.quantity_on_hand);
          const newQty = b.quantity_on_hand - actualDeduction;

          // The technician reported using more product than was on hand for
          // this truck. Clamp at 0 (never go negative) and flag it as a
          // warning — the tech may have restocked mid-route without logging
          // it yet, so this must not block or fail the treatment log.
          if (oz > b.quantity_on_hand) {
            clampedWarning = {
              requestedOz: oz,
              availableOz: b.quantity_on_hand,
              productId: data.productId,
            };
          }

          await tx.execute(
            sql`UPDATE tech_inventory
                SET quantity_on_hand = ${newQty}::real,
                    updated_at = NOW()
                WHERE company_id    = ${companyId}
                  AND technician_id = ${technicianId}
                  AND product_id    = ${data.productId}
                  AND unit          IN ('fl oz', 'oz')`,
          );

          const [updatedLog] = await tx
            .update(treatmentLogsTable)
            .set({ inventoryDeductedOz: actualDeduction })
            .where(eq(treatmentLogsTable.id, inserted.id))
            .returning();
          if (updatedLog) logRow = updatedLog;

          updatedInventory = {
            productId: data.productId,
            quantityOnHand: newQty,
            unit: b.unit,
          };

          // ── Immutable ledger entry ────────────────────────────────────────
          // Every truck→property deduction is also recorded in the generic
          // transaction ledger, independent of (and in addition to) the
          // running balance update above.
          await tx.insert(inventoryTransactionsTable).values({
            companyId,
            productId: data.productId,
            quantity: actualDeduction,
            unit: b.unit,
            movementType: "truck_deduction",
            source: `truck:${technicianId}`,
            destination: `property:${inspectionId}`,
            technicianId,
            actingUserId: technicianId,
            referenceId: inserted.id,
          });

          // ── Restock threshold check ─────────────────────────────────────────
          // If stock just dropped below the technician's configured minimum,
          // upsert a pending restock alert so the manager can act on it.  The
          // ON CONFLICT clause re-opens a previously dismissed alert rather than
          // creating a duplicate row.
          if (b.restock_threshold != null && newQty < b.restock_threshold) {
            const shortfall = b.restock_threshold - newQty;
            await tx.execute(
              sql`INSERT INTO pending_restock_requests
                    (company_id, technician_id, product_id,
                     quantity_on_hand, restock_threshold, shortfall, status, updated_at)
                  VALUES
                    (${companyId}, ${technicianId}, ${data.productId},
                     ${newQty}, ${b.restock_threshold}, ${shortfall}, 'pending', NOW())
                  ON CONFLICT (company_id, technician_id, product_id)
                  DO UPDATE SET
                    quantity_on_hand  = EXCLUDED.quantity_on_hand,
                    restock_threshold = EXCLUDED.restock_threshold,
                    shortfall         = EXCLUDED.shortfall,
                    status            = 'pending',
                    resolved_at       = NULL,
                    updated_at        = NOW()`,
            );
          }
        }
      }

      return { logRow, updatedInventory, clampedWarning };
    });

    // ── Insufficient-stock warning event ────────────────────────────────────
    // Best-effort, non-blocking: the manager's error/event monitor should
    // surface a reported-usage/on-hand mismatch for follow-up, but the
    // treatment log itself must never fail because of it.
    if (clampedWarning && technicianId) {
      void logErrorEvent("inventory", {
        companyId,
        message:
          `Technician reported applying ${clampedWarning.requestedOz} fl oz of ${product.name} ` +
          `but only ${clampedWarning.availableOz} fl oz was on hand; balance clamped to 0.`,
        context: {
          route: "treatment-logs",
          reason: "insufficient_truck_stock",
        },
        inspectionId,
      });
    }

    // ── Predictive-restock recompute (Task #918) ────────────────────────────
    // Event-triggered, single (technician, product) recompute — the adaptive
    // forecast should reflect this deduction immediately rather than waiting
    // for the next periodic sweep. Deliberately outside the transaction above
    // (it's a derived, best-effort secondary signal, not part of the
    // inventory write's atomicity guarantee) and never allowed to fail the
    // treatment-log request itself.
    if (updatedInventory && technicianId) {
      recomputePredictiveRecommendationForProduct(companyId, technicianId, updatedInventory.productId).catch(
        (err) => {
          logger.error(
            { err, companyId, technicianId, productId: updatedInventory.productId },
            "[treatment-logs] predictive-restock recompute failed",
          );
        },
      );
    }

    // PestPac usage write-back is deliberately outside the compliance and
    // inventory transaction. Queue failure must never roll back a valid field
    // record or make the technician wait on a legacy-system request.
    if (isPestPacBidirectionalSyncEnabled()) void enqueuePestPacInventoryUsage(companyId, logRow.id).catch((err) => {
      logger.error(
        { err, companyId, treatmentLogId: logRow.id },
        "[treatment-logs] failed to queue PestPac inventory usage",
      );
    });

    return res.status(201).json({ ...serializeLog(logRow), updatedInventory });
  } catch {
    return res.status(500).json({ error: "Failed to create treatment log" });
  }
});

// ─── PATCH /inspections/:inspectionId/treatment-logs/:logId ──────────────────

const patchTreatmentLogSchema = z.object({
  notes: z.string().optional(),
  equipmentUsed: z.string().optional(),
  tempAtApplicationF: z.number().int().optional(),
  environmentalWarningAcknowledged: z.boolean().optional(),
  appliedAt: z.string().datetime().optional(),
});

router.patch("/:logId", async (req: Request<Params & { logId: string }>, res) => {
  try {
    const companyId = getCompanyId(req);
    const inspectionId = Number(req.params.inspectionId);
    const logId = Number((req.params as { logId: string }).logId);
    if (Number.isNaN(inspectionId) || Number.isNaN(logId)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    const parse = patchTreatmentLogSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: "Invalid body", detail: parse.error.issues });
    }

    const data = parse.data;
    const update: Record<string, unknown> = { ...data };
    if (data.appliedAt) update.appliedAt = new Date(data.appliedAt);

    const [row] = await db
      .update(treatmentLogsTable)
      .set(update)
      .where(
        and(
          eq(treatmentLogsTable.id, logId),
          eq(treatmentLogsTable.inspectionId, inspectionId),
          eq(treatmentLogsTable.companyId, companyId),
        ),
      )
      .returning();

    if (!row) return res.status(404).json({ error: "Treatment log not found" });
    return res.json(serializeLog(row));
  } catch {
    return res.status(500).json({ error: "Failed to update treatment log" });
  }
});

// ─── DELETE /inspections/:inspectionId/treatment-logs/:logId ─────────────────

router.delete("/:logId", async (req: Request<Params & { logId: string }>, res) => {
  try {
    const companyId = getCompanyId(req);
    const inspectionId = Number(req.params.inspectionId);
    const logId = Number((req.params as { logId: string }).logId);
    if (Number.isNaN(inspectionId) || Number.isNaN(logId)) {
      return res.status(400).json({ error: "Invalid ID" });
    }

    // ── Delete the log and atomically restore inventory ──────────────────────
    // The DELETE and the inventory UPDATE run inside a single transaction so a
    // crash between the two can never leave on-hand quantities permanently
    // under-counted relative to the audit log. If no inventory row exists for
    // this tech+product (i.e. the technician never set a baseline) the UPDATE
    // is a no-op — consistent with the POST handler's create path.
    const deleted = await db.transaction(async (tx) => {
      const [deletedRow] = await tx
        .delete(treatmentLogsTable)
        .where(
          and(
            eq(treatmentLogsTable.id, logId),
            eq(treatmentLogsTable.inspectionId, inspectionId),
            eq(treatmentLogsTable.companyId, companyId),
          ),
        )
        .returning();

      if (!deletedRow) return [];

      // Restore inventoryDeductedOz — the amount ACTUALLY subtracted at
      // creation time — not totalProductOz. A deduction that hit the
      // GREATEST(0, ...) floor takes less than totalProductOz out of stock,
      // so restoring the full requested amount would over-credit the
      // technician. inventoryDeductedOz is null whenever no deduction
      // happened (no baseline inventory row, or no totalProductOz recorded).
      if (deletedRow.inventoryDeductedOz != null && deletedRow.technicianId) {
        // Same shared advisory lock as the POST handler and every other
        // tech_inventory mutator — see the comment there for why a bare
        // `UPDATE` isn't enough to keep the restored balance and the ledger
        // consistent under concurrent writes to this technician's balance.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`truck:${companyId}:${deletedRow.technicianId}:${deletedRow.productId}`})::bigint)`,
        );

        // Unit guard mirrors the POST handler: only restore stock into
        // inventory rows tracked in a compatible fluid-oz unit.
        const oz = deletedRow.inventoryDeductedOz;
        const restored = await tx.execute(
          sql`UPDATE tech_inventory
              SET quantity_on_hand = quantity_on_hand + ${oz}::real,
                  updated_at = NOW()
              WHERE company_id    = ${companyId}
                AND technician_id = ${deletedRow.technicianId}
                AND product_id    = ${deletedRow.productId}
                AND unit          IN ('fl oz', 'oz')
              RETURNING unit`,
        );

        // ── Immutable ledger entry ──────────────────────────────────────────
        // Record the reversal so the ledger stays an accurate history of
        // every movement, including corrections. actingUserId is whoever
        // performed the delete (may differ from the technician who applied
        // the original treatment).
        if (restored.rows.length > 0) {
          const restoredUnit = (restored.rows[0] as { unit: string }).unit;
          await tx.insert(inventoryTransactionsTable).values({
            companyId,
            productId: deletedRow.productId,
            quantity: oz,
            unit: restoredUnit,
            movementType: "truck_deduction_reversal",
            source: `property:${inspectionId}`,
            destination: `truck:${deletedRow.technicianId}`,
            technicianId: deletedRow.technicianId,
            actingUserId: req.user?.clerkUserId ?? deletedRow.technicianId,
            referenceId: deletedRow.id,
          });
        }
      }

      return [
        {
          id: deletedRow.id,
          technicianId: deletedRow.inventoryDeductedOz != null ? deletedRow.technicianId : null,
          productId: deletedRow.inventoryDeductedOz != null ? deletedRow.productId : null,
        },
      ];
    });

    if (deleted.length === 0) return res.status(404).json({ error: "Treatment log not found" });

    // Predictive-restock recompute (Task #918) — a reversal restores stock,
    // which can resolve a previously-flagged predicted shortfall. Same
    // best-effort, non-blocking convention as the POST handler above.
    const [reversal] = deleted;
    if (reversal.technicianId && reversal.productId != null) {
      recomputePredictiveRecommendationForProduct(companyId, reversal.technicianId, reversal.productId).catch(
        (err) => {
          logger.error(
            { err, companyId, technicianId: reversal.technicianId, productId: reversal.productId },
            "[treatment-logs] predictive-restock recompute failed",
          );
        },
      );
    }

    return res.status(204).send();
  } catch {
    return res.status(500).json({ error: "Failed to delete treatment log" });
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
