"use strict";
/**
 * @platform/smart-vision/live-session/impl — concrete implementation barrel.
 *
 * Exports the concrete factory (createLiveSessionFactory) and supporting
 * implementation utilities. Applications import from this barrel to access
 * the runtime implementations.
 *
 * Types-only consumers should import from the parent live-session barrel:
 *   import type { VisionSession } from "@platform/smart-vision/live-session";
 *
 * Concrete factory:
 *   import { createLiveSessionFactory } from "@platform/smart-vision/live-session/impl";
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VisionSessionImpl = exports.createLiveFrameScheduler = exports.createPerformanceMonitor = exports.createFramePipeline = exports.createPipelineEventBus = exports.createLiveSessionFactory = void 0;
var live_session_engine_1 = require("./live-session-engine");
Object.defineProperty(exports, "createLiveSessionFactory", { enumerable: true, get: function () { return live_session_engine_1.createLiveSessionFactory; } });
var pipeline_impl_1 = require("./pipeline-impl");
Object.defineProperty(exports, "createPipelineEventBus", { enumerable: true, get: function () { return pipeline_impl_1.createPipelineEventBus; } });
Object.defineProperty(exports, "createFramePipeline", { enumerable: true, get: function () { return pipeline_impl_1.createFramePipeline; } });
var performance_impl_1 = require("./performance-impl");
Object.defineProperty(exports, "createPerformanceMonitor", { enumerable: true, get: function () { return performance_impl_1.createPerformanceMonitor; } });
var scheduler_impl_1 = require("./scheduler-impl");
Object.defineProperty(exports, "createLiveFrameScheduler", { enumerable: true, get: function () { return scheduler_impl_1.createLiveFrameScheduler; } });
var vision_session_impl_1 = require("./vision-session-impl");
Object.defineProperty(exports, "VisionSessionImpl", { enumerable: true, get: function () { return vision_session_impl_1.VisionSessionImpl; } });
