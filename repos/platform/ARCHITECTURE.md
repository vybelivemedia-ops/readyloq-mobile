# Platform Architecture & Migration Analysis

> **Generated:** 2026-07-14  
> **Scope:** Cross-repo analysis of `readyloq-mobile` + `vybelive` → extraction plan for `platform`  
> **Status:** Analysis complete. Package scaffolding created. NO code migrated yet.

---

## 1. Executive Summary

Two production apps share significant infrastructure that is currently duplicated:

| App | Domain | Stack |
|-----|--------|-------|
| **ReadyLoq** (`readyloq-mobile`) | Pest inspection — mobile capture, offline sync, AI analysis, multi-tenant SaaS | Expo + React Native + Express API + Drizzle/Postgres |
| **VYBE LIVE** (`vybelive`) | Creator live-streaming — Agora RTC, social publishing, Mission Control AI OS | Expo + React Native + Express API + Drizzle/Postgres + AI executive layer |

Both use an **identical** monorepo structure (pnpm workspaces, `artifacts/`, `lib/`) and target the **same Replit sidecar object storage** at `127.0.0.1:1106`. Seven infrastructure packages can be extracted; two are new (wearables stubs + voice, which neither app has implemented yet).

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
      local/          AsyncStorage KV store
        inspection-store.ts
      objectStorage.ts ← CANONICAL for storage-core (superset)
lib/
  db/src/schema/
    inspections, analysis, callbacks, dataset, reports, training,
    branding, users, properties, companies, leads, intelligence-dataset,
    beta, opportunities, scorecards, customer-summaries, proposals
```

**Domain:** pest inspection. Schemas are heavily pest-specific (inspections, findings, evidence, pest species, treatment recommendations, scorecards, proposals). These stay in readyloq-mobile.

**AI:** Direct OpenAI calls from the Express API. No provider abstraction — single provider, batched analysis pipeline, confidence 0–1 float. VYBE's AIProviderFactory is the superior abstraction.

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
      stream/                 ← live stream session (Agora RTC) ← CANONICAL for streaming-core
      creator/                ← creator dashboard
      (tabs)/discover, recordings, notifications, collaborations
    lib/
      uploadMedia.ts          ← media upload patterns
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

**Domain:** live-streaming social platform + AI Mission Control (AI executives managing product objectives). All Mission Control/AI executive schemas stay in vybelive.

**AI:** `AIProviderFactory` with multi-provider fallback chain (OpenAI → Anthropic → Google → Mock), per-request model hints, per-objective DB overrides, provider reliability ledger, cost tracking. This is the canonical AI infrastructure.

**No camera abstraction:** VYBE uses Agora's RTC SDK directly for live streaming. No EvidenceItem model. No offline sync.

---

## 3. Dependency Graph

### 3.1 Platform package dependencies

```
                    ┌─────────────────┐
                    │  shared-types   │  (no dependencies)
                    └────────┬────────┘
              ┌──────────────┼──────────────┬──────────────┐
              │              │              │              │
     ┌────────▼──────┐  ┌────▼────┐  ┌─────▼────┐  ┌─────▼─────┐
     │  camera-core  │  │ ai-core │  │storage-  │  │  ui-core  │
     │               │  │         │  │  core    │  │           │
     └───────┬───────┘  └────┬────┘  └────┬─────┘  └───────────┘
             │               │            │
    ┌────────▼──────┐  ┌─────▼──────┐  ┌─▼──────────────┐
    │ meta-wearables│  │  voice-    │  │ streaming-core │
    │               │  │intelligence│  │                │
    └───────────────┘  └────────────┘  └────────────────┘

    ┌───────────────┐
    │  sync-engine  │  → shared-types only
    │               │    (storage-core wired by caller, not imported)
    └───────────────┘
```

**Key design rule:** `sync-engine` does NOT import `storage-core`. The caller wires them together by injecting a `FileUploader` adapter into the engine constructor. This keeps the packages independently testable.

### 3.2 App consumption

```
readyloq-mobile ──→ shared-types
                ──→ camera-core       (vision/ → provider-registry, quality-gate)
                ──→ storage-core      (objectStorage.ts with company namespace)
                ──→ sync-engine       (engine.ts + inspection-store.ts)
                ──→ meta-wearables    (FUTURE_PROVIDER_DEFINITIONS)
                ──→ ai-core           (replace direct OpenAI with AIProviderFactory)
                ──→ ui-core           (design tokens + component variants)
                ──→ voice-intelligence (Phase Next — dictation during inspections)

vybelive       ──→ shared-types
               ──→ storage-core      (objectStorage.ts as-is, IdentityNamespace)
               ──→ ai-core           (AIProvider, AIProviderFactory, EventBus, StateEngine)
               ──→ streaming-core    (Agora, cloud recording, clips, social publish)
               ──→ ui-core           (design tokens + component variants)
               ──→ voice-intelligence (Phase Next — stream transcription, commands)
               ✗   camera-core       (not needed — Agora owns the camera)
               ✗   sync-engine       (not needed — always-online streaming app)
               ✗   meta-wearables    (not needed yet — possible future creator tools)
```

---

## 4. Canonical Implementation Map

For each platform package, the table shows which app's code is the canonical source and what generalisation is required before extraction.

| Package | Canonical Source | Reason | Generalisation Required |
|---------|-----------------|--------|------------------------|
| **shared-types** | New (synthesised from both) | Types exist in both; this is a merge | Define domain-agnostic versions; both apps add domain fields locally |
| **camera-core** | `readyloq-mobile` | VYBE has no camera abstraction | Remove pest-specific field names from provider configs; make QualityGate thresholds injectable; decouple from AsyncStorage |
| **storage-core** | `readyloq-mobile` (superset) | ReadyLoq adds `objectPathCompanyScope()` on top of the identical base VYBE uses | Move sidecar URL to env var; typed error objects instead of raw throws |
| **sync-engine** | `readyloq-mobile` | VYBE has no offline sync | Generify entity type `T`; decouple from AsyncStorage (inject KVAdapter); decouple from expo-file-system (inject FileUploader); make pipeline steps configurable |
| **meta-wearables** | `readyloq-mobile` (stubs only) | VYBE has no wearables code | Already stub-level; move to WearableRegistry plugin pattern |
| **voice-intelligence** | New (no existing code) | Neither app has implemented voice yet | Greenfield; design from roadmap comments in both repos |
| **streaming-core** | `vybelive` | ReadyLoq has no streaming | Move Agora credentials to injected config; extract SocialPublisher adapters; decouple CloudRecording from Agora-specific API |
| **ai-core** | `vybelive` (factory) + `readyloq-mobile` (confidence model) | VYBE's AIProviderFactory is superior; ReadyLoq's 0–1 confidence is more principled than VYBE's 0–100 | Keep strictly generic — no pest or streaming logic; normalise confidence to 0–1; make EventBus generic over payload |
| **ui-core** | Both (shadcn/ui set is identical on web; native components differ) | Both web apps share shadcn/ui; mobile component APIs are similar | Extract prop interfaces and design tokens only — no JSX; implementations stay per-app |

---

## 5. What Stays in Each App (Never Migrates)

### Stays in readyloq-mobile
- All pest-inspection domain schemas: inspections, findings, pest species, treatments, scorecards, proposals
- Multi-tenant company management, user/role management
- Pest-specific AI prompts, batch analysis pipeline, detection labels
- Report generation (PDF/Word) with pest-specific templates
- Lead management, opportunity tracking
- ReadyLoq-specific UI: inspection flows, evidence review, property maps

### Stays in vybelive
- AI Executive layer: Quinn + executive team (Ada, Theo, Mara, …) — all `V1–V12` schemas
- Mission Control — objectives, tasks, approvals, autonomy engine, agent-zero jobs
- Executive memory, chief reasoning, retrospectives, weekly reviews
- Organisation events ledger, cause→effect event chains
- Engineering intelligence (GitHub/Replit telemetry), engineering snapshots
- VYBE-specific event kinds (`vybe.*`, `github.*`, `replit.*`)
- Social features: streams, creator dashboard, discover, collaborations, recordings
- Stream-specific schemas (stays in vybelive DB — streaming-core exports interfaces only)

---

## 6. Migration Plan

### Phase 1 — Foundation (Weeks 1–2)
Extract the zero-dependency foundation first. No app code changes yet.

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
- Typed error class `StorageError` replacing raw `Error` throws
- Unit tests with a mock HTTP server

### Phase 2 — Camera & Sync (Weeks 3–4)

**T2.1: camera-core**
- Extract ReadyLoq `vision/types.ts`, `provider-registry.ts`, `quality-gate.ts`, `pixels.ts`
- Generalise: rename any pest-specific identifiers; inject QualityGate thresholds
- Replace `AsyncStorage` coupling with `KVAdapter` interface
- Keep `DeviceCameraProvider` (wraps `expo-camera`) as the default implementation
- Wire into readyloq-app; confirm all existing capture flows work

**T2.2: sync-engine**
- Extract ReadyLoq `sync/engine.ts` + `local/inspection-store.ts`
- Generalise entity type to `SyncEngine<T extends SyncableEntity>`
- Inject `KVAdapter` (AsyncStorage adapter for mobile, MemoryAdapter for tests)
- Inject `FileUploader` (wraps storage-core upload for the binary evidence step)
- Replace Inspection-specific step logic with configurable pipeline
- Unit tests with MemoryAdapter + mock FileUploader

### Phase 3 — AI Core (Weeks 5–6)

**T3.1: ai-core**
- Extract VYBE `AIProvider.ts` interface + `AIProviderFactory.ts` logic
- Extract VYBE `EventBus.ts` + `StateEngine.ts`
- Normalise confidence to 0–1 (VYBE uses 0–100 int in `executiveRecommendations.confidence`)
- Remove all VYBE-specific event kind constants from the package
- Make EventBus generic: `EventBus` with payload type parameter
- Unit tests for fallback chain (mock providers with controlled failure)

**T3.2: Migrate ReadyLoq to use ai-core**
- Replace ReadyLoq's direct `OpenAI` import with `AIProviderFactory`
- Add `EventBus` for AI analysis lifecycle events (analysis.started, analysis.completed, analysis.failed)
- Replace confidence `number` with `ConfidenceResult` struct

### Phase 4 — Wearables, Voice, Streaming (Weeks 7–9)

**T4.1: meta-wearables**
- Promote ReadyLoq's `FUTURE_PROVIDER_DEFINITIONS` stubs to `WearableProvider` implementations
- Add `WearableRegistry.discover()` with BLE scan (react-native-ble-plx)
- Integration test with a mock BLE peripheral

**T4.2: streaming-core**
- Extract VYBE mobile `stream/` session logic + `lib/uploadMedia.ts`
- Extract VYBE API stream routes into interface definitions
- Wrap Agora SDK behind `AgoraAdapter` — all Agora imports confined to adapter
- Add `SocialPublisher` adapters for YouTube and Instagram

**T4.3: voice-intelligence**
- Greenfield implementation: `VoiceRecorder` (expo-av on mobile, MediaRecorder on web)
- `TranscriptionService` backed by Whisper via `AIProviderFactory`
- `VoiceCommandRouter` with pattern matching
- Wire into ReadyLoq mobile (dictation mode during inspections)
- Wire into VYBE mobile (stream control commands)

### Phase 5 — UI Core (Week 10)

**T5.1: ui-core**
- Extract design tokens from both apps' Tailwind configs and native StyleSheet constants
- Confirm both apps' component prop interfaces match the ui-core contracts
- Both apps keep their own JSX implementations — no component code migrates

---

## 7. Extraction Order (dependency-safe)

```
1. shared-types          (no deps — must go first)
2. storage-core          (→ shared-types)
3. ai-core               (→ shared-types)
   camera-core           (→ shared-types)   ← parallel with ai-core
   sync-engine           (→ shared-types)   ← parallel with ai-core
4. meta-wearables        (→ camera-core)
   voice-intelligence    (→ ai-core)        ← parallel with meta-wearables
   streaming-core        (→ storage-core)   ← parallel with meta-wearables
5. ui-core               (→ shared-types — can go any time after step 1)
```

Step 3 packages can all be worked in parallel by separate engineers/tasks. Step 4 packages each depend on exactly one step-3 package.

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **objectStorage.ts sidecar URL hardcoded** — both apps have `127.0.0.1:1106` hardcoded; tests outside Replit will fail | High | Medium | Move to `OBJECT_STORAGE_BASE_URL` env var in Phase 1 |
| **AsyncStorage coupling in sync-engine** — the engine's KV layer assumes AsyncStorage; web apps would fail | High | High | KVAdapter interface in Phase 2; inject before any web consumer exists |
| **VYBE confidence is 0–100 int; ReadyLoq is 0–1 float** — if normalised incorrectly, detection results mis-score | Medium | High | Normalise in ai-core; add branded type `ConfidenceScore = number & { _brand: 'confidence' }` with validator |
| **Agora SDK deep-coupled in VYBE mobile** — stream session state, recording, and UI are tightly coupled to Agora types | Medium | High | AgoraAdapter abstraction in Phase 4; do not migrate until adapter is stable |
| **ReadyLoq pest-specific AI prompts mixed into analysis service** — extraction may accidentally include domain prompts | Low | Medium | Code review gate: no string literals referencing pest species in platform packages |
| **VYBE Mission Control AI schemas are very large** — 12 migration versions; accidental inclusion would pollute shared-types | Low | High | Explicit allow-list of types in shared-types; CI lint rule blocking import of VYBE-specific table types |
| **React Native version skew** — ReadyLoq and VYBE may target different RN versions; native module APIs may differ | Medium | Medium | Audit RN versions before Phase 2; ui-core contains no JSX so this is not a blocker for Phase 1–3 |
| **expo-file-system API differences** — ReadyLoq sync engine uses `FileSystem.uploadAsync` which is Expo-specific | Medium | Medium | FileUploader adapter interface in sync-engine; expo-file-system stays in the app, not the package |

---

## 9. Effort Estimate

| Phase | Packages | Engineer-weeks | Notes |
|-------|----------|---------------|-------|
| 1 — Foundation | shared-types, storage-core | 1.5 | Low risk; mostly type lifting + env var |
| 2 — Camera & Sync | camera-core, sync-engine | 2.5 | Highest generalisation effort (AsyncStorage → KVAdapter) |
| 3 — AI Core | ai-core + ReadyLoq migration | 2.0 | VYBE factory is already well-abstracted |
| 4 — Wearables, Voice, Streaming | meta-wearables, voice-intelligence, streaming-core | 3.5 | Greenfield voice; Agora decoupling is non-trivial |
| 5 — UI Core | ui-core | 0.5 | Token extraction only; no JSX migration |
| **Total** | **9 packages** | **~10 eng-weeks** | Parallelisable at Phase 3–4; could compress to ~6 weeks with 2 engineers |

---

## 10. Package Scaffolding Summary

All 9 packages are created in `packages/` with:
- `package.json` — correct `@platform/` scoped name, `workspace:*` dependencies, typecheck + build scripts
- `tsconfig.json` — extends root config, composite mode, correct project references
- `src/index.ts` — fully documented type interfaces with:
  - Canonical source file paths from both repos
  - Generalisation notes
  - Dependency graph documentation
  - Placeholder interfaces ready to be filled by extracted implementations

### Package structure

```
platform/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── .npmrc
├── ARCHITECTURE.md           ← this document
└── packages/
    ├── shared-types/         @platform/shared-types
    ├── camera-core/          @platform/camera-core
    ├── storage-core/         @platform/storage-core
    ├── sync-engine/          @platform/sync-engine
    ├── meta-wearables/       @platform/meta-wearables
    ├── voice-intelligence/   @platform/voice-intelligence
    ├── streaming-core/       @platform/streaming-core
    ├── ai-core/              @platform/ai-core
    └── ui-core/              @platform/ui-core
```

---

## 11. Key Architectural Decisions

**ADR-001: Platform packages export interfaces only**  
Concrete implementations stay in each app. The platform repo is a typed contract layer. This eliminates framework coupling and allows ReadyLoq (Expo + React Native) and VYBE (Expo + Agora + web) to satisfy the same interfaces without sharing runtime code.  
*Consequence:* Platform packages have zero runtime dependencies. All `devDependencies` are TypeScript only.

**ADR-002: sync-engine does not depend on storage-core**  
The sync engine's upload step is handled via an injected `FileUploader` interface, not a direct `storage-core` import. This keeps both packages independently testable and allows VYBE to adopt sync-engine in the future without pulling in storage-core.

**ADR-003: ai-core stays generic — zero domain logic**  
ReadyLoq keeps all pest-specific AI prompts, detection labels, and analysis pipelines. VYBE keeps all Mission Control executive logic, autonomy engine, and engineering intelligence. ai-core exports only: AIProvider interface, AIProviderFactory, EventBus, StateEngine, ConfidenceResult, Detection, AnalysisResult, Measurement.

**ADR-004: Confidence is 0–1 float platform-wide**  
VYBE's `executiveRecommendations.confidence` (0–100 int) is a DB storage detail that does not set the platform standard. All platform confidence values are normalised to `[0, 1]`. A branded TypeScript type (`ConfidenceScore`) will enforce this at compile time.

**ADR-005: objectStorage.ts sidecar URL moved to env var**  
Both apps hardcode `http://127.0.0.1:1106`. storage-core will use `process.env.OBJECT_STORAGE_BASE_URL ?? 'http://127.0.0.1:1106'`. This allows test environments and future non-Replit deployments to override the endpoint without code changes.

**ADR-006: ui-core is tokens + contracts only**  
Both apps share the shadcn/ui component set on web and have parallel native component APIs. Rather than trying to share JSX (which would require React as a peer dependency and force a web/native split), ui-core exports only: design token types, component prop interfaces, and variant union types. Each app provides its own JSX implementations satisfying those interfaces.
