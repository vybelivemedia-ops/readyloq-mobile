# Account Deletion & Lifecycle

VYBE LIVE provides a Google Play–compliant account deletion experience: users can
delete their account both **inside the app** and from a **public web page** that
does not require the app to be installed. This document describes the full
lifecycle, the data that is removed, the timelines, and the operational worker
that enforces them.

## User-facing deletion paths

### 1. In-app (mobile)

`Settings → Account → Delete Account` opens a 4-step confirmation flow:

1. **What you'll lose** — a plain-language summary of the data that will be removed.
2. **Reason** — optional feedback.
3. **Password** — re-authentication to confirm the request is from the account owner.
4. **Final confirmation** — the user types `DELETE` to start the grace period.

On success the account enters a **30-day grace period**, all sessions are revoked,
and the user is signed out.

### 2. Public web (no app required)

`https://getvybe.live/delete-account` is a public form that satisfies Google
Play's requirement for a web-reachable deletion request. It is also linked from
the site footer and the Privacy Policy.

The web form **does not** disable the account on its own. It records a deletion
request and notifies an administrator, who verifies ownership and approves the
deletion. This prevents abuse where an attacker submits another user's email.

## Lifecycle timelines

All day counts are defined as constants in
`artifacts/api-server/src/services/accountLifecycle.ts`.

### Self-requested deletion (30-day grace)

| Day | Event |
| --- | --- |
| 0   | User requests deletion → status `pending_deletion`, all sessions revoked |
| 25  | Reminder email sent (`GRACE_REMINDER_DAY`) |
| 30  | Account permanently deleted (`GRACE_DELETION_DAYS`) |

Signing back in at any point before day 30 **restores** the account and clears
the pending deletion (handled in the login route).

### Inactivity pipeline (180 → 210 days)

| Day | Event |
| --- | --- |
| 175 | Inactivity warning email (`INACTIVITY_WARN_DAYS`) |
| 180 | Account suspended → status `suspended` (`INACTIVITY_SUSPEND_DAYS`) |
| 205 | Final notice email, 25 days after suspension (`SUSPENSION_FINAL_NOTICE_DAYS`) |
| 210 | Account permanently deleted, 30 days after suspension (`INACTIVITY_DELETE_DAYS`) |

Signing in before day 210 reactivates a suspended account.

## What gets deleted

A hard delete removes the user row; related rows are removed via `ON DELETE
CASCADE` foreign keys. This includes:

- Profile, username, bio, avatar
- Streams and stream history
- AI clips
- Analytics / watch-time data
- Connected platform credentials (OAuth tokens, RTMP keys)
- Notifications, reports, subscription records
- Refresh-token session material

Records that must be retained for legal/financial reasons (e.g. billing history)
should be anonymized rather than hard-deleted; extend `hardDeleteUser` if such
records are added.

## Account states

`account_status` enum: `active`, `pending_deletion`, `suspended`, `deleted`.

- **active** — normal account.
- **pending_deletion** — self-requested deletion in its 30-day grace window.
- **suspended** — inactivity suspension (day 180+); restorable by sign-in.
- **deleted** — terminal; the auth middleware blocks all access (403).

## Audit log

Every lifecycle transition writes a row to `account_audit_log` via
`logAccountAudit` with a stable action identifier (see the `AUDIT` map), the
actor type (`user` / `system` / `admin`), and contextual metadata. This provides
a tamper-evident history for compliance review and is surfaced in the admin
dashboard.

## API endpoints

User (authenticated):

- `POST /api/account/delete-request` — start the 30-day grace deletion.
- `POST /api/account/cancel-deletion` — cancel a pending deletion.
- `POST /api/account/reactivate` — reactivate a suspended account.

Public:

- `POST /api/account/web-delete-request` — submit a web deletion request.

Admin (`/api/admin/*`, admin role required):

- `GET /api/admin/deletion-requests` — list web/in-app deletion requests.
- `GET /api/admin/accounts` — list accounts filtered by lifecycle status.
- `GET /api/admin/audit-logs` — review the audit trail.
- `POST /api/admin/accounts/:userId/restore` — restore an account.
- `POST /api/admin/deletion-requests/:requestId/cancel` — cancel a deletion request.
- `POST /api/admin/deletion-requests/:requestId/approve` — approve a web request.

The contract lives in `lib/api-spec/openapi.yaml`; React Query hooks and Zod
schemas are generated from it.

## Operational worker

The lifecycle timelines are enforced by a standalone worker that performs one
full sweep per run:

```bash
pnpm --filter @workspace/api-server run jobs:lifecycle
```

The worker bundles to `dist/jobs/lifecycle.mjs` (built alongside the API server)
and calls `runAccountLifecycleSweep()`. It exits `0` on success and `1` on
failure so a scheduler can detect errors.

### Deploying as a Scheduled Deployment

Run the worker **once per day** via a Replit Scheduled Deployment:

1. Create a new **Scheduled Deployment**.
2. **Build command:** `pnpm --filter @workspace/api-server run build`
3. **Run command:** `pnpm --filter @workspace/api-server run jobs:lifecycle`
4. **Schedule:** daily (e.g. `0 9 * * *`).
5. Ensure `DATABASE_URL` and `SESSION_SECRET` are available to the deployment.

A daily cadence is sufficient because all timelines are measured in days and the
sweep is idempotent — running it more than once a day causes no duplicate
actions.
