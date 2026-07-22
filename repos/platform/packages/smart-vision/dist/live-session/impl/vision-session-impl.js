/**
 * @platform/smart-vision/live-session — VisionSession implementation.
 *
 * VisionSessionImpl coordinates all pipeline stages for one active session.
 * It owns the frame queue, the async processing loop, per-stage runners built
 * from injected dependencies, and session-level statistics.
 *
 * Frame flow:
 *   feedFrame()                        — synchronous gate; scheduler decides
 *     → queue                          — bounded FIFO; overflow applies dropPolicy
 *       → _kickProcessing()            — starts async loop if not running
 *         → _processLoop()             — dequeues one frame at a time
 *           → pipeline.process()       — runs all enabled stage runners in order
 *             → emit pipeline.frame.processed
 *             → perfMonitor.record()
 *             → checkAdaptation()
 */
import { createPerformanceMonitor } from "./performance-impl";
import { createLiveFrameScheduler } from "./scheduler-impl";
import { createFramePipeline, createPipelineEventBus } from "./pipeline-impl";
// ─── Utilities ────────────────────────────────────────────────────────────────
function ts() { return Date.now(); }
function newSessionId() {
    return `vs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
function padBox(box, padFraction) {
    const pw = box.width * padFraction;
    const ph = box.height * padFraction;
    const x = Math.max(0, box.x - pw);
    const y = Math.max(0, box.y - ph);
    const width = Math.min(1 - x, box.width + 2 * pw);
    const height = Math.min(1 - y, box.height + 2 * ph);
    return { x, y, width, height };
}
// ─── Default duplicate verdict (when scene memory is disabled) ────────────────
const NOVEL_VERDICT = {
    verdict: "novel",
    novelty: 1,
    matchingObservations: [],
    maxOverlap: 0,
};
// Full-frame bounding box for scene memory novelty checks.
const FULL_FRAME_BOX = { x: 0, y: 0, width: 1, height: 1 };
// ─── Stage runner builders ────────────────────────────────────────────────────
function buildStageRunners(deps, config, events, sessionId, stateRef) {
    const runners = [];
    // ── Stability ─────────────────────────────────────────────────────────────
    if (config.features.stability) {
        let prevFrameTime = null;
        let windowFrames = 0;
        runners.push({
            stage: "stability",
            async run(frame, _ctx) {
                const start = Date.now();
                const now = start;
                const deltaMs = prevFrameTime != null ? now - prevFrameTime : 16;
                prevFrameTime = now;
                windowFrames = Math.min(windowFrames + 1, 30);
                // Proxy stability from inter-frame timing consistency.
                const targetMs = 1000 / Math.max(1, config.targetFps);
                const deviation = Math.abs(deltaMs - targetMs) / targetMs;
                const score = Math.max(0, Math.min(1, 1 - deviation * 0.5));
                const measure = { score, meanDisplacement: 0, windowFrames };
                return { stage: "stability", ok: true, latencyMs: Date.now() - start, data: measure, skipped: false };
            },
        });
    }
    // ── Quality ───────────────────────────────────────────────────────────────
    if (config.features.quality && deps.qualityScorer != null) {
        const scorer = deps.qualityScorer;
        runners.push({
            stage: "quality",
            async run(frame, _ctx) {
                const start = Date.now();
                try {
                    const report = await scorer.score(frame);
                    events.emit({ kind: "pipeline.quality.scored", sessionId, timestamp: ts(), frameIndex: frame.meta.index, report });
                    return { stage: "quality", ok: true, latencyMs: Date.now() - start, data: report, skipped: false };
                }
                catch (err) {
                    return { stage: "quality", ok: false, latencyMs: Date.now() - start, data: null, error: String(err), skipped: false };
                }
            },
        });
    }
    // ── Scene memory ──────────────────────────────────────────────────────────
    if (config.features.sceneMemory && deps.sceneMemory != null) {
        const memory = deps.sceneMemory;
        runners.push({
            stage: "scene_memory",
            async run(frame, _ctx) {
                const start = Date.now();
                try {
                    const verdict = memory.checkDuplicate(FULL_FRAME_BOX, []);
                    if (verdict.verdict !== "novel") {
                        events.emit({ kind: "pipeline.scene.duplicate_detected", sessionId, timestamp: ts(), frameIndex: frame.meta.index, verdict });
                    }
                    return { stage: "scene_memory", ok: true, latencyMs: Date.now() - start, data: verdict, skipped: false };
                }
                catch (err) {
                    return { stage: "scene_memory", ok: false, latencyMs: Date.now() - start, data: null, error: String(err), skipped: false };
                }
            },
        });
    }
    // ── Detection ─────────────────────────────────────────────────────────────
    if (config.features.detection && deps.detectionEngine != null) {
        const engine = deps.detectionEngine;
        runners.push({
            stage: "detection",
            async run(frame, ctx) {
                if (!ctx.isInferenceFrame) {
                    return { stage: "detection", ok: true, latencyMs: 0, data: null, skipped: true };
                }
                const start = Date.now();
                try {
                    const result = await engine.detect(frame);
                    const latencyMs = Date.now() - start;
                    events.emit({
                        kind: "pipeline.detection.completed", sessionId, timestamp: ts(),
                        frameIndex: frame.meta.index, objectCount: result.objects.length, inferenceMs: latencyMs,
                    });
                    return { stage: "detection", ok: true, latencyMs, data: result, skipped: false };
                }
                catch (err) {
                    return { stage: "detection", ok: false, latencyMs: Date.now() - start, data: null, error: String(err), skipped: false };
                }
            },
        });
    }
    // ── Tracking ──────────────────────────────────────────────────────────────
    if (config.features.tracking && deps.objectTracker != null) {
        const tracker = deps.objectTracker;
        runners.push({
            stage: "tracking",
            async run(frame, _ctx) {
                const start = Date.now();
                try {
                    const regions = await tracker.update(frame);
                    const latencyMs = Date.now() - start;
                    events.emit({
                        kind: "pipeline.tracking.updated", sessionId, timestamp: ts(),
                        frameIndex: frame.meta.index, activeTargets: regions.length, regions,
                    });
                    return { stage: "tracking", ok: true, latencyMs, data: regions, skipped: false };
                }
                catch (err) {
                    return { stage: "tracking", ok: false, latencyMs: Date.now() - start, data: null, error: String(err), skipped: false };
                }
            },
        });
    }
    // ── Motion prediction ─────────────────────────────────────────────────────
    // MotionPredictor predicts per-track-ID positions. The tracking stage already
    // extrapolates positions for non-inference frames. This stage records that
    // the prediction pass is complete for accurate stage profiling.
    if (config.features.motionPrediction && deps.motionPredictor != null) {
        runners.push({
            stage: "motion_prediction",
            async run(_frame, _ctx) {
                return { stage: "motion_prediction", ok: true, latencyMs: 0, data: null, skipped: false };
            },
        });
    }
    // ── Smart zoom ────────────────────────────────────────────────────────────
    if (config.features.smartZoom && deps.zoomController != null) {
        const zoomCtrl = deps.zoomController;
        runners.push({
            stage: "smart_zoom",
            async run(frame, ctx) {
                const start = Date.now();
                const regions = ctx.stageResults["tracking"]?.data ?? [];
                const primary = regions[0] ?? null;
                const command = zoomCtrl.analyse(primary, regions);
                const latencyMs = Date.now() - start;
                if (command != null) {
                    events.emit({
                        kind: "pipeline.zoom.changed", sessionId, timestamp: ts(),
                        frameIndex: frame.meta.index, zoomState: zoomCtrl.state,
                    });
                }
                return { stage: "smart_zoom", ok: true, latencyMs, data: command, skipped: command == null };
            },
        });
    }
    // ── Privacy ───────────────────────────────────────────────────────────────
    if (config.features.privacy && deps.privacyProvider != null && config.privacyPolicy != null) {
        const provider = deps.privacyProvider;
        const policy = config.privacyPolicy;
        // Build O(1) lookup map from the policy objects array.
        const policyMap = new Map(policy.objects.map(p => [p.classId, p]));
        // Pre-compute the class list for the detection request (only redact-enabled classes).
        const requestClasses = policy.objects.filter(p => p.redact).map(p => p.classId);
        const requestConfidenceThreshold = 0.5;
        runners.push({
            stage: "privacy",
            async run(frame, _ctx) {
                const start = Date.now();
                try {
                    const detResult = await provider.detect(frame, {
                        classes: requestClasses,
                        confidenceThreshold: requestConfidenceThreshold,
                    });
                    const masks = [];
                    for (let i = 0; i < detResult.objects.length; i++) {
                        const det = detResult.objects[i];
                        if (det == null)
                            continue;
                        const classPol = policyMap.get(det.classId);
                        const shouldRedact = classPol != null ? classPol.redact : policy.redactUnknownClasses;
                        if (!shouldRedact)
                            continue;
                        const padFraction = classPol?.padding ?? 0.05;
                        const paddedBox = padBox(det.box, padFraction);
                        masks.push({
                            objectId: `priv_${frame.meta.index}_${i}`,
                            classId: det.classId,
                            box: paddedBox,
                            redactionType: classPol?.redactionType ?? policy.defaultRedactionType,
                            strength: classPol?.strength ?? policy.defaultStrength,
                            padding: padFraction,
                            timestamp: frame.meta.timestamp,
                            frameIndex: frame.meta.index,
                        });
                    }
                    const latencyMs = Date.now() - start;
                    if (detResult.objects.length > 0) {
                        events.emit({
                            kind: "pipeline.privacy.object_detected", sessionId, timestamp: ts(),
                            frameIndex: frame.meta.index, objects: detResult.objects,
                        });
                    }
                    if (masks.length > 0) {
                        events.emit({
                            kind: "pipeline.privacy.redacted", sessionId, timestamp: ts(),
                            frameIndex: frame.meta.index, masks,
                        });
                    }
                    return { stage: "privacy", ok: true, latencyMs, data: { objects: detResult.objects, masks }, skipped: false };
                }
                catch (err) {
                    return { stage: "privacy", ok: false, latencyMs: Date.now() - start, data: null, error: String(err), skipped: false };
                }
            },
        });
    }
    // ── Auto capture ──────────────────────────────────────────────────────────
    if (config.features.autoCapture && deps.autoCaptureEngine != null) {
        const captureEngine = deps.autoCaptureEngine;
        runners.push({
            stage: "auto_capture",
            async run(frame, ctx) {
                const start = Date.now();
                try {
                    const qualityReport = ctx.stageResults["quality"]?.data;
                    const stabilityData = ctx.stageResults["stability"]?.data;
                    const detectionData = ctx.stageResults["detection"]?.data;
                    const trackingData = ctx.stageResults["tracking"]?.data;
                    const duplicateData = ctx.stageResults["scene_memory"]?.data;
                    // Auto capture requires both quality and stability to be available.
                    if (qualityReport == null || stabilityData == null) {
                        return { stage: "auto_capture", ok: true, latencyMs: Date.now() - start, data: null, skipped: true };
                    }
                    const allSubjects = trackingData ?? [];
                    const captureCtx = {
                        frame,
                        quality: qualityReport,
                        stability: stabilityData,
                        detection: detectionData ?? null,
                        confidenceSummaries: [],
                        primarySubject: allSubjects[0] ?? null,
                        allSubjects,
                        duplicateVerdict: duplicateData ?? NOVEL_VERDICT,
                        trigger: "frame_tick",
                        msSinceLastCapture: stateRef.msSinceLastCapture(),
                        captureCount: stateRef.getCaptureCount(),
                        captureLimitReached: false,
                        onHold: false,
                    };
                    const decision = captureEngine.evaluate(captureCtx);
                    const latencyMs = Date.now() - start;
                    if (decision.action === "capture") {
                        stateRef.recordCapture();
                        events.emit({
                            kind: "pipeline.capture.triggered", sessionId, timestamp: ts(),
                            frameIndex: frame.meta.index, decision,
                        });
                    }
                    else {
                        events.emit({
                            kind: "pipeline.capture.skipped", sessionId, timestamp: ts(),
                            frameIndex: frame.meta.index, reason: decision.action,
                        });
                    }
                    return { stage: "auto_capture", ok: true, latencyMs, data: decision, skipped: false };
                }
                catch (err) {
                    return { stage: "auto_capture", ok: false, latencyMs: Date.now() - start, data: null, error: String(err), skipped: false };
                }
            },
        });
    }
    return runners;
}
function makeStats() {
    return {
        framesAcquired: 0,
        framesProcessed: 0,
        framesDropped: 0,
        framesWithInference: 0,
        totalCaptures: 0,
        totalPrivacyObjectsDetected: 0,
        totalPrivacyRedactions: 0,
        peakLatencyMs: 0,
        avgLatencyMs: 0,
        stageLatencyAccum: new Map(),
    };
}
// ─── VisionSessionImpl ────────────────────────────────────────────────────────
export class VisionSessionImpl {
    sessionId;
    events;
    config;
    _state = "starting";
    _queue = [];
    _processingActive = false;
    _frameCount = 0;
    _lastCaptureMs = 0;
    _totalCaptures = 0;
    _startedAt;
    _stats;
    _perfMonitor;
    _scheduler;
    _pipeline;
    constructor(deps, config, parentEvents) {
        this.sessionId = newSessionId();
        this.config = config;
        this.events = createPipelineEventBus();
        this._startedAt = ts();
        this._stats = makeStats();
        this._perfMonitor = createPerformanceMonitor(config.targetFps, config.performanceProfile);
        this._scheduler = createLiveFrameScheduler({
            targetFps: config.targetFps,
            maxFrameAgeMs: config.maxFrameAgeMs,
        });
        const stateRef = {
            msSinceLastCapture: () => this._lastCaptureMs > 0 ? Date.now() - this._lastCaptureMs : Number.MAX_SAFE_INTEGER,
            getCaptureCount: () => this._totalCaptures,
            recordCapture: () => {
                this._totalCaptures++;
                this._stats.totalCaptures++;
                this._lastCaptureMs = Date.now();
            },
        };
        const runners = buildStageRunners(deps, config, this.events, this.sessionId, stateRef);
        this._pipeline = createFramePipeline(runners, this.sessionId);
        // Bridge all session events to the parent engine event bus.
        this._bridgeToParent(parentEvents);
        this._state = "running";
        const enabledStages = runners.map(r => r.stage);
        this.events.emit({
            kind: "pipeline.session.started",
            sessionId: this.sessionId,
            timestamp: this._startedAt,
            targetFps: config.targetFps,
            enabledStages,
        });
    }
    // ── VisionSession interface ─────────────────────────────────────────────────
    get state() { return this._state; }
    feedFrame(frame) {
        if (this._state === "stopping" || this._state === "error")
            return;
        this._stats.framesAcquired++;
        this.events.emit({
            kind: "pipeline.frame.acquired",
            sessionId: this.sessionId,
            timestamp: ts(),
            frameIndex: frame.meta.index,
            queueDepth: this._queue.length,
        });
        // ── Paused ───────────────────────────────────────────────────────────────
        if (this._state === "paused") {
            this._dropFrame(frame, "paused");
            return;
        }
        // ── Scheduler gate ────────────────────────────────────────────────────────
        const { decision, frameAgeMs } = this._scheduler.accept(frame, this._queue.length);
        if (decision !== "process") {
            this._dropFrame(frame, decision === "drop_stale" ? "stale" : "queue_full");
            return;
        }
        // ── Queue management ─────────────────────────────────────────────────────
        if (this._queue.length >= this.config.maxQueueDepth) {
            this._applyDropPolicy(frame);
        }
        else {
            this._queue.push(frame);
            if (!this._processingActive)
                this._kickProcessing();
        }
    }
    pause(reason) {
        if (this._state !== "running")
            return;
        this._state = "paused";
        this.events.emit({
            kind: "pipeline.session.paused",
            sessionId: this.sessionId,
            timestamp: ts(),
            reason: reason ?? "application_request",
        });
    }
    resume() {
        if (this._state !== "paused")
            return;
        this._state = "running";
        this._scheduler.reset();
        this._perfMonitor.reset();
        this.events.emit({ kind: "pipeline.session.resumed", sessionId: this.sessionId, timestamp: ts() });
        if (this._queue.length > 0 && !this._processingActive)
            this._kickProcessing();
    }
    async stop() {
        if (this._state === "stopping" || this._state === "error")
            return;
        this._state = "stopping";
        // Wait for the current processing loop to finish.
        while (this._processingActive) {
            await new Promise(resolve => setTimeout(resolve, 8));
        }
        this._queue.length = 0;
        this._state = "idle";
        const durationMs = Date.now() - this._startedAt;
        this.events.emit({
            kind: "pipeline.session.stopped",
            sessionId: this.sessionId,
            timestamp: ts(),
            durationMs,
            framesProcessed: this._stats.framesProcessed,
            framesDropped: this._stats.framesDropped,
        });
        this.events.clear();
    }
    updateConfig(updates) {
        if (updates.targetFps != null) {
            this._scheduler.updateTargetFps(updates.targetFps);
            this._perfMonitor.updateTargetFps(updates.targetFps);
        }
        // frameDropPolicy and maxFrameAgeMs are read from config on each feedFrame call.
        // Since config is readonly, cast to mutable for targeted in-place updates.
        const mutable = this.config;
        if (updates.targetFps != null)
            mutable.targetFps = updates.targetFps;
        if (updates.frameDropPolicy != null)
            mutable.frameDropPolicy = updates.frameDropPolicy;
        if (updates.maxFrameAgeMs != null)
            mutable.maxFrameAgeMs = updates.maxFrameAgeMs;
    }
    getStatistics() {
        const durationMs = Date.now() - this._startedAt;
        const metrics = this._perfMonitor.getMetrics();
        const stageLatencies = {};
        for (const [stage, arr] of this._stats.stageLatencyAccum) {
            if (arr.length > 0) {
                stageLatencies[stage] = arr.reduce((s, v) => s + v, 0) / arr.length;
            }
        }
        return {
            sessionId: this.sessionId,
            startedAt: this._startedAt,
            durationMs,
            framesAcquired: this._stats.framesAcquired,
            framesProcessed: this._stats.framesProcessed,
            framesDropped: this._stats.framesDropped,
            framesWithInference: this._stats.framesWithInference,
            currentFps: metrics.currentFps,
            targetFps: this.config.targetFps,
            dropRate: metrics.dropRate,
            averageLatencyMs: this._stats.avgLatencyMs,
            peakLatencyMs: this._stats.peakLatencyMs,
            stageLatencies,
            totalPrivacyObjectsDetected: this._stats.totalPrivacyObjectsDetected,
            totalPrivacyRedactions: this._stats.totalPrivacyRedactions,
            totalCaptures: this._stats.totalCaptures,
            activeProfile: metrics.activeProfile,
        };
    }
    snapshot() {
        return {
            sessionId: this.sessionId,
            state: this._state,
            statistics: this.getStatistics(),
            performance: this._perfMonitor.getMetrics(),
        };
    }
    // ── Private helpers ─────────────────────────────────────────────────────────
    _dropFrame(frame, reason) {
        this._stats.framesDropped++;
        this._perfMonitor.record(0, {}, true);
        this.events.emit({
            kind: "pipeline.frame.dropped",
            sessionId: this.sessionId,
            timestamp: ts(),
            frameIndex: frame.meta.index,
            reason,
        });
    }
    _applyDropPolicy(incoming) {
        switch (this.config.frameDropPolicy) {
            case "drop_oldest": {
                const dropped = this._queue.shift();
                if (dropped != null)
                    this._dropFrame(dropped, "queue_full");
                this._queue.push(incoming);
                break;
            }
            case "drop_newest": {
                // Discard the incoming frame; keep what's already queued.
                this._dropFrame(incoming, "queue_full");
                break;
            }
            case "drop_all": {
                for (const f of this._queue)
                    this._dropFrame(f, "queue_full");
                this._queue.length = 0;
                this._queue.push(incoming);
                break;
            }
        }
        if (!this._processingActive && this._queue.length > 0) {
            this._kickProcessing();
        }
    }
    _kickProcessing() {
        this._processingActive = true;
        this._processLoop().finally(() => { this._processingActive = false; });
    }
    async _processLoop() {
        while (this._queue.length > 0 && this._state === "running") {
            // Drain stale queued frames — prefer the newest.
            while (this._queue.length > 1 && this.config.frameDropPolicy === "drop_oldest") {
                const stale = this._queue.shift();
                if (stale != null)
                    this._dropFrame(stale, "queue_full");
            }
            const frame = this._queue.shift();
            if (frame == null)
                break;
            await this._processFrame(frame);
        }
    }
    async _processFrame(frame) {
        const isInferenceFrame = this._frameCount % this.config.detectionStrideFrames === 0;
        this._frameCount++;
        const context = {
            frameCount: this._frameCount,
            sessionId: this.sessionId,
            stageResults: {},
            isInferenceFrame,
        };
        const frameStart = Date.now();
        let result;
        try {
            result = await this._pipeline.process(frame, context);
        }
        catch (err) {
            // The pipeline should never throw (stage errors are captured inside
            // PipelineStageResult). This catch is a final safety net.
            result = {
                sessionId: this.sessionId,
                frameIndex: frame.meta.index,
                timestamp: frame.meta.timestamp,
                ranInference: isInferenceFrame,
                stages: {},
                totalLatencyMs: Date.now() - frameStart,
            };
            this.events.emit({
                kind: "pipeline.session.error",
                sessionId: this.sessionId,
                timestamp: ts(),
                stage: null,
                message: String(err),
                recoverable: true,
            });
        }
        // ── Statistics ───────────────────────────────────────────────────────────
        this._stats.framesProcessed++;
        if (isInferenceFrame)
            this._stats.framesWithInference++;
        this._stats.peakLatencyMs = Math.max(this._stats.peakLatencyMs, result.totalLatencyMs);
        const n = this._stats.framesProcessed;
        this._stats.avgLatencyMs = (this._stats.avgLatencyMs * (n - 1) + result.totalLatencyMs) / n;
        // Accumulate per-stage latencies.
        for (const [stageKey, sr] of Object.entries(result.stages)) {
            if (sr != null && !sr.skipped) {
                const stage = stageKey;
                let arr = this._stats.stageLatencyAccum.get(stage);
                if (!arr) {
                    arr = [];
                    this._stats.stageLatencyAccum.set(stage, arr);
                }
                arr.push(sr.latencyMs);
                if (arr.length > 60)
                    arr.shift();
            }
        }
        // Update privacy counters from stage result.
        const privacyData = result.stages["privacy"]?.data;
        if (privacyData != null) {
            this._stats.totalPrivacyObjectsDetected += privacyData.objects.length;
            this._stats.totalPrivacyRedactions += privacyData.masks.length;
        }
        // ── Performance monitoring ────────────────────────────────────────────────
        const stageLatencies = {};
        for (const [k, v] of Object.entries(result.stages)) {
            if (v != null)
                stageLatencies[k] = v.latencyMs;
        }
        this._perfMonitor.record(result.totalLatencyMs, stageLatencies, false);
        // ── Emit pipeline event ──────────────────────────────────────────────────
        this.events.emit({
            kind: "pipeline.frame.processed",
            sessionId: this.sessionId,
            timestamp: frame.meta.timestamp,
            result,
        });
        // ── Adaptive performance ──────────────────────────────────────────────────
        if (this.config.adaptivePerformance) {
            const adaptation = this._perfMonitor.checkAdaptation();
            if (adaptation != null) {
                this._scheduler.updateTargetFps(adaptation.recommendedFps);
                this._perfMonitor.updateProfile(adaptation.newProfile);
                this.events.emit({
                    kind: "pipeline.performance.adapted",
                    sessionId: this.sessionId,
                    timestamp: ts(),
                    previousFps: this.config.targetFps,
                    newFps: adaptation.recommendedFps,
                    previousProfile: adaptation.previousProfile,
                    newProfile: adaptation.newProfile,
                    reason: adaptation.reason,
                });
            }
        }
    }
    _bridgeToParent(parentEvents) {
        // Forward every event from this session's bus to the engine-level bus.
        const kinds = [
            "pipeline.session.started", "pipeline.session.paused", "pipeline.session.resumed",
            "pipeline.session.stopped", "pipeline.session.error",
            "pipeline.frame.acquired", "pipeline.frame.dropped", "pipeline.frame.processed",
            "pipeline.stage.error",
            "pipeline.quality.scored", "pipeline.quality.threshold_crossed",
            "pipeline.detection.completed",
            "pipeline.tracking.target_acquired", "pipeline.tracking.target_lost", "pipeline.tracking.updated",
            "pipeline.scene.duplicate_detected", "pipeline.scene.coverage_updated",
            "pipeline.zoom.changed",
            "pipeline.privacy.object_detected", "pipeline.privacy.redacted",
            "pipeline.capture.triggered", "pipeline.capture.skipped", "pipeline.capture.guidance",
            "pipeline.performance.adapted", "pipeline.performance.report",
        ];
        for (const kind of kinds) {
            // TypeScript requires the kind to be a PipelineEventKind. The `as any` is
            // safe here because we only pass known event kinds from the union.
            this.events.on(kind, (e) => {
                parentEvents.emit(e);
            });
        }
    }
}
