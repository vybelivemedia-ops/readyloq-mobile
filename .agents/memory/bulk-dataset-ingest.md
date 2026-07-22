---
name: Bulk dataset ingestion
description: Historical photo bulk-upload flow — API endpoint, mobile screen, upload pattern quirks
---

## API endpoint: POST /api/intelligence-dataset/bulk-ingest
- Accepts JSON `{ images: [{objectPath, filename}]×1–50, metadata: {category, subcategory, possiblePest, possibleConduciveCondition, possibleEntryPoint, severity, locationType, notes} }`
- Tenant guard: rejects any objectPath where `objectPathCompanyScope(path) !== companyId`
- Batch-inserts all records in one DB call: `status="confirmed"`, `verificationLevel=2`, `aiPrediction=null`, `aiCorrected=false`
- Returns `{ created, failed, recordIds[] }`
- `z` (zod/v4) must be imported directly in `intelligence-dataset.ts` for the BulkIngestBody schema

## Client upload pattern (mobile)
Two-step presigned URL flow — same as existing single-record flow:
1. `POST /api/storage/uploads/request-url` → `{ uploadURL, objectPath }`
2. Read local file as blob, PUT to signed URL

**Use `fetch(asset.uri).then(r => r.blob())` NOT `FileSystem.uploadAsync`.**
`FileSystem.FileSystemUploadType` was moved/removed in expo-file-system v19 (installed version).
The `fetch(fileUri) → blob → PUT` pattern works natively in React Native/Hermes and has no version dependency.

## Mobile screen: app/(app)/dataset/bulk-upload.tsx
- Three-phase UI: compose → uploading (progress bar + counter) → done (summary card)
- Multi-select up to 50 photos via expo-image-picker `allowsMultipleSelection: true`
- Category chips (6 taxonomy groups), context-sensitive detail inputs, severity chips, location type, notes
- Navigation entry: "Upload Training Photos" quick-action card in Dashboard (index.tsx)

## Route structure
- `app/(app)/dataset/_layout.tsx` — minimal Stack layout, no header
- `app/(app)/dataset/bulk-upload.tsx` — the screen

**Why status="confirmed" not "pending":** For bulk ingestion the human provides the ground-truth label directly (no AI ran). `pending` means "awaiting technician confirmation of AI suggestion" — that doesn't apply here. Managers can still promote records via the existing review flow.
