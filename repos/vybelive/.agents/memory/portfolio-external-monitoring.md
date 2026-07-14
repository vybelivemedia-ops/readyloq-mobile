---
name: Portfolio external monitoring
description: How portfolio assets get real telemetry (URL ping + GitHub) and the SSRF guard contract
---

# Portfolio external monitoring

- Any `portfolio_assets` row with `live_url`/`github_repo` gets the generic external monitor automatically; dedicated `LIVE_MONITORS[slug]` entries take precedence and merge the same external dims (production_status, build_health, open_issues).
- GitHub telemetry reuses `ReplitConnectors().proxy("github", path)` (same pattern as the Engineering Intelligence githubProvider) — no token handling in app code; works in dev and deployments.
- **SSRF contract:** `liveUrl` is user-supplied and fetched server-side on an unauthenticated router. Any server-side fetch of stored URLs MUST go through the `safePing`/`assertPublicHost` guard (blocks loopback/link-local/metadata/private ranges on every redirect hop, manual redirects, DNS-resolved check). Never switch back to `redirect: "follow"` on user-supplied URLs.
- **Why:** MC router is intentionally unauthenticated (established convention — no partial auth), so URL-fetch sinks are the real attack surface; the guard is the compensating control.
- Monitors must never throw upward — every external check degrades to "unknown"/"critical" dimensions; a monitor failure must never take down the portfolio view or the briefing.
- Daily briefing (GET /mission-control/overview) prepends a portfolio line and pushes critical/attention companies into focus; portfolio fetch is wrapped in try/catch so telemetry failure never kills the brief.
