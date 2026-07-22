"use strict";
/**
 * @platform/smart-vision — policy-based auto-capture contracts.
 *
 * Supersedes the simple threshold trigger in auto-capture.ts with a
 * pluggable policy architecture. Instead of a single hardcoded decision
 * function, the engine selects a named CapturePolicy that encodes a
 * capture strategy. Applications choose the policy that fits their workflow.
 *
 * BUILT-IN POLICY IDs:
 *   "manual"             — operator triggers every capture; engine never fires
 *   "quality_first"      — waits for high quality even if detection is weak
 *   "confidence_first"   — captures as soon as detection confidence is high,
 *                          tolerating lower image quality
 *   "balanced"           — equal weighting across quality, confidence, stability
 *   "continuous"         — captures at the configured rate as long as the subject
 *                          is present; quality thresholds are relaxed
 *
 * Applications register additional policies with the AutoCaptureEngine.
 * VYBE might add "creator_framing" which weights composition highly.
 * ReadyLoq might add "evidence_first" which weights uniqueness.
 * Neither policy belongs in this file.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
