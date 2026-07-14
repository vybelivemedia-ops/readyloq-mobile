// ─── Mission Control OS Layer — Executive Event Bridge (Phase 2) ──────────────
//
// The bridge wires subscriptions on the EventBus so that executives REACT to
// domain events instead of being called directly by other services.
//
// Phase 2 constraint — NO AUTONOMOUS EXECUTION:
//   Handlers log what *would* happen in Phase 3 (e.g. "CTO should review PR")
//   but never call runCapability(), dispatchJob(), or mutate any DB state.
//   The sole side-effects allowed here are:
//     • logger.info/warn lines describing the intended reaction
//     • StateEngine reads (no writes)
//     • Emitting follow-on OS events to the bus (bridging across domains)
//
// Pattern for Phase 3 migration:
//   Replace every "// Phase 3:" comment with the actual async call.

import { logger } from "../../lib/logger.js";
import type { OSSubscription } from "./types.js";
import { getEventBus } from "./EventBus.js";

// ─── Bridge registration ───────────────────────────────────────────────────────

let _subs: OSSubscription[] = [];

/**
 * Register all executive event subscriptions.
 * Called once by `initOSLayer()` after the bus and store are ready.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initExecutiveEventBridge(): void {
  if (_subs.length > 0) return;

  const bus = getEventBus();

  // ── GitHub → Engineering ──────────────────────────────────────────────────

  _subs.push(
    bus.subscribe("github.push", (event) => {
      const { repo, branch, commitCount, author, sha } = event.payload;
      logger.info(
        { repo, branch, commits: commitCount, author, sha, eventId: event.id },
        "exec-bridge [github.push] → CTO: new commits detected; engineering snapshot scheduled",
        // Phase 3: await getExecutionProviderRegistry().dispatch({ command: "ENGINEERING_SNAPSHOT", ... })
      );
    }),
  );

  _subs.push(
    bus.subscribe("github.pr.merged", (event) => {
      const { repo, prNumber, title, mergedBy } = event.payload;
      logger.info(
        { repo, prNumber, title, mergedBy, eventId: event.id },
        "exec-bridge [github.pr.merged] → CTO: PR merged; post-merge inspection queued",
        // Phase 3: trigger CTO capability run for code quality review
      );
    }),
  );

  _subs.push(
    bus.subscribe("github.workflow.completed", (event) => {
      const { repo, workflowName, conclusion, durationSeconds } = event.payload;
      if (conclusion === "failure") {
        logger.warn(
          { repo, workflow: workflowName, conclusion, durationSeconds, eventId: event.id },
          "exec-bridge [github.workflow.failed] → CTO: CI failure; blocker check triggered",
          // Phase 3: emit "mc.approval.created" if workflow failure blocks a deploy
        );
      } else {
        logger.info(
          { repo, workflow: workflowName, conclusion, eventId: event.id },
          "exec-bridge [github.workflow.completed] → Release Manager: CI passed; deploy gate cleared",
        );
      }
    }),
  );

  // ── EAS → Release Manager ─────────────────────────────────────────────────

  _subs.push(
    bus.subscribe("eas.build.completed", (event) => {
      const { buildId, platform, appVersion, artifactUrl } = event.payload;
      logger.info(
        { buildId, platform, appVersion, artifactUrl, eventId: event.id },
        "exec-bridge [eas.build.completed] → Release Manager: build ready; QA gate proposed",
        // Phase 3: emit "mc.approval.created" for deploy gate
      );
    }),
  );

  _subs.push(
    bus.subscribe("eas.build.failed", (event) => {
      const { buildId, platform, reason, logUrl } = event.payload;
      logger.warn(
        { buildId, platform, reason, logUrl, eventId: event.id },
        "exec-bridge [eas.build.failed] → CTO + Release Manager: build failure; investigation queued",
        // Phase 3: dispatch Agent Zero specialist for log analysis
      );
    }),
  );

  _subs.push(
    bus.subscribe("eas.update.published", (event) => {
      const { updateId, branch, runtimeVersion } = event.payload;
      logger.info(
        { updateId, branch, runtimeVersion, eventId: event.id },
        "exec-bridge [eas.update.published] → Product Manager: OTA update live; changelog ready",
        // Phase 3: notify Product exec to draft release notes
      );
    }),
  );

  // ── Stripe → CFO / Marketing ──────────────────────────────────────────────

  _subs.push(
    bus.subscribe("stripe.subscription.created", (event) => {
      const { subscriptionId, plan, interval, userId } = event.payload;
      logger.info(
        { subscriptionId, plan, interval, userId, eventId: event.id },
        "exec-bridge [stripe.subscription.created] → CFO: new subscription; MRR delta queued",
        // Phase 3: update CFO revenue tracker, notify Marketing for lifecycle email
      );
    }),
  );

  _subs.push(
    bus.subscribe("stripe.subscription.cancelled", (event) => {
      const { subscriptionId, plan, userId } = event.payload;
      logger.warn(
        { subscriptionId, plan, userId, eventId: event.id },
        "exec-bridge [stripe.subscription.cancelled] → CFO + Marketing: churn event; win-back campaign eligible",
        // Phase 3: trigger churn analysis capability on Marketing Director
      );
    }),
  );

  _subs.push(
    bus.subscribe("stripe.payment.failed", (event) => {
      const { paymentIntentId, customerId, amountCents } = event.payload;
      logger.warn(
        { paymentIntentId, customerId, amountCents, eventId: event.id },
        "exec-bridge [stripe.payment.failed] → CFO: payment failure; dunning flow required",
        // Phase 3: emit "mc.approval.created" category=money for dunning override
      );
    }),
  );

  // ── ReadyLoq → Product / CTO ──────────────────────────────────────────────

  _subs.push(
    bus.subscribe("readyloq.stream.health_changed", (event) => {
      const { sessionId, health, latencyMs, packetLossPercent } = event.payload;
      if (health === "critical") {
        logger.warn(
          { sessionId, health, latencyMs, packetLossPercent, eventId: event.id },
          "exec-bridge [readyloq.stream.health=critical] → CTO: critical stream degradation; incident log triggered",
          // Phase 3: dispatch incident specialist
        );
      }
    }),
  );

  _subs.push(
    bus.subscribe("readyloq.footage.captured", (event) => {
      const { sessionId, durationSeconds, autoHighlight, sizeBytes } = event.payload;
      if (autoHighlight) {
        logger.info(
          { sessionId, durationSeconds, sizeBytes, eventId: event.id },
          "exec-bridge [readyloq.footage.captured=highlight] → Product: auto-highlight ready; clip pipeline triggered",
          // Phase 3: dispatch AI clip generation job
        );
      }
    }),
  );

  // ── VYBE Live → Marketing / Product / CTO ────────────────────────────────

  _subs.push(
    bus.subscribe("vybe.stream.started", (event) => {
      const { streamId, userId, platforms, title } = event.payload;
      logger.info(
        { streamId, userId, platformCount: platforms.length, title, eventId: event.id },
        "exec-bridge [vybe.stream.started] → Marketing: stream live; social push candidate",
        // Phase 3: Marketing exec evaluates whether to amplify stream via social
      );
    }),
  );

  _subs.push(
    bus.subscribe("vybe.stream.ended", (event) => {
      const { streamId, durationMs, peakViewers, clipsGenerated } = event.payload;
      logger.info(
        { streamId, durationMs, peakViewers, clipsGenerated, eventId: event.id },
        "exec-bridge [vybe.stream.ended] → Product: analytics ready; clip review gated",
        // Phase 3: Product exec runs analytics summary for founder briefing
      );
    }),
  );

  _subs.push(
    bus.subscribe("vybe.stream.viewer_spike", (event) => {
      const { streamId, changePercent, direction, currentViewers } = event.payload;
      logger.info(
        { streamId, changePercent, direction, currentViewers, eventId: event.id },
        `exec-bridge [vybe.stream.viewer_spike=${direction}] → Marketing: engagement signal; trend capture candidate`,
        // Phase 3: Marketing exec considers highlight clip auto-publish
      );
    }),
  );

  _subs.push(
    bus.subscribe("vybe.clip.published", (event) => {
      const { clipId, userId, platforms, caption } = event.payload;
      logger.info(
        { clipId, userId, platformCount: platforms.length, captionLength: caption.length, eventId: event.id },
        "exec-bridge [vybe.clip.published] → Marketing: clip live; engagement tracking started",
        // Phase 3: schedule 24h check for clip performance
      );
    }),
  );

  _subs.push(
    bus.subscribe("vybe.creator.milestone", (event) => {
      const { creatorUsername, milestone, value } = event.payload;
      logger.info(
        { creatorUsername, milestone, value, eventId: event.id },
        "exec-bridge [vybe.creator.milestone] → Marketing + Product: milestone achieved; reward + press eligible",
        // Phase 3: Marketing exec drafts congratulatory touchpoint
      );
    }),
  );

  // ── Replit → CTO ──────────────────────────────────────────────────────────

  _subs.push(
    bus.subscribe("replit.deploy.published", (event) => {
      const { artifact, version, domain, sha } = event.payload as unknown as Record<string, unknown>;
      logger.info(
        { artifact, version, domain, eventId: event.id },
        "exec-bridge [replit.deploy.published] → CTO: production deployment; smoke test window open",
      );
      // Phase 10: persist deployment event for the learning layer
      import("@workspace/db")
        .then(({ db, deploymentEventsTable }) => {
          const { randomUUID } = require("node:crypto") as typeof import("node:crypto");
          return db.insert(deploymentEventsTable).values({
            id: randomUUID(),
            artifactId: typeof artifact === "string" ? artifact : "unknown",
            version: typeof version === "string" ? version : "",
            sha: typeof sha === "string" ? sha : "",
            trigger: "manual",
            success: true,
          });
        })
        .catch((err: unknown) => logger.warn({ err }, "exec-bridge: failed to persist deploy.published event"));
    }),
  );

  _subs.push(
    bus.subscribe("replit.deploy.failed", (event) => {
      const { artifact, phase, error, sha } = event.payload as unknown as Record<string, unknown>;
      logger.warn(
        { artifact, phase, error, eventId: event.id },
        "exec-bridge [replit.deploy.failed] → CTO: deploy failure; rollback gate required",
      );
      // Phase 10: persist deployment failure event
      import("@workspace/db")
        .then(({ db, deploymentEventsTable }) => {
          const { randomUUID } = require("node:crypto") as typeof import("node:crypto");
          return db.insert(deploymentEventsTable).values({
            id: randomUUID(),
            artifactId: typeof artifact === "string" ? artifact : "unknown",
            sha: typeof sha === "string" ? sha : "",
            trigger: "manual",
            success: false,
            phase: typeof phase === "string" ? phase : null,
            errorMessage: typeof error === "string" ? error.slice(0, 500) : null,
          });
        })
        .catch((err: unknown) => logger.warn({ err }, "exec-bridge: failed to persist deploy.failed event"));
    }),
  );

  _subs.push(
    bus.subscribe("replit.db.migrated", (event) => {
      const { tables, description } = event.payload;
      logger.info(
        { tables, description, eventId: event.id },
        "exec-bridge [replit.db.migrated] → CTO: schema change applied; data integrity check queued",
        // Phase 3: trigger DB health specialist
      );
    }),
  );

  // ── Objectives → all relevant execs ──────────────────────────────────────

  _subs.push(
    bus.subscribe("objective.needs_approval", (event) => {
      const { objective, reason, approvalId } = event.payload;
      logger.info(
        { objectiveId: objective.id, title: objective.title, reason, approvalId, eventId: event.id },
        "exec-bridge [objective.needs_approval] → Chief of Staff: approval gate; escalated to Founder",
        // Phase 3: Chief of Staff assembles decision context for Founder
      );
    }),
  );

  _subs.push(
    bus.subscribe("objective.completed", (event) => {
      const { objective } = event.payload;
      logger.info(
        { objectiveId: objective.id, title: objective.title, eventId: event.id },
        "exec-bridge [objective.completed] → all executives: objective closed; retrospective triggered",
        // Phase 3: schedule post-objective retrospective capability
      );
    }),
  );

  // ── Mission Control → Wildcard logger ─────────────────────────────────────

  _subs.push(
    bus.subscribe("mc.approval.created", (event) => {
      const { approvalId, reason, category, requestedBy } = event.payload;
      logger.info(
        { approvalId, reason, category, requestedBy, eventId: event.id },
        "exec-bridge [mc.approval.created] → Founder inbox: new approval awaiting decision",
      );
    }),
  );

  _subs.push(
    bus.subscribe("mc.approval.decided", (event) => {
      const { approvalId, decision, requestedBy } = event.payload;
      logger.info(
        { approvalId, decision, requestedBy, eventId: event.id },
        `exec-bridge [mc.approval.decided=${decision}] → originating executive: gate resolved`,
        // Phase 3: wake suspended Agent Zero job awaiting this approval
      );
    }),
  );

  logger.info(
    { subscriptions: _subs.length },
    "os/ExecutiveEventBridge: initialised",
  );
}

/** Remove all bridge subscriptions. Call during OS layer shutdown. */
export function shutdownExecutiveEventBridge(): void {
  for (const sub of _subs) sub.unsubscribe();
  _subs = [];
  logger.info("os/ExecutiveEventBridge: all subscriptions removed");
}

/** How many active bridge subscriptions are registered. */
export function bridgeSubscriptionCount(): number {
  return _subs.length;
}
