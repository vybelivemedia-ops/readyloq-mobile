---
name: Company Playbooks & Learning Engine
description: Architecture and gotchas for the playbook compliance system added to ReadyLoq.
---

## What was built

- `lib/db/src/schema/playbooks.ts` — `companyPlaybooksTable` (integer companyId FK, JSONB targetPests/requiredSteps/chemicalRestrictions)
- `artifacts/api-server/src/lib/playbook-compliance.ts` — pure `evaluatePlaybookCompliance(findings, productNames, playbooks)` function; matches via `finding.category` / `finding.species` (not a `pestType` field — Finding has no such field)
- `artifacts/api-server/src/routes/playbooks.ts` — GET /active, GET /compliance?inspectionId=, GET /, POST /, PUT /:id, DELETE /:id
- Mounted at `/playbooks` in routes/index.ts (auth + company + beta; owner-only mutations enforced inside router)
- `artifacts/readyloq-app/app/(app)/playbooks.tsx` — owner management screen (create/edit/deactivate); linked from Settings
- Compliance banner added to inspection-summary/[localId].tsx — fires after finalization

## Key decisions

**Finding has no `pestType` or `actionsTaken`** — compliance pest-matching uses `finding.category` and `finding.species`; required-step matching uses `finding.treatment` text (substring match).

**Chemical check** uses treatment_log product names (joined from `products` table), not finding text.

**drizzle-zod `.extend()` version mismatch** — `drizzle-zod@0.8.3` uses Zod v4 internally but workspace `zod@3.25.76` (imported as `zod/v4`) produces incompatible types when calling `.extend()`. Pattern used across this project: `createInsertSchema(table).omit({...})` only — no `.extend()`. Define complex JSONB validation schemas manually in the route file using `import { z } from "zod/v4"`.

**DB table created manually** — ran `CREATE TABLE IF NOT EXISTS company_playbooks (...)` via pg node client since there is no drizzle-kit migration runner wired up. Do the same for any future tables.

**`Button` size prop** — only accepts `"md" | "lg"`, not `"sm"`.
