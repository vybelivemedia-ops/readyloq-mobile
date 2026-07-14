---
name: Mission Control router has no auth by design
description: Why Mission Control endpoints (incl. destructive ones) are unauthenticated, and how that constrains new routes
---

The Mission Control router is mounted directly under `/api` with no auth/admin middleware. Every endpoint — including destructive/mutating ones (briefing regenerate, approval decisions, the dev-tools maintenance actions) — is reachable without a bearer token.

**Why:** Mission Control is the internal "AI HQ" web app, not a creator-facing surface; the whole router was built unauthenticated as a deliberate convention.

**How to apply:** When adding new Mission Control endpoints, match the existing no-auth convention. Do NOT bolt `requireAuth`/`requireAdmin` onto only the new routes — partial auth is inconsistent and misleading. If real protection is ever needed, it must be applied uniformly at the router mount, which is a separate architectural decision spanning the whole surface. Note: this differs from the threat-model's `/api/admin/*` admin boundary, which is a different router.

**Client-side corollary:** The MC web app must only call MC (`/mission-control/*`) hooks. Generated hooks for the VYBE consumer app (e.g. notifications) require a bearer token and will 401 in MC, which has no auth context. For a bell/alert feed in MC, use the pending-approvals list. Also: MC list endpoints (executives/objectives/tasks) return plain arrays, not `{executives: [...]}` wrappers — trust the generated response types, not assumed shapes.
