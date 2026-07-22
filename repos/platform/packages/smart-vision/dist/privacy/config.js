"use strict";
/**
 * @platform/smart-vision/privacy — configuration.
 *
 * PrivacyConfiguration controls all operational aspects of the Privacy Engine.
 * Applications construct one at session start and can update it at runtime.
 *
 * DEFAULT_PRIVACY_CONFIGURATION provides conservative, widely-applicable defaults.
 *
 * GOVERNANCE: No domain logic. No class-specific defaults.
 * See repos/platform/GOVERNANCE.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PRIVACY_CONFIGURATION = void 0;
// ─── Defaults ────────────────────────────────────────────────────────────────
exports.DEFAULT_PRIVACY_CONFIGURATION = {
    enabled: true,
    liveVideo: true,
    capturedImages: true,
    reports: true,
    exports: true,
    confidenceThreshold: 0.65,
    trackingEnabled: true,
    maxMissingFrames: 5,
    trackingIouThreshold: 0.35,
    sceneMemoryEnabled: false,
    detectionStrideFrames: 3,
    maxTrackedObjects: 20,
    performanceMode: "balanced",
    batterySaver: false,
    offlineMode: false,
    alwaysRender: false,
};
