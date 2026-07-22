/**
 * @platform/smart-vision — concrete SceneMemoryEngine implementation.
 *
 * Composes five in-memory sub-registries into one coherent scene-understanding
 * API. All registries are single-session, in-memory, and serialisable via
 * `getSceneSummary()`.
 */
import type { SceneMemoryEngine, SceneMemoryEngineConfig } from "../scene-memory-engine";
export declare function createSceneMemoryEngine(partial?: Partial<SceneMemoryEngineConfig>): SceneMemoryEngine;
export type { SceneMemoryEngineConfig };
//# sourceMappingURL=scene-memory-engine-impl.d.ts.map