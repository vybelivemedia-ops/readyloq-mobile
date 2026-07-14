import { Router } from "express";
import { count } from "drizzle-orm";
import { db, betaWaitlistTable } from "@workspace/db";
import {
  MILESTONES,
  CURRENT_STAGE,
  CURRENT_FOCUS,
  NEXT_MILESTONE,
  OVERALL_PROGRESS,
  isStaleMilestone,
  getSummary,
} from "../config/roadmap.js";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";

const router = Router();

// GET /roadmap — public, no auth required
// Filters out stale milestones (past target date, not completed) from the public response.
router.get("/roadmap", async (_req, res) => {
  const [{ betaCount }] = await db.select({ betaCount: count() }).from(betaWaitlistTable);

  const staleMilestones = MILESTONES.filter(isStaleMilestone);
  const publicMilestones = MILESTONES.filter((m) => !isStaleMilestone(m));

  res.json({
    milestones: publicMilestones,
    betaCount: Number(betaCount),
    currentStage: CURRENT_STAGE,
    currentFocus: CURRENT_FOCUS,
    nextMilestone: NEXT_MILESTONE,
    overallProgress: OVERALL_PROGRESS,
    summary: getSummary(),
    staleCount: staleMilestones.length,
    lastUpdated: new Date().toISOString(),
  });
});

// GET /admin/roadmap — admin only
// Returns all milestones (including stale ones) with stale flags for admin review.
router.get("/admin/roadmap", requireAuth, requireAdmin, async (_req, res) => {
  const milestonesWithFlags = MILESTONES.map((m) => ({
    ...m,
    stale: isStaleMilestone(m),
  }));

  const staleMilestones = milestonesWithFlags.filter((m) => m.stale);

  res.json({
    milestones: milestonesWithFlags,
    staleCount: staleMilestones.length,
    staleTitles: staleMilestones.map((m) => m.title),
    staleDetails: staleMilestones.map((m) => ({
      id: m.id,
      phase: m.phase,
      title: m.title,
      targetDate: m.targetDate,
      status: m.status,
    })),
  });
});

export default router;
