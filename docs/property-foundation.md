# Property foundation

Phase 1 adds a reusable hierarchy to existing `property_profiles` records.
It does not replace PestPac/CRM scheduling or remap existing addresses, photos,
treatments, property memory, or unit-number text.

## Operation

Company Portal → Portfolio → Roster. Address-only legacy properties first need
the existing property profile saved; the panel provides that action. Profile IDs
are returned as optional `profileId` in property summaries.

Owners/managers manage their company properties. Technicians can read and edit
properties where an inspection is assigned to their Clerk identity, matching
the existing schedule's assignment approach. Sales has read-only API access.
External client grants and the external client portal are unchanged in Phase 1.

Locations have UUID identities and string labels. Buildings contain floors or
units; floors contain units; common areas may belong to the property, building,
or floor. Parent and child must belong to the same property/company. Changing
labels or floor assignment keeps identity. Cross-property moves are not exposed.
There is a resource limit of 2,048 location records per property, not a fixed
building/unit count. Archived records count toward this bound.

Edits use revisions. Archive requires a reason and archives the subtree, retaining
records. Restoring a parent does not automatically restore its children. Every
mutation records actor/context in a new change-log table; this is not a claim of
certified or immutable security audit trails.

## Visits and coverage

Visit creation takes an idempotency UUID `clientKey`. Separate keys create
separate visits even on the same day. Expected active units/common areas are
snapshotted transactionally. All start `not_inspected`.

Coverage supports `not_inspected`, `in_progress`, `inspected`, and `no_access`.
No-access requires a reason. Progress/completion require explicit inspection
linkage. The inspection must belong to this company/property, match the selected
space's current or snapshot unit/area label, and be assigned to the technician
when the caller is a technician. Completion additionally requires an explicit
completed inspection with `completedAt`; no photo/finding/AI count is consulted.
One inspection cannot cover multiple spaces in the same visit.

Coverage does not represent evidence-upload state, AI review, or a “clear”
outcome. Snapshot labels survive subsequent rename/archive operations.
Legacy inspection/photo text corrections retain their existing behavior and
do not silently reassign stable space IDs. No automatic inspection linking
or changes to the mobile evidence/synchronization path are introduced.

## API

All paths below are under the existing authenticated `/api`:

- GET `/property-foundation/:propertyId/roster`
- POST `/property-foundation/:propertyId/locations`
- PATCH `/property-foundation/:propertyId/locations/:locationId`
- GET/POST `/property-foundation/:propertyId/visits`
- GET `/property-foundation/:propertyId/visits/:visitId`
- PATCH `/property-foundation/:propertyId/visits/:visitId/coverage/:coverageId`

Company ownership is server-derived. Bodies reject caller-supplied tenant fields.
Existing rate limits and active-company/beta guards apply.
The shared OpenAPI client and the hand-written mobile transport expose contracts.
No destructive delete endpoint exists.

## Offline foundation

`lib/api-client-react/src/property-preload.ts` defines a versioned, bounded
package contract and identity/freshness/provenance assessment. It includes roster,
unit history, treatment/follow-up summaries and source-linked briefing context.
Cache keys include user/company/property/route-date/version. A unit briefing
cannot cite another unit's records.

This is **not** a downloader, persisted route cache, offline roster-edit queue,
offline server-AI implementation, or real-time portal bridge. A future authorized
server builder must supply verified completeness and source ownership. Local
validation does not prove server authenticity or current access rights.
Readiness: not_downloaded, invalid, stale, partial, ready.
Budgets: 2,048 locations, 1,000 entries per history section, 500,000 serialized
characters per package and at most 48 hours between generation and expiry.

The native capture screen's existing property-memory banner is separately
identity-keyed and clears before fetching a new address. Failed, late or cancelled
requests cannot restore the previous address's context.

## Migration and verification

`migrate-property-foundation.ts` is additive and transaction/advisory-lock guarded
with a lock timeout. It runs before the API starts serving requests. It creates
target unique indexes before composite foreign keys and reconciles missing FKs
after partial schema-push attempts. It does not update/delete historical data.
Test setup prepares these relationships using the isolated test database only.

Tests: `property-foundation.test.ts`, mobile local `property-briefing.test.ts`,
and existing signature/media/completion/portal/schedule/treatment/memory suites.
`tsconfig.production-check.json` checks API source without test fixtures.
