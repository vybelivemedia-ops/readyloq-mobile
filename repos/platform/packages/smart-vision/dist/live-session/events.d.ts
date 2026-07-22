/**
 * @platform/smart-vision/live-session — unified pipeline event system.
 *
 * The PipelineEventBus is the single event surface applications subscribe to.
 * It unifies events from all pipeline stages — Smart Vision, Privacy Engine,
 * Quality, Tracking, Zoom, and Auto Capture — into one typed bus.
 *
 * Applications never need to subscribe to the individual sub-engine buses.
 *
 * Event namespace: all kinds are prefixed "pipeline." to avoid collision with
 * "sv." (SmartVision) and "privacy." (PrivacyEngine) internal buses.
 *
 * GOVERNANCE: Payloads carry no domain strings.
 * See repos/platform/GOVERNANCE.md.
 */
import type { FrameIndex, FrameTimestamp } from "../frame";
import type { TrackedRegion } from "../tracking";
import type { FrameQualityReport } from "../quality";
import type { CaptureDecision } from "../capture-policy";
import type { GuidanceDirective } from "../guidance";
import type { SceneCoverage, DuplicateVerdict } from "../scene-memory";
import type { ZoomState } from "../zoom";
import type { PrivacyMask } from "../privacy/types";
import type { DetectedPrivacyObject } from "../privacy/detection";
import type { PipelineFrameResult, PipelineStage } from "./types";
import type { PerformanceMetrics, PerformanceProfile } from "./performance";
export type PipelineEventKind = "pipeline.session.started" | "pipeline.session.paused" | "pipeline.session.resumed" | "pipeline.session.stopped" | "pipeline.session.error" | "pipeline.frame.acquired" | "pipeline.frame.dropped" | "pipeline.frame.processed" | "pipeline.stage.error" | "pipeline.quality.scored" | "pipeline.quality.threshold_crossed" | "pipeline.detection.completed" | "pipeline.tracking.target_acquired" | "pipeline.tracking.target_lost" | "pipeline.tracking.updated" | "pipeline.scene.duplicate_detected" | "pipeline.scene.coverage_updated" | "pipeline.zoom.changed" | "pipeline.privacy.object_detected" | "pipeline.privacy.redacted" | "pipeline.capture.triggered" | "pipeline.capture.skipped" | "pipeline.capture.guidance" | "pipeline.performance.adapted" | "pipeline.performance.report";
interface PipelineEventBase {
    readonly kind: PipelineEventKind;
    readonly sessionId: string;
    readonly timestamp: FrameTimestamp;
}
export interface PipelineSessionStartedEvent extends PipelineEventBase {
    readonly kind: "pipeline.session.started";
    readonly targetFps: number;
    readonly enabledStages: readonly PipelineStage[];
}
export interface PipelineSessionPausedEvent extends PipelineEventBase {
    readonly kind: "pipeline.session.paused";
    readonly reason: string;
}
export interface PipelineSessionResumedEvent extends PipelineEventBase {
    readonly kind: "pipeline.session.resumed";
}
export interface PipelineSessionStoppedEvent extends PipelineEventBase {
    readonly kind: "pipeline.session.stopped";
    readonly durationMs: number;
    readonly framesProcessed: number;
    readonly framesDropped: number;
}
export interface PipelineSessionErrorEvent extends PipelineEventBase {
    readonly kind: "pipeline.session.error";
    readonly stage: PipelineStage | null;
    readonly message: string;
    readonly recoverable: boolean;
}
export interface PipelineFrameAcquiredEvent extends PipelineEventBase {
    readonly kind: "pipeline.frame.acquired";
    readonly frameIndex: FrameIndex;
    readonly queueDepth: number;
}
export interface PipelineFrameDroppedEvent extends PipelineEventBase {
    readonly kind: "pipeline.frame.dropped";
    readonly frameIndex: FrameIndex;
    readonly reason: "stale" | "queue_full" | "paused" | "disabled";
}
export interface PipelineFrameProcessedEvent extends PipelineEventBase {
    readonly kind: "pipeline.frame.processed";
    readonly result: PipelineFrameResult;
}
export interface PipelineStageErrorEvent extends PipelineEventBase {
    readonly kind: "pipeline.stage.error";
    readonly stage: PipelineStage;
    readonly frameIndex: FrameIndex;
    readonly message: string;
}
export interface PipelineQualityScoredEvent extends PipelineEventBase {
    readonly kind: "pipeline.quality.scored";
    readonly frameIndex: FrameIndex;
    readonly report: FrameQualityReport;
}
export interface PipelineQualityThresholdCrossedEvent extends PipelineEventBase {
    readonly kind: "pipeline.quality.threshold_crossed";
    readonly frameIndex: FrameIndex;
    readonly direction: "above" | "below";
    readonly score: number;
}
export interface PipelineDetectionCompletedEvent extends PipelineEventBase {
    readonly kind: "pipeline.detection.completed";
    readonly frameIndex: FrameIndex;
    readonly objectCount: number;
    readonly inferenceMs: number;
}
export interface PipelineTrackingTargetAcquiredEvent extends PipelineEventBase {
    readonly kind: "pipeline.tracking.target_acquired";
    readonly region: TrackedRegion;
    readonly frameIndex: FrameIndex;
}
export interface PipelineTrackingTargetLostEvent extends PipelineEventBase {
    readonly kind: "pipeline.tracking.target_lost";
    readonly trackId: string;
    readonly frameIndex: FrameIndex;
}
export interface PipelineTrackingUpdatedEvent extends PipelineEventBase {
    readonly kind: "pipeline.tracking.updated";
    readonly frameIndex: FrameIndex;
    readonly activeTargets: number;
    readonly regions: readonly TrackedRegion[];
}
export interface PipelineSceneDuplicateDetectedEvent extends PipelineEventBase {
    readonly kind: "pipeline.scene.duplicate_detected";
    readonly frameIndex: FrameIndex;
    readonly verdict: DuplicateVerdict;
}
export interface PipelineSceneCoverageUpdatedEvent extends PipelineEventBase {
    readonly kind: "pipeline.scene.coverage_updated";
    readonly coverage: SceneCoverage;
}
export interface PipelineZoomChangedEvent extends PipelineEventBase {
    readonly kind: "pipeline.zoom.changed";
    readonly frameIndex: FrameIndex;
    readonly zoomState: ZoomState;
}
export interface PipelinePrivacyObjectDetectedEvent extends PipelineEventBase {
    readonly kind: "pipeline.privacy.object_detected";
    readonly frameIndex: FrameIndex;
    /**
     * Raw detections from the privacy provider.
     * These are per-frame detections without stable cross-frame IDs.
     * Use the standalone PrivacyEngine when stable IDs are needed.
     */
    readonly objects: readonly DetectedPrivacyObject[];
}
export interface PipelinePrivacyRedactedEvent extends PipelineEventBase {
    readonly kind: "pipeline.privacy.redacted";
    readonly frameIndex: FrameIndex;
    readonly masks: readonly PrivacyMask[];
}
export interface PipelineCaptureTriggeredEvent extends PipelineEventBase {
    readonly kind: "pipeline.capture.triggered";
    readonly frameIndex: FrameIndex;
    readonly decision: CaptureDecision;
}
export interface PipelineCaptureSkippedEvent extends PipelineEventBase {
    readonly kind: "pipeline.capture.skipped";
    readonly frameIndex: FrameIndex;
    readonly reason: string;
}
export interface PipelineCaptureGuidanceEvent extends PipelineEventBase {
    readonly kind: "pipeline.capture.guidance";
    readonly frameIndex: FrameIndex;
    readonly directives: readonly GuidanceDirective[];
}
export interface PipelinePerformanceAdaptedEvent extends PipelineEventBase {
    readonly kind: "pipeline.performance.adapted";
    readonly previousFps: number;
    readonly newFps: number;
    readonly previousProfile: PerformanceProfile;
    readonly newProfile: PerformanceProfile;
    readonly reason: string;
}
export interface PipelinePerformanceReportEvent extends PipelineEventBase {
    readonly kind: "pipeline.performance.report";
    readonly metrics: PerformanceMetrics;
}
export type PipelineEvent = PipelineSessionStartedEvent | PipelineSessionPausedEvent | PipelineSessionResumedEvent | PipelineSessionStoppedEvent | PipelineSessionErrorEvent | PipelineFrameAcquiredEvent | PipelineFrameDroppedEvent | PipelineFrameProcessedEvent | PipelineStageErrorEvent | PipelineQualityScoredEvent | PipelineQualityThresholdCrossedEvent | PipelineDetectionCompletedEvent | PipelineTrackingTargetAcquiredEvent | PipelineTrackingTargetLostEvent | PipelineTrackingUpdatedEvent | PipelineSceneDuplicateDetectedEvent | PipelineSceneCoverageUpdatedEvent | PipelineZoomChangedEvent | PipelinePrivacyObjectDetectedEvent | PipelinePrivacyRedactedEvent | PipelineCaptureTriggeredEvent | PipelineCaptureSkippedEvent | PipelineCaptureGuidanceEvent | PipelinePerformanceAdaptedEvent | PipelinePerformanceReportEvent;
export type PipelineEventListener<E extends PipelineEvent = PipelineEvent> = (event: E) => void;
/**
 * Unified typed event bus for all Live Session pipeline events.
 *
 * Applications subscribe once to this bus and receive events from all
 * pipeline stages — quality, detection, tracking, privacy, capture, etc.
 * No need to subscribe to individual sub-engine buses.
 */
export interface PipelineEventBus {
    /** Subscribe to a specific event kind. Returns an unsubscribe fn. */
    on<K extends PipelineEventKind>(kind: K, listener: PipelineEventListener<Extract<PipelineEvent, {
        kind: K;
    }>>): () => void;
    /** Unsubscribe all listeners for a kind. */
    off(kind: PipelineEventKind): void;
    /** Publish an event to all registered listeners. */
    emit(event: PipelineEvent): void;
    /** Remove all listeners. */
    clear(): void;
}
export {};
//# sourceMappingURL=events.d.ts.map