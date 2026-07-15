---
name: ReadyLoq scalability & concurrency risk register
description: Durable, non-obvious architecture gaps to respect/fix before scaling — inconsistencies vs. patterns already used elsewhere in the codebase
---

# Durable architecture gaps (from a senior review)

These are the non-obvious ones — where a hot path is inconsistent with a safer
pattern ALREADY used elsewhere in the same codebase, so "just copy the existing
pattern" is the fix.

- **Pool is untuned + analyze is long & synchronous → early connection-exhaustion ceiling.**
  `lib/db/src/index.ts` creates `new Pool({ connectionString })` with NO `max`
  (pg default = 10), no idle/connection/statement timeout. Meanwhile `/analysis/analyze`
  runs up to 40 vision calls **sequentially** in a `for` loop (30–60s+) holding the
  request. Under modest concurrency these two combine into connection starvation and
  gateway-timeout risk long before CPU/AI limits. Tune the pool AND bound/queue analyze.

- **analyze has NO per-inspection lock, but branding first-seed DOES.**
  Branding's first-profile seed serializes with a Postgres advisory lock keyed by
  companyId (see readyloq-architecture White Label note). `/analysis/analyze` does
  read-previousRun → analyze → INSERT new `analysis_results` row with no txn/lock, so
  two concurrent runs for the same inspection double-spend AI and write competing
  "latest" rows (tie-broken only by createdAt). Reuse the same advisory-lock pattern,
  keyed by inspectionId. **Why:** mobile single-flight (syncingIds) only guards one
  device; web+mobile / retries / two devices still collide.

- **Server media registration idempotency — FIXED.**
  `POST /inspections/:id/media` now checks for an existing row with `(inspectionId, url)`
  before inserting and returns the existing row (HTTP 200) on retry. This prevents
  duplicate `inspection_media` rows when syncOne is interrupted between upload and
  mediaRowId write. No schema migration needed (SELECT-first approach).

- **Whole-company SELECT * + missing indexes on the hot read paths.**
  `loadPriorVisits` (now on 3 routes) and `properties buildSummaries` load ALL company
  rows then filter/group in JS; `GET /inspections` is N+1 (one media query per row).
  No indexes defined on `analysis_results(companyId,inspectionId,createdAt)`,
  `inspection_media(companyId,inspectionId)`, or an addressKey column. These degrade
  per-tenant linearly/superlinearly. Filter in SQL, add the indexes, paginate.

- **Full-res images flow end-to-end.** Native capture is quality 0.6 but not
  dimension-capped; ImagePicker imports at quality 1. Same full-res bytes are uploaded,
  base64-encoded for the vision model, AND fetched by the client-main-thread
  `@react-pdf/renderer`. A single resized variant (~1600px long edge) cuts AI
  token/latency/cost, upload battery/bandwidth, and PDF memory all at once.

**How to apply:** treat the first three as pre-scale P0s; they are cheap because the
safe pattern already exists in-repo. The last two are the main throughput/cost levers.
