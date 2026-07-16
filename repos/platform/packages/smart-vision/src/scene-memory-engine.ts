/**
 * @platform/smart-vision — SceneMemoryEngine: first-class scene understanding.
 *
 * Elevates scene memory from a feature inside the SmartVisionEngine to a
 * self-contained subsystem that other platform packages can share. Any package
 * that needs to know "what has already been observed here?" can consume this
 * without depending on the full SmartVisionEngine.
 *
 * ─── Hierarchy ───────────────────────────────────────────────────────────────
 *
 *   SceneMemoryEngine          Top-level orchestrator
 *     ObjectRegistry           Persistent object identities across the scene
 *     SpatialMap               Zones, coverage gaps, navigation hints
 *     ObservationHistory       Timestamped log of what was seen
 *     CaptureHistory           Timestamped log of what was captured
 *     MeasurementHistory       Sensor readings tied to spatial positions
 *
 * ─── Why a separate hierarchy from scene-memory.ts ──────────────────────────
 *
 * scene-memory.ts owns the SmartVision-internal per-session contracts
 * (SceneObservation, DuplicateVerdict, SceneCoverage, SceneMemory). Those
 * remain unchanged for backward compatibility.
 *
 * This module defines the broader, cross-session, cross-subsystem view that
 * survives beyond a single inspection session and can be shared with
 * MeasurementCore, AICore, and future spatial reasoning systems.
 *
 * GOVERNANCE: No domain logic. classId values and measurement unit strings
 * are application-defined. See repos/platform/GOVERNANCE.md.
 */

import type { BoundingBox, TrackId } from "./tracking";
import type { FrameTimestamp, FrameIndex } from "./frame";
import type { SceneCoverage, SceneNavigationHint } from "./scene-memory";

// ─── Branded primitives ───────────────────────────────────────────────────────

export type ObjectRecordId = string & { readonly __brand: "ObjectRecordId" };
export type SpatialZoneId = string & { readonly __brand: "SpatialZoneId" };
export type ObservationRecordId = string & { readonly __brand: "ObservationRecordId" };
export type CaptureRecordId = string & { readonly __brand: "CaptureRecordId" };
export type MeasurementRecordId = string & { readonly __brand: "MeasurementRecordId" };

// ─────────────────────────────────────────────────────────────────────────────
// OBJECT REGISTRY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A persistent identity for an object observed in the scene.
 *
 * Unlike a TrackedRegion (which lives only for the duration of a track),
 * an ObjectRecord persists across tracking gaps, session pauses, and camera
 * movement. It accumulates evidence over time.
 *
 * classId is application-defined. The registry does not interpret it.
 */
export interface ObjectRecord {
  readonly id: ObjectRecordId;
  /** Application-defined class identifier. Platform stores; app interprets. */
  classId: number;
  firstSeenAt: FrameTimestamp;
  lastSeenAt: FrameTimestamp;
  /** How many times this object has been observed (across all observations). */
  observationCount: number;
  /**
   * The last known bounding box of this object in normalised frame coordinates.
   * Updated every time the object is seen.
   */
  lastKnownBox: BoundingBox | null;
  /** Mean detection confidence across all observations: 0–1. */
  meanConfidence: number;
  /** The zone this object was last observed in. Null if spatial mapping is off. */
  lastZoneId: SpatialZoneId | null;
  /** TrackId of the most recent active track for this object, if any. */
  activeTrackId: TrackId | null;
  /** Whether this object has been captured (sent to the application's intake). */
  captured: boolean;
  capturedAt: FrameTimestamp | null;
}

/**
 * Queryable collection of ObjectRecords.
 *
 * The registry associates incoming DetectedObjects with existing ObjectRecords
 * using IoU + classId matching. New objects are registered on first sight.
 */
export interface ObjectRegistry {
  /**
   * Look up a record by its stable id.
   */
  findById(id: ObjectRecordId): ObjectRecord | undefined;
  /**
   * All records for a given classId, ordered by lastSeenAt descending.
   */
  findByClassId(classId: number): readonly ObjectRecord[];
  /**
   * Records whose lastKnownBox overlaps with `box` above the given IoU threshold.
   * Default threshold: 0.3.
   */
  findNear(box: BoundingBox, iouThreshold?: number): readonly ObjectRecord[];
  /**
   * Records observed within the given spatial zone.
   */
  findInZone(zoneId: SpatialZoneId): readonly ObjectRecord[];
  /**
   * All records in descending order of lastSeenAt.
   */
  all(): readonly ObjectRecord[];
  /**
   * Register or update an object sighting.
   * If an existing record matches the detection (by IoU + classId), that record
   * is updated and returned. Otherwise a new record is created.
   */
  upsert(detection: {
    classId: number;
    box: BoundingBox;
    confidence: number;
    trackId?: TrackId;
    timestamp: FrameTimestamp;
    zoneId?: SpatialZoneId;
  }): ObjectRecord;
  /** Mark a record as captured (evidence sent to application intake). */
  markCaptured(id: ObjectRecordId, timestamp: FrameTimestamp): void;
  /** Remove all records. */
  clear(): void;
  /** Total number of records. */
  readonly size: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SPATIAL MAP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A named spatial zone within the scene.
 *
 * Zones are application-defined regions of interest. Their labels are
 * application strings; the SpatialMap stores them without interpretation.
 *
 * Examples of application-defined zones (NOT platform logic):
 *   ReadyLoq: "kitchen_left", "under_sink_right"
 *   VYBE:     "stage_centre", "crowd_front_row"
 */
export interface SpatialZone {
  readonly id: SpatialZoneId;
  /** Application-defined zone label. The platform stores; the app assigns meaning. */
  label: string;
  /** Whether the camera has observed this zone during the current session. */
  observed: boolean;
  firstObservedAt: FrameTimestamp | null;
  lastObservedAt: FrameTimestamp | null;
  /** Cumulative time this zone has been in frame (ms). */
  totalObservedMs: number;
  /** Number of distinct observation passes over this zone. */
  observationCount: number;
  /** Number of captures taken within this zone. */
  captureCount: number;
  /** Priority rank for navigation hints. Higher = visit sooner. */
  navigationPriority: number;
}

/**
 * Spatial understanding of the scene — a collection of named zones with
 * coverage tracking and navigation hint generation.
 *
 * The SpatialMap maintains zone state independently of detection content.
 * It answers: "which zones have I covered?" and "where should I go next?"
 */
export interface SpatialMap {
  /**
   * Define a new zone. No-op if a zone with this id already exists.
   */
  defineZone(zone: Omit<SpatialZone, "observed" | "firstObservedAt" | "lastObservedAt" | "totalObservedMs" | "observationCount" | "captureCount">): void;
  /** All defined zones. */
  zones(): readonly SpatialZone[];
  /** A specific zone by id. */
  getZone(id: SpatialZoneId): SpatialZone | undefined;
  /**
   * Record that the camera was aimed at a zone.
   * Updates observationCount, totalObservedMs, etc.
   */
  markObserved(zoneId: SpatialZoneId, durationMs: number, timestamp: FrameTimestamp): void;
  /** Record that a capture was taken within a zone. */
  markCaptured(zoneId: SpatialZoneId, timestamp: FrameTimestamp): void;
  /**
   * Coverage summary across all defined zones.
   * Mirrors SceneCoverage from scene-memory.ts for compatibility.
   */
  getCoverage(): SceneCoverage;
  /**
   * Ordered list of zones to visit next, based on priority + coverage gaps.
   * Returns the highest-priority unobserved or under-observed zones.
   */
  getNavigationHints(limit?: number): readonly SceneNavigationHint[];
  /** Determine which zone a given bounding box primarily falls within. */
  resolveZone(box: BoundingBox): SpatialZoneId | null;
  /** Reset all zone observation state. Does not remove zone definitions. */
  resetObservations(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVATION HISTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single timestamped observation — one frame worth of detections.
 */
export interface ObservationRecord {
  readonly id: ObservationRecordId;
  frameIndex: FrameIndex;
  timestamp: FrameTimestamp;
  /** All classIds detected in this frame. */
  classIds: readonly number[];
  /** Number of distinct objects detected. */
  objectCount: number;
  /** ObjectRecord IDs updated by this observation. */
  objectIds: readonly ObjectRecordId[];
  /** Zone in frame at the time of observation. */
  zoneId: SpatialZoneId | null;
  /** Overall quality score of this frame (0–100). */
  qualityScore: number;
}

export interface ObservationHistoryQuery {
  /** Only include observations after this timestamp. */
  after?: FrameTimestamp;
  /** Only include observations before this timestamp. */
  before?: FrameTimestamp;
  /** Only include observations containing this classId. */
  classId?: number;
  /** Only include observations in this zone. */
  zoneId?: SpatialZoneId;
  /** Maximum results. 0 = unlimited. */
  limit?: number;
}

/**
 * Queryable, append-only log of all scene observations.
 *
 * Every time the pipeline processes a frame, an ObservationRecord is appended.
 * The history is the authoritative source for "what was seen and when?"
 */
export interface ObservationHistory {
  /** Append a new observation. */
  append(record: Omit<ObservationRecord, "id">): ObservationRecord;
  /** Query observations by time range, classId, or zone. */
  query(q?: ObservationHistoryQuery): readonly ObservationRecord[];
  /** Most recent N observations (newest first). */
  recent(n: number): readonly ObservationRecord[];
  /** Total number of records. */
  readonly size: number;
  /** Discard records older than `olderThanMs` milliseconds. */
  prune(olderThanMs: number): number;
  /** Clear all records. */
  clear(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPTURE HISTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A record of one frame capture event.
 *
 * Created when `AutoCaptureEngine` triggers a capture or the operator manually
 * requests one. Used to answer: "have I already captured this subject?"
 */
export interface CaptureRecord {
  readonly id: CaptureRecordId;
  frameIndex: FrameIndex;
  timestamp: FrameTimestamp;
  /** Index within the session (0-based). */
  captureIndex: number;
  /** Whether triggered automatically or manually. */
  trigger: "auto" | "manual";
  /** ObjectRecord IDs captured in this frame. */
  objectIds: readonly ObjectRecordId[];
  /** Zone at capture time. */
  zoneId: SpatialZoneId | null;
  /** Quality score of the captured frame. */
  qualityScore: number;
  /**
   * Application-assigned identifier for the stored evidence item.
   * Set asynchronously after the application's intake layer confirms storage.
   * Null until confirmed.
   */
  evidenceId: string | null;
  /** pHash of the captured frame for duplicate detection. */
  phash?: string;
}

export interface CaptureHistoryQuery {
  after?: FrameTimestamp;
  before?: FrameTimestamp;
  objectId?: ObjectRecordId;
  zoneId?: SpatialZoneId;
  trigger?: "auto" | "manual";
  limit?: number;
}

/**
 * Queryable, append-only log of all capture events.
 */
export interface CaptureHistory {
  append(record: Omit<CaptureRecord, "id">): CaptureRecord;
  /** Find the capture record by its application evidence ID. */
  findByEvidenceId(evidenceId: string): CaptureRecord | undefined;
  query(q?: CaptureHistoryQuery): readonly CaptureRecord[];
  recent(n: number): readonly CaptureRecord[];
  readonly size: number;
  readonly totalCaptured: number;
  /** Update a record once the application has confirmed storage. */
  confirmEvidence(captureId: CaptureRecordId, evidenceId: string): void;
  clear(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT HISTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single sensor reading associated with a spatial position in the scene.
 *
 * The `unit` and `dimension` are application-defined strings. The platform
 * stores and queries them without interpretation.
 *
 * Examples (application layer assigns meaning — NOT platform logic):
 *   { dimension: "temperature", value: 22.5, unit: "celsius" }
 *   { dimension: "humidity",    value: 68.0, unit: "percent" }
 *   { dimension: "distance",    value: 1.23, unit: "meters"  }
 */
export interface MeasurementRecord {
  readonly id: MeasurementRecordId;
  timestamp: FrameTimestamp;
  /**
   * Application-defined measurement type.
   * The platform stores and queries; the application assigns meaning.
   */
  dimension: string;
  value: number;
  /**
   * Application-defined unit string.
   */
  unit: string;
  /** Zone where this measurement was taken. */
  zoneId: SpatialZoneId | null;
  /** Bounding box of the measured region in the frame (if applicable). */
  regionBox: BoundingBox | null;
  /** ObjectRecord this measurement is associated with (if applicable). */
  objectId: ObjectRecordId | null;
  /**
   * Application-assigned source identifier (device id, sensor type, etc.).
   * The platform stores; the application assigns meaning.
   */
  sourceId?: string;
}

export interface MeasurementHistoryQuery {
  after?: FrameTimestamp;
  before?: FrameTimestamp;
  dimension?: string;
  zoneId?: SpatialZoneId;
  objectId?: ObjectRecordId;
  limit?: number;
}

/**
 * Queryable, append-only log of all sensor measurements.
 *
 * Shared across SmartVision, MeasurementCore, and any AI feature that needs
 * to reason about sensor context (e.g. temperature at a zone, distance to
 * a detected object).
 */
export interface MeasurementHistory {
  append(record: Omit<MeasurementRecord, "id">): MeasurementRecord;
  query(q?: MeasurementHistoryQuery): readonly MeasurementRecord[];
  recent(n: number): readonly MeasurementRecord[];
  /** Latest reading for a given dimension (across all zones). */
  latestFor(dimension: string): MeasurementRecord | undefined;
  /** Latest reading for a dimension within a specific zone. */
  latestForZone(dimension: string, zoneId: SpatialZoneId): MeasurementRecord | undefined;
  readonly size: number;
  prune(olderThanMs: number): number;
  clear(): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENE MEMORY ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SceneMemoryEngine configuration.
 */
export interface SceneMemoryEngineConfig {
  /**
   * Maximum age for ObservationHistory records before they are pruned (ms).
   * 0 = keep forever (until clear() is called).
   * Default: 30 minutes.
   */
  observationTtlMs: number;
  /**
   * IoU threshold for ObjectRegistry upsert — detections above this overlap
   * with an existing record are merged rather than creating a new record.
   * Default: 0.3.
   */
  objectMergeIouThreshold: number;
  /**
   * Maximum number of ObjectRecords to retain per classId.
   * Oldest records are evicted when the limit is exceeded.
   * 0 = unlimited.
   * Default: 0.
   */
  maxObjectsPerClass: number;
  /**
   * Whether to persist history across sessions (application-managed).
   * When true, the engine emits "scene_memory_engine.persist_requested"
   * events so the application can serialise the state.
   * Default: false.
   */
  persistAcrossSessions: boolean;
}

export const DEFAULT_SCENE_MEMORY_ENGINE_CONFIG: SceneMemoryEngineConfig = {
  observationTtlMs: 30 * 60 * 1000,
  objectMergeIouThreshold: 0.3,
  maxObjectsPerClass: 0,
  persistAcrossSessions: false,
};

/**
 * SceneMemoryEngine event kinds.
 */
export type SceneMemoryEngineEventKind =
  | "scene_memory_engine.object_registered"  // new ObjectRecord created
  | "scene_memory_engine.object_captured"    // ObjectRecord marked captured
  | "scene_memory_engine.zone_covered"       // SpatialZone marked observed
  | "scene_memory_engine.coverage_updated"   // SceneCoverage changed
  | "scene_memory_engine.persist_requested"; // application should serialise state

export interface SceneMemoryEngineEvent {
  kind: SceneMemoryEngineEventKind;
  timestamp: FrameTimestamp;
  payload?: Record<string, unknown>;
}

export type SceneMemoryEngineListener = (event: SceneMemoryEngineEvent) => void;

/**
 * SceneMemoryEngine — the top-level scene understanding subsystem.
 *
 * Composes all five sub-registries into one coherent API. Consumer packages
 * only depend on this interface; they do not need to import the individual
 * sub-registry types unless they need fine-grained access.
 *
 * SmartVisionEngine uses SceneMemoryEngine to:
 *   - Track known objects across the session (ObjectRegistry)
 *   - Record and query coverage (SpatialMap)
 *   - Log all observations (ObservationHistory)
 *   - Log all captures (CaptureHistory)
 *   - Correlate sensor readings with spatial context (MeasurementHistory)
 *
 * Future consumers (MeasurementCore, AICore) can share the same
 * SceneMemoryEngine instance so all subsystems see the same spatial context.
 */
export interface SceneMemoryEngine {
  readonly config: SceneMemoryEngineConfig;

  // ── Sub-registries ────────────────────────────────────────────────────────

  readonly objects: ObjectRegistry;
  readonly spatial: SpatialMap;
  readonly observations: ObservationHistory;
  readonly captures: CaptureHistory;
  readonly measurements: MeasurementHistory;

  // ── Cross-registry queries ────────────────────────────────────────────────

  /**
   * Has any region similar to `box` been recently captured?
   * Uses CaptureHistory + ObjectRegistry to answer without re-running hashing.
   */
  isRecentlyCaptured(box: BoundingBox, windowMs?: number): boolean;

  /**
   * Returns the combined scene understanding snapshot:
   *   - current spatial coverage
   *   - next navigation hints
   *   - top uncaptured objects
   */
  getSceneSummary(): SceneSummary;

  // ── Session management ────────────────────────────────────────────────────

  /**
   * Reset all session-scoped state (observations, active tracks, zone coverage
   * counters) while preserving cross-session object records if
   * `persistAcrossSessions` is enabled.
   */
  resetSession(): void;

  /**
   * Reset all state completely — equivalent to creating a new engine.
   */
  reset(): void;

  // ── Events ────────────────────────────────────────────────────────────────

  on(kind: SceneMemoryEngineEventKind, listener: SceneMemoryEngineListener): () => void;
  off(kind: SceneMemoryEngineEventKind): void;
}

// ─── Scene summary ────────────────────────────────────────────────────────────

export interface SceneSummary {
  coverage: SceneCoverage;
  navigationHints: readonly SceneNavigationHint[];
  /**
   * Objects detected but not yet captured, ordered by descending meanConfidence.
   */
  uncapturedObjects: readonly ObjectRecord[];
  /** Total objects registered in this session. */
  totalObjects: number;
  /** Total captures taken in this session. */
  totalCaptures: number;
  /** Total observations recorded in this session. */
  totalObservations: number;
}
