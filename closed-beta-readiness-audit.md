# ReadyLoq — Closed Beta Readiness Audit

**Date:** June 24, 2026
**Scope:** Full inspection workflow — login → property → inspection → capture (photo / video / voice) → upload → AI analysis → findings → narrative → PDF/export — evaluated across Residential, Multi-Family, Commercial, and Restaurant property types.
**Verdict:** **GO for a controlled closed beta** with the High-severity items below addressed or explicitly communicated to beta users. **Readiness score: 79 / 100.**

---

## 1. Methodology & Caveats

This audit is a code-level review of the running monorepo (`artifacts/readyloq` frontend, `artifacts/api-server` backend, `lib/*` shared packages), supplemented by the existing api-server test suite (65 passing across 4 files) and a frontend typecheck pass.

**Caveats (what was NOT exercised at runtime):**
- **Camera / video / voice capture cannot be tested headless.** `getUserMedia`, `MediaRecorder`, and the `ImageCapture` API require a real browser with camera/mic permission, which a headless Playwright runner cannot grant. These paths were verified by **code review only**. They must be smoke-tested on real iOS Safari and Android Chrome devices before the beta opens — this is the single most important pre-beta manual step.
- The AI vision/narrative models are mocked in the test suite, so model **output quality** (accuracy of pest classification, narrative tone) was not measured here — only the surrounding data flow, guards, and persistence.

---

## 2. What Works (Confirmed Strengths)

These are genuinely solid and should give confidence for the beta:

- **Multi-tenant scoping is enforced consistently.** Every data route resolves the caller's company via `requireAuth` → `requireCompany` → `getCompanyId(req)`, and `getCompanyId` throws loudly if used on an unguarded route. Queries filter by `companyId`; the `/analyze` route additionally re-checks that the parent inspection belongs to the caller's company before doing any work.
- **Object storage is tenant-isolated.** Uploads are namespaced `companies/{companyId}/uploads/{uuid}`; downloads compare the path's company against the caller and return **404 (not 403)** on mismatch, avoiding existence disclosure. Uploads use short-lived (15 min) presigned PUT URLs straight to GCS.
- **AI analysis never fabricates findings.** `/analyze` runs the real vision model only on photos that are (a) company-scoped and (b) persisted media rows for *that* inspection. Clean photos and failed analyses do **not** produce placeholder "observation" findings — failures are counted in `analysisErrors` and surfaced, not silently swallowed. AI calls are bounded (`MAX_ANALYZE_IMAGES = 40`) against cost/DoS amplification.
- **Video evidence is handled exactly per spec.** Videos are validated with the same tenant guards as photos, stored as `videoEvidence` with `frameAnalysisStatus: "pending"`, and are **never** passed to the vision model or turned into findings. The pending status is a clean forward hook for future per-frame analysis.
- **Uploads fail loudly, not silently.** `uploadToStorage` throws on any failure rather than falling back to ephemeral blob URLs, so a "completed" inspection never silently references evidence that was never stored.
- **Report generation is real, not templated.** Narrative is AI-generated from structured findings + voice transcripts + property metadata; PDF is rendered client-side via `@react-pdf/renderer` with distinct Customer and Internal modes (internal adds property-intelligence that is correctly hidden from customers).

---

## 3. Findings by Severity

### CRITICAL (0)

No issues found that block a *controlled* closed beta outright. The core workflow is functional and tenant-safe. The items below should still be triaged before scaling beyond a small cohort.

---

### HIGH (3)

#### H-1 — Captured evidence is lost if the page reloads mid-completion
- **Area:** `artifacts/readyloq/src/pages/inspections/new.tsx`
- **Repro:** On a phone, capture several photos/a video, tap Complete, and while the staged upload is in flight (slow cellular), background the tab or let iOS Safari evict it / pull-to-refresh.
- **Impact:** `captured` items live in component state and the `uploadedRef` / `persistedRef` de-dupe markers live in in-memory refs. A reload clears all of them, so any not-yet-uploaded evidence is **permanently lost** with no recovery path. For a field app where technicians work on flaky mobile connections, this is the most likely real-world data-loss scenario.
- **Fix:** Persist captured blobs + upload/persist progress to IndexedDB (or upload each item immediately on capture rather than batching at Complete), and rehydrate on mount so an interrupted inspection can resume.

#### H-2 — No offline / poor-connectivity resilience for uploads
- **Area:** capture → `uploadToStorage` → `/storage/uploads/request-url` (presigned, 15-min TTL)
- **Repro:** Begin completion on a weak connection; let an upload stall past the 15-minute presigned-URL TTL or drop entirely.
- **Impact:** A stalled upload past TTL fails; the staged-retry logic re-requests a URL on the *next* manual retry, but there is no background queue, no auto-retry with backoff, and no persisted queue across app restarts. Field inspections in basements, crawlspaces, and rural sites will routinely hit dead zones.
- **Fix:** Add a persisted upload queue with automatic retry/backoff and re-request of expired presigned URLs; show per-item upload state (queued / uploading / failed) so the technician knows what still needs connectivity.

#### H-3 — Property type is not a first-class field; restaurant/health-code tailoring depends on free-text parsing
- **Area:** `artifacts/api-server/src/lib/report-narrative-ai.ts` (`derivePropertyType`)
- **Repro:** Create an inspection for a restaurant without writing the exact phrase the regex expects in the notes; generate the narrative.
- **Impact:** Property type is inferred by regex over inspection notes and **falls back to `"Commercial / Residential"`** when no match is found. The narrative prompt only applies restaurant-specific health-code / food-safety guidance when the type is correctly detected — so the Restaurant and Multi-Family experiences the audit was asked to validate are unreliable, silently degrading to generic language. This directly weakens the cross-property-type promise.
- **Fix:** Make property type a structured, required field on the property/inspection record (selected in the New Inspection setup step) and pass it explicitly to narrative generation instead of parsing notes.

---

### MEDIUM (4)

#### M-1 — Frontend typecheck currently fails (~18 pre-existing errors)
- **Area:** `pnpm --filter @workspace/readyloq run typecheck`
- **Impact:** Vite builds succeed (it does not typecheck), so the app runs — but the type baseline is broken (`queryKey` missing on several `useQuery` option objects, untyped `window.SpeechRecognition`, `string | null | undefined` mismatches). This masks real bugs and means new type errors can slip in unnoticed. *(None of the video-capture changes in this task added new errors — verified.)*
- **Fix:** Burn down the baseline (add `queryKey` to the flagged hooks, declare the `SpeechRecognition` global, tighten the nullable args) and wire typecheck into CI so it stays green.

#### M-2 — Orphaned media on abandoned partial completion
- **Area:** `new.tsx` staged persistence + `inspection_media`
- **Impact:** Media rows + uploaded GCS objects are written one at a time. If completion crashes partway and the technician never retries, partial media persists with no cleanup/GC, accumulating orphaned rows and storage objects.
- **Fix:** Add a server-side reconciliation/GC job (or a transactional "finalize inspection" endpoint) that removes media not attached to a completed inspection after a grace period.

#### M-3 — Failed-photo analysis is counted but not attributed
- **Area:** `analysis.ts` (`analysisErrors`) → `new.tsx` toast
- **Impact:** When a photo fails AI analysis, the technician sees only an aggregate count ("N photos couldn't be analyzed"), not *which* photos. They cannot tell which evidence needs manual review or recapture.
- **Fix:** Return the failed image identifiers in the analyze response and highlight them in the review/detail UI for targeted recapture.

#### M-4 — Video does not contribute to findings (by design, but a beta expectation gap)
- **Area:** `analysis.ts` video handling
- **Impact:** This is correct per the current requirement (video metadata only, `frameAnalysisStatus: "pending"`), but beta users who record a clip of live pest activity will reasonably expect it to influence findings and will perceive it as a bug if not told otherwise.
- **Fix:** No code change required for beta. Explicitly document "video is captured and stored as evidence; automated video analysis is coming soon" in the beta release notes and ideally as inline UI copy near the record button.

---

### LOW (3)

#### L-1 — Dead object-ACL scaffolding
- **Area:** `artifacts/api-server/src/lib/objectAcl.ts`
- **Impact:** `BaseObjectAccessGroup`'s switch has no implementations and throws by default. Access control is actually handled by path-prefix scoping in `storage.ts`, so this code is unreachable — but it's a trap for the next developer who assumes ACL groups are wired up.
- **Fix:** Remove the unused scaffolding or finish it; don't leave a throwing stub that implies a feature exists.

#### L-2 — Silent fallbacks in non-inspection AI paths
- **Area:** `intelligence-dataset.ts` (`fallbackPrediction()`), `branding.ts` (self-healing seed)
- **Impact:** Outside the inspection-analysis path, AI failures degrade to zero-confidence predictions and branding self-seeds on the fly. Acceptable for those surfaces, but worth knowing they mask backend failures rather than surfacing them.
- **Fix:** Add observability (log/metric) when fallbacks fire so silent degradation is at least visible operationally.

#### L-3 — PDF default logo resolves against `window.location.origin`
- **Area:** `artifacts/readyloq/src/components/report-pdf.tsx` (`DEFAULT_LOGO`)
- **Impact:** Works because the PDF is rendered client-side, but it is brittle if rendering ever moves server-side or runs in an unusual embedding context.
- **Fix:** Resolve the default logo from a configured absolute asset URL rather than the runtime window origin. (Low priority — not currently broken.)

---

## 4. Property-Type Walkthrough

| Property type | Capture (photo/video/voice) | AI photo findings | Narrative tailoring | Verdict |
|---|---|---|---|---|
| Residential | Works (code-reviewed) | Works | Generic guidance applies cleanly | Ready |
| Multi-Family | Works | Works | Depends on H-3 (type detection) | Ready w/ H-3 caveat |
| Commercial | Works | Works | Default bucket; acceptable | Ready |
| Restaurant | Works | Works | **Health-code/food-safety language only if type detected (H-3)** | Needs H-3 fix |

The capture → upload → analysis → findings pipeline is property-type-agnostic and works uniformly. The only type-sensitive surface is **narrative tailoring**, which is gated by the fragile `derivePropertyType` parsing (H-3). Fixing H-3 makes all four types first-class.

---

## 5. Readiness Score: 79 / 100

| Dimension | Weight | Score | Notes |
|---|---:|---:|---|
| Core workflow completeness | 25 | 23 | End-to-end path exists and is real, not mocked. |
| Multi-tenant security / isolation | 20 | 18 | App-layer scoping is consistent; add DB-level defense-in-depth. |
| Data integrity (no fabricated/lost evidence) | 20 | 13 | Analysis integrity is excellent; **mobile evidence-loss (H-1/H-2)** is the main deduction. |
| AI quality plumbing | 15 | 12 | Real model, bounded calls, honest failures; output quality unmeasured. |
| Reporting & export | 10 | 8 | Strong PDF (customer/internal); export limited to PDF only. |
| Code health / maintainability | 10 | 5 | Failing typecheck baseline (M-1) and dead scaffolding drag this down. |
| **Total** | **100** | **79** | |

---

## 6. Recommendation

**GO for a small, hand-held closed beta** (≈5–15 friendly technicians), provided:

1. **Real-device smoke test first** — manually verify photo, video, and voice capture on iOS Safari and Android Chrome, including front/rear switch and the REC timer. This covers what headless testing cannot.
2. **Fix H-1 and H-2 (or fence them)** — at minimum, persist captured evidence locally and add basic auto-retry. If time-boxed, restrict the beta to good-connectivity sites and warn technicians not to reload mid-upload.
3. **Fix H-3** — promote property type to a real selected field so Restaurant/Multi-Family tailoring is dependable.
4. **Communicate M-4** — tell beta users video is stored as evidence but not yet auto-analyzed.
5. **Green the typecheck (M-1)** before opening the beta wider than the initial cohort.

Hold **general availability** until H-1/H-2 are fully resolved with a persisted offline upload queue and the typecheck baseline is clean.
