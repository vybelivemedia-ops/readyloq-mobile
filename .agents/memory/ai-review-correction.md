---
name: AI review & correction workflow
description: Finding schema additions, correction endpoint, mobile review screens, training dataset write-path, export endpoint
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

**aiPrediction JSONB must be populated** — the insert now includes the full structured
snapshot: `{category, confidence, possiblePest (species), pestCandidates (candidates),
conduciveCondition, lifeStage, harborage, moisture, structuralIssue, zone, rationale}`.
Without this the (AI → human) correction delta is lost; it is the primary training signal.
verificationLevel: 2 (technician-reviewed) is always set on these records.

## Training dataset export
`GET /api/intelligence-dataset/corrections/export` — manager+ only.
Returns all `intelligence_records` for the company as JSON envelope (default) or NDJSON
(?format=ndjson). Each record includes `aiPrediction`, `groundTruth`, `aiCorrected`,
`approvedForTraining`, `imageUrl`. Ready for Label Studio / Roboflow / HuggingFace datasets.

## Regenerated correction copy
When a technician corrects a finding, clients may request `updateStrategy:
"ai_regenerate"` with optional on-site notes. The server can replace the
client-facing evidence summary and IPM treatment guidance only after the
technician's species is confirmed. If the model does not return valid structured
copy, the correction fails explicitly rather than saving stale recommendation text.

The original AI species, confidence, and prediction snapshot stay immutable.
Technician verification is represented by `reviewStatus: "corrected"` and
`technicianSpecies`, not by inflating the AI confidence. Generated treatment
guidance must remain non-prescriptive: never imply product selection, dosage,
mixing, or application approval without a licensed technician's protocol.

**Why:** The original AI-to-human delta is the training signal. Replacing its
confidence with a human verdict destroys the ability to measure and improve the
model, while uncontrolled treatment generation could create unsafe field advice.

**How to apply:** Request regeneration only for a `"correct"` action; preserve
older/offline corrections with `keep_existing`. Store technician context with the
finding, and show a visible error if regeneration fails so a correction is never
silently saved with mismatched content.

## Mobile findings review — local inspection flow
`artifacts/readyloq-app/app/(app)/findings-review/[localId].tsx`
- Loads analysis via `getListAnalysisResultsQueryOptions`
- Tracks reviews locally; sends corrections on "Done"
- Sets `record.allFindingsReviewed = true` on confirm

## Mobile findings review — server-viewed inspection (InspectionDetail)
`artifacts/readyloq-app/components/InspectionDetail.tsx`
- `handleFindingAction(finding, action)` — "correct" opens species modal, others post immediately
- `submitReview(findingId, action, species?)` — fetches `PATCH /api/analysis/:id/findings/correct`
- `reviewResults` state maps findingId → action for immediate highlight without refetch
- Correction modal shows AI candidates (tappable) + free-text input; same UX as findings-review screen

## FindingCard (components/FindingCard.tsx)
- Optional `onReview?: (action: "accept"|"correct"|"dismiss") => void` prop
- Optional `savedAction?: ReviewAction | null` prop for highlighting the chosen action
- Shows Accept / Correct / Dismiss buttons inline when `onReview` is provided
- Shows review status badge (Accepted / Corrected / Dismissed) from `savedAction` OR `finding.reviewStatus`

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
The aiPrediction snapshot is the stable, immutable signal for ML training — it must be written at correction time because the finding JSONB may later be mutated further.
