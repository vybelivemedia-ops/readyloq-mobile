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
import { inspectionsTable, usersTable } from "@workspace/db";
import { eq, and, isNotNull, desc, sql } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import { z } from "zod";
import { notifyTechnicianRouteUpdated } from "../lib/push-notifications";

const router = Router();

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** GET /schedule?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Returns every company inspection whose calendar date (scheduledDate when
 * set, otherwise createdAt) falls within [start, end] inclusive.
 * The response is an array of ScheduleEntry objects ready for the grid.
 */
router.get("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);

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

    // Apply the date-range filter at the DB level using a COALESCE expression
    // so only the relevant rows are fetched (avoids loading the full company
    // inspection history into memory for each calendar request).
    const rows = await db
      .select()
      .from(inspectionsTable)
      .where(
        and(
          eq(inspectionsTable.companyId, companyId),
          sql`COALESCE(${inspectionsTable.scheduledDate}, ${inspectionsTable.createdAt}) >= ${startDate}`,
          sql`COALESCE(${inspectionsTable.scheduledDate}, ${inspectionsTable.createdAt}) <= ${endDate}`,
        ),
      );

    const entries = rows.map((r) => {
      const calDate = r.scheduledDate ?? r.createdAt;
      return {
        id: r.id,
        siteAddress: r.siteAddress,
        clientName: r.clientName ?? null,
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

/** PATCH /schedule/:id  — reschedule or reassign an inspection */
router.patch("/:id", async (req, res) => {
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
