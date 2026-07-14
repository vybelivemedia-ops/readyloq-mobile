// Scheduled social posts tick — production Scheduled Deployment entry point.
// In development the in-process worker inside the API server handles the loop;
// in production this job can run on a schedule to publish due scheduled social
// posts even if the web deployment recycles.
//
// Run with `pnpm --filter @workspace/api-server run jobs:scheduled-posts-tick`.
// Exits 0 on success and 1 on failure so the scheduler can surface errors.

import { logger } from "../lib/logger.js";
import { runDueScheduledPosts } from "../services/scheduledPostPublisher.js";

async function main(): Promise<void> {
  logger.info("Scheduled posts tick starting");
  const result = await runDueScheduledPosts();
  logger.info(result, "Scheduled posts tick complete");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "Scheduled posts tick failed");
    process.exit(1);
  });
