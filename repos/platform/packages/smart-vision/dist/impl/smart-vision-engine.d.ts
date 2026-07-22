/**
 * @platform/smart-vision — concrete SmartVisionEngine + SmartVisionSession.
 *
 * The engine wires together all injectable sub-systems into a single
 * frame-processing pipeline. Domain logic lives exclusively in the injected
 * dependencies; the engine is policy-agnostic.
 *
 * Processing stages per frame (all gated by feature flags):
 *   1. Stability estimation (always)
 *   2. Quality scoring
 *   3. Detection inference (on detection-stride frames only)
 *   4. Object tracking + motion prediction
 *   5. Scene memory duplicate check
 *   6. Auto-capture policy evaluation
 *   7. Guidance engine evaluation
 *   8. Event emission
 */
import type { SmartVisionFactory } from "../engine";
export declare function createSmartVisionFactory(): SmartVisionFactory;
//# sourceMappingURL=smart-vision-engine.d.ts.map