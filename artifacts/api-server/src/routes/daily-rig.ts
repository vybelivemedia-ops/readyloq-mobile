/**
 * Daily route routes — ReadyLoq
 *
 * POST /technician/daily-rig           — upsert today's route chemical assignments
 * GET  /technician/daily-rig           — fetch today's assignments with full product data
 * GET  /technician/daily-rig/recent-mixes — last-30-day treatment logs, deduped by
 *                                          (productId, siteClassification), newest first, max 5
 *
 * "Route assignments" are product→pest pairings the technician sets each morning.
 * e.g. [{ productId: 1, targetPest: "German Cockroaches" }, { productId: 3, targetPest: "Ants" }]
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

// ─── Shared types ─────────────────────────────────────────────────────────────

interface RouteAssignment {
  productId: number;
  targetPest: string;
  notes?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns today's date as "YYYY-MM-DD" in UTC (server clock). */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Load products + label rules for a list of assignments, returning each
 * assignment enriched with its full product data.
 */
async function enrichAssignments(assignments: RouteAssignment[]) {
  if (assignments.length === 0) return [];
  const productIds = [...new Set(assignments.map((a) => a.productId))];
  const rows = await db
    .select({ product: productsTable, labelRules: productLabelRulesTable })
    .from(productsTable)
    .leftJoin(productLabelRulesTable, eq(productLabelRulesTable.productId, productsTable.id))
    .where(inArray(productsTable.id, productIds));

  const productMap = new Map(rows.map((r) => [r.product.id, r]));
  return assignments.map((a) => {
    const row = productMap.get(a.productId);
    return {
      ...a,
      product: row ? { ...row.product, labelRules: row.labelRules ?? null } : null,
    };
  });
}

// ─── POST /technician/daily-rig ───────────────────────────────────────────────

const routeAssignmentSchema = z.object({
  productId: z.number().int().positive(),
  targetPest: z.string().min(1),
  notes: z.string().optional(),
});

const upsertRouteSchema = z.object({
  assignments: z.array(routeAssignmentSchema),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

router.post("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const technicianId = req.user?.clerkUserId;
    if (!technicianId) return res.status(401).json({ error: "Unauthorized" });

    const parse = upsertRouteSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: "Invalid body", detail: parse.error.issues });
    }

    const rigDate = parse.data.date ?? todayUtc();
    const assignments = parse.data.assignments as RouteAssignment[];

    const [row] = await db
      .insert(technicianDailyRigsTable)
      .values({ companyId, technicianId, rigDate, assignments })
      .onConflictDoUpdate({
        target: [
          technicianDailyRigsTable.companyId,
          technicianDailyRigsTable.technicianId,
          technicianDailyRigsTable.rigDate,
        ],
        set: { assignments, updatedAt: new Date() },
      })
      .returning();

    if (!row) return res.status(500).json({ error: "Failed to save route" });

    const enriched = await enrichAssignments(assignments);
    return res.status(201).json({
      id: row.id,
      technicianId: row.technicianId,
      rigDate: row.rigDate,
      assignments: enriched,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch {
    return res.status(500).json({ error: "Failed to save route" });
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
      return res.status(404).json({ error: "No route set up for this date" });
    }

    // `assignments` is the new column; fall back to legacy `productIds` if empty.
    const rawAssignments: RouteAssignment[] =
      Array.isArray(row.assignments) && row.assignments.length > 0
        ? (row.assignments as RouteAssignment[])
        : (row.productIds ?? []).map((id: number) => ({ productId: id, targetPest: "" }));

    const enriched = await enrichAssignments(rawAssignments);
    return res.json({
      id: row.id,
      technicianId: row.technicianId,
      rigDate: row.rigDate,
      assignments: enriched,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  } catch {
    return res.status(500).json({ error: "Failed to fetch route" });
  }
});

// ─── GET /technician/daily-rig/recent-mixes ──────────────────────────────────

router.get("/recent-mixes", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const technicianId = req.user?.clerkUserId;
    if (!technicianId) return res.status(401).json({ error: "Unauthorized" });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const rows = await db
      .select({ log: treatmentLogsTable, product: productsTable })
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

    // Deduplicate by (productId, siteClassification), keep most recent, max 5.
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
  } catch {
    return res.status(500).json({ error: "Failed to fetch recent mixes" });
  }
});

export default router;
