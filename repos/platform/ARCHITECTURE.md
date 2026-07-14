# Platform Architecture & Migration Analysis

> **Generated:** 2026-07-14 · **Revised:** 2026-07-14  
> **Scope:** Cross-repo analysis of `readyloq-mobile` + `vybelive` → extraction plan for `platform`  
> **Status:** Analysis complete. Package scaffolding created. NO code migrated yet.  
> **Changes in this revision:** property-core renamed to asset-core; platform-intelligence added as the OS kernel; governance codified in GOVERNANCE.md (ADR-011); local-intelligence added as the 13th package (on-device AI runtime, ADR-013).

---

## 1. Executive Summary

Two production apps share significant infrastructure that is currently duplicated:

| App | Domain | Stack |
|-----|--------|-------|
| **ReadyLoq** (`readyloq-mobile`) | Pest inspection — mobile capture, offline sync, AI analysis, multi-tenant SaaS | Expo + React Native + Express API + Drizzle/Postgres |
| **VYBE LIVE** (`vybelive`) | Creator live-streaming — Agora RTC, social publishing, Mission Control AI OS | Expo + React Native + Express API + Drizzle/Postgres + AI executive layer |

Both use an **identical** monorepo structure (pnpm workspaces, `artifacts/`, `lib/`) and target the **same Replit sidecar object storage** at `127.0.0.1:1106`. Thirteen infrastructure packages are identified: ten with existing code to extract, three that are new greenfield packages (wearables stubs, voice, and local-intelligence).

The extracted platform repo (`platform/`) is a **pure TypeScript interface and type layer** — no runtime dependencies, no framework coupling. Each app consumes it as a workspace dependency and provides its own concrete implementations.

**The architecture model:**

```
ReadyLoq / VYBE LIVE
         ↓
platform-intelligence  (OS kernel — orchestrates everything)
local-intelligence     (on-device AI runtime — plugs into platform-intelligence)
         ↓
camera-core · voice-intelligence · ai-core · evidence-core
asset-core · sync-engine · storage-core · live-session-core
meta-wearables · ui-core
         ↓
shared-types  (no deps)
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
Level 0 — no deps:
  shared-types

Level 1 — → shared-types only:
  storage-core    ai-core    camera-core    asset-core    ui-core

Level 2 — → Level 0–1:
  evidence-core        → shared-types, storage-core
  sync-engine          → shared-types (storage-core injected by caller)
  meta-wearables       → camera-core, shared-types
  voice-intelligence   → ai-core, shared-types
  live-session-core    → shared-types, storage-core

Level 3 — → Level 0–2 (two packages; neither imports the other):
  platform-intelligence → shared-types, ai-core, camera-core,
                          evidence-core, storage-core, voice-intelligence
  local-intelligence    → shared-types, ai-core, camera-core,
                          storage-core, evidence-core

Level 4 — Applications (never imported by platform):
  readyloq-mobile    vybelive
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
| **ui-core** | Both | Design tokens + component contracts | Tokens only; no JSX |

---

## 5. What Stays in Each App

See `GOVERNANCE.md § 8` for the canonical statement. Summary:

**Stays in readyloq-mobile:** Pest intelligence, species recognition, infestation scoring, AI guidance rules for pest treatment, inspection memory, asset business rules (pricing, pest risk by building age), proposal engine, CRM, report templates.

**Stays in vybelive:** Mission Control (executive AI, autonomy engine, agent scheduling), social publishing, creator analytics, audience intelligence, streaming business logic.

---

## 6. Migration Plan

### Phase 1 — Foundation (Weeks 1–2)

**T1.1: shared-types** — Synthesise EvidenceItem, CaptureMode, OSEvent, AIRequest/Response/Usage, SyncRecord, ConfidenceScore. Wire project references.

**T1.2: storage-core** — Extract ReadyLoq `objectStorage.ts`. Add StorageNamespace interface. Move sidecar URL to `OBJECT_STORAGE_BASE_URL` env var.

### Phase 2 — Capture, Sync & Evidence (Weeks 3–5)

**T2.1: camera-core** — Extract ReadyLoq `vision/`. Injectable QualityGate thresholds. KVAdapter replaces AsyncStorage coupling.

**T2.2: sync-engine** — Generic `SyncEngine<T>`. Inject KVAdapter + FileUploader. Configurable pipeline steps.

**T2.3: evidence-core** — Extract ReadyLoq evidence lifecycle. VYBE `uploadMedia.ts` upload patterns become EvidenceUploadPipeline. EvidenceCollection + Annotation + QualityRecord.

### Phase 3 — Assets, AI Core & OS Kernel (Weeks 6–8)

**T3.1: asset-core** — Extract ReadyLoq `properties` schema. ownerId scoping. Remove pest-specific fields to app layer.

**T3.2: ai-core** — Extract VYBE AIProviderFactory + EventBus + StateEngine. Add AISession + AIPipeline + AIRateLimiter + AIUsageTracker + AI_EVENT_KINDS. Normalise confidence to 0–1.

**T3.3: platform-intelligence** — Implement PlatformOS, PluginRegistry, WorkflowEngine, IntelligenceSessionManager, GuidanceEngine, MeasurementState, MemoryOrchestrator, ProviderCoordinator, EventRouter. Wire ReadyLoq as the first application using it.

**T3.4: Migrate ReadyLoq to platform-intelligence** — Replace direct service calls with plugin registrations. Define pest-inspection workflow definition in readyloq-app. AIProviderFactory replaces direct OpenAI calls.

**T3.5: local-intelligence** — Register `LocalIntelligencePlugin` in both apps. Wire ReadyLoq's on-capture `QualityGate` to `ImageQualityEngine.detectBlur()`. Download and register a vision model; wire offline fallback via `LocalAIProvider` in ai-core's fallback chain.

### Phase 4 — Wearables, Voice, Live Session, On-Device AI (Weeks 9–12)

**T4.1: meta-wearables** — Promote ReadyLoq stubs to WearableProvider implementations. BLE discovery.

**T4.2: live-session-core** — Extract VYBE stream session + AgoraAdapter + SocialPublisher adapters.

**T4.3: voice-intelligence** — Greenfield VoiceRecorder + TranscriptionService + VoiceCommandRouter. Wire into ReadyLoq (dictation) and VYBE (stream control + captions).

### Phase 5 — UI Core (Week 12)

**T5.1: ui-core** — Design tokens from both Tailwind configs and native StyleSheet constants. Component prop interface contracts. No JSX migration.

---

## 7. Extraction Order (dependency-safe)

```
1. shared-types           (no deps — must go first)
2. storage-core           (→ shared-types)
3. ai-core                (→ shared-types)               ← parallel at this level
   camera-core            (→ shared-types)               ←
   sync-engine            (→ shared-types)               ←
   asset-core             (→ shared-types)               ←
   ui-core                (→ shared-types)               ←
4. evidence-core          (→ shared-types, storage-core)
   meta-wearables         (→ camera-core)
   voice-intelligence     (→ ai-core)
   live-session-core      (→ shared-types, storage-core)
5. platform-intelligence  (→ everything in levels 0–2)  ← parallel at level 3
   local-intelligence     (→ shared-types, ai-core, camera-core,
                             storage-core, evidence-core)  ←
```

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
| **Total** | **13 packages** | **~14 eng-weeks** | Parallelisable at levels 3–4; ~10 weeks with 2 engineers |

---

## 10. Package Scaffolding Summary

All 13 packages are created in `packages/` with `package.json`, `tsconfig.json`, and documented `src/index.ts`.

```
platform/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── .npmrc
├── ARCHITECTURE.md               ← this document
├── GOVERNANCE.md                 ← platform governance rules (ADR-011)
└── packages/
    ├── shared-types/             @platform/shared-types
    ├── camera-core/              @platform/camera-core
    ├── storage-core/             @platform/storage-core
    ├── sync-engine/              @platform/sync-engine
    ├── evidence-core/            @platform/evidence-core
    ├── asset-core/               @platform/asset-core       ← renamed from property-core
    ├── meta-wearables/           @platform/meta-wearables
    ├── voice-intelligence/       @platform/voice-intelligence
    ├── live-session-core/        @platform/live-session-core
    ├── ai-core/                  @platform/ai-core
    ├── platform-intelligence/    @platform/platform-intelligence  ← OS kernel
    ├── local-intelligence/       @platform/local-intelligence     ← on-device AI runtime
    └── ui-core/                  @platform/ui-core
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
