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
  usersTable,
} from "@workspace/db";
import { and, eq, gte, desc, inArray } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import { requireRole } from "../middleware/require-auth";
import { z } from "zod/v4";
import { parseTzOffsetMinutes } from "../lib/calendar-tz";
import { computeRouteReadiness } from "../lib/route-readiness";

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

// ─── GET /technician/daily-rig/lookup?technicianId=&date= ────────────────────
//
// Read-only Route Readiness check for ANY technician/date pair, used by the
// Integrated Route Calendar module so a manager (or a technician looking at a
// future date) can see whether a stop's daily rig has been set up without
// being able to edit it here. Self-lookups are always allowed; looking up
// another technician requires manager/owner.

router.get("/lookup", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const requester = req.user?.clerkUserId;
    if (!requester) return res.status(401).json({ error: "Unauthorized" });

    const technicianId = typeof req.query.technicianId === "string" ? req.query.technicianId : null;
    const date =
      typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
        ? req.query.date
        : null;
    if (!technicianId || !date) {
      return res.status(400).json({ error: "technicianId and date (YYYY-MM-DD) query params are required" });
    }

    if (technicianId !== requester) {
      const actingRole = (req.user!.roleOverride ?? req.user!.role) as string;
      // sales reps read other technicians' readiness through the Route
      // Calendar module too (they have no stops of their own) — treat them
      // the same as manager/owner here.
      const isManager = actingRole === "manager" || actingRole === "owner" || actingRole === "sales";
      if (!isManager) {
        return res.status(403).json({ error: "Access denied: manager/owner only for other technicians" });
      }
    }

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
      return res.status(404).json({ error: "No route set up for this date", setUp: false });
    }

    const rawAssignments: RouteAssignment[] =
      Array.isArray(row.assignments) && row.assignments.length > 0
        ? (row.assignments as RouteAssignment[])
        : (row.productIds ?? []).map((id: number) => ({ productId: id, targetPest: "" }));

    const enriched = await enrichAssignments(rawAssignments);
    return res.json({
      setUp: true,
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

// ─── GET /technician/daily-rig/route-readiness?date=&tzOffsetMinutes= ────────
//
// Today's Route Readiness — compares the technician's scheduled stops for the
// given calendar date against their truck's on-hand quantities for the
// products declared on that day's rig, using recent per-application usage
// history to project what today is likely to consume. This is a proactive,
// TODAY-scoped signal — distinct from Truck Stock Health (a longer-range
// trending projection, see /manager/team-stock-health and
// /technician/inventory/stock-health) and from the existing reactive
// restockThreshold alert, which is unchanged. Self-lookups are always
// allowed; looking up another technician follows the same manager/owner/
// sales rule as /lookup.

router.get("/route-readiness", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const requester = req.user?.clerkUserId;
    if (!requester) return res.status(401).json({ error: "Unauthorized" });

    const technicianId = typeof req.query.technicianId === "string" ? req.query.technicianId : requester;
    const date =
      typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
        ? req.query.date
        : todayUtc();
    const tzOffsetMinutes = parseTzOffsetMinutes(req.query.tzOffsetMinutes);

    if (technicianId !== requester) {
      const actingRole = (req.user!.roleOverride ?? req.user!.role) as string;
      const isManager = actingRole === "manager" || actingRole === "owner" || actingRole === "sales";
      if (!isManager) {
        return res.status(403).json({ error: "Access denied: manager/owner only for other technicians" });
      }
    }

    const readiness = await computeRouteReadiness(companyId, technicianId, date, tzOffsetMinutes);
    return res.json(readiness);
  } catch {
    return res.status(500).json({ error: "Failed to compute route readiness" });
  }
});

// ─── GET /technician/daily-rig/team-route-readiness?date=&tzOffsetMinutes= ───
//
// Team-wide Today's Route Readiness, computed for every technician in the
// company. Manager/owner only.

router.get("/team-route-readiness", requireRole("manager"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const date =
      typeof req.query.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
        ? req.query.date
        : todayUtc();
    const tzOffsetMinutes = parseTzOffsetMinutes(req.query.tzOffsetMinutes);

    const technicians = await db
      .select({ clerkUserId: usersTable.clerkUserId })
      .from(usersTable)
      .where(and(eq(usersTable.companyId, companyId), eq(usersTable.role, "technician")));

    const results = await Promise.all(
      technicians.map((t) => computeRouteReadiness(companyId, t.clerkUserId, date, tzOffsetMinutes)),
    );

    return res.json(results);
  } catch {
    return res.status(500).json({ error: "Failed to compute team route readiness" });
  }
});

export default router;
