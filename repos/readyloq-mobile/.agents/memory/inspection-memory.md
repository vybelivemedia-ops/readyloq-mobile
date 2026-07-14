---
name: Inspection Memory feature
description: Durable honesty + scoping rules for the prior-visit "Inspection Memory" comparison feature
---

# Inspection Memory (prior-visit comparison)

During a live inspection ReadyLoq compares the current visit against PREVIOUS visits
at the same address (same company): it SHOWS prior pest activity, bait/monitoring
references, entry points, recommendations, treatments, and HIGHLIGHTS gaps that feed
the Live Guidance Engine as memory-driven "next tasks".

## Non-negotiable honesty rules (do not regress)
- **Null-zone priors feed SHOW lists but MUST NEVER produce a gap highlight.**
  **Why:** a highlight asserts "you didn't inspect area X today"; if the prior record
  had no zone, we cannot truthfully claim which area was skipped. A unit test pins this.
  **How to apply:** any new highlight type must be gated on a non-null `zone`.
- **No fabricated station/enumeration numbers.** Remembered text is shown verbatim from
  prior findings/notes. Tests assert output never matches `/station #\d/i`. Never
  synthesize identifiers the prior visit didn't record.
- **Strict tenant + address scoping.** Prior visits are matched by company AND the same
  normalized address key, current inspection excluded, strictly-earlier createdAt only.
  A dedicated two-company same-address test guards against cross-tenant leakage.

## Guidance integration
- Memory gaps map to guidance categories `memory_rodent` (p4) / `memory_bait` (p6) /
  `memory_activity` (p8) — all outrank generic tasks (lowest generic priority is 10),
  so a memory gap becomes the top "next task" when present.
- Passing null/[]/omitted memory to the guidance engine is byte-identical to baseline,
  keeping non-memory code paths unchanged.

## Old-client safety
- `memory` is optional/non-required in the OpenAPI schema and guidance `category` is a
  free string (no enum) in generated clients, so old mobile builds ignore new
  `memory_*` categories and fall back to a compass icon instead of crashing.

## Known looseness (non-blocking)
- The bait/monitoring keyword match (`/bait|station|trap|monitor/`) is broad — a prior
  "monitor moisture" note can surface under the bait/monitoring SHOW row. Labeling
  looseness only; text stays verbatim so it's never a fabrication.
- `loadPriorVisits` loads all company inspections and filters address in JS (O(company
  inspections) on three hot routes). Fine at beta scale; move the address filter into
  SQL when inspection volume grows.
