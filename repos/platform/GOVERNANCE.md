# Platform Governance

> **Status:** Adopted  
> **Effective:** 2026-07-14  
> **ADR reference:** ADR-011  
> **Scope:** All packages under `platform/packages/`

---

## Mission

> **The platform provides capabilities. Applications define purpose.**

The shared platform must never know what an application is trying to accomplish. It provides building blocks — typed contracts, orchestration machinery, storage patterns, provider abstractions. Applications assemble those blocks and inject domain logic.

If you can look at a piece of code and answer "is this for pest inspection?" or "is this for live streaming?", it does not belong in a shared package.

---

## 1. What Is Allowed in Shared Packages

### Always allowed
- **TypeScript interfaces and type aliases** — the primary output of the platform
- **Generic type parameters** — `SyncEngine<T>`, `VoiceCommandRouter<TAction>`, `WorkflowStep`
- **Abstract constants and enums** that carry no domain meaning — `AI_EVENT_KINDS`, `PLATFORM_EVENT_KINDS`, `AssetType`, `SessionStatus`
- **Structural utility types** — `Omit<T, K>`, `Partial<T>`, pagination cursors
- **Adapter/factory interfaces** — `KVAdapter`, `FileUploader`, `PlatformFactory`
- **Event kind strings** that are infrastructure-only — `ai.provider.fallback`, `platform.session.started`
- **Configuration interfaces** — option bags with no business rules embedded
- **Error base types** — `StorageError`, `SyncError` without domain-specific codes
- **Mathematical/statistical primitives** — `ConfidenceResult`, `GeoCoordinates`, `MeasurementEntry`

### Allowed with care
- **Narrow concrete implementations** that would be impossible to inject: e.g. KV serialisation helpers, retry/backoff algorithms, token-bucket rate limiter math. Must have no domain strings and must be unit-tested independently.
- **Event payloads** — allowed if the fields are generic (`entityType: string`, not `inspectionType: string`).

---

## 2. What Is Forbidden in Shared Packages — Forever

These categories must **never** appear in any file under `platform/packages/`, including comments, string literals, and type names.

### Domain logic
| Category | Examples |
|----------|---------|
| Pest inspection | Pest species, infestation severity, treatment recommendations, finding categories, scorecard rules |
| Live streaming | Stream titles, creator tiers, audience metrics, social engagement rules, RTMP platform policies |
| Mission Control | Executive AI objectives, retrospectives, autonomy engine rules, engineering intelligence |
| Proposals / CRM | Proposal templates, pricing rules, lead scoring, customer segmentation |
| Report templates | PDF layouts, inspection report sections, compliance checklists |

### Application identifiers
- App-specific workflow IDs (e.g. `"pest-inspection"`, `"vybe-live-session"`) — defined in the application, passed as strings
- Company IDs, creator IDs, or any user-space identifier used as a structural type
- Feature flags specific to one product

### AI prompts
- No prompt templates in shared packages — not even as `const` strings
- Prompt construction belongs in the application layer; the platform executes prompts it receives

### Product-specific event kinds
- `inspection.completed`, `stream.started`, `proposal.sent` — these belong in the application's event schema
- Only `ai.*`, `platform.*`, `camera.*`, and `local_ai.*` style namespaces belong in the platform

### Business rules embedded as code
- Pricing logic, eligibility checks, compliance requirements, role-based access rules — all in the application layer

---

## 3. Dependency Rules

### The directed acyclic graph (DAG)

Packages may only import packages that are listed below them in this ordering. No circular dependencies. No upward imports.

```
Level 0 (no deps):
  shared-types

Level 1 (→ shared-types only):
  storage-core
  ai-core
  camera-core
  asset-core
  ui-core

Level 2 (→ Level 0–1):
  evidence-core          → shared-types, storage-core
  sync-engine            → shared-types
                           (storage-core: NOT imported — injected by caller)
  meta-wearables         → camera-core, shared-types
  voice-intelligence     → ai-core, shared-types
  live-session-core      → shared-types, storage-core

Level 3 (→ Level 0–2, three packages at this level; none imports another):
  platform-intelligence  → shared-types, ai-core, camera-core,
                           evidence-core, storage-core, voice-intelligence
  local-intelligence     → shared-types, ai-core, camera-core,
                           storage-core, evidence-core
  measurement-core       → shared-types, camera-core,
                           storage-core, evidence-core

Level 4 (applications — never imported by platform):
  readyloq-mobile        → any platform packages
  vybelive               → any platform packages
```

### Hard rules

1. **No app imports a platform package that imports it back.** The dependency graph is one-way: platform → nothing above Level 3; apps → platform.
2. **camera-core cannot import evidence-core.** The capture pipeline is upstream of the evidence lifecycle pipeline. Evidence depends on captures; captures do not depend on evidence.
3. **sync-engine does NOT import storage-core.** `FileUploader` is injected by the caller to avoid coupling the sync pipeline to a specific storage implementation.
4. **asset-core has no platform dependencies beyond shared-types.** Physical asset data is pure — it should be adoptable by any future tool (CRM, BI, mapping service) with zero transitive baggage.
5. **ai-core does not import camera-core, evidence-core, or live-session-core.** AI infrastructure is orthogonal to all capture pipelines.
6. **platform-intelligence does not import asset-core, sync-engine, meta-wearables, or live-session-core.** The OS kernel is agnostic of domain-specific plugins. Plugins are injected at runtime — not statically imported.
7. **local-intelligence does NOT import platform-intelligence.** local-intelligence is a plugin for the OS kernel, not a consumer of it. The registration is one-way: the application registers `LocalIntelligencePlugin` with `platform-intelligence`; `local-intelligence` itself has no knowledge of the kernel.
8. **measurement-core does NOT import ai-core, local-intelligence, or platform-intelligence.** The inference provider is injected via `MeasurementInferenceProvider` at initialisation. Applications inject a `LocalAIProvider` or cloud provider; measurement-core does not care which.
9. **No shared package imports from `node_modules` of the consuming app.** All runtime dependencies must be declared in the package's own `package.json`.

### How to verify

```bash
# Run from repos/platform/
pnpm -r typecheck

# Check for circular dependencies (after build tooling is added in Phase 1):
pnpm dlx madge --circular --extensions ts packages/
```

---

## 4. Versioning Strategy

### Semantic versioning

All packages follow [semver](https://semver.org/). Until the platform reaches `1.0.0`, all packages are `0.x.y` — minor bumps may include breaking changes.

| Change type | Version bump | ADR required? |
|-------------|-------------|--------------|
| New exported interface or type | `0.x+1.0` | No |
| New optional field on existing interface | `0.x.y+1` | No |
| New required field on existing interface | `0.x+1.0` | Yes |
| Rename exported type | `0.x+1.0` | Yes |
| Remove exported type or field | `0.x+1.0` | Yes |
| Change field type | `0.x+1.0` | Yes |
| Add a new package | `new package @ 0.1.0` | Yes |
| Remove a package | — | Yes |

### Breaking change protocol

1. Author opens a change proposal (comment in the PR with the breaking diff)
2. Both ReadyLoq and VYBE teams acknowledge the migration path
3. A deprecation stub is added alongside the new type (at least one sprint)
4. Both consuming apps are updated in the same PR or the next sprint
5. Deprecation stub is removed once both apps are migrated

### Lockstep updates

Any change that affects a type shared by both apps **must** ship with adapter updates for both apps in the same commit or immediately following sprint. Drift between the shared type and one app's adapter is treated as a P1 bug.

---

## 5. Proposing a New Package

New packages require an ADR before any code is written.

### Proposal checklist

A new package proposal must answer all of these:

- [ ] **Name and one-line description** — what capability does this package provide?
- [ ] **Why does it belong at the platform level?** — i.e. which 2+ products would use it?
- [ ] **Canonical source** — where does the best existing implementation live?
- [ ] **Dependency level** — which level in the DAG does it belong to?
- [ ] **What generalisation is required** before extraction from its canonical source?
- [ ] **What stays in the application?** — explicit list of things that will NOT migrate
- [ ] **Effort estimate** — how many engineer-days to extract and validate?

### ADR process

1. Create `repos/platform/adrs/ADR-NNN-<slug>.md` from the template below
2. Add a one-line entry to `ARCHITECTURE.md` § 11 (ADR list)
3. Get sign-off from both ReadyLoq and VYBE maintainers before creating the package directory

### ADR template

```markdown
# ADR-NNN: <Title>

**Status:** Proposed | Accepted | Superseded  
**Date:** YYYY-MM-DD  
**Supersedes:** ADR-XXX (if applicable)

## Context
What problem are we solving and why now?

## Decision
What are we doing?

## Consequences
What does this enable? What does it constrain?

## Dependency impact
Which level in the platform DAG does this package sit at?
Which existing packages, if any, gain a new dependency?

## What is forbidden in this package
Explicit list of domain concepts that must never appear here.
```

---

## 6. Anti-Corruption Layer (ACL)

Each application wraps platform types in domain types at the application boundary. This prevents platform renames from cascading through application code.

### ReadyLoq example

```typescript
// In readyloq-app/lib/domain/types.ts — NOT in any platform package:
import type { AssetRecord, AssetType } from "@platform/asset-core";

export interface InspectionSite extends AssetRecord {
  // ReadyLoq-specific fields:
  lastInspectedAt?: string;
  pestRiskProfile: "low" | "medium" | "high";
  treatmentHistory: TreatmentRecord[];
}

// AssetType is re-exported with a ReadyLoq alias:
export type PropertyCategory = AssetType; // local alias — survives platform renames
```

### VYBE example

```typescript
// In vybelive/lib/domain/types.ts — NOT in any platform package:
import type { AssetRecord } from "@platform/asset-core";
import type { IntelligenceSession } from "@platform/platform-intelligence";

export interface StreamVenue extends AssetRecord {
  capacity?: number;
  streamingPermitted: boolean;
}

export interface LiveStreamSession extends IntelligenceSession {
  // VYBE adds domain fields in this wrapper
  streamId: string;
  viewerPeak: number;
}
```

**Rule:** Platform type names should never appear in application UI strings, API response schemas, or DB column names. The ACL is the translation point.

---

## 7. Governance Enforcement

### Automated checks (implement in Phase 1)

Add these to CI for the `platform/` repo:

```bash
# 1. Circular dependency check
pnpm dlx madge --circular --extensions ts packages/

# 2. Forbidden domain string scan (run from packages/)
# Flags any occurrence of known domain terms in platform code:
grep -r --include="*.ts" \
  -e "pest\|infestation\|inspection\|treatment\|scorecard\|proposal\|stream\|creator\|viewer\|mission.control\|autonomy" \
  packages/ --exclude-dir=node_modules

# 3. Typecheck all packages
pnpm -r typecheck
```

### Code review checklist

Every PR that modifies a shared package must check:

- [ ] No domain strings or business logic added
- [ ] No new circular dependency introduced
- [ ] If a type is renamed or removed: deprecation stub added, migration path documented
- [ ] All new exported types have JSDoc comments
- [ ] Canonical source documented in file header if new file added
- [ ] If a new package: ADR written and signed off

### Ownership

| Package | Primary owner | Secondary owner |
|---------|--------------|----------------|
| shared-types | Both (requires joint sign-off for breaking changes) | — |
| camera-core | ReadyLoq | — |
| storage-core | Both | — |
| sync-engine | ReadyLoq | — |
| evidence-core | ReadyLoq | VYBE |
| asset-core | ReadyLoq | VYBE |
| ai-core | VYBE | ReadyLoq |
| platform-intelligence | Both | — |
| local-intelligence | Both | — |
| measurement-core | ReadyLoq | VYBE |
| live-session-core | VYBE | — |
| meta-wearables | ReadyLoq | — |
| voice-intelligence | Both | — |
| ui-core | Both | — |

Primary owner approves all changes to their packages. Breaking changes require secondary owner sign-off too.

---

## 8. The Boundary — Canonical Statement

The following will **never** enter a shared platform package, regardless of how useful it seems at the time:

**ReadyLoq stays in ReadyLoq:**
- Pest intelligence, species recognition, infestation scoring
- AI guidance rules for pest treatment
- Inspection memory implementation (what was found, where, when)
- Property/asset business rules (pricing by square footage, pest risk by building age)
- Proposal engine, CRM, lead management
- Report templates (PDF layouts, compliance language)

**VYBE stays in VYBE:**
- Mission Control — executive AI, autonomy engine, agent scheduling
- Social publishing — platform-specific RTMP logic, audience policies
- Creator analytics — subscriber tiers, revenue splits, monetization
- Audience intelligence — demographic targeting, engagement scoring
- Streaming business logic — visibility rules, moderation, content policies

**The test:** If deleting a piece of code from a platform package would break only one application, it belongs in that application.
