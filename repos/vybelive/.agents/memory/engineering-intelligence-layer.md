---
name: Engineering Intelligence Layer (Mission Control V10)
description: Provider-abstracted single-source-of-engineering-truth snapshot design and its consumption invariants.
---

# Engineering Intelligence Layer (V10 — portfolio-aware)

A reusable, provider-abstracted service that produces ONE deterministic
Engineering Snapshot PER PRODUCT. It is the single source of engineering truth
for Mission Control across the whole product portfolio.

## Core invariants (do not violate)
- **Snapshots belong to a product.** Products are `portfolioAssetsTable` rows
  (vybe-live = live, readyloq = placeholder). Every snapshot carries productId.
- **Providers are registered PER PRODUCT.** A `PROVIDER_REGISTRY` keyed by product
  slug maps each product to its providers (vybe-live → [github, replit]). Adding a
  product or provider is registration-only — never call a provider directly from a
  route, executive, briefing, or Quinn, and never hardcode a flat provider list.
- **Executives/Quinn consume ONLY the snapshot.** Role-scoped via
  `getExecutiveView(role)`; Quinn reasons only from the snapshot in the autonomy pass.
- **Graceful degradation is mandatory.** A product with no registered providers
  (placeholder) must still return a well-formed snapshot with all fields at
  known-safe defaults and `launchReadiness.state = "unknown"` (factors all unknown,
  score 0). Collection uses `Promise.allSettled`; persistence failure is non-fatal.

## Snapshot lifecycle
- TTL reuse + in-flight coalescing keyed BY productId so concurrent callers for the
  same product share one collection; different products collect independently.
- Per-product queries take a productId: `getLatestSnapshot(product)`,
  `getPreviousSnapshot(productId)`, `getSnapshotHistory(productId)`. A flagship
  helper (`getFlagshipSnapshot`/`getFlagshipProduct`) resolves the default product.
- Change detection: `detectEngineeringEvents(prev, curr)` → typed Engineering
  Events (build_failed, deployment_*, production_*, runtime_errors_*,
  new_pull_request, critical_issue_opened) persisted to engineeringEventsTable.
- **Launch Readiness** (0–100, top-level exec metric): weighted over KNOWN factors
  only; null/unknown factors are excluded from the weighted average, never counted
  as 0. Portfolio aggregate averages only MONITORED products.

## Route product-resolution contract
- Product-scoped routes accept `?productId=`; when absent they fall back to the
  flagship product. Resolve via `getProductById` (returns null) and return 404 on
  an unknown id — applies to snapshot, history, events, AND diagnostics.
- **Diagnostics must be product-aware** too (`getDiagnostics(product?)`). The
  frontend passes the selected productId to the diagnostics hook so confidence/
  providers/health reflect the selected product, not always flagship.

## Orval / OpenAPI gotcha (cost a codegen failure)
- An operation that has BOTH a path param AND a query param makes orval's zod
  generator emit `<OpId>Params` (path) which COLLIDES with the types generator's
  `<OpId>Params` (query) in the barrel (TS2308 "already exported"). Query-only or
  path-only operations are fine (zod uses `<OpId>QueryParams`). Fix: don't add a
  query param to a path-param operation unless a typed client needs it. The
  executive-view route (`:role` path) is intentionally flagship-only for this
  reason — no client consumes it with product scope.

## Other gotchas
- **`engineeringConfidence` is 0–100**, computed `(connected/total)*100`; the API
  returns it already scaled — UI displays `${Math.round(x)}%`, never ×100 again.
- `devCheckEngineering` returns an `EngineeringSnapshotView`, not `DevToolResult` —
  needs its own card/state, not DevTools' typed `mutations` map.
- MC router is unauthenticated by convention; all engineering endpoints follow it.
- Dev server runs stale route code until the api-server workflow is restarted —
  restart after adding/changing routes before curling.
