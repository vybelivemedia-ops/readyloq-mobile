/**
 * Daily rig routes — ReadyLoq
 *
 * POST /technician/daily-rig   — upsert today's rig (product IDs loaded on truck)
 * GET  /technician/daily-rig   — fetch today's rig with full product + label-rules data
 * GET  /technician/recent-mixes — last-30-day treatment logs, deduplicated by
 *                                 (productId, siteClassification), newest first, max 5
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  technicianDailyRigsTable,
  productsTable,
  productLabelRulesTable,
  treatmentLogsTable,
} from "@workspace/db";
import { and, eq, gte, desc, inArray } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import { z } from "zod/v4";

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns today's date as "YYYY-MM-DD" in UTC (server clock). */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Join products + label_rules for a list of product IDs. */
async function loadProducts(productIds: number[]) {
  if (productIds.length === 0) return [];
  const rows = await db
    .select({ product: productsTable, labelRules: productLabelRulesTable })
    .from(productsTable)
    .leftJoin(productLabelRulesTable, eq(productLabelRulesTable.productId, productsTable.id))
    .where(inArray(productsTable.id, productIds));
  // Re-order to preserve the technician's chosen ordering.
  const map = new Map(rows.map((r) => [r.product.id, r]));
  return productIds
    .map((id) => {
      const r = map.get(id);
      if (!r) return null;
      return { ...r.product, labelRules: r.labelRules ?? null };
    })
    .filter(Boolean);
}

// ─── POST /technician/daily-rig ───────────────────────────────────────────────

const upsertRigSchema = z.object({
  productIds: z.array(z.number().int().positive()),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

router.post("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const technicianId = req.user?.clerkUserId;
    if (!technicianId) return res.status(401).json({ error: "Unauthorized" });

    const parse = upsertRigSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: "Invalid body", detail: parse.error.issues });
    }

    const rigDate = parse.data.date ?? todayUtc();
    const productIds = parse.data.productIds;

    // Upsert: replace today's row when one already exists.
    const [row] = await db
      .insert(technicianDailyRigsTable)
      .values({ companyId, technicianId, rigDate, productIds })
      .onConflictDoUpdate({
        target: [
          technicianDailyRigsTable.companyId,
          technicianDailyRigsTable.technicianId,
          technicianDailyRigsTable.rigDate,
        ],
        set: { productIds, updatedAt: new Date() },
      })
      .returning();

    if (!row) return res.status(500).json({ error: "Failed to save rig" });

    const products = await loadProducts(productIds);
    return res.status(201).json({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      products,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to save rig" });
  }
});

// ─── GET /technician/daily-rig ────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const technicianId = req.user?.clerkUserId;
    if (!technicianId) return res.status(401).json({ error: "Unauthorized" });

    const date =
      typeof req.query.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
        ? req.query.date
        : todayUtc();

    const [row] = await db
      .select()
      .from(technicianDailyRigsTable)
      .where(
        and(
          eq(technicianDailyRigsTable.companyId, companyId),
          eq(technicianDailyRigsTable.technicianId, technicianId),
          eq(technicianDailyRigsTable.rigDate, date),
        ),
      )
      .limit(1);

    if (!row) {
      return res.status(404).json({ error: "No rig set up for this date" });
    }

    const products = await loadProducts(row.productIds ?? []);
    return res.json({
      ...row,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      products,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch rig" });
  }
});

// ─── GET /technician/recent-mixes ─────────────────────────────────────────────

router.get("/recent-mixes", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const technicianId = req.user?.clerkUserId;
    if (!technicianId) return res.status(401).json({ error: "Unauthorized" });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Fetch all treatment logs for this technician in the last 30 days,
    // joined with their product names for the quick-pick display.
    const rows = await db
      .select({
        log: treatmentLogsTable,
        product: productsTable,
      })
      .from(treatmentLogsTable)
      .leftJoin(productsTable, eq(productsTable.id, treatmentLogsTable.productId))
      .where(
        and(
          eq(treatmentLogsTable.companyId, companyId),
          eq(treatmentLogsTable.technicianId, technicianId),
          gte(treatmentLogsTable.appliedAt, thirtyDaysAgo),
        ),
      )
      .orderBy(desc(treatmentLogsTable.appliedAt));

    // Deduplicate by (productId, siteClassification), keeping the most recent
    // for each combination.  Return up to 5 results.
    const seen = new Set<string>();
    const deduped: typeof rows = [];
    for (const row of rows) {
      const key = `${row.log.productId}:${row.log.siteClassification}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(row);
      if (deduped.length >= 5) break;
    }

    return res.json(
      deduped.map(({ log, product }) => ({
        logId: log.id,
        productId: log.productId,
        productName: product?.name ?? `Product #${log.productId}`,
        productActiveIngredients: product?.activeIngredients ?? "",
        targetPest: log.targetPest,
        siteClassification: log.siteClassification,
        areaSqft: log.areaSqft,
        linearFt: log.linearFt,
        totalProductOz: log.totalProductOz,
        equipmentUsed: log.equipmentUsed,
        appliedAt: log.appliedAt.toISOString(),
      })),
    );
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch recent mixes" });
  }
});

export default router;
