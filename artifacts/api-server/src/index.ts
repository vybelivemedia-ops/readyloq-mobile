import app from "./app";
import { logger } from "./lib/logger";
import { ensureClerkNativeRedirectUrls } from "./lib/clerk-redirect-urls";
import { ensureProductsSeed } from "@workspace/db";
import { ensureDevFixtures } from "./seed/dev-fixtures";
import { runMigrations } from "stripe-replit-sync";
import { getStripeSync } from "./lib/stripeClient";
import { backfillOpportunityValues } from "./lib/backfill-opportunity-values";
import { backfillPropertyMemory } from "./lib/backfill-property-memory";
import { migratePushNotificationColumns } from "./lib/migrate-push-notifications";
import { migrateSyncLogs } from "./lib/migrate-sync-logs";
import { migrateBriefingEmailColumn } from "./lib/migrate-briefing-email";
import { migrateAnalysisErrors } from "./lib/migrate-analysis-errors";
import { migrateAnalysisFailureReason } from "./lib/migrate-analysis-failure-reason";
import { migrateAnalysisPhotoOutcomes } from "./lib/migrate-analysis-photo-outcomes";
import { migrateAnalysisProviderGuard } from "./lib/migrate-analysis-provider-guard";
import { migrateScheduleIndex } from "./lib/migrate-schedule-index";
import { migrateInventoryTables } from "./lib/migrate-inventory";
import { migrateWarehouseTables } from "./lib/migrate-warehouse";
import { migrateLedgerImmutability } from "./lib/migrate-ledger-immutability";
import { migrateInspectionUnitNumbers } from "./lib/migrate-inspection-unit-numbers";
import { migratePredictiveRestocking } from "./lib/migrate-predictive-restocking";
import { migrateEnterpriseSync } from "./lib/migrate-enterprise-sync";
import { migrateMissionControl } from "./lib/migrate-mission-control";
import { migrateBaitStationIdempotency } from "./lib/migrate-bait-station-idempotency";
import { migrateInspectionUploadIntents } from "./lib/migrate-inspection-upload-intents";
import { migratePropertyFoundation } from "./lib/migrate-property-foundation";
import { startMissionControlAgentWorker } from "./lib/mission-control-worker";
import { startBriefingScheduler } from "./lib/briefing-scheduler";
import { startPredictiveRestockScheduler } from "./lib/predictive-restocking-scheduler";
import { startEnterpriseSyncScheduler } from "./lib/enterprise-sync-scheduler";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function startup() {
  // ── Schema migration (blocking) ──────────────────────────────────────────────
  // Must complete before the HTTP listener binds so no request can hit
  // column-dependent endpoints with a missing schema.
  await migratePushNotificationColumns();
  await migrateSyncLogs();
  await migrateBriefingEmailColumn();
  await migrateAnalysisErrors();
  await migrateAnalysisFailureReason();
  await migrateAnalysisPhotoOutcomes();
  await migrateAnalysisProviderGuard();
  await migrateScheduleIndex();
  await migrateInventoryTables();
  await migrateWarehouseTables();
  await migrateLedgerImmutability();
  await migrateInspectionUnitNumbers();
  await migratePredictiveRestocking();
  await migrateEnterpriseSync();
  await migrateMissionControl();
  await migrateBaitStationIdempotency();
  await migrateInspectionUploadIntents();
  await migratePropertyFoundation();
  startMissionControlAgentWorker();

  // ── Development fixture seed (blocking) ──────────────────────────────────────
  // Runs BEFORE the HTTP listener binds so the fixture company exists the moment
  // the server accepts requests (no race between startup seed and first test call).
  // Gated on REPLIT_DEPLOYMENT (absent in dev) AND DEV_FIXTURE_SECRET (present
  // only when e2e tests are configured) — both must hold for the seed to run.
  if (!process.env.REPLIT_DEPLOYMENT && process.env.DEV_FIXTURE_SECRET) {
    await ensureDevFixtures().catch((err) => {
      logger.warn({ err }, "Dev fixture seed failed — e2e role tests may need manual setup");
    });
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");

    // Initialize Stripe schema, webhook, and data backfill.
    void initStripe();

    // Backfill estimatedAnnualValue for legacy opportunities that were created
    // before the tier-fallback fix. Idempotent — only updates NULL rows.
    void backfillOpportunityValues().catch((err) => {
      logger.warn({ err }, "Opportunity value backfill failed — pipeline totals may be incomplete");
    });

    // Backfill property_memory rows for completed inspections that predate the
    // automatic memory-write pipeline.  Idempotent — skips addresses that
    // already have a memory row.
    void backfillPropertyMemory().catch((err) => {
      logger.warn({ err }, "Property memory backfill failed — Prior Visit banner may be empty for legacy inspections");
    });

    // Idempotent product catalogue seed — inserts any missing seed products on
    // startup. Safe to run every boot; skips rows that already exist.
    void ensureProductsSeed().catch((seedErr) => {
      logger.warn({ err: seedErr }, "Product seed failed — catalogue may be incomplete");
    });

    // Start the daily 07:00 UTC briefing email scheduler.
    startBriefingScheduler();

    // Start the periodic predictive-restock recompute job (Task #918) — the
    // adaptive forecast is also recomputed event-triggered (right after each
    // treatment-log deduction), but a periodic sweep keeps technician/product
    // pairs with no recent deduction activity (e.g. driven purely by a newly
    // scheduled route) from going stale. GET /manager/predictive-restocks
    // itself is a pure read so a dismissed recommendation doesn't reappear
    // mid-session just from the manager refreshing the page.
    startPredictiveRestockScheduler();
    startEnterpriseSyncScheduler();

    // Fire-and-forget: register native OAuth redirect URLs with Clerk so
    // Google sign-in works in the standalone mobile app (production
    // instances enforce a redirect allowlist; dev instances do not).
    void ensureClerkNativeRedirectUrls();
  });
}

void startup().catch((err) => {
  logger.error({ err }, "Fatal startup error — server did not start");
  process.exit(1);
});

async function initStripe() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.warn("DATABASE_URL not set — skipping Stripe initialization");
    return;
  }
  try {
    logger.info("Initializing Stripe schema...");
    await runMigrations({ databaseUrl });
    logger.info("Stripe schema ready");

    const stripeSync = await getStripeSync();
    const webhookBaseUrl = `https://${(process.env.REPLIT_DOMAINS ?? "").split(",")[0]}`;
    await stripeSync.findOrCreateManagedWebhook(`${webhookBaseUrl}/api/stripe/webhook`);
    logger.info("Stripe webhook configured");

    // Run backfill async — don't block server startup
    void stripeSync.syncBackfill({ object: "all" } as Parameters<typeof stripeSync.syncBackfill>[0]).then(() => {
      logger.info("Stripe data backfill complete");
    }).catch((err) => {
      logger.warn({ err }, "Stripe backfill failed — data may be stale");
    });
  } catch (err) {
    logger.warn({ err }, "Stripe initialization failed — billing features unavailable");
  }
}
