"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PRIVACY_CONFIGURATION = void 0;
// ─── Configuration ────────────────────────────────────────────────────────────
var config_1 = require("./config");
Object.defineProperty(exports, "DEFAULT_PRIVACY_CONFIGURATION", { enumerable: true, get: function () { return config_1.DEFAULT_PRIVACY_CONFIGURATION; } });
