/**
 * @platform/smart-vision — built-in CapturePolicy implementations.
 *
 * Five strategies covering common capture workflows:
 *   manual           — operator-only; engine never auto-captures
 *   quality_first    — waits for high image quality before capturing
 *   confidence_first — captures as soon as detection confidence is high
 *   balanced         — equal weighting across all five dimensions
 *   continuous       — captures at configured rate intervals (relaxed quality)
 *
 * Applications can register additional policies via AutoCaptureEngine.registerPolicy().
 */
import type { BuiltInPolicyId, CapturePolicy } from "../capture-policy";
export declare function createManualPolicy(): CapturePolicy;
export declare function createQualityFirstPolicy(opts?: {
    qualityThreshold?: number;
    stabilityThreshold?: number;
}): CapturePolicy;
export declare function createConfidenceFirstPolicy(opts?: {
    confidenceThreshold?: number;
    qualityMin?: number;
}): CapturePolicy;
export declare function createBalancedPolicy(opts?: {
    threshold?: number;
}): CapturePolicy;
export declare function createContinuousPolicy(opts?: {
    minQuality?: number;
    intervalMs?: number;
}): CapturePolicy;
export declare function createBuiltInPolicy(id: BuiltInPolicyId): CapturePolicy;
//# sourceMappingURL=capture-policies.d.ts.map