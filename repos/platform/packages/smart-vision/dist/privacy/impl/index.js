"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPrivacyTracker = exports.createPrivacyHistory = exports.createPrivacyFactory = void 0;
var privacy_engine_impl_1 = require("./privacy-engine-impl");
Object.defineProperty(exports, "createPrivacyFactory", { enumerable: true, get: function () { return privacy_engine_impl_1.createPrivacyFactory; } });
var privacy_history_impl_1 = require("./privacy-history-impl");
Object.defineProperty(exports, "createPrivacyHistory", { enumerable: true, get: function () { return privacy_history_impl_1.createPrivacyHistory; } });
var privacy_tracker_1 = require("./privacy-tracker");
Object.defineProperty(exports, "createPrivacyTracker", { enumerable: true, get: function () { return privacy_tracker_1.createPrivacyTracker; } });
