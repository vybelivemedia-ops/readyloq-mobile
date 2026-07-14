---
name: Mission Control executive capabilities
description: How the 6 AI executives + Chief of Staff produce real grounded reports/briefings in Mission Control
---

# Mission Control executive capabilities

Each AI executive inspects REAL workspace data and emits a structured `ExecutiveReport {status, headline, summary, metrics[], findings[]}`. The Chief of Staff (`chief_of_staff` role) has NO inspectable capability — it only aggregates the other six's latest reports.

**Capability registry**: `services/executiveCapabilities/index.ts` exports `runCapability(role)`, `ROLES_WITH_CAPABILITY` (the six, excluding chief_of_staff), and `aggregateChiefOfStaff()`. `chief_of_staff` is intentionally excluded from `ROLES_WITH_CAPABILITY`; `POST /report` returns 422 for it.

**Briefing aggregation rule**: a briefing built on missing data must NEVER read as `healthy`.
**Why:** `worst([])` returns `healthy`, so an all-failed refresh would falsely show a green daily briefing the founder trusts.
**How to apply:** in `aggregateChiefOfStaff`, 0 reports → `critical`; some missing → at least `attention`. `/briefing/refresh` falls back to each exec's latest persisted report on capability failure, and returns HTTP 503 (all fail) / 207 (partial) / 201 (full success).

**Frontend**: shared `ReportView` component renders any report (per-exec or aggregated briefing). `useGetExecutiveReport` returns `ExecutiveReportResult {responsibility, resources, report}` (unwrap `.report`); `useGetBriefing` returns `BriefingResult {briefing}`. Always use wouter `<Link>` not raw `<a href>` — the router has a BASE_URL base path.

## Production seeding (fresh prod DB is empty)
A published app uses a SEPARATE production database; the dev seed CLI never touches it and agent prod DB access is read-only, so a freshly published app can show empty/unseeded internal data.
**Why:** seeding scripts run against dev's DATABASE_URL only; production cannot be seeded out-of-band.
**How to apply:** seed baseline internal data on server startup, gated on emptiness so it never overwrites real data, and serialize concurrent boots with a Postgres advisory lock (transaction-scoped) so two instances can't both run a destructive reseed. Keep any destructive full-reseed CLI behind an explicit opt-in (env flag) so importing the seed module into the server bundle can't trigger it on boot. Production only picks up the change after re-publishing.
