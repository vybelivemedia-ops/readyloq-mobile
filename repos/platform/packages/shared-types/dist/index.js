/**
 * @platform/shared-types
 *
 * Cross-app domain types shared across ALL platform packages and consuming
 * applications (readyloq-mobile, vybelive, and any future product).
 *
 * Depends on @platform/core for programming-model primitives (Result, Brand…).
 * All platform packages that need both domain types and programming-model
 * primitives import from here; they do not need to also import @platform/core
 * directly unless they use a primitive that shared-types does not re-export.
 *
 * CANONICAL SOURCES (do not duplicate in app repos once migrated):
 *   - EvidenceItem, CaptureMode, CaptureSource, QualityAssessment,
 *     CaptureTransport, CaptureCapabilities
 *     ← artifacts/readyloq-app/lib/vision/types.ts
 *   - OSEvent, EventPriority, EventStatus
 *     ← repos/vybelive/artifacts/api-server/src/services/os/EventBus.ts
 *   - AIRequest, AIResponse, AIUsage, AIModelHint
 *     ← repos/vybelive/artifacts/api-server/src/services/ai/AIProvider.ts
 *   - ConfidenceScore — bridging concept (ReadyLoq 0-1 batch confidence +
 *     VYBE's executive recommendation confidence 0-100 normalised to 0-1)
 *
 * MIGRATION NOTE: These types must stay domain-agnostic. No pest-inspection
 * logic, no streaming/social logic. Both products import from here.
 *
 * PHASE 1 MIGRATION: Types extracted from artifacts/readyloq-app/lib/vision/types.ts
 * and promoted to this package. The app now re-exports from here via
 * `export type { ... } from "@platform/shared-types"`.
 */
export {};
