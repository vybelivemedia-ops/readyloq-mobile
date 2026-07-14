# Platform Validation Report

**Generated:** 2026-07-14  
**Scope:** `repos/platform/` — 14 packages, interface-only scaffolding  
**Phase:** Pre-migration validation. Analysis only. No code changes.  
**Status:** WARN — structurally sound; 3 systemic issues require resolution before Phase 1 extraction begins.

---

## Summary

| Area | Result | Issues |
|------|--------|--------|
| Workspace Structure | ✅ PASS | All 14 packages scaffolded correctly |
| Circular Dependencies | ✅ PASS | Zero cycles detected |
| Dependency Inversion | ✅ PASS | Zero DAG violations |
| Application Code Isolation | ✅ PASS | No app code imported by platform |
| TypeScript Compilation | ⚠️ WARN | Could not run — devDep install blocked by network |
| Declared vs Actual Imports | ⚠️ WARN | 10 of 14 packages declare deps they do not import |
| Responsibility Boundaries | ✅ PASS | No cross-boundary contamination found |
| Documentation Coverage | ✅ PASS | ADR + inline JSDoc for all packages |
| Duplicate Infrastructure | ℹ️ INFO | 14 files identified for extraction (report only) |

---

## 1. Workspace Verification

### 1.1 Structure

```
packages/         14 directories
  ai-core/        package.json ✓  tsconfig.json ✓  src/index.ts ✓  (475 lines, 29 exports)
  asset-core/     package.json ✓  tsconfig.json ✓  src/index.ts ✓  (203 lines,  8 exports)
  camera-core/    package.json ✓  tsconfig.json ✓  src/index.ts ✓  (149 lines,  7 exports)
  evidence-core/  package.json ✓  tsconfig.json ✓  src/index.ts ✓  (202 lines, 10 exports)
  live-session-core/ package.json ✓  tsconfig.json ✓  src/index.ts ✓  (218 lines, 16 exports)
  local-intelligence/ package.json ✓  tsconfig.json ✓  src/index.ts ✓  (1082 lines, 68 exports)
  measurement-core/ package.json ✓  tsconfig.json ✓  src/index.ts ✓  (1096 lines, 43 exports)
  meta-wearables/  package.json ✓  tsconfig.json ✓  src/index.ts ✓  (194 lines, 11 exports)
  platform-intelligence/ package.json ✓  tsconfig.json ✓  src/index.ts ✓  (717 lines, 37 exports)
  shared-types/   package.json ✓  tsconfig.json ✓  src/index.ts ✓  (193 lines, 16 exports)
  storage-core/   package.json ✓  tsconfig.json ✓  src/index.ts ✓  (122 lines,  7 exports)
  sync-engine/    package.json ✓  tsconfig.json ✓  src/index.ts ✓  (152 lines,  9 exports)
  ui-core/        package.json ✓  tsconfig.json ✓  src/index.ts ✓  (191 lines, 14 exports)
  voice-intelligence/ package.json ✓  tsconfig.json ✓  src/index.ts ✓  (131 lines, 9 exports)
```

All 14 packages: **complete** ✓  
No orphan packages. No missing `index.ts`. No missing `package.json`. No missing `tsconfig.json`.

### 1.2 pnpm Workspace

`pnpm-workspace.yaml` uses `packages: ["packages/*"]` — glob wildcard. All 14 current packages and any future packages added under `packages/` are automatically included. **PASS.**

### 1.3 TypeScript Compilation

**STATUS: ⚠️ WARN — blocked**

Attempted `pnpm install` → `pnpm -r typecheck`. The Replit network firewall blocked download of `vitest@^1.6.0` (devDependency in 14 packages). This is a Replit sandbox restriction, not a code defect.

**Impact:** Could not confirm TypeScript compiles clean. All packages are interface-only (`export interface`, `export type`, `export const`). Zero `import ... from "..."` statements that reference external runtime libraries. The likelihood of type errors is very low, but it must be confirmed in a standard CI environment or after lifting the devDep restriction.

**Recommended action before Phase 1:** Run `pnpm -r typecheck` in a CI environment (GitHub Actions, Replit deploy preview) to confirm zero TS errors.

### 1.4 Declared vs. Actual TypeScript Imports

This is the most significant structural finding. The scan below shows what each package **declares** in `package.json` vs. what it **actually imports** in `src/index.ts`:

| Package | Declared deps | Actually imports | Delta |
|---------|--------------|-----------------|-------|
| shared-types | (none) | (none) | ✅ |
| storage-core | shared-types | (none) | ⚠️ shared-types declared, not imported |
| camera-core | shared-types | (none) | ⚠️ shared-types declared, not imported |
| ai-core | shared-types | shared-types | ✅ |
| asset-core | shared-types | (none) | ⚠️ shared-types declared, not imported |
| ui-core | shared-types | (none) | ⚠️ shared-types declared, not imported |
| sync-engine | shared-types | shared-types | ✅ |
| evidence-core | shared-types, storage-core | shared-types | ⚠️ storage-core declared, not imported |
| meta-wearables | camera-core, shared-types | camera-core, shared-types | ✅ |
| voice-intelligence | ai-core, shared-types | shared-types | ⚠️ ai-core declared, not imported |
| live-session-core | shared-types, storage-core | shared-types | ⚠️ storage-core declared, not imported |
| platform-intelligence | shared-types, ai-core, camera-core, evidence-core, storage-core, voice-intelligence | camera-core, evidence-core, voice-intelligence | ⚠️ shared-types, ai-core, storage-core declared, not imported |
| local-intelligence | shared-types, ai-core, camera-core, storage-core, evidence-core | shared-types, ai-core | ⚠️ camera-core, storage-core, evidence-core declared, not imported |
| measurement-core | shared-types, camera-core, storage-core, evidence-core | shared-types | ⚠️ camera-core, storage-core, evidence-core declared, not imported |

**Root cause:** Packages are interface-only. Many types that logically derive from a dependency (e.g. `EvidenceItem` from evidence-core, `StorageNamespace` from storage-core) were defined inline rather than imported. This is correct practice for greenfield scaffolding — you define the interface first and wire imports during extraction. However the declared deps are "semantic deps" not currently enforced by the TypeScript compiler.

**Consequence:** TypeScript project references will not validate the declared-but-unused links. The `pnpm dlx madge` circular-dependency checker will also not detect violations that exist only at the declaration level.

**Required action (Phase 0.5 — before Phase 1 extraction):** For each package that has an unused declared dep, either:
- Add an `import type { ... }` statement that uses at least one type from the dep (preferred — makes the dependency real and enforced), OR
- Remove the dep from `package.json` + `tsconfig.json` if the relationship is purely semantic

This must be completed before any production code migration begins, to ensure the DAG is enforced at compile time.

---

## 2. Dependency Audit

### 2.1 Declared Dependency Graph

```
Level 0 — no deps:
  shared-types

Level 1 — → shared-types only:
  storage-core
  camera-core
  ai-core
  asset-core
  ui-core
  sync-engine

Level 2 — → Level 0–1:
  evidence-core        → shared-types, storage-core
  meta-wearables       → shared-types, camera-core
  voice-intelligence   → shared-types, ai-core
  live-session-core    → shared-types, storage-core

Level 3 — → Level 0–2 (peers — none imports another):
  platform-intelligence → shared-types, ai-core, camera-core, evidence-core, storage-core, voice-intelligence
  local-intelligence    → shared-types, ai-core, camera-core, storage-core, evidence-core
  measurement-core      → shared-types, camera-core, storage-core, evidence-core

Level 4 — Applications (never imported by platform):
  readyloq-mobile, vybelive
```

### 2.2 Circular Dependency Check

**Result: ✅ PASS — zero circular dependencies**

Verified by deterministic DFS cycle detection across all 14 packages and all declared edges. The DAG is acyclic.

### 2.3 Dependency Inversion Violations

**Result: ✅ PASS — zero violations**

No package imports a package at a higher DAG level than itself. No Level-3 package imports another Level-3 package.

### 2.4 Application Code Isolation

**Result: ✅ PASS**

Grep for `from ".*readyloq"`, `from ".*vybelive"`, `from ".*mission-control"` across all `packages/*/src/*.ts` files returned zero TypeScript import statements. All references to application repos in platform source files are in JSDoc block comments only (documentation of canonical sources) — not import statements.

**Note on grep tooling:** A naive `grep 'from.*@platform/'` pattern (without anchoring to line-start `^import`) produces false positives by matching JSDoc comment text such as `` `LocalAIProvider` (from @platform/local-intelligence) ``. All import analysis in this report uses `^import` line-anchored grep to avoid this.

---

## 3. Boundary Audit

### Package Responsibility Matrix

| Package | Owns | Confirmed Clean |
|---------|------|----------------|
| **shared-types** | `EvidenceItem`, `ConfidenceResult`, `OSEvent`, `AIRequest/Response/Usage`, `SyncRecord`, `CaptureMode`, `GeoCoordinates` — types shared by 2+ packages | ✅ No domain logic. No pest/stream strings. |
| **camera-core** | `CaptureProvider`, `CaptureSource`, `ProviderRegistry`, `QualityThresholds`, `KVAdapter` — camera hardware abstraction | ✅ No evidence lifecycle. No AI. No upload logic. |
| **storage-core** | `ObjectStorageClient`, `StorageNamespace`, `SignedUrlRequest`, `ObjectMetadata` — object store I/O | ✅ No domain models. No sync logic. |
| **ai-core** | `AIProvider`, `AIProviderFactory`, `AISession`, `AIPipeline`, `EventBus`, `StateEngine`, `AIUsageTracker`, `AI_EVENT_KINDS` — provider orchestration + typed pub/sub | ✅ No prompts. No pest/stream strings. Confidence is 0–1 float. |
| **asset-core** | `AssetRecord`, `AssetType`, `AssetLocation`, `AssetStatus`, `AssetSearchFilter` — generic physical asset data | ✅ No pricing. No pest risk fields. `ownerId` is string (generic). |
| **ui-core** | `ColorToken`, `SpacingToken`, `TypographyToken`, `BorderRadiusToken`, `ComponentSizeVariant`, `ButtonContractProps`, `InputContractProps` — tokens + component prop contracts | ✅ No JSX. No domain strings. |
| **sync-engine** | `SyncEngine<T>`, `SyncRecord`, `SyncQueue`, `SyncPipeline`, `SyncConflictResolver`, `SyncScheduler` — offline queue and upload pipeline | ✅ No AsyncStorage coupling. `FileUploader` is injected. No pest schema. |
| **evidence-core** | `EvidenceItem`, `EvidenceCollection`, `EvidenceAnnotation`, `QualityRecord`, `DedupeEngine`, `EvidenceUploadPipeline` — evidence lifecycle, quality, dedup, upload | ✅ No camera coupling. No pest finding types. `entityType` is generic string. |
| **meta-wearables** | `WearableProvider`, `WearableDevice`, `WearableDiscovery`, `WearableCapability`, `WearableEventKind` — wearable hardware abstraction | ✅ No Meta-specific business logic. Protocol is BLE/generic. |
| **voice-intelligence** | `VoiceRecorder`, `TranscriptionService`, `VoiceCommandRouter<TAction>`, `VoiceCommandMatch` — voice pipeline | ✅ No domain commands. `TAction extends string` is generic. |
| **live-session-core** | `LiveSession`, `AgoraAdapter`, `SocialPublisher`, `SessionRecorder`, `StreamParticipant`, `SessionToken` — live session orchestration | ✅ No creator tiers. No stream title logic. Platform names are injected strings. |
| **platform-intelligence** | `PlatformOS`, `PluginRegistry`, `WorkflowEngine`, `IntelligenceSessionManager`, `GuidanceEngine`, `MemoryOrchestrator`, `ProviderCoordinator`, `EventRouter` — OS kernel | ✅ No inspection workflows. Workflow IDs are strings injected by the app. |
| **local-intelligence** | `ModelManager`, `InferenceEngine`, `VisionEngine`, `OCREngine`, `EmbeddingEngine`, `ImageQualityEngine`, `AICache`, `ResourceMonitor`, `ProviderSelector` — on-device ML runtime | ✅ No pest labels. No stream context. Model IDs are injected strings. |
| **measurement-core** | `MeasurementEngine`, `CalibrationService`, `ReferenceObjectService`, `DepthEstimator`, `DimensionEstimator`, `ScaleEstimator`, `GeometryService`, `MeasurementHistory`, `MeasurementAnnotation` — CV measurement domain | ✅ No gap scoring thresholds. No pest-specific reference objects. Units are generic. |

### Responsibility Overlap Analysis

| Overlap | Packages | Verdict |
|---------|----------|---------|
| Both `evidence-core` and `camera-core` touch image quality | camera-core owns QualityThresholds (config); evidence-core owns QualityRecord (result). Orthogonal. | ✅ Clean separation |
| Both `local-intelligence` and `ai-core` touch AI inference | ai-core = stateless cloud calls; local-intelligence = stateful on-device model lifecycle. | ✅ ADR-013 confirms intentional |
| Both `measurement-core` and `local-intelligence` touch image analysis | local-intelligence = raw inference engine; measurement-core = measurement domain that uses inference via injection. | ✅ ADR-014 confirms intentional |
| `evidence-core` and `sync-engine` both reference upload | sync-engine owns the upload pipeline orchestration (step ordering, retry); evidence-core owns the evidence entity lifecycle (create, quality-check, annotate). Upload is a step in sync, not in evidence-core. | ✅ Clean |
| `storage-core` and `sync-engine` both reference file upload | sync-engine injects `FileUploader` from storage-core at runtime — not a static import. | ✅ ADR-002 confirms intentional |
| `ai-core` and `platform-intelligence` both reference events | ai-core owns the typed EventBus and event kind constants; platform-intelligence owns the EventRouter that routes those events to plugin handlers. | ✅ Clean layering |

**No problematic overlaps found.** All apparent overlaps are intentional separations documented in ADRs.

---

## 4. Duplicate Infrastructure Detection

> Analysis only. No migration. Files listed here are candidates — not commitments.

### 4.1 ReadyLoq Mobile — Extractable Infrastructure

| Source File | Platform Target | What Extracts | What Stays in ReadyLoq |
|------------|----------------|---------------|------------------------|
| `artifacts/readyloq-app/lib/vision/types.ts` | **camera-core** | `CaptureMode`, `CaptureProvider`, `CaptureSource` enums and interfaces | Pest-specific `EntityType` values |
| `artifacts/readyloq-app/lib/vision/provider-registry.ts` | **camera-core** | `ProviderRegistry` class, `ProviderDefinition` shape | Provider definitions that name pest-inspection use-cases |
| `artifacts/readyloq-app/lib/vision/native-camera-provider.ts` | **camera-core** (as example adapter) | `NativeCameraProvider` implementing `CaptureProvider` | Inspection-specific permissions flow |
| `artifacts/readyloq-app/lib/vision/pixels.ts` | **camera-core** / **evidence-core** | Grayscale bitmap decoder, Laplacian variance (blur score) | Nothing — pure math |
| `artifacts/readyloq-app/lib/vision/quality-gate.ts` | **evidence-core** | `QualityGate` scoring logic (0–1 confidence from resolution + sharpness) | Pest-specific quality thresholds config |
| `artifacts/readyloq-app/lib/vision/dedupe.ts` | **evidence-core** | `DedupeEngine` using perceptual hash (dHash) | Nothing — pure algorithm |
| `artifacts/readyloq-app/lib/sync/engine.ts` | **sync-engine** | Generic step-based resumable sync pipeline, retry logic | Pest-inspection step definitions (analyzeInspection calls) |
| `artifacts/readyloq-app/lib/local/inspection-store.ts` | **sync-engine** (KVAdapter pattern) | Local persistence interface | Inspection-specific schema (species, findings, scorecards) |
| `artifacts/readyloq-app/lib/upload.ts` | **storage-core** | `uploadBytes()` using signed URL transport | Nothing — pure upload utility |
| `lib/object-storage-web/src/ObjectUploader.tsx` | **storage-core** | Signed URL uploader (web variant) | Nothing — generic component |

**10 files identified in ReadyLoq for extraction.**

### 4.2 VYBE — Extractable Infrastructure

| Source File | Platform Target | What Extracts | What Stays in VYBE |
|------------|----------------|---------------|---------------------|
| `artifacts/api-server/src/services/ai/AIProvider.ts` | **ai-core** | `AIProvider` interface, `AIRequest`, `AIResponse`, `AIUsage` types | Provider names (`"openai"`, `"anthropic"`) stay as config strings |
| `artifacts/api-server/src/services/ai/AIProviderFactory.ts` | **ai-core** | `AIProviderFactory` with fallback chain, `completeWithFallback` | VYBE-specific DB config lookups (`ai_model_configs` table) |
| `artifacts/api-server/src/services/os/EventBus.ts` | **ai-core** | `EventBus` (typed pub/sub + wildcard + correlation IDs) | VYBE-specific event subscribers |
| `artifacts/api-server/src/services/os/StateEngine.ts` | **ai-core** | `StateEngine` (observable KV store) | Mission Control state keys (`ACTIVE_OBJECTIVE_COUNT` etc.) |
| `artifacts/api-server/src/services/os/types.ts` | **shared-types** | `OSEvent`, `OSStateKey`, `OSSubscription` | VYBE-specific state key enum values |
| `artifacts/api-server/src/lib/objectStorage.ts` | **storage-core** | Sidecar client, signed URL generation, path normalization | VYBE ACL policies (`objectAcl.ts`) |
| `artifacts/api-server/src/services/storageService.ts` | **storage-core** | Higher-level `StorageService` pattern | `uploadClipFile`, `uploadThumbnail` (domain-named methods) |
| `artifacts/api-server/src/services/agoraPush.ts` | **live-session-core** | `AgoraRtmpPusher` lifecycle (start/stop/convert to RTMP) | RTMP destination URLs (YouTube/Twitch platform policy) |
| `artifacts/api-server/src/services/agoraCloudRecording.ts` | **live-session-core** | `AgoraCloudRecorder` (acquire/start/stop recording) | Cloud recording storage bucket config |
| `artifacts/mobile/constants/colors.ts` | **ui-core** | Color token definitions | VYBE-specific brand colors (after generalization) |

**10 files identified in VYBE for extraction.**

### 4.3 Infrastructure Duplicated in Both Apps

| Infrastructure | ReadyLoq | VYBE | Platform Target |
|----------------|----------|------|----------------|
| Object storage client | `lib/objectStorage.ts` (mobile, sidecar 127.0.0.1:1106) | `lib/objectStorage.ts` (server, sidecar) | **storage-core** |
| AI provider abstraction | Direct OpenAI calls + confidence 0–1 model | `AIProvider` / `AIProviderFactory` | **ai-core** |

Both apps use the identical Replit sidecar object storage (`127.0.0.1:1106`). Their `objectStorage.ts` files are functionally equivalent with different auth configs. This is the highest-value de-duplication opportunity: one extraction yields working storage-core adapters for both apps immediately.

---

## 5. Canonical Source Verification

| Package | Canonical Source | Secondary Source | Generalisation Required | Effort | Regression Risk |
|---------|-----------------|-----------------|------------------------|--------|-----------------|
| **shared-types** | Synthesised from both | — | Types from both exist; merge is net-new. Remove all app-specific fields. | 0.5 w | Low — types only, no runtime |
| **storage-core** | `readyloq-mobile/lib/upload.ts` + `vybelive/lib/objectStorage.ts` | (peer) | Move sidecar URL to `OBJECT_STORAGE_BASE_URL` env var. Merge auth patterns. | 0.5 w | Low — no business logic |
| **camera-core** | `readyloq-mobile/lib/vision/types.ts`, `provider-registry.ts` | None in VYBE | Remove `EntityType` enum pest values. Replace `AsyncStorage` with `KVAdapter`. | 1 w | Medium — camera flow is critical path |
| **ai-core** | `vybelive/services/ai/AIProvider.ts` + `AIProviderFactory.ts` + `os/EventBus.ts` + `os/StateEngine.ts` | ReadyLoq's 0–1 confidence model | Remove Mission Control event kinds. Normalise VYBE's 0–100 confidence to 0–1. | 1.5 w | High — both apps depend on AI calls |
| **asset-core** | `readyloq-mobile/lib/db/schema/properties.ts` | None in VYBE | Remove pest risk fields, inspection-specific columns. Make `ownerId` optional. | 0.5 w | Low — schema types only |
| **ui-core** | `readyloq-mobile/components/` (native tokens) + `vybelive/artifacts/website/components/ui/` (web tokens) | Shadcn UI primitives | Extract tokens only. No JSX. Two separate token files (native + web). | 0.5 w | Low — additive only |
| **sync-engine** | `readyloq-mobile/lib/sync/engine.ts` | None in VYBE | Remove `analyzeInspection` step (pest-specific). Generic `SyncStep<T>` pipeline. `FileUploader` + `KVAdapter` injection. | 1 w | High — offline data integrity |
| **evidence-core** | `readyloq-mobile/lib/vision/quality-gate.ts` + `lib/vision/dedupe.ts` (primary). VYBE `uploadMedia.ts` (upload patterns) | Peer | `entityType/entityId` scoping (not `inspectionId`). EvidenceStore decoupled from AsyncStorage. | 1.5 w | Medium — quality gate is on critical capture path |
| **meta-wearables** | `readyloq-mobile/lib/vision/provider-registry.ts` (stubs) | None | Already stub-level. Promote to `WearableProvider` implementations. Add BLE discovery. | 1 w | Low — greenfield, not yet deployed |
| **voice-intelligence** | Greenfield | Greenfield | Entirely new. No existing code in either app. | 2 w | Low — not deployed; additive |
| **live-session-core** | `vybelive/services/agoraPush.ts` + `services/agoraCloudRecording.ts` | None | Agora credentials injected. Remove YouTube/Twitch RTMP URLs (app config). | 1.5 w | High — live streaming is revenue-critical for VYBE |
| **platform-intelligence** | Greenfield (generalised from patterns in both repos) | Greenfield | Entirely new. Most complex package. Interface-only in Phase 3; concretions in each app. | 2 w | Medium — interface-only; apps wire plugins |
| **local-intelligence** | Greenfield | Greenfield | Entirely new. TFLite/ONNX/CoreML adapter per platform. | 2 w | Low — not yet deployed; additive |
| **measurement-core** | Greenfield | Greenfield | Entirely new. Calibration + depth + geometry. | 2 w | Low — not yet deployed; additive |

---

## 6. Migration Roadmap — Safest Extraction Order

Risk criteria: **Low** = pure types or greenfield. **Medium** = existing code, not on critical path. **High** = critical path for at least one app in production today.

### Tier 1 — Foundation (extract first, all parallel, lowest risk)

| Order | Package | Risk | Why First | Blocker for |
|-------|---------|------|-----------|-------------|
| 1 | **shared-types** | Low | No deps. Purely synthetic. Unblocks everything. | All other packages |
| 2 | **storage-core** | Low | De-duplication is immediate; identical sidecar in both apps. | evidence-core, sync-engine, live-session-core, platform-intelligence |
| 2 | **asset-core** | Low | Schema types only. No runtime. | platform-intelligence, ReadyLoq ACL |
| 2 | **ui-core** | Low | Additive tokens. No app impact until consumed. | Nothing critical |

**Tier 1 duration:** ~1.5 engineer-weeks. Can be parallelised across 2 engineers.

### Tier 2 — Capture, Sync, AI Infrastructure (medium risk)

| Order | Package | Risk | Canonical Source | Blocker for |
|-------|---------|------|-----------------|-------------|
| 3 | **camera-core** | Medium | readyloq-mobile | evidence-core, meta-wearables, local-intelligence, measurement-core |
| 3 | **ai-core** | High | vybelive (superior) | voice-intelligence, platform-intelligence, local-intelligence |
| 4 | **sync-engine** | High | readyloq-mobile | platform-intelligence |
| 4 | **evidence-core** | Medium | readyloq-mobile + vybelive upload | platform-intelligence, local-intelligence, measurement-core |
| 4 | **meta-wearables** | Low | readyloq-mobile stubs | — |

**Tier 2 duration:** ~4 engineer-weeks. ai-core and sync-engine require thorough testing — they are on ReadyLoq's offline-capture critical path and VYBE's AI critical path.

**ai-core extraction blocker:** VYBE's `AIProviderFactory` uses a DB table (`ai_model_configs`) to configure providers at runtime. The generalised `AIProviderFactory` in ai-core must accept a `ProviderConfigLoader` interface (injected) so VYBE can continue using its DB-backed config while ReadyLoq injects a static config.

**sync-engine extraction blocker:** ReadyLoq's `engine.ts` has a hard-coded step at position 4 that calls `analyzeInspection` (pest-specific API endpoint). The generalised `SyncEngine<T>` uses injectable `SyncStep[]`. ReadyLoq must define its own step array (including the analysis step) in the app layer.

### Tier 3 — OS Kernel + Specialist Packages (parallel, after Tier 2)

| Order | Package | Risk | Prerequisite | Notes |
|-------|---------|------|-------------|-------|
| 5 | **voice-intelligence** | Low | ai-core extracted | Greenfield; no existing code to migrate |
| 5 | **live-session-core** | High | storage-core extracted | VYBE revenue-critical. Stage in shadow mode — run new and old code in parallel for one sprint before cutover. |
| 6 | **platform-intelligence** | Medium | All Tier 2 complete | Interface-only in app. Apps register plugins; no app code migrates in this step. |
| 6 | **local-intelligence** | Low | ai-core, camera-core extracted | Greenfield. No existing app code. Additive only. |
| 6 | **measurement-core** | Low | storage-core, evidence-core extracted | Greenfield. No existing app code. Additive only. |

**Tier 3 duration:** ~6 engineer-weeks. Most packages here are greenfield (additive) — they do not replace existing code and carry no regression risk.

### Full Extraction Timeline

```
Week 1–2:   Tier 1 (shared-types, storage-core, asset-core, ui-core)
             ↳ Start with shared-types day 1 — all Tier 2 blocked on it
Week 3–6:   Tier 2 (camera-core ‖ ai-core, then sync-engine ‖ evidence-core ‖ meta-wearables)
             ↳ ai-core shadow-runs alongside existing VYBE AI calls for 1 sprint
             ↳ sync-engine: feature-flag new pipeline before cutting over
Week 7–12:  Tier 3 (voice-intelligence ‖ live-session-core ‖ platform-intelligence ‖ local-intelligence ‖ measurement-core)
             ↳ live-session-core: shadow mode for 1 sprint before cutover
```

---

## 7. Platform Readiness Report

### Per-Package Scorecard

| Package | Build | Deps | Boundary | Docs | Tests | Migration Ready | Overall |
|---------|-------|------|----------|------|-------|----------------|---------|
| shared-types | ⚠️ untested | ✅ | ✅ | ✅ | ⚠️ stubs | ✅ | **WARN** |
| storage-core | ⚠️ untested | ⚠️ declares shared-types, no import | ✅ | ✅ | ⚠️ stubs | ✅ | **WARN** |
| camera-core | ⚠️ untested | ⚠️ declares shared-types, no import | ✅ | ✅ | ⚠️ stubs | ✅ | **WARN** |
| ai-core | ⚠️ untested | ✅ | ✅ | ✅ | ⚠️ stubs | ✅ | **WARN** |
| asset-core | ⚠️ untested | ⚠️ declares shared-types, no import | ✅ | ✅ | ⚠️ stubs | ✅ | **WARN** |
| ui-core | ⚠️ untested | ⚠️ declares shared-types, no import | ✅ | ✅ | ⚠️ stubs | ✅ | **WARN** |
| sync-engine | ⚠️ untested | ✅ | ✅ | ✅ | ⚠️ stubs | ✅ | **WARN** |
| evidence-core | ⚠️ untested | ⚠️ declares storage-core, no import | ✅ | ✅ | ⚠️ stubs | ✅ | **WARN** |
| meta-wearables | ⚠️ untested | ✅ | ✅ | ✅ | ⚠️ stubs | ✅ | **WARN** |
| voice-intelligence | ⚠️ untested | ⚠️ declares ai-core, no import | ✅ | ✅ | ⚠️ stubs | ✅ | **WARN** |
| live-session-core | ⚠️ untested | ⚠️ declares storage-core, no import | ✅ | ✅ | ⚠️ stubs | ✅ | **WARN** |
| platform-intelligence | ⚠️ untested | ⚠️ declares ai-core, storage-core, shared-types; none imported | ✅ | ✅ | ⚠️ stubs | ✅ | **WARN** |
| local-intelligence | ⚠️ untested | ⚠️ declares camera-core, storage-core, evidence-core; none imported | ✅ | ✅ | ⚠️ stubs | ✅ | **WARN** |
| measurement-core | ⚠️ untested | ⚠️ declares camera-core, storage-core, evidence-core; none imported | ✅ | ✅ | ⚠️ stubs | ✅ | **WARN** |

**All packages rate WARN for the same two reasons:**
1. TypeScript compilation unverified (devDep install blocked by network)
2. Tests are stubs pending concrete implementations

**No package is FAIL.** Structure, boundaries, documentation, and DAG are all sound.

### Legend

| Rating | Meaning |
|--------|---------|
| ✅ PASS | Fully verified, no issues |
| ⚠️ WARN | Issue exists but is not a blocker — track and resolve |
| ❌ FAIL | Blocking issue — must resolve before proceeding |

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation | Owner |
|------|-----------|--------|------------|-------|
| **TypeScript compile errors discovered when network opens** | Low | Medium | Run `pnpm -r typecheck` in CI before Phase 1. Expected to pass (interface-only packages). | Platform team |
| **Declared-but-unused deps cause false DAG validation** | High | Medium | Pre-Phase-1: add real `import type` statements from each declared dep, or remove unused deps. | Platform team |
| **ai-core extraction breaks VYBE's DB-backed model config** | Medium | High | Inject `ProviderConfigLoader` interface into AIProviderFactory during extraction. Shadow-run for 1 sprint. | VYBE team |
| **sync-engine extraction loses ReadyLoq's analyzeInspection step** | Medium | High | Feature-flag new SyncEngine. Define ReadyLoq step array in app layer before cutover. Do not remove old engine until 2 clean syncs confirmed. | ReadyLoq team |
| **live-session-core extraction drops active VYBE streams** | Low | Critical | Shadow mode: run old + new agoraPush code in parallel. New code goes dark for 1 full streaming cycle, verified clean, then cutover. | VYBE team |
| **objectStorage.ts sidecar URL hardcoded in both apps** | High | Medium | Part of storage-core extraction: move to `OBJECT_STORAGE_BASE_URL` env var. Do this in Phase 1 as first concrete change to app code. | Both teams |
| **Confidence normalisation conflict (VYBE 0–100 vs ReadyLoq 0–1)** | High | Medium | `ConfidenceScore` branded type in shared-types with validator. Add normalisation at VYBE's AI layer during ai-core extraction. | VYBE team |
| **React Native version skew between apps** | Medium | Medium | Audit before Phase 2. ui-core has no JSX (not a blocker). camera-core adapters are expo-file-system-dependent — version-pin before extraction. | Both teams |
| **meta-wearables stubs not tested end-to-end** | Low | Low | No current wearable hardware in production. Stubs are safe to promote on test devices first. | ReadyLoq team |
| **measurement-core and local-intelligence have no canonical source** | N/A | Low | Both are greenfield — no regression risk. First implementation attempt is in the apps, not migration. | Both teams |

---

## 9. Pre-Migration Checklist (Phase 0.5)

These items must be completed **before Phase 1 extraction begins**. None involves migrating production code.

- [ ] **[BLOCKING] Fix declared-but-unused deps** — For every WARN in Section 1.4: add the real `import type` statement that makes the dep compile-time real, or remove the dep from `package.json` + `tsconfig.json`. See the delta table in Section 1.4.
- [ ] **[BLOCKING] Verify TypeScript compiles clean** — Run `pnpm -r typecheck` from `repos/platform/` in a CI environment (or after resolving the devDep network block). Zero errors expected; confirm before Phase 1.
- [ ] **[BLOCKING] Implement real unit tests** — Replace `test.todo` stubs with real assertions for the math-intensive packages (measurement-core geometry, ai-core confidence normalisation, sync-engine retry logic). These tests gate the extraction work.
- [ ] **[RECOMMENDED] Add `madge` circular-dep check to CI** — `pnpm dlx madge --circular --extensions ts packages/` should run on every PR to the platform repo.
- [ ] **[RECOMMENDED] Add domain-string lint rule** — Automate the GOVERNANCE.md § 7 grep check as a CI step. Prevents pest/stream strings from entering platform code during extraction.
- [ ] **[RECOMMENDED] Document AIProviderFactory injection point** — Before ai-core extraction, spec the `ProviderConfigLoader` interface that VYBE's DB config will implement. Get VYBE team sign-off.
- [ ] **[RECOMMENDED] React Native version audit** — Both apps: `npx react-native info`. Document any version skew before camera-core extraction.
- [ ] **[RECOMMENDED] Shared-types merge review** — Both teams jointly review the `EvidenceItem`, `OSEvent`, `AIRequest`, and `SyncRecord` definitions in shared-types. These are the types both apps must agree on before any extraction.

---

## 10. Deliverable Index

| Deliverable | Location |
|-------------|----------|
| Dependency graph (declared) | Section 2.1 |
| Circular dependency verification | Section 2.2 |
| DAG inversion check | Section 2.3 |
| Application isolation check | Section 2.4 |
| Package responsibility matrix | Section 3 |
| Overlap analysis | Section 3 |
| Duplicate infrastructure — ReadyLoq | Section 4.1 |
| Duplicate infrastructure — VYBE | Section 4.2 |
| Shared duplicates | Section 4.3 |
| Canonical source map | Section 5 |
| Migration roadmap (tiered) | Section 6 |
| Per-package readiness scorecard | Section 7 |
| Risk assessment | Section 8 |
| Pre-migration checklist | Section 9 |
| Architecture doc | `ARCHITECTURE.md` |
| Governance rules | `GOVERNANCE.md` |
| ADRs | `adrs/ADR-001` through `ADR-014` |
