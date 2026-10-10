# Phase 5 direct-ID inspection authorization

## Policy

- A technician owns an inspection only when its persisted `technicianId` equals that authenticated user's Clerk ID.
- An owning technician may update sensitive fields: status, severity, pest types, completion time, technician/owner signatures, owner-unavailable state, and signature time.
- Another technician cannot change those sensitive fields by guessing or otherwise obtaining the inspection ID. The API loads the inspection directly with both ID and company predicates, then returns 403 when the row is in the same company but owned by a peer.
- A manager or owner may update sensitive fields on another technician's inspection in the same company.
- Completing an inspection via `POST /:id/complete` and deleting the inspection row via `DELETE /:id` use the same owner-or-manager rule; a peer cannot complete another technician's work or remove its evidence relationship.
- Cross-company direct IDs return 404 without disclosing the row.
- Same-company notes and site metadata (unit number and visit purpose) remain editable by any tenant member; this preserves the existing collaboration behavior. A mixed update containing any sensitive field is rejected as a whole for nonowners.
- On inspection creation, a technician who omits `technicianId` is bound to their authenticated Clerk ID; explicit assignment to another user is rejected. Managers/owners may assign only to a technician row in their own company. The client list filter is never used as an authorization boundary.

## Direct-ID test evidence

`artifacts/api-server/src/routes/inspections-signatures.test.ts` sends each request directly to `/api/inspections/:id`; none of these cases depends on whether the ID appears in a list:

| Case | Expected/result |
| --- | --- |
| Technician PATCHes own ID with status and both signatures | PASS — permitted |
| Technician PATCHes peer's ID with status/completion/signatures | PASS — 403; direct GET confirms those fields unchanged |
| Same technician edits peer's notes only | PASS — allowed under the company-collaboration policy |
| Same-company manager PATCHes peer's ID with status/signatures | PASS — permitted |
| Technician POSTs `/:id/complete` for peer inspection | PASS — 403; status remains pending |
| Same-company manager completes peer's ID | PASS — permitted |
| Peer technician DELETE of evidence-owning inspection row | PASS — 403; inspection remains directly retrievable |
| Same-company manager DELETE of peer record | PASS — 204; record is then not found |
| Same-company owner DELETE of peer record | PASS — 204 |
| Owning technician DELETE of own record | PASS — permitted |
| Different-company manager PATCHes the ID | PASS — 404 |
| Different-company manager calls complete and DELETE by ID | PASS — both return 404 |
| Technician POSTs another technician's ID as owner | PASS — 403 |
| Manager assigns a technician from another company | PASS — rejected; no cross-company assignment |
| Existing technician-owned signature updates and re-signature guard | PASS — covered by the existing integration tests |

## Residuals

- `DELETE` removes the database inspection row only; object storage cleanup/reconciliation is separate and remains non-destructive until retention, restore, and legal-hold rules are decided.
- The integration proves tenant/role decisions using API test identities. It does not replace a physical Fold 7 account-switch acceptance test.
- This test suite shares a database with other workspace tests; broad-run failures from unrelated shared fixtures are recorded in the main triage report.