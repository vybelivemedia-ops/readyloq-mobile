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
