/**
 * @platform/smart-vision/privacy — public contract barrel.
 *
 * Re-exports all privacy engine types and interfaces.
 * Import concrete factory implementations from the impl/ sub-directory.
 *
 * Usage:
 *   import type { PrivacyPolicy, PrivacyObjectClass } from "@platform/smart-vision/privacy";
 *   import { createPrivacyFactory } from "@platform/smart-vision/privacy/impl";
 */

// ─── Core types ───────────────────────────────────────────────────────────────
export type {
  PrivacyObjectId,
  PrivacyZoneId,
  PrivacyObservationId,
  PrivacyObject,
  PrivacyMask,
  PrivacyZone,
  PrivacyZoneMode,
  PrivacyFrameResult,
  PrivacyStatistics,
  PrivacyClassStats,
} from "./types";

// ─── Detection ────────────────────────────────────────────────────────────────
export type {
  PrivacyObjectClass,
  PrivacyDetectionRequest,
  DetectedPrivacyObject,
  PrivacyDetectionResult,
  PrivacyDetector,
} from "./detection";

// ─── Policy ───────────────────────────────────────────────────────────────────
export type {
  RedactionType,
  PrivacyObjectPolicy,
  PrivacyPolicy,
  PrivacyPolicyMap,
} from "./policy";

// ─── Renderer ────────────────────────────────────────────────────────────────
export type {
  PrivacyRenderInput,
  PrivacyRenderOutput,
  PrivacyRenderer,
} from "./renderer";

// ─── History ─────────────────────────────────────────────────────────────────
export type {
  PrivacyObservation,
  PrivacyObservationTrigger,
  PrivacyHistoryQuery,
  PrivacyHistory,
} from "./history";

// ─── Events ───────────────────────────────────────────────────────────────────
export type {
  PrivacyEventKind,
  PrivacyEvent,
  PrivacyEventListener,
  PrivacyEventBus,
  PrivacySessionStartedEvent,
  PrivacySessionStoppedEvent,
  PrivacySessionErrorEvent,
  PrivacyDetectedEvent,
  PrivacyUpdatedEvent,
  PrivacyLostEvent,
  PrivacyRedactedEvent,
  PrivacyRestoredEvent,
  PrivacyPolicyChangedEvent,
  PrivacyRendererChangedEvent,
  PrivacyFrameProcessedEvent,
} from "./events";

// ─── Configuration ────────────────────────────────────────────────────────────
export { DEFAULT_PRIVACY_CONFIGURATION } from "./config";
export type {
  PrivacyPerformanceMode,
  PrivacyConfiguration,
} from "./config";

// ─── Provider ────────────────────────────────────────────────────────────────
export type {
  PrivacyProviderCapabilities,
  PrivacyProvider,
  PrivacyProviderRegistry,
  PrivacyProviderRequirements,
} from "./provider";

// ─── Engine ───────────────────────────────────────────────────────────────────
export type {
  PrivacyEngineState,
  PrivacyEngineDependencies,
  PrivacySession,
  PrivacyEngine,
  PrivacyFactory,
} from "./engine";
