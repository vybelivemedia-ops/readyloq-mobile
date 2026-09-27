---
name: GitHub push authentication
description: The distinction between Replit's GitHub connector and the local HTTPS Git credential path.
---

Reauthorizing the Replit GitHub connector can restore connector API access without changing a separately configured `GH_TOKEN` secret or the credential used by the local HTTPS Git remote.

**Why:** A repository push can continue to return GitHub's invalid-token error even after the connected GitHub account has been successfully reauthorized.

**How to apply:** Treat connector reauthorization and local Git authentication as separate paths. Do not expose or paste token values; repair the workspace Git credential through the supported environment or remote configuration before retrying a blocked push.