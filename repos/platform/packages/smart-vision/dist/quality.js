"use strict";
/**
 * @platform/smart-vision — domain-agnostic frame quality scoring contracts.
 *
 * Promotes the ReadyLoq quality-gate pattern to the platform layer.
 * Dimension names, thresholds, and advisory text are all caller-configured;
 * no pest or creator terminology appears here.
 *
 * CANONICAL SOURCE:
 *   artifacts/readyloq-app/lib/vision/quality-gate.ts
 *   (The concrete implementation stays in the application layer. This package
 *   owns the contract only. Phase 3 will migrate the implementation here with
 *   injectable threshold configuration.)
 *
 * ADVISORY RULE:
 *   Quality scores are NEVER used to discard evidence. A blurry frame
 *   containing real information is always better than no frame. Scores
 *   drive user warnings and auto-capture suppression only.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
