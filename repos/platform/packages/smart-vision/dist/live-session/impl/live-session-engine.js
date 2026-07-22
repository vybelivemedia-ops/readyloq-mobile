/**
 * @platform/smart-vision/live-session — LiveSessionEngine implementation.
 *
 * LiveSessionEngineImpl manages VisionSession lifecycle — one active session
 * at a time. It exposes a global PipelineEventBus that receives events from
 * all sessions, making it easy to subscribe once and handle sessions that
 * restart without re-subscribing.
 *
 * createLiveSessionFactory() is the single public entry point.
 */
import { DEFAULT_LIVE_SESSION_CONFIG } from "../types";
import { createPipelineEventBus } from "./pipeline-impl";
import { VisionSessionImpl } from "./vision-session-impl";
// ─── LiveSessionEngineImpl ────────────────────────────────────────────────────
class LiveSessionEngineImpl {
    deps;
    _state = "idle";
    _activeSession = null;
    events;
    constructor(deps) {
        this.deps = deps;
        this.events = createPipelineEventBus();
    }
    get state() { return this._state; }
    async startSession(config) {
        // Stop any currently running session before starting a new one.
        if (this._activeSession != null) {
            await this._activeSession.stop();
            this._activeSession = null;
        }
        this._state = "starting";
        const resolved = {
            ...DEFAULT_LIVE_SESSION_CONFIG,
            ...config,
            features: {
                ...DEFAULT_LIVE_SESSION_CONFIG.features,
                ...(config?.features ?? {}),
            },
        };
        const session = new VisionSessionImpl(this.deps, resolved, this.events);
        this._activeSession = session;
        this._state = "running";
        return session;
    }
    async destroy() {
        this._state = "stopping";
        if (this._activeSession != null) {
            await this._activeSession.stop();
            this._activeSession = null;
        }
        this.events.clear();
        this._state = "idle";
    }
}
// ─── Factory ─────────────────────────────────────────────────────────────────
class LiveSessionFactoryImpl {
    createEngine(deps) {
        return new LiveSessionEngineImpl(deps);
    }
}
// ─── Public entry point ───────────────────────────────────────────────────────
/**
 * Create a LiveSessionFactory.
 *
 * Usage:
 *   const factory = createLiveSessionFactory();
 *   const engine  = factory.createEngine(deps);
 *   const session = await engine.startSession(config);
 *   session.feedFrame(frame);
 *   session.events.on("pipeline.frame.processed", handleResult);
 */
export function createLiveSessionFactory() {
    return new LiveSessionFactoryImpl();
}
