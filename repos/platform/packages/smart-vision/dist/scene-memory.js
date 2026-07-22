/**
 * @platform/smart-vision — scene memory contracts.
 *
 * Scene Memory transforms Smart Vision from a frame-by-frame analyser into a
 * continuously-aware capture engine. Rather than treating each incoming frame
 * in isolation, the engine maintains a live spatial record of everything that
 * has already been processed in the current scene and uses that record to:
 *
 *   - Avoid re-capturing or re-running inference on regions already processed.
 *   - Score incoming regions for novelty before committing resources.
 *   - Track scene-level coverage and guide the operator toward unexplored areas.
 *   - Persist and restore memory across brief interruptions (app background,
 *     provider reconnect, session hand-off).
 *
 * ─── ARCHITECTURE ────────────────────────────────────────────────────────────
 *
 * Three layered concerns:
 *
 *   1. Observations — what was seen, where, when, and at what confidence.
 *      The caller supplies kind ("captured", "inferred", …) and an optional
 *      label. No domain strings appear here.
 *
 *   2. Scene anchoring — stable visual reference points that allow the
 *      memory to re-project observations when the camera moves. Without
 *      anchoring, memory is valid only in frame-relative coordinates and
 *      must be invalidated on significant camera movement. With anchoring,
 *      memory persists across camera motion.
 *
 *   3. Coverage + novelty + navigation — aggregate outputs that drive
 *      auto-capture suppression, operator guidance, and session reporting.
 *
 * ─── COORDINATE SPACES ───────────────────────────────────────────────────────
 *
 *   "frame"          — observations are in the current frame's coordinate
 *                      space [0,1]². Fast, no re-projection needed. Memory is
 *                      invalidated when camera moves beyond the drift threshold.
 *
 *   "anchor_relative" — observations are expressed relative to a detected
 *                       SceneAnchor. Memory survives camera motion as long as
 *                       the anchor remains visible. Recommended default.
 *
 *   "world"          — full SLAM / odometry-based world coordinates. Expensive;
 *                      use only when the implementation provides a pose solver.
 *
 * Domain-neutral: "what was seen" is fully caller-defined. The memory records
 * a region, a kind string, and optional metadata. No pest / creator /
 * product-specific terminology appears anywhere in this file.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */
export {};
