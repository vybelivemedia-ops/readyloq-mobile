/**
 * @platform/live-session-core
 *
 * Live-session infrastructure extracted from vybelive.
 *
 * CANONICAL SOURCE:
 *   repos/vybelive/artifacts/mobile/lib/
 *   repos/vybelive/artifacts/api-server/src/routes/  (stream routes)
 *   repos/vybelive/artifacts/api-server/src/services/ (stream services)
 *
 * VYBE LIVE mobile app routes observed:
 *   app/(tabs)/          — discover, notifications, recordings, approvals,
 *                          collaborations, conversations
 *   app/stream/          — live stream session (Agora RTC)
 *   app/creator/         — creator dashboard
 *   lib/uploadMedia.ts   — media upload to object storage
 *
 * ReadyLoq has NO streaming — it is a capture/sync/report app. This package
 * is VYBE-owned. ReadyLoq would consume live-session-core only if it adds a
 * "live inspection walkthrough" feature in a future phase.
 *
 * AGORA:
 *   VYBE uses Agora RTC for WebRTC streaming. The AgoraAdapter wraps the
 *   Agora SDK so the rest of the codebase never imports Agora directly — this
 *   makes it possible to swap providers (e.g. LiveKit, 100ms) without
 *   touching stream-session logic.
 *
 * GENERALISATION NEEDED (before extraction):
 *   - Move Agora credentials and channel config to injected options.
 *   - Extract social publishing (YouTube / Instagram Live) as pluggable
 *     SocialPublisher adapters (one per platform).
 *   - Decouple CloudRecording from Agora Cloud Recording API — make it
 *     work with any recording provider.
 *
 * DEPENDENCY GRAPH:
 *   live-session-core → shared-types
 *   live-session-core → storage-core  (recording files → object storage)
 */
export {};
