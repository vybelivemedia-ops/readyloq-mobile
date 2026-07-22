"use strict";
/**
 * @platform/smart-vision — SceneMemoryEngine: first-class scene understanding.
 *
 * Elevates scene memory from a feature inside the SmartVisionEngine to a
 * self-contained subsystem that other platform packages can share. Any package
 * that needs to know "what has already been observed here?" can consume this
 * without depending on the full SmartVisionEngine.
 *
 * ─── Hierarchy ───────────────────────────────────────────────────────────────
 *
 *   SceneMemoryEngine          Top-level orchestrator
 *     ObjectRegistry           Persistent object identities across the scene
 *     SpatialMap               Zones, coverage gaps, navigation hints
 *     ObservationHistory       Timestamped log of what was seen
 *     CaptureHistory           Timestamped log of what was captured
 *     MeasurementHistory       Sensor readings tied to spatial positions
 *
 * ─── Why a separate hierarchy from scene-memory.ts ──────────────────────────
 *
 * scene-memory.ts owns the SmartVision-internal per-session contracts
 * (SceneObservation, DuplicateVerdict, SceneCoverage, SceneMemory). Those
 * remain unchanged for backward compatibility.
 *
 * This module defines the broader, cross-session, cross-subsystem view that
 * survives beyond a single inspection session and can be shared with
 * MeasurementCore, AICore, and future spatial reasoning systems.
 *
 * GOVERNANCE: No domain logic. classId values and measurement unit strings
 * are application-defined. See repos/platform/GOVERNANCE.md.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SCENE_MEMORY_ENGINE_CONFIG = void 0;
exports.DEFAULT_SCENE_MEMORY_ENGINE_CONFIG = {
    observationTtlMs: 30 * 60 * 1000,
    objectMergeIouThreshold: 0.3,
    maxObjectsPerClass: 0,
    persistAcrossSessions: false,
};
