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

## Why
Real-time voice + image capture without phone-in-hand. Glasses push events via Meta's cloud; phone receives findings and displays a compact strip with the pairing code and live status.
