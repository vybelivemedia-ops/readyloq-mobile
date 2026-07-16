/**
 * @platform/smart-vision — concrete SmartVisionEngine + SmartVisionSession.
 *
 * The engine wires together all injectable sub-systems into a single
 * frame-processing pipeline. Domain logic lives exclusively in the injected
 * dependencies; the engine is policy-agnostic.
 *
 * Processing stages per frame (all gated by feature flags):
 *   1. Stability estimation (always)
 *   2. Quality scoring
 *   3. Detection inference (on detection-stride frames only)
 *   4. Object tracking + motion prediction
 *   5. Scene memory duplicate check
 *   6. Auto-capture policy evaluation
 *   7. Guidance engine evaluation
 *   8. Event emission
 */

import type {
  CaptureResult,
  CaptureRequest,
  DeepPartial,
  SmartVisionDependencies,
  SmartVisionEngine,
  SmartVisionEngineState,
  SmartVisionFactory,
  SmartVisionSession,
  SmartVisionSnapshot,
} from "../engine";
import type { FrameTimestamp, VideoFrame } from "../frame";
import type { FrameQualityReport } from "../quality";
import type { TrackedRegion, TrackId } from "../tracking";
import type { GuidanceContext, GuidanceDirective } from "../guidance";
import type { CapturePolicyContext, CaptureDecision, CapturePolicy } from "../capture-policy";
import type { StabilityMeasure } from "../auto-capture";
import type { DetectionResult } from "../detection";
import type { SceneObservation, DuplicateVerdict, NoveltyScore, OverlapScore } from "../scene-memory";
import type { SmartVisionConfig } from "../config";
import type { SmartVisionEventBus } from "../events";
import type { VisionCapabilities, NegotiatedVisionConfig } from "../capability";

import { DEFAULT_SMART_VISION_CONFIG } from "../config";
import { createEventBus } from "./event-bus";
import { createFrameScheduler } from "./frame-scheduler";
import { createStabilityEstimator } from "./stability";
import { createAutoCaptureEngine } from "./auto-capture-engine";
import { createBuiltInPolicy } from "./capture-policies";

// ─── Utilities ────────────────────────────────────────────────────────────────

function ts(): FrameTimestamp { return Date.now() as FrameTimestamp; }

function deepMerge<T extends object>(target: T, source: DeepPartial<T>): T {
  for (const key in source) {
    const sv = source[key as keyof typeof source];
    const tv = target[key as keyof T];
    if (sv !== undefined) {
      if (sv !== null && typeof sv === "object" && !Array.isArray(sv) && tv !== null && typeof tv === "object") {
        deepMerge(tv as object, sv as DeepPartial<object>);
      } else {
        (target as Record<string, unknown>)[key] = sv;
      }
    }
  }
  return target;
}

const NOVEL_VERDICT: DuplicateVerdict = {
  verdict: "novel",
  novelty: 1 as NoveltyScore,
  matchingObservations: [],
  maxOverlap: 0 as OverlapScore,
};

const FALLBACK_QUALITY: FrameQualityReport = {
  overall: 75,
  acceptable: true,
  dimensions: [],
  advisories: [],
};

// ─── SmartVisionSession ───────────────────────────────────────────────────────

class SmartVisionSessionImpl implements SmartVisionSession {
  readonly sessionId: string;
  readonly config: SmartVisionConfig;
  readonly capabilities: NegotiatedVisionConfig;

  private readonly scheduler: ReturnType<typeof createFrameScheduler>;
  private readonly stability: ReturnType<typeof createStabilityEstimator>;
  private readonly autoCap: ReturnType<typeof createAutoCaptureEngine> | null;

  private processing = false;
  private paused = false;
  private stopped = false;
  private startedAt = Date.now();

  // Live state
  private lastQuality: FrameQualityReport | null = null;
  private lastDetection: DetectionResult | null = null;
  private lastStability: StabilityMeasure | null = null;
  private lastTracked: readonly TrackedRegion[] = [];
  private lastDecision: CaptureDecision | null = null;
  private lastGuidance: readonly GuidanceDirective[] = [];
  private lastDuplicate: DuplicateVerdict = NOVEL_VERDICT;
  private captureCount = 0;
  private processedFrames = 0;
  private droppedFrames = 0;
  private lastCaptureMs = 0;

  constructor(
    private readonly deps: SmartVisionDependencies,
    cfg: SmartVisionConfig,
    caps: NegotiatedVisionConfig,
    private readonly events: SmartVisionEventBus,
  ) {
    this.sessionId = `sv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this.config = cfg;
    this.capabilities = caps;

    this.scheduler = createFrameScheduler(cfg.frameProcessing.analysisTargetFps, {
      detectionStride: cfg.frameProcessing.detectionStrideFrames,
    });
    this.stability = createStabilityEstimator(cfg.frameProcessing.rollingWindowFrames);

    // Wire AutoCaptureEngine
    if (deps.autoCaptureEngine) {
      this.autoCap = null; // caller provides it directly
    } else {
      const policyId = cfg.autoCapture.policyId;
      const policy = policyId !== "custom" ? createBuiltInPolicy(policyId) : createBuiltInPolicy("balanced");
      this.autoCap = createAutoCaptureEngine(policyId, policy, cfg.autoCapture);
    }

    events.emit({
      kind: "sv.session.started",
      sessionId: this.sessionId,
      timestamp: ts(),
      policyId: this.activeAutoCap?.policy.id ?? "manual",
      enabledFeatures: (Object.keys(cfg.features) as (keyof typeof cfg.features)[])
        .filter(k => cfg.features[k]),
    });
  }

  private get activeAutoCap() {
    return this.deps.autoCaptureEngine ?? this.autoCap;
  }

  // ── Frame ingestion ─────────────────────────────────────────────────────────

  feedFrame(frame: VideoFrame): void {
    if (this.paused || this.stopped) return;
    this.scheduler.submit(frame);
    if (!this.processing) this.triggerLoop();
  }

  private triggerLoop(): void {
    this.processing = true;
    Promise.resolve().then(() => this.processLoop());
  }

  private async processLoop(): Promise<void> {
    if (this.stopped) { this.processing = false; return; }
    const scheduled = this.scheduler.dequeue();
    if (!scheduled) { this.processing = false; return; }

    await this.processFrame(
      scheduled.frame,
      scheduled.isDetectionFrame,
      scheduled.deadlineMs,
    );

    // Continue until the queue is drained
    Promise.resolve().then(() => this.processLoop());
  }

  private async processFrame(
    frame: VideoFrame,
    isDetectionFrame: boolean,
    deadlineMs: number,
  ): Promise<void> {
    const now = Date.now();
    if (now > deadlineMs) {
      this.droppedFrames++;
      this.events.emit({ kind: "sv.frame.dropped", sessionId: this.sessionId, timestamp: ts(), frameIndex: frame.meta.index, reason: "stale" });
      return;
    }

    const pipelineStart = now;
    const cfg = this.config;
    const fi = frame.meta.index;
    const stamp = ts();

    // ── Stage 1: Stability ────────────────────────────────────────────────────
    const stab = this.stability.update(frame);
    this.lastStability = stab;

    // ── Stage 2: Quality scoring ──────────────────────────────────────────────
    let quality = this.lastQuality ?? FALLBACK_QUALITY;
    if (this.deps.qualityScorer && cfg.features.qualityScoring) {
      try {
        quality = cfg.features.pixelQuality
          ? await this.deps.qualityScorer.score(frame)
          : this.deps.qualityScorer.scoreMetadata(frame);
      } catch { /* keep last quality */ }

      const prevOverall = this.lastQuality?.overall ?? -1;
      if (Math.abs(quality.overall - prevOverall) >= 5) {
        this.events.emit({ kind: "sv.quality.changed", sessionId: this.sessionId, timestamp: stamp, report: quality, frameIndex: fi });
      }
      const threshold = cfg.autoCapture.minQualityScore;
      if (this.lastQuality !== null) {
        const wasAbove = this.lastQuality.overall >= threshold;
        const isNowAbove = quality.overall >= threshold;
        if (wasAbove !== isNowAbove) {
          this.events.emit({ kind: "sv.quality.threshold_crossed", sessionId: this.sessionId, timestamp: stamp, direction: isNowAbove ? "above" : "below", threshold, score: quality.overall });
        }
      }
      this.lastQuality = quality;
    }

    // ── Stage 3: Detection (detection-stride frames) ──────────────────────────
    let detection = this.lastDetection;
    if (isDetectionFrame && this.deps.detectionEngine && cfg.features.detectionEngine) {
      try {
        detection = await this.deps.detectionEngine.detect(frame);
        this.lastDetection = detection;

        // Re-seed the tracker with fresh detections
        if (this.deps.objectTracker && cfg.features.objectTracking) {
          const objs = (detection as unknown as { objects?: Array<{ classId: number; box: { x: number; y: number; width: number; height: number }; confidence: number; objectId?: string | number }> }).objects ?? [];
          for (const obj of objs) {
            const trackId = `trk-${obj.classId}-${obj.objectId ?? obj.classId}` as TrackId;
            this.deps.objectTracker.acquire({ id: trackId, initialBox: obj.box, category: String(obj.classId), persistent: false });
            if (obj.confidence > 0) {
              this.events.emit({ kind: "sv.target.detected", sessionId: this.sessionId, timestamp: stamp, classId: obj.classId, confidence: obj.confidence, box: obj.box, frameIndex: fi });
            }
          }
        }
      } catch { /* keep last detection */ }
    }

    // ── Stage 4: Object tracking ──────────────────────────────────────────────
    let trackedRegions: readonly TrackedRegion[] = this.lastTracked;
    let primarySubject: TrackedRegion | null = null;
    if (this.deps.objectTracker && cfg.features.objectTracking) {
      try {
        trackedRegions = await this.deps.objectTracker.update(frame);
        this.lastTracked = trackedRegions;
      } catch { /* keep last tracked */ }
    }
    // Primary subject = highest-confidence actively-tracking region
    for (const r of trackedRegions) {
      if (r.state === "tracking" && (!primarySubject || r.confidence > primarySubject.confidence)) {
        primarySubject = r;
      }
    }
    if (primarySubject) {
      this.events.emit({ kind: "sv.target.updated", sessionId: this.sessionId, timestamp: stamp, region: primarySubject });
    }

    // ── Stage 5: Scene memory ─────────────────────────────────────────────────
    let isDuplicate = false;
    if (this.deps.sceneMemory && cfg.features.sceneMemory && primarySubject) {
      try {
        this.lastDuplicate = this.deps.sceneMemory.checkDuplicate(primarySubject.box, ["captured"]);
        isDuplicate = this.lastDuplicate.verdict === "duplicate";
        if (isDuplicate) {
          this.events.emit({ kind: "sv.scene.duplicate_detected", sessionId: this.sessionId, timestamp: stamp, frameIndex: fi, overlapScore: this.lastDuplicate.maxOverlap });
        }
      } catch { /* skip */ }
    }

    // ── Stage 6: Auto-capture policy ─────────────────────────────────────────
    const capEngine = this.activeAutoCap;
    const capLimit = cfg.autoCapture.captureLimit;
    const capLimitReached = capLimit > 0 && this.captureCount >= capLimit;

    if (capEngine && cfg.features.autoCapture && !capLimitReached) {
      const ctx: CapturePolicyContext = {
        frame,
        quality,
        stability: stab,
        detection,
        confidenceSummaries: [],
        primarySubject,
        allSubjects: trackedRegions,
        duplicateVerdict: this.lastDuplicate,
        trigger: "frame_tick",
        msSinceLastCapture: this.lastCaptureMs > 0 ? Date.now() - this.lastCaptureMs : Infinity,
        captureCount: this.captureCount,
        captureLimitReached: capLimitReached,
        onHold: capEngine.isOnHold,
      };
      const decision = capEngine.evaluate(ctx);
      this.lastDecision = decision;

      if (decision.action === "capture") {
        this.captureCount++;
        this.lastCaptureMs = Date.now();
        capEngine.notifyCaptured(stamp);

        this.events.emit({ kind: "sv.capture.started", sessionId: this.sessionId, timestamp: stamp, decision, captureIndex: this.captureCount - 1 });

        // Record to scene memory
        if (this.deps.sceneMemory && primarySubject) {
          this.deps.sceneMemory.record({ region: primarySubject.box, kind: "captured", timestamp: Date.now(), confidence: primarySubject.confidence, trackId: primarySubject.trackId });
          this.events.emit({ kind: "sv.scene.coverage_updated", sessionId: this.sessionId, timestamp: stamp, coverage: this.deps.sceneMemory.coverage });
        }
      } else {
        this.events.emit({ kind: "sv.capture.skipped", sessionId: this.sessionId, timestamp: stamp, decision, frameIndex: fi });
      }
    }

    // ── Stage 7: Guidance ─────────────────────────────────────────────────────
    if (this.deps.guidanceEngine && cfg.features.guidanceEngine) {
      try {
        const guidanceCtx: GuidanceContext = {
          frame, quality, stability: stab, detection,
          primarySubject,
          allSubjects: trackedRegions,
          autoCaptureActive: !!(capEngine && !capEngine.isOnHold),
          captureCount: this.captureCount,
          isDuplicate,
          captureLimitReached: capLimitReached,
        };
        const directives = this.deps.guidanceEngine.evaluate(guidanceCtx);
        this.lastGuidance = directives;
        if (directives.length > 0) {
          this.events.emit({ kind: "sv.guidance.emitted", sessionId: this.sessionId, timestamp: stamp, directives, dominant: directives[0]?.code ?? null });
        }
      } catch { /* skip guidance errors */ }
    }

    this.processedFrames++;
    const pipelineMs = Date.now() - pipelineStart;

    this.events.emit({
      kind: "sv.frame.processed",
      sessionId: this.sessionId,
      timestamp: stamp,
      frameIndex: fi,
      pipelineMs,
      qualityReport: quality,
      detectionResult: detection,
    });
  }

  // ── Pause / resume ──────────────────────────────────────────────────────────

  pause(reason?: string): void {
    this.paused = true;
    this.events.emit({ kind: "sv.session.paused", sessionId: this.sessionId, timestamp: ts(), reason: reason ?? "user_request" });
  }

  resume(): void {
    this.paused = false;
    this.events.emit({ kind: "sv.session.resumed", sessionId: this.sessionId, timestamp: ts() });
    // Re-trigger processing if frames were buffered
    if (!this.processing && this.scheduler.queueDepth > 0) this.triggerLoop();
  }

  // ── Policy management ───────────────────────────────────────────────────────

  setPolicy(policy: CapturePolicy | string): void {
    const engine = this.activeAutoCap;
    if (!engine) return;
    const prev = engine.policy.id;
    engine.setPolicy(policy as Parameters<typeof engine.setPolicy>[0]);
    this.events.emit({ kind: "sv.capture.policy_changed", sessionId: this.sessionId, timestamp: ts(), previousPolicyId: prev, newPolicyId: engine.policy.id });
  }

  // ── State queries ───────────────────────────────────────────────────────────

  snapshot(): SmartVisionSnapshot {
    return {
      sessionId: this.sessionId,
      timestamp: ts(),
      engineState: this.stopped ? "stopping" : this.paused ? "paused" : "running",
      quality: this.lastQuality,
      detection: this.lastDetection,
      trackedRegions: this.lastTracked,
      subjectLock: null,
      zoom: null,
      lastDecision: this.lastDecision,
      guidance: this.lastGuidance,
      coverage: this.deps.sceneMemory?.coverage ?? null,
      stability: this.lastStability,
      captureCount: this.captureCount,
      processedFrames: this.processedFrames,
      droppedFrames: this.droppedFrames,
      currentFps: 0,
    };
  }

  queryObservations(options?: { kinds?: string[]; limit?: number }): readonly SceneObservation[] {
    if (!this.deps.sceneMemory) return [];
    const q = {
      ...(options?.kinds !== undefined ? { kinds: options.kinds as readonly string[] } : {}),
      ...(options?.limit !== undefined ? { limit: options.limit } : {}),
    };
    return this.deps.sceneMemory.query(q);
  }

  // ── Manual capture ──────────────────────────────────────────────────────────

  async requestCapture(request?: CaptureRequest): Promise<CaptureResult> {
    const stamp = ts();
    const engine = this.activeAutoCap;
    const primarySubject = this.lastTracked.find(r => r.state === "tracking") ?? null;

    const decision: CaptureDecision = {
      action: "capture",
      score: {
        detectionConfidence: primarySubject?.confidence ?? 0,
        frameQuality: (this.lastQuality?.overall ?? 75) / 100,
        stability: this.lastStability?.score ?? 1,
        framing: primarySubject ? Math.min(1, primarySubject.box.width * primarySubject.box.height / 0.25) : 0,
        novelty: this.lastDuplicate.novelty,
        composite: 1,
      },
      reasons: [{ code: "all_thresholds_met", detail: request?.force ? "Force-requested capture" : "Manual capture requested" }],
      timestamp: stamp,
      policyId: engine?.policy.id ?? "manual",
    };

    this.captureCount++;
    this.lastCaptureMs = Date.now();
    if (engine) engine.notifyCaptured(stamp);

    this.events.emit({ kind: "sv.capture.started", sessionId: this.sessionId, timestamp: stamp, decision, captureIndex: this.captureCount - 1 });

    if (this.deps.sceneMemory && primarySubject) {
      this.deps.sceneMemory.record({ region: primarySubject.box, kind: "captured", timestamp: Date.now(), confidence: primarySubject.confidence, trackId: primarySubject.trackId });
    }

    return { decision, crop: null, enhancedFrame: null, upscaledFrame: null, captureIndex: this.captureCount - 1 };
  }

  // ── Stop ────────────────────────────────────────────────────────────────────

  async stop(): Promise<void> {
    this.stopped = true;
    const stopTs = ts();
    this.events.emit({ kind: "sv.session.stopped", sessionId: this.sessionId, timestamp: stopTs, captureCount: this.captureCount, durationMs: Date.now() - this.startedAt });

    // Teardown
    this.deps.objectTracker?.reset();
    this.deps.motionPredictor?.reset();
    this.deps.guidanceEngine?.reset();
    this.activeAutoCap?.reset();
    this.stability.reset();
    this.scheduler.reset();
  }
}

// ─── SmartVisionEngine ────────────────────────────────────────────────────────

class SmartVisionEngineImpl implements SmartVisionEngine {
  private _state: SmartVisionEngineState = "idle";
  private _config: SmartVisionConfig;
  readonly events: SmartVisionEventBus;
  private _activeSession: SmartVisionSession | null = null;

  constructor(
    private readonly deps: SmartVisionDependencies,
    private readonly caps: NegotiatedVisionConfig,
    config: SmartVisionConfig,
  ) {
    this._config = config;
    this.events = createEventBus();
  }

  get state(): SmartVisionEngineState { return this._state; }
  get config(): SmartVisionConfig { return this._config; }

  async start(): Promise<SmartVisionSession> {
    this._state = "starting";
    const session = new SmartVisionSessionImpl(this.deps, this._config, this.caps, this.events);
    this._activeSession = session;
    this._state = "running";
    return session;
  }

  updateConfig(partial: DeepPartial<SmartVisionConfig>): void {
    deepMerge(this._config, partial);
  }

  async destroy(): Promise<void> {
    this._state = "stopping";
    if (this._activeSession) {
      await this._activeSession.stop();
      this._activeSession = null;
    }
    this.events.clear();
    this._state = "idle";
  }
}

// ─── SmartVisionFactory ───────────────────────────────────────────────────────

export function createSmartVisionFactory(): SmartVisionFactory {
  return {
    create(
      deps: SmartVisionDependencies,
      capabilities: VisionCapabilities,
      config?: Partial<SmartVisionConfig>,
    ): SmartVisionEngine {
      const mergedConfig: SmartVisionConfig = {
        ...DEFAULT_SMART_VISION_CONFIG,
        ...config,
        features: { ...DEFAULT_SMART_VISION_CONFIG.features, ...(config?.features ?? {}) },
        frameProcessing: { ...DEFAULT_SMART_VISION_CONFIG.frameProcessing, ...(config?.frameProcessing ?? {}) },
        autoCapture: { ...DEFAULT_SMART_VISION_CONFIG.autoCapture, ...(config?.autoCapture ?? {}) },
        guidance: { ...DEFAULT_SMART_VISION_CONFIG.guidance, ...(config?.guidance ?? {}) },
      };

      // Negotiate capabilities: disable features that the device/provider can't support
      // In this implementation we pass capabilities through without restricting features.
      const negotiated = capabilities as unknown as NegotiatedVisionConfig;

      return new SmartVisionEngineImpl(deps, negotiated, mergedConfig);
    },
  };
}
