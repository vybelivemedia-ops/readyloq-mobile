"use strict";
/**
 * @platform/smart-vision — built-in CapturePolicy implementations.
 *
 * Five strategies covering common capture workflows:
 *   manual           — operator-only; engine never auto-captures
 *   quality_first    — waits for high image quality before capturing
 *   confidence_first — captures as soon as detection confidence is high
 *   balanced         — equal weighting across all five dimensions
 *   continuous       — captures at configured rate intervals (relaxed quality)
 *
 * Applications can register additional policies via AutoCaptureEngine.registerPolicy().
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createManualPolicy = createManualPolicy;
exports.createQualityFirstPolicy = createQualityFirstPolicy;
exports.createConfidenceFirstPolicy = createConfidenceFirstPolicy;
exports.createBalancedPolicy = createBalancedPolicy;
exports.createContinuousPolicy = createContinuousPolicy;
exports.createBuiltInPolicy = createBuiltInPolicy;
// ─── Helpers ──────────────────────────────────────────────────────────────────
function now() { return Date.now(); }
function primaryConfidence(ctx) {
    var _a, _b, _c, _d;
    // Use the primary subject confidence if available; fall back to first summary
    return (_d = (_b = (_a = ctx.primarySubject) === null || _a === void 0 ? void 0 : _a.confidence) !== null && _b !== void 0 ? _b : (_c = ctx.confidenceSummaries[0]) === null || _c === void 0 ? void 0 : _c.mean) !== null && _d !== void 0 ? _d : 0;
}
function subjectFraming(ctx) {
    if (!ctx.primarySubject)
        return 0;
    var _a = ctx.primarySubject.box, width = _a.width, height = _a.height;
    // Coverage of the frame area — clamp to [0, 1]
    return Math.min(1, width * height / 0.25); // normalised: 25 % frame area = 1.0
}
function makeScore(ctx, composite) {
    return {
        detectionConfidence: primaryConfidence(ctx),
        frameQuality: ctx.quality.overall / 100,
        stability: ctx.stability.score,
        framing: subjectFraming(ctx),
        novelty: ctx.duplicateVerdict.novelty,
        composite: Math.max(0, Math.min(1, composite)),
    };
}
function waitDecision(ctx, policyId, reasons, composite, action) {
    if (composite === void 0) { composite = 0; }
    if (action === void 0) { action = "wait"; }
    return { action: action, score: makeScore(ctx, composite), reasons: reasons, timestamp: now(), policyId: policyId };
}
function captureDecision(ctx, policyId, composite) {
    return {
        action: "capture",
        score: makeScore(ctx, composite),
        reasons: [{ code: "all_thresholds_met", detail: "All policy thresholds satisfied" }],
        timestamp: now(),
        policyId: policyId,
    };
}
// ─── manual ──────────────────────────────────────────────────────────────────
function createManualPolicy() {
    return {
        id: "manual",
        name: "Manual",
        description: "Auto-capture disabled. Operator triggers every capture.",
        evaluate: function (ctx) {
            return waitDecision(ctx, "manual", [{ code: "policy_manual", detail: "Manual-only policy" }], 0);
        },
        reset: function () { },
    };
}
// ─── quality_first ────────────────────────────────────────────────────────────
var QUALITY_FIRST_THRESHOLD = 0.75;
var QUALITY_FIRST_STABILITY = 0.75;
function createQualityFirstPolicy(opts) {
    var _a, _b;
    if (opts === void 0) { opts = {}; }
    var qt = (_a = opts.qualityThreshold) !== null && _a !== void 0 ? _a : QUALITY_FIRST_THRESHOLD;
    var st = (_b = opts.stabilityThreshold) !== null && _b !== void 0 ? _b : QUALITY_FIRST_STABILITY;
    return {
        id: "quality_first",
        name: "Quality First",
        description: "Waits for high image quality and stability, even if detection confidence is low.",
        evaluate: function (ctx) {
            var quality = ctx.quality.overall / 100;
            var stability = ctx.stability.score;
            var reasons = [];
            if (ctx.onHold)
                return waitDecision(ctx, "quality_first", [{ code: "manual_hold", detail: "Engine on hold" }]);
            if (ctx.captureLimitReached)
                return waitDecision(ctx, "quality_first", [{ code: "capture_limit_reached", detail: "Capture limit reached" }], 0, "skip");
            if (stability < st) {
                reasons.push({ code: "unstable_camera", detail: "Stability ".concat(stability.toFixed(2), " < ").concat(st), observedValue: stability, requiredValue: st });
            }
            if (quality < qt) {
                reasons.push({ code: "low_quality", detail: "Quality ".concat((quality * 100).toFixed(0), " < ").concat((qt * 100).toFixed(0)), observedValue: quality, requiredValue: qt });
            }
            var composite = (quality * 0.6 + stability * 0.4);
            if (reasons.length > 0)
                return waitDecision(ctx, "quality_first", reasons, composite);
            return captureDecision(ctx, "quality_first", composite);
        },
        reset: function () { },
    };
}
// ─── confidence_first ─────────────────────────────────────────────────────────
var CONFIDENCE_FIRST_THRESHOLD = 0.7;
var CONFIDENCE_FIRST_QUALITY_MIN = 0.45;
function createConfidenceFirstPolicy(opts) {
    var _a, _b;
    if (opts === void 0) { opts = {}; }
    var ct = (_a = opts.confidenceThreshold) !== null && _a !== void 0 ? _a : CONFIDENCE_FIRST_THRESHOLD;
    var qMin = (_b = opts.qualityMin) !== null && _b !== void 0 ? _b : CONFIDENCE_FIRST_QUALITY_MIN;
    return {
        id: "confidence_first",
        name: "Confidence First",
        description: "Captures as soon as detection confidence is high, tolerating lower image quality.",
        evaluate: function (ctx) {
            var conf = primaryConfidence(ctx);
            var quality = ctx.quality.overall / 100;
            var reasons = [];
            if (ctx.onHold)
                return waitDecision(ctx, "confidence_first", [{ code: "manual_hold", detail: "Engine on hold" }]);
            if (ctx.captureLimitReached)
                return waitDecision(ctx, "confidence_first", [{ code: "capture_limit_reached", detail: "Capture limit reached" }], 0, "skip");
            if (conf < ct) {
                if (conf === 0) {
                    reasons.push({ code: "subject_not_detected", detail: "No detection available", observedValue: conf, requiredValue: ct });
                }
                else {
                    reasons.push({ code: "low_confidence", detail: "Confidence ".concat(conf.toFixed(2), " < ").concat(ct), observedValue: conf, requiredValue: ct });
                }
            }
            if (quality < qMin) {
                reasons.push({ code: "low_quality", detail: "Quality ".concat((quality * 100).toFixed(0), " < ").concat((qMin * 100).toFixed(0)), observedValue: quality, requiredValue: qMin });
            }
            var composite = (conf * 0.7 + quality * 0.3);
            if (reasons.length > 0)
                return waitDecision(ctx, "confidence_first", reasons, composite);
            return captureDecision(ctx, "confidence_first", composite);
        },
        reset: function () { },
    };
}
// ─── balanced ─────────────────────────────────────────────────────────────────
var BALANCED_THRESHOLD = 0.65;
var BALANCED_WEIGHTS = { quality: 0.25, confidence: 0.30, stability: 0.25, framing: 0.10, novelty: 0.10 };
function createBalancedPolicy(opts) {
    var _a;
    if (opts === void 0) { opts = {}; }
    var threshold = (_a = opts.threshold) !== null && _a !== void 0 ? _a : BALANCED_THRESHOLD;
    return {
        id: "balanced",
        name: "Balanced",
        description: "Equal-weighted combination of quality, confidence, stability, framing, and novelty.",
        evaluate: function (ctx) {
            if (ctx.onHold)
                return waitDecision(ctx, "balanced", [{ code: "manual_hold", detail: "Engine on hold" }]);
            if (ctx.captureLimitReached)
                return waitDecision(ctx, "balanced", [{ code: "capture_limit_reached", detail: "Capture limit reached" }], 0, "skip");
            var conf = primaryConfidence(ctx);
            var quality = ctx.quality.overall / 100;
            var stability = ctx.stability.score;
            var framing = subjectFraming(ctx);
            var novelty = ctx.duplicateVerdict.novelty;
            var composite = quality * BALANCED_WEIGHTS.quality +
                conf * BALANCED_WEIGHTS.confidence +
                stability * BALANCED_WEIGHTS.stability +
                framing * BALANCED_WEIGHTS.framing +
                novelty * BALANCED_WEIGHTS.novelty;
            var reasons = [];
            if (composite < threshold) {
                if (quality < 0.5)
                    reasons.push({ code: "low_quality", detail: "Quality ".concat((quality * 100).toFixed(0)), observedValue: quality });
                if (conf < 0.5)
                    reasons.push({ code: "low_confidence", detail: "Confidence ".concat(conf.toFixed(2)), observedValue: conf });
                if (stability < 0.5)
                    reasons.push({ code: "unstable_camera", detail: "Stability ".concat(stability.toFixed(2)), observedValue: stability });
                if (reasons.length === 0)
                    reasons.push({ code: "low_quality", detail: "Composite ".concat(composite.toFixed(2), " < ").concat(threshold), observedValue: composite, requiredValue: threshold });
                return waitDecision(ctx, "balanced", reasons, composite);
            }
            return captureDecision(ctx, "balanced", composite);
        },
        reset: function () { },
    };
}
// ─── continuous ───────────────────────────────────────────────────────────────
var CONTINUOUS_MIN_QUALITY = 0.35;
var CONTINUOUS_INTERVAL_MS = 3000;
function createContinuousPolicy(opts) {
    var _a, _b;
    if (opts === void 0) { opts = {}; }
    var minQuality = (_a = opts.minQuality) !== null && _a !== void 0 ? _a : CONTINUOUS_MIN_QUALITY;
    var intervalMs = (_b = opts.intervalMs) !== null && _b !== void 0 ? _b : CONTINUOUS_INTERVAL_MS;
    return {
        id: "continuous",
        name: "Continuous",
        description: "Captures at regular intervals while quality and presence thresholds are met.",
        evaluate: function (ctx) {
            if (ctx.onHold)
                return waitDecision(ctx, "continuous", [{ code: "manual_hold", detail: "Engine on hold" }]);
            if (ctx.captureLimitReached)
                return waitDecision(ctx, "continuous", [{ code: "capture_limit_reached", detail: "Capture limit reached" }], 0, "skip");
            var quality = ctx.quality.overall / 100;
            if (quality < minQuality) {
                return waitDecision(ctx, "continuous", [{ code: "low_quality", detail: "Quality ".concat((quality * 100).toFixed(0), " < ").concat((minQuality * 100).toFixed(0)), observedValue: quality, requiredValue: minQuality }], quality);
            }
            var elapsed = ctx.msSinceLastCapture;
            if (elapsed < intervalMs) {
                return waitDecision(ctx, "continuous", [{ code: "rate_limited", detail: "".concat(Math.ceil(intervalMs - elapsed), "ms remaining"), observedValue: elapsed, requiredValue: intervalMs }], quality, "wait");
            }
            var composite = quality * 0.6 + ctx.stability.score * 0.4;
            return captureDecision(ctx, "continuous", composite);
        },
        reset: function () { },
    };
}
// ─── Registry ─────────────────────────────────────────────────────────────────
var BUILT_IN_FACTORIES = {
    manual: createManualPolicy,
    quality_first: createQualityFirstPolicy,
    confidence_first: createConfidenceFirstPolicy,
    balanced: createBalancedPolicy,
    continuous: createContinuousPolicy,
};
function createBuiltInPolicy(id) {
    var factory = BUILT_IN_FACTORIES[id];
    return factory();
}
