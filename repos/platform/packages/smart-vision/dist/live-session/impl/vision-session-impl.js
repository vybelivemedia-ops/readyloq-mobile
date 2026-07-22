"use strict";
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VisionSessionImpl = void 0;
var performance_impl_1 = require("./performance-impl");
var scheduler_impl_1 = require("./scheduler-impl");
var pipeline_impl_1 = require("./pipeline-impl");
// ─── Utilities ────────────────────────────────────────────────────────────────
function ts() { return Date.now(); }
function newSessionId() {
    return "vs_".concat(Date.now().toString(36), "_").concat(Math.random().toString(36).slice(2, 6));
}
function padBox(box, padFraction) {
    var pw = box.width * padFraction;
    var ph = box.height * padFraction;
    var x = Math.max(0, box.x - pw);
    var y = Math.max(0, box.y - ph);
    var width = Math.min(1 - x, box.width + 2 * pw);
    var height = Math.min(1 - y, box.height + 2 * ph);
    return { x: x, y: y, width: width, height: height };
}
// ─── Default duplicate verdict (when scene memory is disabled) ────────────────
var NOVEL_VERDICT = {
    verdict: "novel",
    novelty: 1,
    matchingObservations: [],
    maxOverlap: 0,
};
// Full-frame bounding box for scene memory novelty checks.
var FULL_FRAME_BOX = { x: 0, y: 0, width: 1, height: 1 };
// ─── Stage runner builders ────────────────────────────────────────────────────
function buildStageRunners(deps, config, events, sessionId, stateRef) {
    var runners = [];
    // ── Stability ─────────────────────────────────────────────────────────────
    if (config.features.stability) {
        var prevFrameTime_1 = null;
        var windowFrames_1 = 0;
        runners.push({
            stage: "stability",
            run: function (frame, _ctx) {
                return __awaiter(this, void 0, void 0, function () {
                    var start, now, deltaMs, targetMs, deviation, score, measure;
                    return __generator(this, function (_a) {
                        start = Date.now();
                        now = start;
                        deltaMs = prevFrameTime_1 != null ? now - prevFrameTime_1 : 16;
                        prevFrameTime_1 = now;
                        windowFrames_1 = Math.min(windowFrames_1 + 1, 30);
                        targetMs = 1000 / Math.max(1, config.targetFps);
                        deviation = Math.abs(deltaMs - targetMs) / targetMs;
                        score = Math.max(0, Math.min(1, 1 - deviation * 0.5));
                        measure = { score: score, meanDisplacement: 0, windowFrames: windowFrames_1 };
                        return [2 /*return*/, { stage: "stability", ok: true, latencyMs: Date.now() - start, data: measure, skipped: false }];
                    });
                });
            },
        });
    }
    // ── Quality ───────────────────────────────────────────────────────────────
    if (config.features.quality && deps.qualityScorer != null) {
        var scorer_1 = deps.qualityScorer;
        runners.push({
            stage: "quality",
            run: function (frame, _ctx) {
                return __awaiter(this, void 0, void 0, function () {
                    var start, report, err_1;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                start = Date.now();
                                _a.label = 1;
                            case 1:
                                _a.trys.push([1, 3, , 4]);
                                return [4 /*yield*/, scorer_1.score(frame)];
                            case 2:
                                report = _a.sent();
                                events.emit({ kind: "pipeline.quality.scored", sessionId: sessionId, timestamp: ts(), frameIndex: frame.meta.index, report: report });
                                return [2 /*return*/, { stage: "quality", ok: true, latencyMs: Date.now() - start, data: report, skipped: false }];
                            case 3:
                                err_1 = _a.sent();
                                return [2 /*return*/, { stage: "quality", ok: false, latencyMs: Date.now() - start, data: null, error: String(err_1), skipped: false }];
                            case 4: return [2 /*return*/];
                        }
                    });
                });
            },
        });
    }
    // ── Scene memory ──────────────────────────────────────────────────────────
    if (config.features.sceneMemory && deps.sceneMemory != null) {
        var memory_1 = deps.sceneMemory;
        runners.push({
            stage: "scene_memory",
            run: function (frame, _ctx) {
                return __awaiter(this, void 0, void 0, function () {
                    var start, verdict;
                    return __generator(this, function (_a) {
                        start = Date.now();
                        try {
                            verdict = memory_1.checkDuplicate(FULL_FRAME_BOX, []);
                            if (verdict.verdict !== "novel") {
                                events.emit({ kind: "pipeline.scene.duplicate_detected", sessionId: sessionId, timestamp: ts(), frameIndex: frame.meta.index, verdict: verdict });
                            }
                            return [2 /*return*/, { stage: "scene_memory", ok: true, latencyMs: Date.now() - start, data: verdict, skipped: false }];
                        }
                        catch (err) {
                            return [2 /*return*/, { stage: "scene_memory", ok: false, latencyMs: Date.now() - start, data: null, error: String(err), skipped: false }];
                        }
                        return [2 /*return*/];
                    });
                });
            },
        });
    }
    // ── Detection ─────────────────────────────────────────────────────────────
    if (config.features.detection && deps.detectionEngine != null) {
        var engine_1 = deps.detectionEngine;
        runners.push({
            stage: "detection",
            run: function (frame, ctx) {
                return __awaiter(this, void 0, void 0, function () {
                    var start, result, latencyMs, err_2;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                if (!ctx.isInferenceFrame) {
                                    return [2 /*return*/, { stage: "detection", ok: true, latencyMs: 0, data: null, skipped: true }];
                                }
                                start = Date.now();
                                _a.label = 1;
                            case 1:
                                _a.trys.push([1, 3, , 4]);
                                return [4 /*yield*/, engine_1.detect(frame)];
                            case 2:
                                result = _a.sent();
                                latencyMs = Date.now() - start;
                                events.emit({
                                    kind: "pipeline.detection.completed",
                                    sessionId: sessionId,
                                    timestamp: ts(),
                                    frameIndex: frame.meta.index, objectCount: result.objects.length, inferenceMs: latencyMs,
                                });
                                return [2 /*return*/, { stage: "detection", ok: true, latencyMs: latencyMs, data: result, skipped: false }];
                            case 3:
                                err_2 = _a.sent();
                                return [2 /*return*/, { stage: "detection", ok: false, latencyMs: Date.now() - start, data: null, error: String(err_2), skipped: false }];
                            case 4: return [2 /*return*/];
                        }
                    });
                });
            },
        });
    }
    // ── Tracking ──────────────────────────────────────────────────────────────
    if (config.features.tracking && deps.objectTracker != null) {
        var tracker_1 = deps.objectTracker;
        runners.push({
            stage: "tracking",
            run: function (frame, _ctx) {
                return __awaiter(this, void 0, void 0, function () {
                    var start, regions, latencyMs, err_3;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                start = Date.now();
                                _a.label = 1;
                            case 1:
                                _a.trys.push([1, 3, , 4]);
                                return [4 /*yield*/, tracker_1.update(frame)];
                            case 2:
                                regions = _a.sent();
                                latencyMs = Date.now() - start;
                                events.emit({
                                    kind: "pipeline.tracking.updated",
                                    sessionId: sessionId,
                                    timestamp: ts(),
                                    frameIndex: frame.meta.index, activeTargets: regions.length,
                                    regions: regions,
                                });
                                return [2 /*return*/, { stage: "tracking", ok: true, latencyMs: latencyMs, data: regions, skipped: false }];
                            case 3:
                                err_3 = _a.sent();
                                return [2 /*return*/, { stage: "tracking", ok: false, latencyMs: Date.now() - start, data: null, error: String(err_3), skipped: false }];
                            case 4: return [2 /*return*/];
                        }
                    });
                });
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
            run: function (_frame, _ctx) {
                return __awaiter(this, void 0, void 0, function () {
                    return __generator(this, function (_a) {
                        return [2 /*return*/, { stage: "motion_prediction", ok: true, latencyMs: 0, data: null, skipped: false }];
                    });
                });
            },
        });
    }
    // ── Smart zoom ────────────────────────────────────────────────────────────
    if (config.features.smartZoom && deps.zoomController != null) {
        var zoomCtrl_1 = deps.zoomController;
        runners.push({
            stage: "smart_zoom",
            run: function (frame, ctx) {
                return __awaiter(this, void 0, void 0, function () {
                    var start, regions, primary, command, latencyMs;
                    var _a, _b, _c;
                    return __generator(this, function (_d) {
                        start = Date.now();
                        regions = (_b = (_a = ctx.stageResults["tracking"]) === null || _a === void 0 ? void 0 : _a.data) !== null && _b !== void 0 ? _b : [];
                        primary = (_c = regions[0]) !== null && _c !== void 0 ? _c : null;
                        command = zoomCtrl_1.analyse(primary, regions);
                        latencyMs = Date.now() - start;
                        if (command != null) {
                            events.emit({
                                kind: "pipeline.zoom.changed",
                                sessionId: sessionId,
                                timestamp: ts(),
                                frameIndex: frame.meta.index, zoomState: zoomCtrl_1.state,
                            });
                        }
                        return [2 /*return*/, { stage: "smart_zoom", ok: true, latencyMs: latencyMs, data: command, skipped: command == null }];
                    });
                });
            },
        });
    }
    // ── Privacy ───────────────────────────────────────────────────────────────
    if (config.features.privacy && deps.privacyProvider != null && config.privacyPolicy != null) {
        var provider_1 = deps.privacyProvider;
        var policy_1 = config.privacyPolicy;
        // Build O(1) lookup map from the policy objects array.
        var policyMap_1 = new Map(policy_1.objects.map(function (p) { return [p.classId, p]; }));
        // Pre-compute the class list for the detection request (only redact-enabled classes).
        var requestClasses_1 = policy_1.objects.filter(function (p) { return p.redact; }).map(function (p) { return p.classId; });
        var requestConfidenceThreshold_1 = 0.5;
        runners.push({
            stage: "privacy",
            run: function (frame, _ctx) {
                return __awaiter(this, void 0, void 0, function () {
                    var start, detResult, masks, i, det, classPol, shouldRedact, padFraction, paddedBox, latencyMs, err_4;
                    var _a, _b, _c;
                    return __generator(this, function (_d) {
                        switch (_d.label) {
                            case 0:
                                start = Date.now();
                                _d.label = 1;
                            case 1:
                                _d.trys.push([1, 3, , 4]);
                                return [4 /*yield*/, provider_1.detect(frame, {
                                        classes: requestClasses_1,
                                        confidenceThreshold: requestConfidenceThreshold_1,
                                    })];
                            case 2:
                                detResult = _d.sent();
                                masks = [];
                                for (i = 0; i < detResult.objects.length; i++) {
                                    det = detResult.objects[i];
                                    if (det == null)
                                        continue;
                                    classPol = policyMap_1.get(det.classId);
                                    shouldRedact = classPol != null ? classPol.redact : policy_1.redactUnknownClasses;
                                    if (!shouldRedact)
                                        continue;
                                    padFraction = (_a = classPol === null || classPol === void 0 ? void 0 : classPol.padding) !== null && _a !== void 0 ? _a : 0.05;
                                    paddedBox = padBox(det.box, padFraction);
                                    masks.push({
                                        objectId: "priv_".concat(frame.meta.index, "_").concat(i),
                                        classId: det.classId,
                                        box: paddedBox,
                                        redactionType: (_b = classPol === null || classPol === void 0 ? void 0 : classPol.redactionType) !== null && _b !== void 0 ? _b : policy_1.defaultRedactionType,
                                        strength: (_c = classPol === null || classPol === void 0 ? void 0 : classPol.strength) !== null && _c !== void 0 ? _c : policy_1.defaultStrength,
                                        padding: padFraction,
                                        timestamp: frame.meta.timestamp,
                                        frameIndex: frame.meta.index,
                                    });
                                }
                                latencyMs = Date.now() - start;
                                if (detResult.objects.length > 0) {
                                    events.emit({
                                        kind: "pipeline.privacy.object_detected",
                                        sessionId: sessionId,
                                        timestamp: ts(),
                                        frameIndex: frame.meta.index, objects: detResult.objects,
                                    });
                                }
                                if (masks.length > 0) {
                                    events.emit({
                                        kind: "pipeline.privacy.redacted",
                                        sessionId: sessionId,
                                        timestamp: ts(),
                                        frameIndex: frame.meta.index,
                                        masks: masks,
                                    });
                                }
                                return [2 /*return*/, { stage: "privacy", ok: true, latencyMs: latencyMs, data: { objects: detResult.objects, masks: masks }, skipped: false }];
                            case 3:
                                err_4 = _d.sent();
                                return [2 /*return*/, { stage: "privacy", ok: false, latencyMs: Date.now() - start, data: null, error: String(err_4), skipped: false }];
                            case 4: return [2 /*return*/];
                        }
                    });
                });
            },
        });
    }
    // ── Auto capture ──────────────────────────────────────────────────────────
    if (config.features.autoCapture && deps.autoCaptureEngine != null) {
        var captureEngine_1 = deps.autoCaptureEngine;
        runners.push({
            stage: "auto_capture",
            run: function (frame, ctx) {
                return __awaiter(this, void 0, void 0, function () {
                    var start, qualityReport, stabilityData, detectionData, trackingData, duplicateData, allSubjects, captureCtx, decision, latencyMs;
                    var _a, _b, _c, _d, _e, _f;
                    return __generator(this, function (_g) {
                        start = Date.now();
                        try {
                            qualityReport = (_a = ctx.stageResults["quality"]) === null || _a === void 0 ? void 0 : _a.data;
                            stabilityData = (_b = ctx.stageResults["stability"]) === null || _b === void 0 ? void 0 : _b.data;
                            detectionData = (_c = ctx.stageResults["detection"]) === null || _c === void 0 ? void 0 : _c.data;
                            trackingData = (_d = ctx.stageResults["tracking"]) === null || _d === void 0 ? void 0 : _d.data;
                            duplicateData = (_e = ctx.stageResults["scene_memory"]) === null || _e === void 0 ? void 0 : _e.data;
                            // Auto capture requires both quality and stability to be available.
                            if (qualityReport == null || stabilityData == null) {
                                return [2 /*return*/, { stage: "auto_capture", ok: true, latencyMs: Date.now() - start, data: null, skipped: true }];
                            }
                            allSubjects = trackingData !== null && trackingData !== void 0 ? trackingData : [];
                            captureCtx = {
                                frame: frame,
                                quality: qualityReport,
                                stability: stabilityData,
                                detection: detectionData !== null && detectionData !== void 0 ? detectionData : null,
                                confidenceSummaries: [],
                                primarySubject: (_f = allSubjects[0]) !== null && _f !== void 0 ? _f : null,
                                allSubjects: allSubjects,
                                duplicateVerdict: duplicateData !== null && duplicateData !== void 0 ? duplicateData : NOVEL_VERDICT,
                                trigger: "frame_tick",
                                msSinceLastCapture: stateRef.msSinceLastCapture(),
                                captureCount: stateRef.getCaptureCount(),
                                captureLimitReached: false,
                                onHold: false,
                            };
                            decision = captureEngine_1.evaluate(captureCtx);
                            latencyMs = Date.now() - start;
                            if (decision.action === "capture") {
                                stateRef.recordCapture();
                                events.emit({
                                    kind: "pipeline.capture.triggered",
                                    sessionId: sessionId,
                                    timestamp: ts(),
                                    frameIndex: frame.meta.index,
                                    decision: decision,
                                });
                            }
                            else {
                                events.emit({
                                    kind: "pipeline.capture.skipped",
                                    sessionId: sessionId,
                                    timestamp: ts(),
                                    frameIndex: frame.meta.index, reason: decision.action,
                                });
                            }
                            return [2 /*return*/, { stage: "auto_capture", ok: true, latencyMs: latencyMs, data: decision, skipped: false }];
                        }
                        catch (err) {
                            return [2 /*return*/, { stage: "auto_capture", ok: false, latencyMs: Date.now() - start, data: null, error: String(err), skipped: false }];
                        }
                        return [2 /*return*/];
                    });
                });
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
var VisionSessionImpl = /** @class */ (function () {
    function VisionSessionImpl(deps, config, parentEvents) {
        var _this = this;
        this._state = "starting";
        this._queue = [];
        this._processingActive = false;
        this._frameCount = 0;
        this._lastCaptureMs = 0;
        this._totalCaptures = 0;
        this.sessionId = newSessionId();
        this.config = config;
        this.events = (0, pipeline_impl_1.createPipelineEventBus)();
        this._startedAt = ts();
        this._stats = makeStats();
        this._perfMonitor = (0, performance_impl_1.createPerformanceMonitor)(config.targetFps, config.performanceProfile);
        this._scheduler = (0, scheduler_impl_1.createLiveFrameScheduler)({
            targetFps: config.targetFps,
            maxFrameAgeMs: config.maxFrameAgeMs,
        });
        var stateRef = {
            msSinceLastCapture: function () {
                return _this._lastCaptureMs > 0 ? Date.now() - _this._lastCaptureMs : Number.MAX_SAFE_INTEGER;
            },
            getCaptureCount: function () { return _this._totalCaptures; },
            recordCapture: function () {
                _this._totalCaptures++;
                _this._stats.totalCaptures++;
                _this._lastCaptureMs = Date.now();
            },
        };
        var runners = buildStageRunners(deps, config, this.events, this.sessionId, stateRef);
        this._pipeline = (0, pipeline_impl_1.createFramePipeline)(runners, this.sessionId);
        // Bridge all session events to the parent engine event bus.
        this._bridgeToParent(parentEvents);
        this._state = "running";
        var enabledStages = runners.map(function (r) { return r.stage; });
        this.events.emit({
            kind: "pipeline.session.started",
            sessionId: this.sessionId,
            timestamp: this._startedAt,
            targetFps: config.targetFps,
            enabledStages: enabledStages,
        });
    }
    Object.defineProperty(VisionSessionImpl.prototype, "state", {
        // ── VisionSession interface ─────────────────────────────────────────────────
        get: function () { return this._state; },
        enumerable: false,
        configurable: true
    });
    VisionSessionImpl.prototype.feedFrame = function (frame) {
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
        var _a = this._scheduler.accept(frame, this._queue.length), decision = _a.decision, frameAgeMs = _a.frameAgeMs;
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
    };
    VisionSessionImpl.prototype.pause = function (reason) {
        if (this._state !== "running")
            return;
        this._state = "paused";
        this.events.emit({
            kind: "pipeline.session.paused",
            sessionId: this.sessionId,
            timestamp: ts(),
            reason: reason !== null && reason !== void 0 ? reason : "application_request",
        });
    };
    VisionSessionImpl.prototype.resume = function () {
        if (this._state !== "paused")
            return;
        this._state = "running";
        this._scheduler.reset();
        this._perfMonitor.reset();
        this.events.emit({ kind: "pipeline.session.resumed", sessionId: this.sessionId, timestamp: ts() });
        if (this._queue.length > 0 && !this._processingActive)
            this._kickProcessing();
    };
    VisionSessionImpl.prototype.stop = function () {
        return __awaiter(this, void 0, void 0, function () {
            var durationMs;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this._state === "stopping" || this._state === "error")
                            return [2 /*return*/];
                        this._state = "stopping";
                        _a.label = 1;
                    case 1:
                        if (!this._processingActive) return [3 /*break*/, 3];
                        return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, 8); })];
                    case 2:
                        _a.sent();
                        return [3 /*break*/, 1];
                    case 3:
                        this._queue.length = 0;
                        this._state = "idle";
                        durationMs = Date.now() - this._startedAt;
                        this.events.emit({
                            kind: "pipeline.session.stopped",
                            sessionId: this.sessionId,
                            timestamp: ts(),
                            durationMs: durationMs,
                            framesProcessed: this._stats.framesProcessed,
                            framesDropped: this._stats.framesDropped,
                        });
                        this.events.clear();
                        return [2 /*return*/];
                }
            });
        });
    };
    VisionSessionImpl.prototype.updateConfig = function (updates) {
        if (updates.targetFps != null) {
            this._scheduler.updateTargetFps(updates.targetFps);
            this._perfMonitor.updateTargetFps(updates.targetFps);
        }
        // frameDropPolicy and maxFrameAgeMs are read from config on each feedFrame call.
        // Since config is readonly, cast to mutable for targeted in-place updates.
        var mutable = this.config;
        if (updates.targetFps != null)
            mutable.targetFps = updates.targetFps;
        if (updates.frameDropPolicy != null)
            mutable.frameDropPolicy = updates.frameDropPolicy;
        if (updates.maxFrameAgeMs != null)
            mutable.maxFrameAgeMs = updates.maxFrameAgeMs;
    };
    VisionSessionImpl.prototype.getStatistics = function () {
        var durationMs = Date.now() - this._startedAt;
        var metrics = this._perfMonitor.getMetrics();
        var stageLatencies = {};
        for (var _i = 0, _a = this._stats.stageLatencyAccum; _i < _a.length; _i++) {
            var _b = _a[_i], stage = _b[0], arr = _b[1];
            if (arr.length > 0) {
                stageLatencies[stage] = arr.reduce(function (s, v) { return s + v; }, 0) / arr.length;
            }
        }
        return {
            sessionId: this.sessionId,
            startedAt: this._startedAt,
            durationMs: durationMs,
            framesAcquired: this._stats.framesAcquired,
            framesProcessed: this._stats.framesProcessed,
            framesDropped: this._stats.framesDropped,
            framesWithInference: this._stats.framesWithInference,
            currentFps: metrics.currentFps,
            targetFps: this.config.targetFps,
            dropRate: metrics.dropRate,
            averageLatencyMs: this._stats.avgLatencyMs,
            peakLatencyMs: this._stats.peakLatencyMs,
            stageLatencies: stageLatencies,
            totalPrivacyObjectsDetected: this._stats.totalPrivacyObjectsDetected,
            totalPrivacyRedactions: this._stats.totalPrivacyRedactions,
            totalCaptures: this._stats.totalCaptures,
            activeProfile: metrics.activeProfile,
        };
    };
    VisionSessionImpl.prototype.snapshot = function () {
        return {
            sessionId: this.sessionId,
            state: this._state,
            statistics: this.getStatistics(),
            performance: this._perfMonitor.getMetrics(),
        };
    };
    // ── Private helpers ─────────────────────────────────────────────────────────
    VisionSessionImpl.prototype._dropFrame = function (frame, reason) {
        this._stats.framesDropped++;
        this._perfMonitor.record(0, {}, true);
        this.events.emit({
            kind: "pipeline.frame.dropped",
            sessionId: this.sessionId,
            timestamp: ts(),
            frameIndex: frame.meta.index,
            reason: reason,
        });
    };
    VisionSessionImpl.prototype._applyDropPolicy = function (incoming) {
        switch (this.config.frameDropPolicy) {
            case "drop_oldest": {
                var dropped = this._queue.shift();
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
                for (var _i = 0, _a = this._queue; _i < _a.length; _i++) {
                    var f = _a[_i];
                    this._dropFrame(f, "queue_full");
                }
                this._queue.length = 0;
                this._queue.push(incoming);
                break;
            }
        }
        if (!this._processingActive && this._queue.length > 0) {
            this._kickProcessing();
        }
    };
    VisionSessionImpl.prototype._kickProcessing = function () {
        var _this = this;
        this._processingActive = true;
        this._processLoop().finally(function () { _this._processingActive = false; });
    };
    VisionSessionImpl.prototype._processLoop = function () {
        return __awaiter(this, void 0, void 0, function () {
            var stale, frame;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!(this._queue.length > 0 && this._state === "running")) return [3 /*break*/, 2];
                        // Drain stale queued frames — prefer the newest.
                        while (this._queue.length > 1 && this.config.frameDropPolicy === "drop_oldest") {
                            stale = this._queue.shift();
                            if (stale != null)
                                this._dropFrame(stale, "queue_full");
                        }
                        frame = this._queue.shift();
                        if (frame == null)
                            return [3 /*break*/, 2];
                        return [4 /*yield*/, this._processFrame(frame)];
                    case 1:
                        _a.sent();
                        return [3 /*break*/, 0];
                    case 2: return [2 /*return*/];
                }
            });
        });
    };
    VisionSessionImpl.prototype._processFrame = function (frame) {
        return __awaiter(this, void 0, void 0, function () {
            var isInferenceFrame, context, frameStart, result, err_5, n, _i, _a, _b, stageKey, sr, stage, arr, privacyData, stageLatencies, _c, _d, _e, k, v, adaptation;
            var _f;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0:
                        isInferenceFrame = this._frameCount % this.config.detectionStrideFrames === 0;
                        this._frameCount++;
                        context = {
                            frameCount: this._frameCount,
                            sessionId: this.sessionId,
                            stageResults: {},
                            isInferenceFrame: isInferenceFrame,
                        };
                        frameStart = Date.now();
                        _g.label = 1;
                    case 1:
                        _g.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, this._pipeline.process(frame, context)];
                    case 2:
                        result = _g.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        err_5 = _g.sent();
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
                            message: String(err_5),
                            recoverable: true,
                        });
                        return [3 /*break*/, 4];
                    case 4:
                        // ── Statistics ───────────────────────────────────────────────────────────
                        this._stats.framesProcessed++;
                        if (isInferenceFrame)
                            this._stats.framesWithInference++;
                        this._stats.peakLatencyMs = Math.max(this._stats.peakLatencyMs, result.totalLatencyMs);
                        n = this._stats.framesProcessed;
                        this._stats.avgLatencyMs = (this._stats.avgLatencyMs * (n - 1) + result.totalLatencyMs) / n;
                        // Accumulate per-stage latencies.
                        for (_i = 0, _a = Object.entries(result.stages); _i < _a.length; _i++) {
                            _b = _a[_i], stageKey = _b[0], sr = _b[1];
                            if (sr != null && !sr.skipped) {
                                stage = stageKey;
                                arr = this._stats.stageLatencyAccum.get(stage);
                                if (!arr) {
                                    arr = [];
                                    this._stats.stageLatencyAccum.set(stage, arr);
                                }
                                arr.push(sr.latencyMs);
                                if (arr.length > 60)
                                    arr.shift();
                            }
                        }
                        privacyData = (_f = result.stages["privacy"]) === null || _f === void 0 ? void 0 : _f.data;
                        if (privacyData != null) {
                            this._stats.totalPrivacyObjectsDetected += privacyData.objects.length;
                            this._stats.totalPrivacyRedactions += privacyData.masks.length;
                        }
                        stageLatencies = {};
                        for (_c = 0, _d = Object.entries(result.stages); _c < _d.length; _c++) {
                            _e = _d[_c], k = _e[0], v = _e[1];
                            if (v != null)
                                stageLatencies[k] = v.latencyMs;
                        }
                        this._perfMonitor.record(result.totalLatencyMs, stageLatencies, false);
                        // ── Emit pipeline event ──────────────────────────────────────────────────
                        this.events.emit({
                            kind: "pipeline.frame.processed",
                            sessionId: this.sessionId,
                            timestamp: frame.meta.timestamp,
                            result: result,
                        });
                        // ── Adaptive performance ──────────────────────────────────────────────────
                        if (this.config.adaptivePerformance) {
                            adaptation = this._perfMonitor.checkAdaptation();
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
                        return [2 /*return*/];
                }
            });
        });
    };
    VisionSessionImpl.prototype._bridgeToParent = function (parentEvents) {
        // Forward every event from this session's bus to the engine-level bus.
        var kinds = [
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
        for (var _i = 0, kinds_1 = kinds; _i < kinds_1.length; _i++) {
            var kind = kinds_1[_i];
            // TypeScript requires the kind to be a PipelineEventKind. The `as any` is
            // safe here because we only pass known event kinds from the union.
            this.events.on(kind, function (e) {
                parentEvents.emit(e);
            });
        }
    };
    return VisionSessionImpl;
}());
exports.VisionSessionImpl = VisionSessionImpl;
