/**
 * @platform/smart-vision/privacy — history contracts.
 *
 * PrivacyHistory: per-session append-only observation log.
 * Records every detected privacy object — whether redacted or preserved —
 * for compliance auditing, post-session analytics, and export workflows.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */

import type { FrameIndex, FrameTimestamp } from "../frame";
import type { PrivacyObject, PrivacyObservationId, PrivacyObjectId } from "./types";
import type { PrivacyObjectClass } from "./detection";
import type { PrivacyMask } from "./types";

// ─── Observation record ───────────────────────────────────────────────────────

/**
 * One timestamped snapshot of a privacy object at a given frame.
 *
 * An observation is appended every time:
 *   - A new privacy object is first detected ("privacy.detected" event)
 *   - An existing object changes class, position, or redaction state ("privacy.updated")
 *   - A redaction is applied for the first time for this object ("privacy.redacted")
 *
 * The log is NOT frame-granular (one entry per frame per object) — it is
 * event-granular to stay compact. Applications that need frame-granular
 * audit trails should persist PrivacyFrameResult directly.
 */
export interface PrivacyObservation {
  readonly id: PrivacyObservationId;
  /** Snapshot of the privacy object at the time of this observation. */
  readonly object: Readonly<PrivacyObject>;
  /** The mask applied at this observation point. Null if not redacted. */
  readonly mask: PrivacyMask | null;
  /** What triggered this observation entry. */
  readonly trigger: PrivacyObservationTrigger;
  readonly timestamp: FrameTimestamp;
  readonly frameIndex: FrameIndex;
}

/**
 * What event created this history entry.
 *
 * "detected"   — object newly detected, no prior record this session.
 * "updated"    — object position, confidence, or class changed.
 * "redacted"   — redaction first applied to this object.
 * "restored"   — redaction lifted (policy changed or object reclassified).
 * "lost"       — object left the frame or was evicted by the tracker.
 */
export type PrivacyObservationTrigger =
  | "detected"
  | "updated"
  | "redacted"
  | "restored"
  | "lost";

// ─── History query ────────────────────────────────────────────────────────────

export interface PrivacyHistoryQuery {
  /** Only observations at or after this timestamp. */
  readonly after?: FrameTimestamp;
  /** Only observations at or before this timestamp. */
  readonly before?: FrameTimestamp;
  /** Filter by a specific class. */
  readonly classId?: PrivacyObjectClass;
  /** Filter by a specific object ID. */
  readonly objectId?: PrivacyObjectId;
  /** If true, only include observations where the object was redacted. */
  readonly redactedOnly?: boolean;
  /** If provided, only include observations with this trigger. */
  readonly trigger?: PrivacyObservationTrigger;
  /** Max entries to return. Newest-first when limit is applied. */
  readonly limit?: number;
}

// ─── PrivacyHistory ───────────────────────────────────────────────────────────

/**
 * Append-only event log for a single PrivacySession.
 *
 * Thread safety: append() is called from the engine's async processing loop;
 * query() may be called from any context. Implementations must be safe for
 * concurrent reads with sequential writes.
 */
export interface PrivacyHistory {
  /** Append one observation record. Returns the assigned ID. */
  append(record: Omit<PrivacyObservation, "id">): PrivacyObservation;
  /**
   * Query the history log. Returns observations matching all supplied filters,
   * ordered newest-first.
   */
  query(q?: PrivacyHistoryQuery): readonly PrivacyObservation[];
  /** Convenience: return the `n` most-recent observations. */
  recent(n: number): readonly PrivacyObservation[];
  /** Total observation count. */
  get size(): number;
  /**
   * Remove observations older than `olderThanMs` milliseconds.
   * Returns the number of entries pruned.
   */
  prune(olderThanMs: number): number;
  /** Clear all records. */
  clear(): void;
}
