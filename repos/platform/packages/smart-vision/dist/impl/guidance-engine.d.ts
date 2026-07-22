/**
 * @platform/smart-vision — concrete GuidanceEngine implementation.
 *
 * Maps vision state to generic GuidanceCodes with per-code debounce to
 * prevent the same directive from firing every frame.
 *
 * Priority order: critical → warning → info.
 * At most config.maxConcurrentDirectives directives are emitted per evaluation.
 */
import type { GuidanceCode, GuidanceEngine } from "../guidance";
export interface GuidanceEngineOptions {
    /** Minimum ms between same-code emissions. Default 2000. */
    minRepeatIntervalMs?: number;
    /** Max concurrent directives. Default 3. */
    maxConcurrentDirectives?: number;
    /** Codes to suppress entirely. */
    suppressCodes?: readonly GuidanceCode[];
}
export declare function createGuidanceEngine(options?: GuidanceEngineOptions): GuidanceEngine;
//# sourceMappingURL=guidance-engine.d.ts.map