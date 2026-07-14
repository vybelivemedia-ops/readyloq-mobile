// ─── Mission Control OS Layer — Public API & Bootstrap (Phase 3) ──────────────
//
// Single import surface for the OS architecture layer. All server code that
// needs OS-layer functionality imports from here, never from individual
// sub-modules.
//
// Bootstrap:
//   Call `initOSLayer(config?)` once during server startup (after the DB is
//   ready). It is idempotent — repeated calls are no-ops.
//
// Shutdown:
//   Call `shutdownOSLayer()` during graceful-shutdown to clear event bus
//   subscriptions, EventStore, and StateEngine. Safe to call even if init
//   never ran.

import { logger } from "../../lib/logger.js";
import { getEventBus } from "./EventBus.js";
import { getEventStore } from "./EventStore.js";
import { getStateEngine, STATE_KEYS } from "./StateEngine.js";
import { getObjectiveManager } from "./ObjectiveManager.js";
import { getObjectiveStateStore } from "./ObjectiveStateStore.js";
import { getExecutiveStateReader } from "./ExecutiveStateReader.js";
import { getExecutiveRegistry } from "./ExecutiveRegistry.js";
import { getSpecialistProviderRegistry } from "./SpecialistProviderRegistry.js";
import { getExecutionProviderRegistry } from "./ExecutionProviderRegistry.js";
import { AgentZeroProvider } from "./providers/AgentZeroProvider.js";
import { initExecutiveEventBridge, shutdownExecutiveEventBridge, bridgeSubscriptionCount } from "./ExecutiveEventBridge.js";
import { getQuinnChiefOfStaff } from "./QuinnChiefOfStaff.js";
import type { OSLayerConfig, OSLayerStatus } from "./types.js";

// ─── Re-exports ────────────────────────────────────────────────────────────────
// Consumers import everything they need from this single surface.

export type {
  // Core event types (Phase 2: includes priority, status, correlationId)
  OSEvent,
  OSEventHandler,
  OSSubscription,
  EventPriority,
  EventStatus,
  // State
  OSStateKey,
  OSStateListener,
  OSStateSnapshot,
  // Objectives
  OSObjective,
  CreateObjectiveInput,
  ObjectiveStatus,
  ObjectiveSource,
  // Phase 3: Persistent State Engine
  ObjectivePriority,
  ExecutionOutcome,
  ExecutionEntry,
  LearningEntry,
  NextActionDescriptor,
  RichObjectiveState,
  ExecutiveContext,
  // Phase 4: Chief of Staff
  CoSDecisionKind,
  CoSDecision,
  WorkloadItem,
  BlockedReason,
  BlockedObjective,
  CoSCycleResult,
  ChiefOfStaffStatus,
  // Executives
  ExecutiveDescriptor,
  // Specialists
  SpecialistDescriptor,
  // Execution providers
  ExecutionCapability,
  ExecutionProviderDescriptor,
  DispatchOptions,
  DispatchResult,
  // Quinn
  QuinnIntent,
  QuinnIntentKind,
  QuinnResponse,
  OSAction,
  // Bootstrap
  OSLayerConfig,
  OSLayerStatus,
} from "./types.js";

// Phase 2: event payload types
export type {
  EventPayloadMap,
  AnyEventKind,
  AnyEventPayload,
  // GitHub
  GitHubPushPayload,
  GitHubPRPayload,
  GitHubPRMergedPayload,
  GitHubReviewPayload,
  GitHubWorkflowPayload,
  GitHubDeploymentPayload,
  // Replit
  ReplitWorkflowPayload,
  ReplitDeployPayload,
  ReplitDeployFailedPayload,
  ReplitDbMigrationPayload,
  ReplitCheckpointPayload,
  // EAS
  EASBuildPayload,
  EASBuildCompletedPayload,
  EASBuildFailedPayload,
  EASSubmitPayload,
  EASUpdatePayload,
  // Stripe
  StripePaymentPayload,
  StripeSubscriptionPayload,
  StripeInvoicePayload,
  StripeCustomerPayload,
  // Mission Control
  MCAutonomyCyclePayload,
  MCAutonomyCycleCompletedPayload,
  MCBriefingPayload,
  MCApprovalPayload,
  MCApprovalDecidedPayload,
  MCRecommendationPayload,
  MCLearningInsightPayload,
  // Executives
  ExecReportPayload,
  ExecHandoffPayload,
  ExecCollaborationPayload,
  ExecMessagePayload,
  ExecTaskAssignedPayload,
  ExecTaskCompletedPayload,
  // Objectives
  ObjectivesEventMap,
  // Agent Zero
  AgentZeroJobPayload,
  AgentZeroJobCompletedPayload,
  AgentZeroJobFailedPayload,
  AgentZeroStepPayload,
  AgentZeroApprovalPayload,
  AgentZeroSpecialistPayload,
  // ReadyLoq
  ReadyLoqDevicePayload,
  ReadyLoqSessionPayload,
  ReadyLoqSessionEndedPayload,
  ReadyLoqStreamHealthPayload,
  ReadyLoqFootageCapturedPayload,
  // VYBE Live
  VYBEStreamPayload,
  VYBEStreamEndedPayload,
  VYBEViewerSpikePayload,
  VYBEMultistreamPlatformPayload,
  VYBEMultistreamErrorPayload,
  VYBEClipPayload,
  VYBEClipPublishedPayload,
  VYBECreatorMilestonePayload,
} from "./events/index.js";

export { getEventBus } from "./EventBus.js";
export { getEventStore } from "./EventStore.js";
export { getStateEngine, STATE_KEYS } from "./StateEngine.js";
export { getObjectiveManager } from "./ObjectiveManager.js";
// Phase 3: Persistent State Engine singletons
export { getObjectiveStateStore } from "./ObjectiveStateStore.js";
export { getExecutiveStateReader } from "./ExecutiveStateReader.js";
export { getExecutiveRegistry } from "./ExecutiveRegistry.js";
export { getSpecialistProviderRegistry } from "./SpecialistProviderRegistry.js";
export { getExecutionProviderRegistry } from "./ExecutionProviderRegistry.js";
export type { ExecutionProvider } from "./ExecutionProviderRegistry.js";
export { AgentZeroProvider } from "./providers/AgentZeroProvider.js";
export { getQuinnOrchestrator } from "./QuinnOrchestrator.js";
// Phase 4: Chief of Staff singleton
export { getQuinnChiefOfStaff } from "./QuinnChiefOfStaff.js";
export { initExecutiveEventBridge, shutdownExecutiveEventBridge, bridgeSubscriptionCount } from "./ExecutiveEventBridge.js";
export { emitSampleEvents, SAMPLE_DOMAINS } from "./sampleEvents.js";
export type { SampleEventResult } from "./sampleEvents.js";

// ─── Bootstrap ────────────────────────────────────────────────────────────────

let _initialised = false;

/**
 * Initialise the OS architecture layer.
 *
 * Safe to call multiple times — subsequent calls are no-ops.
 * Must be called after the DB connection is established.
 *
 * Phase 2 additions:
 *   5. Wire EventStore into EventBus (persistent event logging).
 *   6. Load recent events from DB into EventStore ring (cold-start replay).
 *   7. Initialise the ExecutiveEventBridge subscriptions.
 */
export async function initOSLayer(config: OSLayerConfig = {}): Promise<void> {
  if (_initialised) {
    if (config.verbose) {
      logger.info("os/initOSLayer: already initialised — skipping");
    }
    return;
  }

  logger.info("os/initOSLayer: initialising Mission Control OS layer (Phase 4)");

  // 1. Executive registry — load from DB.
  await getExecutiveRegistry().load();

  // 2. Execution provider registry — register Agent Zero.
  const execRegistry = getExecutionProviderRegistry();
  execRegistry.register(new AgentZeroProvider());

  // 3. Wire EventStore into EventBus so every emitted event is persisted.
  const bus = getEventBus();
  const store = getEventStore();
  bus.setStore(store);

  // 4. Load recent events from DB into the in-memory ring (cold-start catch-up).
  await store.loadFromDB(200);

  // 5. Wire StateEngine listeners — keep key OS metrics up to date.
  const state = getStateEngine();
  const objectiveMgr = getObjectiveManager();

  // Update active-objective count whenever an objective changes.
  bus.subscribe("objective.created", async () => {
    const n = await objectiveMgr.count("in_progress");
    state.set(STATE_KEYS.ACTIVE_OBJECTIVE_COUNT, n);
  });
  bus.subscribe("objective.updated", async () => {
    const n = await objectiveMgr.count("in_progress");
    state.set(STATE_KEYS.ACTIVE_OBJECTIVE_COUNT, n);
  });
  bus.subscribe("objective.completed", async () => {
    const n = await objectiveMgr.count("in_progress");
    state.set(STATE_KEYS.ACTIVE_OBJECTIVE_COUNT, n);
  });
  bus.subscribe("objective.failed", async () => {
    const n = await objectiveMgr.count("in_progress");
    state.set(STATE_KEYS.ACTIVE_OBJECTIVE_COUNT, n);
  });

  // Reflect Agent Zero health into state.
  bus.subscribe("job.dispatched", () => {
    const provider = execRegistry.get("agent-zero");
    state.set(STATE_KEYS.AGENT_ZERO_HEALTHY, provider?.isAvailable() ?? false);
  });

  // 6. Initialise the Executive Event Bridge (Phase 2 subscriptions).
  initExecutiveEventBridge();

  // 7. Phase 3: pre-warm the ObjectiveStateStore and ExecutiveStateReader
  //    singletons so first requests aren't cold-starts.
  getObjectiveStateStore();
  getExecutiveStateReader();

  // 8. Phase 4: pre-warm Quinn Chief of Staff singleton.
  getQuinnChiefOfStaff();

  // 9. Record init timestamp.
  state.set(STATE_KEYS.OS_INIT_AT, new Date().toISOString());

  _initialised = true;

  logger.info(
    {
      executives: getExecutiveRegistry().size,
      specialists: getSpecialistProviderRegistry().size,
      executionProviders: execRegistry.size,
      bridgeSubscriptions: bridgeSubscriptionCount(),
      eventStoreCapacity: store.maxCapacity,
    },
    "os/initOSLayer: OS layer ready",
  );
}

/**
 * Tear down the OS architecture layer.
 * Clears the EventBus, EventStore, and StateEngine. Idempotent.
 * Called during graceful server shutdown.
 */
export function shutdownOSLayer(): void {
  if (!_initialised) return;

  shutdownExecutiveEventBridge();
  getEventBus().clear();
  getEventStore().clear();
  getStateEngine().clear();
  _initialised = false;

  logger.info("os/shutdownOSLayer: OS layer torn down");
}

/**
 * Returns a snapshot of OS layer health suitable for embedding in a status
 * endpoint or health check. Does not perform any I/O.
 */
export function getOSLayerStatus(): OSLayerStatus {
  const execReg = getExecutiveRegistry();
  const specReg = getSpecialistProviderRegistry();
  const execProvReg = getExecutionProviderRegistry();
  const bus = getEventBus();
  const state = getStateEngine();
  const store = getEventStore();

  return {
    initialised: _initialised,
    eventBus: {
      subscriptionCount: bus.subscriptionCount,
      emitCount: bus.emitCount,
    },
    stateEngine: {
      keyCount: state.keyCount,
    },
    eventStore: {
      storedCount: store.storedCount,
      maxCapacity: store.maxCapacity,
    },
    executiveRegistry: {
      executiveCount: execReg.size,
      capableRoles: execReg.withCapability().map((d) => d.role),
    },
    specialistRegistry: {
      specialistCount: specReg.size,
    },
    executionProviders: {
      providerCount: execProvReg.size,
      availableProviders: execProvReg.available().map((p) => p.id),
    },
    objectiveStateStore: {
      enabled: _initialised,
    },
  };
}
