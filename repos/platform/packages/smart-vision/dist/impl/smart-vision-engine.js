"use strict";
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
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
exports.createSmartVisionFactory = createSmartVisionFactory;
var config_1 = require("../config");
var event_bus_1 = require("./event-bus");
var frame_scheduler_1 = require("./frame-scheduler");
var stability_1 = require("./stability");
var auto_capture_engine_1 = require("./auto-capture-engine");
var capture_policies_1 = require("./capture-policies");
// ─── Utilities ────────────────────────────────────────────────────────────────
function ts() { return Date.now(); }
function deepMerge(target, source) {
    for (var key in source) {
        var sv = source[key];
        var tv = target[key];
        if (sv !== undefined) {
            if (sv !== null && typeof sv === "object" && !Array.isArray(sv) && tv !== null && typeof tv === "object") {
                deepMerge(tv, sv);
            }
            else {
                target[key] = sv;
            }
        }
    }
    return target;
}
var NOVEL_VERDICT = {
    verdict: "novel",
    novelty: 1,
    matchingObservations: [],
    maxOverlap: 0,
};
var FALLBACK_QUALITY = {
    overall: 75,
    acceptable: true,
    dimensions: [],
    advisories: [],
};
// ─── SmartVisionSession ───────────────────────────────────────────────────────
var SmartVisionSessionImpl = /** @class */ (function () {
    function SmartVisionSessionImpl(deps, cfg, caps, events) {
        var _a, _b;
        this.deps = deps;
        this.events = events;
        this.processing = false;
        this.paused = false;
        this.stopped = false;
        this.startedAt = Date.now();
        // Live state
        this.lastQuality = null;
        this.lastDetection = null;
        this.lastStability = null;
        this.lastTracked = [];
        this.lastDecision = null;
        this.lastGuidance = [];
        this.lastDuplicate = NOVEL_VERDICT;
        this.captureCount = 0;
        this.processedFrames = 0;
        this.droppedFrames = 0;
        this.lastCaptureMs = 0;
        this.sessionId = "sv-".concat(Date.now(), "-").concat(Math.random().toString(36).slice(2, 7));
        this.config = cfg;
        this.capabilities = caps;
        this.scheduler = (0, frame_scheduler_1.createFrameScheduler)(cfg.frameProcessing.analysisTargetFps, {
            detectionStride: cfg.frameProcessing.detectionStrideFrames,
        });
        this.stability = (0, stability_1.createStabilityEstimator)(cfg.frameProcessing.rollingWindowFrames);
        // Wire AutoCaptureEngine
        if (deps.autoCaptureEngine) {
            this.autoCap = null; // caller provides it directly
        }
        else {
            var policyId = cfg.autoCapture.policyId;
            var policy = policyId !== "custom" ? (0, capture_policies_1.createBuiltInPolicy)(policyId) : (0, capture_policies_1.createBuiltInPolicy)("balanced");
            this.autoCap = (0, auto_capture_engine_1.createAutoCaptureEngine)(policyId, policy, cfg.autoCapture);
        }
        events.emit({
            kind: "sv.session.started",
            sessionId: this.sessionId,
            timestamp: ts(),
            policyId: (_b = (_a = this.activeAutoCap) === null || _a === void 0 ? void 0 : _a.policy.id) !== null && _b !== void 0 ? _b : "manual",
            enabledFeatures: Object.keys(cfg.features)
                .filter(function (k) { return cfg.features[k]; }),
        });
    }
    Object.defineProperty(SmartVisionSessionImpl.prototype, "activeAutoCap", {
        get: function () {
            var _a;
            return (_a = this.deps.autoCaptureEngine) !== null && _a !== void 0 ? _a : this.autoCap;
        },
        enumerable: false,
        configurable: true
    });
    // ── Frame ingestion ─────────────────────────────────────────────────────────
    SmartVisionSessionImpl.prototype.feedFrame = function (frame) {
        if (this.paused || this.stopped)
            return;
        this.scheduler.submit(frame);
        if (!this.processing)
            this.triggerLoop();
    };
    SmartVisionSessionImpl.prototype.triggerLoop = function () {
        var _this = this;
        this.processing = true;
        Promise.resolve().then(function () { return _this.processLoop(); });
    };
    SmartVisionSessionImpl.prototype.processLoop = function () {
        return __awaiter(this, void 0, void 0, function () {
            var scheduled;
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (this.stopped) {
                            this.processing = false;
                            return [2 /*return*/];
                        }
                        scheduled = this.scheduler.dequeue();
                        if (!scheduled) {
                            this.processing = false;
                            return [2 /*return*/];
                        }
                        return [4 /*yield*/, this.processFrame(scheduled.frame, scheduled.isDetectionFrame, scheduled.deadlineMs)];
                    case 1:
                        _a.sent();
                        // Continue until the queue is drained
                        Promise.resolve().then(function () { return _this.processLoop(); });
                        return [2 /*return*/];
                }
            });
        });
    };
    SmartVisionSessionImpl.prototype.processFrame = function (frame, isDetectionFrame, deadlineMs) {
        return __awaiter(this, void 0, void 0, function () {
            var now, pipelineStart, cfg, fi, stamp, stab, quality, _a, _b, prevOverall, threshold, wasAbove, isNowAbove, detection, objs, _i, objs_1, obj, trackId, _c, trackedRegions, primarySubject, _d, _e, trackedRegions_1, r, isDuplicate, capEngine, capLimit, capLimitReached, ctx, decision, guidanceCtx, directives, pipelineMs;
            var _f, _g, _h, _j, _k, _l, _m;
            return __generator(this, function (_o) {
                switch (_o.label) {
                    case 0:
                        now = Date.now();
                        if (now > deadlineMs) {
                            this.droppedFrames++;
                            this.events.emit({ kind: "sv.frame.dropped", sessionId: this.sessionId, timestamp: ts(), frameIndex: frame.meta.index, reason: "stale" });
                            return [2 /*return*/];
                        }
                        pipelineStart = now;
                        cfg = this.config;
                        fi = frame.meta.index;
                        stamp = ts();
                        stab = this.stability.update(frame);
                        this.lastStability = stab;
                        quality = (_f = this.lastQuality) !== null && _f !== void 0 ? _f : FALLBACK_QUALITY;
                        if (!(this.deps.qualityScorer && cfg.features.qualityScoring)) return [3 /*break*/, 7];
                        _o.label = 1;
                    case 1:
                        _o.trys.push([1, 5, , 6]);
                        if (!cfg.features.pixelQuality) return [3 /*break*/, 3];
                        return [4 /*yield*/, this.deps.qualityScorer.score(frame)];
                    case 2:
                        _a = _o.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        _a = this.deps.qualityScorer.scoreMetadata(frame);
                        _o.label = 4;
                    case 4:
                        quality = _a;
                        return [3 /*break*/, 6];
                    case 5:
                        _b = _o.sent();
                        return [3 /*break*/, 6];
                    case 6:
                        prevOverall = (_h = (_g = this.lastQuality) === null || _g === void 0 ? void 0 : _g.overall) !== null && _h !== void 0 ? _h : -1;
                        if (Math.abs(quality.overall - prevOverall) >= 5) {
                            this.events.emit({ kind: "sv.quality.changed", sessionId: this.sessionId, timestamp: stamp, report: quality, frameIndex: fi });
                        }
                        threshold = cfg.autoCapture.minQualityScore;
                        if (this.lastQuality !== null) {
                            wasAbove = this.lastQuality.overall >= threshold;
                            isNowAbove = quality.overall >= threshold;
                            if (wasAbove !== isNowAbove) {
                                this.events.emit({ kind: "sv.quality.threshold_crossed", sessionId: this.sessionId, timestamp: stamp, direction: isNowAbove ? "above" : "below", threshold: threshold, score: quality.overall });
                            }
                        }
                        this.lastQuality = quality;
                        _o.label = 7;
                    case 7:
                        detection = this.lastDetection;
                        if (!(isDetectionFrame && this.deps.detectionEngine && cfg.features.detectionEngine)) return [3 /*break*/, 11];
                        _o.label = 8;
                    case 8:
                        _o.trys.push([8, 10, , 11]);
                        return [4 /*yield*/, this.deps.detectionEngine.detect(frame)];
                    case 9:
                        detection = _o.sent();
                        this.lastDetection = detection;
                        // Re-seed the tracker with fresh detections
                        if (this.deps.objectTracker && cfg.features.objectTracking) {
                            objs = (_j = detection.objects) !== null && _j !== void 0 ? _j : [];
                            for (_i = 0, objs_1 = objs; _i < objs_1.length; _i++) {
                                obj = objs_1[_i];
                                trackId = "trk-".concat(obj.classId, "-").concat((_k = obj.objectId) !== null && _k !== void 0 ? _k : obj.classId);
                                this.deps.objectTracker.acquire({ id: trackId, initialBox: obj.box, category: String(obj.classId), persistent: false });
                                if (obj.confidence > 0) {
                                    this.events.emit({ kind: "sv.target.detected", sessionId: this.sessionId, timestamp: stamp, classId: obj.classId, confidence: obj.confidence, box: obj.box, frameIndex: fi });
                                }
                            }
                        }
                        return [3 /*break*/, 11];
                    case 10:
                        _c = _o.sent();
                        return [3 /*break*/, 11];
                    case 11:
                        trackedRegions = this.lastTracked;
                        primarySubject = null;
                        if (!(this.deps.objectTracker && cfg.features.objectTracking)) return [3 /*break*/, 15];
                        _o.label = 12;
                    case 12:
                        _o.trys.push([12, 14, , 15]);
                        return [4 /*yield*/, this.deps.objectTracker.update(frame)];
                    case 13:
                        trackedRegions = _o.sent();
                        this.lastTracked = trackedRegions;
                        return [3 /*break*/, 15];
                    case 14:
                        _d = _o.sent();
                        return [3 /*break*/, 15];
                    case 15:
                        // Primary subject = highest-confidence actively-tracking region
                        for (_e = 0, trackedRegions_1 = trackedRegions; _e < trackedRegions_1.length; _e++) {
                            r = trackedRegions_1[_e];
                            if (r.state === "tracking" && (!primarySubject || r.confidence > primarySubject.confidence)) {
                                primarySubject = r;
                            }
                        }
                        if (primarySubject) {
                            this.events.emit({ kind: "sv.target.updated", sessionId: this.sessionId, timestamp: stamp, region: primarySubject });
                        }
                        isDuplicate = false;
                        if (this.deps.sceneMemory && cfg.features.sceneMemory && primarySubject) {
                            try {
                                this.lastDuplicate = this.deps.sceneMemory.checkDuplicate(primarySubject.box, ["captured"]);
                                isDuplicate = this.lastDuplicate.verdict === "duplicate";
                                if (isDuplicate) {
                                    this.events.emit({ kind: "sv.scene.duplicate_detected", sessionId: this.sessionId, timestamp: stamp, frameIndex: fi, overlapScore: this.lastDuplicate.maxOverlap });
                                }
                            }
                            catch ( /* skip */_p) { /* skip */ }
                        }
                        capEngine = this.activeAutoCap;
                        capLimit = cfg.autoCapture.captureLimit;
                        capLimitReached = capLimit > 0 && this.captureCount >= capLimit;
                        if (capEngine && cfg.features.autoCapture && !capLimitReached) {
                            ctx = {
                                frame: frame,
                                quality: quality,
                                stability: stab,
                                detection: detection,
                                confidenceSummaries: [],
                                primarySubject: primarySubject,
                                allSubjects: trackedRegions,
                                duplicateVerdict: this.lastDuplicate,
                                trigger: "frame_tick",
                                msSinceLastCapture: this.lastCaptureMs > 0 ? Date.now() - this.lastCaptureMs : Infinity,
                                captureCount: this.captureCount,
                                captureLimitReached: capLimitReached,
                                onHold: capEngine.isOnHold,
                            };
                            decision = capEngine.evaluate(ctx);
                            this.lastDecision = decision;
                            if (decision.action === "capture") {
                                this.captureCount++;
                                this.lastCaptureMs = Date.now();
                                capEngine.notifyCaptured(stamp);
                                this.events.emit({ kind: "sv.capture.started", sessionId: this.sessionId, timestamp: stamp, decision: decision, captureIndex: this.captureCount - 1 });
                                // Record to scene memory
                                if (this.deps.sceneMemory && primarySubject) {
                                    this.deps.sceneMemory.record({ region: primarySubject.box, kind: "captured", timestamp: Date.now(), confidence: primarySubject.confidence, trackId: primarySubject.trackId });
                                    this.events.emit({ kind: "sv.scene.coverage_updated", sessionId: this.sessionId, timestamp: stamp, coverage: this.deps.sceneMemory.coverage });
                                }
                            }
                            else {
                                this.events.emit({ kind: "sv.capture.skipped", sessionId: this.sessionId, timestamp: stamp, decision: decision, frameIndex: fi });
                            }
                        }
                        // ── Stage 7: Guidance ─────────────────────────────────────────────────────
                        if (this.deps.guidanceEngine && cfg.features.guidanceEngine) {
                            try {
                                guidanceCtx = {
                                    frame: frame,
                                    quality: quality,
                                    stability: stab,
                                    detection: detection,
                                    primarySubject: primarySubject,
                                    allSubjects: trackedRegions,
                                    autoCaptureActive: !!(capEngine && !capEngine.isOnHold),
                                    captureCount: this.captureCount,
                                    isDuplicate: isDuplicate,
                                    captureLimitReached: capLimitReached,
                                };
                                directives = this.deps.guidanceEngine.evaluate(guidanceCtx);
                                this.lastGuidance = directives;
                                if (directives.length > 0) {
                                    this.events.emit({ kind: "sv.guidance.emitted", sessionId: this.sessionId, timestamp: stamp, directives: directives, dominant: (_m = (_l = directives[0]) === null || _l === void 0 ? void 0 : _l.code) !== null && _m !== void 0 ? _m : null });
                                }
                            }
                            catch ( /* skip guidance errors */_q) { /* skip guidance errors */ }
                        }
                        this.processedFrames++;
                        pipelineMs = Date.now() - pipelineStart;
                        this.events.emit({
                            kind: "sv.frame.processed",
                            sessionId: this.sessionId,
                            timestamp: stamp,
                            frameIndex: fi,
                            pipelineMs: pipelineMs,
                            qualityReport: quality,
                            detectionResult: detection,
                        });
                        return [2 /*return*/];
                }
            });
        });
    };
    // ── Pause / resume ──────────────────────────────────────────────────────────
    SmartVisionSessionImpl.prototype.pause = function (reason) {
        this.paused = true;
        this.events.emit({ kind: "sv.session.paused", sessionId: this.sessionId, timestamp: ts(), reason: reason !== null && reason !== void 0 ? reason : "user_request" });
    };
    SmartVisionSessionImpl.prototype.resume = function () {
        this.paused = false;
        this.events.emit({ kind: "sv.session.resumed", sessionId: this.sessionId, timestamp: ts() });
        // Re-trigger processing if frames were buffered
        if (!this.processing && this.scheduler.queueDepth > 0)
            this.triggerLoop();
    };
    // ── Policy management ───────────────────────────────────────────────────────
    SmartVisionSessionImpl.prototype.setPolicy = function (policy) {
        var engine = this.activeAutoCap;
        if (!engine)
            return;
        var prev = engine.policy.id;
        engine.setPolicy(policy);
        this.events.emit({ kind: "sv.capture.policy_changed", sessionId: this.sessionId, timestamp: ts(), previousPolicyId: prev, newPolicyId: engine.policy.id });
    };
    // ── State queries ───────────────────────────────────────────────────────────
    SmartVisionSessionImpl.prototype.snapshot = function () {
        var _a, _b;
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
            coverage: (_b = (_a = this.deps.sceneMemory) === null || _a === void 0 ? void 0 : _a.coverage) !== null && _b !== void 0 ? _b : null,
            stability: this.lastStability,
            captureCount: this.captureCount,
            processedFrames: this.processedFrames,
            droppedFrames: this.droppedFrames,
            currentFps: 0,
        };
    };
    SmartVisionSessionImpl.prototype.queryObservations = function (options) {
        if (!this.deps.sceneMemory)
            return [];
        var q = __assign(__assign({}, ((options === null || options === void 0 ? void 0 : options.kinds) !== undefined ? { kinds: options.kinds } : {})), ((options === null || options === void 0 ? void 0 : options.limit) !== undefined ? { limit: options.limit } : {}));
        return this.deps.sceneMemory.query(q);
    };
    // ── Manual capture ──────────────────────────────────────────────────────────
    SmartVisionSessionImpl.prototype.requestCapture = function (request) {
        return __awaiter(this, void 0, void 0, function () {
            var stamp, engine, primarySubject, decision;
            var _a, _b, _c, _d, _e, _f, _g;
            return __generator(this, function (_h) {
                stamp = ts();
                engine = this.activeAutoCap;
                primarySubject = (_a = this.lastTracked.find(function (r) { return r.state === "tracking"; })) !== null && _a !== void 0 ? _a : null;
                decision = {
                    action: "capture",
                    score: {
                        detectionConfidence: (_b = primarySubject === null || primarySubject === void 0 ? void 0 : primarySubject.confidence) !== null && _b !== void 0 ? _b : 0,
                        frameQuality: ((_d = (_c = this.lastQuality) === null || _c === void 0 ? void 0 : _c.overall) !== null && _d !== void 0 ? _d : 75) / 100,
                        stability: (_f = (_e = this.lastStability) === null || _e === void 0 ? void 0 : _e.score) !== null && _f !== void 0 ? _f : 1,
                        framing: primarySubject ? Math.min(1, primarySubject.box.width * primarySubject.box.height / 0.25) : 0,
                        novelty: this.lastDuplicate.novelty,
                        composite: 1,
                    },
                    reasons: [{ code: "all_thresholds_met", detail: (request === null || request === void 0 ? void 0 : request.force) ? "Force-requested capture" : "Manual capture requested" }],
                    timestamp: stamp,
                    policyId: (_g = engine === null || engine === void 0 ? void 0 : engine.policy.id) !== null && _g !== void 0 ? _g : "manual",
                };
                this.captureCount++;
                this.lastCaptureMs = Date.now();
                if (engine)
                    engine.notifyCaptured(stamp);
                this.events.emit({ kind: "sv.capture.started", sessionId: this.sessionId, timestamp: stamp, decision: decision, captureIndex: this.captureCount - 1 });
                if (this.deps.sceneMemory && primarySubject) {
                    this.deps.sceneMemory.record({ region: primarySubject.box, kind: "captured", timestamp: Date.now(), confidence: primarySubject.confidence, trackId: primarySubject.trackId });
                }
                return [2 /*return*/, { decision: decision, crop: null, enhancedFrame: null, upscaledFrame: null, captureIndex: this.captureCount - 1 }];
            });
        });
    };
    // ── Stop ────────────────────────────────────────────────────────────────────
    SmartVisionSessionImpl.prototype.stop = function () {
        return __awaiter(this, void 0, void 0, function () {
            var stopTs;
            var _a, _b, _c, _d;
            return __generator(this, function (_e) {
                this.stopped = true;
                stopTs = ts();
                this.events.emit({ kind: "sv.session.stopped", sessionId: this.sessionId, timestamp: stopTs, captureCount: this.captureCount, durationMs: Date.now() - this.startedAt });
                // Teardown
                (_a = this.deps.objectTracker) === null || _a === void 0 ? void 0 : _a.reset();
                (_b = this.deps.motionPredictor) === null || _b === void 0 ? void 0 : _b.reset();
                (_c = this.deps.guidanceEngine) === null || _c === void 0 ? void 0 : _c.reset();
                (_d = this.activeAutoCap) === null || _d === void 0 ? void 0 : _d.reset();
                this.stability.reset();
                this.scheduler.reset();
                return [2 /*return*/];
            });
        });
    };
    return SmartVisionSessionImpl;
}());
// ─── SmartVisionEngine ────────────────────────────────────────────────────────
var SmartVisionEngineImpl = /** @class */ (function () {
    function SmartVisionEngineImpl(deps, caps, config) {
        this.deps = deps;
        this.caps = caps;
        this._state = "idle";
        this._activeSession = null;
        this._config = config;
        this.events = (0, event_bus_1.createEventBus)();
    }
    Object.defineProperty(SmartVisionEngineImpl.prototype, "state", {
        get: function () { return this._state; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(SmartVisionEngineImpl.prototype, "config", {
        get: function () { return this._config; },
        enumerable: false,
        configurable: true
    });
    SmartVisionEngineImpl.prototype.start = function () {
        return __awaiter(this, void 0, void 0, function () {
            var session;
            return __generator(this, function (_a) {
                this._state = "starting";
                session = new SmartVisionSessionImpl(this.deps, this._config, this.caps, this.events);
                this._activeSession = session;
                this._state = "running";
                return [2 /*return*/, session];
            });
        });
    };
    SmartVisionEngineImpl.prototype.updateConfig = function (partial) {
        deepMerge(this._config, partial);
    };
    SmartVisionEngineImpl.prototype.destroy = function () {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        this._state = "stopping";
                        if (!this._activeSession) return [3 /*break*/, 2];
                        return [4 /*yield*/, this._activeSession.stop()];
                    case 1:
                        _a.sent();
                        this._activeSession = null;
                        _a.label = 2;
                    case 2:
                        this.events.clear();
                        this._state = "idle";
                        return [2 /*return*/];
                }
            });
        });
    };
    return SmartVisionEngineImpl;
}());
// ─── SmartVisionFactory ───────────────────────────────────────────────────────
function createSmartVisionFactory() {
    return {
        create: function (deps, capabilities, config) {
            var _a, _b, _c, _d;
            var mergedConfig = __assign(__assign(__assign({}, config_1.DEFAULT_SMART_VISION_CONFIG), config), { features: __assign(__assign({}, config_1.DEFAULT_SMART_VISION_CONFIG.features), ((_a = config === null || config === void 0 ? void 0 : config.features) !== null && _a !== void 0 ? _a : {})), frameProcessing: __assign(__assign({}, config_1.DEFAULT_SMART_VISION_CONFIG.frameProcessing), ((_b = config === null || config === void 0 ? void 0 : config.frameProcessing) !== null && _b !== void 0 ? _b : {})), autoCapture: __assign(__assign({}, config_1.DEFAULT_SMART_VISION_CONFIG.autoCapture), ((_c = config === null || config === void 0 ? void 0 : config.autoCapture) !== null && _c !== void 0 ? _c : {})), guidance: __assign(__assign({}, config_1.DEFAULT_SMART_VISION_CONFIG.guidance), ((_d = config === null || config === void 0 ? void 0 : config.guidance) !== null && _d !== void 0 ? _d : {})) });
            // Negotiate capabilities: disable features that the device/provider can't support
            // In this implementation we pass capabilities through without restricting features.
            var negotiated = capabilities;
            return new SmartVisionEngineImpl(deps, negotiated, mergedConfig);
        },
    };
}
