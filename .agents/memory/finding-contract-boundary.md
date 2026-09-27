---
name: Finding contract boundary
description: Source-of-truth and validation policy for Finding data across API, server, and clients.
---

OpenAPI is the authoritative Finding field contract. Server validation must derive from generated schemas, including strict nested metadata objects, while generated web/mobile types stay aligned.

**Why:** A looser published contract than the server caused API-valid technician findings to be silently discarded. Treating client input like malformed AI or legacy data also hid actionable validation failures.

**How to apply:** Reject invalid client-submitted findings before provider or database work with indexed field paths. Continue tolerant sanitation only for AI output, correction of legacy rows, report reads, and finalization.