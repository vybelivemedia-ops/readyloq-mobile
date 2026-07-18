/**
 * @platform/measurement-core
 *
 * Generic computer vision measurement for the platform.
 *
 * PURPOSE:
 *   Provide every platform application with the ability to estimate
 *   real-world measurements (width, height, depth, area, volume, distance,
 *   angle, slope) from images, video, or depth data.
 *
 * SCOPE CONSTRAINT (explicit):
 *   This package is domain-agnostic. Zero domain logic.
 *   - NO pest inspection logic (gap scoring, rodent-hole classification)
 *   - NO proposal pricing or material estimation rules
 *   - NO streaming / studio / camera-placement logic
 *   "Object to measure", "what the measurement means", and "what to do with it"
 *   are ALL defined by the consuming application.
 *
 * WHY SEPARATE FROM ai-core + local-intelligence (see ADR-014):
 *   ai-core = stateless AI orchestration (providers, sessions, pipelines)
 *   local-intelligence = on-device ML runtime (model lifecycle, inference engine)
 *   measurement-core = DOMAIN of measuring things in images. It coordinates
 *   geometry, optics, calibration, reference objects, depth estimation, and
 *   evidence annotation — concerns that cross-cut every inference engine.
 *   Mixing this into ai-core or local-intelligence would bloat those packages
 *   with geometry and optics knowledge.
 *
 * INFERENCE INTEGRATION:
 *   measurement-core does NOT import ai-core or local-intelligence.
 *   Instead it defines `MeasurementInferenceProvider` — a narrow interface
 *   that `LocalAIProvider` (from local-intelligence) and cloud providers
 *   both satisfy. Applications inject the provider at initialisation.
 *
 *   Recommended injection pattern:
 *     new MeasurementEngine({
 *       inferenceProvider: myLocalAIProvider,  // or cloud provider
 *       calibration: calibrationService,
 *       ...
 *     })
 *
 * APPLICATION INTEGRATION (examples):
 *   ReadyLoq: measure gap widths, rodent hole diameters, pipe diameters,
 *             window gap clearances, door sweep heights.
 *             The MEANING of the measurement (is the gap big enough for a mouse?)
 *             is defined in readyloq-mobile — NOT here.
 *   VYBE:     measure scene dimensions, camera-to-subject distances, studio
 *             layout for optimal camera placement.
 *   Future:   construction, insurance, facilities, security.
 *
 * DEPENDENCY GRAPH (Level 3 in the platform DAG):
 *   measurement-core → shared-types   (ConfidenceResult, EvidenceItem)
 *   measurement-core → camera-core    (CaptureFrame image input types)
 *   measurement-core → storage-core   (CalibrationStore, MeasurementHistoryStore)
 *   measurement-core → evidence-core  (MeasurementAnnotation → EvidenceItem)
 *
 *   Does NOT import: ai-core, local-intelligence, platform-intelligence
 *   (all three are integrated at runtime via injection or plugin registration)
 */
// ─────────────────────────────────────────────────────────────────────────────
// EVENT KINDS
// ─────────────────────────────────────────────────────────────────────────────
export const MEASUREMENT_EVENT_KINDS = {
    MEASUREMENT_STARTED: "measurement.session.started",
    MEASUREMENT_COMPLETE: "measurement.session.complete",
    MEASUREMENT_FAILED: "measurement.session.failed",
    CALIBRATION_COMPLETE: "measurement.calibration.complete",
    CALIBRATION_FAILED: "measurement.calibration.failed",
    REFERENCE_OBJECT_DETECTED: "measurement.reference_object.detected",
    REFERENCE_OBJECT_NOT_FOUND: "measurement.reference_object.not_found",
    ANNOTATION_CREATED: "measurement.annotation.created",
    ANNOTATION_REVISED: "measurement.annotation.revised",
    DEPTH_ESTIMATION_COMPLETE: "measurement.depth.estimated",
    LOW_CONFIDENCE_WARNING: "measurement.confidence.low",
};
//# sourceMappingURL=index.js.map