---
name: FAIE capture concurrency
description: Durable concurrency rules for keeping FAIE responsive during multimodal inspection capture.
---

Voice actions must dispatch before optional camera context resolves. Rolling context captures and technician shutter captures must share one camera arbiter, with rolling work yielding when a shutter is pending. Session-scoped asynchronous completions require generation guards so old voice or frame work cannot mutate a restarted session.

**Why:** Independent camera requests, delayed voice-frame attachment, and stale asynchronous completions caused inspection lag and could apply work to the wrong session.

**How to apply:** Any new capture source or voice-session lifecycle path must use the shared serialization/generation pattern rather than starting independent native work.

Durable evidence ingestion must stay serial while thumbnails remain optimistic. A thumbnail may switch to its durable URI only after the local inspection record commits; failed uncommitted copies must be removed. Analysis and completion must use a stable-tail drain, and completion must close evidence intake before draining.

**Why:** A one-shot promise-tail wait can miss work enqueued while draining, and swapping a URI before the record write succeeds leaves visible but unrecorded evidence.

**How to apply:** Preserve commit ordering and stable-drain semantics when changing photo persistence, external camera callbacks, automatic analysis, or inspection completion.