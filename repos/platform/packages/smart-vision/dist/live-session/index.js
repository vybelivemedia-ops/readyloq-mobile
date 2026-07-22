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
// ─── Core types ───────────────────────────────────────────────────────────────
export { DEFAULT_LIVE_SESSION_CONFIG, DEFAULT_LIVE_SESSION_FEATURES } from "./types";
// ─── Performance ──────────────────────────────────────────────────────────────
export { PROFILE_TARGET_FPS } from "./performance";
