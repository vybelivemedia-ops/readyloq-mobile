---
name: AnalysisResult response shape — derive-on-read fields
description: Convention for adding computed summary fields (like evidence tally) to the analysis API response.
---

# Derive-on-read fields on AnalysisResult

When a summary/aggregate can be computed purely from data already on the analysis
row (its `findings` + `videoEvidence`), derive it inside `serializeResult` in the
analysis route rather than persisting a new DB column. `serializeResult` backs
every analysis response path (list, POST /analysis, POST /analysis/analyze,
GET /:id, feedback), so a derived field rides all of them and can never go stale.

**Why:** a persisted column would need backfill + write-path plumbing and could
drift from the findings it summarizes; deriving on read is O(findings) and always
consistent. This is how the live "evidence tally" (pests/structural/moisture/
exclusion counts) is produced without any schema/migration change.

**How to apply:**
- New computed field goes in `AnalysisResult` in openapi.yaml but is left OUT of
  `required`, so older vendored clients (mobile + web) that predate it still
  validate. Re-run api-spec codegen and re-vendor both clients.
- The compute helper must be defensive against malformed/non-string values (the
  POST /analysis body is loosely typed) and return a zeroed object, never null.
- Group/aggregate totals are independent — a single finding may count toward
  several groups; never sum group totals into an overall count. Track the true
  distinct total separately (findings + videos).

## Fields deriving on read here
- `evidence` (evidence tally) — from findings + videoEvidence.
- `guidance` (Live Guidance Engine) — the single highest-priority NEXT inspection
  task, from `coverage` + `findings` + `analyzedImagePaths`. Prospective
  ("go inspect X next"), distinct from the persisted `recommendations` column
  (retrospective corrective actions from finding.treatment). Priorities are fixed
  per zone/category so the surfaced next-task is deterministic and never flickers
  across live re-runs. Bait-station guidance keys on rodent species keywords (no
  enumerated station entity exists — do NOT fabricate "station #N"); the
  thin-documentation prompt keys on analyzed-photo count, NOT finding count, so a
  genuinely clean property isn't nagged.
