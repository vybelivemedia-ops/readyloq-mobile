# Platform Architecture & Migration Analysis

> **Generated:** 2026-07-14 · **Revised:** 2026-07-14  
> **Scope:** Cross-repo analysis of `readyloq-mobile` + `vybelive` → extraction plan for `platform`  
> **Status:** Analysis complete. Package scaffolding created. NO code migrated yet.  
> **Changes in this revision:** `@platform/core` added as the 15th package (universal programming-model primitives, ADR-015) — the new root of the DAG below shared-types. Migration plan updated to 5-phase parallel extraction order validated by DAG analysis. `ConfidenceScore` is now a branded type. `SyncRecord` carries typed `Result<void, SyncError>` for last-attempt result. All 14 existing packages wired to `@platform/core`.

---

## 1. Executive Summary

Two production apps share significant infrastructure that is currently duplicated:

| App | Domain | Stack |
|-----|--------|-------|
| **ReadyLoq** (`readyloq-mobile`) | Pest inspection — mobile capture, offline sync, AI analysis, multi-tenant SaaS | Expo + React Native + Express API + Drizzle/Postgres |
| **VYBE LIVE** (`vybelive`) | Creator live-streaming — Agora RTC, social publishing, Mission Control AI OS | Expo + React Native + Express API + Drizzle/Postgres + AI executive layer |

Both use an **identical** monorepo structure (pnpm workspaces, `artifacts/`, `lib/`) and target the **same Replit sidecar object storage** at `127.0.0.1:1106`. Fourteen infrastructure packages are identified: ten with existing code to extract, four that are new greenfield packages (wearables stubs, voice, local-intelligence, and measurement-core).

The extracted platform repo (`platform/`) is a **pure TypeScript interface and type layer** — no runtime dependencies, no framework coupling. Each app consumes it as a workspace dependency and provides its own concrete implementations.

**The architecture model:**

```
ReadyLoq / VYBE LIVE / Mission Control
                  ↓
   platform-intelligence  local-intelligence
     (OS kernel)            (on-device ML)
                  ↓
  evidence-core · meta-wearables · voice-intelligence
  live-session-core · measurement-core (injected)
                  ↓
  camera-core · storage-core · ai-core
  sync-engine · asset-core · ui-core
                  ↓
             shared-types
          (domain primitives)
                  ↓
             @platform/core
          (programming-model primitives)
          Result · Plugin · Service · Registry
          Pipeline · Event · Command · Query
          Capability · FeatureFlag · Brand · ID
```

ReadyLoq is not an inspection app. It is **an AI Inspection Operating System** with one application (pest inspection) running on top of it. The platform is the OS; the inspection is the app.

---

## 2. Repository Overview

### 2.1 readyloq-mobile

```
artifacts/
  readyloq/           Web app (React + Vite + Wouter)
  readyloq-app/       Mobile app (Expo Router)
    lib/
      vision/         Camera abstraction ← CANONICAL for camera-core
        types.ts
        provider-registry.ts
        quality-gate.ts
        pixels.ts
        future-source-providers.ts
      sync/           Offline sync engine ← CANONICAL for sync-engine
        engine.ts
      local/          AsyncStorage KV store ← CANONICAL for evidence-core (local store)
        inspection-store.ts
      objectStorage.ts ← CANONICAL for storage-core (superset)
lib/
  db/src/schema/
    inspections, analysis, callbacks, dataset, reports, training,
    branding, users, properties ← CANONICAL for asset-core,
    companies, leads, intelligence-dataset,
    beta, opportunities, scorecards, customer-summaries, proposals
```

**Domain:** pest inspection. Schemas are heavily pest-specific (inspections, findings, pest species, treatment recommendations, scorecards, proposals). These stay in readyloq-mobile.

**AI:** Direct OpenAI calls from the Express API. No provider abstraction — single provider, batched analysis pipeline, confidence 0–1 float. VYBE's AIProviderFactory is the superior abstraction; ReadyLoq migrates to it in Phase 3.

**Multi-tenancy:** Every DB query is gated on `companyId`. Object storage keys are namespaced `companies/{companyId}/…`. Per-company branding, user isolation, and lead management.

### 2.2 vybelive

```
artifacts/
  api-server/
    src/services/
      ai/
        AIProvider.ts         ← CANONICAL for ai-core (provider interface)
        AIProviderFactory.ts  ← CANONICAL for ai-core (factory + fallback chain)
      os/
        EventBus.ts           ← CANONICAL for ai-core (typed pub/sub)
        EventStore.ts         ← persistence layer for EventBus
        StateEngine.ts        ← CANONICAL for ai-core (observable KV)
        events/               ← VYBE-specific event kinds (stays in vybelive)
        providers/            ← engineering/github/replit provider (stays)
  mobile/
    app/
      stream/                 ← live stream session (Agora RTC) ← CANONICAL for live-session-core
      creator/                ← creator dashboard
      (tabs)/discover, recordings, notifications, collaborations
    lib/
      uploadMedia.ts          ← CANONICAL for evidence-core (upload patterns)
  marketing/                  ← public website (stays in vybelive)
lib/
  db/src/schema/
    V1–V12: AI executive schemas (Mission Control) — stays in vybelive
    OS: osEventsTable (EventBus persistence)
    Phase 10: deployment events, provider reliability ledger
```

**Domain:** live-streaming social platform + AI Mission Control. All Mission Control/AI executive schemas stay in vybelive.

---

## 3. Dependency Graph

### 3.1 Platform package dependency levels

```
Level 0 — no deps (root of DAG):
  @platform/core    ← programming-model primitives; zero external deps

Level 1 — → core only:
  shared-types      ← domain types; re-exports Result, Brand, ID, Timestamp

Level 2 — → core + shared-types:
  storage-core    ai-core    camera-core    asset-core    ui-core
  sync-engine

Level 3 — → Level 0–2:
  evidence-core        → core, shared-types, storage-core
  meta-wearables       → core, camera-core, shared-types
  voice-intelligence   → core, ai-core, shared-types
  live-session-core    → core, shared-types, storage-core

Level 4 — → Level 0–3 (three packages; none imports another):
  platform-intelligence → core, shared-types, ai-core, camera-core,
                          evidence-core, storage-core, voice-intelligence
  local-intelligence    → core, shared-types, ai-core, camera-core,
                          storage-core, evidence-core
  measurement-core      → core, shared-types, camera-core,
                          storage-core, evidence-core

Level 5 — Applications (never imported by platform):
  readyloq-mobile    vybelive    Mission Control
```

### 3.2 App consumption

```
readyloq-mobile ──→ shared-types
                ──→ camera-core
                ──→ storage-core
                ──→ sync-engine
                ──→ evidence-core
                ──→ asset-core
                ──→ meta-wearables
                ──→ ai-core
                ──→ local-intelligence     ← on-device AI (Phase 3.5)
                ──→ measurement-core       ← measurements (Phase 3.6)
                ──→ platform-intelligence  ← OS kernel
                ──→ ui-core
                ──→ voice-intelligence (Phase 4)
                ✗   live-session-core (no streaming in ReadyLoq today)

vybelive        ──→ shared-types
                ──→ storage-core
                ──→ evidence-core
                ──→ asset-core
                ──→ ai-core
                ──→ local-intelligence     ← on-device AI (Phase 4)
                ──→ measurement-core       ← measurements (Phase 4)
                ──→ live-session-core
                ──→ platform-intelligence  ← OS kernel
                ──→ ui-core
                ──→ voice-intelligence (Phase 4)
                ✗   camera-core (Agora owns the camera)
                ✗   sync-engine (always-online app)
                ✗   meta-wearables (not needed yet)
```

---

## 4. Canonical Implementation Map

| Package | Canonical Source | Reason | Generalisation Required |
|---------|-----------------|--------|------------------------|
| **shared-types** | New (synthesised from both) | Types exist in both; this is a merge | Domain-agnostic versions only |
| **camera-core** | `readyloq-mobile` | VYBE has no camera abstraction | Injectable QualityGate thresholds; KVAdapter not AsyncStorage |
| **storage-core** | `readyloq-mobile` (superset) | ReadyLoq adds company-scoped namespacing | Move sidecar URL to env var |
| **sync-engine** | `readyloq-mobile` | VYBE has no offline sync | Generic `SyncEngine<T>`; KVAdapter + FileUploader injection |
| **evidence-core** | `readyloq-mobile` (primary) + `vybelive` (upload patterns) | ReadyLoq has the richest evidence lifecycle | Generic entityType/entityId scoping; EvidenceStore decoupled from AsyncStorage |
| **asset-core** | `readyloq-mobile` | ReadyLoq's properties schema is the most complete | Remove pest-specific fields; ownerId scoping; AssetType broadened beyond real estate |
| **meta-wearables** | `readyloq-mobile` (stubs) | VYBE has no wearables code | Already stub-level |
| **voice-intelligence** | New (no existing code) | Neither app has implemented voice | Greenfield; VoiceCommandRouter<TAction extends string> |
| **live-session-core** | `vybelive` | ReadyLoq has no streaming | Agora credentials injected; SocialPublisher adapters per platform |
| **ai-core** | `vybelive` (provider/factory/bus/state) + `readyloq-mobile` (confidence model) | VYBE's infrastructure is superior; ReadyLoq's 0–1 confidence is more principled | Strictly generic; normalise confidence to 0–1; remove VYBE-specific event kinds |
| **platform-intelligence** | New (generalised from patterns in both repos) | Neither app has an orchestration kernel | Entirely new — see `src/index.ts` for the full interface set |
| **local-intelligence** | New (greenfield) | Neither app has on-device ML infrastructure | Entirely new — ModelManager, InferenceEngine, VisionEngine, OCR, Embedding, Quality, AICache, ResourceMonitor, ProviderSelector |
| **measurement-core** | New (greenfield) | Neither app has automated measurement tooling | Entirely new — MeasurementEngine, CalibrationService, ReferenceObjectService, DepthEstimator, DimensionEstimator, ScaleEstimator, GeometryService, MeasurementHistory |
| **ui-core** | Both | Design tokens + component contracts | Tokens only; no JSX |

---

## 5. What Stays in Each App

See `GOVERNANCE.md § 8` for the canonical statement. Summary:

**Stays in readyloq-mobile:** Pest intelligence, species recognition, infestation scoring, AI guidance rules for pest treatment, inspection memory, asset business rules (pricing, pest risk by building age), proposal engine, CRM, report templates.

**Stays in vybelive:** Mission Control (executive AI, autonomy engine, agent scheduling), social publishing, creator analytics, audience intelligence, streaming business logic.

---

## 6. Migration Plan

> Phase ordering validated by DAG analysis (2026-07-14). No package may be extracted before all its declared dependencies are extracted. Parallel packages within a phase have no dependencies on each other.

### Phase 0 — Programming-Model Primitives (Day 1, single task)

**T0.1: @platform/core** — Scaffold and typecheck `Result`, `AsyncResult`, `Option`, `Disposable`, `AsyncDisposable`, `Plugin`, `Service`, `Lifecycle`, `Registry`, `Event`, `EventHandler`, `EventSubscription`, `Command`, `Query`, `Capability`, `FeatureFlag`, `FeatureFlagRegistry`, `Provider`, `PipelineStep`, `PipelineContext`, `Pipeline`, `Observable`, `Observer`, `Brand`, `ID`, `Timestamp`, `Version`. Zero external deps. This is scaffolding-only — no extraction source exists. Typecheck must pass before Phase 1.

### Phase 1 — Domain Types Foundation (Week 1)

**T1.1: shared-types** — Synthesise EvidenceItem, CaptureMode, OSEvent, AIRequest/Response/Usage, SyncRecord, `ConfidenceScore` (branded `Brand<number,"ConfidenceScore">`), `SyncError` + `Result<void,SyncError>` on SyncRecord. Import from `@platform/core`; re-export `Result`, `Brand`, `ID`, `Timestamp` so downstream packages can single-import. Wire project references.

### Phase 2 — Infrastructure Layer (Weeks 2–3, all parallel)

**T2.1: storage-core** — Extract ReadyLoq `objectStorage.ts`. `ObjectStorageClient`, `StorageNamespace`, `SignedUrlRequest`. Move sidecar URL to `OBJECT_STORAGE_BASE_URL` env var (first concrete change to app code). Unblocks evidence-core and live-session-core.

**T2.2: camera-core** — Extract ReadyLoq `lib/vision/`: `CaptureProvider`, `ProviderRegistry`, `QualityThresholds`, `KVAdapter`. Injectable thresholds; KVAdapter replaces AsyncStorage coupling. Unblocks evidence-core and meta-wearables.

**T2.3: sync-engine** — Generic `SyncEngine<T>` with injectable `SyncStep[]`. ReadyLoq defines its own step array in the app layer (UploadPhotosStep, AnalyzeInspectionStep, BuildReportStep, FinalizeInspectionStep). Feature-flag before cutover.

**T2.4: asset-core** — Extract ReadyLoq `properties` schema. `ownerId` optional. Remove pest-specific fields. `AssetType` broadened beyond real estate.

**T2.5: ai-core** — Extract VYBE `AIProvider` + `AIProviderFactory` + `EventBus` + `StateEngine`. Inject `ProviderConfigLoader` interface so VYBE keeps DB-backed config, ReadyLoq uses static config, future products use Redis/JSON/etc. `AIProviderFactory` must never know about PostgreSQL, Drizzle, or `ai_model_configs` directly. Shadow-run alongside existing VYBE calls for one sprint before cutover. Normalise confidence to 0–1.

**T2.6: ui-core** — Design tokens from both Tailwind configs and native StyleSheet constants. Component prop contracts. No JSX.

### Phase 3 — Domain Layer (Weeks 4–5, parallel)

**T3.1: evidence-core** — Extract ReadyLoq `quality-gate.ts` + `dedupe.ts`. Generic `entityType/entityId` scoping. EvidenceStore decoupled from AsyncStorage. VYBE `uploadMedia.ts` upload patterns → `EvidenceUploadPipeline`. Requires storage-core (Phase 2.1) ✓

**T3.2: meta-wearables** — Promote ReadyLoq provider-registry stubs to `WearableProvider` implementations. BLE discovery interface. Requires camera-core (Phase 2.2) ✓

### Phase 4 — Specialist Layer (Weeks 6–7, parallel)

**T4.1: voice-intelligence** — Greenfield. `VoiceRecorder`, `TranscriptionService`, `VoiceCommandRouter<TAction>`. Wire ReadyLoq (dictation) and VYBE (stream control + captions). Requires ai-core (Phase 2.5) ✓

**T4.2: live-session-core** — Extract VYBE `agoraPush.ts` + `agoraCloudRecording.ts`. `AgoraAdapter`, `SocialPublisher`, `SessionRecorder`. Agora credentials injected; RTMP destination URLs are app config. **Shadow mode** — run old + new code in parallel for one full streaming cycle before cutover. Requires storage-core (Phase 2.1) ✓

**T4.3: measurement-core** — Greenfield. `MeasurementEngine`, `CalibrationService`, `ReferenceObjectService`, `DepthEstimator`, `DimensionEstimator`. `MeasurementInferenceProvider` interface injected at runtime; does not import ai-core or local-intelligence directly. Requires storage-core + evidence-core (Phase 2.1, 3.1) ✓

### Phase 5 — OS Kernel (Weeks 8–10, parallel)

**T5.1: platform-intelligence** — `PlatformOS`, `PluginRegistry`, `WorkflowEngine`, `IntelligenceSessionManager`, `GuidanceEngine`, `MemoryOrchestrator`, `ProviderCoordinator`, `EventRouter`. Interface-only; apps register plugins and define workflow step arrays. ReadyLoq registers the pest-inspection workflow; VYBE registers the streaming workflow.

**T5.2: local-intelligence** — Greenfield. `ModelManager`, `InferenceEngine`, `VisionEngine`, `OCREngine`, `EmbeddingEngine`, `ResourceMonitor`. TFLite/ONNX/CoreML adapters per platform — registered as a plugin in platform-intelligence.

> **`ai-core` injection spec (before Phase 2.5):** Spec and both-team sign-off required on the `ProviderConfigLoader` interface before extraction begins. See ADR-015 § Consequences.
>
> **`sync-engine` injection spec (before Phase 2.3):** ReadyLoq team must define and review the five `SyncStep[]` definitions in the app layer before the old engine is removed.

---

## 7. Extraction Order (dependency-safe, DAG-validated)

```
Phase 0  @platform/core         (zero deps — scaffolding only; no extraction source)

Phase 1  shared-types           (→ core)

Phase 2  storage-core           (→ core, shared-types)          ┐
         camera-core            (→ core, shared-types)          │ all parallel
         sync-engine            (→ core, shared-types)          │
         asset-core             (→ core, shared-types)          │
         ai-core                (→ core, shared-types)          │
         ui-core                (→ core, shared-types)          ┘

Phase 3  evidence-core          (→ core, shared-types, storage-core)    ┐ parallel
         meta-wearables         (→ core, camera-core, shared-types)     ┘

Phase 4  voice-intelligence     (→ core, ai-core, shared-types)              ┐
         live-session-core      (→ core, shared-types, storage-core)         │ parallel
         measurement-core       (→ core, shared-types, storage-core,         │
                                     camera-core, evidence-core) (injected)  ┘

Phase 5  platform-intelligence  (→ core + all Level 2–3)   ┐ parallel
         local-intelligence     (→ core, shared-types,      │
                                    ai-core, camera-core,   │
                                    storage-core, evidence) ┘
```

**DAG invariants:**
- Phase N packages may only depend on packages extracted in Phases 0…N-1.
- No platform package at any level may import another package at the same level.
- No platform package may import application code (readyloq-mobile, vybelive).
- `@platform/core` has zero deps — any import found in its source is a build failure.

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **objectStorage.ts sidecar URL hardcoded** | High | Medium | Move to `OBJECT_STORAGE_BASE_URL` env var in Phase 1 |
| **AsyncStorage coupling** in sync-engine + evidence-core | High | High | KVAdapter interface; inject before any web consumer |
| **Confidence normalisation** — VYBE 0–100 vs ReadyLoq 0–1 | Medium | High | Branded ConfidenceScore type with validator in ai-core |
| **Agora SDK deep-coupled** in VYBE mobile | Medium | High | AgoraAdapter abstraction in Phase 4 |
| **Pest-specific AI prompts** mixed into analysis service | Low | Medium | Code review gate + CI grep for domain strings in platform |
| **platform-intelligence complexity** — broad surface area | Medium | Medium | Interface-only in Phase 3; concrete implementation in each app |
| **evidence-core annotation conflict** — images vs. video timestamps | Medium | Medium | AnnotationKind union is open; both models satisfy it |
| **asset-core ownerId scoping** — single-tenant vs. multi-tenant | Low | Low | ownerId optional; single-tenant apps pass undefined |
| **React Native version skew** between apps | Medium | Medium | Audit before Phase 2; ui-core has no JSX (not a blocker) |
| **expo-file-system API differences** | Medium | Medium | FileUploader adapter; expo-file-system stays in the app |

---

## 9. Effort Estimate

| Phase | Packages | Engineer-weeks | Notes |
|-------|----------|---------------|-------|
| 1 — Foundation | shared-types, storage-core | 1.5 | Low risk |
| 2 — Capture, Sync, Evidence | camera-core, sync-engine, evidence-core | 3.0 | |
| 3 — Assets, AI, OS kernel | asset-core, ai-core, platform-intelligence + ReadyLoq migration | 3.5 | platform-intelligence is complex but interface-only |
| 4 — Wearables, Voice, Live Session | meta-wearables, voice-intelligence, live-session-core | 3.5 | Greenfield voice; Agora decoupling |
| 5 — UI Core | ui-core | 0.5 | Token extraction only |
| 3.5 — On-Device AI | local-intelligence (both apps) | 2.0 | Model download infra; TFLite/ONNX adapters per platform |
| 3.6 — Measurements | measurement-core (both apps) | 2.0 | CalibrationService; reference object DB; depth estimator; ReadyLoq + VYBE integration |
| **Total** | **14 packages** | **~16 eng-weeks** | Parallelisable at levels 3–4; ~11 weeks with 2 engineers |

---

## 10. Package Scaffolding Summary

All 15 packages are created in `packages/` with `package.json`, `tsconfig.json`, and documented `src/index.ts`.

```
platform/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── .npmrc
├── ARCHITECTURE.md               ← this document
├── GOVERNANCE.md                 ← platform governance rules (ADR-011)
├── VALIDATION-REPORT.md          ← pre-migration readiness audit
└── packages/
    ├── core/                     @platform/core             ← L0: programming-model primitives
    ├── shared-types/             @platform/shared-types     ← L1: domain types (→ core)
    ├── camera-core/              @platform/camera-core      ← L2
    ├── storage-core/             @platform/storage-core     ← L2
    ├── sync-engine/              @platform/sync-engine      ← L2
    ├── asset-core/               @platform/asset-core       ← L2 (renamed from property-core)
    ├── ai-core/                  @platform/ai-core          ← L2
    ├── ui-core/                  @platform/ui-core          ← L2
    ├── evidence-core/            @platform/evidence-core    ← L3
    ├── meta-wearables/           @platform/meta-wearables   ← L3
    ├── voice-intelligence/       @platform/voice-intelligence ← L3
    ├── live-session-core/        @platform/live-session-core  ← L3
    ├── measurement-core/         @platform/measurement-core   ← L3 (injected deps)
    ├── platform-intelligence/    @platform/platform-intelligence ← L4 OS kernel
    └── local-intelligence/       @platform/local-intelligence    ← L4 on-device AI
```

---

## 11. Architecture Decision Records

**ADR-001:** Platform packages export interfaces only. No runtime deps.

**ADR-002:** sync-engine does not depend on storage-core. FileUploader is injected.

**ADR-003:** ai-core stays generic — zero domain logic, zero pest/streaming strings.

**ADR-004:** Confidence is 0–1 float platform-wide. VYBE's 0–100 normalised at the AI layer.

**ADR-005:** objectStorage.ts sidecar URL moved to `OBJECT_STORAGE_BASE_URL` env var.

**ADR-006:** ui-core exports design tokens and component contracts only — no JSX.

**ADR-007:** camera-core and evidence-core are separate packages. Capture and lifecycle are orthogonal concerns; web dashboards can depend on evidence-core without camera-core.

**ADR-008:** asset-core has no platform dependencies beyond shared-types. Maximum adoption surface, minimum transitive pull.

**ADR-009:** live-session-core (not streaming-core). "Live session" is bidirectional and accurate for any real-time coordinated session.

**ADR-010:** AIPipeline sits above AIProviderFactory. The factory handles provider selection; the pipeline handles cross-cutting concerns (logging, caching, rate limiting) as composable middleware.

**ADR-011:** Platform Governance — what is allowed, what is forbidden, dependency DAG rules, versioning strategy, package proposal process. See `GOVERNANCE.md` for the full text.

**ADR-012:** platform-intelligence is the OS kernel. Applications do not call packages directly — they register plugins with platform-intelligence and define workflows. The platform provides capabilities; the application defines purpose.

**ADR-013:** local-intelligence is separate from ai-core. Cloud AI (ai-core) is stateless API calls; on-device AI is stateful model lifecycle (download → load → warmup → infer → unload). Merging them would force ai-core to carry mobile ML framework deps (TFLite, ONNX, CoreML) in every consumer, including pure-web tools. Battery/thermal awareness and perceptual-hash caching are also mobile-only concerns. See `adrs/ADR-013-local-intelligence.md` for the full text.

**ADR-014:** measurement-core is separate from ai-core and local-intelligence. ai-core is AI orchestration; local-intelligence is the on-device ML runtime; measurement-core is the domain of computer vision measurements — optics, calibration profiles, reference object libraries, geometry, depth projection, and annotated measurement history. Measurement coordinates multiple services (calibration, detection, geometry) and adds evidence versioning; that coordination cannot live in either inference package without contaminating them with geometry and photogrammetry concerns. See `adrs/ADR-014-measurement-core.md` for the full text.

**ADR-015:** `@platform/core` is the root of the DAG — universal programming-model primitives (Result, Plugin, Service, Registry, Pipeline, Event, Command, Query, Capability, FeatureFlag, Brand, ID, Timestamp, Version) with zero external dependencies and zero domain logic. Every other platform package depends on it. `@platform/shared-types` sits one level above and re-exports the most commonly needed core primitives so downstream packages need not double-import. `ConfidenceScore` is branded (`Brand<number,"ConfidenceScore">`); `SyncRecord` carries typed `Result<void, SyncError>` for last-attempt results. See `adrs/ADR-015-platform-core.md` for the full text.
