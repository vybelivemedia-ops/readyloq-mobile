---
name: Meta glasses Live AI wiring
description: How the Ray-Ban Meta glasses integrate into the ReadyLoq inspection pipeline via webhook transport
---

## Architecture
- **Transport**: Meta Live AI webhook (not BLE direct) — glasses → Meta servers → ReadyLoq API → mobile poll
- **Session pairing**: `POST /api/meta-glasses/session` → `{ sessionId, code }`. Tech enters 6-char code in Meta app.
- **Webhook URL**: includes `?session=<uuid>` so Meta routes to the right session without a new DB table.
- **Mobile polling**: `GET /api/meta-glasses/events/:sessionId?since=<ms>` every 3s (no SSE — Hermes lacks EventSource).
- **Session store**: in-memory `Map<string, ActiveSession>` with 24h TTL + 15-min prune interval (no DB table needed).
- **Optional-provider rule**: a persisted inspection ID never activates Meta by itself. Cloud registration/polling requires explicit per-inspection enablement; disabling Meta clears the session while the phone camera remains primary.

**Why:** Automatically activating Meta for every persisted phone-camera inspection consumed the shared API budget and surfaced irrelevant glasses failures.

**How to apply:** Gate every Meta session, polling, and telemetry path on explicit wearable activation. Keep native phone capture available before, during, and after wearable disconnects.

## Key files
- `artifacts/api-server/src/routes/meta-glasses.ts` — HMAC-verified webhook, voice command parser, audio→Whisper, image→OpenAI vision, event buffer, session + events routes
- `artifacts/readyloq-app/hooks/useMetaGlassesSession.ts` — session registration hook, 3s polling, onFinding callback
- `artifacts/readyloq-app/app/(app)/new-inspection.tsx` — hook wired after `wsInspectionId`, glasses strip rendered with `faieBanner`
- `repos/platform/packages/meta-wearables/src/index.ts` — `MetaLiveAIProvider` stub + `META_LIVE_AI_CAPABILITIES` (transport: "wifi")

## Type notes
- `AiPrediction` fields: `possiblePest`, `possibleConduciveCondition`, `possibleEntryPoint` (not pestType/conduciveCondition/entryPoint)
- Severity derived from confidence: ≥0.8 → high, ≥0.6 → medium, else low
- `toFile` must be imported from `"openai"` directly (not from `@workspace/integrations-openai-ai-server`)
- `logErrorEvent` takes `(category: ErrorCategory, input: LogErrorEventInput)` — 2 args
- Express multi-middleware routes: cast `req.params.sessionId as string` to avoid `string | string[]` TS errors

## Frame persistence (Task #74)
- `ObjectStorageService.uploadObjectBuffer(companyId, buffer, contentType)` added to `lib/objectStorage.ts` — uploads server-side buffer directly via GCS SDK, returns `/objects/companies/<id>/uploads/<uuid>` path
- Webhook handler now: upload JPEG → insert `inspectionMediaTable` row (`captureSource: "meta-glasses"`) → add `storagePath`/`mediaId` to `GlassesEvent`
- Mobile: `glassesFindings: GlassesEvent[]` state in `new-inspection.tsx`; `onFinding` pushes finding/frame events to this list; `glassesFindingsPanel` shows last 3 detections inline; `glassesStrip` shows capture count badge
- `GlassesEvent` type in both hook and server now includes `storagePath?: string; mediaId?: number`

## Why
Real-time voice + image capture without phone-in-hand. Glasses push events via Meta's cloud; phone receives findings, persists frames to object storage, and displays a compact strip with the pairing code, live status, and detection count.

## Native Android delivery
- When the app keeps its `android/` directory in source control, EAS builds do not automatically run Expo config plugins against that native project. Manifest requirements for Meta Wearables must therefore be present in the checked-in Android manifest.
- Supply the Meta application ID and client token to Android through Gradle-generated resources populated from encrypted EAS environment variables; do not commit either value or rely on `$VARIABLE` strings in `eas.json`.
- Verify a release by inspecting the built APK's manifest for the two MWDAT metadata keys and `readyloq://mwdat`, without printing credential values.

**Why:** A successful EAS build can silently omit config-plugin-only native changes when an existing Android project is used.

**How to apply:** Any new Android native integration should update the native manifest/Gradle directly (and retain a plugin only for future clean prebuilds), then validate the packaged APK rather than only its source configuration.

## Meta SDK dependency availability
- Do not assume Meta Wearables Android artifacts are published to Google Maven, Maven Central, JitPack, or Sonatype snapshots. Confirm Meta's official repository and currently supported coordinates before adding them to a release build.
- Meta's GitHub Packages repository requires a nonempty Basic-auth username plus a token with `read:packages`. Preview/EAS uses the dedicated classic-PAT package secret; GitHub Actions may use its actor plus `GITHUB_TOKEN`. Do not fall back to the project's general `GH_TOKEN`, whose repository/workflow scopes do not grant package access.

**Why:** A preview build passed JavaScript, type, test, R8, Metro, and EAS pre-build checks but failed in Gradle because the declared Meta Wearables artifacts could not be resolved from any configured repository.

**How to apply:** Before another remote build, verify the SDK distribution instructions and repository access locally or with a dependency-resolution-only Gradle check. A 302 from GitHub Packages followed by a 200 from its signed file host is successful authenticated access; do not spend a build merely to test whether the artifacts exist.

## EAS verification evidence
- EAS build log files are Brotli-compressed NDJSON even though their object names end in `.txt`; download them with content decompression enabled before parsing each line's `msg`.
- Normal Gradle output may not print individual authenticated package downloads. Treat a successful native compile plus Meta DAT classes/native libraries in the APK as resolution evidence, and separately decode the APK's binary manifest for metadata and callback structure.

**Why:** Plain log downloads look like corrupt binary data, and relying only on source declarations or string matches can falsely claim that a release APK contains a structurally valid callback.

**How to apply:** For release verification, combine the successful `assembleRelease` result, absence of Meta resolution errors, packaged DAT code/native libraries, and decoded binary-manifest attributes.
