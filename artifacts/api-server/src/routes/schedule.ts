/**
 * Schedule routes — web-portal dispatch calendar for managers.
 *
 * GET  /api/schedule       — return all company inspections in a date window,
 *                            annotated with their calendar date and grouped by
 *                            technician for the week/day grid.
 * PATCH /api/schedule/:id  — update scheduledDate and/or reassign technician.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  inspectionsTable,
  usersTable,
  baitStationsTable,
  propertyMemoryTable,
  propertyNotesTable,
  inspectionMediaTable,
  treatmentLogsTable,
  productsTable,
  productLabelRulesTable,
  technicianDailyRigsTable,
} from "@workspace/db";
import { eq, and, isNotNull, desc, gte, sql, lt, inArray } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import { normalizeAddressKey } from "../lib/property-intelligence";
import { requireRole } from "../middleware/require-auth";
import { z } from "zod";
import { notifyTechnicianRouteUpdated } from "../lib/push-notifications";
import {
  computeApplicationCompliance,
  computeForwardEligibility,
  type RouteOutlookStatus,
} from "../lib/chemical-compliance";
import {
  parseTzOffsetMinutes,
  localCalendarDate,
  localMidnightUtc,
  localEndOfDayUtc,
} from "../lib/calendar-tz";
import { getPestPacStopHistory } from "../services/integration/pestpac-sync";

const router = Router();

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function loadPropertyHistory(
  companyId: number,
  address: string,
  historyBefore?: Date,
) {
  const addressKey = normalizeAddressKey(address);

  const [recentInspections, memoryRows, notes, photoRows, materialRows] = await Promise.all([
    db
      .select({
        id: inspectionsTable.id,
        status: inspectionsTable.status,
        severity: inspectionsTable.severity,
        pestTypes: inspectionsTable.pestTypes,
        technicianName: inspectionsTable.technicianName,
        calDate: sql<string>`COALESCE(${inspectionsTable.scheduledDate}, ${inspectionsTable.createdAt})::text`,
        findingsCount: inspectionsTable.findingsCount,
        completedAt: inspectionsTable.completedAt,
      })
      .from(inspectionsTable)
      .where(
        and(
          eq(inspectionsTable.companyId, companyId),
          eq(inspectionsTable.siteAddress, address),
          historyBefore == null
            ? undefined
            : and(
                isNotNull(inspectionsTable.completedAt),
                lt(inspectionsTable.completedAt, historyBefore),
              ),
        ),
      )
      .orderBy(desc(inspectionsTable.completedAt), desc(inspectionsTable.id))
      .limit(5),
    db
      .select()
      .from(propertyMemoryTable)
      .where(
        and(
          eq(propertyMemoryTable.companyId, companyId),
          eq(propertyMemoryTable.addressKey, addressKey),
        ),
      )
      .limit(1),
    db
      .select()
      .from(propertyNotesTable)
      .where(
        and(
          eq(propertyNotesTable.companyId, companyId),
          eq(propertyNotesTable.addressKey, addressKey),
        ),
      )
      .orderBy(desc(propertyNotesTable.createdAt))
      .limit(10),
    db
      .select({
        id: inspectionMediaTable.id,
        url: inspectionMediaTable.url,
        filename: inspectionMediaTable.filename,
        caption: inspectionMediaTable.caption,
        inspectionId: inspectionMediaTable.inspectionId,
        createdAt: inspectionMediaTable.createdAt,
        inspectionDate: sql<string>`COALESCE(${inspectionsTable.scheduledDate}, ${inspectionsTable.createdAt})::text`,
      })
      .from(inspectionMediaTable)
      .innerJoin(inspectionsTable, eq(inspectionsTable.id, inspectionMediaTable.inspectionId))
      .where(
        and(
          eq(inspectionMediaTable.companyId, companyId),
          eq(inspectionsTable.companyId, companyId),
          eq(inspectionsTable.siteAddress, address),
          sql`${inspectionMediaTable.mediaType} IN ('photo', 'image')`,
          historyBefore == null
            ? undefined
            : and(
                isNotNull(inspectionsTable.completedAt),
                lt(inspectionsTable.completedAt, historyBefore),
                lt(inspectionMediaTable.createdAt, historyBefore),
              ),
        ),
      )
      .orderBy(desc(inspectionMediaTable.createdAt))
      .limit(24),
    db
      .select({
        log: treatmentLogsTable,
        product: productsTable,
        labelRules: productLabelRulesTable,
      })
      .from(treatmentLogsTable)
      .innerJoin(inspectionsTable, eq(inspectionsTable.id, treatmentLogsTable.inspectionId))
      .innerJoin(productsTable, eq(productsTable.id, treatmentLogsTable.productId))
      .leftJoin(
        productLabelRulesTable,
        eq(productLabelRulesTable.productId, treatmentLogsTable.productId),
      )
      .where(
        and(
          eq(treatmentLogsTable.companyId, companyId),
          eq(inspectionsTable.companyId, companyId),
          eq(inspectionsTable.siteAddress, address),
          historyBefore == null
            ? undefined
            : and(
                isNotNull(inspectionsTable.completedAt),
                lt(inspectionsTable.completedAt, historyBefore),
                lt(treatmentLogsTable.appliedAt, historyBefore),
              ),
        ),
      )
      .orderBy(desc(treatmentLogsTable.appliedAt))
      .limit(12),
  ]);

  let activeBaitStations = 0;
  if (recentInspections.length > 0) {
    const [bsRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(baitStationsTable)
      .where(
        and(
          eq(baitStationsTable.companyId, companyId),
          eq(baitStationsTable.inspectionId, recentInspections[0]!.id),
          eq(baitStationsTable.status, "active"),
        ),
      );
    activeBaitStations = bsRow?.count ?? 0;
  }

  const materialHistory = await Promise.all(
    materialRows.map(async ({ log, product, labelRules }) => {
      const [prior] = await db
        .select({ appliedAt: treatmentLogsTable.appliedAt })
        .from(treatmentLogsTable)
        .innerJoin(inspectionsTable, eq(inspectionsTable.id, treatmentLogsTable.inspectionId))
        .where(
          and(
            eq(treatmentLogsTable.companyId, companyId),
            eq(inspectionsTable.companyId, companyId),
            eq(inspectionsTable.siteAddress, address),
            eq(treatmentLogsTable.productId, log.productId),
            lt(treatmentLogsTable.appliedAt, log.appliedAt),
          ),
        )
        .orderBy(desc(treatmentLogsTable.appliedAt))
        .limit(1);

      return {
        id: log.id,
        inspectionId: log.inspectionId,
        productId: log.productId,
        productName: product.name,
        epaRegistrationNumber: product.epaRegistrationNumber,
        targetPest: log.targetPest,
        siteClassification: log.siteClassification,
        areaSqft: log.areaSqft,
        linearFt: log.linearFt,
        totalProductOz: log.totalProductOz,
        equipmentUsed: log.equipmentUsed,
        notes: log.notes,
        appliedAt: log.appliedAt.toISOString(),
        compliance: computeApplicationCompliance(
          labelRules?.retreatmentIntervalDays ?? null,
          prior?.appliedAt ?? null,
          log.appliedAt,
        ),
      };
    }),
  );

  const mem = memoryRows[0] ?? null;
  return {
    address,
    addressKey,
    recentInspections: recentInspections.map((row) => ({
      id: row.id,
      status: row.status,
      severity: row.severity ?? null,
      pestTypes: row.pestTypes ?? [],
      technicianName: row.technicianName,
      calendarDate: toISODate(new Date(row.calDate)),
      findingsCount: row.findingsCount,
      completedAt: row.completedAt?.toISOString() ?? null,
    })),
    historicalPhotos: photoRows.map((photo) => ({
      id: photo.id,
      url: photo.url,
      filename: photo.filename ?? null,
      caption: photo.caption ?? null,
      inspectionId: photo.inspectionId,
      calendarDate: toISODate(new Date(photo.inspectionDate)),
      createdAt: photo.createdAt.toISOString(),
    })),
    materialHistory,
    activeBaitStations,
    historicalPests: mem?.historicalPests ?? [],
    historicalFindings: mem?.historicalFindings ?? [],
    notes: notes.map((note) => ({
      id: note.id,
      note: note.note,
      zone: note.zone ?? null,
      category: note.category ?? null,
      authorName: note.authorName ?? null,
      createdAt: note.createdAt.toISOString(),
    })),
  };
}

/** GET /schedule?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Returns inspections whose calendar date (scheduledDate when set, otherwise
 * createdAt) falls within [start, end] inclusive.
 *
 * Access rules:
 *   - manager / owner / sales → all company stops.
 *   - any other role          → own stops only (WHERE technicianId = clerkUserId).
 */
router.get("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const user = req.user!;
    const actingRole = (user.roleOverride ?? user.role) as string;
    // sales reps never have inspections assigned to their own clerkUserId
    // (they aren't dispatched as technicians), so without company-wide read
    // access here the Schedule page/tab is silently empty for them — treat
    // sales the same as manager/owner, matching the Route Calendar endpoints
    // below and the requireRole("sales") convention used elsewhere.
    const isManager = actingRole === "manager" || actingRole === "owner" || actingRole === "sales";

    const startStr = typeof req.query.start === "string" ? req.query.start : null;
    const endStr   = typeof req.query.end   === "string" ? req.query.end   : null;

    if (!startStr || !endStr) {
      return res.status(400).json({ error: "start and end query params (YYYY-MM-DD) are required" });
    }

    // Extend end date to end-of-day so the comparison is fully inclusive.
    const startDate = new Date(`${startStr}T00:00:00.000Z`);
    const endDate   = new Date(`${endStr}T23:59:59.999Z`);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format — use YYYY-MM-DD" });
    }

    // Build a base WHERE that scopes to the authenticated user's own stops
    // when they are not a manager/owner/sales.
    const dateRangeFilter = and(
      sql`COALESCE(${inspectionsTable.scheduledDate}, ${inspectionsTable.createdAt}) >= ${startDate}`,
      sql`COALESCE(${inspectionsTable.scheduledDate}, ${inspectionsTable.createdAt}) <= ${endDate}`,
    );

    const rows = await db
      .select()
      .from(inspectionsTable)
      .where(
        isManager
          ? and(eq(inspectionsTable.companyId, companyId), dateRangeFilter)
          : and(
              eq(inspectionsTable.companyId, companyId),
              eq(inspectionsTable.technicianId, user.clerkUserId),
              dateRangeFilter,
            ),
      );

    const entries = rows.map((r) => {
      const calDate = r.scheduledDate ?? r.createdAt;
      return {
        id: r.id,
        siteAddress: r.siteAddress,
        clientName: r.clientName ?? null,
        unitNumber: r.unitNumber ?? null,
        technicianName: r.technicianName,
        technicianId: r.technicianId ?? null,
        status: r.status,
        severity: r.severity ?? null,
        pestTypes: r.pestTypes ?? [],
        scheduledDate: r.scheduledDate?.toISOString() ?? null,
        calendarDate: toISODate(calDate),   // YYYY-MM-DD — used by the grid
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
      };
    });

    return res.json(entries);
  } catch {
    return res.status(500).json({ error: "Failed to load schedule" });
  }
});

/** GET /schedule/property-profile?address=ENCODED_ADDRESS
 *
 * Returns a pre-inspection briefing for a specific property address:
 *   - Last 5 inspections (status, severity, technician, date, finding count)
 *   - AI-synthesised recurring issues and historical pests from property_memory
 *   - Property notes (access instructions, hazards, special needs) from property_notes
 *   - Active bait station count from the most recent inspection at this address
 *
 * Access rules:
 *   - manager / owner / sales → unrestricted.
 *   - technician (or other role) → must have at least one inspection assigned
 *     to them at the requested address, otherwise 403.
 */
router.get("/property-profile", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const user = req.user!;
    const actingRole = (user.roleOverride ?? user.role) as string;
    // sales reps are never assigned as a technician — treat them as
    // company-wide readers here too, consistent with the schedule endpoints.
    const isManager = actingRole === "manager" || actingRole === "owner" || actingRole === "sales";

    const address =
      typeof req.query.address === "string" ? req.query.address.trim() : null;
    if (!address) {
      return res
        .status(400)
        .json({ error: "address query param is required" });
    }

    // Technicians may only fetch the profile for addresses they are personally
    // assigned to (i.e. at least one inspection at that address with their
    // technicianId).  This prevents a rogue mobile client from mining company
    // site intelligence for properties they have never visited.
    if (!isManager) {
      const [assigned] = await db
        .select({ id: inspectionsTable.id })
        .from(inspectionsTable)
        .where(
          and(
            eq(inspectionsTable.companyId, companyId),
            eq(inspectionsTable.siteAddress, address),
            eq(inspectionsTable.technicianId, user.clerkUserId),
          ),
        )
        .limit(1);
      if (!assigned) {
        return res
          .status(403)
          .json({ error: "Access denied: no inspection assigned to you at this address" });
      }
    }

    return res.json(await loadPropertyHistory(companyId, address));
  } catch {
    return res.status(500).json({ error: "Failed to load property profile" });
  }
});

/** GET /schedule/stop-history/:inspectionId
 *
 * Resolves one stop inside the authenticated company and returns the complete
 * pre-service history for its property in one response. Inspection-backed
 * history is limited to completed services before the stop's scheduled time:
 * a same-day sibling completed earlier is included, while pending and later
 * records are not. Technicians must be assigned to this exact stop.
 */
router.get("/stop-history/:inspectionId", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const user = req.user!;
    const actingRole = (user.roleOverride ?? user.role) as string;
    const hasCompanyWideRead =
      actingRole === "manager" || actingRole === "owner" || actingRole === "sales";
    const inspectionId = Number(req.params.inspectionId);

    if (!Number.isInteger(inspectionId) || inspectionId <= 0) {
      return res.status(400).json({ error: "Invalid inspection id" });
    }

    const [stop] = await db
      .select({
        id: inspectionsTable.id,
        siteAddress: inspectionsTable.siteAddress,
        technicianId: inspectionsTable.technicianId,
        scheduledDate: inspectionsTable.scheduledDate,
        createdAt: inspectionsTable.createdAt,
      })
      .from(inspectionsTable)
      .where(
        and(
          eq(inspectionsTable.id, inspectionId),
          eq(inspectionsTable.companyId, companyId),
        ),
      )
      .limit(1);

    if (!stop) return res.status(404).json({ error: "Scheduled stop not found" });

    if (!hasCompanyWideRead && stop.technicianId !== user.clerkUserId) {
      return res.status(403).json({ error: "Access denied: this stop is not assigned to you" });
    }

    const historyBefore = stop.scheduledDate ?? stop.createdAt;
    const [history, pestPacHistory] = await Promise.all([
      loadPropertyHistory(companyId, stop.siteAddress, historyBefore),
      getPestPacStopHistory(companyId, stop.id, historyBefore),
    ]);
    return res.json({
      ...history,
      stopId: stop.id,
      recentInspections: history.recentInspections.slice(0, 3),
      pestPacHistory,
    });
  } catch {
    return res.status(500).json({ error: "Failed to load stop history" });
  }
});

/** GET /schedule/property-visit/:inspectionId
 *
 * Drill-down detail for a single "visit" — defined as every inspection that
 * shares the same company + site address + calendar date
 * (COALESCE(scheduledDate, createdAt)) as the given inspection. This
 * naturally covers a single-family stop (one inspection) and a multi-unit
 * property visited the same day (one inspection per unit, grouped by
 * address — consistent with the existing `unitNumber` convention).
 *
 * Returns:
 *   - address, calendarDate
 *   - units[]          — one entry per sibling inspection at this visit
 *   - chemicalLedger[] — every chemical application recorded across all units
 *     on this visit, each carrying a `compliance` block that checks the
 *     product's label retreatment interval against the most recent PRIOR
 *     application of the same product at this address, plus a forward-looking
 *     `nextEligibleReapplicationDate` / `eligibleNow` so a technician
 *     reviewing history can tell whether the chemical could legally be
 *     reapplied today.
 *
 * Access rules mirror /property-profile:
 *   - manager / owner / sales → unrestricted.
 *   - other roles → must have a personally-assigned inspection at this
 *     address, otherwise 403.
 */
router.get("/property-visit/:inspectionId", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const user = req.user!;
    const actingRole = (user.roleOverride ?? user.role) as string;
    // sales reps are never assigned as a technician — treat them as
    // company-wide readers here too, consistent with the schedule endpoints.
    const isManager = actingRole === "manager" || actingRole === "owner" || actingRole === "sales";

    const inspectionId = Number(req.params.inspectionId);
    if (!Number.isFinite(inspectionId)) {
      return res.status(400).json({ error: "Invalid inspection id" });
    }

    const [anchor] = await db
      .select()
      .from(inspectionsTable)
      .where(
        and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)),
      );
    if (!anchor) return res.status(404).json({ error: "Inspection not found" });

    if (!isManager) {
      const [assigned] = await db
        .select({ id: inspectionsTable.id })
        .from(inspectionsTable)
        .where(
          and(
            eq(inspectionsTable.companyId, companyId),
            eq(inspectionsTable.siteAddress, anchor.siteAddress),
            eq(inspectionsTable.technicianId, user.clerkUserId),
          ),
        )
        .limit(1);
      if (!assigned) {
        return res
          .status(403)
          .json({ error: "Access denied: no inspection assigned to you at this address" });
      }
    }

    const calendarDate = toISODate(anchor.scheduledDate ?? anchor.createdAt);

    // Sibling inspections: same company + address + calendar day.
    const units = await db
      .select()
      .from(inspectionsTable)
      .where(
        and(
          eq(inspectionsTable.companyId, companyId),
          eq(inspectionsTable.siteAddress, anchor.siteAddress),
          sql`COALESCE(${inspectionsTable.scheduledDate}, ${inspectionsTable.createdAt})::date = ${calendarDate}::date`,
        ),
      )
      .orderBy(inspectionsTable.unitNumber, inspectionsTable.id);

    const unitIds = units.map((u) => u.id);

    // Every chemical application recorded across all units visited this day.
    const ledgerRows = unitIds.length
      ? await db
          .select({ log: treatmentLogsTable, product: productsTable, labelRules: productLabelRulesTable })
          .from(treatmentLogsTable)
          .innerJoin(productsTable, eq(productsTable.id, treatmentLogsTable.productId))
          .leftJoin(
            productLabelRulesTable,
            eq(productLabelRulesTable.productId, treatmentLogsTable.productId),
          )
          .where(
            and(
              eq(treatmentLogsTable.companyId, companyId),
              inArray(treatmentLogsTable.inspectionId, unitIds),
            ),
          )
          .orderBy(desc(treatmentLogsTable.appliedAt))
      : [];

    // Per-application compliance: does the gap since the most recent PRIOR
    // application of the same product at this same address respect the
    // label's retreatment interval? N+1 lookups — acceptable at this scale,
    // consistent with existing route style in this codebase.
    const chemicalLedger = await Promise.all(
      ledgerRows.map(async ({ log, product, labelRules }) => {
        const retreatmentIntervalDays = labelRules?.retreatmentIntervalDays ?? null;

        const [prior] = await db
          .select({ appliedAt: treatmentLogsTable.appliedAt })
          .from(treatmentLogsTable)
          .innerJoin(inspectionsTable, eq(inspectionsTable.id, treatmentLogsTable.inspectionId))
          .where(
            and(
              eq(treatmentLogsTable.companyId, companyId),
              eq(treatmentLogsTable.productId, log.productId),
              eq(inspectionsTable.siteAddress, anchor.siteAddress),
              lt(treatmentLogsTable.appliedAt, log.appliedAt),
            ),
          )
          .orderBy(desc(treatmentLogsTable.appliedAt))
          .limit(1);

        const compliance = computeApplicationCompliance(
          retreatmentIntervalDays,
          prior?.appliedAt ?? null,
          log.appliedAt,
        );

        return {
          id: log.id,
          inspectionId: log.inspectionId,
          productId: log.productId,
          productName: product.name,
          epaRegistrationNumber: product.epaRegistrationNumber,
          targetPest: log.targetPest,
          siteClassification: log.siteClassification,
          areaSqft: log.areaSqft,
          linearFt: log.linearFt,
          totalProductOz: log.totalProductOz,
          equipmentUsed: log.equipmentUsed,
          notes: log.notes,
          appliedAt: log.appliedAt.toISOString(),
          compliance,
        };
      }),
    );

    return res.json({
      address: anchor.siteAddress,
      calendarDate,
      units: units.map((u) => ({
        id: u.id,
        unitNumber: u.unitNumber ?? null,
        clientName: u.clientName ?? null,
        technicianName: u.technicianName,
        technicianId: u.technicianId ?? null,
        status: u.status,
        severity: u.severity ?? null,
        pestTypes: u.pestTypes ?? [],
        notes: u.notes ?? null,
        visitPurpose: u.visitPurpose ?? null,
        findingsCount: u.findingsCount,
        mediaCount: u.mediaCount,
        completedAt: u.completedAt?.toISOString() ?? null,
      })),
      chemicalLedger,
    });
  } catch {
    return res.status(500).json({ error: "Failed to load property visit" });
  }
});

const OUTLOOK_LOOKBACK_DAYS = 365;
const OUTLOOK_RECENT_WINDOW_DAYS = 90;

interface RouteOutlookProduct {
  productId: number;
  productName: string;
  targetPest: string;
  lastAppliedAt: string;
  daysSinceApplication: number;
  retreatmentIntervalDays: number | null;
  nextEligibleReapplicationDate: string | null;
  eligibleNow: boolean;
  outlookStatus: RouteOutlookStatus;
  applicationsLast90Days: number;
}

/**
 * Route Chemical Outlook for a single address: for every product applied at
 * this address within the lookback window, project forward from its most
 * recent application to flag whether it is due, due-soon, or overdue for
 * reapplication. This is the deterministic stand-in for FAIE predictive
 * consumption forecasting — statistical projection off the retreatment
 * interval, not a trained model.
 */
async function computeRouteChemicalOutlookForAddress(
  companyId: number,
  siteAddress: string,
): Promise<RouteOutlookProduct[]> {
  const since = new Date(Date.now() - OUTLOOK_LOOKBACK_DAYS * 86_400_000);
  const recentCutoff = new Date(Date.now() - OUTLOOK_RECENT_WINDOW_DAYS * 86_400_000);

  const rows = await db
    .select({ log: treatmentLogsTable, product: productsTable, labelRules: productLabelRulesTable })
    .from(treatmentLogsTable)
    .innerJoin(inspectionsTable, eq(inspectionsTable.id, treatmentLogsTable.inspectionId))
    .innerJoin(productsTable, eq(productsTable.id, treatmentLogsTable.productId))
    .leftJoin(productLabelRulesTable, eq(productLabelRulesTable.productId, treatmentLogsTable.productId))
    .where(
      and(
        eq(treatmentLogsTable.companyId, companyId),
        eq(inspectionsTable.siteAddress, siteAddress),
        gte(treatmentLogsTable.appliedAt, since),
      ),
    )
    .orderBy(desc(treatmentLogsTable.appliedAt));

  const latestByProduct = new Map<number, (typeof rows)[number]>();
  const recentCountByProduct = new Map<number, number>();
  for (const row of rows) {
    if (!latestByProduct.has(row.log.productId)) latestByProduct.set(row.log.productId, row);
    if (row.log.appliedAt >= recentCutoff) {
      recentCountByProduct.set(row.log.productId, (recentCountByProduct.get(row.log.productId) ?? 0) + 1);
    }
  }

  return Array.from(latestByProduct.values())
    .map(({ log, product, labelRules }) => {
      const retreatmentIntervalDays = labelRules?.retreatmentIntervalDays ?? null;
      const forward = computeForwardEligibility(retreatmentIntervalDays, log.appliedAt);
      return {
        productId: log.productId,
        productName: product.name,
        targetPest: log.targetPest,
        lastAppliedAt: log.appliedAt.toISOString(),
        daysSinceApplication: forward.daysSinceApplication,
        retreatmentIntervalDays,
        nextEligibleReapplicationDate: forward.nextEligibleReapplicationDate,
        eligibleNow: forward.eligibleNow,
        outlookStatus: forward.outlookStatus,
        applicationsLast90Days: recentCountByProduct.get(log.productId) ?? 0,
      };
    })
    .sort((a, b) => {
      const rank: Record<RouteOutlookStatus, number> = { overdue: 0, "due-soon": 1, ok: 2 };
      return rank[a.outlookStatus] - rank[b.outlookStatus];
    });
}

/** GET /schedule/route-outlook/:inspectionId
 *
 * Full Route Chemical Outlook for the address of the given inspection —
 * every recently-applied product with its due/due-soon/overdue projection.
 * Access rules mirror /property-visit/:inspectionId.
 */
router.get("/route-outlook/:inspectionId", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const user = req.user!;
    const actingRole = (user.roleOverride ?? user.role) as string;
    // sales is treated as company-wide read access here (same as the Route
    // Calendar list below) — sales reps never have inspections assigned to
    // their own clerkUserId, so without this they could never view outlook
    // detail for any stop the calendar shows them.
    const isManager = actingRole === "manager" || actingRole === "owner" || actingRole === "sales";
    const tzOffsetMinutes = parseTzOffsetMinutes(req.query.tzOffsetMinutes);

    const inspectionId = Number(req.params.inspectionId);
    if (!Number.isFinite(inspectionId)) {
      return res.status(400).json({ error: "Invalid inspection id" });
    }

    const [anchor] = await db
      .select()
      .from(inspectionsTable)
      .where(and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)));
    if (!anchor) return res.status(404).json({ error: "Inspection not found" });

    if (!isManager) {
      const [assigned] = await db
        .select({ id: inspectionsTable.id })
        .from(inspectionsTable)
        .where(
          and(
            eq(inspectionsTable.companyId, companyId),
            eq(inspectionsTable.siteAddress, anchor.siteAddress),
            eq(inspectionsTable.technicianId, user.clerkUserId),
          ),
        )
        .limit(1);
      if (!assigned) {
        return res
          .status(403)
          .json({ error: "Access denied: no inspection assigned to you at this address" });
      }
    }

    const products = await computeRouteChemicalOutlookForAddress(companyId, anchor.siteAddress);

    return res.json({
      address: anchor.siteAddress,
      calendarDate: localCalendarDate(anchor.scheduledDate ?? anchor.createdAt, tzOffsetMinutes),
      products,
    });
  } catch {
    return res.status(500).json({ error: "Failed to load route outlook" });
  }
});

/** GET /schedule/route-calendar?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Powers the Integrated Route Calendar module on the mobile and portal
 * dashboards. Same access-scoping and date-window semantics as GET /schedule,
 * but grouped by calendar day and annotated per stop with:
 *   - readiness: whether the assigned technician has set up their daily rig
 *     (Route Readiness) for that stop's calendar date.
 *   - outlook: a rolled-up count of due-soon/overdue chemical products at
 *     that stop's address (Route Chemical Outlook), so a flag is visible on
 *     the calendar entry itself without opening it.
 */
router.get("/route-calendar", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const user = req.user!;
    const actingRole = (user.roleOverride ?? user.role) as string;
    // sales reps are one of the three roles the Route Calendar module targets
    // (technician / sales / manager) but never have inspections assigned to
    // their own clerkUserId — treat them as company-wide readers here, same
    // as manager/owner, or the calendar would always be empty for them.
    const isManager = actingRole === "manager" || actingRole === "owner" || actingRole === "sales";
    const tzOffsetMinutes = parseTzOffsetMinutes(req.query.tzOffsetMinutes);

    const startStr = typeof req.query.start === "string" ? req.query.start : null;
    const endStr = typeof req.query.end === "string" ? req.query.end : null;
    if (!startStr || !endStr) {
      return res.status(400).json({ error: "start and end query params (YYYY-MM-DD) are required" });
    }
    const startDate = localMidnightUtc(startStr, tzOffsetMinutes);
    const endDate = localEndOfDayUtc(endStr, tzOffsetMinutes);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format — use YYYY-MM-DD" });
    }

    const dateRangeFilter = and(
      sql`COALESCE(${inspectionsTable.scheduledDate}, ${inspectionsTable.createdAt}) >= ${startDate}`,
      sql`COALESCE(${inspectionsTable.scheduledDate}, ${inspectionsTable.createdAt}) <= ${endDate}`,
    );

    const rows = await db
      .select()
      .from(inspectionsTable)
      .where(
        isManager
          ? and(eq(inspectionsTable.companyId, companyId), dateRangeFilter)
          : and(
              eq(inspectionsTable.companyId, companyId),
              eq(inspectionsTable.technicianId, user.clerkUserId),
              dateRangeFilter,
            ),
      );

    // Readiness: which (technicianId, rigDate) pairs already have a daily rig
    // set up, across every technician/date combination present in the stops.
    const technicianIds = Array.from(
      new Set(rows.map((r) => r.technicianId).filter((id): id is string => !!id)),
    );
    const rigRows = technicianIds.length
      ? await db
          .select({ technicianId: technicianDailyRigsTable.technicianId, rigDate: technicianDailyRigsTable.rigDate })
          .from(technicianDailyRigsTable)
          .where(
            and(
              eq(technicianDailyRigsTable.companyId, companyId),
              inArray(technicianDailyRigsTable.technicianId, technicianIds),
              gte(technicianDailyRigsTable.rigDate, startStr),
              sql`${technicianDailyRigsTable.rigDate} <= ${endStr}`,
            ),
          )
      : [];
    const readySet = new Set(rigRows.map((r) => `${r.technicianId}|${r.rigDate}`));

    // Outlook: dedupe by address so we don't recompute per stop.
    const addresses = Array.from(new Set(rows.map((r) => r.siteAddress)));
    const outlookByAddress = new Map<string, RouteOutlookProduct[]>();
    await Promise.all(
      addresses.map(async (address) => {
        outlookByAddress.set(address, await computeRouteChemicalOutlookForAddress(companyId, address));
      }),
    );

    const dayMap = new Map<
      string,
      Array<{
        id: number;
        siteAddress: string;
        clientName: string | null;
        unitNumber: string | null;
        technicianName: string;
        technicianId: string | null;
        status: string;
        severity: string | null;
        pestTypes: string[];
        calendarDate: string;
        readiness: { dailyRigSetUp: boolean | null };
        outlook: { overdueCount: number; dueSoonCount: number; okCount: number; hasOutlookData: boolean };
      }>
    >();

    for (const r of rows) {
      const calendarDate = localCalendarDate(r.scheduledDate ?? r.createdAt, tzOffsetMinutes);
      const products = outlookByAddress.get(r.siteAddress) ?? [];
      const overdueCount = products.filter((p) => p.outlookStatus === "overdue").length;
      const dueSoonCount = products.filter((p) => p.outlookStatus === "due-soon").length;
      const okCount = products.filter((p) => p.outlookStatus === "ok").length;

      const stop = {
        id: r.id,
        siteAddress: r.siteAddress,
        clientName: r.clientName ?? null,
        unitNumber: r.unitNumber ?? null,
        technicianName: r.technicianName,
        technicianId: r.technicianId ?? null,
        status: r.status,
        severity: r.severity ?? null,
        pestTypes: r.pestTypes ?? [],
        calendarDate,
        readiness: {
          dailyRigSetUp: r.technicianId ? readySet.has(`${r.technicianId}|${calendarDate}`) : null,
        },
        outlook: { overdueCount, dueSoonCount, okCount, hasOutlookData: products.length > 0 },
      };

      const bucket = dayMap.get(calendarDate);
      if (bucket) bucket.push(stop);
      else dayMap.set(calendarDate, [stop]);
    }

    const days = Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, stops]) => ({
        date,
        stops: stops.sort((a, b) => a.siteAddress.localeCompare(b.siteAddress)),
      }));

    return res.json(days);
  } catch {
    return res.status(500).json({ error: "Failed to load route calendar" });
  }
});

const reassignSchema = z.object({
  scheduledDate: z.string().datetime({ offset: true }).optional().nullable(),
  technicianName: z.string().min(1).optional(),
  technicianId: z.string().optional().nullable(),
});

/**
 * Resolve a technician's Clerk user ID from their display name by looking at
 * existing inspections in the same company that already have a technicianId
 * set. Returns null if no match is found.
 *
 * This covers the common portal flow where the manager picks a technician by
 * name (not Clerk ID). The heuristic is reliable for active technicians who
 * have previously created or been assigned an inspection through the mobile app.
 */
async function resolveTechnicianClerkId(
  companyId: number,
  technicianName: string,
): Promise<string | null> {
  const [prior] = await db
    .select({ technicianId: inspectionsTable.technicianId })
    .from(inspectionsTable)
    .where(
      and(
        eq(inspectionsTable.companyId, companyId),
        eq(inspectionsTable.technicianName, technicianName),
        isNotNull(inspectionsTable.technicianId),
      ),
    )
    .orderBy(desc(inspectionsTable.id))
    .limit(1);
  return prior?.technicianId ?? null;
}

/**
 * Confirm that a Clerk user ID belongs to a user with role `technician` in the
 * given company. Used to reject non-technician IDs from being persisted as an
 * inspection assignment or included in route-update push notifications.
 */
async function validateTechnicianClerkId(
  companyId: number,
  clerkUserId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.companyId, companyId),
        eq(usersTable.clerkUserId, clerkUserId),
        eq(usersTable.role, "technician"),
      ),
    )
    .limit(1);
  return !!row;
}

/** PATCH /schedule/:id  — reschedule or reassign an inspection (manager-only) */
router.patch("/:id", requireRole("manager"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const parse = reassignSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: "Invalid request body", details: parse.error.issues });
    }

    const { scheduledDate, technicianName, technicianId } = parse.data;

    // Verify ownership before mutating, and capture the pre-update state so we
    // can detect what actually changed and notify the right technician(s).
    const [existing] = await db
      .select({
        id: inspectionsTable.id,
        companyId: inspectionsTable.companyId,
        technicianId: inspectionsTable.technicianId,
        technicianName: inspectionsTable.technicianName,
        siteAddress: inspectionsTable.siteAddress,
        scheduledDate: inspectionsTable.scheduledDate,
      })
      .from(inspectionsTable)
      .where(and(eq(inspectionsTable.id, id), eq(inspectionsTable.companyId, companyId)));

    if (!existing) {
      return res.status(404).json({ error: "Inspection not found" });
    }

    const update: Partial<typeof inspectionsTable.$inferInsert> = {};
    if (scheduledDate !== undefined) {
      update.scheduledDate = scheduledDate ? new Date(scheduledDate) : null;
    }
    if (technicianName !== undefined) update.technicianName = technicianName;
    // technicianId is resolved, validated, and written to `update` below.

    if (Object.keys(update).length === 0 && technicianId === undefined) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    // ── Resolve and validate new technician Clerk ID BEFORE the DB update ────
    //
    // Resolution queries the inspections table by technicianName. Running it
    // before the write avoids self-contamination (the updated row's new name
    // would otherwise appear in the lookup and return the wrong Clerk ID).
    //
    // Validation guards against a manager sending a non-technician Clerk ID
    // (e.g. an owner or manager) as the `technicianId` field; such IDs are
    // rejected and never persisted or included in the notification set.
    //
    // Strategy:
    //  1. Caller sent explicit technicianId: null → clear the stored ID.
    //  2. Caller sent explicit technicianId: "clerkId" → validate it is a company
    //     technician; if valid, persist; if not, ignore the supplied value.
    //  3. technicianName is changing and no technicianId was sent → resolve from
    //     prior inspections, then validate; persist only on a valid non-null match.
    //  4. Nothing changed on the technician side → keep the existing Clerk ID.

    const prevTechClerkId = existing.technicianId ?? null;
    let newTechClerkId: string | null = prevTechClerkId;
    // Tracks whether the name changed and we CONFIRMED it maps to the same person.
    // When false + name changed, we treat the reassignment as real even if we
    // couldn't resolve the new tech's Clerk ID (old tech should still be notified).
    let resolvedToSamePerson = false;
    // Set to the new technician's display name when their Clerk ID could not be
    // resolved (new hire with no prior inspections). Used to populate `warnings`
    // in the response so the caller knows the notification was skipped.
    let unresolvedNewTechName: string | null = null;

    if (technicianId !== undefined) {
      if (technicianId === null) {
        // Intentional clear — no validation needed.
        newTechClerkId = null;
        update.technicianId = null;
      } else {
        // Validate that the Clerk ID belongs to a company technician.
        const isValidTech = await validateTechnicianClerkId(companyId, technicianId);
        if (isValidTech) {
          newTechClerkId = technicianId;
          update.technicianId = technicianId;
          if (technicianId === prevTechClerkId) resolvedToSamePerson = true;
        } else {
          // The supplied ID is not a valid company technician. If the name is also
          // changing (a real reassignment attempt with a bad ID), clear the stored
          // ID so a future date-only reschedule does not falsely notify the former
          // technician. If only the ID field was touched (name unchanged), keep the
          // existing ID and silently discard the invalid value.
          const nameAlsoChanging =
            technicianName !== undefined && technicianName !== existing.technicianName;
          if (nameAlsoChanging) {
            newTechClerkId = null;
            update.technicianId = null;
          }
        }
      }
    } else if (
      technicianName !== undefined &&
      technicianName !== existing.technicianName
    ) {
      // Portal sends name-only; resolve from prior inspections (always validated
      // because the stored IDs were set by authenticated mobile-app technicians,
      // but we validate anyway for defence in depth).
      const resolved = await resolveTechnicianClerkId(companyId, technicianName);
      if (resolved !== null) {
        const isValidTech = await validateTechnicianClerkId(companyId, resolved);
        if (isValidTech) {
          newTechClerkId = resolved;
          update.technicianId = resolved;
          if (resolved === prevTechClerkId) resolvedToSamePerson = true;
        } else {
          // Resolved ID failed role validation — clear the field so the former
          // tech is not wrongly treated as the owner of this route going forward.
          newTechClerkId = null;
          update.technicianId = null;
        }
      } else {
        // No prior inspection found for this name — the new tech has no Clerk ID
        // history yet. Clear the stored ID so a future date-only reschedule does
        // not send a false notification to the former technician.
        newTechClerkId = null;
        update.technicianId = null;
        // Flag so the response can warn the caller that this tech won't be notified.
        unresolvedNewTechName = technicianName;
      }
    }

    const [updated] = await db
      .update(inspectionsTable)
      .set(update)
      .where(and(eq(inspectionsTable.id, id), eq(inspectionsTable.companyId, companyId)))
      .returning();

    const calDate = updated.scheduledDate ?? updated.createdAt;

    // Build warnings for the caller so UI can surface notification gaps.
    const warnings: string[] = [];
    if (unresolvedNewTechName !== null) {
      warnings.push(
        `Technician "${unresolvedNewTechName}" has no Clerk account record yet — ` +
          `they will not receive a push notification until they sign in to the mobile app.`,
      );
    }

    const responsePayload: Record<string, unknown> = {
      id: updated.id,
      siteAddress: updated.siteAddress,
      clientName: updated.clientName ?? null,
      technicianName: updated.technicianName,
      technicianId: updated.technicianId ?? null,
      status: updated.status,
      severity: updated.severity ?? null,
      pestTypes: updated.pestTypes ?? [],
      scheduledDate: updated.scheduledDate?.toISOString() ?? null,
      calendarDate: toISODate(calDate),
      createdAt: updated.createdAt.toISOString(),
      completedAt: updated.completedAt?.toISOString() ?? null,
    };

    if (warnings.length > 0) {
      responsePayload.warnings = warnings;
    }

    // ── Push notification ─────────────────────────────────────────────────────
    //
    // Notify affected technician(s) only when something meaningful actually
    // changed (date or technician assignment). The resolution was done before
    // the DB update to avoid contaminating the name-lookup with the just-written row.

    const actingClerkId = req.user?.clerkUserId ?? null;

    // Determine what actually changed.
    const prevDateMs = existing.scheduledDate?.getTime() ?? null;
    const newDateMs = updated.scheduledDate?.getTime() ?? null;
    const scheduledDateChanged = prevDateMs !== newDateMs;
    const nameChanged = technicianName !== undefined && technicianName !== existing.technicianName;
    // A technician change is detected when:
    //   - The resolved/stored Clerk IDs differ, OR
    //   - The display name changed but we could NOT confirm it's the same person
    //     (resolution returned null or an invalid ID). This ensures the old tech
    //     is always notified when their route is reassigned away, even if we can't
    //     identify the new tech's Clerk ID yet.
    const technicianChanged =
      prevTechClerkId !== newTechClerkId || (nameChanged && !resolvedToSamePerson);

    if (scheduledDateChanged || technicianChanged) {
      // Build the recipient set: old tech + new tech, minus the acting user so a
      // technician self-reassigning never gets a redundant ping.
      const toNotify = new Set<string>();
      if (prevTechClerkId) toNotify.add(prevTechClerkId);
      if (newTechClerkId) toNotify.add(newTechClerkId);
      if (actingClerkId) toNotify.delete(actingClerkId);

      if (toNotify.size > 0) {
        void notifyTechnicianRouteUpdated({
          companyId,
          inspectionId: id,
          technicianClerkIds: [...toNotify],
          scheduledDate: updated.scheduledDate,
          siteAddress: updated.siteAddress,
        });
      }
    }

    return res.json(responsePayload);
  } catch {
    return res.status(500).json({ error: "Failed to update schedule entry" });
  }
});

export default router;
