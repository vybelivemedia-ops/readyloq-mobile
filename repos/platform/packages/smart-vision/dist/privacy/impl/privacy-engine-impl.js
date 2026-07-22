"use strict";
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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPrivacyFactory = createPrivacyFactory;
var config_1 = require("../config");
var privacy_history_impl_1 = require("./privacy-history-impl");
var privacy_tracker_1 = require("./privacy-tracker");
// ─── Event bus ────────────────────────────────────────────────────────────────
function createPrivacyEventBus() {
    var listeners = new Map();
    return {
        on: function (kind, listener) {
            var list = listeners.get(kind);
            if (!list) {
                list = [];
                listeners.set(kind, list);
            }
            list.push(listener);
            return function () {
                var l = listeners.get(kind);
                if (l) {
                    var i = l.indexOf(listener);
                    if (i >= 0)
                        l.splice(i, 1);
                }
            };
        },
        off: function (kind) { listeners.delete(kind); },
        emit: function (event) {
            var list = listeners.get(event.kind);
            if (list)
                for (var _i = 0, list_1 = list; _i < list_1.length; _i++) {
                    var fn = list_1[_i];
                    try {
                        fn(event);
                    }
                    catch ( /* isolate */_a) { /* isolate */ }
                }
        },
        clear: function () { listeners.clear(); },
    };
}
// ─── Utilities ────────────────────────────────────────────────────────────────
function ts() { return Date.now(); }
function fi(frame) { return frame.meta.index; }
function ft(frame) { return frame.meta.timestamp; }
function buildPolicyMap(policy) {
    var map = new Map();
    for (var _i = 0, _a = policy.objects; _i < _a.length; _i++) {
        var entry = _a[_i];
        map.set(entry.classId, entry);
    }
    return map;
}
function iou(a, b) {
    var ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    var iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    var inter = ix * iy;
    if (inter === 0)
        return 0;
    var union = a.width * a.height + b.width * b.height - inter;
    return union > 0 ? inter / union : 0;
}
function boxesOverlap(a, b, threshold) {
    if (threshold === void 0) { threshold = 0.1; }
    return iou(a, b) >= threshold;
}
function applyPadding(box, padding) {
    var dx = box.width * padding;
    var dy = box.height * padding;
    return {
        x: Math.max(0, box.x - dx),
        y: Math.max(0, box.y - dy),
        width: Math.min(1 - Math.max(0, box.x - dx), box.width + 2 * dx),
        height: Math.min(1 - Math.max(0, box.y - dy), box.height + 2 * dy),
    };
}
function emptyRunningStats() {
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
function recordStatsUpdate(stats, objects, masks, inferenceMs, wasInferenceFrame, skipped) {
    if (skipped) {
        stats.skippedFrames++;
        return;
    }
    stats.totalFrames++;
    if (wasInferenceFrame) {
        stats.inferenceFrames++;
        stats.totalInferenceMs += inferenceMs;
    }
    else {
        stats.trackedFrames++;
    }
    stats.totalRedactions += masks.length;
    stats.peakObjects = Math.max(stats.peakObjects, objects.length);
    for (var _i = 0, objects_1 = objects; _i < objects_1.length; _i++) {
        var obj = objects_1[_i];
        stats.uniqueObjectIds.add(obj.id);
        var cls = stats.byClass.get(obj.classId);
        if (!cls) {
            cls = { detected: 0, redacted: 0, totalConf: 0 };
            stats.byClass.set(obj.classId, cls);
        }
        cls.detected++;
        cls.totalConf += obj.confidence;
    }
    for (var _a = 0, masks_1 = masks; _a < masks_1.length; _a++) {
        var mask = masks_1[_a];
        var cls = stats.byClass.get(mask.classId);
        if (cls)
            cls.redacted++;
    }
}
function buildStatistics(stats, sessionId, startMs) {
    var durationMs = Date.now() - startMs;
    var inferenceCount = stats.inferenceFrames || 1;
    var byClass = {};
    for (var _i = 0, _a = stats.byClass; _i < _a.length; _i++) {
        var _b = _a[_i], classId = _b[0], cls = _b[1];
        byClass[classId] = {
            detected: cls.detected,
            redacted: cls.redacted,
            averageConfidence: cls.detected > 0 ? cls.totalConf / cls.detected : 0,
        };
    }
    var totalFrameCount = stats.totalFrames || 1;
    return {
        sessionId: sessionId,
        durationMs: durationMs,
        totalFrames: stats.totalFrames,
        inferenceFrames: stats.inferenceFrames,
        trackedFrames: stats.trackedFrames,
        skippedFrames: stats.skippedFrames,
        uniqueObjectsDetected: stats.uniqueObjectIds.size,
        totalRedactions: stats.totalRedactions,
        byClass: byClass,
        averageInferenceMs: stats.totalInferenceMs / inferenceCount,
        averageObjectsPerFrame: stats.totalRedactions / totalFrameCount,
        peakObjectsInFrame: stats.peakObjects,
    };
}
// ─── Mask builder ─────────────────────────────────────────────────────────────
function buildMasksFromPolicy(objects, policyMap, policy, config, timestamp, frameIndex) {
    var _a, _b, _c, _d, _e, _f, _g;
    var masks = [];
    var neverRedactZones = ((_a = policy.zones) !== null && _a !== void 0 ? _a : []).filter(function (z) { return z.mode === "never_redact"; });
    var alwaysRedactZones = ((_b = policy.zones) !== null && _b !== void 0 ? _b : []).filter(function (z) { return z.mode === "always_redact"; });
    var detectAndRedactZones = ((_c = policy.zones) !== null && _c !== void 0 ? _c : []).filter(function (z) { return z.mode === "detect_and_redact"; });
    var _loop_1 = function (obj) {
        var objPolicy = policyMap.get(obj.classId);
        var shouldRedact = void 0;
        var redactionType = policy.defaultRedactionType;
        var strength = policy.defaultStrength;
        var padding = 0;
        var threshold = (_d = objPolicy === null || objPolicy === void 0 ? void 0 : objPolicy.confidenceThreshold) !== null && _d !== void 0 ? _d : config.confidenceThreshold;
        if (obj.confidence < threshold)
            return "continue";
        if (objPolicy) {
            shouldRedact = objPolicy.redact;
            if (shouldRedact) {
                redactionType = objPolicy.redactionType;
                strength = objPolicy.strength;
                padding = (_e = objPolicy.padding) !== null && _e !== void 0 ? _e : 0;
            }
        }
        else {
            shouldRedact = policy.redactUnknownClasses;
        }
        if (!shouldRedact)
            return "continue";
        // Check "never_redact" zones — suppress if object overlaps a protected zone
        var paddedBox = padding > 0 ? applyPadding(obj.box, padding) : obj.box;
        var suppressed = neverRedactZones.some(function (z) { return boxesOverlap(paddedBox, z.region); });
        if (suppressed)
            return "continue";
        masks.push({
            objectId: obj.id,
            classId: obj.classId,
            box: paddedBox,
            redactionType: redactionType,
            strength: strength,
            padding: padding,
            timestamp: timestamp,
            frameIndex: frameIndex,
        });
    };
    // Per-object masks
    for (var _i = 0, objects_2 = objects; _i < objects_2.length; _i++) {
        var obj = objects_2[_i];
        _loop_1(obj);
    }
    // Always-redact zones — add a mask regardless of detections
    for (var _h = 0, alwaysRedactZones_1 = alwaysRedactZones; _h < alwaysRedactZones_1.length; _h++) {
        var zone = alwaysRedactZones_1[_h];
        if (!zone.redactionType)
            continue;
        masks.push({
            objectId: "zone-".concat(zone.id),
            classId: "custom",
            box: zone.region,
            redactionType: zone.redactionType,
            strength: (_f = zone.strength) !== null && _f !== void 0 ? _f : policy.defaultStrength,
            padding: 0,
            timestamp: timestamp,
            frameIndex: frameIndex,
        });
    }
    var _loop_2 = function (zone) {
        if (!zone.redactionType)
            return "continue";
        var hasObjectInZone = objects.some(function (o) { return boxesOverlap(o.box, zone.region, 0.2); });
        if (hasObjectInZone) {
            masks.push({
                objectId: "zone-".concat(zone.id),
                classId: "custom",
                box: zone.region,
                redactionType: zone.redactionType,
                strength: (_g = zone.strength) !== null && _g !== void 0 ? _g : policy.defaultStrength,
                padding: 0,
                timestamp: timestamp,
                frameIndex: frameIndex,
            });
        }
    };
    // Detect-and-redact zones — add mask only if an object was detected inside
    for (var _j = 0, detectAndRedactZones_1 = detectAndRedactZones; _j < detectAndRedactZones_1.length; _j++) {
        var zone = detectAndRedactZones_1[_j];
        _loop_2(zone);
    }
    return masks;
}
// ─── PrivacySessionImpl ───────────────────────────────────────────────────────
var _sessionSeq = 0;
function newSessionId() { return "pvs-".concat(Date.now(), "-").concat(++_sessionSeq); }
var PrivacySessionImpl = /** @class */ (function () {
    function PrivacySessionImpl(deps, policy, config, parentEvents) {
        var _a, _b, _c;
        this.frameCount = 0;
        this.stopped = false;
        // Previous redaction state — for "privacy.redacted" / "privacy.restored" events
        this.previouslyRedacted = new Set();
        this.sessionId = newSessionId();
        this.deps = deps;
        this._policy = policy;
        this._policyMap = buildPolicyMap(policy);
        this._config = config;
        this._renderer = (_a = deps.renderer) !== null && _a !== void 0 ? _a : null;
        this.events = createPrivacyEventBus();
        this.history = (0, privacy_history_impl_1.createPrivacyHistory)();
        this.stats = emptyRunningStats();
        this.startMs = Date.now();
        this.tracker = (0, privacy_tracker_1.createPrivacyTracker)({
            maxMissingFrames: config.maxMissingFrames,
            iouThreshold: config.trackingIouThreshold,
            maxTrackedObjects: config.maxTrackedObjects,
        });
        // Bridge: also forward all session events to the parent engine bus
        var bridge = function (event) { try {
            parentEvents.emit(event);
        }
        catch ( /* */_a) { /* */ } };
        var kinds = [
            "privacy.session.started", "privacy.session.stopped", "privacy.session.error",
            "privacy.detected", "privacy.updated", "privacy.lost",
            "privacy.redacted", "privacy.restored", "privacy.policy_changed",
            "privacy.renderer_changed", "privacy.frame.processed",
        ];
        for (var _i = 0, kinds_1 = kinds; _i < kinds_1.length; _i++) {
            var k = kinds_1[_i];
            this.events.on(k, bridge);
        }
        this.events.emit({
            kind: "privacy.session.started",
            sessionId: this.sessionId,
            timestamp: ts(),
            policyId: policy.id,
            detectorId: deps.provider.providerId,
            rendererId: (_c = (_b = this._renderer) === null || _b === void 0 ? void 0 : _b.rendererId) !== null && _c !== void 0 ? _c : null,
        });
    }
    Object.defineProperty(PrivacySessionImpl.prototype, "policy", {
        get: function () { return this._policy; },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(PrivacySessionImpl.prototype, "config", {
        get: function () { return this._config; },
        enumerable: false,
        configurable: true
    });
    // ── Frame processing ─────────────────────────────────────────────────────────
    PrivacySessionImpl.prototype.feedFrame = function (frame) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                if (this.stopped || !this._config.enabled || !this._config.liveVideo) {
                    return [2 /*return*/, this.emptyResult(frame, true)];
                }
                return [2 /*return*/, this.processFrameInternal(frame, false)];
            });
        });
    };
    PrivacySessionImpl.prototype.processImage = function (frame) {
        return __awaiter(this, void 0, void 0, function () {
            return __generator(this, function (_a) {
                if (this.stopped || !this._config.enabled || !this._config.capturedImages) {
                    return [2 /*return*/, this.emptyResult(frame, true)];
                }
                return [2 /*return*/, this.processFrameInternal(frame, true)];
            });
        });
    };
    PrivacySessionImpl.prototype.processFrameInternal = function (frame, forceInference) {
        return __awaiter(this, void 0, void 0, function () {
            var pipelineStart, stamp, frameIndex, cfg, isInferenceFrame, inferenceMs, skippedInference, newObjects, updatedObjects, lostObjects, activeObjects, classes, request, result, tracked, tracked, err_1, masks, _a, totalMs;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        pipelineStart = Date.now();
                        stamp = ft(frame);
                        frameIndex = fi(frame);
                        cfg = this._config;
                        isInferenceFrame = forceInference || (this.frameCount % cfg.detectionStrideFrames === 0);
                        this.frameCount++;
                        inferenceMs = 0;
                        skippedInference = false;
                        newObjects = [];
                        updatedObjects = [];
                        lostObjects = [];
                        activeObjects = this.tracker.getActive();
                        if (!isInferenceFrame) return [3 /*break*/, 7];
                        classes = this.getRequestedClasses();
                        if (!(classes.length > 0)) return [3 /*break*/, 5];
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, , 4]);
                        request = __assign({ classes: classes, confidenceThreshold: cfg.confidenceThreshold }, (cfg.maxTrackedObjects > 0 ? { maxObjectsPerClass: cfg.maxTrackedObjects } : {}));
                        return [4 /*yield*/, this.deps.provider.detect(frame, request)];
                    case 2:
                        result = _b.sent();
                        inferenceMs = result.inferenceMs;
                        if (cfg.trackingEnabled) {
                            tracked = this.tracker.updateFromDetections(result.objects, stamp, frameIndex);
                            activeObjects = tracked.active;
                            newObjects = tracked.newObjects;
                            updatedObjects = tracked.updatedObjects;
                            lostObjects = tracked.lostObjects;
                        }
                        else {
                            // No tracking — rebuild from detections each frame
                            this.tracker.reset();
                            tracked = this.tracker.updateFromDetections(result.objects, stamp, frameIndex);
                            activeObjects = tracked.active;
                            newObjects = tracked.newObjects;
                            updatedObjects = [];
                            lostObjects = [];
                        }
                        return [3 /*break*/, 4];
                    case 3:
                        err_1 = _b.sent();
                        // Detection failed; keep existing tracked state but tick missing frames
                        skippedInference = true;
                        lostObjects = this.tracker.tickMissing(frameIndex);
                        activeObjects = this.tracker.getActive();
                        return [3 /*break*/, 4];
                    case 4: return [3 /*break*/, 6];
                    case 5:
                        // Policy requests no classes — clear tracker
                        this.tracker.reset();
                        activeObjects = [];
                        skippedInference = true;
                        _b.label = 6;
                    case 6: return [3 /*break*/, 8];
                    case 7:
                        // Non-inference frame: tick missing frames, extrapolate via last-known positions
                        skippedInference = true;
                        lostObjects = this.tracker.tickMissing(frameIndex);
                        activeObjects = this.tracker.getActive();
                        _b.label = 8;
                    case 8:
                        masks = buildMasksFromPolicy(activeObjects, this._policyMap, this._policy, cfg, stamp, frameIndex);
                        // Update redaction state on objects + emit object-level events
                        this.processObjectEvents(activeObjects, masks, newObjects, updatedObjects, lostObjects, stamp, frameIndex);
                        if (!(this._renderer && (masks.length > 0 || cfg.alwaysRender))) return [3 /*break*/, 12];
                        _b.label = 9;
                    case 9:
                        _b.trys.push([9, 11, , 12]);
                        return [4 /*yield*/, this._renderer.render({ frame: frame, masks: masks })];
                    case 10:
                        _b.sent();
                        return [3 /*break*/, 12];
                    case 11:
                        _a = _b.sent();
                        return [3 /*break*/, 12];
                    case 12:
                        totalMs = Date.now() - pipelineStart;
                        recordStatsUpdate(this.stats, activeObjects, masks, inferenceMs, isInferenceFrame, false);
                        this.events.emit({
                            kind: "privacy.frame.processed",
                            sessionId: this.sessionId,
                            timestamp: stamp,
                            frameIndex: frameIndex,
                            objectCount: activeObjects.length,
                            masksApplied: masks.length,
                            skippedInference: skippedInference,
                            totalMs: totalMs,
                        });
                        return [2 /*return*/, { frameIndex: frameIndex, timestamp: stamp, activeObjects: activeObjects, masks: masks, skippedInference: skippedInference, inferenceMs: inferenceMs, totalMs: totalMs }];
                }
            });
        });
    };
    PrivacySessionImpl.prototype.emptyResult = function (frame, skipped) {
        if (skipped)
            this.stats.skippedFrames++;
        return {
            frameIndex: fi(frame),
            timestamp: ft(frame),
            activeObjects: [],
            masks: [],
            skippedInference: skipped,
            inferenceMs: 0,
            totalMs: 0,
        };
    };
    PrivacySessionImpl.prototype.getRequestedClasses = function () {
        var classes = new Set();
        for (var _i = 0, _a = this._policy.objects; _i < _a.length; _i++) {
            var entry = _a[_i];
            if (entry.redact) {
                classes.add(entry.classId);
            }
        }
        // Providers may also detect classes that the policy wants to preserve
        // but we only request classes that the provider supports
        var supported = new Set(this.deps.provider.supportedClasses);
        return __spreadArray([], classes, true).filter(function (c) { return supported.has(c); });
    };
    PrivacySessionImpl.prototype.processObjectEvents = function (activeObjects, masks, newObjects, updatedObjects, lostObjects, stamp, frameIndex) {
        var _a, _b;
        var redactedIds = new Set(masks.map(function (m) { return m.objectId; }));
        var _loop_3 = function (obj) {
            var shouldBeRedacted = redactedIds.has(obj.id);
            var prevRedacted = obj.redacted;
            var prevType = obj.redactionType;
            obj.redacted = shouldBeRedacted;
            obj.redactionType = shouldBeRedacted
                ? ((_b = (_a = masks.find(function (m) { return m.objectId === obj.id; })) === null || _a === void 0 ? void 0 : _a.redactionType) !== null && _b !== void 0 ? _b : null)
                : null;
            if (shouldBeRedacted && !this_1.previouslyRedacted.has(obj.id)) {
                this_1.previouslyRedacted.add(obj.id);
                var mask = masks.find(function (m) { return m.objectId === obj.id; });
                if (mask) {
                    this_1.events.emit({ kind: "privacy.redacted", sessionId: this_1.sessionId, timestamp: stamp, object: __assign({}, obj), mask: mask, frameIndex: frameIndex });
                    this_1.history.append({ object: __assign({}, obj), mask: mask, trigger: "redacted", timestamp: stamp, frameIndex: frameIndex });
                }
            }
            else if (!shouldBeRedacted && this_1.previouslyRedacted.has(obj.id) && prevRedacted) {
                this_1.previouslyRedacted.delete(obj.id);
                this_1.events.emit({ kind: "privacy.restored", sessionId: this_1.sessionId, timestamp: stamp, object: __assign({}, obj), reason: "policy_changed", frameIndex: frameIndex });
                this_1.history.append({ object: __assign({}, obj), mask: null, trigger: "restored", timestamp: stamp, frameIndex: frameIndex });
            }
        };
        var this_1 = this;
        // Update redaction state on objects (side-effectful, but objects are mutable)
        for (var _i = 0, activeObjects_1 = activeObjects; _i < activeObjects_1.length; _i++) {
            var obj = activeObjects_1[_i];
            _loop_3(obj);
        }
        // New objects
        for (var _c = 0, newObjects_1 = newObjects; _c < newObjects_1.length; _c++) {
            var obj = newObjects_1[_c];
            this.events.emit({ kind: "privacy.detected", sessionId: this.sessionId, timestamp: stamp, object: __assign({}, obj), frameIndex: frameIndex });
            this.history.append({ object: __assign({}, obj), mask: null, trigger: "detected", timestamp: stamp, frameIndex: frameIndex });
        }
        // Updated objects
        for (var _d = 0, updatedObjects_1 = updatedObjects; _d < updatedObjects_1.length; _d++) {
            var obj = updatedObjects_1[_d];
            this.events.emit({
                kind: "privacy.updated",
                sessionId: this.sessionId,
                timestamp: stamp,
                object: __assign({}, obj),
                frameIndex: frameIndex,
                changedFields: ["box", "confidence"],
            });
        }
        // Lost objects
        for (var _e = 0, lostObjects_1 = lostObjects; _e < lostObjects_1.length; _e++) {
            var obj = lostObjects_1[_e];
            this.previouslyRedacted.delete(obj.id);
            this.events.emit({ kind: "privacy.lost", sessionId: this.sessionId, timestamp: stamp, object: __assign({}, obj), trackLength: obj.trackLength });
            this.history.append({ object: __assign({}, obj), mask: null, trigger: "lost", timestamp: stamp, frameIndex: frameIndex });
        }
    };
    // ── Policy / renderer management ─────────────────────────────────────────────
    PrivacySessionImpl.prototype.updatePolicy = function (policy) {
        var prev = this._policy;
        this._policy = policy;
        this._policyMap = buildPolicyMap(policy);
        this.events.emit({
            kind: "privacy.policy_changed",
            sessionId: this.sessionId,
            timestamp: ts(),
            previousPolicyId: prev.id,
            newPolicyId: policy.id,
        });
    };
    PrivacySessionImpl.prototype.updateRenderer = function (renderer) {
        return __awaiter(this, void 0, void 0, function () {
            var prev, _a;
            var _b, _c;
            return __generator(this, function (_d) {
                switch (_d.label) {
                    case 0:
                        prev = this._renderer;
                        if (!prev) return [3 /*break*/, 4];
                        _d.label = 1;
                    case 1:
                        _d.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, prev.destroy()];
                    case 2:
                        _d.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        _a = _d.sent();
                        return [3 /*break*/, 4];
                    case 4:
                        this._renderer = renderer;
                        this.events.emit({
                            kind: "privacy.renderer_changed",
                            sessionId: this.sessionId,
                            timestamp: ts(),
                            previousRendererId: (_b = prev === null || prev === void 0 ? void 0 : prev.rendererId) !== null && _b !== void 0 ? _b : null,
                            newRendererId: (_c = renderer === null || renderer === void 0 ? void 0 : renderer.rendererId) !== null && _c !== void 0 ? _c : null,
                        });
                        if (renderer)
                            renderer.reset();
                        return [2 /*return*/];
                }
            });
        });
    };
    // ── State inspection ─────────────────────────────────────────────────────────
    PrivacySessionImpl.prototype.getActiveObjects = function () {
        return this.tracker.getActive();
    };
    PrivacySessionImpl.prototype.getHistory = function () { return this.history; };
    PrivacySessionImpl.prototype.getStatistics = function () {
        return buildStatistics(this.stats, this.sessionId, this.startMs);
    };
    // ── Lifecycle ────────────────────────────────────────────────────────────────
    PrivacySessionImpl.prototype.reset = function () {
        this.tracker.reset();
        this.history.clear();
        this.previouslyRedacted.clear();
        this.frameCount = 0;
        Object.assign(this.stats, emptyRunningStats());
    };
    PrivacySessionImpl.prototype.stop = function () {
        return __awaiter(this, void 0, void 0, function () {
            var totalMs, _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        if (this.stopped)
                            return [2 /*return*/];
                        this.stopped = true;
                        totalMs = Date.now() - this.startMs;
                        if (!this._renderer) return [3 /*break*/, 4];
                        _b.label = 1;
                    case 1:
                        _b.trys.push([1, 3, , 4]);
                        return [4 /*yield*/, this._renderer.destroy()];
                    case 2:
                        _b.sent();
                        return [3 /*break*/, 4];
                    case 3:
                        _a = _b.sent();
                        return [3 /*break*/, 4];
                    case 4:
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
                        return [2 /*return*/];
                }
            });
        });
    };
    return PrivacySessionImpl;
}());
// ─── PrivacyEngineImpl ────────────────────────────────────────────────────────
var PrivacyEngineImpl = /** @class */ (function () {
    function PrivacyEngineImpl(deps) {
        this.deps = deps;
        this._state = "idle";
        this._activeSession = null;
        this.events = createPrivacyEventBus();
    }
    Object.defineProperty(PrivacyEngineImpl.prototype, "state", {
        get: function () { return this._state; },
        enumerable: false,
        configurable: true
    });
    PrivacyEngineImpl.prototype.startSession = function (policy, config) {
        return __awaiter(this, void 0, void 0, function () {
            var err_2, effectiveConfig, session;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!this._activeSession) return [3 /*break*/, 2];
                        return [4 /*yield*/, this._activeSession.stop()];
                    case 1:
                        _a.sent();
                        this._activeSession = null;
                        _a.label = 2;
                    case 2:
                        // Initialise provider
                        this._state = "running";
                        _a.label = 3;
                    case 3:
                        _a.trys.push([3, 5, , 6]);
                        return [4 /*yield*/, this.deps.provider.initialize()];
                    case 4:
                        _a.sent();
                        return [3 /*break*/, 6];
                    case 5:
                        err_2 = _a.sent();
                        this._state = "error";
                        throw err_2;
                    case 6:
                        effectiveConfig = __assign(__assign({}, config_1.DEFAULT_PRIVACY_CONFIGURATION), config);
                        session = new PrivacySessionImpl(this.deps, policy, effectiveConfig, this.events);
                        this._activeSession = session;
                        return [2 /*return*/, session];
                }
            });
        });
    };
    PrivacyEngineImpl.prototype.destroy = function () {
        return __awaiter(this, void 0, void 0, function () {
            var _a;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        this._state = "stopping";
                        if (!this._activeSession) return [3 /*break*/, 2];
                        return [4 /*yield*/, this._activeSession.stop()];
                    case 1:
                        _b.sent();
                        this._activeSession = null;
                        _b.label = 2;
                    case 2:
                        _b.trys.push([2, 4, , 5]);
                        return [4 /*yield*/, this.deps.provider.destroy()];
                    case 3:
                        _b.sent();
                        return [3 /*break*/, 5];
                    case 4:
                        _a = _b.sent();
                        return [3 /*break*/, 5];
                    case 5:
                        this.events.clear();
                        this._state = "idle";
                        return [2 /*return*/];
                }
            });
        });
    };
    return PrivacyEngineImpl;
}());
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
function createPrivacyFactory() {
    return {
        createEngine: function (deps) {
            return new PrivacyEngineImpl(deps);
        },
    };
}
