/**
 * @platform/smart-vision — concrete MotionPredictor implementation.
 *
 * Linear extrapolation from a rolling window of MotionSamples.
 * Sufficient for 15-fps dead-reckoning between detection frames.
 * Applications requiring Kalman filtering can inject their own predictor.
 */
const WINDOW_SIZE = 8;
function centroid(b) {
    return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
}
/**
 * Fit a simple linear regression to an array of (t, v) pairs.
 * Returns { slope, intercept }.
 */
function linReg(pairs) {
    if (pairs.length < 2)
        return { slope: 0, intercept: pairs[0]?.[1] ?? 0 };
    let sumT = 0, sumV = 0, sumTT = 0, sumTV = 0;
    for (const [t, v] of pairs) {
        sumT += t;
        sumV += v;
        sumTT += t * t;
        sumTV += t * v;
    }
    const n = pairs.length;
    const denom = n * sumTT - sumT * sumT;
    if (Math.abs(denom) < 1e-9)
        return { slope: 0, intercept: sumV / n };
    const slope = (n * sumTV - sumT * sumV) / denom;
    const intercept = (sumV - slope * sumT) / n;
    return { slope, intercept };
}
export function createMotionPredictor() {
    const state = new Map();
    function getEntry(id) {
        let e = state.get(id);
        if (!e) {
            e = { samples: [] };
            state.set(id, e);
        }
        return e;
    }
    return {
        observe(trackId, sample) {
            const e = getEntry(trackId);
            e.samples.push(sample);
            if (e.samples.length > WINDOW_SIZE)
                e.samples.shift();
        },
        predict(trackId, lookaheadMs) {
            const e = state.get(trackId);
            if (!e || e.samples.length < 2)
                return null;
            const firstTs = e.samples[0].timestamp;
            const pairsX = [];
            const pairsY = [];
            const pairsW = [];
            const pairsH = [];
            for (const s of e.samples) {
                const t = (s.timestamp - firstTs) / 1000; // seconds
                const { cx, cy } = centroid(s.box);
                pairsX.push([t, cx]);
                pairsY.push([t, cy]);
                pairsW.push([t, s.box.width]);
                pairsH.push([t, s.box.height]);
            }
            const lastTs = e.samples[e.samples.length - 1].timestamp;
            const tFuture = (lastTs - firstTs + lookaheadMs) / 1000;
            const rx = linReg(pairsX);
            const ry = linReg(pairsY);
            const rw = linReg(pairsW);
            const rh = linReg(pairsH);
            const cx = rx.slope * tFuture + rx.intercept;
            const cy = ry.slope * tFuture + ry.intercept;
            const w = Math.max(0.01, rw.slope * tFuture + rw.intercept);
            const h = Math.max(0.01, rh.slope * tFuture + rh.intercept);
            return {
                x: Math.max(0, Math.min(1 - w, cx - w / 2)),
                y: Math.max(0, Math.min(1 - h, cy - h / 2)),
                width: w,
                height: h,
            };
        },
        velocity(trackId) {
            const e = state.get(trackId);
            if (!e || e.samples.length < 2)
                return null;
            const last = e.samples[e.samples.length - 1];
            const prev = e.samples[e.samples.length - 2];
            const dtMs = last.timestamp - prev.timestamp;
            if (dtMs <= 0)
                return null;
            const { cx: cx1, cy: cy1 } = centroid(prev.box);
            const { cx: cx2, cy: cy2 } = centroid(last.box);
            const dx = cx2 - cx1;
            const dy = cy2 - cy1;
            const magnitude = Math.sqrt(dx * dx + dy * dy);
            return {
                dx,
                dy,
                magnitude,
                angle: Math.atan2(dy, dx),
                velocityPerMs: magnitude / dtMs,
            };
        },
        reset(trackId) {
            if (trackId !== undefined) {
                state.delete(trackId);
            }
            else {
                state.clear();
            }
        },
    };
}
