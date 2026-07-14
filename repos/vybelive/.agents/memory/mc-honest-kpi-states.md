---
name: Mission Control honest KPI / panel states
description: How MC dashboards must present optional-query data so failures never masquerade as real telemetry
---

MC has a HARD CONSTRAINT (spans Phase 1–3): no placeholder/fake data, and every
data surface must show honest loading / empty / error states.

**Rule:** any KPI or panel whose value comes from an optional React Query result
must distinguish three states, not two:
- loading (data === undefined && !isError) → skeleton / "Loading…"
- error (isError) → render "—" + "Unavailable" (neutral muted color), NEVER a
  zero-value fallback like `data?.length ?? 0`
- loaded → the real value, including a genuine zero ("All clear", "No usage logged")

**Why:** `?? 0` / `?? []` fallbacks make a failed fetch look like real zero-state
telemetry (e.g. "0 blockers", "No objectives"), which is exactly the dishonest
state the constraint forbids. The architect review failed Phase 1 the first pass
for this.

**How to apply:** capture `isError` (and `isLoading`/`isFetching` where needed)
from each query, and branch value/subtext/color on error before the zero case.
For search-style palettes, also gate any "send as command" / Enter action on
`isFetching` so early typing during load doesn't mis-route intent to Quinn.
