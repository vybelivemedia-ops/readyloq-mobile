"use strict";
/**
 * @platform/smart-vision/live-session — PerformanceMonitor implementation.
 *
 * Tracks pipeline latency, frame rate, and drop rate over a rolling window.
 * Emits adaptation decisions to help the coordinator scale down when the device
 * cannot sustain the configured target FPS.
 */
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
exports.createPerformanceMonitor = createPerformanceMonitor;
var performance_1 = require("../performance");
// ─── Constants ────────────────────────────────────────────────────────────────
var WINDOW_SIZE = 60;
var ADAPTATION_INTERVAL_MS = 2000;
var DOWNGRADE_LATENCY_RATIO = 1.5;
var DOWNGRADE_DROP_RATE = 0.2;
var UPGRADE_LATENCY_RATIO = 0.5;
var UPGRADE_DROP_RATE = 0.02;
var MIN_SAMPLES_FOR_ADAPTATION = 10;
// ─── Factory ─────────────────────────────────────────────────────────────────
function createPerformanceMonitor(initialTargetFps, initialProfile) {
    var targetFps = initialTargetFps;
    var profile = initialProfile;
    var lastAdaptationMs = 0;
    var totalSamples = 0;
    var droppedSamples = 0;
    // Rolling window of total latencies (ms)
    var latencies = [];
    // Timestamps of processed (non-dropped) frames for FPS measurement
    var frameTimes = [];
    // Per-stage latency accumulator (rolling window per stage)
    var stageAccum = new Map();
    function pruneFrameTimes() {
        var _a;
        var cutoff = Date.now() - 1000;
        while (frameTimes.length > 0 && ((_a = frameTimes[0]) !== null && _a !== void 0 ? _a : 0) < cutoff) {
            frameTimes.shift();
        }
    }
    function computeMetrics() {
        var _a, _b, _c;
        pruneFrameTimes();
        var sorted = __spreadArray([], latencies, true).sort(function (a, b) { return a - b; });
        var n = sorted.length;
        var avg = n > 0 ? sorted.reduce(function (s, v) { return s + v; }, 0) / n : 0;
        var p95 = n > 0 ? ((_b = (_a = sorted[Math.floor(n * 0.95)]) !== null && _a !== void 0 ? _a : sorted[n - 1]) !== null && _b !== void 0 ? _b : 0) : 0;
        var peak = n > 0 ? ((_c = sorted[n - 1]) !== null && _c !== void 0 ? _c : 0) : 0;
        var dropRate = totalSamples > 0 ? droppedSamples / totalSamples : 0;
        var stageLatencies = {};
        for (var _i = 0, stageAccum_1 = stageAccum; _i < stageAccum_1.length; _i++) {
            var _d = stageAccum_1[_i], stage = _d[0], arr = _d[1];
            if (arr.length > 0) {
                stageLatencies[stage] = arr.reduce(function (s, v) { return s + v; }, 0) / arr.length;
            }
        }
        return {
            currentFps: frameTimes.length,
            targetFps: targetFps,
            averageLatencyMs: avg,
            p95LatencyMs: p95,
            peakLatencyMs: peak,
            dropRate: dropRate,
            stageLatencies: stageLatencies,
            sampleSize: n,
            activeProfile: profile,
        };
    }
    return {
        record: function (totalLatencyMs, stageLats, dropped) {
            totalSamples++;
            if (dropped) {
                droppedSamples++;
                return;
            }
            frameTimes.push(Date.now());
            latencies.push(totalLatencyMs);
            if (latencies.length > WINDOW_SIZE)
                latencies.shift();
            for (var _i = 0, _a = Object.entries(stageLats); _i < _a.length; _i++) {
                var _b = _a[_i], stageKey = _b[0], ms = _b[1];
                var stage = stageKey;
                var arr = stageAccum.get(stage);
                if (!arr) {
                    arr = [];
                    stageAccum.set(stage, arr);
                }
                arr.push(ms);
                if (arr.length > WINDOW_SIZE)
                    arr.shift();
            }
        },
        getMetrics: computeMetrics,
        checkAdaptation: function () {
            var now = Date.now();
            if (now - lastAdaptationMs < ADAPTATION_INTERVAL_MS)
                return null;
            var m = computeMetrics();
            if (m.sampleSize < MIN_SAMPLES_FOR_ADAPTATION)
                return null;
            lastAdaptationMs = now;
            var budget = 1000 / targetFps;
            // ── Downgrade ──────────────────────────────────────────────────────────
            if (m.averageLatencyMs > budget * DOWNGRADE_LATENCY_RATIO || m.dropRate > DOWNGRADE_DROP_RATE) {
                var newProfile = profile === "high_accuracy" ? "balanced" : "low_power";
                if (newProfile === profile)
                    return null;
                var previousProfile = profile;
                var newFps = performance_1.PROFILE_TARGET_FPS[newProfile];
                var decision = {
                    profileChanged: true,
                    previousProfile: previousProfile,
                    newProfile: newProfile,
                    recommendedFps: newFps,
                    reason: "Average latency ".concat(m.averageLatencyMs.toFixed(0), " ms exceeds budget ").concat(budget.toFixed(0), " ms (drop rate ").concat((m.dropRate * 100).toFixed(0), " %)"),
                };
                profile = newProfile;
                return decision;
            }
            // ── Upgrade ────────────────────────────────────────────────────────────
            if (m.averageLatencyMs < budget * UPGRADE_LATENCY_RATIO && m.dropRate < UPGRADE_DROP_RATE) {
                var newProfile = profile === "low_power" ? "balanced" : "high_accuracy";
                if (newProfile === profile)
                    return null;
                var previousProfile = profile;
                var newFps = performance_1.PROFILE_TARGET_FPS[newProfile];
                var decision = {
                    profileChanged: true,
                    previousProfile: previousProfile,
                    newProfile: newProfile,
                    recommendedFps: newFps,
                    reason: "Device has headroom; upgrading performance profile",
                };
                profile = newProfile;
                return decision;
            }
            return null;
        },
        updateTargetFps: function (fps) {
            targetFps = fps;
        },
        updateProfile: function (p) {
            profile = p;
        },
        reset: function () {
            latencies.length = 0;
            frameTimes.length = 0;
            stageAccum.clear();
            totalSamples = 0;
            droppedSamples = 0;
            lastAdaptationMs = 0;
        },
    };
}
