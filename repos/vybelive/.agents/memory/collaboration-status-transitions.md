---
name: Collaboration status transition matrix
description: Which collaboration-request status changes are allowed and who may make them; mobile UI and server must agree.
---

# Collaboration request status transitions

Statuses: `pending`, `accepted`, `declined`, `scheduled`, `cancelled`.

Allowed transitions (enforced in `artifacts/api-server/src/routes/collaborations.ts`,
PATCH `/collaborations/:id/status`):
- `pending` → `accepted` | `declined` | `scheduled` (recipient only) or `cancelled` (sender only)
- `scheduled` → `cancelled` (sender only) — nothing else
- `accepted`, `declined`, `cancelled` are terminal — no further changes

Role rule: recipient-only for accept/decline/schedule; sender-only for cancel.
Both derived from the DB row + `req.auth.userId`, never from client input.

**Why:** A prior review caught that an already-`accepted` request was still
mutable, which corrupts confirmed-collab state. Treating accepted/declined/
cancelled as final closes that. `scheduled` stays cancel-able because a sender
must be able to back out of a planned collab.

**How to apply:** The mobile UI (`artifacts/mobile/app/collaborations.tsx`)
mirrors this — incoming actions show only while `pending`; the sender's
"Cancel request" shows only while `pending` or `scheduled`. If you change the
server matrix, update the mobile gating in lockstep or the UI will offer
actions the server rejects.
