---
name: Analysis request deduplication
description: Reliability rules for sharing concurrent inspection analysis and enforcing provider-call limits.
---

Share an in-progress inspection analysis only when company, inspection, and the full canonical request payload match. Different evidence, technician findings, video metadata, or draft state must run independently.

**Why:** Inspection-only single-flight keys can silently discard a concurrent request's distinct evidence. Applying the provider cap before eligibility, path deduplication, and cache partitioning can also omit valid work or create contradictory outcomes.

**How to apply:** Normalize and verify media first, deduplicate canonical paths, carry forward cached completions, then cap only new provider candidates. Every eligible canonical path must have exactly one terminal outcome.