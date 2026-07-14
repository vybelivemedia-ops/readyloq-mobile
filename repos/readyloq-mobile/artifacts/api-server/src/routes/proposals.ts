import { Router, type IRouter } from "express";
import {
  db,
  salesProposalsTable,
  opportunitiesTable,
  PROPOSAL_STATUSES,
  type ProposalStatus,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";

/**
 * Sales Proposals — human-assembled bundles of opportunities per property.
 *
 * SECURITY: mounted behind `requireAuth + requireCompany +
 * requireRole("sales")` (see routes/index.ts) — same audience as the
 * Opportunity Log it draws from. Technicians get 403 at the API layer.
 *
 * NO AI here: sales picks the opportunities, writes the intro, and prices
 * the work themselves. `opportunityIds` is jsonb (no FK), so EVERY write
 * that touches the list re-validates same-company ownership.
 */

const router: IRouter = Router();

const MAX_OPPORTUNITIES = 50;

function serialize(row: typeof salesProposalsTable.$inferSelect) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Validate a client-supplied opportunityIds payload: unique positive ints
 * that ALL resolve to this company's opportunities. Returns null on any
 * violation — the caller rejects the whole write (no silent dropping).
 */
async function validateOpportunityIds(
  companyId: number,
  raw: unknown,
): Promise<number[] | null> {
  if (!Array.isArray(raw)) return null;
  const ids = Array.from(
    new Set(
      raw.filter((v): v is number => typeof v === "number" && Number.isInteger(v) && v > 0),
    ),
  );
  if (ids.length !== new Set(raw).size || raw.some((v) => typeof v !== "number")) return null;
  if (ids.length > MAX_OPPORTUNITIES) return null;
  if (ids.length === 0) return [];
  const rows = await db
    .select({ id: opportunitiesTable.id })
    .from(opportunitiesTable)
    .where(
      and(eq(opportunitiesTable.companyId, companyId), inArray(opportunitiesTable.id, ids)),
    );
  if (rows.length !== ids.length) return null;
  return ids;
}

// GET /proposals — newest first, optional status filter.
router.get("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const conditions = [eq(salesProposalsTable.companyId, companyId)];
    if (status && PROPOSAL_STATUSES.includes(status as ProposalStatus)) {
      conditions.push(eq(salesProposalsTable.status, status as ProposalStatus));
    }
    const rows = await db
      .select()
      .from(salesProposalsTable)
      .where(and(...conditions))
      .orderBy(desc(salesProposalsTable.updatedAt));
    return res.json(rows.map(serialize));
  } catch {
    return res.status(500).json({ error: "Failed to list proposals" });
  }
});

// POST /proposals — assemble a proposal from opportunity IDs.
router.post("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const body = req.body ?? {};

    const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
    const propertyAddress =
      typeof body.propertyAddress === "string" ? body.propertyAddress.trim().slice(0, 300) : "";
    if (!title) return res.status(400).json({ error: "Title is required" });
    if (!propertyAddress) return res.status(400).json({ error: "Property address is required" });

    const opportunityIds = await validateOpportunityIds(companyId, body.opportunityIds ?? []);
    if (opportunityIds === null) {
      return res.status(400).json({ error: "Invalid opportunity IDs" });
    }
    if (opportunityIds.length === 0) {
      return res.status(400).json({ error: "Select at least one opportunity" });
    }

    const intro =
      typeof body.intro === "string" && body.intro.trim().length > 0
        ? body.intro.trim().slice(0, 4000)
        : null;
    const notes =
      typeof body.notes === "string" && body.notes.trim().length > 0
        ? body.notes.trim().slice(0, 4000)
        : null;

    const [row] = await db
      .insert(salesProposalsTable)
      .values({
        companyId,
        title,
        propertyAddress,
        opportunityIds,
        intro,
        notes,
        status: "draft",
        createdByUserId: req.user!.id,
      })
      .returning();
    return res.status(201).json(serialize(row));
  } catch {
    return res.status(500).json({ error: "Failed to create proposal" });
  }
});

// GET /proposals/:id — detail with the resolved opportunities (evidence view).
router.get("/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [row] = await db
      .select()
      .from(salesProposalsTable)
      .where(and(eq(salesProposalsTable.id, id), eq(salesProposalsTable.companyId, companyId)))
      .limit(1);
    if (!row) return res.status(404).json({ error: "Proposal not found" });

    const opportunities =
      row.opportunityIds.length > 0
        ? await db
            .select()
            .from(opportunitiesTable)
            .where(
              and(
                eq(opportunitiesTable.companyId, companyId),
                inArray(opportunitiesTable.id, row.opportunityIds),
              ),
            )
        : [];

    return res.json({
      ...serialize(row),
      opportunities: opportunities.map((o) => ({
        ...o,
        createdAt: o.createdAt.toISOString(),
        updatedAt: o.updatedAt.toISOString(),
      })),
    });
  } catch {
    return res.status(500).json({ error: "Failed to load proposal" });
  }
});

// PATCH /proposals/:id — edit content / move the paperwork status.
router.patch("/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const body = req.body ?? {};

    const [existing] = await db
      .select()
      .from(salesProposalsTable)
      .where(and(eq(salesProposalsTable.id, id), eq(salesProposalsTable.companyId, companyId)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Proposal not found" });

    const updates: Partial<typeof salesProposalsTable.$inferInsert> = {};

    if (body.title !== undefined) {
      const title = typeof body.title === "string" ? body.title.trim().slice(0, 200) : "";
      if (!title) return res.status(400).json({ error: "Title cannot be empty" });
      updates.title = title;
    }
    if (body.intro !== undefined) {
      if (body.intro === null) updates.intro = null;
      else if (typeof body.intro === "string") updates.intro = body.intro.trim().slice(0, 4000);
      else return res.status(400).json({ error: "Invalid intro" });
    }
    if (body.notes !== undefined) {
      if (body.notes === null) updates.notes = null;
      else if (typeof body.notes === "string") updates.notes = body.notes.trim().slice(0, 4000);
      else return res.status(400).json({ error: "Invalid notes" });
    }
    if (body.opportunityIds !== undefined) {
      const ids = await validateOpportunityIds(companyId, body.opportunityIds);
      if (ids === null) return res.status(400).json({ error: "Invalid opportunity IDs" });
      if (ids.length === 0) {
        return res.status(400).json({ error: "A proposal needs at least one opportunity" });
      }
      updates.opportunityIds = ids;
    }
    if (body.status !== undefined) {
      const status = body.status as ProposalStatus;
      if (!PROPOSAL_STATUSES.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      updates.status = status;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No valid updates provided" });
    }
    updates.updatedAt = new Date();

    const [row] = await db
      .update(salesProposalsTable)
      .set(updates)
      .where(and(eq(salesProposalsTable.id, id), eq(salesProposalsTable.companyId, companyId)))
      .returning();
    return res.json(serialize(row));
  } catch {
    return res.status(500).json({ error: "Failed to update proposal" });
  }
});

// DELETE /proposals/:id — drafts only; sent/decided proposals are records.
router.delete("/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [existing] = await db
      .select()
      .from(salesProposalsTable)
      .where(and(eq(salesProposalsTable.id, id), eq(salesProposalsTable.companyId, companyId)))
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Proposal not found" });
    if (existing.status !== "draft") {
      return res.status(409).json({ error: "Only draft proposals can be deleted" });
    }

    await db
      .delete(salesProposalsTable)
      .where(and(eq(salesProposalsTable.id, id), eq(salesProposalsTable.companyId, companyId)));
    return res.status(204).send();
  } catch {
    return res.status(500).json({ error: "Failed to delete proposal" });
  }
});

export default router;
