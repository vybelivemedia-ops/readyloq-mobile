import { Router, type IRouter } from "express";
import {
  db,
  opportunitiesTable,
  opportunityEventsTable,
  opportunityNotesTable,
  opportunitySettingsTable,
  usersTable,
  inspectionsTable,
  analysisResultsTable,
  OPPORTUNITY_CATEGORIES,
  OPPORTUNITY_STATUSES,
  type OpportunityCategory,
  type OpportunityStatus,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import { requireRole } from "../middleware/require-auth";
import { runOpportunitySynthesisCore } from "../lib/opportunity-ai";

/**
 * Opportunity Intelligence routes — the management-only view of the hidden
 * Opportunity Log.
 *
 * SECURITY: the whole router is mounted behind
 * `requireAuth + requireCompany + requireRole("sales")` (see routes/index.ts),
 * so technicians get 403 at the API layer — exclusion is enforced here, not
 * just hidden in the UI. Dismissing an opportunity and settings are gated
 * higher per-route (manager / owner).
 */

const router: IRouter = Router();

function serializeOpportunity(row: typeof opportunitiesTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeEvent(row: typeof opportunityEventsTable.$inferSelect) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/** Statuses that count as open pipeline (not yet won/lost/dismissed). */
const OPEN_STATUSES: OpportunityStatus[] = ["new", "reviewed", "quoted"];

// GET /opportunities — pipeline list with optional status/category filters.
// Returns { opportunities, pipelineValue, openCount, staleCount } with
// technicianName joined from the linked inspection for attribution display.
router.get("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const category = typeof req.query.category === "string" ? req.query.category : undefined;

    const conditions = [eq(opportunitiesTable.companyId, companyId)];
    if (status && OPPORTUNITY_STATUSES.includes(status as OpportunityStatus)) {
      conditions.push(eq(opportunitiesTable.status, status as OpportunityStatus));
    }
    if (category && OPPORTUNITY_CATEGORIES.includes(category as OpportunityCategory)) {
      conditions.push(eq(opportunitiesTable.category, category as OpportunityCategory));
    }

    const rows = await db
      .select({
        opportunity: opportunitiesTable,
        technicianName: inspectionsTable.technicianName,
      })
      .from(opportunitiesTable)
      .leftJoin(inspectionsTable, eq(opportunitiesTable.inspectionId, inspectionsTable.id))
      .where(and(...conditions))
      .orderBy(desc(opportunitiesTable.updatedAt));

    const now = Date.now();
    const opportunities = rows.map(({ opportunity, technicianName }) => ({
      ...serializeOpportunity(opportunity),
      technicianName: technicianName ?? null,
      ageDays: Math.floor((now - opportunity.updatedAt.getTime()) / 86_400_000),
    }));

    // Pipeline stats — compute from full result set (no second query needed).
    const openCount = opportunities.filter((o) =>
      OPEN_STATUSES.includes(o.status as OpportunityStatus),
    ).length;
    // "stale" is a client display concept — DB doesn't have a stale status.
    // Count opportunities that haven't moved in 14+ days as stale.
    const staleCount = opportunities.filter(
      (o) => OPEN_STATUSES.includes(o.status as OpportunityStatus) && o.ageDays >= 14,
    ).length;
    const pipelineValue = rows.reduce(
      (acc, { opportunity }) =>
        OPEN_STATUSES.includes(opportunity.status) && opportunity.estimatedAnnualValue
          ? acc + opportunity.estimatedAnnualValue
          : acc,
      0,
    );

    return res.json({ opportunities, pipelineValue, openCount, staleCount });
  } catch {
    return res.status(500).json({ error: "Failed to list opportunities" });
  }
});

// GET /opportunities/trends — deterministic aggregates (math, not AI).
router.get("/trends", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const rows = await db
      .select()
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.companyId, companyId));

    const byCategory: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byTier: Record<string, number> = {};
    const propertyCounts = new Map<string, number>();
    for (const row of rows) {
      byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
      byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
      byTier[row.estimatedValueTier] = (byTier[row.estimatedValueTier] ?? 0) + 1;
      propertyCounts.set(
        row.propertyAddress,
        (propertyCounts.get(row.propertyAddress) ?? 0) + 1,
      );
    }
    const topProperties = Array.from(propertyCounts.entries())
      .map(([propertyAddress, count]) => ({ propertyAddress, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return res.json({ total: rows.length, byCategory, byStatus, byTier, topProperties });
  } catch {
    return res.status(500).json({ error: "Failed to compute opportunity trends" });
  }
});

// GET /opportunities/settings — owner-only tuning panel.
router.get("/settings", requireRole("owner"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const [existing] = await db
      .select()
      .from(opportunitySettingsTable)
      .where(eq(opportunitySettingsTable.companyId, companyId))
      .limit(1);
    if (existing) {
      return res.json({ ...existing, updatedAt: existing.updatedAt.toISOString() });
    }
    return res.json({
      id: 0,
      companyId,
      enabled: true,
      minConfidence: 0.5,
      enabledCategories: null,
      updatedAt: new Date().toISOString(),
    });
  } catch {
    return res.status(500).json({ error: "Failed to load opportunity settings" });
  }
});

// PATCH /opportunities/settings — owner-only.
router.patch("/settings", requireRole("owner"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const body = req.body ?? {};

    const updates: Partial<typeof opportunitySettingsTable.$inferInsert> = {};
    if (typeof body.enabled === "boolean") updates.enabled = body.enabled;
    if (typeof body.minConfidence === "number") {
      if (body.minConfidence < 0 || body.minConfidence > 1) {
        return res.status(400).json({ error: "minConfidence must be between 0 and 1" });
      }
      updates.minConfidence = body.minConfidence;
    }
    if (body.enabledCategories === null) {
      updates.enabledCategories = null;
    } else if (Array.isArray(body.enabledCategories)) {
      const cats = body.enabledCategories.filter(
        (c: unknown): c is OpportunityCategory =>
          typeof c === "string" && OPPORTUNITY_CATEGORIES.includes(c as OpportunityCategory),
      );
      if (cats.length !== body.enabledCategories.length) {
        return res.status(400).json({ error: "Invalid category in enabledCategories" });
      }
      updates.enabledCategories = cats;
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid settings provided" });
    }
    updates.updatedAt = new Date();

    const [existing] = await db
      .select()
      .from(opportunitySettingsTable)
      .where(eq(opportunitySettingsTable.companyId, companyId))
      .limit(1);

    const [row] = existing
      ? await db
          .update(opportunitySettingsTable)
          .set(updates)
          .where(eq(opportunitySettingsTable.companyId, companyId))
          .returning()
      : await db
          .insert(opportunitySettingsTable)
          .values({ companyId, ...updates })
          .returning();

    return res.json({ ...row, updatedAt: row.updatedAt.toISOString() });
  } catch {
    return res.status(500).json({ error: "Failed to update opportunity settings" });
  }
});

// POST /opportunities/resynthesize — owner-only catch-up trigger.
// Re-runs opportunity synthesis for every completed analysis result belonging
// to the caller's company. Safe to call multiple times — synthesis is
// idempotent (strengthens existing open opportunities rather than duplicating).
// Scoped strictly to the caller's company; owners cannot touch other tenants.
router.post("/resynthesize", requireRole("owner"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);

    const rows = await db
      .select({
        id: analysisResultsTable.id,
        inspectionId: analysisResultsTable.inspectionId,
        findings: analysisResultsTable.findings,
      })
      .from(analysisResultsTable)
      .where(eq(analysisResultsTable.companyId, companyId));

    const eligible = rows.filter((r) => Array.isArray(r.findings) && r.findings.length > 0);

    let processed = 0;
    let failed = 0;
    const errors: { analysisId: number; error: string }[] = [];

    for (const row of eligible) {
      try {
        await runOpportunitySynthesisCore({
          companyId,
          inspectionId: row.inspectionId,
          findings: row.findings as Parameters<typeof runOpportunitySynthesisCore>[0]["findings"],
        });
        processed++;
      } catch (err) {
        failed++;
        errors.push({
          analysisId: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return res.json({ total: eligible.length, processed, failed, errors });
  } catch {
    return res.status(500).json({ error: "Failed to resynthesize opportunities" });
  }
});

// GET /opportunities/:id — detail with audit trail; the view itself is audited.
router.get("/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [row] = await db
      .select()
      .from(opportunitiesTable)
      .where(and(eq(opportunitiesTable.id, id), eq(opportunitiesTable.companyId, companyId)))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Opportunity not found" });

    await db.insert(opportunityEventsTable).values({
      companyId,
      opportunityId: id,
      userId: req.user!.id,
      action: "viewed",
      detail: null,
    });

    const events = await db
      .select()
      .from(opportunityEventsTable)
      .where(
        and(
          eq(opportunityEventsTable.opportunityId, id),
          eq(opportunityEventsTable.companyId, companyId),
        ),
      )
      .orderBy(desc(opportunityEventsTable.createdAt))
      .limit(50);

    return res.json({ ...serializeOpportunity(row), events: events.map(serializeEvent) });
  } catch {
    return res.status(500).json({ error: "Failed to load opportunity" });
  }
});

// PATCH /opportunities/:id — status changes + assignment.
// Sales can move the pipeline (new → reviewed → quoted → won) and assign;
// DISMISSING requires manager or owner.
router.patch("/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const body = req.body ?? {};

    const [existing] = await db
      .select()
      .from(opportunitiesTable)
      .where(and(eq(opportunitiesTable.id, id), eq(opportunitiesTable.companyId, companyId)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Opportunity not found" });

    const updates: Partial<typeof opportunitiesTable.$inferInsert> = {};
    const events: {
      action: "status_changed" | "assigned" | "value_set";
      detail: Record<string, unknown>;
    }[] = [];

    // HUMAN-ONLY dollars: estimatedAnnualValue is entered by sales/management
    // when they actually price the work. The AI has no write path to this
    // field (synthesis/strengthen never touch it).
    if (body.estimatedAnnualValue !== undefined) {
      if (body.estimatedAnnualValue === null) {
        updates.estimatedAnnualValue = null;
        events.push({ action: "value_set", detail: { estimatedAnnualValue: null } });
      } else if (
        typeof body.estimatedAnnualValue === "number" &&
        Number.isInteger(body.estimatedAnnualValue) &&
        body.estimatedAnnualValue >= 0 &&
        body.estimatedAnnualValue <= 10_000_000
      ) {
        updates.estimatedAnnualValue = body.estimatedAnnualValue;
        events.push({
          action: "value_set",
          detail: { estimatedAnnualValue: body.estimatedAnnualValue },
        });
      } else {
        return res
          .status(400)
          .json({ error: "estimatedAnnualValue must be a whole dollar amount or null" });
      }
    }

    if (body.status !== undefined) {
      const status = body.status as OpportunityStatus;
      if (!OPPORTUNITY_STATUSES.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      // Closing an opportunity negatively (dismissed / lost) is a manager+
      // decision — sales moves the pipeline forward, management closes it.
      if (
        (status === "dismissed" || status === "lost") &&
        req.user!.role !== "manager" &&
        req.user!.role !== "owner"
      ) {
        return res
          .status(403)
          .json({ error: "Only managers can dismiss or mark opportunities lost" });
      }
      if (status !== existing.status) {
        updates.status = status;
        events.push({
          action: "status_changed",
          detail: { from: existing.status, to: status },
        });
      }
    }

    if (body.assignedToUserId !== undefined) {
      if (body.assignedToUserId === null) {
        updates.assignedToUserId = null;
        events.push({ action: "assigned", detail: { assignedToUserId: null } });
      } else if (typeof body.assignedToUserId === "number") {
        // Assignee must belong to the same company — never leak users across tenants.
        const [assignee] = await db
          .select({ id: usersTable.id })
          .from(usersTable)
          .where(
            and(
              eq(usersTable.id, body.assignedToUserId),
              eq(usersTable.companyId, companyId),
            ),
          )
          .limit(1);
        if (!assignee) return res.status(400).json({ error: "Invalid assignee" });
        updates.assignedToUserId = assignee.id;
        events.push({ action: "assigned", detail: { assignedToUserId: assignee.id } });
      } else {
        return res.status(400).json({ error: "Invalid assignee" });
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid updates provided" });
    }
    updates.updatedAt = new Date();

    const [row] = await db
      .update(opportunitiesTable)
      .set(updates)
      .where(and(eq(opportunitiesTable.id, id), eq(opportunitiesTable.companyId, companyId)))
      .returning();

    for (const event of events) {
      await db.insert(opportunityEventsTable).values({
        companyId,
        opportunityId: id,
        userId: req.user!.id,
        action: event.action,
        detail: event.detail,
      });
    }

    return res.json(serializeOpportunity(row));
  } catch {
    return res.status(500).json({ error: "Failed to update opportunity" });
  }
});

// GET /opportunities/:id/notes — the immutable notes thread (oldest first).
router.get("/:id/notes", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [opportunity] = await db
      .select({ id: opportunitiesTable.id })
      .from(opportunitiesTable)
      .where(and(eq(opportunitiesTable.id, id), eq(opportunitiesTable.companyId, companyId)))
      .limit(1);
    if (!opportunity) return res.status(404).json({ error: "Opportunity not found" });

    // Note: users have no display-name column (identity lives in Clerk), so
    // the thread shows the author's role + stable user id.
    const rows = await db
      .select()
      .from(opportunityNotesTable)
      .where(
        and(
          eq(opportunityNotesTable.opportunityId, id),
          eq(opportunityNotesTable.companyId, companyId),
        ),
      )
      .orderBy(opportunityNotesTable.createdAt);
    return res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
  } catch {
    return res.status(500).json({ error: "Failed to load notes" });
  }
});

// POST /opportunities/:id/notes — append-only: corrections are new notes,
// never edits, so the thread stays an accountable record.
router.post("/:id/notes", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body) return res.status(400).json({ error: "Note body is required" });
    if (body.length > 4000) return res.status(400).json({ error: "Note too long" });

    const [opportunity] = await db
      .select({ id: opportunitiesTable.id })
      .from(opportunitiesTable)
      .where(and(eq(opportunitiesTable.id, id), eq(opportunitiesTable.companyId, companyId)))
      .limit(1);
    if (!opportunity) return res.status(404).json({ error: "Opportunity not found" });

    const [note] = await db
      .insert(opportunityNotesTable)
      .values({
        companyId,
        opportunityId: id,
        authorUserId: req.user!.id,
        authorRole: req.user!.role,
        body,
      })
      .returning();

    await db.insert(opportunityEventsTable).values({
      companyId,
      opportunityId: id,
      userId: req.user!.id,
      action: "note_added",
      detail: { noteId: note.id },
    });

    return res.status(201).json({ ...note, createdAt: note.createdAt.toISOString() });
  } catch {
    return res.status(500).json({ error: "Failed to add note" });
  }
});

export default router;
