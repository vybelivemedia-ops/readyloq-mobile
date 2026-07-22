/**
 * @platform/smart-vision — concrete AutoCaptureEngine implementation.
 *
 * Orchestrates per-frame policy evaluation with:
 *   - Rate limiting  — minimum interval between successive captures
 *   - Cooldown       — post-capture quiet period
 *   - Hold           — operator-initiated pause
 *   - Policy registry — named policies, switchable at runtime
 */
import type { AutoCaptureEngine, BuiltInPolicyId, CapturePolicy } from "../capture-policy";
import type { AutoCapturePolicyConfig } from "../config";
export declare function createAutoCaptureEngine(policyId: BuiltInPolicyId | "custom", initialPolicy: CapturePolicy, cfg: AutoCapturePolicyConfig): AutoCaptureEngine;
//# sourceMappingURL=auto-capture-engine.d.ts.map