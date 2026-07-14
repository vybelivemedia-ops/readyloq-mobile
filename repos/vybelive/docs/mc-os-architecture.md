# Mission Control 2.0 — Phase 1 OS Architecture

**Status:** Phase 1 Foundation — Compiled, zero modifications to existing code.
**Date:** July 2026

---

## 1. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Mission Control OS Layer                          │
│                   artifacts/api-server/src/services/os/                  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                         index.ts (public API)                     │   │
│  │   initOSLayer()  shutdownOSLayer()  getOSLayerStatus()           │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│             │              │               │              │              │
│      ┌──────▼──────┐  ┌───▼────────┐  ┌──▼──────────┐  │              │
│      │  EventBus   │  │StateEngine │  │  Objective   │  │              │
│      │             │  │            │  │  Manager     │  │              │
│      │ pub/sub     │  │ observable │  │              │  │              │
│      │ in-process  │  │ key-value  │  │ wraps:       │  │              │
│      │             │  │ store      │  │ agentObj-    │  │              │
│      │ subscribe() │  │            │  │ ectivesTable │  │              │
│      │ emit()      │  │ get/set()  │  │ (DB)         │  │              │
│      │ clear()     │  │ subscribe()│  │              │  │              │
│      └─────────────┘  └────────────┘  └─────────────┘  │              │
│                                                          │              │
│      ┌──────────────────┐  ┌─────────────────────────┐  │              │
│      │  Executive       │  │  Specialist Provider    │  │              │
│      │  Registry        │  │  Registry               │  │              │
│      │                  │  │                         │  │              │
│      │  wraps:          │  │  wraps:                 │  │              │
│      │  CAPABILITY_INFO │  │  SPECIALISTS[]          │  │              │
│      │  ROLES_WITH_CAP  │  │  (specialistRegistry)   │  │              │
│      │  aiExecutivesTable│  │                         │  │              │
│      │  (DB)            │  │  get/search/match       │  │              │
│      └──────────────────┘  └─────────────────────────┘  │              │
│                                                          │              │
│      ┌──────────────────────────────────────────────────▼──────────┐   │
│      │               Execution Provider Registry                    │   │
│      │                                                              │   │
│      │  register(provider)  dispatch(opts)  selectProvider(caps)   │   │
│      │                                                              │   │
│      │  ┌─────────────────────────────────────────────────────┐   │   │
│      │  │             providers/AgentZeroProvider              │   │   │
│      │  │                                                       │   │   │
│      │  │  adapts createAgentZeroJob() + getWorkerHealth()    │   │   │
│      │  │  capabilities: multi_step, analysis, monitoring,    │   │   │
│      │  │                specialist, engineering, social       │   │   │
│      │  └─────────────────────────────────────────────────────┘   │   │
│      │                                                              │   │
│      │  [Future: BrowserAgentProvider, CodeSandboxProvider, ...]   │   │
│      └──────────────────────────────────────────────────────────────┘   │
│                                                                          │
│      ┌──────────────────────────────────────────────────────────────┐   │
│      │               QuinnOrchestrator (Phase 1 Placeholder)         │   │
│      │                                                               │   │
│      │  classifyIntent(msg) → QuinnIntent (rule-based patterns)     │   │
│      │  respond(founderId, msg, execId) → QuinnResponse (stub)      │   │
│      │                                                               │   │
│      │  [P2-CLASSIFY]  AI fast call replaces rule patterns          │   │
│      │  [P2-COMMAND]   Commands route to ExecutionProviderRegistry  │   │
│      │  [P2-DELEGATE]  Calls converseAsChief() with full context    │   │
│      │  [P2-ACTIONS]   Executes response.actions automatically      │   │
│      └──────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

                    ↕ (wraps / adapts — never replaces)

┌─────────────────────────────────────────────────────────────────────────┐
│                      Existing MC Services (unchanged)                    │
│                                                                          │
│  agentZero.ts          chiefOrchestrator.ts    chiefConversation.ts     │
│  autonomyEngine.ts     specialistRegistry.ts   chiefReasoning.ts        │
│  aiExecutive.ts        executiveCapabilities/  executiveConversations.ts │
│  founderDecisionModel  founderProfile.ts        organizationMemory.ts    │
│  engineeringIntelligence  portfolioMonitor.ts  marketingLearning.ts     │
│  blockers/             ai/ (providers)                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Folder Structure

```
artifacts/api-server/src/services/os/
├── types.ts                          # All shared OS-layer type contracts (leaf — no imports)
├── EventBus.ts                       # In-process pub/sub event bus (singleton)
├── StateEngine.ts                    # Observable key-value state store (singleton)
├── ObjectiveManager.ts               # Objective lifecycle facade over agentObjectivesTable
├── ExecutiveRegistry.ts              # Typed executive descriptor registry (DB + static)
├── SpecialistProviderRegistry.ts     # Typed specialist descriptor registry (wraps SPECIALISTS[])
├── ExecutionProviderRegistry.ts      # Typed execution provider registry + dispatch router
├── QuinnOrchestrator.ts              # Quinn pipeline facade (Phase 1: stub + intent classifier)
├── index.ts                          # Public barrel export + initOSLayer() / getOSLayerStatus()
└── providers/
    └── AgentZeroProvider.ts          # ExecutionProvider adapter for agentZero.ts
```

### Dependency graph (no cycles)

```
types.ts
  ↑
EventBus.ts         (imports: types.ts, logger)
StateEngine.ts      (imports: types.ts, logger)
ExecutiveRegistry.ts (imports: types.ts, executiveCapabilities/index.ts, db, logger)
SpecialistProviderRegistry.ts (imports: types.ts, specialistRegistry.ts)
ExecutionProviderRegistry.ts  (imports: types.ts, EventBus.ts, logger)
ObjectiveManager.ts (imports: types.ts, EventBus.ts, db, logger)
QuinnOrchestrator.ts (imports: types.ts, EventBus.ts, logger)
providers/AgentZeroProvider.ts (imports: types.ts, ExecutionProviderRegistry.ts, agentZero.ts, logger)
index.ts            (imports: all of the above — one-way)
```

---

## 3. Data Flow

### 3a. OS Bootstrap (server startup)

```
server/index.ts
  └─► initOSLayer()
        ├─► ExecutiveRegistry.load()   — DB query merges with CAPABILITY_INFO
        ├─► ExecutionProviderRegistry.register(new AgentZeroProvider())
        ├─► EventBus.subscribe("objective.*") → StateEngine counter updates
        ├─► EventBus.subscribe("job.dispatched") → AgentZero health check
        └─► StateEngine.set(OS_INIT_AT, now)
```

### 3b. Objective creation (OS layer)

```
caller
  └─► ObjectiveManager.create(input)
        ├─► DB: insert into agent_objectives
        └─► EventBus.emit("objective.created", { objective })
              └─► [listener] StateEngine.set(ACTIVE_OBJECTIVE_COUNT, n)
```

### 3c. Job dispatch

```
caller
  └─► ExecutionProviderRegistry.dispatch({ command, instruction, ... })
        ├─► selectProvider(requiredCapabilities)
        │     └─► AgentZeroProvider (only registered provider in Phase 1)
        ├─► AgentZeroProvider.dispatch(opts)
        │     └─► agentZero.createAgentZeroJob({ commandType, instruction })
        └─► EventBus.emit("job.dispatched", { jobId, command })
```

### 3d. Quinn message (Phase 1 — observation only)

```
missionControl.ts route  (unchanged — handles real conversation)
  └─► converseAsChief(ctx)  ← existing pipeline untouched

  [in parallel, future Phase 2]:
caller
  └─► QuinnOrchestrator.respond(founderId, message, execId)
        ├─► EventBus.emit("quinn.message_received")
        ├─► classifyIntent(message)   → QuinnIntent (rule-based)
        ├─► [Phase 1 stub reply]
        └─► EventBus.emit("quinn.response_sent", { intentKind, actions })
```

### 3e. OS health check

```
GET /api/mc/os/status  (add in Phase 2)
  └─► getOSLayerStatus()
        ├─► EventBus.subscriptionCount
        ├─► StateEngine.keyCount
        ├─► ExecutiveRegistry.size + capableRoles
        ├─► SpecialistProviderRegistry.size
        └─► ExecutionProviderRegistry.available().map(p => p.id)
```

---

## 4. Well-Known State Keys

| Key | Type | Description |
|-----|------|-------------|
| `os.objectives.active_count` | `number` | In-progress objectives |
| `os.autonomy.last_cycle_at` | `string` (ISO) | Last autonomy cycle timestamp |
| `os.agent_zero.healthy` | `boolean` | Worker health from `getWorkerHealth()` |
| `os.approvals.pending_count` | `number` | Pending founder approvals |
| `os.init_at` | `string` (ISO) | When `initOSLayer()` last ran |

---

## 5. Phase 2 Migration Notes

### What Phase 2 must NOT change

- `EventBus`, `StateEngine`, `types.ts` — these are stable contracts.
- `ExecutiveRegistry`, `SpecialistProviderRegistry` — read-only facades, stable.
- `AgentZeroProvider` — only update if `createAgentZeroJob` signature changes.
- The `index.ts` public API surface (`initOSLayer`, `getOSLayerStatus`, all re-exports).

### What Phase 2 WILL change

1. **QuinnOrchestrator.respond()** — Remove the stub. Build a `ConversationContext` from the provided `founderId`/`execId` (querying DB for history, active objectives, pending approvals). Call `converseAsChief(ctx)`. Execute `response.actions` via `ExecutionProviderRegistry`.

2. **QuinnOrchestrator.classifyIntent()** — Replace the regex loop with a `completeWithFallback({ task: "conversation", modelHint: "fast", ... })` call. Keep the regex loop as the deterministic fallback when `fromFallback === true`.

3. **Additional execution providers** — Register alongside `AgentZeroProvider` in `initOSLayer()`.

4. **`/api/mc/os/status` route** — Add to `missionControl.ts` calling `getOSLayerStatus()`.

5. **Mission Control UI panel** — A new "OS Status" card in the Overview page using `getOSLayerStatus`.

### Migration sequence

```
Phase 1 (done)
  └─► OS layer compiles, EventBus/StateEngine/registries live alongside existing code.
      No existing routes or services are modified.

Phase 2a — Wire QuinnOrchestrator into the quinn/converse route
  └─► missionControl.ts: emit events to QuinnOrchestrator AFTER converseAsChief() returns.
      QuinnOrchestrator.respond() still returns the stub — callers ignore it.

Phase 2b — QuinnOrchestrator classifies intent (AI call)
  └─► When classifyIntent() returns kind="command", dispatch via ExecutionProviderRegistry.
      converseAsChief() still runs for the reply text.

Phase 2c — Full autonomous routing
  └─► QuinnOrchestrator.respond() constructs the ConversationContext and calls
      converseAsChief() directly. The missionControl route delegates here instead.
      ObjectiveManager.create() and ExecutionProviderRegistry.dispatch() replace
      the inline mutations in the route.
```

---

## 6. Files Added (Phase 1)

| File | LOC | Purpose |
|------|-----|---------|
| `os/types.ts` | ~200 | All shared type contracts — EventBus, StateEngine, Objectives, Executives, Specialists, Execution providers, Quinn |
| `os/EventBus.ts` | ~90 | In-process pub/sub, async handlers, wildcard support, singleton |
| `os/StateEngine.ts` | ~120 | Observable key-value store, well-known keys, singleton |
| `os/ObjectiveManager.ts` | ~200 | Objective CRUD facade over `agentObjectivesTable`, event emission |
| `os/ExecutiveRegistry.ts` | ~120 | Typed executive descriptors, DB + static merge, lazy load |
| `os/SpecialistProviderRegistry.ts` | ~90 | Typed specialist descriptors, trigger matching, search |
| `os/ExecutionProviderRegistry.ts` | ~130 | Provider registry, capability routing, dispatch |
| `os/providers/AgentZeroProvider.ts` | ~95 | `ExecutionProvider` adapter for `agentZero.createAgentZeroJob` |
| `os/QuinnOrchestrator.ts` | ~130 | Intent classifier (rule-based), Phase 2 seams documented |
| `os/index.ts` | ~110 | Public barrel, `initOSLayer`, `shutdownOSLayer`, `getOSLayerStatus` |
| **Total** | **~1285** | |

## 7. Files Modified (Phase 1)

**None.** Zero modifications to existing files. The OS layer is purely additive.

---

## 8. Invariants (must hold across all future phases)

1. **No existing service imports from `os/`** until Phase 2a explicitly wires the missionControl route.
2. **EventBus handlers must never throw** — errors are caught and logged by the bus.
3. **StateEngine is not DB-persisted** — it resets on process restart. Do not treat it as a source of truth.
4. **ExecutionProviderRegistry.dispatch() never throws** — it returns a `DispatchResult` with `status: "rejected"`.
5. **ObjectiveManager only touches `agentObjectivesTable`** — all other business logic stays in existing services.
6. **QuinnOrchestrator.respond() must never break callers** even when the stub is replaced — the return type is `Promise<QuinnResponse>` and must always resolve.
