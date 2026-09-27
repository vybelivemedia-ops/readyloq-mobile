# ReadyLoq — Database Backup & Disaster Recovery Plan

**Date:** August 24, 2026
**Owner:** Whoever holds admin access to the Replit account/workspace that owns this project (currently the sole account holder). This person is responsible for triggering any real restore and for keeping this document current if the plan or provider changes.
**Scope:** The production PostgreSQL database only (`lib/db`, connected via `DATABASE_URL`). Object storage (inspection photos, voice notes, PDFs in App Storage) is **not** covered here — see "Out of scope" at the end.

This closes item 3.3 ("Availability") and remediation item 5 from `soc2-readiness-audit.md`, which found no backup schedule, PITR configuration, or RTO/RPO documented anywhere in the repo.

---

## 1. What the database actually is

The app has no custom backup code — `lib/db/src/index.ts` just opens a `pg.Pool` against `DATABASE_URL`. All backup/recovery posture is inherited from the hosting provider. Confirmed facts about that provider, not assumptions:

- The database is Replit's managed PostgreSQL. The development database has been migrated to **Helium**, Replit's own managed Postgres infrastructure (confirmed directly: `PGHOST=helium` in this environment). Older Replit projects ran on Neon; this one is on Helium.
- This project **is published** (autoscale deployment, public, live at `https://readyloq.com`), so it has its own **separate production database**, provisioned independently of the development database used while building. Production and development are never the same database.
- Per Replit's official documentation (docs.replit.com/features/data-and-storage/data-recovery and .../development-and-production):

| Database | Recovery mechanism | Retention window |
|---|---|---|
| Development | Checkpoint rollback (tied to Agent checkpoints, not a time-based schedule) | All plans |
| **Production** | **Point-in-time restore (PITR)** — restore to any specific moment | **Core plan: 7 days. Pro/Teams: 28 days.** Retention shrinks to 7 days immediately if the account downgrades from Pro to Core. |

- Restoring the production database does **not** restore application code, and rolling back code does **not** restore the database — they must be done together (restore DB → roll back to the matching checkpoint → republish) to bring the app and its data back to a consistent point in time.
- **Open item, not resolvable from inside the workspace:** which plan (Core vs. Pro/Teams) this account is on determines whether the real retention window is 7 or 28 days. The account owner should confirm this once in Settings → Plan and update the number in this document — treat 7 days as the safe assumption until confirmed.
- Replit does not publish a numeric RPO/RTO SLA for the PITR feature itself (no stated "restores lag by N seconds" or "a restore takes N minutes" commitment). The targets in §2 below are internal targets we hold ourselves to, not a vendor guarantee.

## 2. RPO / RTO — internal targets

| | Target | Basis |
|---|---|---|
| **RPO** (max acceptable data loss) | **≤ 24 hours**, in practice much less | PITR is continuous (restores to an arbitrary point in time, not just to daily snapshot boundaries), so actual achievable data loss in an incident is on the order of the last committed transaction. 24 hours is a conservative target given no formal vendor SLA exists to point to. |
| **RTO** (max acceptable time to restore service) | **≤ 4 hours** for a full production incident (DB restore + code rollback + republish + verification) | The restore itself is a manual, UI-driven action (see runbook below) gated on a human with account access being available; 4 hours budgets for detection, decision-making, the restore, and verification — not just the mechanical restore step. |

If these targets stop being acceptable as the business grows (e.g. going to a Teams/Enterprise plan with stricter uptime commitments, or handling regulated data with a shorter mandated RPO), revisit whether provider PITR alone is still sufficient or whether a supplementary, independently-stored logical backup (§4) needs to become a scheduled job rather than an ad hoc exercise.

## 3. Test restore performed (real, verified — August 24, 2026)

Replit's production PITR restore is triggered from the Database pane UI by a human with account access — it is not exposed as a script or API an agent can invoke, and exercising it for real would touch live production data. To still prove that "backup → restore" actually works end-to-end on this infrastructure (not just that the vendor says it should), I ran a real, independent logical backup/restore drill against the development database using standard Postgres tooling (`pg_dump` / `pg_restore`), which is available directly in this workspace:

**Procedure:**
1. `pg_dump "$DATABASE_URL" -Fc -f backup.dump` — full schema + data dump of the development database (55 tables). Took **<1 second** for the current ~350 KB / 251-row dataset.
2. Created an isolated scratch database (`createdb`) on the same Postgres instance — never touched the real `public` schema.
3. `pg_restore --no-owner --no-privileges -d <scratch db> backup.dump` — full restore into the scratch database. Took **4 seconds**, zero errors.
4. **Verification, not just a "no errors" check:**
   - Row counts compared table-by-table between source and restored database: **55/55 tables matched exactly, 251/251 total rows**.
   - Constraint count (`information_schema.table_constraints`) compared: **560/560 matched** — confirms foreign keys, primary keys, and check constraints survived the round-trip, not just raw row data.
   - Spot-checked actual row content (e.g. `companies` row 1) — identical between source and restored copy.
5. **Cleanup:** dropped the scratch database and deleted the local dump file; no test artifacts were left behind in the database or filesystem.

**What this proves:** the backup/restore mechanics (pg_dump/pg_restore round-trip, schema + data + constraint fidelity) work correctly on this Postgres version and this data model. It is a real, verified restore — not a documentation claim.

**What this does NOT prove, and remains an open action for the account owner:** it does not exercise Replit's actual production **PITR UI** (the mechanism this plan actually relies on for a real incident). That is a one-time, human-triggered action gated on account access I don't have. **Action item:** the account owner should do one real click-through of the production point-in-time restore UI (e.g. restore to a timestamp from a few minutes ago into a preview/scratch context if the UI supports a non-destructive preview, or coordinate a maintenance window) at least once, to confirm the actual button-driven flow works as documented in §5, and note the date it was done at the bottom of this file.

## 4. Recommendation on provider defaults

Provider defaults (continuous PITR, 7–28 day window depending on plan) are **sufficient for the stated RPO/RTO targets in §2** for the app's current scale and risk profile — no app-level backup code change is required today. Two things worth deciding later, not required now:

- If the business ever needs recovery beyond the 7/28-day window (e.g. "restore from 3 months ago"), that requires a separate, independently-stored logical backup (e.g. a scheduled `pg_dump` to Object Storage) — the drill in §3 shows the mechanics for that are simple and fast if it's ever needed.
- Object storage (inspection photos/media) has its own, undocumented durability story, separate from Postgres — flagged as a follow-up, not addressed by this document.

## 5. Restore runbook (for a real incident)

1. **Assess** — determine the scope of loss/corruption and the last-known-good timestamp to restore to.
2. **Restore the database** — open the Database pane → select the production database → point-in-time restore → pick the target timestamp (must be within the retention window confirmed in §1). Expect brief app downtime during/after this step.
3. **Restore matching code** — roll back the project to the checkpoint that matches the chosen timestamp (Rollback feature → select "Database" under additional rollback options only if also reverting dev; for production, just ensure the currently-published code build matches the era of data being restored), then republish.
4. **Verify** — spot-check key tables (companies, users, inspections) for row counts and a few known records; confirm the app boots and core flows (login, load an inspection) work against the restored data.
5. **Communicate** — notify affected customers/stakeholders per whatever incident-communication practice is in place (not defined by this document).
6. **Record** — log what was restored, to what timestamp, and why, in this file's changelog below.

## Out of scope

- **Object storage backup/DR** (inspection photos, voice notes, PDFs) — not covered by Postgres PITR, not addressed here. Should be its own audit.
- **Non-database DR** (e.g. losing the Replit account itself, or losing access to `readyloq.com` DNS) — organizational continuity concerns outside a database backup plan.

## Changelog

- 2026-08-24 — Initial plan written. Provider guarantees confirmed against official docs. Real backup/restore drill performed and verified (§3). Plan tier (Core vs. Pro/Teams) not yet confirmed by account owner — pending.
