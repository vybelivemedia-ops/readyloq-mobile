---
name: AI review & correction workflow
description: Finding schema additions, correction endpoint, mobile review screen, report intelligence for RLQ-001–011
---

## Schema additions on Finding (lib/db/src/schema/analysis.ts)
- `candidates?: Array<{species: string; confidence: number}>` — top-3 AI species sorted descending
- `confidenceLabel?: "identified" | "possible" | "unidentified"` — thresholded at 0.70 / 0.40
- `reviewStatus?: "pending" | "accepted" | "corrected" | "dismissed"`
- `technicianSpecies?: string | null` — set only when reviewStatus === "corrected"

## Confidence thresholds (analysis.ts)
- ≥0.70 → identified → display species directly
- 0.40–0.69 → possible → prefix with "Possible: "
- <0.40 → unidentified → null species shown to client

## Correction endpoint
`PATCH /api/analysis/:id/findings/correct` — body: `{findingId, action: "accept"|"correct"|"dismiss", technicianSpecies?}`
Stores feedback record to `intelligence_records` (best-effort, never blocks response).
Created-by must be non-null; skip insert if `req.user?.id` is null.

## Mobile findings review screen
`artifacts/readyloq-app/app/(app)/findings-review/[localId].tsx`
- Loads analysis via `getListAnalysisResultsQueryOptions`
- Tracks reviews locally; sends corrections on "Done"
- Sets `record.allFindingsReviewed = true` on confirm

## Gating in new-inspection.tsx
- `reviewTick` state + `useFocusEffect` refresh `recordRef` when returning from review screen
- `reviewAnalysisQ` uses existing `wsInspectionId` state
- `hasReviewGate` = wsInspectionId set AND !allFindingsReviewed AND unreviewedCount > 0
- "Complete Inspection" button disabled when `hasReviewGate` is true

## Report narrative intelligence (report-narrative-ai.ts)
- Filters out `reviewStatus === "dismissed"` findings before passing to LLM
- Uses `technicianSpecies` over `species` when `reviewStatus === "corrected"`
- Adds `review=tech-corrected|tech-verified` annotation per finding in the prompt

**Why:** Dismissed findings are AI false positives; including them would fabricate evidence in client reports. Corrected species must override AI guesses for regulatory/accuracy reasons.
