# ADR-015: Introduce @platform/core — Universal Programming-Model Primitives

**Status:** Accepted  
**Date:** 2026-07-14  
**Deciders:** Platform architecture review  
**References:** ADR-001 (shared-types scope), ADR-013 (local-intelligence separation), ADR-014 (measurement-core separation)

---

## Context

The 14-package scaffolding revealed a gap: every package that needs to express a common programming-model concept (success/failure, plugin lifecycle, typed pub/sub, feature toggles) has two choices:

1. **Re-invent**: define `type Result<T,E>` locally — creates N incompatible definitions
2. **Reach upward**: import from a higher-level package — creates an inversion violation

Neither is acceptable. This is the classic "base library" problem: a layer that sits below all domain packages, defines no business logic, and is never a source of migration risk.

`@platform/shared-types` is not the right home. `shared-types` carries domain concepts (EvidenceItem, OSEvent, AIRequest) that are specific to the two current products. The programming-model primitives must have zero domain coupling so they can be used by any future product without inheriting domain semantics.

---

## Decision

Introduce a new package, `@platform/core`, as the lowest node in the platform DAG.

### Rules

1. **Zero external dependencies.** `@platform/core` has no `dependencies` in `package.json` — not even other `@platform/*` packages. It is self-contained.
2. **No domain types.** No "inspection", "evidence", "stream", "pest", "clip", "creator", "property", or any other business-domain string may appear in type names, JSDoc, or comments in `src/index.ts`.
3. **Purely structural.** All exports are `interface`, `type`, or `const` enum-equivalent. No class implementations. No runtime logic beyond a brand helper type.
4. **Stable API contract.** Adding exports is always backward-compatible. Changing or removing exports is a breaking change requiring a semver bump and migration notes in this ADR.

### Exports

| Export | Kind | Purpose |
|--------|------|---------|
| `Result<T, E>` | type | Discriminated union for success/failure without exceptions |
| `AsyncResult<T, E>` | type | `Promise<Result<T, E>>` alias |
| `Option<T>` | type | Explicit presence/absence (avoids `null` / `undefined` ambiguity) |
| `Disposable` | interface | Synchronous cleanup contract |
| `AsyncDisposable` | interface | Async cleanup contract (init-heavy services) |
| `Plugin<TConfig>` | interface | Lifecycle-aware extension point with typed config |
| `Service` | interface | Stateful long-running component with start/stop |
| `LifecycleState` | type | `created \| initializing \| running \| stopping \| stopped \| error` |
| `Lifecycle` | interface | Observable lifecycle state change notification |
| `Registry<T>` | interface | Typed key-value store for named components |
| `Event<TKind, TPayload>` | interface | Generic typed event with correlation support |
| `EventHandler<TEvent>` | type | Handler function signature |
| `EventSubscription` | interface | Disposable subscription handle |
| `Command<TKind, TPayload>` | interface | CQRS write operation |
| `Query<TKind, TParams, TResult>` | interface | CQRS read operation returning `AsyncResult` |
| `Capability<TName>` | interface | Named platform capability with availability flag |
| `FeatureFlag<TName>` | interface | Context-aware feature toggle |
| `FeatureFlagRegistry` | interface | Registry + typed flag lookup |
| `Provider<TConfig>` | interface | Configurable, disposable external adapter |
| `PipelineStep<TInput, TOutput>` | interface | Single step with `AsyncResult` output |
| `PipelineContext` | interface | Shared run context with cancellation |
| `Pipeline<TInput, TOutput>` | interface | Ordered step executor |
| `Observable<T>` | interface | Push-based data source |
| `Observer<T>` | interface | Subscriber with `next/error/complete` |
| `Brand<T, B>` | type | Nominal typing helper |
| `ID<T>` | type | Branded string for typed identifiers |
| `Timestamp` | type | Branded number for epoch milliseconds |
| `Version` | type | Branded string for semver strings |

---

## Updated DAG

```
         @platform/core   (L0 — no deps)
                │
                ▼
         @platform/shared-types   (L1 — extends core primitives)
                │
     ┌──────────┼──────────────────┐─────────────────┐
     ▼          ▼                  ▼                  ▼
storage-core  camera-core       ai-core          sync-engine
  asset-core    ui-core
     │          │                  │
     └────┬─────┘                  └──────┐
          ▼                               ▼
      evidence-core               voice-intelligence
      meta-wearables              live-session-core
      measurement-core (inject)
          │                               │
          └──────────────┬────────────────┘
                         ▼
              platform-intelligence
              local-intelligence
                         │
              ┌──────────┼────────────┐
              ▼          ▼            ▼
           ReadyLoq    VYBE    Mission Control
```

---

## Consequences

### Positive

- **Eliminates N-definition problem.** Every package that needs `Result<T,E>` imports from `@platform/core`. One definition, enforced.
- **Zero migration risk.** `@platform/core` has no extraction source — it is entirely new code. It can be scaffolded and typechecked before any app code is touched.
- **Future-proofs CQRS pattern.** `Command` and `Query` interfaces are the foundation for the `PlatformOS.workflows` system in `@platform/platform-intelligence` without requiring platform-intelligence to define them itself.
- **Makes feature flags first-class.** `FeatureFlag` + `FeatureFlagRegistry` as a core primitive means every package can express capability gates consistently — no ad-hoc `if (process.env.FEATURE_X)` scattered through platform code.

### Negative / Trade-offs

- **Adds one more package to maintain.** Given its zero-dep, no-domain-logic contract, this package should be extremely stable. API changes should be extremely rare.
- **All existing packages must add `@platform/core` to their `package.json` and `tsconfig.json`.** This is a mechanical, low-risk change. Done as Phase 0 pre-migration prep.

### Migration order impact

`@platform/core` becomes **Phase 0** (immediately before Phase 1):

```
Phase 0:  @platform/core                          (zero deps, scaffold only)
Phase 1:  @platform/shared-types                  (extends core primitives)
Phase 2:  storage-core ‖ camera-core ‖ sync-engine ‖ asset-core ‖ ai-core ‖ ui-core
Phase 3:  evidence-core ‖ meta-wearables
Phase 4:  voice-intelligence ‖ live-session-core ‖ measurement-core
Phase 5:  platform-intelligence ‖ local-intelligence
```

---

## Architectural Invariants for @platform/core

These invariants must be enforced by CI lint:

```
# No domain strings in @platform/core
grep -rn "inspection\|evidence\|stream\|pest\|clip\|creator\|property\|agora" \
  packages/core/src/ && exit 1 || exit 0

# No @platform/* imports
grep -n "from.*@platform/" packages/core/src/index.ts && exit 1 || exit 0

# No npm package imports
grep -n '^import.*from "' packages/core/src/index.ts | grep -v '"\./' && exit 1 || exit 0
```
