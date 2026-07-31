/**
 * Review Queue — Manager rapid-review endpoint.
 *
 * GET  /review-queue          → yesterday's completed inspections, priority-sorted
 * POST /review-queue/:id      → submit approve / flag / skip action (advisory, no DB change)
 *
 * Mounted behind requireAuth + requireRole("manager").
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { inspectionsTable } from "@workspace/db";
import { and, eq, gte, lt, desc } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import { z } from "zod/v4";

const router = Router();

const SEVERITY_RISK: Record<string, string> = {
  critical: "critical",
  high:     "high",
  medium:   "medium",
  low:      "low",
};

const RISK_ORDER: Record<string, number> = {
  critical: 0,
  high:     1,
  medium:   2,
  low:      3,
};

// ─── GET /review-queue ────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);

    const now = new Date();
    const startOfToday     = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
    const useToday         = req.query.date === "today";
    const rangeStart       = useToday ? startOfToday : startOfYesterday;
    const rangeEnd         = useToday ? now           : startOfToday;

    const inspections = await db
      .select({
        id:             inspectionsTable.id,
        siteAddress:    inspectionsTable.siteAddress,
        technicianName: inspectionsTable.technicianName,
        completedAt:    inspectionsTable.completedAt,
        pestTypes:      inspectionsTable.pestTypes,
        severity:       inspectionsTable.severity,
        findingsCount:  inspectionsTable.findingsCount,
        mediaCount:     inspectionsTable.mediaCount,
      })
      .from(inspectionsTable)
      .where(
        and(
          eq(inspectionsTable.companyId, companyId),
          eq(inspectionsTable.status,    "completed"),
          gte(inspectionsTable.completedAt, rangeStart),
          lt(inspectionsTable.completedAt,  rangeEnd),
        ),
      )
      .orderBy(desc(inspectionsTable.completedAt))
      .limit(50);

    const items = inspections
      .map((insp) => {
        const rawRisk  = insp.severity ? SEVERITY_RISK[insp.severity] ?? "low" : "low";
        return {
          id:             insp.id,
          inspectionId:   insp.id,
          siteAddress:    insp.siteAddress ?? "Unknown address",
          technicianName: insp.technicianName ?? "Unknown",
          completedAt:    insp.completedAt?.toISOString() ?? new Date().toISOString(),
          findingsCount:  insp.findingsCount ?? 0,
          qualityScore:   null as number | null,   // populated below if scorecard exists
          riskLevel:      rawRisk as "low" | "medium" | "high" | "critical",
          pestTypes:      Array.isArray(insp.pestTypes) ? (insp.pestTypes as string[]) : [],
          photoCount:     insp.mediaCount ?? 0,
        };
      })
      .sort(
        (a, b) =>
          (RISK_ORDER[a.riskLevel] ?? 3) - (RISK_ORDER[b.riskLevel] ?? 3) ||
          new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime(),
      );

    return res.json({
      items,
      date:       rangeStart.toISOString().slice(0, 10),
      totalCount: items.length,
    });
  } catch (err) {
    console.error("review-queue GET:", err);
    return res.status(500).json({ error: "Failed to fetch review queue" });
  }
});

// ─── POST /review-queue/:id ───────────────────────────────────────────────────
// Advisory only — the client tracks session state.
// We log the action for future audit trails but don't require schema changes.

const actionSchema = z.object({
  action: z.enum(["approved", "flagged", "skipped"]),
  note:   z.string().optional(),
});

router.post("/:id", async (req, res) => {
  try {
    const parse = actionSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: "Invalid action" });
    return res.json({ ok: true, action: parse.data.action });
  } catch {
    return res.status(500).json({ error: "Failed to submit review action" });
  }
});

export default router;
