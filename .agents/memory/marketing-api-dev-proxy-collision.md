---
name: ReadyLoq /api development routing
description: Why the /api artifact's development run command must serve the backend and use an API health check.
---

The path-based proxy routes `/api/*` to the artifact registered on `/api`, not to
the separate legacy API Server workflow. An Expo development server on that
artifact returns HTML for API calls, even though the API server on port 3000 is
healthy. Its development service now runs the backend, matching production.

**Why:** All web artifacts share the same `/api` origin. A page screenshot can
look fine even when every API request is answered by Expo. The artifact's
readiness check must use a real public API health path, not Expo's `/status`;
otherwise the backend starts but workflow readiness rejects it.

**How to apply:** Keep the registered `/api` artifact's dev and production
services aligned with the backend. Use the separate field-app Expo workflow
for mobile development, not the `/api` artifact. Check `/api/healthz` via the
shared proxy and expect an authenticated Mission Control route to return 401
without credentials (not HTML or a 502).
