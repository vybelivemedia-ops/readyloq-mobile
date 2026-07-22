/**
 * @platform/smart-vision/live-session — PerformanceMonitor implementation.
 *
 * Tracks pipeline latency, frame rate, and drop rate over a rolling window.
 * Emits adaptation decisions to help the coordinator scale down when the device
 * cannot sustain the configured target FPS.
 */
import type { PerformanceProfile, PerformanceMonitor } from "../performance";
export declare function createPerformanceMonitor(initialTargetFps: number, initialProfile: PerformanceProfile): PerformanceMonitor;
//# sourceMappingURL=performance-impl.d.ts.map