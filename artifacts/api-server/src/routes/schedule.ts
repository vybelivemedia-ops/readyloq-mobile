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
import { inspectionsTable } from "@workspace/db";
import { eq, and, gte, lte, or, isNull } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import { z } from "zod";

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

    // Pull everything for the company; we post-filter in JS so we can apply
    // the "scheduledDate ?? createdAt" fallback without a DB-level expression.
    const rows = await db
      .select()
      .from(inspectionsTable)
      .where(eq(inspectionsTable.companyId, companyId));

    const entries = rows
      .map((r) => {
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
      })
      .filter((e) => {
        const d = new Date(e.calendarDate + "T00:00:00.000Z");
        return d >= startDate && d <= endDate;
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

    // Verify ownership before mutating.
    const [existing] = await db
      .select({ id: inspectionsTable.id, companyId: inspectionsTable.companyId })
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
    if (technicianId !== undefined) update.technicianId = technicianId ?? null;

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: "Nothing to update" });
    }

    const [updated] = await db
      .update(inspectionsTable)
      .set(update)
      .where(eq(inspectionsTable.id, id))
      .returning();

    const calDate = updated.scheduledDate ?? updated.createdAt;
    return res.json({
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
    });
  } catch {
    return res.status(500).json({ error: "Failed to update schedule entry" });
  }
});

export default router;
