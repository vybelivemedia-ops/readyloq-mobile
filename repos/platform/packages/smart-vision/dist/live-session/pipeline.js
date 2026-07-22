"use strict";
/**
 * @platform/smart-vision/live-session — pipeline contracts.
 *
 * FramePipeline:      Runs a VideoFrame through all enabled pipeline stages
 *                     sequentially and returns a PipelineFrameResult.
 *
 * PipelineCoordinator: Manages the async processing loop — dequeues frames,
 *                     calls the pipeline, handles stage errors, and drives
 *                     performance adaptation.
 *
 * DESIGN PRINCIPLES:
 *   - Each stage is an isolated async function; errors are caught per-stage.
 *   - Stages run in strict order; no parallelism within one frame.
 *   - Between frames, the coordinator may adapt target FPS.
 *   - The UI thread is never blocked.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
