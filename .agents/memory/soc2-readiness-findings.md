---
name: SOC 2 readiness posture
description: Where ReadyLoq actually stands against SOC 2 criteria as of the last code-level audit — what's real, what's a gap, and the one claim/reality mismatch to watch.
---

A full internal SOC 2 readiness audit (code-level review, not a certified audit) lives at
`soc2-readiness-audit.md` in the repo root — read it before making any public compliance
claim or doing security-posture work. Key durable takeaways:

- **"SOC 2-aligned controls, not certified" is the correct, defensible public phrasing** —
  confirmed by this audit. Real RBAC (~85-90% route coverage via mount-level middleware),
  real per-company tenant scoping, and a real (if narrower-than-claimed) inventory ledger
  exist. Don't let FAIE or marketing copy escalate past this until the gaps below close.

- **Audit-trail claim is broader than reality.** FAIE/marketing say "immutable audit trails
  for every management action and chemical transfer." Actually implemented: only the
  inventory/chemical movement ledger (`inventory_transactions`) is append-only in app code.
  Treatment logs themselves are editable/deletable with no audit trail. Also, "immutable" is
  a coding convention (no UPDATE/DELETE route), not DB-enforced (no trigger/REVOKE/hash
  chain) — tests directly delete ledger rows today. Don't extend this claim further without
  checking whether coverage/enforcement actually grew.

- **Backup/DR is now documented, but not fully closed.** `db-backup-disaster-recovery.md`
  documents Replit managed Postgres PITR, internal RPO/RTO targets, and a verified logical
  restore drill. The account owner still needs to confirm the actual plan tier/PITR window and
  perform a non-destructive production PITR click-through; object-storage DR remains separate.

- **Highest-blast-radius endpoint:** `/api/admin/token-auth` (cross-tenant super-admin
  bootstrap via `SUPER_ADMIN_BOOTSTRAP_TOKEN`) now has a dedicated 10-attempts/15-minute
  per-IP limiter, in addition to the general API limiter.

- The prior dependency scan found 19 high (0 critical), including a Clerk authorization-bypass
  CVE. Task remediation upgraded the affected Clerk/dependency graph; re-run the scanner before
  treating the current vulnerability count as zero because dependency findings drift over time.

Full remediation list and reasoning: see `soc2-readiness-audit.md`. The dependency patch,
backup/DR documentation, and database-enforced ledger immutability remediations landed on
August 24, 2026; remaining gaps in the audit should be re-scored against the current code
before using the old 55/100 directional estimate.
