/**
 * @platform/smart-vision — concrete SceneMemory implementation.
 *
 * In-memory observation store with:
 *   - IoU-based duplicate detection
 *   - Coverage grid (configurable rows×cols)
 *   - TTL-based freshness
 *   - Navigation hints toward unprocessed cells
 */
import type { SceneMemory, SceneMemoryConfig } from "../scene-memory";
export declare function createSceneMemory(partial?: Partial<SceneMemoryConfig>): SceneMemory;
//# sourceMappingURL=scene-memory-impl.d.ts.map