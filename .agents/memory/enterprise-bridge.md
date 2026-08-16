---
name: Enterprise Bridge Architecture
description: Event-driven integration layer dispatching finalized ReadyLoq inspections to PestPac (SOAP), ServSuite (REST), and FieldRoutes (REST notes).
---

# Enterprise Bridge Architecture

## How it works
1. `runInspectionFinalization` (step 7) calls `enterpriseEventBus.emitInspectionFinalized({ companyId, inspectionId })` — fire and forget, never throws.
2. `setupInspectionTriggers()` registers the listener in `app.ts` at module load time (confirmed by "[EnterpriseBridge] Inspection triggers registered" as first startup log line).
3. `EnterpriseAdapterRouter.dispatch()` loads the company's DB config, builds `EnterpriseSyncPayload`, routes to the correct adapter.
4. All sync attempts (success + failure) are written to `inspection_sync_logs` table.

## Payload shape
`EnterpriseSyncPayload` in `src/types/enterprise-payload.ts`:
- `ExternalWorkOrderId` = inspection.id (string)
- `LocationReference.PropertyCode` = siteAddress
- `InspectionFindings[]` = from `Finding.measurementEstimate` (imperial → mm: gapWidthIn×25.4, heightFt×304.8)
- `SignatureAudit` = technicianSigned, ownerSigned, ownerNotAvailable, signedAt

## Adapters
| System | Transport | File |
|---|---|---|
| pestpac | SOAP/XML (`/soap/SaveInspectionRecord`) | `pestPacSoapAdapter.ts` — native fetch + string template XML |
| servsuite | REST JSON (`/workorders`) | `servsuiteAdapter.ts` + `probeServSuite()` |
| fieldroutes | REST notes (existing) | delegates to `syncInspectionToExternalSystem()` |

## DB changes
- `FieldIntegrationSystem` type: now `"pestpac" | "fieldroutes" | "servsuite"`
- `company_field_integrations.api_token` column added (nullable) — required for FieldRoutes dual-token auth
- Migration run manually via raw pg client (no drizzle-kit)

## Key constraints
- `syncInspectionToExternalSystem()` in `field-integration.ts` throws on `"servsuite"` — SerVsuite must go through `EnterpriseAdapterRouter`, not the legacy CRM path.
- The legacy `CRMAdapter` interface (pestPacAdapter.ts / fieldRoutesAdapter.ts) still exists for backward compat with manual `POST /api/integrations/sync` route.
- Build step required before restart: `node ./build.mjs` in `artifacts/api-server/`.
- `probeIntegrationCredentials()` now handles `"servsuite"` via dynamic import of `probeServSuite()`.

**Why:** Event-driven approach keeps finalization non-blocking; adapters are isolated for independent testing; `never` exhaustive checks in switch statements enforce coverage.
