# Mission Control — Full Architecture Reference

_Last updated: 2026-07-13 | Covers Phases 1–10_

---

## Table of Contents

1. [Overview](#overview)
2. [Layered Architecture](#layered-architecture)
3. [Phase History](#phase-history)
4. [OS Layer — Core Components](#os-layer--core-components)
5. [Execution Layer — Agent Zero](#execution-layer--agent-zero)
6. [Intelligence Layer — AI & Specialists](#intelligence-layer--ai--specialists)
7. [Learning Layer — Phase 10](#learning-layer--phase-10)
8. [Autonomy Loop](#autonomy-loop)
9. [UI Layer — Mission Control Web](#ui-layer--mission-control-web)
10. [Data Model Summary](#data-model-summary)
11. [Security & Auth](#security--auth)
12. [SSE & Real-time](#sse--real-time)
13. [Deployment Events](#deployment-events)
14. [Gotchas & Hard Rules](#gotchas--hard-rules)

---

## Overview

Mission Control is VYBE LIVE's internal AI operating system — a dark-mode web app that acts as a living headquarters for a team of AI executives managing the entire business. It is separate from the product (the mobile/web app) but shares the same API server (`artifacts/api-server`).

Key properties:
- **No external auth**: The MC router is mounted under `/api` with no authentication — access is admin-only by deployment constraint, not by code-level token checks.
- **Autonomous**: A background scheduler drives Quinn's Chief-of-Staff cycle every 5 minutes, which in turn auto-dispatches Agent Zero jobs for uncovered objectives.
- **Contract-first**: All MC endpoints are in the OpenAPI spec; the generated hooks in `@workspace/api-client-react` are used in every MC page.
- **Dark-only UI**: MC inherits the platform-wide dark palette.

---

## Layered Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  UI Layer (React + Vite, artifacts/mission-control)              │
│  Pages: CommandCenter, Objectives, Operations, Briefing,         │
│         Learning, AI-Intelligence, Portfolio, Timeline, …        │
├──────────────────────────────────────────────────────────────────┤
│  API Layer (Express, artifacts/api-server/src/routes)            │
│  missionControl.ts  ~6400 lines, unauth MC router                │
├──────────────────────────────────────────────────────────────────┤
│  OS Layer (services/os/)                                         │
│  Quinn CoS · EventBus · ExecutiveRegistry · ObjectiveStateStore  │
│  ExecutionProviderRegistry · ExecutiveEventBridge                │
├──────────────────────────────────────────────────────────────────┤
│  Execution Layer (services/agentZero.ts)                         │
│  Job queue · Step executor · Workspace-op provider               │
├──────────────────────────────────────────────────────────────────┤
│  Intelligence Layer (services/ai/ + specialistRegistry.ts)       │
│  AIProviderFactory · OpenAI / Anthropic / Google · Specialists   │
├──────────────────────────────────────────────────────────────────┤
│  Learning Layer (Phase 10)                                       │
│  providerReliability · deploymentEvents · specialistPerformance  │
├──────────────────────────────────────────────────────────────────┤
│  Data Layer (PostgreSQL via Drizzle ORM, lib/db)                 │
└──────────────────────────────────────────────────────────────────┘
```

---

## Phase History

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | Exec reports + activity feed | ✅ |
| 2 | Objective system + founder decisions | ✅ |
| 3 | Agent Zero job queue + step executor | ✅ |
| 4 | Quinn Chief-of-Staff CoS cycle | ✅ |
| 5 | Specialist registry + consultSpecialist | ✅ |
| 6 | Objective↔AZ wiring, SSE, CoS auto-dispatch | ✅ |
| 7 | ReplitProvider + workspace_op step kinds | ✅ |
| 8 | Autonomy scheduler + processObjectives | ✅ |
| 9 | VHeadquartersV2 redesign | ✅ |
| 10 | Continuous learning DB + services + tracking | ✅ |

---

## OS Layer — Core Components

### Quinn Chief of Staff (`services/os/QuinnChiefOfStaff.ts`)

Quinn is the executive orchestrator. She runs `runCycle()` which:

1. **Prioritize** all active objectives by urgency × impact heuristic.
2. **Auto-assign** unowned objectives to the right executive by domain keywords.
3. **Monitor** stalled objectives (24h without an execution entry).
4. **Balance** executive workload (flag overloaded execs at >4 objectives).
5. **Escalate** critical blockers to the founder via `agentApprovalsTable`.
6. **Emit** EventBus events for every decision.
7. **Auto-dispatch Agent Zero** (Phase 6): for any `in_progress` or `planning` objective without an active AZ job, dispatch one `execute_objective` job. One dispatch per cycle (flood guard).

**Key constraint**: Quinn never writes code, triggers deploys, or self-resolves escalations.

### EventBus (`services/os/EventBus.ts`)

In-memory pub/sub. Events are typed (see `EventMap` in the file). Subscribers are registered by `ExecutiveEventBridge`. Every emitted event is also durably persisted to `os_events` table.

### ExecutionProviderRegistry (`services/os/ExecutionProviderRegistry.ts`)

Registry of `IExecutionProvider` implementations. Currently registered:
- **AgentZeroProvider** (default) — creates Agent Zero jobs in the DB
- **ReplitProvider** (Phase 7) — dispatches `workspace_op` jobs for Replit-native operations (file I/O, test runs, deploy previews)

Quinn dispatches to the registry, not directly to Agent Zero.

### ExecutiveEventBridge (`services/os/ExecutiveEventBridge.ts`)

Maps OS bus events to executive actions. Handles:
- `replit.deploy.published` → CTO notification + persist to `deployment_events`
- `replit.deploy.failed` → CTO notification + persist to `deployment_events`
- `replit.db.migrated` → CTO
- `github.push` → CTO
- `vybe.stream.started/ended` → VP Product
- `vybe.creator.milestone` → Marketing + Product

---

## Execution Layer — Agent Zero

**File**: `services/agentZero.ts`

Agent Zero is the in-process job worker. Key concepts:

### Job Lifecycle

```
QUEUED → RUNNING → (step by step) → COMPLETED
                 ↘ FAILED
                 ↘ PAUSED (waiting_approval)
```

### Command Types

| Command | Description |
|---------|-------------|
| `execute_objective` | Drive an in-progress objective |
| `investigate_engineering_failure` | Engineering failure diagnosis |
| `prepare_release` | Release readiness check |
| `run_specialist_review` | Consult a bench specialist |
| `monitor_deployment` | Portfolio + engineering health |
| `execute_marketing_campaign` | Marketing campaign analysis |
| `research_brand_partnerships` | Partnership research |
| `audit_database` | Read-only DB audit |
| `generate_release_report` | Release status report |
| `workspace_op` | **Phase 7** — Replit workspace operation |
| `custom` | Free-form from Quinn |

### Step Kinds

Standard: `analysis`, `capability`, `specialist`, `engineering_snapshot`, `portfolio_review`, `marketing_analysis`, `db_audit`, `report`

Phase 7 (Replit-native):
`replit_create_workspace`, `replit_clone_repo`, `replit_run_tests`, `replit_stream_logs`, `replit_deploy_preview`, `replit_read_file`, `replit_write_file`, `replit_run_command`, `replit_list_files`

### Objective Execution Entries

When a job completes or fails, `appendObjectiveExecutionEntry()` writes a JSONB entry to `agent_objectives.execution_history`. This gives every objective a durable audit trail of every AZ attempt.

---

## Intelligence Layer — AI & Specialists

### AIProviderFactory (`services/ai/AIProviderFactory.ts`)

`completeWithFallback(request)` implements:
1. Apply persisted provider/model overrides (per-objective or global)
2. Try primary provider with 1 retry
3. Failover across available real providers (promote winner to primary)
4. Fallback to MockProvider (deterministic, never throws)

**Phase 10**: Every successful or failed call records a row in `provider_reliability` via `recordProviderReliability()`. This drives the learning layer's provider health dashboard.

### Specialist Registry (`services/specialistRegistry.ts`)

60+ installed specialist agents. Each specialist has:
- `id` — stable registry key
- `name` / `role` / `collaboratorRoles`
- `triggerKeywords` — for auto-selection
- Prompt template in `.claude/specialists/<id>.md`

`consultSpecialist(opts)` makes one AI call and records the run in `specialist_runs`. Results include `findings[]` and `recommendations[]` with severity tags.

---

## Learning Layer — Phase 10

Three new tables persist longitudinal learning signals:

### `provider_reliability`

Daily-bucketed success/failure/latency counts per `(provider, model, date)`. Written by `AIProviderFactory.recordProviderReliability()` on every completion. Used to bias future provider selection toward reliably fast/cheap options.

### `deployment_events`

One row per artifact deployment. Written by `ExecutiveEventBridge` when `replit.deploy.published` or `replit.deploy.failed` arrives. Tracks artifact, version, SHA, trigger type (`manual | autonomy_loop | agent_zero`), success, duration, and rollback state.

### `specialist_runs` (existing, enhanced)

Existing table tracks every `consultSpecialist` call. Phase 10 adds the `specialistPerformance` service (`services/specialistPerformance.ts`) which aggregates ranked specialist confidence and surfaces the top performers per domain via `getRankedSpecialists(category)`.

---

## Autonomy Loop

The Phase 8 autonomy loop connects all layers:

```
index.ts startup
  └── startAutonomyScheduler(5min)
       └── every 5 min: processObjectives()
            └── QuinnChiefOfStaff.runCycle()
                 ├── Steps 1–6: prioritize, assign, monitor, balance, escalate, emit
                 └── Step 7: autoDispatchAgentZero()
                      └── for each in_progress objective with no active AZ job:
                           └── createAgentZeroJob({ execute_objective })
                                └── AZ worker picks it up on next TICK (10s)
                                     └── executes steps → appendObjectiveExecutionEntry()
```

**Status endpoint**: `GET /api/mission-control/autonomy/loop-status` returns `{ running, intervalMs, startedAt }`.

---

## UI Layer — Mission Control Web

**Location**: `artifacts/mission-control/src/`

### Pages

| Route | Page | Description |
|-------|------|-------------|
| `/` | `CommandCenter` | KPI dashboard + VHeadquartersV2 live HQ |
| `/objectives` | `Objectives` | Create/manage objectives + approvals |
| `/operations` | `Operations` | Agent Zero job queue |
| `/briefing` | `Briefing` | Daily AI-generated briefing |
| `/executives` | `Executives` | Executive team overview |
| `/tasks` | `Tasks` | Task list |
| `/learning` | `Learning` | Exec learning + provider reliability |
| `/ai-intelligence` | `AIIntelligence` | AI usage metrics |
| `/portfolio` | `Portfolio` | Portfolio asset monitoring |
| `/blockers` | `Blockers` | Blocker resolution |
| `/diagnostics` | `Diagnostics` | System health |
| `/timeline` | `Timeline` | Organization timeline |

### VHeadquartersV2 (Phase 9)

The live HQ visualization. Props:
- `executives: ExecDeptData[]` — department executives (non-Quinn)
- `quinn: ExecDeptData | null` — Quinn in the center
- `objectives: VHQObjective[]` — objective flow path
- `agentZero: {...}` — AZ health and counts
- `statusBar: {...}` — KPI summary bar
- `pendingApprovals: number`
- `lastCycleAt?: string | null`
- `loading?: boolean`

Components in `src/components/hq/`:
- `HQStatusBar` — top ribbon with KPIs
- `ExecDeptCard` — individual executive department card
- `QuinnCore` — animated Quinn center node
- `AgentZeroEngine` — AZ job counter + health
- `ObjectiveFlowPath` — SVG flow of objectives
- `VFrame` — structural chrome frame

---

## Data Model Summary

### Core Tables

| Table | Purpose |
|-------|---------|
| `ai_executives` | Executive definitions (name, role, status, prompt) |
| `agent_objectives` | Objectives with priority, status, execution_history JSONB |
| `agent_tasks` | Tasks linked to objectives |
| `agent_approvals` | Founder escalations / decisions |
| `agent_zero_jobs` | AZ job queue with CAS lease tokens |
| `agent_zero_steps` | Individual step records per job |
| `agent_reports` | Executive report outputs |
| `agent_events` | Organization timeline events |
| `specialist_runs` | Every specialist consultation |
| `autonomy_cycles` | Every Quinn CoS cycle run |
| `os_events` | Every EventBus event (durable) |

### Phase 10 Tables

| Table | Purpose |
|-------|---------|
| `deployment_events` | Deployment success/failure history per artifact |
| `provider_reliability` | Daily AI provider call success/latency ledger |

---

## Security & Auth

- **MC router is unauth by design** — all `/api/mission-control/*` routes are mounted without JWT middleware. Access is secured at the deployment/network level.
- **No partial auth on new routes** — match the convention: new MC routes are always unauth.
- **Agent Zero jobs are created server-side** — clients cannot inject arbitrary job payloads.
- **Objective ownership is server-derived** — Quinn assigns executives; the founder cannot spoof ownership via the API.
- **Approval decisions are server-verified** — the approval PATCH route validates the approval row exists and belongs to the system before accepting a founder decision.

---

## SSE & Real-time

Mission Control uses `EventSource` (SSE) for live updates on the CommandCenter and Operations pages. The SSE endpoint is at:

```
GET /api/mission-control/events/stream
```

The server pushes events for:
- `agent_zero.job.updated`
- `objective.updated`
- `quinn.cycle.complete`
- `approval.created`

Clients reconnect automatically with a 3-second backoff.

---

## Deployment Events

The `replit.deploy.*` event flow:

```
Replit deploy webhook / API call
  └── emits on EventBus: "replit.deploy.published" | "replit.deploy.failed"
       └── ExecutiveEventBridge subscribes
            ├── logs to CTO
            └── inserts into deployment_events (best-effort, fire-and-forget)
```

The `deploymentTriggerEnum` has 3 values:
- `manual` — initiated by the founder
- `autonomy_loop` — triggered by the autonomy scheduler
- `agent_zero` — triggered by an Agent Zero workspace_op job

---

## Gotchas & Hard Rules

1. **MC router has no auth** — never add partial auth to individual MC routes; it creates inconsistency. The whole router is unauth by convention.
2. **completeWithFallback returns AIResponse** — `.parsed` is the already-parsed object (not a raw string). Never treat the return value as a string.
3. **appendObjectiveExecutionEntry is fire-and-forget** — it uses `.catch()` and never throws. Callers don't need to await it.
4. **autoDispatchAgentZero dispatches at most 1 job per cycle** — the `break` after the first dispatch is intentional. This prevents flooding the AZ queue when many objectives are uncovered simultaneously.
5. **processObjectives uses dynamic import** — `QuinnChiefOfStaff` is imported dynamically in `autonomyEngine.ts` to avoid circular imports (autonomyEngine → CoS → agentZero → autonomyEngine would be a cycle).
6. **DB schema changes** — after editing `lib/db/src/schema/index.ts`: run `pnpm run typecheck:libs` to rebuild composite libs, then `pnpm --filter @workspace/db run push` to apply to the database.
7. **Orval codegen** — after changing the OpenAPI spec: run `pnpm --filter @workspace/api-spec run codegen`. New hooks are available in `@workspace/api-client-react`.
8. **provider_reliability rows accumulate** — the table stores individual call records (not pre-aggregated). Queries should use `SUM(success_count)` etc. rather than reading a single row per provider.
