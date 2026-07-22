/**
 * @platform/smart-vision — scene memory contracts.
 *
 * Scene Memory transforms Smart Vision from a frame-by-frame analyser into a
 * continuously-aware capture engine. Rather than treating each incoming frame
 * in isolation, the engine maintains a live spatial record of everything that
 * has already been processed in the current scene and uses that record to:
 *
 *   - Avoid re-capturing or re-running inference on regions already processed.
 *   - Score incoming regions for novelty before committing resources.
 *   - Track scene-level coverage and guide the operator toward unexplored areas.
 *   - Persist and restore memory across brief interruptions (app background,
 *     provider reconnect, session hand-off).
 *
 * ─── ARCHITECTURE ────────────────────────────────────────────────────────────
 *
 * Three layered concerns:
 *
 *   1. Observations — what was seen, where, when, and at what confidence.
 *      The caller supplies kind ("captured", "inferred", …) and an optional
 *      label. No domain strings appear here.
 *
 *   2. Scene anchoring — stable visual reference points that allow the
 *      memory to re-project observations when the camera moves. Without
 *      anchoring, memory is valid only in frame-relative coordinates and
 *      must be invalidated on significant camera movement. With anchoring,
 *      memory persists across camera motion.
 *
 *   3. Coverage + novelty + navigation — aggregate outputs that drive
 *      auto-capture suppression, operator guidance, and session reporting.
 *
 * ─── COORDINATE SPACES ───────────────────────────────────────────────────────
 *
 *   "frame"          — observations are in the current frame's coordinate
 *                      space [0,1]². Fast, no re-projection needed. Memory is
 *                      invalidated when camera moves beyond the drift threshold.
 *
 *   "anchor_relative" — observations are expressed relative to a detected
 *                       SceneAnchor. Memory survives camera motion as long as
 *                       the anchor remains visible. Recommended default.
 *
 *   "world"          — full SLAM / odometry-based world coordinates. Expensive;
 *                      use only when the implementation provides a pose solver.
 *
 * Domain-neutral: "what was seen" is fully caller-defined. The memory records
 * a region, a kind string, and optional metadata. No pest / creator /
 * product-specific terminology appears anywhere in this file.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */
import type { BoundingBox, TrackId } from "./tracking";
import type { FrameTimestamp } from "./frame";
/** Stable identifier for a single observation stored in scene memory. */
export type ObservationId = string & {
    readonly __brand: "ObservationId";
};
/** Stable identifier for a scene anchor feature point. */
export type AnchorId = string & {
    readonly __brand: "AnchorId";
};
/**
 * Novelty score: how "new" a region is relative to stored observations.
 *
 * 0.0 = the region has been fully processed and is entirely known.
 * 1.0 = the region is completely unprocessed — high priority for capture.
 *
 * Intermediate values represent partial overlap with existing observations.
 */
export type NoveltyScore = number & {
    readonly __brand: "NoveltyScore";
};
/**
 * Spatial overlap score between two regions (Intersection over Union).
 * 0.0 = no overlap; 1.0 = identical regions.
 */
export type OverlapScore = number & {
    readonly __brand: "OverlapScore";
};
/**
 * What processing was applied when an observation was recorded.
 *
 * The platform defines a set of structural primitives. Applications extend
 * this with their own domain-specific verbs by widening the type:
 *
 *   type AppKind = ObservationKind | "treatment_applied" | "defect_logged";
 *
 * The scene memory accepts any string — these are the platform defaults.
 */
export type ObservationKind = "captured" | "inferred" | "measured" | "evaluated" | "skipped";
export type SceneCoordinateSpace = "frame" | "anchor_relative" | "world";
/**
 * A single record in scene memory.
 *
 * `region` is always expressed in the memory's configured SceneCoordinateSpace.
 * Callers must project incoming frame-space regions into scene space before
 * recording (or use the memory's built-in reprojection when anchoring is active).
 */
export interface SceneObservation {
    readonly id: ObservationId;
    /** Spatial region this observation covers, in the memory's coordinate space. */
    readonly region: BoundingBox;
    /**
     * What was done to this region. Use one of the platform ObservationKind values
     * or a caller-defined string. Must not contain domain-specific identifiers
     * in the platform layer.
     */
    readonly kind: string;
    /** Epoch milliseconds when this observation was recorded. */
    readonly timestamp: number;
    /**
     * Caller-defined label — never interpreted by the scene memory engine.
     * Applications use this for display and filtering (e.g. "zone-3-north-wall").
     */
    readonly label?: string;
    /**
     * The TrackId this observation is associated with, if the subject was
     * actively tracked when the observation was recorded.
     */
    readonly trackId?: TrackId;
    /** Tracker or model confidence at the time of recording: 0–1. */
    readonly confidence?: number;
    /**
     * True while the observation is within its configured TTL.
     * Stale observations are retained for coverage accounting but are not
     * used to suppress future captures.
     */
    fresh: boolean;
    /**
     * Application-defined key/value bag for contextual data.
     * Scene memory stores and retrieves this opaque object; it does not
     * interpret any field within it.
     */
    readonly metadata?: Record<string, unknown>;
}
/**
 * Result of checking whether an incoming region duplicates existing observations.
 *
 * "duplicate" — the region substantially overlaps one or more fresh
 *               observations of the same kind; skip processing.
 * "novel"     — no significant overlap found; proceed with capture/inference.
 * "partial"   — partial overlap; the region extends beyond known observations.
 *               The engine may crop to the unexplored portion or proceed at
 *               reduced priority.
 */
export type DuplicateVerdictKind = "duplicate" | "novel" | "partial";
export interface DuplicateVerdict {
    verdict: DuplicateVerdictKind;
    /** Composite novelty score for the queried region: 0–1. */
    novelty: NoveltyScore;
    /** The subset of existing observations that overlap the queried region. */
    matchingObservations: readonly SceneObservation[];
    /**
     * Highest individual overlap score among all matches.
     * 0 when no matches found.
     */
    maxOverlap: OverlapScore;
}
/**
 * A single cell in the coverage grid.
 *
 * The scene is discretised into a grid of equal-sized cells.
 * Each cell tracks whether it has been processed and, if so, when.
 */
export interface CoverageCell {
    /** Grid row index (0-based). */
    row: number;
    /** Grid column index (0-based). */
    col: number;
    /** Region this cell maps to in scene coordinates. */
    region: BoundingBox;
    /** True if at least one fresh observation covers this cell. */
    processed: boolean;
    /** Timestamp of the most recent fresh observation covering this cell. */
    lastObservedAt?: number;
    /**
     * Number of distinct fresh observations that cover this cell.
     * Higher = more thoroughly processed.
     */
    observationCount: number;
}
/**
 * Aggregate scene coverage report.
 *
 * Updated on every `record()` and `gc()` call; callers can poll this for
 * real-time coverage feedback without iterating all observations.
 */
export interface SceneCoverage {
    /**
     * Fraction of the scene grid that has at least one fresh observation: 0–1.
     * 0.0 = nothing processed; 1.0 = full coverage.
     */
    processedFraction: number;
    /** Total number of observations (fresh + stale). */
    totalObservations: number;
    /** Number of fresh (within-TTL) observations. */
    freshObservations: number;
    /** Number of stale (expired) observations retained for history. */
    staleObservations: number;
    /** Per-cell breakdown. Length = gridRows × gridColumns. */
    cells: readonly CoverageCell[];
    /** Timestamp of the last coverage update. */
    updatedAt: number;
}
/**
 * Priority of a navigation hint.
 *
 * "high"   — the recommended direction to move next (largest unprocessed area).
 * "medium" — a secondary option when the primary is not reachable.
 * "low"    — minor coverage gap; scene is largely complete.
 */
export type NavigationPriority = "high" | "medium" | "low";
/**
 * A directional hint produced by the scene memory engine to guide the
 * operator toward unexplored areas.
 *
 * Navigation hints are expressed as normalised direction vectors from the
 * current frame centre. Implementations convert these to device-native cues
 * (arrow overlays, haptic nudges, voice prompts) in the application layer.
 */
export interface SceneNavigationHint {
    priority: NavigationPriority;
    /**
     * Normalised direction vector from the current frame centre to the
     * suggested movement target. Both components in [-1, 1].
     *   (+1, 0) = move right; (-1, 0) = move left
     *   (0, +1) = move down;  (0, -1) = move up
     */
    direction: {
        dx: number;
        dy: number;
    };
    /**
     * The unprocessed region the hint is pointing toward.
     * Null when the hint is directional-only (e.g. "pan left") with no
     * specific target identified.
     */
    targetRegion: BoundingBox | null;
    /**
     * Estimated fraction of the target region that has NOT been processed: 0–1.
     * 1.0 = completely unvisited; lower values indicate partial coverage.
     */
    unprocessedFraction: number;
    /**
     * Human-readable rationale for diagnostics and adaptive UI.
     * Not intended for direct end-user display; application layer localises.
     */
    rationale?: string;
}
/**
 * A stable visual reference point detected in the scene.
 *
 * Anchors allow the memory to survive camera motion. When the camera pans or
 * tilts, anchor-relative observation coordinates can be reprojected into the
 * new frame position as long as the anchor remains visible.
 */
export interface SceneAnchor {
    readonly id: AnchorId;
    /** Normalised position in the frame where this anchor was first detected. */
    readonly framePosition: {
        x: number;
        y: number;
    };
    /**
     * Compact visual descriptor hash for this anchor (implementation-defined).
     * Used to reidentify the anchor in subsequent frames via feature matching.
     */
    readonly descriptorHash: string;
    /** Confidence that this anchor is stable and distinguishable: 0–1. */
    confidence: number;
    readonly detectedAt: FrameTimestamp;
    /** Updated each time this anchor is successfully reidentified in a new frame. */
    lastSeenAt: FrameTimestamp;
    /** Whether this anchor was successfully matched in the most recent frame. */
    active: boolean;
}
/**
 * Manages the lifecycle of scene anchors and coordinate reprojection.
 *
 * Applications provide an implementation (feature detector + matcher);
 * this package owns the contract.
 */
export interface SceneAnchoring {
    /** All currently known anchors, active or inactive. */
    readonly anchors: readonly SceneAnchor[];
    /**
     * Detect and register new anchors from a frame.
     * Should be called on key-frames only (e.g. every 10th frame) for performance.
     * Returns newly added anchors.
     */
    detect(frame: {
        data: Uint8Array | Uint8ClampedArray;
        width: number;
        height: number;
    }): readonly SceneAnchor[];
    /**
     * Match existing anchors against the current frame.
     * Updates `active` and `lastSeenAt` on each anchor.
     * Returns the set of anchors successfully matched.
     */
    match(frame: {
        data: Uint8Array | Uint8ClampedArray;
        width: number;
        height: number;
    }): readonly SceneAnchor[];
    /**
     * Reproject a frame-space BoundingBox into anchor-relative coordinates.
     * Returns null when no reliable anchor is available.
     */
    toAnchorSpace(box: BoundingBox, referenceAnchor: AnchorId): BoundingBox | null;
    /**
     * Reproject an anchor-relative BoundingBox back into the current frame space.
     * Returns null when the reference anchor is not currently visible.
     */
    toFrameSpace(box: BoundingBox, referenceAnchor: AnchorId): BoundingBox | null;
    /** Discard all anchors and reset to an un-anchored state. */
    reset(): void;
}
export interface SceneMemoryConfig {
    /** Coordinate space for stored observations (default: "anchor_relative"). */
    coordinateSpace: SceneCoordinateSpace;
    /**
     * Time-to-live for observations in milliseconds.
     * After this period, observations are marked stale and excluded from
     * duplicate suppression. Set to Infinity to keep all observations fresh
     * for the entire session.
     */
    observationTtlMs: number;
    /**
     * IoU threshold above which two regions are considered "the same location".
     * Used by `checkDuplicate()` and `novelty()`. Default: 0.5.
     */
    overlapThreshold: number;
    /**
     * Maximum number of fresh observations to retain. When the limit is reached,
     * the oldest observations are marked stale automatically.
     * 0 = unlimited.
     */
    maxFreshObservations: number;
    /**
     * Grid dimensions for coverage tracking.
     * A finer grid gives more precise coverage maps but uses more memory.
     * Default: 8 × 8 = 64 cells.
     */
    coverageGrid: {
        rows: number;
        cols: number;
    };
    /**
     * Minimum novelty score required before scene memory emits a navigation
     * hint toward a region. Below this threshold the region is considered
     * adequately covered. Default: 0.3.
     */
    navigationNoveltyThreshold: number;
}
export interface SceneMemoryQuery {
    /** Restrict results to observations whose regions overlap this bounding box. */
    region?: BoundingBox;
    /** Restrict to specific observation kinds. */
    kinds?: readonly string[];
    /** Include stale (expired) observations (default: false). */
    includeStale?: boolean;
    /** Minimum confidence to include (0–1). */
    minConfidence?: number;
    /** Observations associated with a specific track. */
    trackId?: TrackId;
    /**
     * Maximum number of results to return.
     * Results are ordered newest-first. 0 = unlimited.
     */
    limit?: number;
}
/**
 * A serialisable point-in-time snapshot of the scene memory.
 *
 * Used for persistence (write to KV store / disk between sessions), handoff
 * between workers, and debug inspection.
 */
export interface SceneSnapshot {
    version: 1;
    capturedAt: number;
    config: SceneMemoryConfig;
    observations: readonly SceneObservation[];
    anchors: readonly SceneAnchor[];
    coverage: SceneCoverage;
}
export type SceneMemoryEventKind = "observation.recorded" | "observation.expired" | "coverage.updated" | "anchor.detected" | "anchor.lost" | "memory.cleared" | "memory.restored";
export interface SceneMemoryEvent {
    kind: SceneMemoryEventKind;
    timestamp: number;
    observationId?: ObservationId;
    anchorId?: AnchorId;
}
/**
 * Live spatial memory of the scene.
 *
 * Call `record()` after every evidence capture or inference pass.
 * Call `checkDuplicate()` before triggering capture or AI inference.
 * Call `navigationHints()` to guide the operator to unexplored areas.
 * Call `gc()` periodically (or after each session frame) to expire stale entries.
 *
 * Thread-safety: implementations should assume single-threaded call sequences
 * within a frame (i.e. no concurrent `record` + `gc`). Callers serialise access.
 */
export interface SceneMemory {
    readonly config: SceneMemoryConfig;
    /**
     * Record a new observation against the given region.
     *
     * @param entry   Observation to record (id and fresh are assigned by the memory).
     * @returns       The assigned ObservationId.
     */
    record(entry: Omit<SceneObservation, "id" | "fresh">): ObservationId;
    /**
     * Explicitly remove an observation (e.g. if the operator corrects a
     * mistaken capture). Removing an observation increases novelty scores
     * in the affected region on the next query.
     */
    remove(id: ObservationId): boolean;
    /**
     * Expire observations that have exceeded their TTL.
     * Should be called at a cadence appropriate for the session (e.g. every 5 s).
     *
     * @returns Number of observations marked stale in this pass.
     */
    gc(): number;
    /**
     * Wipe all observations and reset coverage. Anchors are preserved unless
     * `resetAnchors` is true.
     */
    clear(options?: {
        resetAnchors?: boolean;
    }): void;
    /**
     * Check whether an incoming region substantially overlaps existing
     * observations of the given kind(s). The primary duplicate-suppression gate.
     *
     * Call this before any capture or inference operation to determine whether
     * the engine should skip processing.
     */
    checkDuplicate(region: BoundingBox, kinds: readonly string[]): DuplicateVerdict;
    /**
     * Score the novelty of a region without performing a full duplicate check.
     * Cheaper than `checkDuplicate` — suitable for per-frame hot-path calls.
     *
     * Returns a NoveltyScore in [0, 1]. A score below the memory's configured
     * `overlapThreshold` means the region is well-known; above it, the region
     * is a candidate for capture.
     */
    novelty(region: BoundingBox): NoveltyScore;
    /**
     * Return observations matching the given query, ordered newest-first.
     */
    query(options?: SceneMemoryQuery): readonly SceneObservation[];
    /** Retrieve a specific observation by id. */
    get(id: ObservationId): SceneObservation | undefined;
    /** Current count of fresh observations. */
    readonly freshCount: number;
    /** Current count of all observations (fresh + stale). */
    readonly totalCount: number;
    /**
     * Aggregate coverage report for the current scene.
     * The report is incrementally maintained — this getter is O(1).
     */
    readonly coverage: SceneCoverage;
    /**
     * Produce navigation hints ordered by priority (high → medium → low).
     *
     * Returns an empty array when coverage is complete or no unprocessed
     * regions can be identified in the current frame context.
     *
     * @param currentView  The region of the scene currently visible in the frame.
     *                     Hints are constrained to be reachable from this view.
     */
    navigationHints(currentView: BoundingBox): readonly SceneNavigationHint[];
    /**
     * Export the current memory state as a serialisable snapshot.
     * Applications persist this to KV storage between sessions.
     */
    snapshot(): SceneSnapshot;
    /**
     * Restore memory from a previously exported snapshot.
     * Emits a "memory.restored" event after hydration.
     */
    restore(snapshot: SceneSnapshot): void;
    /**
     * Subscribe to scene memory lifecycle events.
     * @returns An unsubscribe function; call it to remove the listener.
     */
    on(listener: (event: SceneMemoryEvent) => void): () => void;
}
/**
 * Persistence adapter for scene memory snapshots.
 *
 * Concrete implementations may write to AsyncStorage, SQLite, a KV store,
 * or any other durable medium. The SceneMemory interface calls this via the
 * application's DI wiring — it is not called directly by smart-vision.
 */
export interface SceneMemoryStore {
    /** Persist a snapshot under the given key. */
    save(key: string, snapshot: SceneSnapshot): Promise<void>;
    /** Load a previously saved snapshot. Returns null if not found. */
    load(key: string): Promise<SceneSnapshot | null>;
    /** Delete a saved snapshot. */
    delete(key: string): Promise<void>;
}
//# sourceMappingURL=scene-memory.d.ts.map