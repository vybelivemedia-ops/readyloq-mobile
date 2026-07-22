"use strict";
/**
 * @platform/smart-vision/live-session — public contract barrel.
 *
 * Re-exports all Live Session Engine types and interfaces.
 * Concrete implementations live in the impl/ sub-directory.
 *
 * Usage (contracts only):
 *   import type { VisionSession, LiveSessionConfig } from "@platform/smart-vision/live-session";
 *
 * Usage (with concrete factory):
 *   import { createLiveSessionFactory } from "@platform/smart-vision/live-session/impl";
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROFILE_TARGET_FPS = exports.DEFAULT_LIVE_SESSION_FEATURES = exports.DEFAULT_LIVE_SESSION_CONFIG = void 0;
// ─── Core types ───────────────────────────────────────────────────────────────
var types_1 = require("./types");
Object.defineProperty(exports, "DEFAULT_LIVE_SESSION_CONFIG", { enumerable: true, get: function () { return types_1.DEFAULT_LIVE_SESSION_CONFIG; } });
Object.defineProperty(exports, "DEFAULT_LIVE_SESSION_FEATURES", { enumerable: true, get: function () { return types_1.DEFAULT_LIVE_SESSION_FEATURES; } });
// ─── Performance ──────────────────────────────────────────────────────────────
var performance_1 = require("./performance");
Object.defineProperty(exports, "PROFILE_TARGET_FPS", { enumerable: true, get: function () { return performance_1.PROFILE_TARGET_FPS; } });
