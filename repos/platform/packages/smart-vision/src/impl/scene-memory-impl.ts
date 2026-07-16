/**
 * @platform/smart-vision — concrete SceneMemory implementation.
 *
 * In-memory observation store with:
 *   - IoU-based duplicate detection
 *   - Coverage grid (configurable rows×cols)
 *   - TTL-based freshness
 *   - Navigation hints toward unprocessed cells
 */

import type { BoundingBox } from "../tracking";
import type { FrameTimestamp } from "../frame";
import type {
  CoverageCell,
  DuplicateVerdict,
  NoveltyScore,
  ObservationId,
  OverlapScore,
  SceneCoverage,
  SceneMemory,
  SceneMemoryConfig,
  SceneMemoryEvent,
  SceneMemoryQuery,
  SceneNavigationHint,
  SceneObservation,
  SceneSnapshot,
} from "../scene-memory";
import type { TrackId } from "../tracking";

let _obsSeq = 0;
function newObsId(): ObservationId {
  return `obs-${Date.now()}-${++_obsSeq}` as ObservationId;
}

function computeIou(a: BoundingBox, b: BoundingBox): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  if (inter === 0) return 0;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

const DEFAULT_CONFIG: SceneMemoryConfig = {
  coordinateSpace: "frame",
  observationTtlMs: 5 * 60 * 1000,
  overlapThreshold: 0.5,
  maxFreshObservations: 0,
  coverageGrid: { rows: 8, cols: 8 },
  navigationNoveltyThreshold: 0.3,
};

export function createSceneMemory(
  partial: Partial<SceneMemoryConfig> = {},
): SceneMemory {
  const config: SceneMemoryConfig = { ...DEFAULT_CONFIG, ...partial };
  const { rows, cols } = config.coverageGrid;

  const observations = new Map<ObservationId, SceneObservation>();
  const listeners: ((event: SceneMemoryEvent) => void)[] = [];

  // Coverage grid: rows×cols cells; each cell tracks freshObsCount and lastSeen
  const gridObsCount: number[] = new Array(rows * cols).fill(0);
  const gridLastSeen: number[] = new Array(rows * cols).fill(0);

  let _freshCount = 0;
  let _coverage: SceneCoverage | null = null;

  function emit(event: SceneMemoryEvent) {
    for (const fn of listeners) { try { fn(event); } catch { /* isolate */ } }
  }

  function cellIndex(row: number, col: number): number { return row * cols + col; }

  function cellBox(row: number, col: number): BoundingBox {
    return { x: col / cols, y: row / rows, width: 1 / cols, height: 1 / rows };
  }

  function markCellsCovered(box: BoundingBox, timestamp: number): void {
    // Cells that the box overlaps
    const c0 = Math.max(0, Math.floor(box.x * cols));
    const c1 = Math.min(cols - 1, Math.floor((box.x + box.width) * cols));
    const r0 = Math.max(0, Math.floor(box.y * rows));
    const r1 = Math.min(rows - 1, Math.floor((box.y + box.height) * rows));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const idx = cellIndex(r, c);
        gridObsCount[idx] = (gridObsCount[idx] ?? 0) + 1;
        gridLastSeen[idx] = Math.max(gridLastSeen[idx] ?? 0, timestamp);
      }
    }
  }

  function recomputeCoverage(): SceneCoverage {
    const now = Date.now();
    const cells: CoverageCell[] = [];
    let processed = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = cellIndex(r, c);
        const obsCount = gridObsCount[idx] ?? 0;
        const lastSeen = gridLastSeen[idx] ?? 0;
        const isFresh = obsCount > 0 && (config.observationTtlMs === Infinity || now - lastSeen < config.observationTtlMs);
        if (isFresh) processed++;
        cells.push({
          row: r,
          col: c,
          region: cellBox(r, c),
          processed: isFresh,
          ...(lastSeen > 0 ? { lastObservedAt: lastSeen as FrameTimestamp } : {}),
          observationCount: obsCount,
        });
      }
    }
    const total = rows * cols;
    return {
      processedFraction: total > 0 ? processed / total : 0,
      totalObservations: observations.size,
      freshObservations: _freshCount,
      staleObservations: observations.size - _freshCount,
      cells,
      updatedAt: now,
    };
  }

  function invalidateCoverage() { _coverage = null; }

  function getFreshObservations(): SceneObservation[] {
    const now = Date.now();
    return [...observations.values()].filter(
      o => o.fresh && (config.observationTtlMs === Infinity || now - o.timestamp < config.observationTtlMs),
    );
  }

  return {
    get config() { return config; },
    get freshCount() { return _freshCount; },
    get totalCount() { return observations.size; },

    record(entry: Omit<SceneObservation, "id" | "fresh">): ObservationId {
      const id = newObsId();
      const obs: SceneObservation = { ...entry, id, fresh: true };
      observations.set(id, obs);
      _freshCount++;
      markCellsCovered(obs.region, obs.timestamp);
      invalidateCoverage();

      // Enforce maxFreshObservations
      if (config.maxFreshObservations > 0 && _freshCount > config.maxFreshObservations) {
        // Mark oldest fresh as stale
        for (const o of observations.values()) {
          if (o.fresh) {
            o.fresh = false;
            _freshCount--;
            if (_freshCount <= config.maxFreshObservations) break;
          }
        }
      }

      emit({ kind: "observation.recorded", timestamp: Date.now(), observationId: id });
      return id;
    },

    remove(id: ObservationId): boolean {
      const obs = observations.get(id);
      if (!obs) return false;
      if (obs.fresh) _freshCount--;
      observations.delete(id);
      invalidateCoverage();
      return true;
    },

    gc(): number {
      const now = Date.now();
      if (config.observationTtlMs === Infinity) return 0;
      let expired = 0;
      for (const obs of observations.values()) {
        if (obs.fresh && now - obs.timestamp >= config.observationTtlMs) {
          obs.fresh = false;
          _freshCount--;
          expired++;
          emit({ kind: "observation.expired", timestamp: now, observationId: obs.id });
        }
      }
      if (expired > 0) invalidateCoverage();
      return expired;
    },

    clear(options?: { resetAnchors?: boolean }): void {
      observations.clear();
      _freshCount = 0;
      gridObsCount.fill(0);
      gridLastSeen.fill(0);
      invalidateCoverage();
      emit({ kind: "memory.cleared", timestamp: Date.now() });
      void options; // anchors not implemented in this version
    },

    checkDuplicate(region: BoundingBox, kinds: readonly string[]): DuplicateVerdict {
      const fresh = getFreshObservations().filter(
        o => kinds.length === 0 || kinds.includes(o.kind),
      );
      let maxOverlap = 0;
      const matching: SceneObservation[] = [];
      for (const obs of fresh) {
        const iou = computeIou(region, obs.region);
        if (iou > 0) { matching.push(obs); if (iou > maxOverlap) maxOverlap = iou; }
      }
      const novelty = Math.max(0, 1 - maxOverlap) as NoveltyScore;
      let verdict: DuplicateVerdict["verdict"];
      if (maxOverlap >= config.overlapThreshold) {
        verdict = "duplicate";
      } else if (maxOverlap > 0) {
        verdict = "partial";
      } else {
        verdict = "novel";
      }
      return { verdict, novelty, matchingObservations: matching, maxOverlap: maxOverlap as OverlapScore };
    },

    novelty(region: BoundingBox): NoveltyScore {
      const fresh = getFreshObservations();
      let maxOverlap = 0;
      for (const obs of fresh) {
        const iou = computeIou(region, obs.region);
        if (iou > maxOverlap) maxOverlap = iou;
      }
      return Math.max(0, 1 - maxOverlap) as NoveltyScore;
    },

    query(options?: SceneMemoryQuery): readonly SceneObservation[] {
      const now = Date.now();
      const includeStale = options?.includeStale ?? false;
      const limit = options?.limit ?? 0;

      let result = [...observations.values()].filter(o => {
        if (!includeStale && !o.fresh) return false;
        if (options?.kinds && !options.kinds.includes(o.kind)) return false;
        if (options?.minConfidence != null && (o.confidence ?? 1) < options.minConfidence) return false;
        if (options?.trackId && o.trackId !== options.trackId) return false;
        if (options?.region) {
          if (computeIou(o.region, options.region) === 0) return false;
        }
        void now;
        return true;
      });

      // Newest-first
      result.sort((a, b) => b.timestamp - a.timestamp);
      if (limit > 0) result = result.slice(0, limit);
      return result;
    },

    get(id: ObservationId): SceneObservation | undefined {
      return observations.get(id);
    },

    get coverage(): SceneCoverage {
      if (!_coverage) _coverage = recomputeCoverage();
      return _coverage;
    },

    navigationHints(currentView: BoundingBox): readonly SceneNavigationHint[] {
      const cov = this.coverage;
      const hints: SceneNavigationHint[] = [];
      const viewCx = currentView.x + currentView.width / 2;
      const viewCy = currentView.y + currentView.height / 2;

      const unprocessed = cov.cells.filter(c => !c.processed);
      if (unprocessed.length === 0) return [];

      // Sort by distance from current view centre
      const withDist = unprocessed.map(c => {
        const cx = c.region.x + c.region.width / 2;
        const cy = c.region.y + c.region.height / 2;
        const dx = cx - viewCx;
        const dy = cy - viewCy;
        return { c, dx, dy, dist: Math.sqrt(dx * dx + dy * dy) };
      });
      withDist.sort((a, b) => a.dist - b.dist);

      const take = Math.min(3, withDist.length);
      for (let i = 0; i < take; i++) {
        const { c, dx, dy, dist } = withDist[i]!;
        const mag = dist > 0 ? dist : 1;
        hints.push({
          priority: i === 0 ? "high" : i === 1 ? "medium" : "low",
          direction: { dx: dx / mag, dy: dy / mag },
          targetRegion: c.region,
          unprocessedFraction: 1,
          rationale: `Unprocessed cell at row ${c.row}, col ${c.col}`,
        });
      }
      return hints;
    },

    snapshot(): SceneSnapshot {
      return {
        version: 1,
        capturedAt: Date.now(),
        config,
        observations: [...observations.values()],
        anchors: [],
        coverage: this.coverage,
      };
    },

    restore(snap: SceneSnapshot): void {
      observations.clear();
      _freshCount = 0;
      gridObsCount.fill(0);
      gridLastSeen.fill(0);
      for (const obs of snap.observations) {
        observations.set(obs.id, { ...obs });
        if (obs.fresh) _freshCount++;
        markCellsCovered(obs.region, obs.timestamp);
      }
      invalidateCoverage();
      emit({ kind: "memory.restored", timestamp: Date.now() });
    },

    on(listener: (event: SceneMemoryEvent) => void): () => void {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  };
}
