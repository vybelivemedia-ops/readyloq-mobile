import { logger } from "./lib/logger";

// ── Pre-flight environment validation ────────────────────────────────────
// Validate all required secrets before importing the app (which loads the
// auth middleware — that module will also throw, but this gives a cleaner
// startup log with actionable guidance).

const SESSION_SECRET = process.env["SESSION_SECRET"];
if (!SESSION_SECRET) {
  logger.fatal(
    "SESSION_SECRET environment variable is not set. " +
      "Set it via Replit Secrets (Tools → Secrets). " +
      "Server will not start without a signing secret.",
  );
  process.exit(1);
}

if (SESSION_SECRET.length < 32) {
  logger.fatal(
    "SESSION_SECRET is too short (minimum 32 characters). " +
      "Use a long random string for production security.",
  );
  process.exit(1);
}

const rawPort = process.env["PORT"];
if (!rawPort) {
  logger.fatal("PORT environment variable is required but was not provided.");
  process.exit(1);
}

const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  logger.fatal(`Invalid PORT value: "${rawPort}"`);
  process.exit(1);
}

// ── OAuth redirect URI validation ─────────────────────────────────────────
// Run after SESSION_SECRET check so the logger is available.
// Never throws — individual providers degrade to 503 when unconfigured.
const { validateOAuthRedirectUris } = await import("./services/oauthRedirects.js");
validateOAuthRedirectUris(logger);

// ── Start server ──────────────────────────────────────────────────────────
// Import app after env validation so the auth middleware module-load check
// is guaranteed to succeed.
const { default: app } = await import("./app.js");

// ── First-run data seed ─────────────────────────────────────────────────────
// Populate Mission Control on the first boot of an empty database (e.g. a fresh
// production database after publish). Idempotent: only seeds when empty, never
// overwrites existing data. Non-fatal — the server still starts if it fails.
try {
  const { seedMissionControlIfEmpty } = await import("./jobs/seedMissionControl.js");
  await seedMissionControlIfEmpty();
} catch (err) {
  logger.error({ err }, "Mission Control first-run seed check failed (continuing)");
}

// ── Mission Control OS Layer ─────────────────────────────────────────────────
// Phase 2: Initialises the Event Bus (with EventStore persistence + replay),
// the Executive Event Bridge subscriptions, and the StateEngine listeners.
// Must run after the DB is available (seed above guarantees DB is reachable).
try {
  const { initOSLayer } = await import("./services/os/index.js");
  await initOSLayer();
} catch (err) {
  logger.error({ err }, "Mission Control OS layer init failed (continuing)");
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");

  // Agent Zero — Mission Control's execution engine. The in-process worker
  // claims queued jobs (CAS) and executes them step-by-step with checkpoints.
  void import("./services/agentZero")
    .then(({ startAgentZeroWorker }) => startAgentZeroWorker())
    .catch((err) => logger.error({ err }, "Failed to start Agent Zero worker"));

  // Scheduled social posts — publishes due posts from the Social Command Center
  // queue to their target platform via the founder's OAuth token.
  void import("./services/scheduledPostPublisher")
    .then(({ startScheduledPostsWorker }) => startScheduledPostsWorker())
    .catch((err) => logger.error({ err }, "Failed to start scheduled posts worker"));

  // Phase 8 — Autonomy scheduler: runs Quinn's CoS cycle every 5 minutes so
  // in-progress objectives always have an active Agent Zero job.
  void import("./services/autonomyEngine")
    .then(({ startAutonomyScheduler }) => startAutonomyScheduler(5 * 60 * 1000))
    .catch((err) => logger.error({ err }, "Failed to start autonomy scheduler"));

  // Phase 7 — Register Replit workspace execution provider with the OS registry.
  void Promise.all([
    import("./services/os/providers/ReplitProvider"),
    import("./services/os/ExecutionProviderRegistry"),
  ])
    .then(([{ ReplitProvider }, { getExecutionProviderRegistry }]) => {
      getExecutionProviderRegistry().register(ReplitProvider);
    })
    .catch((err) => logger.error({ err }, "Failed to register ReplitProvider"));
});
