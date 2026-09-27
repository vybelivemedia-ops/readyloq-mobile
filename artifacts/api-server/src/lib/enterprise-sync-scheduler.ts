import cron from "node-cron";
import { db, companyFieldIntegrationsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";
import {
  pollPestPacInbound,
  processPendingPestPacMessages,
  isPestPacBidirectionalSyncEnabled,
} from "../services/integration/pestpac-sync";
import { OutboxProcessor } from "../services/integration/outbox-processor";

let workersRunning = false;
let pollRunning = false;

async function runWorkers(): Promise<void> {
  if (workersRunning) return;
  workersRunning = true;
  try {
    const [pestPac, outbox] = await Promise.all([
      isPestPacBidirectionalSyncEnabled()
        ? processPendingPestPacMessages({ limit: 50 })
        : Promise.resolve({ claimed: 0, succeeded: 0, failed: 0 }),
      OutboxProcessor.processPendingRetries({ limit: 25 }),
    ]);
    if (pestPac.claimed > 0 || outbox.claimed > 0) {
      logger.info({ pestPac, outbox }, "[enterprise-sync] queue pass complete");
    }
  } catch (err) {
    logger.error({ err }, "[enterprise-sync] queue pass failed");
  } finally {
    workersRunning = false;
  }
}

async function pollEnabledPestPacCompanies(): Promise<void> {
  if (!isPestPacBidirectionalSyncEnabled()) return;
  if (pollRunning) return;
  pollRunning = true;
  try {
    const configs = await db
      .select({ companyId: companyFieldIntegrationsTable.companyId })
      .from(companyFieldIntegrationsTable)
      .where(
        and(
          eq(companyFieldIntegrationsTable.systemType, "pestpac"),
          eq(companyFieldIntegrationsTable.enabled, true),
        ),
      );
    const results = await Promise.allSettled(
      configs.map(({ companyId }) => pollPestPacInbound(companyId)),
    );
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        logger.warn(
          { companyId: configs[index]?.companyId, err: result.reason },
          "[enterprise-sync] PestPac poll failed",
        );
      }
    });
  } catch (err) {
    logger.error({ err }, "[enterprise-sync] PestPac polling pass failed");
  } finally {
    pollRunning = false;
  }
}

/** Register durable workers once after the API starts listening. */
export function startEnterpriseSyncScheduler(): void {
  cron.schedule("* * * * *", () => {
    void runWorkers();
  });
  cron.schedule("*/5 * * * *", () => {
    void pollEnabledPestPacCompanies();
  });
  // Recover crash-left queue rows promptly without initiating an external poll
  // during startup.
  void runWorkers();
  logger.info(
    { pestPacBidirectionalEnabled: isPestPacBidirectionalSyncEnabled() },
    "[enterprise-sync] queue worker and PestPac poller registered",
  );
}
