// Agent Zero tick — production Scheduled Deployment entry point.
// In development the in-process worker inside the API server handles the loop;
// in production this job can run on a schedule to release approved jobs and
// drain the queue even if the web deployment recycles.

import { logger } from "../lib/logger";
import { startAgentZeroWorker, getWorkerHealth } from "../services/agentZero";

const DRAIN_MS = 4 * 60 * 1000; // run for up to 4 minutes per scheduled invocation

async function main(): Promise<void> {
  logger.info("Agent Zero scheduled tick starting");
  startAgentZeroWorker();
  await new Promise((resolve) => setTimeout(resolve, DRAIN_MS));
  logger.info({ worker: getWorkerHealth() }, "Agent Zero scheduled tick finished");
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Agent Zero scheduled tick failed");
  process.exit(1);
});
