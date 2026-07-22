"use strict";
/**
 * @platform/smart-vision/live-session — LiveSessionEngine contract.
 *
 * LiveSessionEngine is the top-level entry point for the platform's
 * continuous vision pipeline. Applications create one engine per context
 * (one per camera session, one per stream), inject their dependencies,
 * and call startSession() to begin processing.
 *
 * Architecture:
 *   LiveSessionFactory.createEngine(deps)   → LiveSessionEngine
 *   engine.startSession(config)             → VisionSession
 *   session.feedFrame(frame)                → (async pipeline runs)
 *   session.events.on(...)                  → application receives results
 *
 * The engine coordinates:
 *   - SmartVision pipeline (stability, quality, detection, tracking,
 *     motion prediction, scene memory, zoom, auto-capture)
 *   - Privacy Engine (detection + redaction)
 *   - PerformanceMonitor (adaptive FPS)
 *   - FrameScheduler (frame rate control + drop policy)
 *   - Unified PipelineEventBus (single subscription surface)
 *
 * GOVERNANCE: Zero domain logic. All behaviour injected via dependencies.
 * See repos/platform/GOVERNANCE.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
