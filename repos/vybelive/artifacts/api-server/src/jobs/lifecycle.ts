import { logger } from "../lib/logger.js";
import { runAccountLifecycleSweep } from "../services/accountLifecycle.js";

// ── Account lifecycle worker ────────────────────────────────────────────────
// Standalone entry point intended to run on a daily schedule (e.g. a Replit
// Scheduled Deployment). It performs one full lifecycle sweep:
//   - sends grace-period deletion reminders (day 25)
//   - hard-deletes accounts whose 30-day grace has elapsed
//   - warns inactive accounts (day 175), suspends them (day 180),
//     sends a final notice (day 205), and deletes them (day 210)
//
// Run with `pnpm --filter @workspace/api-server run jobs:lifecycle`.
// The process exits 0 on success and 1 on failure so the scheduler can
// surface errors.

async function main(): Promise<void> {
  const startedAt = Date.now();
  logger.info("Account lifecycle sweep starting");

  const result = await runAccountLifecycleSweep();

  logger.info(
    {
      ...result,
      durationMs: Date.now() - startedAt,
    },
    "Account lifecycle sweep complete",
  );
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    logger.error({ err }, "Account lifecycle sweep failed");
    process.exit(1);
  });
