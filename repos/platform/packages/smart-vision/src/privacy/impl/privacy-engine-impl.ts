/**
 * @platform/smart-vision/privacy — concrete PrivacyEngine, PrivacySession, PrivacyFactory.
 *
 * Wires together detector → tracker → policy → mask builder → renderer → events → history.
 *
 * ORIGINAL MEDIA PRESERVATION:
 *   feedFrame() / processImage() never mutate the input VideoFrame.
 *   Masks are passed to the renderer; the renderer produces a separate copy.
 *   Applications decide which layer to display or store.
 *
 * ZERO DOMAIN LOGIC:
 *   The engine reads policy data; it never hardcodes which classes to redact.
 */

import type { VideoFrame, FrameTimestamp, FrameIndex } from "../../frame";
import type { PrivacyEngineDependencies, PrivacyEngine, PrivacyEngineState, PrivacyFactory, PrivacySession } from "../engine";
import type { PrivacyPolicy, PrivacyObjectPolicy, PrivacyPolicyMap } from "../policy";
import type { PrivacyConfiguration } from "../config";
import type { PrivacyObject, PrivacyObjectId, PrivacyMask, PrivacyFrameResult, PrivacyStatistics, PrivacyClassStats, PrivacyZone } from "../types";
import type { PrivacyObjectClass, PrivacyDetectionRequest } from "../detection";
import type { PrivacyEvent, PrivacyEventBus, PrivacyEventKind, PrivacyEventListener } from "../events";
import type { PrivacyHistory } from "../history";
import type { PrivacyRenderer } from "../renderer";

import { DEFAULT_PRIVACY_CONFIGURATION } from "../config";
import { createPrivacyHistory } from "./privacy-history-impl";
import { createPrivacyTracker } from "./privacy-tracker";
import type { PrivacyObservationTrigger } from "../history";

// ─── Event bus ────────────────────────────────────────────────────────────────

function createPrivacyEventBus(): PrivacyEventBus {
  const listeners = new Map<PrivacyEventKind, PrivacyEventListener[]>();

  return {
    on<K extends PrivacyEventKind>(
      kind: K,
      listener: PrivacyEventListener<Extract<PrivacyEvent, { kind: K }>>,
    ): () => void {
      let list = listeners.get(kind);
      if (!list) { list = []; listeners.set(kind, list); }
      list.push(listener as PrivacyEventListener);
      return () => {
        const l = listeners.get(kind);
        if (l) { const i = l.indexOf(listener as PrivacyEventListener); if (i >= 0) l.splice(i, 1); }
      };
    },
    off(kind: PrivacyEventKind): void { listeners.delete(kind); },
    emit(event: PrivacyEvent): void {
      const list = listeners.get(event.kind);
      if (list) for (const fn of list) { try { fn(event); } catch { /* isolate */ } }
    },
    clear(): void { listeners.clear(); },
  };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function ts(): FrameTimestamp { return Date.now() as FrameTimestamp; }
function fi(frame: VideoFrame): FrameIndex { return frame.meta.index; }
function ft(frame: VideoFrame): FrameTimestamp { return frame.meta.timestamp; }

function buildPolicyMap(policy: PrivacyPolicy): PrivacyPolicyMap {
  const map: PrivacyPolicyMap = new Map();
  for (const entry of policy.objects) {
    map.set(entry.classId, entry);
  }
  return map;
}

interface Box { x: number; y: number; width: number; height: number }

function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const inter = ix * iy;
  if (inter === 0) return 0;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

function boxesOverlap(a: Box, b: Box, threshold = 0.1): boolean {
  return iou(a, b) >= threshold;
}

function applyPadding(box: Box, padding: number): Box {
  const dx = box.width * padding;
  const dy = box.height * padding;
  return {
    x: Math.max(0, box.x - dx),
    y: Math.max(0, box.y - dy),
    width: Math.min(1 - Math.max(0, box.x - dx), box.width + 2 * dx),
    height: Math.min(1 - Math.max(0, box.y - dy), box.height + 2 * dy),
  };
}

// ─── Running stats ────────────────────────────────────────────────────────────

interface RunningStats {
  totalFrames: number;
  inferenceFrames: number;
  trackedFrames: number;
  skippedFrames: number;
  uniqueObjectIds: Set<PrivacyObjectId>;
  totalRedactions: number;
  totalInferenceMs: number;
  byClass: Map<PrivacyObjectClass, { detected: number; redacted: number; totalConf: number }>;
  peakObjects: number;
}

function emptyRunningStats(): RunningStats {
  return {
    totalFrames: 0,
    inferenceFrames: 0,
    trackedFrames: 0,
    skippedFrames: 0,
    uniqueObjectIds: new Set(),
    totalRedactions: 0,
    totalInferenceMs: 0,
    byClass: new Map(),
    peakObjects: 0,
  };
}

function recordStatsUpdate(
  stats: RunningStats,
  objects: readonly PrivacyObject[],
  masks: readonly PrivacyMask[],
  inferenceMs: number,
  wasInferenceFrame: boolean,
  skipped: boolean,
): void {
  if (skipped) { stats.skippedFrames++; return; }
  stats.totalFrames++;
  if (wasInferenceFrame) {
    stats.inferenceFrames++;
    stats.totalInferenceMs += inferenceMs;
  } else {
    stats.trackedFrames++;
  }
  stats.totalRedactions += masks.length;
  stats.peakObjects = Math.max(stats.peakObjects, objects.length);

  for (const obj of objects) {
    stats.uniqueObjectIds.add(obj.id);
    let cls = stats.byClass.get(obj.classId);
    if (!cls) { cls = { detected: 0, redacted: 0, totalConf: 0 }; stats.byClass.set(obj.classId, cls); }
    cls.detected++;
    cls.totalConf += obj.confidence;
  }
  for (const mask of masks) {
    const cls = stats.byClass.get(mask.classId);
    if (cls) cls.redacted++;
  }
}

function buildStatistics(stats: RunningStats, sessionId: string, startMs: number): PrivacyStatistics {
  const durationMs = Date.now() - startMs;
  const inferenceCount = stats.inferenceFrames || 1;
  const byClass: Partial<Record<PrivacyObjectClass, PrivacyClassStats>> = {};
  for (const [classId, cls] of stats.byClass) {
    byClass[classId] = {
      detected: cls.detected,
      redacted: cls.redacted,
      averageConfidence: cls.detected > 0 ? cls.totalConf / cls.detected : 0,
    };
  }
  const totalFrameCount = stats.totalFrames || 1;
  return {
    sessionId,
    durationMs,
    totalFrames: stats.totalFrames,
    inferenceFrames: stats.inferenceFrames,
    trackedFrames: stats.trackedFrames,
    skippedFrames: stats.skippedFrames,
    uniqueObjectsDetected: stats.uniqueObjectIds.size,
    totalRedactions: stats.totalRedactions,
    byClass,
    averageInferenceMs: stats.totalInferenceMs / inferenceCount,
    averageObjectsPerFrame: stats.totalRedactions / totalFrameCount,
    peakObjectsInFrame: stats.peakObjects,
  };
}

// ─── Mask builder ─────────────────────────────────────────────────────────────

function buildMasksFromPolicy(
  objects: readonly PrivacyObject[],
  policyMap: PrivacyPolicyMap,
  policy: PrivacyPolicy,
  config: PrivacyConfiguration,
  timestamp: FrameTimestamp,
  frameIndex: FrameIndex,
): PrivacyMask[] {
  const masks: PrivacyMask[] = [];
  const neverRedactZones = (policy.zones ?? []).filter(z => z.mode === "never_redact");
  const alwaysRedactZones = (policy.zones ?? []).filter(z => z.mode === "always_redact");
  const detectAndRedactZones = (policy.zones ?? []).filter(z => z.mode === "detect_and_redact");

  // Per-object masks
  for (const obj of objects) {
    const objPolicy = policyMap.get(obj.classId);

    let shouldRedact: boolean;
    let redactionType = policy.defaultRedactionType;
    let strength = policy.defaultStrength;
    let padding = 0;
    const threshold = objPolicy?.confidenceThreshold ?? config.confidenceThreshold;

    if (obj.confidence < threshold) continue;

    if (objPolicy) {
      shouldRedact = objPolicy.redact;
      if (shouldRedact) {
        redactionType = objPolicy.redactionType;
        strength = objPolicy.strength;
        padding = objPolicy.padding ?? 0;
      }
    } else {
      shouldRedact = policy.redactUnknownClasses;
    }

    if (!shouldRedact) continue;

    // Check "never_redact" zones — suppress if object overlaps a protected zone
    const paddedBox = padding > 0 ? applyPadding(obj.box, padding) : obj.box;
    const suppressed = neverRedactZones.some(z => boxesOverlap(paddedBox, z.region));
    if (suppressed) continue;

    masks.push({
      objectId: obj.id,
      classId: obj.classId,
      box: paddedBox,
      redactionType,
      strength,
      padding,
      timestamp,
      frameIndex,
    });
  }

  // Always-redact zones — add a mask regardless of detections
  for (const zone of alwaysRedactZones) {
    if (!zone.redactionType) continue;
    masks.push({
      objectId: `zone-${zone.id}` as PrivacyObjectId,
      classId: "custom",
      box: zone.region,
      redactionType: zone.redactionType,
      strength: zone.strength ?? policy.defaultStrength,
      padding: 0,
      timestamp,
      frameIndex,
    });
  }

  // Detect-and-redact zones — add mask only if an object was detected inside
  for (const zone of detectAndRedactZones) {
    if (!zone.redactionType) continue;
    const hasObjectInZone = objects.some(o => boxesOverlap(o.box, zone.region, 0.2));
    if (hasObjectInZone) {
      masks.push({
        objectId: `zone-${zone.id}` as PrivacyObjectId,
        classId: "custom",
        box: zone.region,
        redactionType: zone.redactionType,
        strength: zone.strength ?? policy.defaultStrength,
        padding: 0,
        timestamp,
        frameIndex,
      });
    }
  }

  return masks;
}

// ─── PrivacySessionImpl ───────────────────────────────────────────────────────

let _sessionSeq = 0;
function newSessionId(): string { return `pvs-${Date.now()}-${++_sessionSeq}`; }

class PrivacySessionImpl implements PrivacySession {
  readonly sessionId: string;
  readonly events: PrivacyEventBus;

  private _policy: PrivacyPolicy;
  private _policyMap: PrivacyPolicyMap;
  private _config: PrivacyConfiguration;
  private _renderer: PrivacyRenderer | null;

  private readonly deps: PrivacyEngineDependencies;
  private readonly tracker: ReturnType<typeof createPrivacyTracker>;
  private readonly history: PrivacyHistory;
  private readonly stats: RunningStats;
  private readonly startMs: number;

  private frameCount = 0;
  private stopped = false;

  // Previous redaction state — for "privacy.redacted" / "privacy.restored" events
  private previouslyRedacted = new Set<PrivacyObjectId>();

  constructor(
    deps: PrivacyEngineDependencies,
    policy: PrivacyPolicy,
    config: PrivacyConfiguration,
    parentEvents: PrivacyEventBus,
  ) {
    this.sessionId = newSessionId();
    this.deps = deps;
    this._policy = policy;
    this._policyMap = buildPolicyMap(policy);
    this._config = config;
    this._renderer = deps.renderer ?? null;
    this.events = createPrivacyEventBus();
    this.history = createPrivacyHistory();
    this.stats = emptyRunningStats();
    this.startMs = Date.now();
    this.tracker = createPrivacyTracker({
      maxMissingFrames: config.maxMissingFrames,
      iouThreshold: config.trackingIouThreshold,
      maxTrackedObjects: config.maxTrackedObjects,
    });

    // Bridge: also forward all session events to the parent engine bus
    const bridge = (event: PrivacyEvent) => { try { parentEvents.emit(event); } catch { /* */ } };
    const kinds: PrivacyEventKind[] = [
      "privacy.session.started", "privacy.session.stopped", "privacy.session.error",
      "privacy.detected", "privacy.updated", "privacy.lost",
      "privacy.redacted", "privacy.restored", "privacy.policy_changed",
      "privacy.renderer_changed", "privacy.frame.processed",
    ];
    for (const k of kinds) {
      this.events.on(k as PrivacyEventKind, bridge as PrivacyEventListener);
    }

    this.events.emit({
      kind: "privacy.session.started",
      sessionId: this.sessionId,
      timestamp: ts(),
      policyId: policy.id,
      detectorId: deps.provider.providerId,
      rendererId: this._renderer?.rendererId ?? null,
    });
  }

  get policy(): PrivacyPolicy { return this._policy; }
  get config(): PrivacyConfiguration { return this._config; }

  // ── Frame processing ─────────────────────────────────────────────────────────

  async feedFrame(frame: VideoFrame): Promise<PrivacyFrameResult> {
    if (this.stopped || !this._config.enabled || !this._config.liveVideo) {
      return this.emptyResult(frame, true);
    }
    return this.processFrameInternal(frame, false);
  }

  async processImage(frame: VideoFrame): Promise<PrivacyFrameResult> {
    if (this.stopped || !this._config.enabled || !this._config.capturedImages) {
      return this.emptyResult(frame, true);
    }
    return this.processFrameInternal(frame, true);
  }

  private async processFrameInternal(frame: VideoFrame, forceInference: boolean): Promise<PrivacyFrameResult> {
    const pipelineStart = Date.now();
    const stamp = ft(frame);
    const frameIndex = fi(frame);
    const cfg = this._config;

    const isInferenceFrame = forceInference || (this.frameCount % cfg.detectionStrideFrames === 0);
    this.frameCount++;

    let inferenceMs = 0;
    let skippedInference = false;
    let newObjects: readonly PrivacyObject[] = [];
    let updatedObjects: readonly PrivacyObject[] = [];
    let lostObjects: readonly PrivacyObject[] = [];
    let activeObjects: readonly PrivacyObject[] = this.tracker.getActive();

    if (isInferenceFrame) {
      const classes = this.getRequestedClasses();
      if (classes.length > 0) {
        try {
          const request: PrivacyDetectionRequest = {
            classes,
            confidenceThreshold: cfg.confidenceThreshold,
            ...(cfg.maxTrackedObjects > 0 ? { maxObjectsPerClass: cfg.maxTrackedObjects } : {}),
          };
          const result = await this.deps.provider.detect(frame, request);
          inferenceMs = result.inferenceMs;

          if (cfg.trackingEnabled) {
            const tracked = this.tracker.updateFromDetections(result.objects, stamp, frameIndex);
            activeObjects = tracked.active;
            newObjects = tracked.newObjects;
            updatedObjects = tracked.updatedObjects;
            lostObjects = tracked.lostObjects;
          } else {
            // No tracking — rebuild from detections each frame
            this.tracker.reset();
            const tracked = this.tracker.updateFromDetections(result.objects, stamp, frameIndex);
            activeObjects = tracked.active;
            newObjects = tracked.newObjects;
            updatedObjects = [];
            lostObjects = [];
          }
        } catch (err) {
          // Detection failed; keep existing tracked state but tick missing frames
          skippedInference = true;
          lostObjects = this.tracker.tickMissing(frameIndex);
          activeObjects = this.tracker.getActive();
        }
      } else {
        // Policy requests no classes — clear tracker
        this.tracker.reset();
        activeObjects = [];
        skippedInference = true;
      }
    } else {
      // Non-inference frame: tick missing frames, extrapolate via last-known positions
      skippedInference = true;
      lostObjects = this.tracker.tickMissing(frameIndex);
      activeObjects = this.tracker.getActive();
    }

    // Apply policy and build masks
    const masks = buildMasksFromPolicy(
      activeObjects,
      this._policyMap,
      this._policy,
      cfg,
      stamp,
      frameIndex,
    );

    // Update redaction state on objects + emit object-level events
    this.processObjectEvents(activeObjects, masks, newObjects, updatedObjects, lostObjects, stamp, frameIndex);

    // Render
    if (this._renderer && (masks.length > 0 || cfg.alwaysRender)) {
      try {
        await this._renderer.render({ frame, masks });
      } catch { /* renderer errors don't fail the frame */ }
    }

    const totalMs = Date.now() - pipelineStart;
    recordStatsUpdate(this.stats, activeObjects, masks, inferenceMs, isInferenceFrame, false);

    this.events.emit({
      kind: "privacy.frame.processed",
      sessionId: this.sessionId,
      timestamp: stamp,
      frameIndex,
      objectCount: activeObjects.length,
      masksApplied: masks.length,
      skippedInference,
      totalMs,
    });

    return { frameIndex, timestamp: stamp, activeObjects, masks, skippedInference, inferenceMs, totalMs };
  }

  private emptyResult(frame: VideoFrame, skipped: boolean): PrivacyFrameResult {
    if (skipped) this.stats.skippedFrames++;
    return {
      frameIndex: fi(frame),
      timestamp: ft(frame),
      activeObjects: [],
      masks: [],
      skippedInference: skipped,
      inferenceMs: 0,
      totalMs: 0,
    };
  }

  private getRequestedClasses(): readonly PrivacyObjectClass[] {
    const classes = new Set<PrivacyObjectClass>();
    for (const entry of this._policy.objects) {
      if (entry.redact) {
        classes.add(entry.classId);
      }
    }
    // Providers may also detect classes that the policy wants to preserve
    // but we only request classes that the provider supports
    const supported = new Set(this.deps.provider.supportedClasses);
    return [...classes].filter(c => supported.has(c));
  }

  private processObjectEvents(
    activeObjects: readonly PrivacyObject[],
    masks: readonly PrivacyMask[],
    newObjects: readonly PrivacyObject[],
    updatedObjects: readonly PrivacyObject[],
    lostObjects: readonly PrivacyObject[],
    stamp: FrameTimestamp,
    frameIndex: FrameIndex,
  ): void {
    const redactedIds = new Set(masks.map(m => m.objectId));

    // Update redaction state on objects (side-effectful, but objects are mutable)
    for (const obj of activeObjects) {
      const shouldBeRedacted = redactedIds.has(obj.id);
      const prevRedacted = obj.redacted;
      const prevType = obj.redactionType;

      obj.redacted = shouldBeRedacted;
      obj.redactionType = shouldBeRedacted
        ? (masks.find(m => m.objectId === obj.id)?.redactionType ?? null)
        : null;

      if (shouldBeRedacted && !this.previouslyRedacted.has(obj.id)) {
        this.previouslyRedacted.add(obj.id);
        const mask = masks.find(m => m.objectId === obj.id);
        if (mask) {
          this.events.emit({ kind: "privacy.redacted", sessionId: this.sessionId, timestamp: stamp, object: { ...obj }, mask, frameIndex });
          this.history.append({ object: { ...obj }, mask, trigger: "redacted", timestamp: stamp, frameIndex });
        }
      } else if (!shouldBeRedacted && this.previouslyRedacted.has(obj.id) && prevRedacted) {
        this.previouslyRedacted.delete(obj.id);
        this.events.emit({ kind: "privacy.restored", sessionId: this.sessionId, timestamp: stamp, object: { ...obj }, reason: "policy_changed", frameIndex });
        this.history.append({ object: { ...obj }, mask: null, trigger: "restored", timestamp: stamp, frameIndex });
      }
    }

    // New objects
    for (const obj of newObjects) {
      this.events.emit({ kind: "privacy.detected", sessionId: this.sessionId, timestamp: stamp, object: { ...obj }, frameIndex });
      this.history.append({ object: { ...obj }, mask: null, trigger: "detected", timestamp: stamp, frameIndex });
    }

    // Updated objects
    for (const obj of updatedObjects) {
      this.events.emit({
        kind: "privacy.updated",
        sessionId: this.sessionId,
        timestamp: stamp,
        object: { ...obj },
        frameIndex,
        changedFields: ["box", "confidence"],
      });
    }

    // Lost objects
    for (const obj of lostObjects) {
      this.previouslyRedacted.delete(obj.id);
      this.events.emit({ kind: "privacy.lost", sessionId: this.sessionId, timestamp: stamp, object: { ...obj }, trackLength: obj.trackLength });
      this.history.append({ object: { ...obj }, mask: null, trigger: "lost", timestamp: stamp, frameIndex });
    }
  }

  // ── Policy / renderer management ─────────────────────────────────────────────

  updatePolicy(policy: PrivacyPolicy): void {
    const prev = this._policy;
    this._policy = policy;
    this._policyMap = buildPolicyMap(policy);
    this.events.emit({
      kind: "privacy.policy_changed",
      sessionId: this.sessionId,
      timestamp: ts(),
      previousPolicyId: prev.id,
      newPolicyId: policy.id,
    });
  }

  async updateRenderer(renderer: PrivacyRenderer | null): Promise<void> {
    const prev = this._renderer;
    if (prev) {
      try { await prev.destroy(); } catch { /* */ }
    }
    this._renderer = renderer;
    this.events.emit({
      kind: "privacy.renderer_changed",
      sessionId: this.sessionId,
      timestamp: ts(),
      previousRendererId: prev?.rendererId ?? null,
      newRendererId: renderer?.rendererId ?? null,
    });
    if (renderer) renderer.reset();
  }

  // ── State inspection ─────────────────────────────────────────────────────────

  getActiveObjects(): readonly PrivacyObject[] {
    return this.tracker.getActive();
  }

  getHistory(): PrivacyHistory { return this.history; }

  getStatistics(): PrivacyStatistics {
    return buildStatistics(this.stats, this.sessionId, this.startMs);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  reset(): void {
    this.tracker.reset();
    this.history.clear();
    this.previouslyRedacted.clear();
    this.frameCount = 0;
    Object.assign(this.stats, emptyRunningStats());
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const totalMs = Date.now() - this.startMs;

    if (this._renderer) {
      try { await this._renderer.destroy(); } catch { /* */ }
    }

    this.events.emit({
      kind: "privacy.session.stopped",
      sessionId: this.sessionId,
      timestamp: ts(),
      durationMs: totalMs,
      totalFrames: this.stats.totalFrames,
      totalRedactions: this.stats.totalRedactions,
    });

    this.tracker.reset();
    this.events.clear();
  }
}

// ─── PrivacyEngineImpl ────────────────────────────────────────────────────────

class PrivacyEngineImpl implements PrivacyEngine {
  private _state: PrivacyEngineState = "idle";
  private _activeSession: PrivacySessionImpl | null = null;
  readonly events: PrivacyEventBus;

  constructor(private readonly deps: PrivacyEngineDependencies) {
    this.events = createPrivacyEventBus();
  }

  get state(): PrivacyEngineState { return this._state; }

  async startSession(policy: PrivacyPolicy, config?: Partial<PrivacyConfiguration>): Promise<PrivacySession> {
    // Stop any existing session
    if (this._activeSession) {
      await this._activeSession.stop();
      this._activeSession = null;
    }

    // Initialise provider
    this._state = "running";
    try {
      await this.deps.provider.initialize();
    } catch (err) {
      this._state = "error";
      throw err;
    }

    const effectiveConfig: PrivacyConfiguration = {
      ...DEFAULT_PRIVACY_CONFIGURATION,
      ...config,
    };

    const session = new PrivacySessionImpl(this.deps, policy, effectiveConfig, this.events);
    this._activeSession = session;
    return session;
  }

  async destroy(): Promise<void> {
    this._state = "stopping";
    if (this._activeSession) {
      await this._activeSession.stop();
      this._activeSession = null;
    }
    try { await this.deps.provider.destroy(); } catch { /* */ }
    this.events.clear();
    this._state = "idle";
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create the Privacy Engine factory.
 *
 * Usage:
 *   const factory = createPrivacyFactory();
 *   const engine  = factory.createEngine({ provider: myProvider });
 *   const session = await engine.startSession(myPolicy);
 *   const result  = await session.feedFrame(frame);
 */
export function createPrivacyFactory(): PrivacyFactory {
  return {
    createEngine(deps: PrivacyEngineDependencies): PrivacyEngine {
      return new PrivacyEngineImpl(deps);
    },
  };
}
