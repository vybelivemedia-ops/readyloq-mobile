import { db, weeklyReviewsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { runAutonomousCycle, runReflection } from "../services/autonomyEngine.js";
import { runWeeklyLearningReview, startOfWeekUTC } from "../services/executiveLearning.js";

// ── Autonomy worker (Mission Control V7) ────────────────────────────────────
// Standalone entry point intended to run on a 15-minute schedule in production
// (a Replit Scheduled Deployment). There is NO dev polling: in development the
// founder triggers cycles manually via the "Run Autonomous Cycle" button.
//
// Each tick:
//   1. Runs one autonomous Chief-of-Staff cycle (trigger = "scheduled").
//   2. Once per ISO week, runs Quinn's weekly executive learning review. The
//      review distributes lessons, so it is gated to run at most once per week
//      (the weekly_reviews row for the current week is the guard).
//
// Run with `pnpm --filter @workspace/api-server run jobs:autonomy-tick`.
// Exits 0 on success and 1 on failure so the scheduler can surface errors.

async function maybeRunWeeklyReview(): Promise<boolean> {
  const weekOf = startOfWeekUTC();
  const existing = await db
    .select({ id: weeklyReviewsTable.id })
    .from(weeklyReviewsTable)
    .where(eq(weeklyReviewsTable.weekOf, weekOf))
    .limit(1);
  if (existing.length > 0) return false;
  await runWeeklyLearningReview();
  return true;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  logger.info("Autonomy tick starting");

  const cycle = await runAutonomousCycle({ trigger: "scheduled" });

  // V8: Quinn's continuous thinking. After the operational cycle, run a
  // reflection pass — this records observations to the organization timeline and
  // may opportunistically spark an executive conversation or recommendations
  // when the company is quiet. A failed reflection must not fail the tick.
  let reflectionObservations = 0;
  let reflectionConversationStarted = false;
  let reflectionRecommendations = 0;
  let reflectionMemoriesAccumulated = 0;
  let reflectionPatternsDetected = 0;
  let reflectionRecommendationsEnriched = 0;
  try {
    const reflection = await runReflection();
    reflectionObservations = reflection.observations.length;
    reflectionConversationStarted = reflection.conversationStarted;
    reflectionRecommendations = reflection.recommendationsProposed;
    reflectionMemoriesAccumulated = reflection.memoriesAccumulated;
    reflectionPatternsDetected = reflection.patternsDetected;
    reflectionRecommendationsEnriched = reflection.recommendationsEnriched;
  } catch (err) {
    logger.error({ err }, "Autonomy tick: reflection failed");
  }

  let weeklyReviewRan = false;
  try {
    weeklyReviewRan = await maybeRunWeeklyReview();
  } catch (err) {
    // A failed weekly review must not fail the whole tick — the cycle already ran.
    logger.error({ err }, "Autonomy tick: weekly review failed");
  }

  logger.info(
    {
      status: cycle.status,
      actions: cycle.actions.length,
      escalations: cycle.escalations.length,
      reflectionObservations,
      reflectionConversationStarted,
      reflectionRecommendations,
      reflectionMemoriesAccumulated,
      reflectionPatternsDetected,
      reflectionRecommendationsEnriched,
      weeklyReviewRan,
      durationMs: Date.now() - startedAt,
    },
    "Autonomy tick complete",
  );
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, "Autonomy tick failed");
    process.exit(1);
  });
