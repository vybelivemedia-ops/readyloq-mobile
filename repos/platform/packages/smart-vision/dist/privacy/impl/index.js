/**
 * @platform/smart-vision/privacy — concrete implementation exports.
 *
 * Import these factories to wire up the Privacy Engine in application code.
 * Contract types live in the parent @platform/smart-vision/privacy module.
 *
 * Usage:
 *   import { createPrivacyFactory } from "@platform/smart-vision/privacy/impl";
 *   import type { PrivacyPolicy } from "@platform/smart-vision/privacy";
 */
export { createPrivacyFactory } from "./privacy-engine-impl";
export { createPrivacyHistory } from "./privacy-history-impl";
export { createPrivacyTracker } from "./privacy-tracker";
