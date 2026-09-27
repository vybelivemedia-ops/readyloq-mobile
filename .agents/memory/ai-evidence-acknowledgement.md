---
name: AI evidence acknowledgement
description: Durable rule for tracking partial mobile AI analysis across photo-list edits.
---

Persist exact uploaded storage paths acknowledged by AI analysis. A numeric count may be retained for display compatibility, but must not decide pending sync work.

**Why:** Adding, removing, or reordering photos after a partial response changes what a count refers to and can silently skip pending evidence.

**How to apply:** Union successful response paths into the acknowledgement set, prune paths no longer present locally, acknowledge intentionally excluded duplicates by their own path, and migrate count-only records conservatively so the server can deduplicate reanalysis.