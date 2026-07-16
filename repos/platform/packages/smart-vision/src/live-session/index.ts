/**
 * @platform/smart-vision/live-session — public contract barrel.
 *
 * Re-exports all Live Session Engine types and interfaces.
 * Concrete implementations live in the impl/ sub-directory.
 *
 * Usage (contracts only):
 *   import type { VisionSession, LiveSessionConfig } from "@platform/smart-vision/live-session";
 *
 * Usage (with concrete factory):
 *   import { createLiveSessionFactory } from "@platform/smart-vision/live-session/impl";
 */

// ─── Core types ───────────────────────────────────────────────────────────────
export { DEFAULT_LIVE_SESSION_CONFIG, DEFAULT_LIVE_SESSION_FEATURES } from "./types";
export type {
  PipelineState,
  PipelineStage,
  PipelineStageResult,
  PipelineFrameResult,
  LiveSessionFeatureFlags,
  FrameDropPolicy,
  LiveSessionConfig,
} from "./types";

// ─── Events ───────────────────────────────────────────────────────────────────
export type {
  PipelineEventKind,
  PipelineEvent,
  PipelineEventListener,
  PipelineEventBus,
  PipelineSessionStartedEvent,
  PipelineSessionPausedEvent,
  PipelineSessionResumedEvent,
  PipelineSessionStoppedEvent,
  PipelineSessionErrorEvent,
  PipelineFrameAcquiredEvent,
  PipelineFrameDroppedEvent,
  PipelineFrameProcessedEvent,
  PipelineStageErrorEvent,
  PipelineQualityScoredEvent,
  PipelineQualityThresholdCrossedEvent,
  PipelineDetectionCompletedEvent,
  PipelineTrackingTargetAcquiredEvent,
  PipelineTrackingTargetLostEvent,
  PipelineTrackingUpdatedEvent,
  PipelineSceneDuplicateDetectedEvent,
  PipelineSceneCoverageUpdatedEvent,
  PipelineZoomChangedEvent,
  PipelinePrivacyObjectDetectedEvent,
  PipelinePrivacyRedactedEvent,
  PipelineCaptureTriggeredEvent,
  PipelineCaptureSkippedEvent,
  PipelineCaptureGuidanceEvent,
  PipelinePerformanceAdaptedEvent,
  PipelinePerformanceReportEvent,
} from "./events";

// ─── Performance ──────────────────────────────────────────────────────────────
export { PROFILE_TARGET_FPS } from "./performance";
export type {
  PerformanceProfile,
  PerformanceMetrics,
  AdaptationDecision,
  PerformanceMonitor,
} from "./performance";

// ─── Scheduler ───────────────────────────────────────────────────────────────
export type {
  FrameSchedulerDecision,
  FrameScheduleResult,
  LiveFrameScheduler,
} from "./scheduler";

// ─── Pipeline ────────────────────────────────────────────────────────────────
export type {
  PipelineStageDescriptor,
  PipelineStageRunner,
  PipelineContext,
  FramePipeline,
  PipelineCoordinator,
} from "./pipeline";

// ─── Session ─────────────────────────────────────────────────────────────────
export type {
  SessionStatistics,
  VisionSessionSnapshot,
  VisionSession,
} from "./session";

// ─── Engine ──────────────────────────────────────────────────────────────────
export type {
  LiveSessionDependencies,
  LiveSessionEngine,
  LiveSessionFactory,
} from "./engine";
