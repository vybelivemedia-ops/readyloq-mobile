/**
 * @platform/smart-vision — concrete GuidanceEngine implementation.
 *
 * Maps vision state to generic GuidanceCodes with per-code debounce to
 * prevent the same directive from firing every frame.
 *
 * Priority order: critical → warning → info.
 * At most config.maxConcurrentDirectives directives are emitted per evaluation.
 */
const LEVEL_ORDER = { critical: 0, warning: 1, info: 2 };
export function createGuidanceEngine(options = {}) {
    const minRepeatMs = options.minRepeatIntervalMs ?? 2000;
    const maxDirectives = options.maxConcurrentDirectives ?? 3;
    const suppressCodes = new Set(options.suppressCodes ?? []);
    const lastEmitted = new Map();
    function canEmit(code, now) {
        if (suppressCodes.has(code))
            return false;
        const last = lastEmitted.get(code) ?? 0;
        return now - last >= minRepeatMs;
    }
    function subjectCoverage(box) {
        return box.width * box.height;
    }
    return {
        evaluate(ctx) {
            const now = Date.now();
            const pending = [];
            const { quality, stability, detection, primarySubject, isDuplicate, captureLimitReached, autoCaptureActive, captureCount } = ctx;
            const ts = now;
            // ── Stability (critical/warning) ──────────────────────────────────────
            if (stability.score < 0.2) {
                pending.push({ code: "excessive_motion", level: "critical", region: null, message: "Severe camera motion — hold device still" });
            }
            else if (stability.score < 0.55) {
                pending.push({ code: "hold_steady", level: "warning", region: null, message: "Camera is moving — stabilise for best quality", payload: { stabilityScore: stability.score } });
            }
            // ── Sharpness / focus ─────────────────────────────────────────────────
            const sharpDim = quality.dimensions.find(d => d.kind === "sharpness");
            if (sharpDim != null && sharpDim.score < 40) {
                pending.push({ code: "refocus", level: sharpDim.score < 20 ? "critical" : "warning", region: null, message: "Image is out of focus — wait for autofocus to settle" });
            }
            // ── Exposure / lighting ───────────────────────────────────────────────
            const expDim = quality.dimensions.find(d => d.kind === "exposure");
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
                const { box, state, confidence } = primarySubject;
                if (state === "lost") {
                    pending.push({ code: "subject_left_frame", level: "warning", region: null, message: "Tracked subject has left the frame" });
                }
                else if (state === "tracking" || state === "occluded") {
                    // Subject too small
                    const coverage = subjectCoverage(box);
                    if (coverage < 0.03) {
                        pending.push({ code: "move_closer", level: "warning", region: box, message: "Subject is too small — move camera closer", payload: { coverage } });
                    }
                    else if (coverage > 0.90) {
                        pending.push({ code: "move_back", level: "info", region: box, message: "Subject fills the frame — move camera back slightly" });
                    }
                    // Off-centre
                    const cx = box.x + box.width / 2;
                    const cy = box.y + box.height / 2;
                    if (cx < 0.12 || cx > 0.88 || cy < 0.12 || cy > 0.88) {
                        pending.push({ code: "recenter_subject", level: "info", region: box, message: "Subject is near the frame edge — recentre" });
                    }
                    // Low confidence
                    if (confidence < 0.35 && state !== "occluded") {
                        pending.push({ code: "low_confidence", level: "warning", region: box, message: "Low detection confidence", payload: { confidence } });
                    }
                    // Target locked
                    if (state === "tracking" && confidence >= 0.6) {
                        pending.push({ code: "target_locked", level: "info", region: box, message: "Subject locked" });
                    }
                }
            }
            else if (detection === null || (detection.objects?.length ?? 0) === 0) {
                pending.push({ code: "subject_not_detected", level: "info", region: null, message: "No subject detected in frame" });
            }
            // ── Capture state ─────────────────────────────────────────────────────
            if (captureLimitReached && captureCount > 0) {
                pending.push({ code: "capture_limit_reached", level: "info", region: null, message: "Session capture limit reached" });
            }
            else if (isDuplicate) {
                pending.push({ code: "already_captured", level: "info", region: primarySubject?.box ?? null, message: "This region has already been captured" });
            }
            else if (autoCaptureActive && quality.acceptable && primarySubject && primarySubject.confidence >= 0.65) {
                pending.push({ code: "ready_to_capture", level: "info", region: primarySubject.box, message: "Ready to capture" });
            }
            // ── Filter, debounce, and limit ───────────────────────────────────────
            const directives = pending
                .filter(p => canEmit(p.code, now))
                .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
                .slice(0, maxDirectives)
                .map(p => {
                lastEmitted.set(p.code, now);
                const d = { code: p.code, level: p.level, region: p.region, timestamp: ts, message: p.message };
                if (p.payload !== undefined)
                    d.payload = p.payload;
                return d;
            });
            return directives;
        },
        reset() {
            lastEmitted.clear();
        },
    };
}
