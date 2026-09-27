# ReadyLoq — SOC 2 Readiness Audit (Internal)

**Date:** August 24, 2026
**Type:** Internal engineering code/architecture review — **not** a certified SOC 2 report.
**Scope:** `artifacts/api-server` (backend), `lib/db` (schema), object storage, and dependency/static-analysis scans across the monorepo.
**Verdict:** **Moderate readiness — estimated 55 / 100.** The architecture has real, working controls that map cleanly onto SOC 2's Security and Confidentiality criteria (RBAC, per-company scoping, an inventory audit ledger), but there are concrete gaps — dependency vulnerabilities, no documented backup/DR, an audit trail that's narrower than what's implied in marketing copy, and no independent enforcement of "immutability" at the database layer. None of this blocks calling current controls "SOC 2-aligned" (the language already in use on the marketing site and in FAIE). It does block claiming actual certification, a completed audit, or "Type II" status today.

**On the score itself:** SOC 2 has no official numeric score — an auditor produces a pass/fail opinion per selected Trust Service Criteria, not a percentage. The number below is my own directional estimate (weighted by how much each area matters and how big its gaps are), useful for tracking progress over time, not something to quote to a customer or auditor as if it were a real metric.

| Criterion | Weight | Est. score | Why |
|---|---|---|---|
| Security (Common Criteria) | 40% | 65/100 | Strong RBAC coverage (~85–90%) and clean secrets hygiene, pulled down by 19 unpatched high vulnerabilities, one under-protected cross-tenant admin endpoint, and partial security-event logging. |
| Confidentiality | 20% | 65/100 | Tenant isolation and object-storage scoping are consistently applied in code, but with no database-layer backstop (e.g. row-level security) and no field-level encryption for sensitive data. |
| Processing Integrity | 15% | 55/100 | The inventory ledger is genuinely insert-only in app code, but not DB-enforced, and the public "audit trail for every action" claim covers less than it implies. |
| Availability | 15% | 35/100 | No backup schedule, PITR, or disaster-recovery plan documented anywhere — the single largest concrete gap. |
| Privacy | 10% | 30/100 | No data retention/deletion policy or subject-access workflow exists yet. |
| **Weighted total** | | **≈55/100** | |

Read this as "meaningfully further along than a greenfield app, meaningfully short of audit-ready" — closing the items in §4 below would plausibly move this into the mid-70s to 80s before it's worth engaging an actual accredited firm.

---

## 1. Methodology & caveats

This is a **code-level review**, not an audit performed by an accredited third-party CPA firm. A real SOC 2 report (Type I: point-in-time; Type II: controls observed operating over 3–12 months) requires an independent auditor, formal policy documents, and evidence of operational practice — most of which lives outside a codebase (employee offboarding records, access-review logs, incident response drills, vendor management). This document covers what a codebase *can* show: whether the technical controls exist and are consistently applied. It should be read as a punch list to close before engaging a real auditor, not as a substitute for one.

Findings are grounded in: `runDependencyAudit()`, `runSastScan()`, `runHoundDogScan()`, and targeted code review of auth, RBAC, tenant isolation, encryption, audit logging, and backup/DR.

---

## 2. Automated scan results

| Scanner | Result |
|---|---|
| Dependency audit (Socket) | **0 critical, 19 high, 0 moderate, 0 low** |
| SAST (Semgrep-class) | **4 high** (all the same path-traversal pattern, 2 files) |
| Privacy/dataflow (HoundDog) | **0 findings** |

**Notable dependency findings:**
- `@clerk/clerk-react@5.61.3` — **CVE-2026-42349 / GHSA-w24r-5266-9c3c**, an authorization bypass when combining organization/billing/reverification checks. Fix available at `5.61.6`, no major-version bump required. **Highest priority — patch this first**, since it's an auth-adjacent bypass in the library this app's entire access model depends on.
- `brace-expansion` (transitive, multiple versions) — two separate DoS CVEs (unbounded/exponential expansion). Low exploitability here but easy, no-major-bump fixes exist.
- Full breakdown: run the security scan again for the current list; 19 high-severity findings all have available fixes.

**SAST findings (4, all HIGH):** `javascript.express.file.fs-express` — path built from potentially untrusted input — in `artifacts/readyloq-api/server/serve.js` and `artifacts/readyloq-app/server/serve.js` (2 hits each, static file servers). Worth a quick look even though these are Expo web dev-server scaffolding, not the primary API surface.

---

## 3. Findings by Trust Service Criteria

### 3.1 Security (the mandatory "Common Criteria")

**Access control / RBAC — strong, with one high-impact exception.**
Roughly 35–38 of 42 route files (~85–90%) are protected by `requireAuth` + `requireCompany`, with `requireRole` added for sensitive groups (manager/sales/owner) — enforced mostly at mount-time in `routes/index.ts` rather than duplicated per-route. Unauthenticated exceptions are almost all intentional and narrow: health check, public lead capture (rate-limited), a token-scoped client-portal share endpoint (uniform 404, no photos), the public billing plan catalog, and the FAIE marketing assistant (rate-limited, no data access). The one real outlier: `/api/admin/token-auth` accepts `SUPER_ADMIN_BOOTSTRAP_TOKEN` outside Clerk entirely and issues an 8-hour cross-tenant HMAC admin token, protected only by the general 500-req/15-min API limiter — not a dedicated brute-force limiter. This is the single highest-impact endpoint to harden.

**Authentication — delegated to Clerk, reasonably.** No hardcoded secrets, API keys, or credentials found anywhere in source (explicit grep pass came up clean). No password-reset/lockout code exists in the app itself because auth is fully delegated to Clerk — that's a reasonable design choice, but MFA enforcement is a Clerk-dashboard setting, not something visible or confirmable from the codebase. Worth explicitly confirming (and documenting) what Clerk instance policy actually enforces today.

**Vulnerability management — needs remediation before any audit engagement.** See §2. Zero critical is good; 19 high with available fixes is a same-day cleanup, not a design problem.

**Logging & monitoring — partial.** Role-based 403s are persisted to an `errorEventsTable` (`logErrorEvent`), and there's a test proving a technician's forbidden attempt gets recorded. But plain 401s (no session) and `requireCompany`/`requireSuperAdmin` denials are **not** persisted, and there's no failed-login alerting, anomaly detection, or SIEM-style export — just generic Pino application logs. An auditor will ask "how would you know if someone was brute-forcing or probing your API" and the honest answer today is "you'd see it in raw logs, not in an alert."

### 3.2 Confidentiality (this is ReadyLoq's own biggest public claim, so it gets the most scrutiny here)

Tenant isolation is real but is a **code-path guarantee, not a database-layer guarantee** — every route extracts `companyId` from the authenticated session and filters queries by it, backed by `requireCompany` middleware, but there's no row-level security or ORM-enforced scoping that would catch a future route written without that filter. It's a good, consistently-applied pattern today; it has no independent backstop if a future change gets it wrong.

Object storage: private files (photos, voice notes) use company-namespaced paths, 15-minute signed upload URLs, and authenticated tenant-checked downloads — solid. There's also an intentionally public `/storage/public-objects/*` path (by design, for public-facing assets), which is fine but should be explicitly documented so it doesn't read as a leak during a real audit.

No field-level or client-side encryption exists for PII/financial data — data at rest depends entirely on whatever the underlying managed Postgres provider does by default, which isn't independently confirmed or documented anywhere in this repo. Transit encryption is likewise assumed to be handled at Replit's deployment edge; the app's own listener is plain HTTP with no internal HTTPS-redirect, which is normal for this hosting model but should be stated explicitly to an auditor rather than left implicit.

### 3.3 Availability

**Resolved — see `db-backup-disaster-recovery.md`.** Provider guarantees are now confirmed and documented (production runs on Replit's managed Postgres with continuous point-in-time restore, 7–28 day window depending on plan), a real backup/restore drill has been performed and verified end-to-end, and RPO/RTO targets, ownership, and a restore runbook are written down. One open action remains there: the account owner should confirm the actual plan tier (Core vs. Pro/Teams) and do a one-time click-through of the real production PITR UI.

Rate limiting looks reasonable (global 500 req/15 min, tighter dedicated limits on the public FAIE and lead-capture endpoints).

### 3.4 Processing Integrity

**Resolved — the ledger's immutability is now database-enforced, not just a code-path convention.** A `BEFORE UPDATE OR DELETE` trigger on `inventory_transactions` (see `artifacts/api-server/src/lib/migrate-ledger-immutability.ts`) raises an exception on any such statement regardless of which role or connection issues it — REVOKE wasn't viable here since the app connects as the table's owner, and owners always retain full DML rights over their own tables. A narrow, explicit test/ops-only bypass (`SET LOCAL app.bypass_ledger_immutability = 'on'` inside a transaction) exists for legitimate fixture cleanup; production code never sets it, so an accidental mutation from application code — or a bare statement from a direct DB session — is blocked by default. Covered by `src/lib/ledger-immutability.test.ts`.

More importantly: **the audit trail is narrower than the current marketing/FAIE language implies.** FAIE's own system prompt says "immutable audit trails for every management action and chemical transfer" — but the ledger genuinely only covers inventory/chemical movement. Treatment logs themselves can be edited and deleted, with only the inventory-side reversal getting an audit entry. This is worth reconciling one way or the other: either narrow the public claim to what's actually true (inventory/chemical custody specifically), or extend audit coverage to other sensitive mutations. Given the "no fabricated claims" standard already set for FAIE, I'd lean toward tightening the claim rather than promising broader coverage that doesn't exist yet.

### 3.5 Privacy

No data retention/deletion policy, subject-access workflow, or privacy-policy enforcement was found in code — expected, since this normally lives in a written policy document rather than application logic, but it means there's currently nothing to point to if a customer or auditor asks "how do I get my data deleted."

---

## 4. Prioritized remediation

**Quick wins (hours to a day):**
1. Patch the 19 high dependency vulnerabilities — start with `@clerk/clerk-react` (auth-adjacent, no major bump needed), then the `brace-expansion` DoS entries.
2. Fix the 4 path-traversal SAST findings in the two Expo `server/serve.js` files.
3. ~~Add a dedicated, tighter rate limit (or additional verification) to `/api/admin/token-auth` — it's the highest-blast-radius endpoint and currently shares the generic API limiter.~~ **Done — `/api/admin/token-auth` now has its own 10-req/15-min per-IP limiter in addition to the general API limiter.**
4. Persist `requireCompany`/`requireSuperAdmin` denials to `error-events` alongside the existing role-based 403 logging, for basic visibility into probing.

**Medium (days to weeks):**
5. ~~Confirm and document what the production database provider actually guarantees for backups/PITR; test one real restore; write it down.~~ **Done — see `db-backup-disaster-recovery.md`.**
6. ~~Enforce ledger immutability at the DB layer (revoke UPDATE/DELETE on `inventory_transactions`, or add a trigger) so the "immutable" claim is literally true.~~ **Done — see §3.4.**
7. Reconcile the audit-trail claim in FAIE's system prompt and marketing copy with actual coverage (see §3.4) — narrow the claim or extend the coverage.

**Process, ahead of an actual certification attempt:**
8. Confirm and document current MFA policy in the Clerk dashboard.
9. Write a data retention/deletion policy.
10. Document access-review and change-management practices (who can deploy, PR review policy, offboarding checklist) — these are organizational facts, not something a codebase can demonstrate on its own.
11. Once the above are closed, engage an actual accredited firm for a Type I report, then a Type II observation period — no internal review substitutes for that.

---

## 5. Bottom line for public-facing language

The current "SOC 2-aligned controls" phrasing on the marketing site and in FAIE holds up: real RBAC, real tenant scoping, a real (if narrower-than-claimed) audit ledger, and a company-scoped auth model are all in place. But this audit found enough concrete, unresolved gaps — no backup/DR documentation, 19 unpatched high vulnerabilities, ledger immutability that isn't independently enforced — that neither FAIE nor any other public surface should say "certified," "Type II," or claim a scheduled audit until those are actually true. Treat this document as the checklist for closing that gap, not as something to publish.
