/**
 * @platform/smart-vision — typed event system.
 *
 * All significant state changes in the SmartVisionEngine are published as
 * typed events on the SmartVisionEventBus. Applications subscribe to the
 * events they care about and ignore the rest.
 *
 * Event namespace: all kinds are prefixed "sv." to avoid collision with
 * other platform event buses.
 *
 * GOVERNANCE: Event payloads carry no domain strings.
 *   classId values in detection payloads are still app-defined integers.
 *   See repos/platform/GOVERNANCE.md.
 */
import type { FrameIndex, FrameTimestamp } from "./frame";
import type { BoundingBox, TrackId, TrackedRegion } from "./tracking";
import type { ZoomState, ZoomCommand } from "./zoom";
import type { FrameQualityReport } from "./quality";
import type { DetectionResult } from "./detection";
import type { CaptureDecision } from "./capture-policy";
import type { GuidanceDirective } from "./guidance";
import type { SceneCoverage } from "./scene-memory";
export type SmartVisionEventKind = "sv.session.started" | "sv.session.paused" | "sv.session.resumed" | "sv.session.stopped" | "sv.session.error" | "sv.frame.processed" | "sv.frame.dropped" | "sv.target.detected" | "sv.target.lost" | "sv.target.updated" | "sv.target.locked" | "sv.target.unlocked" | "sv.zoom.changed" | "sv.zoom.command_issued" | "sv.quality.changed" | "sv.quality.threshold_crossed" | "sv.capture.started" | "sv.capture.completed" | "sv.capture.skipped" | "sv.capture.policy_changed" | "sv.guidance.emitted" | "sv.scene.coverage_updated" | "sv.scene.duplicate_detected";
interface SmartVisionEventBase {
    readonly kind: SmartVisionEventKind;
    readonly sessionId: string;
    readonly timestamp: FrameTimestamp;
}
export interface SessionStartedEvent extends SmartVisionEventBase {
    readonly kind: "sv.session.started";
    readonly policyId: string;
    readonly enabledFeatures: readonly string[];
}
export interface SessionPausedEvent extends SmartVisionEventBase {
    readonly kind: "sv.session.paused";
    readonly reason: string;
}
export interface SessionResumedEvent extends SmartVisionEventBase {
    readonly kind: "sv.session.resumed";
}
export interface SessionStoppedEvent extends SmartVisionEventBase {
    readonly kind: "sv.session.stopped";
    readonly captureCount: number;
    readonly durationMs: number;
}
export interface SessionErrorEvent extends SmartVisionEventBase {
    readonly kind: "sv.session.error";
    readonly error: string;
    readonly recoverable: boolean;
}
export interface FrameProcessedEvent extends SmartVisionEventBase {
    readonly kind: "sv.frame.processed";
    readonly frameIndex: FrameIndex;
    /** Wall-clock time for the full pipeline pass (ms). */
    readonly pipelineMs: number;
    readonly qualityReport: FrameQualityReport;
    readonly detectionResult: DetectionResult | null;
}
export interface FrameDroppedEvent extends SmartVisionEventBase {
    readonly kind: "sv.frame.dropped";
    readonly frameIndex: FrameIndex;
    /** Why the frame was dropped. */
    readonly reason: "overloaded" | "stale" | "format_unsupported" | "error";
}
export interface TargetDetectedEvent extends SmartVisionEventBase {
    readonly kind: "sv.target.detected";
    readonly classId: number;
    readonly confidence: number;
    readonly box: BoundingBox;
    readonly frameIndex: FrameIndex;
}
export interface TargetLostEvent extends SmartVisionEventBase {
    readonly kind: "sv.target.lost";
    readonly classId: number;
    /** TrackId if the lost target was being tracked; absent for raw detections. */
    readonly trackId?: TrackId;
    readonly frameIndex: FrameIndex;
}
export interface TargetUpdatedEvent extends SmartVisionEventBase {
    readonly kind: "sv.target.updated";
    readonly region: TrackedRegion;
}
export interface TargetLockedEvent extends SmartVisionEventBase {
    readonly kind: "sv.target.locked";
    readonly trackId: TrackId;
    readonly box: BoundingBox;
    readonly confidence: number;
}
export interface TargetUnlockedEvent extends SmartVisionEventBase {
    readonly kind: "sv.target.unlocked";
    readonly trackId: TrackId;
    readonly reason: string;
}
export interface ZoomChangedEvent extends SmartVisionEventBase {
    readonly kind: "sv.zoom.changed";
    readonly previous: ZoomState;
    readonly current: ZoomState;
}
export interface ZoomCommandIssuedEvent extends SmartVisionEventBase {
    readonly kind: "sv.zoom.command_issued";
    readonly command: ZoomCommand;
    readonly source: "smart_zoom" | "manual" | "subject_lock";
}
export interface QualityChangedEvent extends SmartVisionEventBase {
    readonly kind: "sv.quality.changed";
    readonly report: FrameQualityReport;
    readonly frameIndex: FrameIndex;
}
export interface QualityThresholdCrossedEvent extends SmartVisionEventBase {
    readonly kind: "sv.quality.threshold_crossed";
    readonly direction: "above" | "below";
    readonly threshold: number;
    readonly score: number;
}
export interface CaptureStartedEvent extends SmartVisionEventBase {
    readonly kind: "sv.capture.started";
    readonly decision: CaptureDecision;
    readonly captureIndex: number;
}
export interface CaptureCompletedEvent extends SmartVisionEventBase {
    readonly kind: "sv.capture.completed";
    readonly captureIndex: number;
    readonly durationMs: number;
    /** Identifier of the stored evidence item. Set by the application. */
    readonly evidenceId?: string;
}
export interface CaptureSkippedEvent extends SmartVisionEventBase {
    readonly kind: "sv.capture.skipped";
    readonly decision: CaptureDecision;
    readonly frameIndex: FrameIndex;
}
export interface CapturePolicyChangedEvent extends SmartVisionEventBase {
    readonly kind: "sv.capture.policy_changed";
    readonly previousPolicyId: string;
    readonly newPolicyId: string;
}
export interface GuidanceEmittedEvent extends SmartVisionEventBase {
    readonly kind: "sv.guidance.emitted";
    readonly directives: readonly GuidanceDirective[];
    /** The dominant directive code (critical > warning > info). */
    readonly dominant: string | null;
}
export interface SceneCoverageUpdatedEvent extends SmartVisionEventBase {
    readonly kind: "sv.scene.coverage_updated";
    readonly coverage: SceneCoverage;
}
export interface SceneDuplicateDetectedEvent extends SmartVisionEventBase {
    readonly kind: "sv.scene.duplicate_detected";
    readonly frameIndex: FrameIndex;
    readonly overlapScore: number;
}
export type SmartVisionEvent = SessionStartedEvent | SessionPausedEvent | SessionResumedEvent | SessionStoppedEvent | SessionErrorEvent | FrameProcessedEvent | FrameDroppedEvent | TargetDetectedEvent | TargetLostEvent | TargetUpdatedEvent | TargetLockedEvent | TargetUnlockedEvent | ZoomChangedEvent | ZoomCommandIssuedEvent | QualityChangedEvent | QualityThresholdCrossedEvent | CaptureStartedEvent | CaptureCompletedEvent | CaptureSkippedEvent | CapturePolicyChangedEvent | GuidanceEmittedEvent | SceneCoverageUpdatedEvent | SceneDuplicateDetectedEvent;
export type SmartVisionEventListener<T extends SmartVisionEvent = SmartVisionEvent> = (event: T) => void;
/**
 * Typed event bus for the SmartVisionEngine.
 *
 * Applications subscribe to specific event kinds to react to vision state
 * changes without polling. All platform event kinds use the "sv.*" namespace.
 *
 * Multiple listeners for the same kind are supported; they are called in
 * registration order. Errors in one listener do not affect others.
 */
export interface SmartVisionEventBus {
    /**
     * Subscribe to all events of a specific kind.
     * @returns An unsubscribe function; call it to remove the listener.
     */
    on<K extends SmartVisionEventKind>(kind: K, listener: SmartVisionEventListener<Extract<SmartVisionEvent, {
        kind: K;
    }>>): () => void;
    /**
     * Subscribe to all events regardless of kind.
     * Useful for logging and diagnostics.
     */
    onAny(listener: SmartVisionEventListener): () => void;
    /** Remove all listeners for a specific kind. */
    off(kind: SmartVisionEventKind): void;
    /** Remove all listeners for all event kinds. */
    clear(): void;
    /**
     * Publish an event to all registered listeners.
     * Called internally by the SmartVisionEngine; applications should not
     * call this directly.
     */
    emit(event: SmartVisionEvent): void;
}
export {};
//# sourceMappingURL=events.d.ts.map