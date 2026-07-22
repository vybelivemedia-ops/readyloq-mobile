"use strict";
/**
 * @platform/smart-vision — concrete MotionPredictor implementation.
 *
 * Linear extrapolation from a rolling window of MotionSamples.
 * Sufficient for 15-fps dead-reckoning between detection frames.
 * Applications requiring Kalman filtering can inject their own predictor.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMotionPredictor = createMotionPredictor;
var WINDOW_SIZE = 8;
function centroid(b) {
    return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}
/**
 * Fit a simple linear regression to an array of (t, v) pairs.
 * Returns { slope, intercept }.
 */
function linReg(pairs) {
    var _a, _b;
    if (pairs.length < 2)
        return { slope: 0, intercept: (_b = (_a = pairs[0]) === null || _a === void 0 ? void 0 : _a[1]) !== null && _b !== void 0 ? _b : 0 };
    var sumT = 0, sumV = 0, sumTT = 0, sumTV = 0;
    for (var _i = 0, pairs_1 = pairs; _i < pairs_1.length; _i++) {
        var _c = pairs_1[_i], t = _c[0], v = _c[1];
        sumT += t;
        sumV += v;
        sumTT += t * t;
        sumTV += t * v;
    }
    var n = pairs.length;
    var denom = n * sumTT - sumT * sumT;
    if (Math.abs(denom) < 1e-9)
        return { slope: 0, intercept: sumV / n };
    var slope = (n * sumTV - sumT * sumV) / denom;
    var intercept = (sumV - slope * sumT) / n;
    return { slope: slope, intercept: intercept };
}
function createMotionPredictor() {
    var state = new Map();
    function getEntry(id) {
        var e = state.get(id);
        if (!e) {
            e = { samples: [] };
            state.set(id, e);
        }
        return e;
    }
    return {
        observe: function (trackId, sample) {
            var e = getEntry(trackId);
            e.samples.push(sample);
            if (e.samples.length > WINDOW_SIZE)
                e.samples.shift();
        },
        predict: function (trackId, lookaheadMs) {
            var e = state.get(trackId);
            if (!e || e.samples.length < 2)
                return null;
            var firstTs = e.samples[0].timestamp;
            var pairsX = [];
            var pairsY = [];
            var pairsW = [];
            var pairsH = [];
            for (var _i = 0, _a = e.samples; _i < _a.length; _i++) {
                var s = _a[_i];
                var t = (s.timestamp - firstTs) / 1000; // seconds
                var _b = centroid(s.box), cx_1 = _b.cx, cy_1 = _b.cy;
                pairsX.push([t, cx_1]);
                pairsY.push([t, cy_1]);
                pairsW.push([t, s.box.width]);
                pairsH.push([t, s.box.height]);
            }
            var lastTs = e.samples[e.samples.length - 1].timestamp;
            var tFuture = (lastTs - firstTs + lookaheadMs) / 1000;
            var rx = linReg(pairsX);
            var ry = linReg(pairsY);
            var rw = linReg(pairsW);
            var rh = linReg(pairsH);
            var cx = rx.slope * tFuture + rx.intercept;
            var cy = ry.slope * tFuture + ry.intercept;
            var w = Math.max(0.01, rw.slope * tFuture + rw.intercept);
            var h = Math.max(0.01, rh.slope * tFuture + rh.intercept);
            return {
                x: Math.max(0, Math.min(1 - w, cx - w / 2)),
                y: Math.max(0, Math.min(1 - h, cy - h / 2)),
                width: w,
                height: h,
            };
        },
        velocity: function (trackId) {
            var e = state.get(trackId);
            if (!e || e.samples.length < 2)
                return null;
            var last = e.samples[e.samples.length - 1];
            var prev = e.samples[e.samples.length - 2];
            var dtMs = last.timestamp - prev.timestamp;
            if (dtMs <= 0)
                return null;
            var _a = centroid(prev.box), cx1 = _a.cx, cy1 = _a.cy;
            var _b = centroid(last.box), cx2 = _b.cx, cy2 = _b.cy;
            var dx = cx2 - cx1;
            var dy = cy2 - cy1;
            var magnitude = Math.sqrt(dx * dx + dy * dy);
            return {
                dx: dx,
                dy: dy,
                magnitude: magnitude,
                angle: Math.atan2(dy, dx),
                velocityPerMs: magnitude / dtMs,
            };
        },
        reset: function (trackId) {
            if (trackId !== undefined) {
                state.delete(trackId);
            }
            else {
                state.clear();
            }
        },
    };
}
