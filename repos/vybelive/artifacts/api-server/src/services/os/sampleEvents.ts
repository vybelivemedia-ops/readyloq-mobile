// ─── Mission Control OS Layer — Sample Event Emitter (Phase 2 Demo) ───────────
//
// Emits one realistic sample event for each of the 10 event domains so that
// the EventBus, EventStore, and ExecutiveEventBridge can be exercised end-to-end
// without real third-party services.
//
// Called by:
//   POST /api/mission-control/os/events/sample?domain=<domain|all>
//
// No DB mutations outside of the os_events table (event store persistence).
// All domain identifiers are clearly labelled as synthetic (prefix "demo-").

import { randomUUID } from "node:crypto";
import { logger } from "../../lib/logger.js";
import { getEventBus } from "./EventBus.js";
import type { VYBEStreamPayload, VYBEPlatform } from "./events/index.js";

// ─── Per-domain sample emitters ───────────────────────────────────────────────

async function emitGitHub(correlationId: string): Promise<void> {
  const bus = getEventBus();

  const prId = randomUUID();
  const sha = Math.random().toString(16).slice(2, 10);

  // Simulate: push → PR merged chain sharing a correlationId
  await bus.emit(
    "github.push",
    {
      repo: "vybe-live/mobile",
      branch: "feat/event-bus-phase2",
      sha,
      commitCount: 3,
      author: "dev-bot",
      message: "feat(os): implement Phase 2 EventBus with typed domains",
      isDefaultBranch: false,
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );

  await bus.emit(
    "github.pr.opened",
    {
      repo: "vybe-live/mobile",
      prNumber: 42,
      title: "feat(os): Phase 2 Event Bus",
      author: "dev-bot",
      base: "main",
      head: "feat/event-bus-phase2",
      body: "Implements the full typed Event Bus with 10 domains, replay, and executive subscriptions.",
      additions: 1800,
      deletions: 50,
      changedFiles: 14,
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );

  await bus.emit(
    "github.pr.merged",
    {
      repo: "vybe-live/mobile",
      prNumber: 42,
      title: "feat(os): Phase 2 Event Bus",
      author: "dev-bot",
      base: "main",
      head: "feat/event-bus-phase2",
      body: "Implements the full typed Event Bus.",
      additions: 1800,
      deletions: 50,
      changedFiles: 14,
      mergedBy: "founder",
      mergedAt: new Date().toISOString(),
    },
    "os/sampleEvents",
    { priority: "high", correlationId },
  );

  await bus.emit(
    "github.workflow.completed",
    {
      repo: "vybe-live/mobile",
      workflowName: "ci.yml",
      conclusion: "success",
      ref: "refs/heads/feat/event-bus-phase2",
      durationSeconds: 87,
      runUrl: `https://github.com/vybe-live/mobile/actions/runs/demo-${prId}`,
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );
}

async function emitReplit(correlationId: string): Promise<void> {
  const bus = getEventBus();

  await bus.emit(
    "replit.workflow.started",
    {
      workflowName: "artifacts/api-server: API Server",
      artifact: "artifacts/api-server",
      exitCode: 0,
      tailLog: "[INFO] os/initOSLayer: OS layer ready { executives: 8, specialists: 12 }",
      durationMs: 3_400,
    },
    "os/sampleEvents",
    { priority: "low", correlationId },
  );

  await bus.emit(
    "replit.db.migrated",
    {
      description: "Add os_events table for Event Bus persistence",
      tables: ["os_events"],
      appliedAt: new Date().toISOString(),
      durationMs: 240,
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );

  await bus.emit(
    "replit.deploy.published",
    {
      domain: "vybe-live.replit.app",
      artifact: "artifacts/api-server",
      version: "v0.9.20-demo",
      deploymentKind: "web",
      region: "us-east-1",
    },
    "os/sampleEvents",
    { priority: "high", correlationId },
  );
}

async function emitEAS(correlationId: string): Promise<void> {
  const bus = getEventBus();
  const buildId = `demo-${randomUUID().slice(0, 8)}`;

  await bus.emit(
    "eas.build.queued",
    {
      buildId,
      platform: "android",
      profile: "preview",
      appVersion: "0.9.20",
      buildNumber: 124,
      channel: "preview",
      projectSlug: "vybe-live",
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );

  await bus.emit(
    "eas.build.started",
    {
      buildId,
      platform: "android",
      profile: "preview",
      appVersion: "0.9.20",
      buildNumber: 124,
      channel: "preview",
      projectSlug: "vybe-live",
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );

  await bus.emit(
    "eas.build.completed",
    {
      buildId,
      platform: "android",
      profile: "preview",
      appVersion: "0.9.20",
      buildNumber: 124,
      channel: "preview",
      projectSlug: "vybe-live",
      durationMs: 312_000,
      artifactUrl: `https://expo.dev/artifacts/eas/${buildId}.apk`,
    },
    "os/sampleEvents",
    { priority: "high", correlationId },
  );

  await bus.emit(
    "eas.update.published",
    {
      updateId: `demo-${randomUUID().slice(0, 8)}`,
      runtimeVersion: "0.9.20",
      branch: "preview",
      platform: "all",
      message: "feat(os): Phase 2 Event Bus live in OTA",
      fingerprint: Math.random().toString(16).slice(2, 18),
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );
}

async function emitStripe(correlationId: string): Promise<void> {
  const bus = getEventBus();
  const customerId = `cus_demo_${randomUUID().slice(0, 8)}`;
  const userId = `demo-user-${randomUUID().slice(0, 8)}`;

  await bus.emit(
    "stripe.customer.created",
    {
      customerId,
      email: "demo-creator@vybe.live",
      userId,
      plan: "pro",
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );

  await bus.emit(
    "stripe.subscription.created",
    {
      subscriptionId: `sub_demo_${randomUUID().slice(0, 8)}`,
      customerId,
      userId,
      plan: "pro",
      interval: "monthly",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      status: "active",
    },
    "os/sampleEvents",
    { priority: "high", correlationId },
  );

  await bus.emit(
    "stripe.payment.succeeded",
    {
      paymentIntentId: `pi_demo_${randomUUID().slice(0, 8)}`,
      amountCents: 2900,
      currency: "usd",
      customerId,
      userId,
      plan: "pro",
    },
    "os/sampleEvents",
    { priority: "high", correlationId },
  );
}

async function emitMissionControl(correlationId: string): Promise<void> {
  const bus = getEventBus();
  const cycleId = randomUUID();
  const briefingId = randomUUID();
  const objectiveId = randomUUID();

  await bus.emit(
    "mc.autonomy.cycle_started",
    {
      cycleId,
      trigger: "manual",
      startedAt: new Date().toISOString(),
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );

  await bus.emit(
    "mc.briefing.generated",
    {
      briefingId,
      objectiveId,
      headline: "Phase 2 Event Bus operational — 10 domains, 60+ event kinds live",
      overallStatus: "healthy",
      executivesIncluded: ["cto", "product_manager", "chief_of_staff"],
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );

  const approvalId = randomUUID();
  await bus.emit(
    "mc.approval.created",
    {
      approvalId,
      objectiveId,
      reason: "Deploy Phase 2 Event Bus to production requires Founder sign-off",
      requestedBy: "cto",
      category: "deploy",
    },
    "os/sampleEvents",
    { priority: "critical", correlationId },
  );

  await bus.emit(
    "mc.approval.decided",
    {
      approvalId,
      objectiveId,
      reason: "Deploy Phase 2 Event Bus to production requires Founder sign-off",
      requestedBy: "cto",
      category: "deploy",
      decision: "approved",
      decidedBy: "founder",
      rationale: "Phase 2 implementation looks solid — ship it.",
    },
    "os/sampleEvents",
    { priority: "critical", correlationId },
  );

  await bus.emit(
    "mc.autonomy.cycle_completed",
    {
      cycleId,
      trigger: "manual",
      startedAt: new Date(Date.now() - 8_000).toISOString(),
      endedAt: new Date().toISOString(),
      durationMs: 8_000,
      actionsCount: 4,
      escalationsCount: 1,
      cycleStatus: "success",
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );
}

async function emitExecutives(correlationId: string): Promise<void> {
  const bus = getEventBus();

  await bus.emit(
    "exec.report.generated",
    {
      executiveId: "demo-exec-cto",
      role: "cto",
      executiveName: "Chief Technology Officer",
      objectiveId: null,
      reportStatus: "healthy",
      headline: "Engineering stack healthy — Phase 2 EventBus merged, 0 TS errors, CI green",
      findingCount: 3,
      confidence: 92,
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );

  await bus.emit(
    "exec.handoff.requested",
    {
      fromExecutiveId: "demo-exec-cto",
      fromRole: "cto",
      toExecutiveId: "demo-exec-pm",
      toRole: "product_manager",
      objectiveId: null,
      reason: "Phase 2 complete — handoff product sign-off to Product Manager",
      context: "EventBus Phase 2 is shipped. Product Manager should review feature checklist.",
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );

  await bus.emit(
    "exec.task.assigned",
    {
      taskId: `demo-task-${randomUUID().slice(0, 8)}`,
      executiveId: "demo-exec-pm",
      role: "product_manager",
      title: "Review Phase 2 Event Bus feature checklist",
      objectiveId: null,
      priority: "high",
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );
}

async function emitObjectives(correlationId: string): Promise<void> {
  const bus = getEventBus();
  const objectiveId = randomUUID();
  const now = new Date();

  const objective = {
    id: objectiveId,
    title: "Ship Mission Control 2.0 Phase 2 — Event Bus",
    description: "Implement typed, persistent, replayable Event Bus with 10 domains",
    status: "in_progress" as const,
    source: "founder" as const,
    createdAt: now,
    updatedAt: now,
    metadata: { phase: 2, domains: 10, eventKinds: 60 },
  };

  await bus.emit("objective.created", { objective }, "os/sampleEvents", {
    priority: "high",
    correlationId,
  });

  await bus.emit(
    "objective.in_progress",
    { objective },
    "os/sampleEvents",
    { priority: "high", correlationId },
  );

  await bus.emit(
    "objective.milestone_reached",
    {
      objective,
      milestone: "All 10 event domain files written and type-checked",
      progressPercent: 75,
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );

  await bus.emit(
    "objective.completed",
    { objective: { ...objective, status: "completed" } },
    "os/sampleEvents",
    { priority: "high", correlationId },
  );
}

async function emitAgentZero(correlationId: string): Promise<void> {
  const bus = getEventBus();
  const jobId = `demo-job-${randomUUID().slice(0, 8)}`;

  await bus.emit(
    "agent_zero.job.dispatched",
    {
      jobId,
      command: "ENGINEERING_SNAPSHOT",
      instruction: "Capture full engineering intelligence snapshot after Phase 2 merge",
      objectiveId: null,
    },
    "os/sampleEvents",
    { priority: "high", correlationId },
  );

  const stepId = randomUUID();
  await bus.emit(
    "agent_zero.job.step_started",
    {
      jobId,
      stepId,
      stepTitle: "GitHub activity analysis",
      kind: "analysis",
      attemptNumber: 1,
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );

  await bus.emit(
    "agent_zero.job.step_completed",
    {
      jobId,
      stepId,
      stepTitle: "GitHub activity analysis",
      kind: "analysis",
      attemptNumber: 1,
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );

  await bus.emit(
    "agent_zero.job.completed",
    {
      jobId,
      command: "ENGINEERING_SNAPSHOT",
      instruction: "Capture full engineering intelligence snapshot",
      objectiveId: null,
      durationMs: 12_400,
      stepsCompleted: 4,
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );
}

async function emitReadyLoq(correlationId: string): Promise<void> {
  const bus = getEventBus();
  const deviceId = `demo-device-${randomUUID().slice(0, 8)}`;
  const sessionId = `demo-session-${randomUUID().slice(0, 8)}`;
  const userId = "demo-creator";

  await bus.emit(
    "readyloq.device.connected",
    {
      deviceId,
      deviceKind: "meta_glasses",
      label: "Ray-Ban Meta Smart Glasses",
      userId,
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );

  await bus.emit(
    "readyloq.session.started",
    {
      sessionId,
      deviceId,
      deviceKind: "meta_glasses",
      userId,
      resolution: "1080p",
      fps: 30,
      targetBitrateKbps: 4_000,
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );

  await bus.emit(
    "readyloq.stream.health_changed",
    {
      sessionId,
      deviceId,
      userId,
      health: "good",
      signalStrength: 87,
      latencyMs: 42,
      packetLossPercent: 0.1,
    },
    "os/sampleEvents",
    { priority: "low", correlationId },
  );

  await bus.emit(
    "readyloq.footage.captured",
    {
      sessionId,
      deviceId,
      userId,
      durationSeconds: 37,
      storagePath: `private/recordings/demo/${sessionId}/clip-001.mp4`,
      autoHighlight: true,
      sizeBytes: 148_000_000,
    },
    "os/sampleEvents",
    { priority: "high", correlationId },
  );
}

async function emitVYBELive(correlationId: string): Promise<void> {
  const bus = getEventBus();
  const streamId = `demo-stream-${randomUUID().slice(0, 8)}`;
  const userId = "demo-creator";
  const clipId = `demo-clip-${randomUUID().slice(0, 8)}`;

  const baseStream: VYBEStreamPayload = {
    streamId,
    userId,
    creatorUsername: "vybe_demo",
    title: "LIVE: Mission Control Phase 2 Demo 🔴",
    sourceDevice: "meta_glasses",
    platforms: ["youtube", "twitch", "kick"] as VYBEPlatform[],
    ingestUrl: `rtmp://ingest.vybe.live/demo/${streamId}`,
  };

  await bus.emit("vybe.stream.started", baseStream, "os/sampleEvents", {
    priority: "high",
    correlationId,
  });

  await bus.emit(
    "vybe.multistream.platform_connected",
    {
      streamId,
      userId,
      platform: "youtube",
      destinationLabel: "YouTube Live",
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );

  await bus.emit(
    "vybe.stream.viewer_spike",
    {
      streamId,
      userId,
      currentViewers: 1_240,
      previousViewers: 320,
      changePercent: 287.5,
      direction: "spike",
    },
    "os/sampleEvents",
    { priority: "high", correlationId },
  );

  await bus.emit(
    "vybe.clip.generated",
    {
      clipId,
      streamId,
      userId,
      title: "Mission Control Phase 2 is LIVE 🚀",
      format: "highlight",
      durationSeconds: 37,
      aspectRatio: "vertical",
      reviewStatus: "pending",
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );

  await bus.emit(
    "vybe.clip.published",
    {
      clipId,
      streamId,
      userId,
      title: "Mission Control Phase 2 is LIVE 🚀",
      format: "highlight",
      durationSeconds: 37,
      aspectRatio: "vertical",
      reviewStatus: "approved",
      platforms: ["tiktok", "instagram"],
      caption: "The Mission Control Event Bus is live — 10 domains, typed, replayable. #VYBE #POV #MissionControl",
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );

  await bus.emit(
    "vybe.stream.ended",
    {
      ...baseStream,
      durationMs: 3_600_000,
      peakViewers: 1_240,
      avgViewers: 612,
      totalViews: 4_500,
      clipsGenerated: 3,
    },
    "os/sampleEvents",
    { priority: "high", correlationId },
  );

  await bus.emit(
    "vybe.creator.milestone",
    {
      userId,
      creatorUsername: "vybe_demo",
      milestone: "1k_followers",
      value: 1_000,
      context: "Crossed 1 000 followers during the Phase 2 demo stream",
    },
    "os/sampleEvents",
    { priority: "normal", correlationId },
  );
}

// ─── Domain registry ──────────────────────────────────────────────────────────

type DomainEmitter = (correlationId: string) => Promise<void>;

export const SAMPLE_DOMAINS: Record<string, DomainEmitter> = {
  github: emitGitHub,
  replit: emitReplit,
  eas: emitEAS,
  stripe: emitStripe,
  missionControl: emitMissionControl,
  executives: emitExecutives,
  objectives: emitObjectives,
  agentZero: emitAgentZero,
  readyloq: emitReadyLoq,
  vybeLive: emitVYBELive,
};

// ─── Main entry point ─────────────────────────────────────────────────────────

export interface SampleEventResult {
  domain: string;
  emitted: number;
  correlationId: string;
  durationMs: number;
  error: string | null;
}

/**
 * Emit sample events for one domain or all domains.
 *
 * @param domain  One of the SAMPLE_DOMAINS keys, or "all" (default).
 */
export async function emitSampleEvents(
  domain: "all" | keyof typeof SAMPLE_DOMAINS = "all",
): Promise<SampleEventResult[]> {
  const domains = domain === "all"
    ? Object.entries(SAMPLE_DOMAINS)
    : [[domain, SAMPLE_DOMAINS[domain as keyof typeof SAMPLE_DOMAINS]] as const];

  const results: SampleEventResult[] = [];

  for (const [name, emitter] of domains) {
    const correlationId = randomUUID();
    const start = Date.now();
    const storeBefore = getEventBus().emitCount;

    try {
      await emitter(correlationId);
      const emitted = getEventBus().emitCount - storeBefore;
      results.push({
        domain: name,
        emitted,
        correlationId,
        durationMs: Date.now() - start,
        error: null,
      });
      logger.info(
        { domain: name, emitted, correlationId, durationMs: Date.now() - start },
        "os/sampleEvents: domain emitted",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({
        domain: name,
        emitted: 0,
        correlationId,
        durationMs: Date.now() - start,
        error: msg,
      });
      logger.warn({ domain: name, err }, "os/sampleEvents: domain emitter threw");
    }
  }

  return results;
}
