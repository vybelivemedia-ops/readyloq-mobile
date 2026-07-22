/**
 * @platform/smart-vision/privacy — public contract barrel.
 *
 * Re-exports all privacy engine types and interfaces.
 * Import concrete factory implementations from the impl/ sub-directory.
 *
 * Usage:
 *   import type { PrivacyPolicy, PrivacyObjectClass } from "@platform/smart-vision/privacy";
 *   import { createPrivacyFactory } from "@platform/smart-vision/privacy/impl";
 */
// ─── Configuration ────────────────────────────────────────────────────────────
export { DEFAULT_PRIVACY_CONFIGURATION } from "./config";
