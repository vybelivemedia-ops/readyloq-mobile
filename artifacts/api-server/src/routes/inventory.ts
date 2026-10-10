/**
 * Chemical inventory routes — ReadyLoq
 *
 * Technician routes (requireAuth + requireCompany + requireBetaAccess):
 *   GET  /technician/inventory                  — my on-hand quantities
 *   POST /technician/inventory/baseline         — set first-time baseline quantities
 *   PATCH /technician/inventory/:productId      — update single product's quantity
 *   GET  /technician/inventory/restock-events   — my restock history
 *   POST /technician/inventory/restock-events   — log a manual restock
 *
 * Manager routes (requireRole("manager")):
 *   GET  /manager/team-inventory                — all techs' inventory summary
 *   GET  /manager/tech-activity/:userId         — ordered/carried/applied timeline
 *   GET  /manager/restock-orders/:orderRef      — live supplier order status
 *
 * Company/owner routes (requireRole("owner")):
 *   GET  /company/supplier-connections          — list supplier connections
 *   POST /company/supplier-connections          — save / update connection
 *   DELETE /company/supplier-connections/:id    — remove connection
 */

import { Router } from "express";
import { and, desc, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  techInventoryTable,
  techRestockEventsTable,
  supplierConnectionsTable,
  supplierOrdersTable,
  productsTable,
  treatmentLogsTable,
  technicianDailyRigsTable,
  inspectionsTable,
  usersTable,
  warehouseInventoryTable,
  inventoryTransactionsTable,
  replenishmentTargetsTable,
  predictiveRestockRecommendationsTable,
  pendingRestockRequestsTable,
} from "@workspace/db";
import { getCompanyId } from "../lib/tenant";
import { requireRole } from "../middleware/require-auth";
import { logger } from "../lib/logger";
import { createSupplierAdapter, type OrderLine } from "../lib/supplier-adapter";
import { computeTruckStockHealth } from "../lib/inventory-forecasting";
import {
  parseTzOffsetMinutes,
  localCalendarDate,
  localMidnightUtc,
  localEndOfDayUtc,
} from "../lib/calendar-tz";

const router = Router();

// ─── Serialisers ──────────────────────────────────────────────────────────────

function serializeInventoryItem(
  inv: typeof techInventoryTable.$inferSelect,
  product: typeof productsTable.$inferSelect,
  extra?: {
    /** Most recent treatment-log application of this product by this tech, if any. */
    lastAppliedAt?: string | null;
    /** Always fluid ounces — treatment_logs.totalProductOz is recorded in fl oz
     * regardless of the unit `inv.unit` tracks on-hand stock in (e.g. gallon). */
    lastAppliedOz?: number | null;
    /** Sum of totalProductOz applied by this tech today. ALWAYS fluid ounces —
     * do not label this with `inv.unit` in a UI; a gallon-tracked product would
     * misleadingly render e.g. "3 gallon applied today" for a 3 fl-oz log. */
    appliedToday?: number;
  },
) {
  return {
    productId: inv.productId,
    productName: product.name,
    epaRegistrationNumber: product.epaRegistrationNumber,
    activeIngredients: product.activeIngredients,
    productType: product.productType,
    manufacturerName: product.manufacturerName,
    quantityOnHand: inv.quantityOnHand,
    unit: inv.unit,
    restockThreshold: inv.restockThreshold,
    updatedAt: inv.updatedAt.toISOString(),
    lastAppliedAt: extra?.lastAppliedAt ?? null,
    lastAppliedOz: extra?.lastAppliedOz ?? null,
    ...(extra?.appliedToday !== undefined ? { appliedToday: extra.appliedToday } : {}),
  };
}

function serializeRestockEvent(
  event: typeof techRestockEventsTable.$inferSelect,
  productName: string,
) {
  return {
    id: event.id,
    productId: event.productId,
    productName,
    quantityReceived: event.quantityReceived,
    unit: event.unit,
    source: event.source,
    supplierOrderRef: event.supplierOrderRef,
    notes: event.notes,
    receivedAt: event.receivedAt.toISOString(),
  };
}

/**
 * Serializes a placed-but-not-yet-received supplier order into the same
 * shape as serializeRestockEvent() so the Tech Activity timeline can render
 * it in the "ordered" stream. Always tagged source="supplier_api" so the
 * frontend knows to fetch and show a live order-status badge.
 */
function serializePlacedOrder(
  order: typeof supplierOrdersTable.$inferSelect,
  productName: string,
) {
  return {
    id: `order-${order.id}`,
    productId: order.productId,
    productName,
    quantityReceived: order.quantityOrdered,
    unit: order.unit,
    source: "supplier_api" as const,
    supplierOrderRef: order.orderRef,
    notes: `Ordered from ${order.supplierName}`,
    receivedAt: order.placedAt.toISOString(),
  };
}

/**
 * Treatment-log deduction/reversal only ever operates on a tech_inventory row
 * whose unit is a fluid-ounce-family unit ("fl oz" / "oz") — see
 * treatment-logs.ts. If a technician+product balance is ever moved out of
 * that unit family while an undeleted treatment log still holds a recorded
 * `inventoryDeductedOz`, deleting that log later would try to restore stock
 * into a "fl oz"/"oz" row that no longer exists in that unit, silently
 * dropping both the stock restoration and its reversal ledger entry. Guard
 * against that by refusing a switch away from the fl-oz family whenever such
 * an outstanding (not-yet-deleted) deduction exists, regardless of the
 * balance's current quantity.
 */
const FLUID_OZ_UNITS = new Set(["fl oz", "oz"]);

async function hasOutstandingFluidOzDeduction(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  companyId: number,
  technicianId: string,
  productId: number,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: treatmentLogsTable.id })
    .from(treatmentLogsTable)
    .where(
      and(
        eq(treatmentLogsTable.companyId, companyId),
        eq(treatmentLogsTable.technicianId, technicianId),
        eq(treatmentLogsTable.productId, productId),
        isNotNull(treatmentLogsTable.inventoryDeductedOz),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Most recent treatment-log application per product for a single technician,
 * used to power the "Last applied: [time] — X oz" line on the mobile
 * inventory screen. DISTINCT ON keeps this to one row per product regardless
 * of how many applications the technician has logged.
 */
async function fetchLastAppliedByProduct(
  companyId: number,
  technicianId: string,
): Promise<Map<number, { lastAppliedAt: string; lastAppliedOz: number | null }>> {
  const result = await db.execute(
    sql`SELECT DISTINCT ON (product_id) product_id, applied_at, total_product_oz
        FROM treatment_logs
        WHERE company_id = ${companyId} AND technician_id = ${technicianId}
        ORDER BY product_id, applied_at DESC`,
  );
  const map = new Map<number, { lastAppliedAt: string; lastAppliedOz: number | null }>();
  for (const row of result.rows as {
    product_id: number;
    applied_at: Date | string;
    total_product_oz: number | null;
  }[]) {
    map.set(row.product_id, {
      lastAppliedAt: new Date(row.applied_at).toISOString(),
      lastAppliedOz: row.total_product_oz,
    });
  }
  return map;
}

/**
 * Sum of totalProductOz applied per (technician, product) so far "today",
 * for the manager's team-inventory view. "Today" is bucketed in the
 * caller's local calendar day (see calendar-tz.ts) rather than UTC, falling
 * back to UTC when tzOffsetMinutes is omitted — same convention as Route
 * Readiness / Truck Stock Health.
 */
async function fetchAppliedTodayByTechAndProduct(
  companyId: number,
  tzOffsetMinutes: number,
): Promise<Map<string, number>> {
  const dateStr = localCalendarDate(new Date(), tzOffsetMinutes);
  const dayStart = localMidnightUtc(dateStr, tzOffsetMinutes);
  const dayEnd = localEndOfDayUtc(dateStr, tzOffsetMinutes);

  const rows = await db
    .select({
      technicianId: treatmentLogsTable.technicianId,
      productId: treatmentLogsTable.productId,
      totalOz: sql<number>`COALESCE(SUM(${treatmentLogsTable.totalProductOz}), 0)`,
    })
    .from(treatmentLogsTable)
    .where(
      and(
        eq(treatmentLogsTable.companyId, companyId),
        gte(treatmentLogsTable.appliedAt, dayStart),
        lte(treatmentLogsTable.appliedAt, dayEnd),
      ),
    )
    .groupBy(treatmentLogsTable.technicianId, treatmentLogsTable.productId);

  const map = new Map<string, number>();
  for (const r of rows) {
    if (!r.technicianId) continue;
    map.set(`${r.technicianId}:${r.productId}`, Number(r.totalOz));
  }
  return map;
}

// ─── GET /technician/inventory ────────────────────────────────────────────────

router.get("/technician/inventory", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const technicianId = req.user?.clerkUserId;
    if (!technicianId) return res.status(401).json({ error: "Unauthorized" });

    const rows = await db
      .select({ inv: techInventoryTable, product: productsTable })
      .from(techInventoryTable)
      .innerJoin(productsTable, eq(productsTable.id, techInventoryTable.productId))
      .where(
        and(
          eq(techInventoryTable.companyId, companyId),
          eq(techInventoryTable.technicianId, technicianId),
          eq(productsTable.isActive, true),
        ),
      )
      .orderBy(productsTable.name);

    // Most recent application per product, for the "Last applied" display.
    const lastAppliedByProduct = await fetchLastAppliedByProduct(companyId, technicianId);

    return res.json(
      rows.map((r) =>
        serializeInventoryItem(r.inv, r.product, lastAppliedByProduct.get(r.inv.productId)),
      ),
    );
  } catch (err) {
    logger.error({ err }, "[inventory] GET /technician/inventory error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /technician/inventory/stock-health ──────────────────────────────────
//
// Truck Stock Health — a longer-range "days of coverage remaining" projection
// per product (on-hand ÷ recent average daily consumption), compared against
// the configured replenishment target window. This is a proactive, TRENDING
// signal independent of today's schedule — distinct from Today's Route
// Readiness (see /technician/daily-rig/route-readiness) and from the
// existing reactive restockThreshold alert, which is unchanged.

router.get("/technician/inventory/stock-health", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const technicianId = req.user?.clerkUserId;
    if (!technicianId) return res.status(401).json({ error: "Unauthorized" });

    const lookbackRaw = typeof req.query.lookbackDays === "string" ? parseInt(req.query.lookbackDays, 10) : NaN;
    const lookbackDays = Number.isFinite(lookbackRaw) ? Math.min(Math.max(lookbackRaw, 7), 90) : undefined;

    const health = await computeTruckStockHealth(companyId, technicianId, lookbackDays);
    return res.json(health);
  } catch (err) {
    logger.error({ err }, "[inventory] GET /technician/inventory/stock-health error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /technician/inventory/baseline ─────────────────────────────────────

const baselineItemSchema = z.object({
  productId: z.number().int().positive(),
  quantityOnHand: z.number().min(0),
  unit: z.string().min(1).max(20).default("unit"),
  /**
   * Minimum on-hand quantity below which a manager alert fires after a
   * treatment-log deduction. Included in baseline so techs can set their
   * safe-working-level during first-time truck setup.
   */
  restockThreshold: z.number().min(0).nullable().optional(),
});

const baselineSchema = z.object({
  items: z.array(baselineItemSchema).min(1).max(100),
});

router.post("/technician/inventory/baseline", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const technicianId = req.user?.clerkUserId;
    if (!technicianId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = baselineSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", detail: parsed.error.issues });
    }

    // Verify all products exist and are active.
    const productIds = parsed.data.items.map((i) => i.productId);
    const validProducts = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(and(inArray(productsTable.id, productIds), eq(productsTable.isActive, true)));

    const validSet = new Set(validProducts.map((p) => p.id));
    const invalid = productIds.filter((id) => !validSet.has(id));
    if (invalid.length > 0) {
      return res.status(400).json({ error: "Invalid product IDs", invalid });
    }

    // Upsert each item. Each item is its own transaction so the resulting
    // ledger row (recording the delta from whatever was on hand before) is
    // never written without the balance change actually landing, or vice versa.
    for (const item of parsed.data.items) {
      try {
        await db.transaction(async (tx) => {
        // Advisory-lock this technician's balance for this product so a
        // concurrent write to the same row can't read the same "before"
        // quantity and produce a ledger delta that doesn't match what was
        // actually applied.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`truck:${companyId}:${technicianId}:${item.productId}`})::bigint)`,
        );

        const [existing] = await tx
          .select({ quantityOnHand: techInventoryTable.quantityOnHand, unit: techInventoryTable.unit })
          .from(techInventoryTable)
          .where(
            and(
              eq(techInventoryTable.companyId, companyId),
              eq(techInventoryTable.technicianId, technicianId),
              eq(techInventoryTable.productId, item.productId),
            ),
          );
        const oldQty = existing?.quantityOnHand ?? 0;

        // Unit-change guard: a nonempty balance's unit defines what its
        // quantity means. Silently switching units on a nonzero balance
        // (e.g. "10 gallon" becoming "10 fl oz") would rewrite the meaning
        // of existing stock without any auditable event, and would compute a
        // ledger delta comparing quantities in two different units. Setting a
        // balance that's currently zero (or doesn't exist yet) may freely
        // pick any unit — there's no real stock whose meaning would change.
        if (existing && oldQty !== 0 && existing.unit !== item.unit) {
          const err = new Error("UNIT_MISMATCH");
          (err as { code?: string }).code = "UNIT_MISMATCH";
          (err as { existingUnit?: string }).existingUnit = existing.unit;
          (err as { productId?: number }).productId = item.productId;
          throw err;
        }

        // Even when the current balance is zero, moving off a "fl oz"/"oz"
        // unit is unsafe while an undeleted treatment log still has a
        // recorded deduction against this technician+product — see
        // hasOutstandingFluidOzDeduction() above.
        if (!FLUID_OZ_UNITS.has(item.unit) && (!existing || FLUID_OZ_UNITS.has(existing.unit))) {
          const outstanding = await hasOutstandingFluidOzDeduction(tx, companyId, technicianId, item.productId);
          if (outstanding) {
            const err = new Error("UNIT_MISMATCH");
            (err as { code?: string }).code = "UNIT_MISMATCH";
            (err as { existingUnit?: string }).existingUnit = existing?.unit ?? "fl oz";
            (err as { productId?: number }).productId = item.productId;
            throw err;
          }
        }

        await tx
          .insert(techInventoryTable)
          .values({
            companyId,
            technicianId,
            productId: item.productId,
            quantityOnHand: item.quantityOnHand,
            unit: item.unit,
            restockThreshold: item.restockThreshold ?? null,
          })
          .onConflictDoUpdate({
            target: [
              techInventoryTable.companyId,
              techInventoryTable.technicianId,
              techInventoryTable.productId,
            ],
            set: {
              quantityOnHand: item.quantityOnHand,
              unit: item.unit,
              // Only update restockThreshold when explicitly provided (including
              // null to clear it); omitting the field preserves an existing threshold.
              ...(item.restockThreshold !== undefined
                ? { restockThreshold: item.restockThreshold }
                : {}),
              updatedAt: new Date(),
            },
          });

        // ── Immutable ledger entry ──────────────────────────────────────────
        // Baselines set an absolute on-hand count rather than a relative
        // receipt/deduction; record the resulting delta so every balance
        // change — not just receipts and treatment deductions — is auditable.
        const delta = item.quantityOnHand - oldQty;
        if (delta !== 0) {
          await tx.insert(inventoryTransactionsTable).values({
            companyId,
            productId: item.productId,
            quantity: Math.abs(delta),
            unit: item.unit,
            movementType: "truck_adjustment",
            source: delta > 0 ? "adjustment:baseline" : `truck:${technicianId}`,
            destination: delta > 0 ? `truck:${technicianId}` : "adjustment:baseline",
            technicianId,
            actingUserId: technicianId,
          });
        }
        });
      } catch (err: unknown) {
        if ((err as { code?: string }).code === "UNIT_MISMATCH") {
          return res.status(409).json({
            error: "Unit mismatch: your existing truck balance for this product uses a different unit",
            detail: {
              productId: (err as { productId?: number }).productId,
              existingUnit: (err as { existingUnit?: string }).existingUnit,
              requestedUnit: item.unit,
            },
          });
        }
        throw err;
      }
    }

    return res.status(201).json({ updated: parsed.data.items.length });
  } catch (err) {
    logger.error({ err }, "[inventory] POST /technician/inventory/baseline error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PATCH /technician/inventory/:productId ───────────────────────────────────

const patchInventorySchema = z.object({
  quantityOnHand: z.number().min(0),
  unit: z.string().min(1).max(20).optional(),
  /**
   * Minimum on-hand quantity (same unit as quantityOnHand) below which a
   * manager restock alert fires after the next treatment-log deduction.
   * Pass null to clear an existing threshold.
   */
  restockThreshold: z.number().min(0).nullable().optional(),
});

router.patch("/technician/inventory/:productId", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const technicianId = req.user?.clerkUserId;
    if (!technicianId) return res.status(401).json({ error: "Unauthorized" });

    const productId = parseInt(req.params.productId);
    if (Number.isNaN(productId)) return res.status(400).json({ error: "Invalid product ID" });

    const parsed = patchInventorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", detail: parsed.error.issues });
    }

    let row;
    try {
      row = await db.transaction(async (tx) => {
      // Advisory-lock this technician's balance for this product — see the
      // baseline route above for why a bare read-then-write can otherwise
      // produce a ledger delta that doesn't match what was actually applied.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`truck:${companyId}:${technicianId}:${productId}`})::bigint)`,
      );

      const [existing] = await tx
        .select({ quantityOnHand: techInventoryTable.quantityOnHand, unit: techInventoryTable.unit })
        .from(techInventoryTable)
        .where(
          and(
            eq(techInventoryTable.companyId, companyId),
            eq(techInventoryTable.technicianId, technicianId),
            eq(techInventoryTable.productId, productId),
          ),
        );
      const oldQty = existing?.quantityOnHand ?? 0;

      // Unit-change guard — see the baseline route above: a nonempty balance
      // may not be silently switched to a different unit. Only applies when
      // the caller actually specified a unit; omitting `unit` always keeps
      // whatever unit the row already has.
      if (existing && oldQty !== 0 && parsed.data.unit && existing.unit !== parsed.data.unit) {
        const err = new Error("UNIT_MISMATCH");
        (err as { code?: string }).code = "UNIT_MISMATCH";
        (err as { existingUnit?: string }).existingUnit = existing.unit;
        throw err;
      }

      // See the baseline route above: moving off a "fl oz"/"oz" unit is
      // unsafe while an undeleted treatment log still has a recorded
      // deduction against this technician+product, even at a zero balance.
      if (
        parsed.data.unit &&
        !FLUID_OZ_UNITS.has(parsed.data.unit) &&
        (!existing || FLUID_OZ_UNITS.has(existing.unit))
      ) {
        const outstanding = await hasOutstandingFluidOzDeduction(tx, companyId, technicianId, productId);
        if (outstanding) {
          const err = new Error("UNIT_MISMATCH");
          (err as { code?: string }).code = "UNIT_MISMATCH";
          (err as { existingUnit?: string }).existingUnit = existing?.unit ?? "fl oz";
          throw err;
        }
      }

      const [updated] = await tx
        .insert(techInventoryTable)
        .values({
          companyId,
          technicianId,
          productId,
          quantityOnHand: parsed.data.quantityOnHand,
          unit: parsed.data.unit ?? "unit",
          restockThreshold: parsed.data.restockThreshold ?? null,
        })
        .onConflictDoUpdate({
          target: [
            techInventoryTable.companyId,
            techInventoryTable.technicianId,
            techInventoryTable.productId,
          ],
          set: {
            quantityOnHand: parsed.data.quantityOnHand,
            ...(parsed.data.unit ? { unit: parsed.data.unit } : {}),
            // Only update restockThreshold when explicitly provided (including null
            // to clear it); omitting the field leaves the existing threshold intact.
            ...(parsed.data.restockThreshold !== undefined
              ? { restockThreshold: parsed.data.restockThreshold }
              : {}),
            updatedAt: new Date(),
          },
        })
        .returning();

      if (!updated) return updated;

      // ── Immutable ledger entry ────────────────────────────────────────────
      // This route sets an absolute on-hand count (a manual correction), not
      // a relative receipt/deduction — record the resulting delta so the
      // ledger stays a complete audit trail of every balance change.
      const delta = parsed.data.quantityOnHand - oldQty;
      if (delta !== 0) {
        await tx.insert(inventoryTransactionsTable).values({
          companyId,
          productId,
          quantity: Math.abs(delta),
          unit: updated.unit,
          movementType: "truck_adjustment",
          source: delta > 0 ? "adjustment:manual" : `truck:${technicianId}`,
          destination: delta > 0 ? `truck:${technicianId}` : "adjustment:manual",
          technicianId,
          actingUserId: technicianId,
        });
      }

      return updated;
      });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "UNIT_MISMATCH") {
        return res.status(409).json({
          error: "Unit mismatch: your existing truck balance for this product uses a different unit",
          detail: {
            existingUnit: (err as { existingUnit?: string }).existingUnit,
            requestedUnit: parsed.data.unit,
          },
        });
      }
      throw err;
    }

    if (!row) return res.status(500).json({ error: "Failed to update" });

    const [productRow] = await db
      .select()
      .from(productsTable)
      .where(eq(productsTable.id, productId));

    if (!productRow) return res.status(404).json({ error: "Product not found" });

    return res.json(serializeInventoryItem(row, productRow));
  } catch (err) {
    logger.error({ err }, "[inventory] PATCH /technician/inventory error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /technician/inventory/restock-events ─────────────────────────────────

router.get("/technician/inventory/restock-events", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const technicianId = req.user?.clerkUserId;
    if (!technicianId) return res.status(401).json({ error: "Unauthorized" });

    const limit = Math.min(parseInt(String(req.query.limit ?? "50")), 200);

    const rows = await db
      .select({ event: techRestockEventsTable, product: productsTable })
      .from(techRestockEventsTable)
      .innerJoin(productsTable, eq(productsTable.id, techRestockEventsTable.productId))
      .where(
        and(
          eq(techRestockEventsTable.companyId, companyId),
          eq(techRestockEventsTable.technicianId, technicianId),
        ),
      )
      .orderBy(desc(techRestockEventsTable.receivedAt))
      .limit(limit);

    return res.json(rows.map((r) => serializeRestockEvent(r.event, r.product.name)));
  } catch (err) {
    logger.error({ err }, "[inventory] GET /technician/inventory/restock-events error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /technician/inventory/restock-events ────────────────────────────────

const restockSchema = z.object({
  productId: z.number().int().positive(),
  quantityReceived: z.number().positive(),
  unit: z.string().min(1).max(20).default("unit"),
  source: z.enum(["manual", "csv_import"]).default("manual"),
  supplierOrderRef: z.string().max(200).optional(),
  notes: z.string().max(500).optional(),
});

router.post("/technician/inventory/restock-events", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const technicianId = req.user?.clerkUserId;
    if (!technicianId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = restockSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", detail: parsed.error.issues });
    }

    // Verify product exists.
    const [product] = await db
      .select()
      .from(productsTable)
      .where(and(eq(productsTable.id, parsed.data.productId), eq(productsTable.isActive, true)));
    if (!product) return res.status(404).json({ error: "Product not found" });

    // Insert restock event and update inventory inside a single transaction so
    // a partial failure never leaves an event row without a stock adjustment.
    const qty = parsed.data.quantityReceived;
    const unit = parsed.data.unit;

    try {
      const event = await db.transaction(async (tx) => {
        // Advisory-lock this technician's balance for this product before
        // touching anything — see the warehouse routes above for why a plain
        // `FOR UPDATE` isn't enough when the row may not exist yet.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`truck:${companyId}:${technicianId}:${parsed.data.productId}`})::bigint)`,
        );

        const existingResult = await tx.execute(
          sql`SELECT unit FROM tech_inventory
              WHERE company_id = ${companyId} AND technician_id = ${technicianId} AND product_id = ${parsed.data.productId}`,
        );
        const existingUnit = (existingResult.rows[0] as { unit: string } | undefined)?.unit;
        if (existingUnit && existingUnit !== unit) {
          const err = new Error("UNIT_MISMATCH");
          (err as { code?: string }).code = "UNIT_MISMATCH";
          (err as { existingUnit?: string }).existingUnit = existingUnit;
          throw err;
        }

        const [restockEvent] = await tx
          .insert(techRestockEventsTable)
          .values({
            companyId,
            technicianId,
            productId: parsed.data.productId,
            quantityReceived: qty,
            unit,
            source: parsed.data.source,
            supplierOrderRef: parsed.data.supplierOrderRef ?? null,
            notes: parsed.data.notes ?? null,
          })
          .returning();

        if (!restockEvent) throw new Error("Failed to insert restock event");

        // Try INSERT first; if the row exists, add to the existing quantity.
        const inserted = await tx
          .insert(techInventoryTable)
          .values({
            companyId,
            technicianId,
            productId: parsed.data.productId,
            quantityOnHand: qty,
            unit,
          })
          .onConflictDoNothing()
          .returning({ id: techInventoryTable.id });

        if (inserted.length === 0) {
          await tx.execute(
            sql`UPDATE tech_inventory
                  SET quantity_on_hand = quantity_on_hand + ${qty},
                      updated_at = NOW()
                WHERE company_id   = ${companyId}
                  AND technician_id = ${technicianId}
                  AND product_id    = ${parsed.data.productId}`,
          );
        }

        // ── Immutable ledger entry ────────────────────────────────────────────
        // Mirrors the restock event as a generic transaction row so restocks
        // and treatment deductions share one audit trail.
        await tx.insert(inventoryTransactionsTable).values({
          companyId,
          productId: parsed.data.productId,
          quantity: qty,
          unit,
          movementType: "truck_receipt",
          source: `restock:${parsed.data.source}`,
          destination: `truck:${technicianId}`,
          technicianId,
          actingUserId: technicianId,
          referenceId: restockEvent.id,
        });

        return restockEvent;
      });

      return res.status(201).json(serializeRestockEvent(event, product.name));
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "UNIT_MISMATCH") {
        return res.status(409).json({
          error: "Unit mismatch: your existing truck balance for this product uses a different unit",
          detail: { existingUnit: (err as { existingUnit?: string }).existingUnit, requestedUnit: unit },
        });
      }
      throw err;
    }
  } catch (err) {
    logger.error({ err }, "[inventory] POST /technician/inventory/restock-events error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /manager/team-inventory ─────────────────────────────────────────────

router.get("/manager/team-inventory", requireRole("manager"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const tzOffsetMinutes = parseTzOffsetMinutes(req.query.tzOffsetMinutes);

    // Get all inventory rows for the company.
    const rows = await db
      .select({ inv: techInventoryTable, product: productsTable })
      .from(techInventoryTable)
      .innerJoin(productsTable, eq(productsTable.id, techInventoryTable.productId))
      .where(eq(techInventoryTable.companyId, companyId))
      .orderBy(techInventoryTable.technicianId, productsTable.name);

    // Get most recent restock per tech.
    const restockRows = await db
      .select()
      .from(techRestockEventsTable)
      .where(eq(techRestockEventsTable.companyId, companyId))
      .orderBy(desc(techRestockEventsTable.receivedAt));

    const lastRestockByTech = new Map<string, string>();
    for (const r of restockRows) {
      if (!lastRestockByTech.has(r.technicianId)) {
        lastRestockByTech.set(r.technicianId, r.receivedAt.toISOString());
      }
    }

    // "X applied today" — how much of each product each tech has already
    // used today, surfaced next to on-hand so a manager can spot a
    // reported-usage/on-hand mismatch before an audit.
    const appliedTodayByTechProduct = await fetchAppliedTodayByTechAndProduct(companyId, tzOffsetMinutes);

    // Group by technician.
    const grouped = new Map<
      string,
      { items: ReturnType<typeof serializeInventoryItem>[] }
    >();

    for (const r of rows) {
      const existing = grouped.get(r.inv.technicianId) ?? { items: [] };
      const appliedToday = appliedTodayByTechProduct.get(`${r.inv.technicianId}:${r.inv.productId}`) ?? 0;
      existing.items.push(serializeInventoryItem(r.inv, r.product, { appliedToday }));
      grouped.set(r.inv.technicianId, existing);
    }

    const result = Array.from(grouped.entries()).map(([techId, data]) => ({
      technicianId: techId,
      technicianName: null as string | null,
      role: "technician",
      inventoryCount: data.items.length,
      lastRestockedAt: lastRestockByTech.get(techId) ?? null,
      items: data.items,
    }));

    return res.json(result);
  } catch (err) {
    logger.error({ err }, "[inventory] GET /manager/team-inventory error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /manager/team-stock-health ───────────────────────────────────────────
//
// Team-wide Truck Stock Health — same projection as
// /technician/inventory/stock-health, computed for every technician who
// currently has at least one tech_inventory row in this company.

router.get("/manager/team-stock-health", requireRole("manager"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const lookbackRaw = typeof req.query.lookbackDays === "string" ? parseInt(req.query.lookbackDays, 10) : NaN;
    const lookbackDays = Number.isFinite(lookbackRaw) ? Math.min(Math.max(lookbackRaw, 7), 90) : undefined;

    const technicianIds = await db
      .selectDistinct({ technicianId: techInventoryTable.technicianId })
      .from(techInventoryTable)
      .where(eq(techInventoryTable.companyId, companyId));

    const results = await Promise.all(
      technicianIds.map((t) => computeTruckStockHealth(companyId, t.technicianId, lookbackDays)),
    );

    return res.json(results);
  } catch (err) {
    logger.error({ err }, "[inventory] GET /manager/team-stock-health error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /manager/pending-restocks ───────────────────────────────────────────
//
// Returns all open (status = 'pending') restock alerts for this company,
// ordered by shortfall descending so the most critical gaps appear first.

router.get("/manager/pending-restocks", requireRole("manager"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);

    const result = await db.execute(
      sql`SELECT
            r.id,
            r.technician_id,
            r.product_id,
            p.name          AS product_name,
            r.quantity_on_hand,
            r.restock_threshold,
            r.shortfall,
            r.status,
            r.created_at,
            r.updated_at
          FROM pending_restock_requests r
          JOIN products p ON p.id = r.product_id
          WHERE r.company_id = ${companyId}
            AND r.status     = 'pending'
          ORDER BY r.shortfall DESC, r.updated_at DESC`,
    );

    return res.json(
      result.rows.map((r) => {
        const row = r as {
          id: number;
          technician_id: string;
          product_id: number;
          product_name: string;
          quantity_on_hand: number;
          restock_threshold: number;
          shortfall: number;
          status: string;
          created_at: Date | string;
          updated_at: Date | string;
        };
        return {
          id: row.id,
          technicianId: row.technician_id,
          productId: row.product_id,
          productName: row.product_name,
          quantityOnHand: row.quantity_on_hand,
          restockThreshold: row.restock_threshold,
          shortfall: row.shortfall,
          status: row.status,
          createdAt: new Date(row.created_at).toISOString(),
          updatedAt: new Date(row.updated_at).toISOString(),
        };
      }),
    );
  } catch (err) {
    logger.error({ err }, "[inventory] GET /manager/pending-restocks error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── PATCH /manager/pending-restocks/:id ─────────────────────────────────────
//
// Managers dismiss or approve an alert.
//
// When status = "approved" and the company has an active supplier connection
// with a supported adapter (Veseris, Target Specialty), the handler:
//   1. Instantiates the correct SupplierAdapter.
//   2. Calls adapter.placeOrder() for the alert's shortfall quantity.
//   3. Writes a tech_restock_events row (source="supplier_api") with the
//      returned order reference as the audit trail.
//   4. Returns supplierOrderRef in the response body.
//
// Adapter errors are caught and logged; they do NOT block the approval so a
// transient supplier outage can never leave a manager's action unresolved.

const updateRestockStatusSchema = z.object({
  status: z.enum(["approved", "dismissed"]),
});

router.patch("/manager/pending-restocks/:id", requireRole("manager"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id as string, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    const parsed = updateRestockStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", detail: parsed.error.issues });
    }

    // ── Atomically transition status = 'pending' → requested status ─────────
    //
    // The WHERE status = 'pending' guard is critical for the "approved" path:
    // it ensures placeOrder() is called at most once per alert even if the
    // manager clicks Approve twice or the client retries.  If the row has
    // already moved to "approved" or "dismissed" the UPDATE returns 0 rows and
    // we fall through to the idempotent-retry branch below.
    //
    // For "dismissed" we also guard on status = 'pending' so a dismiss cannot
    // clobber an already-approved row (approved alerts can only be cleared by
    // re-triggering from the treatment-log side).

    const result = await db.execute(
      sql`UPDATE pending_restock_requests
          SET status      = ${parsed.data.status},
              resolved_at = NOW(),
              updated_at  = NOW()
          WHERE id         = ${id}
            AND company_id = ${companyId}
            AND status     = 'pending'
          RETURNING id, technician_id, product_id, quantity_on_hand,
                    restock_threshold, shortfall, status, resolved_at, updated_at`,
    );

    type AlertRow = {
      id: number;
      technician_id: string;
      product_id: number;
      quantity_on_hand: number;
      restock_threshold: number;
      shortfall: number;
      status: string;
      resolved_at: Date | string | null;
      updated_at: Date | string;
    };

    let r: AlertRow;
    let isNewTransition = false;

    if (result.rows.length > 0) {
      r = result.rows[0] as AlertRow;
      isNewTransition = true;
    } else {
      // Row not found or already resolved — check for idempotent retry.
      const existing = await db.execute(
        sql`SELECT id, technician_id, product_id, quantity_on_hand,
                   restock_threshold, shortfall, status, resolved_at, updated_at
            FROM pending_restock_requests
            WHERE id = ${id} AND company_id = ${companyId}`,
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: "Restock alert not found" });
      }
      r = existing.rows[0] as AlertRow;
      // Status mismatch (e.g. client sent "approved" but row is "dismissed") → 409.
      if (r.status !== parsed.data.status) {
        return res.status(409).json({
          error: "Alert already resolved",
          currentStatus: r.status,
        });
      }
      // Same status — treat as idempotent retry.
    }

    // ── Supplier order placement (approval only, new transitions only) ────────
    //
    // Only runs when this request is the one that caused the pending→approved
    // transition, guaranteeing at most one placeOrder() call per alert.
    // The supplier_orders table has a UNIQUE constraint on (company_id, alert_id)
    // as a second safety net, so even if two concurrent requests somehow both
    // reach this point only one INSERT succeeds.
    //
    // Idempotent retries on an already-approved alert return the existing
    // supplier_order_ref from the supplier_orders table.
    let supplierOrderRef: string | null = null;

    if (parsed.data.status === "approved") {
      if (isNewTransition) {
        try {
          // Only proceed when the company has an active connection with a
          // supported supplier.  ORDER BY updated_at DESC picks the most
          // recently configured connection when several are active.
          const [connection] = await db
            .select()
            .from(supplierConnectionsTable)
            .where(
              and(
                eq(supplierConnectionsTable.companyId, companyId),
                eq(supplierConnectionsTable.status, "active"),
              ),
            )
            .orderBy(desc(supplierConnectionsTable.updatedAt))
            .limit(1);

          if (connection) {
            const adapter = createSupplierAdapter(connection);

            if (adapter) {
              // Fetch product EPA + inventory unit in parallel.
              const [[productRow], [invRow]] = await Promise.all([
                db
                  .select({
                    epaRegistrationNumber: productsTable.epaRegistrationNumber,
                    name: productsTable.name,
                  })
                  .from(productsTable)
                  .where(eq(productsTable.id, r.product_id))
                  .limit(1),
                db
                  .select({ unit: techInventoryTable.unit })
                  .from(techInventoryTable)
                  .where(
                    and(
                      eq(techInventoryTable.companyId, companyId),
                      eq(techInventoryTable.technicianId, r.technician_id),
                      eq(techInventoryTable.productId, r.product_id),
                    ),
                  )
                  .limit(1),
              ]);

              const unit = invRow?.unit ?? "unit";
              const orderLine: OrderLine = {
                productEpaNumber: productRow?.epaRegistrationNumber ?? null,
                productName: productRow?.name ?? `Product #${r.product_id}`,
                quantity: r.shortfall,
                unit,
                technicianId: r.technician_id,
                notes: `Restock alert #${r.id} — approved via ReadyLoq portal`,
              };

              const orderResult = await adapter.placeOrder([orderLine]);

              // Write the placed-order record.  ON CONFLICT is a last-resort guard
              // for any concurrent approval that slipped through; in that case the
              // winning INSERT's order_ref is what gets returned.
              const [orderRow] = await db
                .insert(supplierOrdersTable)
                .values({
                  companyId,
                  alertId: r.id,
                  technicianId: r.technician_id,
                  productId: r.product_id,
                  supplierName: connection.supplierName,
                  orderRef: orderResult.orderRef,
                  quantityOrdered: r.shortfall,
                  unit,
                  notes: `Auto-ordered (alert #${r.id})`,
                })
                .onConflictDoNothing()
                .returning({ orderRef: supplierOrdersTable.orderRef });

              supplierOrderRef = orderRow?.orderRef ?? orderResult.orderRef;

              logger.info(
                {
                  alertId: r.id,
                  companyId,
                  orderRef: supplierOrderRef,
                  supplier: connection.supplierName,
                },
                "[inventory] supplier order placed for approved restock alert",
              );
            }
          }
        } catch (orderErr) {
          // Log but do not propagate — alert resolution already succeeded.
          logger.error({ orderErr, alertId: r.id }, "[inventory] supplier order placement failed");
        }
      } else {
        // Idempotent retry — return the existing order ref if one was placed.
        const [existingOrder] = await db
          .select({ orderRef: supplierOrdersTable.orderRef })
          .from(supplierOrdersTable)
          .where(
            and(
              eq(supplierOrdersTable.companyId, companyId),
              eq(supplierOrdersTable.alertId, r.id),
            ),
          )
          .limit(1);
        supplierOrderRef = existingOrder?.orderRef ?? null;
      }
    }

    return res.json({
      id: r.id,
      technicianId: r.technician_id,
      productId: r.product_id,
      quantityOnHand: r.quantity_on_hand,
      restockThreshold: r.restock_threshold,
      shortfall: r.shortfall,
      status: r.status,
      resolvedAt: r.resolved_at != null ? new Date(r.resolved_at).toISOString() : null,
      updatedAt: new Date(r.updated_at).toISOString(),
      supplierOrderRef,
    });
  } catch (err) {
    logger.error({ err }, "[inventory] PATCH /manager/pending-restocks error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Predictive restock recommendations (Task #918) ──────────────────────────
//
// A fourth, distinct proactive signal — forward-looking, adaptively
// recomputed from a recency-weighted consumption trend + upcoming scheduled
// stops + configured supplier lead time (see lib/predictive-restocking.ts) —
// separate from the reactive `pending_restock_requests` alert above and from
// the derive-on-read Route Readiness / Truck Stock Health views.
//
// GET is a pure read: recomputation happens event-triggered (right after a
// treatment-log deduction) and via the periodic sweep
// (predictive-restocking-scheduler.ts), never on this request, so a
// dismissal never appears to "come back" just from a manager refreshing.

function serializePredictiveRecommendation(
  row: typeof predictiveRestockRecommendationsTable.$inferSelect,
  productName: string,
) {
  return {
    id: row.id,
    technicianId: row.technicianId,
    productId: row.productId,
    productName,
    quantityOnHand: row.quantityOnHand,
    unit: row.unit,
    projectedDailyRate: row.projectedDailyRate,
    leadTimeDays: row.leadTimeDays,
    safetyStockDays: row.safetyStockDays,
    reorderPointQuantity: row.reorderPointQuantity,
    recommendedOrderQuantity: row.recommendedOrderQuantity,
    scheduledStopCount: row.scheduledStopCount,
    projectedBreachAt: row.projectedBreachAt?.toISOString() ?? null,
    recommendedByAt: row.recommendedByAt.toISOString(),
    status: row.status,
    convertedAlertId: row.convertedAlertId,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// GET /manager/predictive-restocks — all open ('pending') recommendations for
// this company, soonest-due first.
router.get("/manager/predictive-restocks", requireRole("manager"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);

    const rows = await db
      .select()
      .from(predictiveRestockRecommendationsTable)
      .where(
        and(
          eq(predictiveRestockRecommendationsTable.companyId, companyId),
          eq(predictiveRestockRecommendationsTable.status, "pending"),
        ),
      )
      .orderBy(predictiveRestockRecommendationsTable.recommendedByAt);

    if (rows.length === 0) return res.json([]);

    const productIds = [...new Set(rows.map((r) => r.productId))];
    const productRows = await db
      .select({ id: productsTable.id, name: productsTable.name })
      .from(productsTable)
      .where(inArray(productsTable.id, productIds));
    const productNameMap = new Map(productRows.map((p) => [p.id, p.name]));

    return res.json(
      rows.map((r) => serializePredictiveRecommendation(r, productNameMap.get(r.productId) ?? `Product #${r.productId}`)),
    );
  } catch (err) {
    logger.error({ err }, "[inventory] GET /manager/predictive-restocks error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /manager/predictive-restocks/:id — dismiss a recommendation.
const updatePredictiveRestockSchema = z.object({ status: z.literal("dismissed") });

router.patch("/manager/predictive-restocks/:id", requireRole("manager"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    const parsed = updatePredictiveRestockSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", detail: parsed.error.issues });
    }

    // Guard on status='pending' so a dismiss can't clobber a row that was
    // already converted (or dismissed) by a concurrent request.
    const [row] = await db
      .update(predictiveRestockRecommendationsTable)
      .set({ status: "dismissed", resolvedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(predictiveRestockRecommendationsTable.id, id),
          eq(predictiveRestockRecommendationsTable.companyId, companyId),
          eq(predictiveRestockRecommendationsTable.status, "pending"),
        ),
      )
      .returning();

    if (row) {
      const [product] = await db
        .select({ name: productsTable.name })
        .from(productsTable)
        .where(eq(productsTable.id, row.productId));
      return res.json(serializePredictiveRecommendation(row, product?.name ?? `Product #${row.productId}`));
    }

    // Not found, or already resolved — check for an idempotent retry.
    const [existing] = await db
      .select()
      .from(predictiveRestockRecommendationsTable)
      .where(
        and(
          eq(predictiveRestockRecommendationsTable.id, id),
          eq(predictiveRestockRecommendationsTable.companyId, companyId),
        ),
      );
    if (!existing) return res.status(404).json({ error: "Recommendation not found" });
    if (existing.status === "dismissed") {
      const [product] = await db
        .select({ name: productsTable.name })
        .from(productsTable)
        .where(eq(productsTable.id, existing.productId));
      return res.json(serializePredictiveRecommendation(existing, product?.name ?? `Product #${existing.productId}`));
    }
    return res.status(409).json({ error: "Recommendation already resolved", currentStatus: existing.status });
  } catch (err) {
    logger.error({ err }, "[inventory] PATCH /manager/predictive-restocks error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /manager/predictive-restocks/:id/convert-to-alert — "act on" a
// recommendation. Per the task's explicit scope boundary, this NEVER places
// a supplier order directly: it upserts a pending_restock_requests row (the
// same table/unique-key the reactive alert uses) so the recommendation flows
// through the existing, already-tested manager-approval → supplier-order
// pipeline (PATCH /manager/pending-restocks/:id) rather than duplicating it.
router.post(
  "/manager/predictive-restocks/:id/convert-to-alert",
  requireRole("manager"),
  async (req, res) => {
    try {
      const companyId = getCompanyId(req);
      const id = parseInt(String(req.params.id ?? ""), 10);
      if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

      const [rec] = await db
        .select()
        .from(predictiveRestockRecommendationsTable)
        .where(
          and(
            eq(predictiveRestockRecommendationsTable.id, id),
            eq(predictiveRestockRecommendationsTable.companyId, companyId),
          ),
        );
      if (!rec) return res.status(404).json({ error: "Recommendation not found" });

      if (rec.status === "converted") {
        // Idempotent retry — return the alert it already produced.
        const [alert] = await db
          .select({ id: pendingRestockRequestsTable.id })
          .from(pendingRestockRequestsTable)
          .where(eq(pendingRestockRequestsTable.id, rec.convertedAlertId ?? -1));
        return res.json({ id: rec.id, status: rec.status, alertId: alert?.id ?? rec.convertedAlertId });
      }
      if (rec.status === "dismissed") {
        return res.status(409).json({ error: "Recommendation already dismissed" });
      }

      const now = new Date();

      // Both writes (the pending_restock_requests upsert and marking the
      // recommendation "converted") happen atomically so a crash between
      // them can never leave a recommendation pointing at a row that was
      // never actually created, or vice versa.
      const { alert, updatedRec } = await db.transaction(async (tx) => {
        const [insertedAlert] = await tx
          .insert(pendingRestockRequestsTable)
          .values({
            companyId,
            technicianId: rec.technicianId,
            productId: rec.productId,
            quantityOnHand: rec.quantityOnHand,
            restockThreshold: rec.reorderPointQuantity,
            shortfall: rec.recommendedOrderQuantity,
            status: "pending",
          })
          .onConflictDoUpdate({
            target: [
              pendingRestockRequestsTable.companyId,
              pendingRestockRequestsTable.technicianId,
              pendingRestockRequestsTable.productId,
            ],
            set: {
              // Never resurrect an already-'approved' alert back to
              // 'pending'. The approve handler (PATCH
              // /manager/pending-restocks/:id) guards supplier-order
              // placement on `WHERE status = 'pending'`, so resetting an
              // approved row here would let a second, unrelated approval
              // click call placeOrder() again for the same real-world
              // order. A 'pending' or 'dismissed' existing row is safe to
              // (re)open — reopening a dismissed row on new information
              // mirrors the reactive alert's own convention. All CASE
              // conditions reference the pre-existing row (bare column
              // names in an ON CONFLICT SET refer to the row being
              // updated, not the newly-proposed values).
              quantityOnHand: sql`CASE WHEN ${pendingRestockRequestsTable.status} = 'approved' THEN ${pendingRestockRequestsTable.quantityOnHand} ELSE ${rec.quantityOnHand} END`,
              restockThreshold: sql`CASE WHEN ${pendingRestockRequestsTable.status} = 'approved' THEN ${pendingRestockRequestsTable.restockThreshold} ELSE ${rec.reorderPointQuantity} END`,
              shortfall: sql`CASE WHEN ${pendingRestockRequestsTable.status} = 'approved' THEN ${pendingRestockRequestsTable.shortfall} ELSE ${rec.recommendedOrderQuantity} END`,
              status: sql`CASE WHEN ${pendingRestockRequestsTable.status} = 'approved' THEN ${pendingRestockRequestsTable.status} ELSE 'pending' END`,
              resolvedAt: sql`CASE WHEN ${pendingRestockRequestsTable.status} = 'approved' THEN ${pendingRestockRequestsTable.resolvedAt} ELSE NULL END`,
              updatedAt: now,
            },
          })
          .returning();

        if (!insertedAlert) throw new Error("Failed to convert recommendation");

        const [rec2] = await tx
          .update(predictiveRestockRecommendationsTable)
          .set({ status: "converted", convertedAlertId: insertedAlert.id, resolvedAt: now, updatedAt: now })
          .where(eq(predictiveRestockRecommendationsTable.id, rec.id))
          .returning();

        return { alert: insertedAlert, updatedRec: rec2 };
      });

      logger.info(
        { recommendationId: rec.id, alertId: alert.id, companyId, alertStatus: alert.status },
        "[inventory] predictive recommendation converted to restock alert",
      );

      // alertStatus lets the manager UI distinguish "a fresh/reopened alert
      // was created" from "this product/technician already has an approved
      // alert in flight" — in the latter case nothing was reset, the
      // recommendation just links to the alert that already covers it.
      return res.json({ id: updatedRec?.id ?? rec.id, status: "converted", alertId: alert.id, alertStatus: alert.status });
    } catch (err) {
      logger.error({ err }, "[inventory] POST /manager/predictive-restocks/:id/convert-to-alert error");
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── PATCH /manager/inventory/:technicianId/:productId ───────────────────────
//
// Managers set (or clear) the restock-alert threshold for a specific
// technician's product. Only updates existing inventory rows — managers cannot
// add a product to a tech's truck through this endpoint.

const managerThresholdSchema = z.object({
  restockThreshold: z.number().min(0).nullable(),
});

router.patch(
  "/manager/inventory/:technicianId/:productId",
  requireRole("manager"),
  async (req, res) => {
    try {
      const companyId = getCompanyId(req);
      const technicianId = String(req.params.technicianId ?? "");
      const productId = parseInt(req.params.productId as string, 10);

      if (!technicianId || Number.isNaN(productId)) {
        return res.status(400).json({ error: "Invalid params" });
      }

      const parsed = managerThresholdSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid body", detail: parsed.error.issues });
      }

      const [updated] = await db
        .update(techInventoryTable)
        .set({ restockThreshold: parsed.data.restockThreshold, updatedAt: new Date() })
        .where(
          and(
            eq(techInventoryTable.companyId, companyId),
            eq(techInventoryTable.technicianId, technicianId),
            eq(techInventoryTable.productId, productId),
          ),
        )
        .returning();

      if (!updated) {
        return res
          .status(404)
          .json({ error: "Inventory item not found — the technician must add this product first" });
      }

      return res.json({
        technicianId,
        productId,
        restockThreshold: updated.restockThreshold,
      });
    } catch (err) {
      logger.error({ err }, "[inventory] PATCH /manager/inventory threshold error");
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ─── GET /manager/restock-orders/:orderRef ───────────────────────────────────
//
// Fetches the live fulfilment status of a previously placed supplier order
// (tracked in supplier_orders, referenced from tech_restock_events via
// supplier_order_ref). The adapter is resolved by matching the order's
// supplierName against this company's active supplier_connections row —
// mirrors the lookup used when the order was originally placed in
// PATCH /manager/pending-restocks/:id.
//
// Tenant isolation: the order lookup is scoped to companyId, so a manager can
// never probe another company's order reference.

router.get("/manager/restock-orders/:orderRef", requireRole("manager"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const orderRef = String(req.params.orderRef ?? "").trim();
    if (!orderRef) return res.status(400).json({ error: "Missing orderRef" });

    const [order] = await db
      .select()
      .from(supplierOrdersTable)
      .where(
        and(eq(supplierOrdersTable.companyId, companyId), eq(supplierOrdersTable.orderRef, orderRef)),
      )
      .limit(1);

    if (!order) return res.status(404).json({ error: "Order not found" });

    // Most recently configured active connection for this supplier — same
    // tie-break rule used at order-placement time.
    const [connection] = await db
      .select()
      .from(supplierConnectionsTable)
      .where(
        and(
          eq(supplierConnectionsTable.companyId, companyId),
          eq(supplierConnectionsTable.supplierName, order.supplierName),
          eq(supplierConnectionsTable.status, "active"),
        ),
      )
      .orderBy(desc(supplierConnectionsTable.updatedAt))
      .limit(1);

    if (!connection) {
      return res.status(404).json({
        error: `No active supplier connection for '${order.supplierName}'`,
      });
    }

    const adapter = createSupplierAdapter(connection);
    if (!adapter) {
      return res.status(404).json({
        error: `No adapter available for supplier '${connection.supplierName}'`,
      });
    }

    let statusValue;
    try {
      statusValue = await adapter.getOrderStatus(orderRef);
    } catch (adapterErr) {
      logger.error(
        { adapterErr, orderRef, supplier: connection.supplierName },
        "[inventory] supplier getOrderStatus failed",
      );
      return res.status(502).json({ error: "Supplier status check failed" });
    }

    return res.json({
      orderRef,
      supplierName: order.supplierName,
      placedAt: order.placedAt.toISOString(),
      ...statusValue,
    });
  } catch (err) {
    logger.error({ err }, "[inventory] GET /manager/restock-orders error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /manager/tech-activity/:userId ──────────────────────────────────────
//
// The "ordered" stream mixes two kinds of rows so a placed order is visible
// from the moment a manager approves it — not only after it's received:
//
//  1. tech_restock_events — confirmed receipts (manual / csv_import / a future
//     live-API confirmDelivery()); these always carry an accurate quantity.
//  2. supplier_orders — orders placed via PATCH /manager/pending-restocks that
//     have NOT yet been confirmed received. Synthesized as source="supplier_api"
//     entries so the frontend renders the live status badge next to them.
//
// Once a placed order's supplier_order_ref shows up in tech_restock_events
// (delivery confirmed), the synthetic "placed" entry is dropped in favor of
// the real receipt row so the timeline never shows the same order twice.

router.get("/manager/tech-activity/:userId", requireRole("manager"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const userId = String(req.params.userId ?? "");
    if (!userId) return res.status(400).json({ error: "Missing userId" });

    // Date range defaults: last 14 days.
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 13);

    if (typeof req.query.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.startDate)) {
      startDate.setTime(new Date(req.query.startDate + "T00:00:00Z").getTime());
    }
    if (typeof req.query.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.endDate)) {
      endDate.setTime(new Date(req.query.endDate + "T23:59:59Z").getTime());
    }

    // Fetch all four data streams in parallel.
    const [restockRows, placedOrderRows, rigRows, treatmentRows] = await Promise.all([
      // 📦 Ordered — restock events in date range.
      db
        .select({ event: techRestockEventsTable, product: productsTable })
        .from(techRestockEventsTable)
        .innerJoin(productsTable, eq(productsTable.id, techRestockEventsTable.productId))
        .where(
          and(
            eq(techRestockEventsTable.companyId, companyId),
            eq(techRestockEventsTable.technicianId, userId),
            gte(techRestockEventsTable.receivedAt, startDate),
            lte(techRestockEventsTable.receivedAt, endDate),
          ),
        )
        .orderBy(desc(techRestockEventsTable.receivedAt)),

      // 📦 Placed — supplier orders placed in date range (not yet necessarily received).
      db
        .select({ order: supplierOrdersTable, product: productsTable })
        .from(supplierOrdersTable)
        .innerJoin(productsTable, eq(productsTable.id, supplierOrdersTable.productId))
        .where(
          and(
            eq(supplierOrdersTable.companyId, companyId),
            eq(supplierOrdersTable.technicianId, userId),
            gte(supplierOrdersTable.placedAt, startDate),
            lte(supplierOrdersTable.placedAt, endDate),
          ),
        )
        .orderBy(desc(supplierOrdersTable.placedAt)),

      // 🎒 Carried — daily rig declarations in date range.
      db
        .select()
        .from(technicianDailyRigsTable)
        .where(
          and(
            eq(technicianDailyRigsTable.companyId, companyId),
            eq(technicianDailyRigsTable.technicianId, userId),
            gte(technicianDailyRigsTable.rigDate, startDate.toISOString().slice(0, 10)),
            lte(technicianDailyRigsTable.rigDate, endDate.toISOString().slice(0, 10)),
          ),
        )
        .orderBy(desc(technicianDailyRigsTable.rigDate)),

      // 🏠 Applied — treatment logs in date range.
      db
        .select({ log: treatmentLogsTable, product: productsTable })
        .from(treatmentLogsTable)
        .innerJoin(productsTable, eq(productsTable.id, treatmentLogsTable.productId))
        .where(
          and(
            eq(treatmentLogsTable.companyId, companyId),
            eq(treatmentLogsTable.technicianId, userId),
            gte(treatmentLogsTable.appliedAt, startDate),
            lte(treatmentLogsTable.appliedAt, endDate),
          ),
        )
        .orderBy(desc(treatmentLogsTable.appliedAt)),
    ]);

    // A placed order that has already been received shows up as its own
    // tech_restock_events row (csv_import/manual) — don't show it twice.
    // Look this up across ALL time (not just the display window) since an
    // order can be placed well before the delivery CSV finally arrives.
    const placedOrderRefs = placedOrderRows.map((r) => r.order.orderRef);
    const receivedRefRows =
      placedOrderRefs.length > 0
        ? await db
            .select({ supplierOrderRef: techRestockEventsTable.supplierOrderRef })
            .from(techRestockEventsTable)
            .where(
              and(
                eq(techRestockEventsTable.companyId, companyId),
                inArray(techRestockEventsTable.supplierOrderRef, placedOrderRefs),
              ),
            )
        : [];
    const receivedRefSet = new Set(receivedRefRows.map((r) => r.supplierOrderRef));
    const unreceivedPlacedOrders = placedOrderRows.filter(
      (r) => !receivedRefSet.has(r.order.orderRef),
    );

    // Collect productIds from daily-rig assignments (carried items) so we can
    // batch-fetch real names rather than showing "Product #N" placeholders.
    const carriedProductIdSet = new Set<number>();
    for (const r of rigRows) {
      const assignments = (r.assignments ?? []) as Array<{ productId: number }>;
      for (const a of assignments) {
        if (typeof a.productId === "number") carriedProductIdSet.add(a.productId);
      }
    }

    // Collect inspectionIds from treatment logs so we can look up site addresses.
    const appliedInspectionIdSet = new Set<number>();
    for (const r of treatmentRows) {
      if (r.log.inspectionId) appliedInspectionIdSet.add(r.log.inspectionId);
    }

    // Fetch carried-product names and applied-site addresses in a single round-trip each.
    const [carriedProductRows, inspectionRows] = await Promise.all([
      carriedProductIdSet.size > 0
        ? db
            .select({ id: productsTable.id, name: productsTable.name })
            .from(productsTable)
            .where(inArray(productsTable.id, Array.from(carriedProductIdSet)))
        : ([] as { id: number; name: string }[]),
      appliedInspectionIdSet.size > 0
        ? db
            .select({ id: inspectionsTable.id, siteAddress: inspectionsTable.siteAddress })
            .from(inspectionsTable)
            .where(
              and(
                inArray(inspectionsTable.id, Array.from(appliedInspectionIdSet)),
                eq(inspectionsTable.companyId, companyId),
              ),
            )
        : ([] as { id: number; siteAddress: string }[]),
    ]);

    const productNameMap = new Map(carriedProductRows.map((p) => [p.id, p.name]));
    const inspectionAddressMap = new Map(inspectionRows.map((i) => [i.id, i.siteAddress]));

    // Bucket everything by date string. "ordered" mixes serialized receipts
    // and serialized placed-but-unreceived orders — both already share the
    // same output shape via serializeRestockEvent()/serializePlacedOrder().
    type OrderedEntry = ReturnType<typeof serializeRestockEvent> | ReturnType<typeof serializePlacedOrder>;
    type DayBucket = {
      ordered: OrderedEntry[];
      rigRow: (typeof rigRows)[number] | null;
      treatments: (typeof treatmentRows)[number][];
    };

    const dayMap = new Map<string, DayBucket>();

    const getDay = (date: string) => {
      if (!dayMap.has(date)) {
        dayMap.set(date, { ordered: [], rigRow: null, treatments: [] });
      }
      return dayMap.get(date)!;
    };

    for (const r of restockRows) {
      getDay(r.event.receivedAt.toISOString().slice(0, 10)).ordered.push(
        serializeRestockEvent(r.event, r.product.name),
      );
    }
    for (const r of unreceivedPlacedOrders) {
      getDay(r.order.placedAt.toISOString().slice(0, 10)).ordered.push(
        serializePlacedOrder(r.order, r.product.name),
      );
    }
    for (const r of rigRows) {
      getDay(r.rigDate as string).rigRow = r;
    }
    for (const r of treatmentRows) {
      getDay(r.log.appliedAt.toISOString().slice(0, 10)).treatments.push(r);
    }

    // Build enriched days sorted newest-first.
    const days = Array.from(dayMap.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, bucket]) => {
        const assignments = (bucket.rigRow?.assignments ?? []) as Array<{
          productId: number;
          targetPest: string;
          notes?: string;
        }>;

        return {
          date,
          ordered: bucket.ordered,
          carried: assignments.map((a) => ({
            productId: a.productId,
            productName: productNameMap.get(a.productId) ?? `Product #${a.productId}`,
            targetPest: a.targetPest,
            notes: a.notes,
          })),
          applied: bucket.treatments.map((r) => ({
            inspectionId: r.log.inspectionId,
            siteAddress: inspectionAddressMap.get(r.log.inspectionId) ?? "",
            productId: r.log.productId,
            productName: r.product.name,
            targetPest: r.log.targetPest,
            siteClassification: r.log.siteClassification,
            totalProductOz: r.log.totalProductOz,
            areaSqft: r.log.areaSqft,
            appliedAt: r.log.appliedAt.toISOString(),
          })),
        };
      });

    return res.json({
      technicianId: userId,
      technicianName: null,
      days,
    });
  } catch (err) {
    logger.error({ err }, "[inventory] GET /manager/tech-activity error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /company/supplier/import-csv ───────────────────────────────────────
//
// Accepts a batch of pre-parsed order rows (the mobile client parses the CSV)
// and creates restock events + inventory adjustments for each matched row.
//
// Idempotency: rows with a (companyId, technicianId, productId, supplierOrderRef)
// that already exists in techRestockEventsTable are silently skipped.
//
// Tenant isolation: companyId comes from the auth token — a user can never
// import into another company's inventory.

const importRowSchema = z.object({
  technicianId: z.string().min(1).max(200),
  productId: z.number().int().positive().optional(),
  productEpa: z.string().max(50).optional(),
  productName: z.string().max(200).optional(),
  quantity: z.number().positive(),
  unit: z.string().min(1).max(20).default("unit"),
  orderRef: z.string().min(1).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const importCsvSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(500),
  supplierName: z.enum(["veseris", "target_specialty", "univar", "other"]).optional(),
  displayName: z.string().max(100).optional(),
});

router.post("/company/supplier/import-csv", requireRole("owner"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);

    const parsed = importCsvSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", detail: parsed.error.issues });
    }

    // Pre-load all active products for this import so we can match by EPA or name
    // without N+1 queries.
    const allProducts = await db
      .select({
        id: productsTable.id,
        name: productsTable.name,
        epaRegistrationNumber: productsTable.epaRegistrationNumber,
      })
      .from(productsTable)
      .where(eq(productsTable.isActive, true));

    const productByEpa = new Map(
      allProducts
        .filter((p) => p.epaRegistrationNumber)
        .map((p) => [p.epaRegistrationNumber!.toLowerCase(), p]),
    );
    const productByName = new Map(
      allProducts.map((p) => [p.name.toLowerCase(), p]),
    );

    const resolveProduct = (row: z.infer<typeof importRowSchema>) => {
      if (row.productId) return allProducts.find((p) => p.id === row.productId) ?? null;
      if (row.productEpa) return productByEpa.get(row.productEpa.toLowerCase()) ?? null;
      if (row.productName) return productByName.get(row.productName.toLowerCase()) ?? null;
      return null;
    };

    // Verify all referenced technicians belong to this company.
    const techIdSet = new Set(parsed.data.rows.map((r) => r.technicianId));
    const companyMembers = await db
      .select({ clerkUserId: usersTable.clerkUserId })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.companyId, companyId),
          inArray(usersTable.clerkUserId, Array.from(techIdSet)),
        ),
      );
    const validTechIds = new Set(companyMembers.map((m) => m.clerkUserId));

    let imported = 0;
    let skipped = 0;
    const unmatched: Array<{ rowIndex: number; reason: string }> = [];

    for (let i = 0; i < parsed.data.rows.length; i++) {
      const row = parsed.data.rows[i]!;

      // Tenant isolation: reject rows for techs not in this company.
      if (!validTechIds.has(row.technicianId)) {
        unmatched.push({ rowIndex: i, reason: `Technician '${row.technicianId}' not found in this company` });
        continue;
      }

      const product = resolveProduct(row);
      if (!product) {
        unmatched.push({
          rowIndex: i,
          reason: row.productEpa
            ? `No product with EPA number '${row.productEpa}'`
            : `No product matching name '${row.productName ?? "(none)"}'`,
        });
        continue;
      }

      // Idempotency strategy — two-layer:
      //
      // 1. Sequential dedup: SELECT inside the transaction before inserting.
      //    This is a fast path that catches retries and manually re-submitted
      //    imports without hitting a constraint error.
      //
      // 2. Concurrent dedup (race guard): the DB-level partial unique index on
      //    (company_id, technician_id, product_id, supplier_order_ref) WHERE
      //    supplier_order_ref IS NOT NULL guarantees that if two concurrent
      //    requests both pass the SELECT check simultaneously, only one INSERT
      //    succeeds — the other throws 23505, which we catch and count as a skip.
      let eventInserted = false;
      let unitMismatchUnit: string | null = null;
      try {
        await db.transaction(async (tx) => {
          // Advisory-lock this technician's balance for this product before
          // touching anything — same identity-scoped lock used by every other
          // route that can mutate a tech_inventory row (baseline, PATCH,
          // restock-events, warehouse transfer), so a CSV import racing one
          // of those routes for the same technician+product can't read a
          // "before" state that's stale by the time it writes.
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext(${`truck:${companyId}:${row.technicianId}:${product.id}`})::bigint)`,
          );

          // Fast sequential check: if this order line already exists, skip it.
          const [existing] = await tx
            .select({ id: techRestockEventsTable.id })
            .from(techRestockEventsTable)
            .where(
              and(
                eq(techRestockEventsTable.companyId, companyId),
                eq(techRestockEventsTable.technicianId, row.technicianId),
                eq(techRestockEventsTable.productId, product.id),
                eq(techRestockEventsTable.supplierOrderRef, row.orderRef),
              ),
            )
            .limit(1);

          if (existing) return; // Already imported — leave transaction clean

          // Unit guard: mirrors the manual restock-events route. A CSV row
          // whose unit doesn't match an existing truck balance is reported as
          // unmatched rather than silently combined into the wrong unit.
          const existingInv = await tx.execute(
            sql`SELECT unit FROM tech_inventory
                WHERE company_id = ${companyId} AND technician_id = ${row.technicianId} AND product_id = ${product.id}`,
          );
          const existingUnit = (existingInv.rows[0] as { unit: string } | undefined)?.unit;
          if (existingUnit && existingUnit !== row.unit) {
            unitMismatchUnit = existingUnit;
            return;
          }

          // Insert the restock event.
          const [restockEvent] = await tx
            .insert(techRestockEventsTable)
            .values({
              companyId,
              technicianId: row.technicianId,
              productId: product.id,
              quantityReceived: row.quantity,
              unit: row.unit,
              source: "csv_import",
              supplierOrderRef: row.orderRef,
              notes: parsed.data.displayName ?? parsed.data.supplierName ?? null,
              receivedAt: row.date ? new Date(row.date + "T00:00:00Z") : new Date(),
            })
            .returning();
          if (!restockEvent) throw new Error("Failed to insert restock event");

          // Update on-hand inventory atomically within the same transaction.
          const invInserted = await tx
            .insert(techInventoryTable)
            .values({
              companyId,
              technicianId: row.technicianId,
              productId: product.id,
              quantityOnHand: row.quantity,
              unit: row.unit,
            })
            .onConflictDoNothing()
            .returning({ id: techInventoryTable.id });

          if (invInserted.length === 0) {
            await tx.execute(sql`
              UPDATE tech_inventory
                 SET quantity_on_hand = quantity_on_hand + ${row.quantity},
                     updated_at = NOW()
               WHERE company_id   = ${companyId}
                 AND technician_id = ${row.technicianId}
                 AND product_id    = ${product.id}
            `);
          }

          // ── Immutable ledger entry ────────────────────────────────────────
          // Mirrors the manual restock-events route so CSV-imported receipts
          // share the same audit trail as every other stock movement.
          await tx.insert(inventoryTransactionsTable).values({
            companyId,
            productId: product.id,
            quantity: row.quantity,
            unit: row.unit,
            movementType: "truck_receipt",
            source: "restock:csv_import",
            destination: `truck:${row.technicianId}`,
            technicianId: row.technicianId,
            actingUserId: req.user?.clerkUserId ?? row.technicianId,
            referenceId: restockEvent.id,
          });

          eventInserted = true;
        });
      } catch (err: unknown) {
        // Concurrent writer raced past the SELECT check → unique index fired.
        // Treat as a skip rather than an error.
        const pgCode = (err as { code?: string }).code;
        if (pgCode === "23505") {
          skipped++;
          continue;
        }
        throw err;
      }

      if (unitMismatchUnit) {
        unmatched.push({
          rowIndex: i,
          reason: `Existing truck balance for this product uses unit '${unitMismatchUnit}', not '${row.unit}'`,
        });
        continue;
      }

      if (eventInserted) imported++;
      else skipped++;
    }

    return res.status(imported > 0 ? 201 : 200).json({ imported, skipped, unmatched });
  } catch (err) {
    logger.error({ err }, "[inventory] POST /company/supplier/import-csv error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /company/supplier-connections ───────────────────────────────────────

router.get("/company/supplier-connections", requireRole("owner"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const rows = await db
      .select()
      .from(supplierConnectionsTable)
      .where(eq(supplierConnectionsTable.companyId, companyId))
      .orderBy(supplierConnectionsTable.supplierName);

    return res.json(
      rows.map((r) => ({
        id: r.id,
        supplierName: r.supplierName,
        displayName: r.displayName,
        accountIdentifier: r.accountIdentifier,
        status: r.status,
        statusMessage: r.statusMessage,
        lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        // Per-supplier replenishment lead-time override (Task #918) — see
        // resolveLeadTimeDays() in lib/predictive-restocking.ts for precedence.
        leadTimeDays: r.leadTimeDays,
      })),
    );
  } catch (err) {
    logger.error({ err }, "[inventory] GET /company/supplier-connections error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /company/supplier-connections ──────────────────────────────────────

const supplierConnectionSchema = z.object({
  supplierName: z.enum(["veseris", "target_specialty", "univar", "other"]),
  displayName: z.string().max(100).optional(),
  accountIdentifier: z.string().min(1).max(200),
  apiKey: z.string().min(1), // stored server-side; never returned
  /** Replenishment lead time (days) for this supplier — null clears an existing override. */
  leadTimeDays: z.number().min(0).max(365).nullable().optional(),
});

router.post("/company/supplier-connections", requireRole("owner"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);

    const parsed = supplierConnectionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", detail: parsed.error.issues });
    }

    // In production the API key would be stored in a secrets manager and a
    // reference ID returned here. For now we store a marker that credentials
    // were provided (the actual key is never persisted to the DB).
    const credentialsRef = `supplied:${Date.now()}`;

    const [row] = await db
      .insert(supplierConnectionsTable)
      .values({
        companyId,
        supplierName: parsed.data.supplierName,
        displayName: parsed.data.displayName ?? null,
        accountIdentifier: parsed.data.accountIdentifier,
        credentialsRef,
        status: "pending",
        leadTimeDays: parsed.data.leadTimeDays ?? null,
      })
      .onConflictDoUpdate({
        target: [
          supplierConnectionsTable.companyId,
          supplierConnectionsTable.supplierName,
          supplierConnectionsTable.accountIdentifier,
        ],
        set: {
          displayName: parsed.data.displayName ?? null,
          credentialsRef,
          status: "pending",
          statusMessage: null,
          leadTimeDays: parsed.data.leadTimeDays ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!row) return res.status(500).json({ error: "Failed to save connection" });

    return res.status(201).json({
      id: row.id,
      supplierName: row.supplierName,
      displayName: row.displayName,
      accountIdentifier: row.accountIdentifier,
      status: row.status,
      statusMessage: row.statusMessage,
      lastSyncedAt: null,
      createdAt: row.createdAt.toISOString(),
      leadTimeDays: row.leadTimeDays,
    });
  } catch (err) {
    logger.error({ err }, "[inventory] POST /company/supplier-connections error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── DELETE /company/supplier-connections/:id ─────────────────────────────────

router.delete("/company/supplier-connections/:id", requireRole("owner"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(String(req.params.id ?? ""));
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    const [deleted] = await db
      .delete(supplierConnectionsTable)
      .where(
        and(
          eq(supplierConnectionsTable.id, id),
          eq(supplierConnectionsTable.companyId, companyId),
        ),
      )
      .returning({ id: supplierConnectionsTable.id });

    if (!deleted) return res.status(404).json({ error: "Connection not found" });

    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "[inventory] DELETE /company/supplier-connections error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Warehouse tier, transaction ledger & replenishment targets
// ═══════════════════════════════════════════════════════════════════════════
//
// Manager/owner routes only. The Warehouse is a company-level stock pool,
// separate from any technician's truck (tech_inventory). Stock moves
// warehouse → truck via the transfer endpoint below; every movement anywhere
// in the system (warehouse receipt, warehouse→truck transfer, truck→property
// deduction, truck receipt) is also recorded as an inventory_transactions row.

function serializeWarehouseItem(
  inv: typeof warehouseInventoryTable.$inferSelect,
  product: typeof productsTable.$inferSelect,
) {
  return {
    productId: inv.productId,
    productName: product.name,
    epaRegistrationNumber: product.epaRegistrationNumber,
    quantityOnHand: inv.quantityOnHand,
    unit: inv.unit,
    updatedAt: inv.updatedAt.toISOString(),
  };
}

// ─── GET /manager/warehouse ───────────────────────────────────────────────────
// All product balances currently held in the company warehouse.

router.get("/manager/warehouse", requireRole("manager"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const rows = await db
      .select({ inv: warehouseInventoryTable, product: productsTable })
      .from(warehouseInventoryTable)
      .innerJoin(productsTable, eq(productsTable.id, warehouseInventoryTable.productId))
      .where(eq(warehouseInventoryTable.companyId, companyId))
      .orderBy(productsTable.name);

    return res.json(rows.map((r) => serializeWarehouseItem(r.inv, r.product)));
  } catch (err) {
    logger.error({ err }, "[inventory] GET /manager/warehouse error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /manager/warehouse/receive ─────────────────────────────────────────
// Receive stock into the warehouse from a supplier. Upserts the warehouse
// balance and writes a ledger row.

const warehouseReceiveSchema = z.object({
  productId: z.number().int().positive(),
  quantity: z.number().positive(),
  unit: z.string().min(1).max(20).default("unit"),
  notes: z.string().max(500).optional(),
});

router.post("/manager/warehouse/receive", requireRole("manager"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const actingUserId = req.user?.clerkUserId;
    if (!actingUserId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = warehouseReceiveSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", detail: parsed.error.issues });
    }

    const [product] = await db
      .select()
      .from(productsTable)
      .where(and(eq(productsTable.id, parsed.data.productId), eq(productsTable.isActive, true)));
    if (!product) return res.status(404).json({ error: "Product not found" });

    const qty = parsed.data.quantity;
    const unit = parsed.data.unit;

    try {
      const result = await db.transaction(async (tx) => {
        // Take a transaction-scoped advisory lock keyed to this warehouse
        // balance before touching anything. A plain `SELECT ... FOR UPDATE`
        // only locks a row that already exists, so two concurrent *first*
        // receipts for the same product (or a receipt racing a transfer's
        // decrement) could both pass the unit check below and then both
        // apply their update in whatever unit they individually validated
        // against. The advisory lock serializes every writer to this
        // (companyId, productId) warehouse balance — including the
        // "no row yet" case — for the lifetime of the transaction.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`warehouse:${companyId}:${parsed.data.productId}`})::bigint)`,
        );

        const existingResult = await tx.execute(
          sql`SELECT unit FROM warehouse_inventory
              WHERE company_id = ${companyId} AND product_id = ${parsed.data.productId}`,
        );
        const existingUnit = (existingResult.rows[0] as { unit: string } | undefined)?.unit;
        if (existingUnit && existingUnit !== unit) {
          const err = new Error("UNIT_MISMATCH");
          (err as { code?: string }).code = "UNIT_MISMATCH";
          (err as { existingUnit?: string }).existingUnit = existingUnit;
          throw err;
        }

        const inserted = await tx
          .insert(warehouseInventoryTable)
          .values({
            companyId,
            productId: parsed.data.productId,
            quantityOnHand: qty,
            unit,
          })
          .onConflictDoUpdate({
            target: [warehouseInventoryTable.companyId, warehouseInventoryTable.productId],
            set: {
              quantityOnHand: sql`${warehouseInventoryTable.quantityOnHand} + ${qty}`,
              updatedAt: new Date(),
            },
          })
          .returning();

        const row = inserted[0];
        if (!row) throw new Error("Failed to upsert warehouse inventory");

        const [txn] = await tx
          .insert(inventoryTransactionsTable)
          .values({
            companyId,
            productId: parsed.data.productId,
            quantity: qty,
            unit,
            movementType: "warehouse_receipt",
            source: "supplier",
            destination: "warehouse",
            technicianId: null,
            actingUserId,
            notes: parsed.data.notes ?? null,
          })
          .returning();

        return { row, txn };
      });

      return res.status(201).json({
        warehouse: serializeWarehouseItem(result.row, product),
        transactionId: result.txn?.id ?? null,
      });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "UNIT_MISMATCH") {
        return res.status(409).json({
          error: "Unit mismatch: the warehouse already holds this product in a different unit",
          detail: { existingUnit: (err as { existingUnit?: string }).existingUnit, requestedUnit: unit },
        });
      }
      throw err;
    }
  } catch (err) {
    logger.error({ err }, "[inventory] POST /manager/warehouse/receive error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── POST /manager/warehouse/transfer ────────────────────────────────────────
// Atomically move stock from the warehouse into a technician's truck. Rejects
// (409) if it would leave the warehouse balance negative.

const warehouseTransferSchema = z.object({
  technicianId: z.string().min(1).max(200),
  productId: z.number().int().positive(),
  quantity: z.number().positive(),
  notes: z.string().max(500).optional(),
});

router.post("/manager/warehouse/transfer", requireRole("manager"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const actingUserId = req.user?.clerkUserId;
    if (!actingUserId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = warehouseTransferSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", detail: parsed.error.issues });
    }
    const { technicianId, productId, quantity } = parsed.data;

    // Verify the technician belongs to this company.
    const [member] = await db
      .select({ clerkUserId: usersTable.clerkUserId })
      .from(usersTable)
      .where(and(eq(usersTable.companyId, companyId), eq(usersTable.clerkUserId, technicianId)));
    if (!member) return res.status(404).json({ error: "Technician not found in this company" });

    const [product] = await db
      .select()
      .from(productsTable)
      .where(and(eq(productsTable.id, productId), eq(productsTable.isActive, true)));
    if (!product) return res.status(404).json({ error: "Product not found" });

    try {
      const result = await db.transaction(async (tx) => {
        // Advisory-lock both balances involved, in a fixed order (warehouse
        // then truck), before reading either one. A `SELECT ... FOR UPDATE`
        // alone can't protect a row that doesn't exist yet, so without this,
        // a transfer racing another writer to a not-yet-created technician
        // balance (or a receive racing this same warehouse balance) could
        // both pass their checks and then corrupt quantity/unit on write.
        // Every other route touching these two balance kinds takes the same
        // lock keys, and always in this order, so no deadlock is possible.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`warehouse:${companyId}:${productId}`})::bigint)`,
        );
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`truck:${companyId}:${technicianId}:${productId}`})::bigint)`,
        );

        const warehouseResult = await tx.execute(
          sql`SELECT id, quantity_on_hand, unit FROM warehouse_inventory
              WHERE company_id = ${companyId} AND product_id = ${productId}`,
        );
        const warehouseRow = warehouseResult.rows[0] as
          | { id: number; quantity_on_hand: number; unit: string }
          | undefined;

        if (!warehouseRow || warehouseRow.quantity_on_hand < quantity) {
          const err = new Error("INSUFFICIENT_WAREHOUSE_STOCK");
          (err as { code?: string }).code = "INSUFFICIENT_WAREHOUSE_STOCK";
          throw err;
        }

        const unit = warehouseRow.unit;

        // Refuse to combine incompatible units — e.g. a warehouse balance in
        // "gal" must never be added onto a truck balance tracked in "fl oz".
        const techRowResult = await tx.execute(
          sql`SELECT unit FROM tech_inventory
              WHERE company_id = ${companyId} AND technician_id = ${technicianId} AND product_id = ${productId}`,
        );
        const existingTechUnit = (techRowResult.rows[0] as { unit: string } | undefined)?.unit;
        if (existingTechUnit && existingTechUnit !== unit) {
          const err = new Error("UNIT_MISMATCH");
          (err as { code?: string }).code = "UNIT_MISMATCH";
          (err as { existingUnit?: string }).existingUnit = existingTechUnit;
          throw err;
        }

        await tx.execute(
          sql`UPDATE warehouse_inventory
              SET quantity_on_hand = quantity_on_hand - ${quantity}::real, updated_at = NOW()
              WHERE id = ${warehouseRow.id}`,
        );

        const inserted = await tx
          .insert(techInventoryTable)
          .values({
            companyId,
            technicianId,
            productId,
            quantityOnHand: quantity,
            unit,
          })
          .onConflictDoNothing()
          .returning({ id: techInventoryTable.id });

        if (inserted.length === 0) {
          await tx.execute(
            sql`UPDATE tech_inventory
                SET quantity_on_hand = quantity_on_hand + ${quantity}::real, updated_at = NOW()
                WHERE company_id = ${companyId} AND technician_id = ${technicianId} AND product_id = ${productId}`,
          );
        }

        const [txn] = await tx
          .insert(inventoryTransactionsTable)
          .values({
            companyId,
            productId,
            quantity,
            unit,
            movementType: "warehouse_to_truck_transfer",
            source: "warehouse",
            destination: `truck:${technicianId}`,
            technicianId,
            actingUserId,
            notes: parsed.data.notes ?? null,
          })
          .returning();

        const [newWarehouseBalance] = await tx
          .select({ quantityOnHand: warehouseInventoryTable.quantityOnHand })
          .from(warehouseInventoryTable)
          .where(eq(warehouseInventoryTable.id, warehouseRow.id));

        return { txn, unit, warehouseQuantityOnHand: newWarehouseBalance?.quantityOnHand ?? 0 };
      });

      return res.status(201).json({
        transactionId: result.txn?.id ?? null,
        warehouseQuantityOnHand: result.warehouseQuantityOnHand,
      });
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "INSUFFICIENT_WAREHOUSE_STOCK") {
        return res.status(409).json({ error: "Insufficient warehouse stock for this transfer" });
      }
      if ((err as { code?: string }).code === "UNIT_MISMATCH") {
        return res.status(409).json({
          error: "Unit mismatch: this technician's truck already holds this product in a different unit",
          detail: { existingUnit: (err as { existingUnit?: string }).existingUnit },
        });
      }
      throw err;
    }
  } catch (err) {
    logger.error({ err }, "[inventory] POST /manager/warehouse/transfer error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── GET /manager/inventory-transactions ─────────────────────────────────────
// Audit history, optionally filtered by technician and/or product.

router.get("/manager/inventory-transactions", requireRole("manager"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const technicianId = typeof req.query.technicianId === "string" ? req.query.technicianId : undefined;
    const productId =
      typeof req.query.productId === "string" && /^\d+$/.test(req.query.productId)
        ? parseInt(req.query.productId, 10)
        : undefined;
    const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;

    const conditions = [eq(inventoryTransactionsTable.companyId, companyId)];
    if (technicianId) conditions.push(eq(inventoryTransactionsTable.technicianId, technicianId));
    if (productId !== undefined) conditions.push(eq(inventoryTransactionsTable.productId, productId));

    const rows = await db
      .select({ txn: inventoryTransactionsTable, product: productsTable })
      .from(inventoryTransactionsTable)
      .innerJoin(productsTable, eq(productsTable.id, inventoryTransactionsTable.productId))
      .where(and(...conditions))
      .orderBy(desc(inventoryTransactionsTable.createdAt))
      .limit(limit);

    return res.json(
      rows.map((r) => ({
        id: r.txn.id,
        productId: r.txn.productId,
        productName: r.product.name,
        quantity: r.txn.quantity,
        unit: r.txn.unit,
        movementType: r.txn.movementType,
        source: r.txn.source,
        destination: r.txn.destination,
        technicianId: r.txn.technicianId,
        actingUserId: r.txn.actingUserId,
        referenceId: r.txn.referenceId,
        notes: r.txn.notes,
        createdAt: r.txn.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    logger.error({ err }, "[inventory] GET /manager/inventory-transactions error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Replenishment targets ────────────────────────────────────────────────────
//
// Configurable target days-of-supply, scoped company-wide (technicianId="",
// productId=0), per-technician (productId=0), per-product (technicianId=""),
// or per-technician-per-product combined (both non-sentinel — the most
// specific override a manager can set, e.g. "this tech carries an extra day
// of THIS product specifically"). distanceAdjustmentFactor is only
// meaningful on technician-scoped rows (company/product/combined rows always
// carry null for it). Consumed by inventory-forecasting.ts's
// resolveReplenishmentTarget() for Truck Stock Health and by
// predictive-restocking.ts as the safety-stock window in the reorder-point
// calculation.
//
// leadTimeDays (Task #918) reuses this same scoping for the OTHER half of
// the reorder-point math (supplier delivery delay, not safety-stock buffer)
// but is only ever set on technicianId="" rows — company default
// (productId=0) or per-product override (productId=X) — since lead time is
// a supply-chain property, not a per-technician one. See
// resolveLeadTimeDays() in lib/predictive-restocking.ts.

function serializeReplenishmentTarget(row: typeof replenishmentTargetsTable.$inferSelect) {
  return {
    id: row.id,
    technicianId: row.technicianId || null,
    productId: row.productId || null,
    daysOfSupply: row.daysOfSupply,
    distanceAdjustmentFactor: row.distanceAdjustmentFactor,
    leadTimeDays: row.leadTimeDays,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// GET /manager/replenishment-targets — company default + all overrides.
router.get("/manager/replenishment-targets", requireRole("manager"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const rows = await db
      .select()
      .from(replenishmentTargetsTable)
      .where(eq(replenishmentTargetsTable.companyId, companyId));

    const companyDefault = rows.find((r) => r.technicianId === "" && r.productId === 0) ?? null;
    const technicianOverrides = rows.filter((r) => r.technicianId !== "" && r.productId === 0);
    const productOverrides = rows.filter((r) => r.technicianId === "" && r.productId !== 0);
    const combinedOverrides = rows.filter((r) => r.technicianId !== "" && r.productId !== 0);

    const productIds = [...productOverrides, ...combinedOverrides].map((r) => r.productId);
    const productRows =
      productIds.length > 0
        ? await db
            .select({ id: productsTable.id, name: productsTable.name })
            .from(productsTable)
            .where(inArray(productsTable.id, productIds))
        : [];
    const productNameMap = new Map(productRows.map((p) => [p.id, p.name]));

    return res.json({
      companyDefault: companyDefault
        ? {
            daysOfSupply: companyDefault.daysOfSupply,
            leadTimeDays: companyDefault.leadTimeDays,
            updatedAt: companyDefault.updatedAt.toISOString(),
          }
        : { daysOfSupply: null, leadTimeDays: null, updatedAt: null },
      technicianOverrides: technicianOverrides.map(serializeReplenishmentTarget),
      productOverrides: productOverrides.map((r) => ({
        ...serializeReplenishmentTarget(r),
        productName: productNameMap.get(r.productId) ?? `Product #${r.productId}`,
      })),
      combinedOverrides: combinedOverrides.map((r) => ({
        ...serializeReplenishmentTarget(r),
        productName: productNameMap.get(r.productId) ?? `Product #${r.productId}`,
      })),
    });
  } catch (err) {
    logger.error({ err }, "[inventory] GET /manager/replenishment-targets error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /manager/replenishment-targets/company — set the company default
// days-of-supply and/or replenishment lead time.
const companyTargetSchema = z.object({
  daysOfSupply: z.number().positive().nullable().optional(),
  leadTimeDays: z.number().min(0).max(365).nullable().optional(),
});

router.put("/manager/replenishment-targets/company", requireRole("manager"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const parsed = companyTargetSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", detail: parsed.error.issues });
    }

    // Merge with any existing row so a PUT that only sets one field (e.g.
    // just leadTimeDays) doesn't clobber the other.
    const [existing] = await db
      .select()
      .from(replenishmentTargetsTable)
      .where(
        and(
          eq(replenishmentTargetsTable.companyId, companyId),
          eq(replenishmentTargetsTable.technicianId, ""),
          eq(replenishmentTargetsTable.productId, 0),
        ),
      );

    const daysOfSupply =
      parsed.data.daysOfSupply !== undefined ? parsed.data.daysOfSupply : existing?.daysOfSupply ?? null;
    const leadTimeDays =
      parsed.data.leadTimeDays !== undefined ? parsed.data.leadTimeDays : existing?.leadTimeDays ?? null;

    const [row] = await db
      .insert(replenishmentTargetsTable)
      .values({
        companyId,
        technicianId: "",
        productId: 0,
        daysOfSupply,
        leadTimeDays,
      })
      .onConflictDoUpdate({
        target: [
          replenishmentTargetsTable.companyId,
          replenishmentTargetsTable.technicianId,
          replenishmentTargetsTable.productId,
        ],
        set: { daysOfSupply, leadTimeDays, updatedAt: new Date() },
      })
      .returning();

    if (!row) return res.status(500).json({ error: "Failed to save company target" });
    return res.json(serializeReplenishmentTarget(row));
  } catch (err) {
    logger.error({ err }, "[inventory] PUT /manager/replenishment-targets/company error");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /manager/replenishment-targets/technician/:technicianId — upsert a
// per-technician days-of-supply override and/or distance-adjustment factor.
const technicianTargetSchema = z.object({
  daysOfSupply: z.number().positive().nullable().optional(),
  distanceAdjustmentFactor: z.number().positive().nullable().optional(),
});

router.put(
  "/manager/replenishment-targets/technician/:technicianId",
  requireRole("manager"),
  async (req, res) => {
    try {
      const companyId = getCompanyId(req);
      const technicianId = String(req.params.technicianId ?? "");
      if (!technicianId) return res.status(400).json({ error: "Missing technicianId" });

      const parsed = technicianTargetSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid body", detail: parsed.error.issues });
      }

      const [member] = await db
        .select({ clerkUserId: usersTable.clerkUserId })
        .from(usersTable)
        .where(and(eq(usersTable.companyId, companyId), eq(usersTable.clerkUserId, technicianId)));
      if (!member) return res.status(404).json({ error: "Technician not found in this company" });

      // Merge with any existing row so a PUT that only sets one field doesn't
      // clobber the other.
      const [existing] = await db
        .select()
        .from(replenishmentTargetsTable)
        .where(
          and(
            eq(replenishmentTargetsTable.companyId, companyId),
            eq(replenishmentTargetsTable.technicianId, technicianId),
            eq(replenishmentTargetsTable.productId, 0),
          ),
        );

      const daysOfSupply =
        parsed.data.daysOfSupply !== undefined ? parsed.data.daysOfSupply : existing?.daysOfSupply ?? null;
      const distanceAdjustmentFactor =
        parsed.data.distanceAdjustmentFactor !== undefined
          ? parsed.data.distanceAdjustmentFactor
          : existing?.distanceAdjustmentFactor ?? null;

      const [row] = await db
        .insert(replenishmentTargetsTable)
        .values({ companyId, technicianId, productId: 0, daysOfSupply, distanceAdjustmentFactor })
        .onConflictDoUpdate({
          target: [
            replenishmentTargetsTable.companyId,
            replenishmentTargetsTable.technicianId,
            replenishmentTargetsTable.productId,
          ],
          set: { daysOfSupply, distanceAdjustmentFactor, updatedAt: new Date() },
        })
        .returning();

      if (!row) return res.status(500).json({ error: "Failed to save technician target" });
      return res.json(serializeReplenishmentTarget(row));
    } catch (err) {
      logger.error({ err }, "[inventory] PUT /manager/replenishment-targets/technician error");
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// DELETE /manager/replenishment-targets/technician/:technicianId — clear the override.
router.delete(
  "/manager/replenishment-targets/technician/:technicianId",
  requireRole("manager"),
  async (req, res) => {
    try {
      const companyId = getCompanyId(req);
      const technicianId = String(req.params.technicianId ?? "");
      await db
        .delete(replenishmentTargetsTable)
        .where(
          and(
            eq(replenishmentTargetsTable.companyId, companyId),
            eq(replenishmentTargetsTable.technicianId, technicianId),
            eq(replenishmentTargetsTable.productId, 0),
          ),
        );
      return res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "[inventory] DELETE /manager/replenishment-targets/technician error");
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// PUT /manager/replenishment-targets/product/:productId — upsert a per-product
// override for days-of-supply and/or replenishment lead time.
const productTargetSchema = z.object({
  daysOfSupply: z.number().positive().nullable().optional(),
  leadTimeDays: z.number().min(0).max(365).nullable().optional(),
});

router.put(
  "/manager/replenishment-targets/product/:productId",
  requireRole("manager"),
  async (req, res) => {
    try {
      const companyId = getCompanyId(req);
      const productId = parseInt(String(req.params.productId ?? ""), 10);
      if (Number.isNaN(productId) || productId <= 0) {
        return res.status(400).json({ error: "Invalid productId" });
      }

      const parsed = productTargetSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid body", detail: parsed.error.issues });
      }

      const [product] = await db
        .select({ id: productsTable.id })
        .from(productsTable)
        .where(eq(productsTable.id, productId));
      if (!product) return res.status(404).json({ error: "Product not found" });

      // Merge with any existing row so a PUT that only sets one field doesn't
      // clobber the other.
      const [existing] = await db
        .select()
        .from(replenishmentTargetsTable)
        .where(
          and(
            eq(replenishmentTargetsTable.companyId, companyId),
            eq(replenishmentTargetsTable.technicianId, ""),
            eq(replenishmentTargetsTable.productId, productId),
          ),
        );

      const daysOfSupply =
        parsed.data.daysOfSupply !== undefined ? parsed.data.daysOfSupply : existing?.daysOfSupply ?? null;
      const leadTimeDays =
        parsed.data.leadTimeDays !== undefined ? parsed.data.leadTimeDays : existing?.leadTimeDays ?? null;

      const [row] = await db
        .insert(replenishmentTargetsTable)
        .values({ companyId, technicianId: "", productId, daysOfSupply, leadTimeDays })
        .onConflictDoUpdate({
          target: [
            replenishmentTargetsTable.companyId,
            replenishmentTargetsTable.technicianId,
            replenishmentTargetsTable.productId,
          ],
          set: { daysOfSupply, leadTimeDays, updatedAt: new Date() },
        })
        .returning();

      if (!row) return res.status(500).json({ error: "Failed to save product target" });
      return res.json(serializeReplenishmentTarget(row));
    } catch (err) {
      logger.error({ err }, "[inventory] PUT /manager/replenishment-targets/product error");
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// DELETE /manager/replenishment-targets/product/:productId — clear the override.
router.delete(
  "/manager/replenishment-targets/product/:productId",
  requireRole("manager"),
  async (req, res) => {
    try {
      const companyId = getCompanyId(req);
      const productId = parseInt(String(req.params.productId ?? ""), 10);
      if (Number.isNaN(productId)) return res.status(400).json({ error: "Invalid productId" });

      await db
        .delete(replenishmentTargetsTable)
        .where(
          and(
            eq(replenishmentTargetsTable.companyId, companyId),
            eq(replenishmentTargetsTable.technicianId, ""),
            eq(replenishmentTargetsTable.productId, productId),
          ),
        );
      return res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "[inventory] DELETE /manager/replenishment-targets/product error");
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// PUT /manager/replenishment-targets/technician/:technicianId/product/:productId —
// upsert the most specific override: this technician's days-of-supply for
// this one product specifically.
const combinedTargetSchema = z.object({ daysOfSupply: z.number().positive().nullable() });

router.put(
  "/manager/replenishment-targets/technician/:technicianId/product/:productId",
  requireRole("manager"),
  async (req, res) => {
    try {
      const companyId = getCompanyId(req);
      const technicianId = String(req.params.technicianId ?? "");
      const productId = parseInt(String(req.params.productId ?? ""), 10);
      if (!technicianId) return res.status(400).json({ error: "Missing technicianId" });
      if (Number.isNaN(productId) || productId <= 0) {
        return res.status(400).json({ error: "Invalid productId" });
      }

      const parsed = combinedTargetSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid body", detail: parsed.error.issues });
      }

      const [member] = await db
        .select({ clerkUserId: usersTable.clerkUserId })
        .from(usersTable)
        .where(and(eq(usersTable.companyId, companyId), eq(usersTable.clerkUserId, technicianId)));
      if (!member) return res.status(404).json({ error: "Technician not found in this company" });

      const [product] = await db
        .select({ id: productsTable.id })
        .from(productsTable)
        .where(eq(productsTable.id, productId));
      if (!product) return res.status(404).json({ error: "Product not found" });

      const [row] = await db
        .insert(replenishmentTargetsTable)
        .values({ companyId, technicianId, productId, daysOfSupply: parsed.data.daysOfSupply })
        .onConflictDoUpdate({
          target: [
            replenishmentTargetsTable.companyId,
            replenishmentTargetsTable.technicianId,
            replenishmentTargetsTable.productId,
          ],
          set: { daysOfSupply: parsed.data.daysOfSupply, updatedAt: new Date() },
        })
        .returning();

      if (!row) return res.status(500).json({ error: "Failed to save combined target" });
      return res.json(serializeReplenishmentTarget(row));
    } catch (err) {
      logger.error({ err }, "[inventory] PUT /manager/replenishment-targets/technician/.../product/... error");
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

// DELETE /manager/replenishment-targets/technician/:technicianId/product/:productId — clear the combined override.
router.delete(
  "/manager/replenishment-targets/technician/:technicianId/product/:productId",
  requireRole("manager"),
  async (req, res) => {
    try {
      const companyId = getCompanyId(req);
      const technicianId = String(req.params.technicianId ?? "");
      const productId = parseInt(String(req.params.productId ?? ""), 10);
      if (Number.isNaN(productId)) return res.status(400).json({ error: "Invalid productId" });

      await db
        .delete(replenishmentTargetsTable)
        .where(
          and(
            eq(replenishmentTargetsTable.companyId, companyId),
            eq(replenishmentTargetsTable.technicianId, technicianId),
            eq(replenishmentTargetsTable.productId, productId),
          ),
        );
      return res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "[inventory] DELETE /manager/replenishment-targets/technician/.../product/... error");
      return res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
