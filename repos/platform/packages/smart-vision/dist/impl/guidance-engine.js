"use strict";
/**
 * @platform/smart-vision — concrete GuidanceEngine implementation.
 *
 * Maps vision state to generic GuidanceCodes with per-code debounce to
 * prevent the same directive from firing every frame.
 *
 * Priority order: critical → warning → info.
 * At most config.maxConcurrentDirectives directives are emitted per evaluation.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGuidanceEngine = createGuidanceEngine;
var LEVEL_ORDER = { critical: 0, warning: 1, info: 2 };
function createGuidanceEngine(options) {
    var _a, _b, _c;
    if (options === void 0) { options = {}; }
    var minRepeatMs = (_a = options.minRepeatIntervalMs) !== null && _a !== void 0 ? _a : 2000;
    var maxDirectives = (_b = options.maxConcurrentDirectives) !== null && _b !== void 0 ? _b : 3;
    var suppressCodes = new Set((_c = options.suppressCodes) !== null && _c !== void 0 ? _c : []);
    var lastEmitted = new Map();
    function canEmit(code, now) {
        var _a;
        if (suppressCodes.has(code))
            return false;
        var last = (_a = lastEmitted.get(code)) !== null && _a !== void 0 ? _a : 0;
        return now - last >= minRepeatMs;
    }
    function subjectCoverage(box) {
        return box.width * box.height;
    }
    return {
        evaluate: function (ctx) {
            var _a, _b, _c;
            var now = Date.now();
            var pending = [];
            var quality = ctx.quality, stability = ctx.stability, detection = ctx.detection, primarySubject = ctx.primarySubject, isDuplicate = ctx.isDuplicate, captureLimitReached = ctx.captureLimitReached, autoCaptureActive = ctx.autoCaptureActive, captureCount = ctx.captureCount;
            var ts = now;
            // ── Stability (critical/warning) ──────────────────────────────────────
            if (stability.score < 0.2) {
                pending.push({ code: "excessive_motion", level: "critical", region: null, message: "Severe camera motion — hold device still" });
            }
            else if (stability.score < 0.55) {
                pending.push({ code: "hold_steady", level: "warning", region: null, message: "Camera is moving — stabilise for best quality", payload: { stabilityScore: stability.score } });
            }
            // ── Sharpness / focus ─────────────────────────────────────────────────
            var sharpDim = quality.dimensions.find(function (d) { return d.kind === "sharpness"; });
            if (sharpDim != null && sharpDim.score < 40) {
                pending.push({ code: "refocus", level: sharpDim.score < 20 ? "critical" : "warning", region: null, message: "Image is out of focus — wait for autofocus to settle" });
            }
            // ── Exposure / lighting ───────────────────────────────────────────────
            var expDim = quality.dimensions.find(function (d) { return d.kind === "exposure"; });
            if (expDim != null) {
                if (expDim.value < 40) {
                    pending.push({ code: "increase_lighting", level: expDim.value < 20 ? "critical" : "warning", region: null, message: "Scene is too dark — increase lighting", payload: { meanLuminance: expDim.value } });
                }
                else if (expDim.value > 215) {
                    pending.push({ code: "reduce_glare", level: "warning", region: null, message: "Scene may be overexposed — reduce glare or direct light" });
                }
            }
            // ── Subject tracking ──────────────────────────────────────────────────
            if (primarySubject) {
                var box = primarySubject.box, state = primarySubject.state, confidence = primarySubject.confidence;
                if (state === "lost") {
                    pending.push({ code: "subject_left_frame", level: "warning", region: null, message: "Tracked subject has left the frame" });
                }
                else if (state === "tracking" || state === "occluded") {
                    // Subject too small
                    var coverage = subjectCoverage(box);
                    if (coverage < 0.03) {
                        pending.push({ code: "move_closer", level: "warning", region: box, message: "Subject is too small — move camera closer", payload: { coverage: coverage } });
                    }
                    else if (coverage > 0.90) {
                        pending.push({ code: "move_back", level: "info", region: box, message: "Subject fills the frame — move camera back slightly" });
                    }
                    // Off-centre
                    var cx = box.x + box.width / 2;
                    var cy = box.y + box.height / 2;
                    if (cx < 0.12 || cx > 0.88 || cy < 0.12 || cy > 0.88) {
                        pending.push({ code: "recenter_subject", level: "info", region: box, message: "Subject is near the frame edge — recentre" });
                    }
                    // Low confidence
                    if (confidence < 0.35 && state !== "occluded") {
                        pending.push({ code: "low_confidence", level: "warning", region: box, message: "Low detection confidence", payload: { confidence: confidence } });
                    }
                    // Target locked
                    if (state === "tracking" && confidence >= 0.6) {
                        pending.push({ code: "target_locked", level: "info", region: box, message: "Subject locked" });
                    }
                }
            }
            else if (detection === null || ((_b = (_a = detection.objects) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) === 0) {
                pending.push({ code: "subject_not_detected", level: "info", region: null, message: "No subject detected in frame" });
            }
            // ── Capture state ─────────────────────────────────────────────────────
            if (captureLimitReached && captureCount > 0) {
                pending.push({ code: "capture_limit_reached", level: "info", region: null, message: "Session capture limit reached" });
            }
            else if (isDuplicate) {
                pending.push({ code: "already_captured", level: "info", region: (_c = primarySubject === null || primarySubject === void 0 ? void 0 : primarySubject.box) !== null && _c !== void 0 ? _c : null, message: "This region has already been captured" });
            }
            else if (autoCaptureActive && quality.acceptable && primarySubject && primarySubject.confidence >= 0.65) {
                pending.push({ code: "ready_to_capture", level: "info", region: primarySubject.box, message: "Ready to capture" });
            }
            // ── Filter, debounce, and limit ───────────────────────────────────────
            var directives = pending
                .filter(function (p) { return canEmit(p.code, now); })
                .sort(function (a, b) { return LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]; })
                .slice(0, maxDirectives)
                .map(function (p) {
                lastEmitted.set(p.code, now);
                var d = { code: p.code, level: p.level, region: p.region, timestamp: ts, message: p.message };
                if (p.payload !== undefined)
                    d.payload = p.payload;
                return d;
            });
            return directives;
        },
        reset: function () {
            lastEmitted.clear();
        },
    };
}
