---
name: Technician completion boundary
description: Durable local completion must not depend on AI analysis finishing.
---

Technician completion waits only for pending evidence ingestion to drain and the atomic local completed-state write. Existing background sync remains responsible for upload checkpoints, media registration, AI, and server finalization.

**Why:** Sequential AI calls have no application deadline; awaiting full sync from the capture screen can trap a technician behind a completion overlay even though evidence is already durable.

**How to apply:** Never make field-workflow navigation await AI or report generation. Show queued, analyzing, partial, complete, or failed AI independently on the summary while preserving the existing offline sync path.