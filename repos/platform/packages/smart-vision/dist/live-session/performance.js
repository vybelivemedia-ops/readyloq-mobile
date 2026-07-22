"use strict";
/**
 * @platform/smart-vision/live-session — performance monitoring contracts.
 *
 * The PerformanceMonitor tracks frame latency, drop rates, and effective FPS
 * over a rolling window. It emits adaptation decisions when the pipeline
 * cannot sustain the target frame rate, allowing the scheduler to reduce load.
 *
 * GOVERNANCE: No domain-specific thresholds. All values are generic performance
 * metrics. Tuning lives in the application layer or device-core.
 * See repos/platform/GOVERNANCE.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROFILE_TARGET_FPS = void 0;
/**
 * Target FPS values for each performance profile.
 * The PerformanceMonitor uses these as reference when adapting.
 */
exports.PROFILE_TARGET_FPS = {
    high_accuracy: 60,
    balanced: 30,
    low_power: 15,
};
