# One-time Production Super Admin bootstrap

**Status:** Implemented and tested in Development only. Not enabled or executed in Production. No Production user was provisioned by this work.

## Scope and authorization

The temporary operation lives under the existing Clerk-authenticated, Super-Admin-protected `/api/mission-control` router:

- `GET /api/mission-control/super-admin/bootstrap` previews the server-resolved target without a write.
- `POST /api/mission-control/super-admin/bootstrap` performs the one-time grant and audit atomically.

The target email is fixed **in server code** to `vybelivemedia@gmail.com`; neither the request nor an environment setting can change it. The operation is disabled by default. It requires `READYLOQ_SUPER_ADMIN_BOOTSTRAP_ENABLED=true` and `READYLOQ_SUPER_ADMIN_BOOTSTRAP_OPERATOR_CLERK_ID` set to the **Production Clerk subject of the already-authorized, sole Production Super Admin**. The authenticated operator must have that subject, an existing app-user row with `is_super_admin=true`, and must supply a valid Production Clerk bearer session for POST. The server rechecks the actor inside the transaction. A legacy HMAC token cannot authorize this endpoint.

The operator ID is not a shared bootstrap password. Its configured value is an explicit deployment authorization for one known, currently privileged identity; it must be obtained from that operator's real Production Clerk session and never copied from Development. Configuration alone cannot grant access.

## Identity confirmation and execution contract

The operator first previews the target. On each preview and POST, the server searches **its own environment's Clerk instance**, requires a complete search result with exactly one identity whose **primary** email is the fixed exact address and whose primary email verification status is `verified`, then joins the Clerk subject to exactly one **existing** application user by `users.clerk_user_id`. A missing mapping is an error; this endpoint never creates one. That column is unique in the database; the route also rejects zero or multiple returned mappings. The preview supplies `clerkUserId`, `appUserId`, `verifiedEmail`, `isSuperAdmin`, `companyId`, and the fixed bootstrap operation identifier.

POST requires a meaningful `reason` (up to 1,000 characters), a unique UUID `requestId`, and a `confirmation` object repeating **all three** server-previewed values: `verifiedEmail`, `clerkUserId`, and `appUserId`. The server independently resolves the Clerk identity again and compares all values. The client-supplied Clerk subject is **confirmation only**, never authority to select a target. The request includes no actor ID.

```json
{
  "requestId": "<fresh UUID>",
  "reason": "<explicit documented business authorization>",
  "confirmation": {
    "verifiedEmail": "vybelivemedia@gmail.com",
    "clerkUserId": "<Clerk subject returned by the Production preview>",
    "appUserId": 0
  }
}
```

The transaction obtains a PostgreSQL advisory lock shared by all API instances, verifies the immutable audit trigger is enabled, refuses if this bootstrap action has ever been recorded, requires **exactly one** current Super Admin, locks/rechecks actor and target app-user rows, and uses a conditional update from `false` to `true`. It then inserts the audit event in the **same transaction**. An audit insert failure rolls back the flag. The event is protected by the existing database-level `mission_control_audit_immutable_trigger` against UPDATE and DELETE.

The audit action is `super_admin_bootstrap_granted`. The event identifies its authenticated `actorId` (Clerk subject), target Clerk subject, and records `bootstrapActor`, actor Clerk/app IDs, target Clerk/app IDs, verified email, previous/new state, reason, timestamp, caller request UUID, server-generated operation UUID, and the fixed bootstrap operation ID `readyloq:second-production-super-admin:v1`. The response contains its audit ID.

The **automatic shutdown condition** is: any prior `super_admin_bootstrap_granted` audit event **or** a current Super Admin count other than exactly one. GET returns 410 after either condition. POST returns 410 for a new/different request, even if a later legitimate revoke brings the count back to one. An exact replay of the original UUID, actor, target, and reason returns the original audit/operation IDs with `replayed: true` and performs **no** mutation; a modified replay is rejected. Keep the enable setting off after use as defense in depth. Normal subsequent grants/revokes must use the different-admin Phase 3 approvals route.

## Production prerequisites — not completed here

1. Obtain explicit authorization for the sole current Production Super Admin to act as this one-time bootstrap operator and record the grant reason. Verify that operator can authenticate through **Production Clerk**, then obtain the Production operator subject from `/api/auth/me`. Set the Production-only operator allowlist and enable setting through the authorized environment configuration process; do not set them in Development or guess their values.
2. The intended second admin must sign in normally through **Production Clerk** and call `/api/auth/me`. Confirm the Production app-user mapping exists. This implementation did **not** sign in, provision, or grant that user.
3. Deploy the reviewed server code and confirm it is serving the Production API with the **Production Clerk secret**, the intended writable Production application database connection, and the existing Mission Control audit table and enabled immutability trigger. The agent's current Production query connection is **read-only** and is not an execution path. Do not infer the application runtime is writable from a read-only query. This work does not deploy or switch credentials.
4. With the authorized operator's real Production bearer session, preview and compare the actual Production subject and app-user ID before any POST. Confirm exactly one admin remains and the target is not already an admin. Only then perform the authorized operation, retain the returned request/operation/audit IDs, disable the deployment enable setting, and verify with real Production sessions and protected API reads. Those steps are **not** part of Development testing.

No APK or OTA update is required for the server-side operation, and none is published here.