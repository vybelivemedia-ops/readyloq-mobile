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
export type { PrivacyObjectId, PrivacyZoneId, PrivacyObservationId, PrivacyObject, PrivacyMask, PrivacyZone, PrivacyZoneMode, PrivacyFrameResult, PrivacyStatistics, PrivacyClassStats, } from "./types";
export type { PrivacyObjectClass, PrivacyDetectionRequest, DetectedPrivacyObject, PrivacyDetectionResult, PrivacyDetector, } from "./detection";
export type { RedactionType, PrivacyObjectPolicy, PrivacyPolicy, PrivacyPolicyMap, } from "./policy";
export type { PrivacyRenderInput, PrivacyRenderOutput, PrivacyRenderer, } from "./renderer";
export type { PrivacyObservation, PrivacyObservationTrigger, PrivacyHistoryQuery, PrivacyHistory, } from "./history";
export type { PrivacyEventKind, PrivacyEvent, PrivacyEventListener, PrivacyEventBus, PrivacySessionStartedEvent, PrivacySessionStoppedEvent, PrivacySessionErrorEvent, PrivacyDetectedEvent, PrivacyUpdatedEvent, PrivacyLostEvent, PrivacyRedactedEvent, PrivacyRestoredEvent, PrivacyPolicyChangedEvent, PrivacyRendererChangedEvent, PrivacyFrameProcessedEvent, } from "./events";
export { DEFAULT_PRIVACY_CONFIGURATION } from "./config";
export type { PrivacyPerformanceMode, PrivacyConfiguration, } from "./config";
export type { PrivacyProviderCapabilities, PrivacyProvider, PrivacyProviderRegistry, PrivacyProviderRequirements, } from "./provider";
export type { PrivacyEngineState, PrivacyEngineDependencies, PrivacySession, PrivacyEngine, PrivacyFactory, } from "./engine";
//# sourceMappingURL=index.d.ts.map