/**
 * @platform/smart-vision/live-session — FramePipeline + PipelineEventBus implementations.
 *
 * createFramePipeline() — runs an ordered list of PipelineStageRunners sequentially.
 *   Stage errors are caught and recorded as PipelineStageResult failures; the
 *   pipeline always continues through to the last stage (event_publish) so the
 *   session always emits a pipeline.frame.processed event.
 *
 * createPipelineEventBus() — simple typed event emitter for pipeline events.
 *   All events are dispatched synchronously on the microtask queue.
 */
// ─── Stage ordering ───────────────────────────────────────────────────────────
const STAGE_ORDER = {
    frame_acquisition: 0,
    stability: 1,
    quality: 2,
    scene_memory: 3,
    detection: 4,
    tracking: 5,
    motion_prediction: 6,
    smart_zoom: 7,
    privacy: 8,
    auto_capture: 9,
    event_publish: 10,
};
const STAGE_BUDGETS_MS = {
    stability: 5,
    quality: 20,
    scene_memory: 10,
    detection: 80,
    tracking: 20,
    motion_prediction: 10,
    smart_zoom: 10,
    privacy: 60,
    auto_capture: 15,
    event_publish: 1,
};
// ─── createFramePipeline ─────────────────────────────────────────────────────
export function createFramePipeline(runners, sessionId) {
    // Sort ascending by stage order; mutable so replaceStage can update in place.
    const sorted = [...runners].sort((a, b) => (STAGE_ORDER[a.stage] ?? 99) - (STAGE_ORDER[b.stage] ?? 99));
    return {
        get stages() {
            return sorted.map(r => ({
                stage: r.stage,
                enabled: true,
                order: STAGE_ORDER[r.stage] ?? 99,
                budgetMs: STAGE_BUDGETS_MS[r.stage] ?? 50,
            }));
        },
        async process(frame, context) {
            const pipelineStart = Date.now();
            let ctx = context;
            for (const runner of sorted) {
                let result;
                try {
                    result = await runner.run(frame, ctx);
                }
                catch (err) {
                    result = {
                        stage: runner.stage,
                        ok: false,
                        latencyMs: 0,
                        data: null,
                        error: String(err),
                        skipped: false,
                    };
                }
                // Thread accumulated results into the next stage's context.
                ctx = {
                    ...ctx,
                    stageResults: { ...ctx.stageResults, [runner.stage]: result },
                };
            }
            return {
                sessionId,
                frameIndex: frame.meta.index,
                timestamp: frame.meta.timestamp,
                ranInference: context.isInferenceFrame,
                stages: ctx.stageResults,
                totalLatencyMs: Date.now() - pipelineStart,
            };
        },
        async notifyDropped(_frame, _context) {
            // Stage runners that maintain per-frame counters (e.g. tracking missing-frame
            // counters) should handle this if they expose an onFrameDropped hook.
            // Currently no runners require explicit notification.
        },
        replaceStage(runner) {
            const idx = sorted.findIndex(r => r.stage === runner.stage);
            if (idx >= 0) {
                sorted[idx] = runner;
            }
            else {
                sorted.push(runner);
                sorted.sort((a, b) => (STAGE_ORDER[a.stage] ?? 99) - (STAGE_ORDER[b.stage] ?? 99));
            }
        },
        reset() {
            // No state lives in the pipeline itself — it is stateless.
        },
    };
}
// ─── createPipelineEventBus ───────────────────────────────────────────────────
export function createPipelineEventBus() {
    const listeners = new Map();
    return {
        on(kind, listener) {
            let set = listeners.get(kind);
            if (!set) {
                set = new Set();
                listeners.set(kind, set);
            }
            const fn = listener;
            set.add(fn);
            return () => { set.delete(fn); };
        },
        off(kind) {
            listeners.delete(kind);
        },
        emit(event) {
            const set = listeners.get(event.kind);
            if (set) {
                for (const fn of set) {
                    try {
                        fn(event);
                    }
                    catch { /* listener errors must not break the pipeline */ }
                }
            }
        },
        clear() {
            listeners.clear();
        },
    };
}
