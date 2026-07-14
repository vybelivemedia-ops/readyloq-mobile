# Platform Architecture & Migration Analysis

> **Generated:** 2026-07-14 · **Revised:** 2026-07-14  
> **Scope:** Cross-repo analysis of `readyloq-mobile` + `vybelive` → extraction plan for `platform`  
> **Status:** Analysis complete. Package scaffolding created. NO code migrated yet.  
> **Changes in this revision:** streaming-core renamed to live-session-core; evidence-core and property-core added; ai-core expanded to include sessions, pipeline, and event infrastructure.

---

## 1. Executive Summary

Two production apps share significant infrastructure that is currently duplicated:

| App | Domain | Stack |
|-----|--------|-------|
| **ReadyLoq** (`readyloq-mobile`) | Pest inspection — mobile capture, offline sync, AI analysis, multi-tenant SaaS | Expo + React Native + Express API + Drizzle/Postgres |
| **VYBE LIVE** (`vybelive`) | Creator live-streaming — Agora RTC, social publishing, Mission Control AI OS | Expo + React Native + Express API + Drizzle/Postgres + AI executive layer |

Both use an **identical** monorepo structure (pnpm workspaces, `artifacts/`, `lib/`) and target the **same Replit sidecar object storage** at `127.0.0.1:1106`. Eleven infrastructure packages are identified: nine with existing code to extract, two that are new greenfield packages (wearables stubs + voice).

The extracted platform repo (`platform/`) is a **pure TypeScript interface and type layer** — no runtime dependencies, no framework coupling. Each app consumes it as a workspace dependency and provides its own concrete implementations.

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
    branding, users, properties ← CANONICAL for property-core,
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
    V1: AI executives (Quinn + team of AI agents)
    V2: Objectives + tasks + approvals + reports
    V3: Blockers + briefings
    V4: Retrospectives + weekly reviews
    V5: Autonomy engine (scheduler cycles)
    V6: Exec conversations
    V7: Autonomy engine (agent zero jobs + steps)
    V8: Living organisation (event ledger, curated timeline)
    V9: Connected intelligence (exec memory, chief reasoning)
    V10: Engineering intelligence snapshots (GitHub/Replit telemetry)
    V12: AI model configs (per-scope provider selection)
    OS: osEventsTable (EventBus persistence)
    Phase 10: deployment events, provider reliability ledger
```

**Domain:** live-streaming social platform + AI Mission Control. All Mission Control/AI executive schemas stay in vybelive.

**AI:** `AIProviderFactory` with multi-provider fallback chain (OpenAI → Anthropic → Google → Mock), per-request model hints, per-objective DB overrides, provider reliability ledger, cost tracking. This is the canonical AI infrastructure.

**No camera abstraction:** VYBE uses Agora's RTC SDK directly for live streaming.

---

## 3. Dependency Graph

### 3.1 Platform package dependencies

```
                         ┌──────────────────┐
                         │   shared-types   │  (no dependencies)
                         └────────┬─────────┘
          ┌──────────────┬────────┼────────┬─────────────┬──────────────┐
          │              │        │        │             │              │
  ┌───────▼──────┐ ┌─────▼────┐ ┌▼───────┐ ┌───────────▼┐ ┌──────────▼─┐
  │  camera-core │ │ ai-core  │ │storage-│ │property-   │ │  ui-core   │
  │              │ │          │ │ core   │ │  core      │ │            │
  └──────┬───────┘ └────┬─────┘ └┬──────┘ └────────────┘ └────────────┘
         │              │        │
  ┌──────▼──────┐ ┌─────▼────┐  ├──────────────┐
  │meta-wearables│ │  voice-  │  │              │
  │             │ │intellig. │  │              │
  └─────────────┘ └──────────┘  │              │
                          ┌─────▼───────┐ ┌────▼──────────────┐
                          │evidence-core│ │live-session-core   │
                          │             │ │                    │
                          └─────────────┘ └────────────────────┘

  ┌───────────────┐
  │  sync-engine  │  → shared-types only
  │               │    (storage-core wired by caller via FileUploader injection)
  └───────────────┘
```

**Key design rules:**
- `sync-engine` does NOT import `storage-core` — the caller injects a `FileUploader` adapter.
- `evidence-core` depends on `storage-core` for uploads but does NOT depend on `camera-core` — the two are parallel (camera-core produces evidence; evidence-core manages its lifecycle).
- `property-core` has no platform dependencies beyond `shared-types` — it is deliberately isolated.

### 3.2 App consumption

```
readyloq-mobile ──→ shared-types
                ──→ camera-core       (vision/ → provider-registry, quality-gate)
                ──→ storage-core      (objectStorage.ts with company namespace)
                ──→ sync-engine       (engine.ts + inspection-store.ts)
                ──→ evidence-core     (inspection evidence lifecycle, upload pipeline)
                ──→ property-core     (inspection properties / sites)
                ──→ meta-wearables    (FUTURE_PROVIDER_DEFINITIONS)
                ──→ ai-core           (AIProviderFactory, sessions, pipeline, events)
                ──→ ui-core           (design tokens + component variants)
                ──→ voice-intelligence (Phase Next — dictation during inspections)
                ✗   live-session-core (not needed — no streaming in ReadyLoq today)

vybelive       ──→ shared-types
               ──→ storage-core       (objectStorage.ts, IdentityNamespace)
               ──→ evidence-core      (stream clips and recordings as evidence)
               ──→ property-core      (stream venues / creator locations)
               ──→ ai-core            (AIProvider, factory, sessions, pipeline, EventBus, StateEngine)
               ──→ live-session-core  (Agora, cloud recording, clips, social publish)
               ──→ ui-core            (design tokens + component variants)
               ──→ voice-intelligence (Phase Next — stream transcription, commands)
               ✗   camera-core        (not needed — Agora owns the camera)
               ✗   sync-engine        (not needed — always-online streaming app)
               ✗   meta-wearables     (not needed yet)
```

---

## 4. Canonical Implementation Map

| Package | Canonical Source | Reason | Generalisation Required |
|---------|-----------------|--------|------------------------|
| **shared-types** | New (synthesised from both) | Types exist in both; this is a merge | Domain-agnostic versions only; apps add domain fields locally |
| **camera-core** | `readyloq-mobile` | VYBE has no camera abstraction | Remove pest-specific identifiers; injectable QualityGate thresholds; KVAdapter instead of AsyncStorage |
| **storage-core** | `readyloq-mobile` (superset) | ReadyLoq adds company-scoped path namespacing on top of the identical base VYBE uses | Move sidecar URL to env var; typed error objects |
| **sync-engine** | `readyloq-mobile` | VYBE has no offline sync | Generic `SyncEngine<T>`; KVAdapter injection; FileUploader injection; configurable pipeline steps |
| **evidence-core** | `readyloq-mobile` (primary) + `vybelive` (upload patterns) | ReadyLoq has the richest evidence lifecycle (quality records, annotations, local store); VYBE's uploadMedia.ts adds upload flow patterns | Decouple from Inspection entity; EvidenceStore becomes generic; annotations apply to both photos and video clips |
| **property-core** | `readyloq-mobile` | ReadyLoq's properties schema is the most complete (structured address, lat/lng, area, year built, contacts, access instructions); VYBE stores location as a free-text string only | Remove pest-specific fields (access instructions, treatment history) to app layer; ownerId scoping for both company (ReadyLoq) and creator (VYBE) |
| **meta-wearables** | `readyloq-mobile` (stubs only) | VYBE has no wearables code | Already stub-level; WearableRegistry plugin pattern |
| **voice-intelligence** | New (no existing code) | Neither app has implemented voice yet | Greenfield |
| **live-session-core** | `vybelive` | ReadyLoq has no streaming | Agora credentials injected; SocialPublisher adapters per platform; CloudRecording decoupled from Agora-specific API |
| **ai-core** | `vybelive` (provider/factory/bus/state/pipeline) + `readyloq-mobile` (confidence model) | VYBE's AIProviderFactory and EventBus are the superior infrastructure; ReadyLoq's 0–1 confidence is more principled than VYBE's 0–100 int | Keep strictly generic; normalise confidence to 0–1; EventBus generic over payload; extract StateEngine's localStorage coupling; remove VYBE-specific event kind constants |
| **ui-core** | Both (shadcn/ui set is identical on web; native component APIs are parallel) | Merge — tokens and contracts only | No JSX extracted; implementations stay per-app |

---

## 5. What Stays in Each App (Never Migrates)

### Stays in readyloq-mobile
- All pest-inspection domain schemas: inspections, findings, pest species, treatments, scorecards, proposals
- Multi-tenant company management, user/role management
- Pest-specific AI prompts, batch analysis pipeline, detection labels
- Report generation (PDF/Word) with pest-inspection templates
- Lead management, opportunity tracking, customer summaries
- Property-specific pest history, treatment records, pricing logic
- ReadyLoq-specific UI: inspection flows, evidence review, property maps

### Stays in vybelive
- AI Executive layer: Quinn + executive team — all V1–V12 schemas
- Mission Control — objectives, tasks, approvals, autonomy engine, agent-zero jobs
- Executive memory, chief reasoning, retrospectives, weekly reviews
- Organisation events ledger, cause→effect event chains
- Engineering intelligence (GitHub/Replit telemetry), engineering snapshots
- VYBE-specific event kinds (`vybe.*`, `github.*`, `replit.*`, `stream.*`)
- Social features: streams, creator dashboard, discover, collaborations, recordings
- Stream-specific DB schemas (live-session-core exports interfaces; the DB tables stay in vybelive)
- Stream venue permissions, capacity, audience demographics (property-core provides the base; VYBE adds these fields)

---

## 6. Migration Plan

### Phase 1 — Foundation (Weeks 1–2)

**T1.1: shared-types**
- Synthesise `EvidenceItem`, `CaptureMode`, `CaptureSource`, `QualityAssessment` from ReadyLoq `vision/types.ts`
- Synthesise `OSEvent`, `EventPriority`, `AIRequest`, `AIResponse`, `AIUsage`, `AIModelHint` from VYBE `AIProvider.ts` + `EventBus.ts`
- Add `SyncRecord`, `SyncStatus`, `ConfidenceScore`
- Wire up TypeScript project references; confirm both apps can import the package
- **Acceptance:** `pnpm -r typecheck` passes across all three repos

**T1.2: storage-core**
- Extract ReadyLoq `objectStorage.ts` as the base implementation
- Add `StorageNamespace` interface + `IdentityNamespace` + `companyNamespace()`
- Move sidecar URL to `OBJECT_STORAGE_BASE_URL` env var (default: `http://127.0.0.1:1106`)
- Typed error class `StorageError`
- Unit tests with a mock HTTP server

### Phase 2 — Camera, Sync & Evidence (Weeks 3–5)

**T2.1: camera-core**
- Extract ReadyLoq `vision/types.ts`, `provider-registry.ts`, `quality-gate.ts`, `pixels.ts`
- Remove pest-specific identifiers from provider configs; inject QualityGate thresholds
- Replace AsyncStorage coupling with `KVAdapter` interface
- Keep `DeviceCameraProvider` (wraps expo-camera) as default
- Wire into readyloq-app; confirm all capture flows work

**T2.2: sync-engine**
- Extract ReadyLoq `sync/engine.ts` + `local/inspection-store.ts`
- Generalise entity type to `SyncEngine<T extends SyncableEntity>`
- Inject `KVAdapter` + `FileUploader`
- Make pipeline steps configurable (not all entities need the upload step)
- Unit tests with MemoryAdapter + mock FileUploader

**T2.3: evidence-core**
- Extract ReadyLoq `inspection-store.ts` evidence-related operations as `EvidenceStore`
- Extract VYBE `uploadMedia.ts` upload patterns as `EvidenceUploadPipeline`
- Add `EvidenceCollection`, `EvidenceAnnotation`, `EvidenceQualityRecord`
- Decouple from Inspection entity — make `entityType`/`entityId` generic
- Unit tests with MemoryAdapter backing EvidenceStore

### Phase 3 — Properties & AI Core (Weeks 6–7)

**T3.1: property-core**
- Extract ReadyLoq `properties` DB schema into `PropertyRecord` + `PropertyStore` + `GeocodingService`
- Remove pest-specific fields (access instructions, treatment history) to ReadyLoq app layer
- Add `ownerId` scoping that maps to `companyId` (ReadyLoq) or `creatorId` (VYBE)
- Integration tests against a Postgres test DB

**T3.2: ai-core**
- Extract VYBE `AIProvider.ts` + `AIProviderFactory.ts` + `AIProviderCapabilities`
- Extract VYBE `EventBus.ts` + `StateEngine.ts`
- Add `AISession`, `AIMessage`, `AISessionConfig`, `AISessionManager`
- Add `AIPipeline`, `AIMiddleware`, `AIRequestContext`
- Add `AIRateLimiter`, `AIUsageTracker`, `AIUsageSummary`
- Add `AI_EVENT_KINDS` constants + typed event payloads
- Normalise confidence to 0–1; remove all VYBE-specific event kind constants
- Unit tests: fallback chain, session multi-turn, pipeline middleware ordering

**T3.3: Migrate ReadyLoq to use ai-core**
- Replace ReadyLoq's direct `OpenAI` import with `AIProviderFactory`
- Wrap analysis calls in `AISession` per inspection batch
- Emit AI infrastructure events via `EventBus`
- Replace confidence `number` with `ConfidenceResult` struct

### Phase 4 — Wearables, Voice, Live Session (Weeks 8–10)

**T4.1: meta-wearables**
- Promote ReadyLoq's `FUTURE_PROVIDER_DEFINITIONS` to `WearableProvider` implementations
- Add `WearableRegistry.discover()` with BLE scan (react-native-ble-plx)
- Integration test with mock BLE peripheral

**T4.2: live-session-core**
- Extract VYBE mobile `stream/` session logic + `lib/uploadMedia.ts`
- Wrap Agora SDK behind `AgoraAdapter` — all Agora imports confined to adapter
- Add `SocialPublisher` adapters for YouTube and Instagram
- Move Agora credentials to injected configuration

**T4.3: voice-intelligence**
- Greenfield: `VoiceRecorder` (expo-av on mobile, MediaRecorder on web)
- `TranscriptionService` backed by Whisper via `AIProviderFactory`
- `VoiceCommandRouter` with pattern matching + generic `TAction` type
- Wire into ReadyLoq mobile (dictation during inspections)
- Wire into VYBE mobile (stream control commands + auto-captioning)

### Phase 5 — UI Core (Week 11)

**T5.1: ui-core**
- Extract design tokens from both apps' Tailwind configs and native StyleSheet constants
- Confirm component prop interfaces match ui-core contracts
- Both apps keep their own JSX implementations — no component code migrates

---

## 7. Extraction Order (dependency-safe)

```
1. shared-types           (no deps — must go first)
2. storage-core           (→ shared-types)
3. ai-core                (→ shared-types)               ← parallel
   camera-core            (→ shared-types)               ← parallel
   sync-engine            (→ shared-types)               ← parallel
   property-core          (→ shared-types)               ← parallel
   ui-core                (→ shared-types)               ← parallel
4. evidence-core          (→ shared-types, storage-core) ← after step 2
   meta-wearables         (→ camera-core)                ← after step 3
   voice-intelligence     (→ ai-core)                    ← after step 3
   live-session-core      (→ shared-types, storage-core) ← after step 2
```

Step 3 packages are all independently workable in parallel. Step 4 each depend on exactly one step-3 package.

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **objectStorage.ts sidecar URL hardcoded** — both apps have `127.0.0.1:1106` hardcoded; tests outside Replit fail | High | Medium | Move to `OBJECT_STORAGE_BASE_URL` env var in Phase 1 |
| **AsyncStorage coupling in sync-engine + evidence-core** — both use AsyncStorage directly; web apps fail | High | High | KVAdapter interface; inject before any web consumer exists |
| **VYBE confidence is 0–100 int; ReadyLoq is 0–1 float** — if mis-normalised, detection results mis-score | Medium | High | Normalise in ai-core; branded `ConfidenceScore` type with validator |
| **Agora SDK deep-coupled in VYBE mobile** — stream state, recording, and UI tightly coupled to Agora types | Medium | High | AgoraAdapter abstraction in Phase 4; do not migrate until adapter is stable |
| **ReadyLoq pest-specific AI prompts mixed into analysis service** — extraction may accidentally include domain prompts | Low | Medium | Code review gate: no pest species string literals in platform packages |
| **VYBE Mission Control AI schemas are very large** — 12 migration versions; accidental inclusion pollutes shared-types | Low | High | Explicit allow-list in shared-types; CI lint rule blocking VYBE-specific table imports |
| **evidence-core annotation model may conflict** — ReadyLoq uses region overlays on images; VYBE uses timestamp-based tags on video | Medium | Medium | `AnnotationKind` union is open (string); both models satisfy it; no forced merge |
| **property-core ownerId scoping mismatch** — ReadyLoq always scopes to companyId; VYBE is currently single-tenant | Low | Low | ownerId is optional; single-tenant apps pass undefined |
| **React Native version skew** — ReadyLoq and VYBE may target different RN versions | Medium | Medium | Audit before Phase 2; ui-core and property-core have no JSX so not a Phase 1–3 blocker |
| **expo-file-system API differences** — ReadyLoq sync engine uses `FileSystem.uploadAsync` | Medium | Medium | FileUploader adapter; expo-file-system stays in the app |

---

## 9. Effort Estimate

| Phase | Packages | Engineer-weeks | Notes |
|-------|----------|---------------|-------|
| 1 — Foundation | shared-types, storage-core | 1.5 | Low risk; mostly type lifting + env var |
| 2 — Camera, Sync, Evidence | camera-core, sync-engine, evidence-core | 3.0 | evidence-core adds annotation + collection model |
| 3 — Properties, AI Core | property-core, ai-core + ReadyLoq migration | 2.5 | AI session + pipeline is new; property extraction is straightforward |
| 4 — Wearables, Voice, Live Session | meta-wearables, voice-intelligence, live-session-core | 3.5 | Greenfield voice; Agora decoupling is non-trivial |
| 5 — UI Core | ui-core | 0.5 | Token extraction only; no JSX migration |
| **Total** | **11 packages** | **~11 eng-weeks** | Parallelisable at Phase 3; could compress to ~7 weeks with 2 engineers |

---

## 10. Package Scaffolding Summary

All 11 packages are created in `packages/` with:
- `package.json` — `@platform/` scoped name, `workspace:*` dependencies, typecheck + build scripts
- `tsconfig.json` — extends root config, composite mode, correct project references
- `src/index.ts` — fully documented type interfaces with canonical source paths, generalisation notes, dependency graph

### Package structure

```
platform/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── .npmrc
├── ARCHITECTURE.md               ← this document
└── packages/
    ├── shared-types/             @platform/shared-types
    ├── camera-core/              @platform/camera-core
    ├── storage-core/             @platform/storage-core
    ├── sync-engine/              @platform/sync-engine
    ├── evidence-core/            @platform/evidence-core        ← NEW
    ├── property-core/            @platform/property-core        ← NEW
    ├── meta-wearables/           @platform/meta-wearables
    ├── voice-intelligence/       @platform/voice-intelligence
    ├── live-session-core/        @platform/live-session-core    ← renamed
    ├── ai-core/                  @platform/ai-core              ← expanded
    └── ui-core/                  @platform/ui-core
```

---

## 11. Key Architectural Decisions

**ADR-001: Platform packages export interfaces only**
Concrete implementations stay in each app. The platform repo is a typed contract layer — zero runtime dependencies. All `devDependencies` are TypeScript only. This eliminates framework coupling between ReadyLoq (Expo + React Native) and VYBE (Expo + Agora + web).

**ADR-002: sync-engine does not depend on storage-core**
The upload step is handled via an injected `FileUploader` interface. This keeps both packages independently testable and allows VYBE to adopt sync-engine without inheriting storage-core.

**ADR-003: ai-core stays generic — zero domain logic**
ReadyLoq keeps all pest-specific AI prompts, detection labels, and analysis pipelines. VYBE keeps all Mission Control executive logic, autonomy engine, and engineering intelligence. ai-core exports: AIProvider interface, AIProviderFactory, AISession + AISessionManager, AIPipeline + AIMiddleware, AIRateLimiter, AIUsageTracker, AI_EVENT_KINDS constants, EventBus, StateEngine, ConfidenceResult, Detection, AnalysisResult, Measurement. No domain strings anywhere in the package.

**ADR-004: Confidence is 0–1 float platform-wide**
VYBE's `executiveRecommendations.confidence` (0–100 int) is a DB storage detail. All platform confidence values normalise to `[0, 1]`. A branded TypeScript type (`ConfidenceScore`) enforces this at compile time.

**ADR-005: objectStorage.ts sidecar URL moved to env var**
Both apps hardcode `http://127.0.0.1:1106`. storage-core uses `process.env.OBJECT_STORAGE_BASE_URL ?? 'http://127.0.0.1:1106'`.

**ADR-006: ui-core is tokens + contracts only**
No JSX. Both apps keep their own React/React Native component implementations satisfying the ui-core prop interfaces.

**ADR-007: camera-core and evidence-core are separate packages**
camera-core = acquisition (getting frames from devices). evidence-core = persistence (storing, annotating, querying frames after capture). The separation allows web dashboards that review field evidence to depend on evidence-core without pulling in camera-core or any native camera SDK.

**ADR-008: property-core has no platform dependencies beyond shared-types**
Properties are a pure data record — they don't need storage-core, camera-core, or ai-core. Keeping property-core isolated means it can be adopted by any future product (web reporting tool, CRM integration) with minimal transitive dependencies.

**ADR-009: live-session-core name (not streaming-core)**
"Streaming" implies one-way media delivery; the package manages bidirectional live sessions (viewer count, pause/resume, recording, social re-stream). "Live session" is a more accurate and general term that also applies if ReadyLoq ever adds a live inspection walkthrough mode.

**ADR-010: AIPipeline sits above AIProviderFactory**
The factory handles provider selection and fallback. The pipeline handles cross-cutting concerns (logging, caching, rate limiting, content filtering) as composable middleware. Callers that need only simple dispatch use the factory directly; callers that need instrumented dispatch use the pipeline. Both are in ai-core.
