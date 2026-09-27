---
name: Mission Control governed operations
description: Approval and investigation boundaries for platform-level administration
---

Mission Control is a separate platform-admin surface, not an alternate entry into tenant routes. A consequential access request must be reviewed by a different super admin; the approval decision is the atomic execution point, rather than granting a reusable approval token for later action. Reject a decision if the target's access state changed after the request was made.

**Why:** A separate "approve, then execute" step can be replayed or left unapplied; an older pending enable request could also silently undo a newer suspension. Platform-wide data must not borrow company-scoped authorization merely by changing a client filter.

**How to apply:** For any new high-impact action, capture the affected target and expected state at request time, show impact and reversibility before review, then validate and commit the effect and audit together under a lock. Keep the worker's company-scoped AI investigations advisory: recommendations are not permission to mutate tenant records, billing, deployments, or access.

Native platform access is verified with a fresh, DB-derived authorization response at cold launch and on foreground resume. The identity check must return a negative result to authenticated non-admins; only the remaining platform routes require the Super Admin middleware. Company-less Super Admins enter platform navigation before tenant onboarding. A failed/offline check never grants platform access from a cached profile, while ordinary tenant users with a known company retain offline-first access.

**Why:** Putting the identity check behind the Super Admin gate returns 403 rather than a usable negative result and strands company-less new users. Letting cached flags authorize platform navigation would retain cross-company data access after revocation or an account switch.

**How to apply:** Keep the native platform stack distinct from tenant tabs and gate it on a completed server check, clearing privileged query data when the Clerk identity changes or signs out. Recheck on app foreground; preserve server-side authorization on every platform endpoint.