---
name: AI storage preparation limits
description: Resource-safety rules for loading stored inspection images before AI analysis.
---

AI image preparation must use a network-free object-handle lookup followed by a destroyable, byte-capped range stream tied to the analysis deadline. A local promise timeout is not enough when the SDK request can continue.

**Why:** Racing an unbounded metadata or buffered-download promise lets network retries, memory buffering, and CPU work continue after the analysis has already returned.

**How to apply:** Reject oversized response lengths before accepting data, enforce the same cap while streaming, destroy the stream on deadline or abort, remove all listeners and timers on every terminal path, and never call the provider after preparation fails.