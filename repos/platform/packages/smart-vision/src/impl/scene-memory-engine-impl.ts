/**
 * @platform/smart-vision — concrete SceneMemoryEngine implementation.
 *
 * Composes five in-memory sub-registries into one coherent scene-understanding
 * API. All registries are single-session, in-memory, and serialisable via
 * `getSceneSummary()`.
 */

import type { BoundingBox, TrackId } from "../tracking";
import type { FrameIndex, FrameTimestamp } from "../frame";
import type { SceneCoverage, SceneNavigationHint } from "../scene-memory";
import type {
  CaptureHistory,
  CaptureHistoryQuery,
  CaptureRecord,
  CaptureRecordId,
  MeasurementHistory,
  MeasurementHistoryQuery,
  MeasurementRecord,
  MeasurementRecordId,
  ObjectRecord,
  ObjectRecordId,
  ObjectRegistry,
  ObservationHistory,
  ObservationHistoryQuery,
  ObservationRecord,
  ObservationRecordId,
  SceneMemoryEngine,
  SceneMemoryEngineConfig,
  SceneMemoryEngineEventKind,
  SceneMemoryEngineListener,
  SceneSummary,
  SpatialMap,
  SpatialZone,
  SpatialZoneId,
} from "../scene-memory-engine";

// ─── ID factories ─────────────────────────────────────────────────────────────

let _seq = 0;
const uid = () => `${Date.now()}-${++_seq}`;
const objId = () => `obj-${uid()}` as ObjectRecordId;
const zoneId = () => `zone-${uid()}` as SpatialZoneId;
const obsId = () => `orec-${uid()}` as ObservationRecordId;
const capId = () => `crec-${uid()}` as CaptureRecordId;
const measId = () => `mrec-${uid()}` as MeasurementRecordId;

// ─── IoU helper ───────────────────────────────────────────────────────────────

function iou(a: BoundingBox, b: BoundingBox): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  if (inter === 0) return 0;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

// ─── ObjectRegistry ───────────────────────────────────────────────────────────

function makeObjectRegistry(mergeIou: number): ObjectRegistry {
  const records = new Map<ObjectRecordId, ObjectRecord>();

  return {
    findById(id: ObjectRecordId) { return records.get(id); },

    findByClassId(classId: number): readonly ObjectRecord[] {
      return [...records.values()]
        .filter(r => r.classId === classId)
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    },

    findNear(box: BoundingBox, threshold: number = 0.3): readonly ObjectRecord[] {
      return [...records.values()].filter(r => r.lastKnownBox && iou(box, r.lastKnownBox) >= threshold);
    },

    findInZone(zId: SpatialZoneId): readonly ObjectRecord[] {
      return [...records.values()].filter(r => r.lastZoneId === zId);
    },

    all(): readonly ObjectRecord[] {
      return [...records.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    },

    upsert(detection: { classId: number; box: BoundingBox; confidence: number; trackId?: TrackId; timestamp: FrameTimestamp; zoneId?: SpatialZoneId }): ObjectRecord {
      // Find a matching existing record (same classId + IoU overlap)
      let best: ObjectRecord | null = null;
      let bestIou = mergeIou - 0.001;
      for (const r of records.values()) {
        if (r.classId !== detection.classId) continue;
        if (!r.lastKnownBox) continue;
        const score = iou(detection.box, r.lastKnownBox);
        if (score > bestIou) { best = r; bestIou = score; }
      }

      if (best) {
        best.lastSeenAt = detection.timestamp;
        best.observationCount++;
        best.lastKnownBox = detection.box;
        best.meanConfidence = (best.meanConfidence * (best.observationCount - 1) + detection.confidence) / best.observationCount;
        if (detection.trackId) best.activeTrackId = detection.trackId;
        if (detection.zoneId) best.lastZoneId = detection.zoneId;
        return best;
      }

      const record: ObjectRecord = {
        id: objId(),
        classId: detection.classId,
        firstSeenAt: detection.timestamp,
        lastSeenAt: detection.timestamp,
        observationCount: 1,
        lastKnownBox: detection.box,
        meanConfidence: detection.confidence,
        lastZoneId: detection.zoneId ?? null,
        activeTrackId: detection.trackId ?? null,
        captured: false,
        capturedAt: null,
      };
      records.set(record.id, record);
      return record;
    },

    markCaptured(id: ObjectRecordId, timestamp: FrameTimestamp): void {
      const r = records.get(id);
      if (r) { r.captured = true; r.capturedAt = timestamp; }
    },

    clear(): void { records.clear(); },
    get size() { return records.size; },
  };
}

// ─── SpatialMap ───────────────────────────────────────────────────────────────

function makeSpatialMap(): SpatialMap {
  const zones = new Map<SpatialZoneId, SpatialZone>();

  function emptyZone(def: { id: SpatialZoneId; label: string; navigationPriority: number }): SpatialZone {
    return { ...def, observed: false, firstObservedAt: null, lastObservedAt: null, totalObservedMs: 0, observationCount: 0, captureCount: 0 };
  }

  return {
    defineZone(zone): void {
      if (!zones.has(zone.id)) zones.set(zone.id, emptyZone(zone));
    },

    zones(): readonly SpatialZone[] { return [...zones.values()]; },

    getZone(id: SpatialZoneId): SpatialZone | undefined { return zones.get(id); },

    markObserved(zoneId: SpatialZoneId, durationMs: number, timestamp: FrameTimestamp): void {
      const z = zones.get(zoneId);
      if (!z) return;
      z.observed = true;
      z.firstObservedAt = z.firstObservedAt ?? timestamp;
      z.lastObservedAt = timestamp;
      z.totalObservedMs += durationMs;
      z.observationCount++;
    },

    markCaptured(zoneId: SpatialZoneId, _ts: FrameTimestamp): void {
      const z = zones.get(zoneId);
      if (z) z.captureCount++;
    },

    getCoverage(): SceneCoverage {
      const all = [...zones.values()];
      const now = Date.now();
      const processed = all.filter(z => z.observed).length;
      return {
        processedFraction: all.length > 0 ? processed / all.length : 0,
        totalObservations: all.reduce((s, z) => s + z.observationCount, 0),
        freshObservations: processed,
        staleObservations: all.length - processed,
        cells: all.map((z, i) => ({
          row: i,
          col: 0,
          region: { x: 0, y: i / all.length, width: 1, height: 1 / (all.length || 1) },
          processed: z.observed,
          ...(z.lastObservedAt != null ? { lastObservedAt: z.lastObservedAt } : {}),
          observationCount: z.observationCount,
        })),
        updatedAt: now,
      };
    },

    getNavigationHints(limit: number = 3): readonly SceneNavigationHint[] {
      const unvisited = [...zones.values()]
        .filter(z => !z.observed)
        .sort((a, b) => b.navigationPriority - a.navigationPriority)
        .slice(0, limit);

      return unvisited.map((z, i) => ({
        priority: i === 0 ? "high" : i === 1 ? "medium" : "low",
        direction: { dx: 0, dy: 1 },
        targetRegion: null,
        unprocessedFraction: 1,
        rationale: `Zone "${z.label}" not yet observed`,
      }));
    },

    resolveZone(box: BoundingBox): SpatialZoneId | null {
      // Find the zone whose region most overlaps with the box
      // Zones defined without a region — match by label/priority order
      let best: SpatialZone | null = null;
      for (const z of zones.values()) {
        if (!best || z.navigationPriority > best.navigationPriority) best = z;
      }
      return best?.id ?? null;
    },

    resetObservations(): void {
      for (const z of zones.values()) {
        z.observed = false;
        z.firstObservedAt = null;
        z.lastObservedAt = null;
        z.totalObservedMs = 0;
        z.observationCount = 0;
        z.captureCount = 0;
      }
    },
  };
}

// ─── ObservationHistory ───────────────────────────────────────────────────────

function makeObservationHistory(ttlMs: number): ObservationHistory {
  const log: ObservationRecord[] = [];

  return {
    append(record: Omit<ObservationRecord, "id">): ObservationRecord {
      const r: ObservationRecord = { ...record, id: obsId() };
      log.push(r);
      return r;
    },

    query(q?: ObservationHistoryQuery): readonly ObservationRecord[] {
      let result = [...log];
      if (q?.after) result = result.filter(r => r.timestamp > q.after!);
      if (q?.before) result = result.filter(r => r.timestamp < q.before!);
      if (q?.classId != null) result = result.filter(r => r.classIds.includes(q.classId!));
      if (q?.zoneId) result = result.filter(r => r.zoneId === q.zoneId);
      result.reverse(); // newest first
      if (q?.limit && q.limit > 0) result = result.slice(0, q.limit);
      return result;
    },

    recent(n: number): readonly ObservationRecord[] {
      return [...log].reverse().slice(0, n);
    },

    get size() { return log.length; },

    prune(olderThanMs: number): number {
      const cutoff = Date.now() - olderThanMs;
      let removed = 0;
      for (let i = log.length - 1; i >= 0; i--) {
        if ((log[i]?.timestamp ?? 0) < cutoff) { log.splice(i, 1); removed++; }
      }
      return removed;
    },

    clear(): void { log.length = 0; },
  };
}

// ─── CaptureHistory ───────────────────────────────────────────────────────────

function makeCaptureHistory(): CaptureHistory {
  const log: CaptureRecord[] = [];

  return {
    append(record: Omit<CaptureRecord, "id">): CaptureRecord {
      const r: CaptureRecord = { ...record, id: capId() };
      log.push(r);
      return r;
    },

    findByEvidenceId(evidenceId: string): CaptureRecord | undefined {
      return log.find(r => r.evidenceId === evidenceId);
    },

    query(q?: CaptureHistoryQuery): readonly CaptureRecord[] {
      let result = [...log];
      if (q?.after) result = result.filter(r => r.timestamp > q.after!);
      if (q?.before) result = result.filter(r => r.timestamp < q.before!);
      if (q?.trigger) result = result.filter(r => r.trigger === q.trigger);
      if (q?.zoneId) result = result.filter(r => r.zoneId === q.zoneId);
      result.reverse();
      if (q?.limit && q.limit > 0) result = result.slice(0, q.limit);
      return result;
    },

    recent(n: number): readonly CaptureRecord[] {
      return [...log].reverse().slice(0, n);
    },

    get size() { return log.length; },
    get totalCaptured() { return log.length; },

    confirmEvidence(id: CaptureRecordId, evidenceId: string): void {
      const r = log.find(r => r.id === id);
      if (r) (r as { evidenceId: string | null }).evidenceId = evidenceId;
    },

    clear(): void { log.length = 0; },
  };
}

// ─── MeasurementHistory ───────────────────────────────────────────────────────

function makeMeasurementHistory(): MeasurementHistory {
  const log: MeasurementRecord[] = [];

  return {
    append(record: Omit<MeasurementRecord, "id">): MeasurementRecord {
      const r: MeasurementRecord = { ...record, id: measId() };
      log.push(r);
      return r;
    },

    query(q?: MeasurementHistoryQuery): readonly MeasurementRecord[] {
      let result = [...log];
      if (q?.after) result = result.filter(r => r.timestamp > q.after!);
      if (q?.before) result = result.filter(r => r.timestamp < q.before!);
      if (q?.dimension) result = result.filter(r => r.dimension === q.dimension);
      if (q?.zoneId) result = result.filter(r => r.zoneId === q.zoneId);
      if (q?.objectId) result = result.filter(r => r.objectId === q.objectId);
      result.reverse();
      if (q?.limit && q.limit > 0) result = result.slice(0, q.limit);
      return result;
    },

    recent(n: number): readonly MeasurementRecord[] {
      return [...log].reverse().slice(0, n);
    },

    latestFor(dimension: string): MeasurementRecord | undefined {
      for (let i = log.length - 1; i >= 0; i--) {
        if (log[i]?.dimension === dimension) return log[i];
      }
      return undefined;
    },

    latestForZone(dimension: string, zId: SpatialZoneId): MeasurementRecord | undefined {
      for (let i = log.length - 1; i >= 0; i--) {
        const r = log[i];
        if (r?.dimension === dimension && r.zoneId === zId) return r;
      }
      return undefined;
    },

    get size() { return log.length; },

    prune(olderThanMs: number): number {
      const cutoff = Date.now() - olderThanMs;
      let removed = 0;
      for (let i = log.length - 1; i >= 0; i--) {
        if ((log[i]?.timestamp ?? 0) < cutoff) { log.splice(i, 1); removed++; }
      }
      return removed;
    },

    clear(): void { log.length = 0; },
  };
}

// ─── SceneMemoryEngine ────────────────────────────────────────────────────────

export function createSceneMemoryEngine(
  partial: Partial<SceneMemoryEngineConfig> = {},
): SceneMemoryEngine {
  const config: SceneMemoryEngineConfig = {
    observationTtlMs: partial.observationTtlMs ?? 30 * 60 * 1000,
    objectMergeIouThreshold: partial.objectMergeIouThreshold ?? 0.3,
    maxObjectsPerClass: partial.maxObjectsPerClass ?? 0,
    persistAcrossSessions: partial.persistAcrossSessions ?? false,
  };

  const _objects = makeObjectRegistry(config.objectMergeIouThreshold);
  const _spatial = makeSpatialMap();
  const _observations = makeObservationHistory(config.observationTtlMs);
  const _captures = makeCaptureHistory();
  const _measurements = makeMeasurementHistory();
  const eventListeners = new Map<SceneMemoryEngineEventKind, SceneMemoryEngineListener[]>();

  function emit(kind: SceneMemoryEngineEventKind, payload?: Record<string, unknown>) {
    const ts = Date.now() as FrameTimestamp;
    const list = eventListeners.get(kind) ?? [];
    const evt = payload !== undefined ? { kind, timestamp: ts, payload } : { kind, timestamp: ts };
    for (const fn of list) { try { fn(evt); } catch { /* isolate */ } }
  }

  return {
    get config() { return config; },
    get objects() { return _objects; },
    get spatial() { return _spatial; },
    get observations() { return _observations; },
    get captures() { return _captures; },
    get measurements() { return _measurements; },

    isRecentlyCaptured(box: BoundingBox, windowMs: number = 30000): boolean {
      const since = (Date.now() - windowMs) as FrameTimestamp;
      const recent = _captures.query({ after: since });
      if (recent.length === 0) return false;
      const nearObjects = _objects.all().filter(
        r => r.captured && r.capturedAt && r.capturedAt > since && r.lastKnownBox && iou(box, r.lastKnownBox) >= 0.3,
      );
      return nearObjects.length > 0;
    },

    getSceneSummary(): SceneSummary {
      const coverage = _spatial.getCoverage();
      const navigationHints = _spatial.getNavigationHints(3);
      const uncapturedObjects = _objects.all().filter(r => !r.captured).sort((a, b) => b.meanConfidence - a.meanConfidence);
      return {
        coverage,
        navigationHints,
        uncapturedObjects,
        totalObjects: _objects.size,
        totalCaptures: _captures.size,
        totalObservations: _observations.size,
      };
    },

    resetSession(): void {
      _observations.clear();
      _captures.clear();
      _spatial.resetObservations();
      if (!config.persistAcrossSessions) _objects.clear();
    },

    reset(): void {
      _objects.clear();
      _spatial.resetObservations();
      _observations.clear();
      _captures.clear();
      _measurements.clear();
    },

    on(kind: SceneMemoryEngineEventKind, listener: SceneMemoryEngineListener): () => void {
      let list = eventListeners.get(kind);
      if (!list) { list = []; eventListeners.set(kind, list); }
      list.push(listener);
      return () => {
        const l = eventListeners.get(kind);
        if (l) { const i = l.indexOf(listener); if (i >= 0) l.splice(i, 1); }
      };
    },

    off(kind: SceneMemoryEngineEventKind): void {
      eventListeners.delete(kind);
    },
  };
}

// Re-export types that consumers expect from this module
export type { SceneMemoryEngineConfig };
