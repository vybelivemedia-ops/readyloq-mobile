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
import type { LiveSessionFactory } from "../engine";
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
export declare function createLiveSessionFactory(): LiveSessionFactory;
//# sourceMappingURL=live-session-engine.d.ts.map