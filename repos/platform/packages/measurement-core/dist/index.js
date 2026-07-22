/**
 * @platform/measurement-core
 *
 * Measurement and metrics abstractions — units, conversions, calibration,
 * dimension estimation from images, and physical hardware device contracts.
 *
 * STATUS: New package — interfaces extracted from ReadyLoq measurement roadmap.
 *
 * TWO MEASUREMENT PARADIGMS:
 *   1. Software / AI inference  — MeasurementInferenceProvider (no hardware)
 *      Uses computer vision + monocular depth to estimate dimensions from photos.
 *      ReadyLoq's primary path: photo → reference object detection → scale → estimate.
 *
 *   2. Physical hardware        — MeasurementDeviceProvider (extends DeviceProvider)
 *      Moisture meters, laser distance meters, thermal imagers, environmental
 *      sensors. Plugged in via BLE/USB/wired; readings arrive as structured data.
 *
 * DEVICE-CORE ADOPTION (Phase 15 — @platform/device-core):
 *   MeasurementDeviceProvider extends DeviceProvider, giving every physical
 *   measurement instrument the full device lifecycle: connect/disconnect,
 *   getStatus, checkHealth, getPermissions, on/emit, initialize/teardown.
 *   MeasurementInferenceProvider stays unchanged — it is software, not hardware.
 *
 * DEPENDENCY GRAPH:
 *   measurement-core → shared-types
 *   measurement-core → device-core → provider-registry → core
 *
 * FUTURE WORK:
 *   - Concrete adapters for Protimeter, Fluke, FLIR (extracted from ReadyLoq)
 *   - Calibration service implementation
 *   - AR anchor calibration path
 */
// ─────────────────────────────────────────────────────────────────────────────
// MEASUREMENT EVENTS
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Domain event kinds emitted by the measurement subsystem.
 * All values follow the "measurement.<noun>.<verb>" convention.
 */
export const MEASUREMENT_EVENT_KINDS = {
    INFERENCE_STARTED: "measurement.inference.started",
    INFERENCE_COMPLETED: "measurement.inference.completed",
    INFERENCE_FAILED: "measurement.inference.failed",
    ANNOTATION_CREATED: "measurement.annotation.created",
    ANNOTATION_REVISED: "measurement.annotation.revised",
    CALIBRATION_UPDATED: "measurement.calibration.updated",
    DEVICE_READING_RECEIVED: "measurement.device.reading_received",
    DEVICE_CONNECTED: "measurement.device.connected",
    DEVICE_DISCONNECTED: "measurement.device.disconnected",
    CACHE_HIT: "measurement.cache.hit",
    CACHE_MISS: "measurement.cache.miss",
};
