/**
 * @platform/smart-vision/privacy — typed event system.
 *
 * All significant state changes in the Privacy Engine are published as typed
 * events on the PrivacyEventBus. Applications subscribe to events they care
 * about and ignore the rest.
 *
 * Event namespace: all kind strings are prefixed "privacy." to avoid collision
 * with SmartVisionEventBus ("sv.") events.
 *
 * GOVERNANCE: Payloads carry no domain strings.
 * See repos/platform/GOVERNANCE.md.
 */

import type { FrameIndex, FrameTimestamp } from "../frame";
import type { PrivacyObject, PrivacyMask, PrivacyFrameResult } from "./types";
import type { PrivacyPolicy } from "./policy";
import type { PrivacyObjectClass } from "./detection";

// ─── Event kinds ─────────────────────────────────────────────────────────────

export type PrivacyEventKind =
  // ── Session lifecycle ─────────────────────────────────────────────────
  | "privacy.session.started"
  | "privacy.session.stopped"
  | "privacy.session.error"
  // ── Object lifecycle ──────────────────────────────────────────────────
  | "privacy.detected"       // new privacy object entered the scene
  | "privacy.updated"        // existing object's position or confidence changed
  | "privacy.lost"           // tracked object left the frame / evicted
  // ── Redaction state ───────────────────────────────────────────────────
  | "privacy.redacted"       // redaction first applied to an object this session
  | "privacy.restored"       // redaction lifted (policy change or reclassification)
  // ── Policy / renderer ─────────────────────────────────────────────────
  | "privacy.policy_changed"
  | "privacy.renderer_changed"
  // ── Frame pipeline ────────────────────────────────────────────────────
  | "privacy.frame.processed";

// ─── Base event ───────────────────────────────────────────────────────────────

interface PrivacyEventBase {
  readonly kind: PrivacyEventKind;
  readonly sessionId: string;
  readonly timestamp: FrameTimestamp;
}

// ─── Session lifecycle events ────────────────────────────────────────────────

export interface PrivacySessionStartedEvent extends PrivacyEventBase {
  readonly kind: "privacy.session.started";
  readonly policyId: string;
  readonly detectorId: string;
  readonly rendererId: string | null;
}

export interface PrivacySessionStoppedEvent extends PrivacyEventBase {
  readonly kind: "privacy.session.stopped";
  readonly durationMs: number;
  readonly totalFrames: number;
  readonly totalRedactions: number;
}

export interface PrivacySessionErrorEvent extends PrivacyEventBase {
  readonly kind: "privacy.session.error";
  readonly message: string;
  readonly recoverable: boolean;
}

// ─── Object lifecycle events ─────────────────────────────────────────────────

export interface PrivacyDetectedEvent extends PrivacyEventBase {
  readonly kind: "privacy.detected";
  /** The newly detected privacy object. */
  readonly object: Readonly<PrivacyObject>;
  readonly frameIndex: FrameIndex;
}

export interface PrivacyUpdatedEvent extends PrivacyEventBase {
  readonly kind: "privacy.updated";
  readonly object: Readonly<PrivacyObject>;
  readonly frameIndex: FrameIndex;
  /** What changed since the last update (informational; not exhaustive). */
  readonly changedFields: readonly ("box" | "confidence" | "redacted" | "redactionType")[];
}

export interface PrivacyLostEvent extends PrivacyEventBase {
  readonly kind: "privacy.lost";
  /** Snapshot of the object at the time it was last seen. */
  readonly object: Readonly<PrivacyObject>;
  /** Total frames the object was continuously tracked. */
  readonly trackLength: number;
}

// ─── Redaction state events ───────────────────────────────────────────────────

export interface PrivacyRedactedEvent extends PrivacyEventBase {
  readonly kind: "privacy.redacted";
  readonly object: Readonly<PrivacyObject>;
  readonly mask: PrivacyMask;
  readonly frameIndex: FrameIndex;
}

export interface PrivacyRestoredEvent extends PrivacyEventBase {
  readonly kind: "privacy.restored";
  readonly object: Readonly<PrivacyObject>;
  /** Why the redaction was lifted. */
  readonly reason: "policy_changed" | "reclassified" | "manual";
  readonly frameIndex: FrameIndex;
}

// ─── Policy / renderer events ─────────────────────────────────────────────────

export interface PrivacyPolicyChangedEvent extends PrivacyEventBase {
  readonly kind: "privacy.policy_changed";
  readonly previousPolicyId: string;
  readonly newPolicyId: string;
}

export interface PrivacyRendererChangedEvent extends PrivacyEventBase {
  readonly kind: "privacy.renderer_changed";
  readonly previousRendererId: string | null;
  readonly newRendererId: string | null;
}

// ─── Frame pipeline event ────────────────────────────────────────────────────

export interface PrivacyFrameProcessedEvent extends PrivacyEventBase {
  readonly kind: "privacy.frame.processed";
  readonly frameIndex: FrameIndex;
  readonly objectCount: number;
  readonly masksApplied: number;
  readonly skippedInference: boolean;
  readonly totalMs: number;
}

// ─── Union type ───────────────────────────────────────────────────────────────

export type PrivacyEvent =
  | PrivacySessionStartedEvent
  | PrivacySessionStoppedEvent
  | PrivacySessionErrorEvent
  | PrivacyDetectedEvent
  | PrivacyUpdatedEvent
  | PrivacyLostEvent
  | PrivacyRedactedEvent
  | PrivacyRestoredEvent
  | PrivacyPolicyChangedEvent
  | PrivacyRendererChangedEvent
  | PrivacyFrameProcessedEvent;

// ─── Listener ────────────────────────────────────────────────────────────────

export type PrivacyEventListener<E extends PrivacyEvent = PrivacyEvent> =
  (event: E) => void;

// ─── Event bus ───────────────────────────────────────────────────────────────

/**
 * Typed publish/subscribe bus for all Privacy Engine events.
 *
 * Same pattern as SmartVisionEventBus — subscribe via `on()`, receive via
 * listener callback, unsubscribe via the returned disposer.
 */
export interface PrivacyEventBus {
  /** Subscribe to all events of a specific kind. Returns an unsubscribe fn. */
  on<K extends PrivacyEventKind>(
    kind: K,
    listener: PrivacyEventListener<Extract<PrivacyEvent, { kind: K }>>,
  ): () => void;
  /** Unsubscribe all listeners for a kind. */
  off(kind: PrivacyEventKind): void;
  /** Publish an event to all registered listeners. */
  emit(event: PrivacyEvent): void;
  /** Remove all listeners. */
  clear(): void;
}
