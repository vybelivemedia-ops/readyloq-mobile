"use strict";
/**
 * @platform/smart-vision — concrete AutoCaptureEngine implementation.
 *
 * Orchestrates per-frame policy evaluation with:
 *   - Rate limiting  — minimum interval between successive captures
 *   - Cooldown       — post-capture quiet period
 *   - Hold           — operator-initiated pause
 *   - Policy registry — named policies, switchable at runtime
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAutoCaptureEngine = createAutoCaptureEngine;
var capture_policies_1 = require("./capture-policies");
function createAutoCaptureEngine(policyId, initialPolicy, cfg) {
    var registry = new Map();
    var activePolicy = initialPolicy;
    var _isOnHold = false;
    var _captureCount = 0;
    var _lastCaptureMs = 0;
    function isRateLimited() {
        if (_lastCaptureMs === 0)
            return false;
        var elapsed = Date.now() - _lastCaptureMs;
        // Enforce both minInterval AND cooldown — whichever is larger
        var required = Math.max(cfg.minIntervalMs, cfg.postCaptureCooldownMs);
        return elapsed < required;
    }
    function enforce(decision, ctx) {
        // Engine-level overrides (safety layer on top of policy)
        if (_isOnHold) {
            return __assign(__assign({}, decision), { action: "wait", reasons: [{ code: "manual_hold", detail: "Engine is on hold" }] });
        }
        if (ctx.captureLimitReached) {
            return __assign(__assign({}, decision), { action: "skip", reasons: [{ code: "capture_limit_reached", detail: "Session capture limit reached" }] });
        }
        if (decision.action === "capture" && isRateLimited()) {
            var remaining = Math.max(cfg.minIntervalMs, cfg.postCaptureCooldownMs) - (Date.now() - _lastCaptureMs);
            return __assign(__assign({}, decision), { action: "wait", reasons: [{ code: "rate_limited", detail: "".concat(Math.ceil(remaining), "ms remaining"), observedValue: Date.now() - _lastCaptureMs, requiredValue: cfg.minIntervalMs }] });
        }
        return decision;
    }
    return {
        get policy() { return activePolicy; },
        get isOnHold() { return _isOnHold; },
        get captureCount() { return _captureCount; },
        evaluate: function (ctx) {
            var raw = activePolicy.evaluate(ctx);
            return enforce(raw, ctx);
        },
        setPolicy: function (policy) {
            activePolicy.reset();
            if (typeof policy === "string") {
                var existing = registry.get(policy);
                if (existing) {
                    activePolicy = existing;
                }
                else {
                    // Try built-in
                    activePolicy = (0, capture_policies_1.createBuiltInPolicy)(policy);
                }
            }
            else {
                activePolicy = policy;
            }
        },
        notifyCaptured: function (timestamp) {
            _captureCount++;
            _lastCaptureMs = timestamp;
        },
        hold: function () { _isOnHold = true; },
        resume: function () { _isOnHold = false; },
        registerPolicy: function (policy) {
            if (!registry.has(policy.id)) {
                registry.set(policy.id, policy);
            }
        },
        reset: function () {
            _captureCount = 0;
            _lastCaptureMs = 0;
            _isOnHold = false;
            activePolicy.reset();
        },
    };
}
