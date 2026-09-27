---
name: AI provider outcome compatibility
description: How to add detailed provider failure outcomes without breaking route tests that mock the legacy AI call.
---

When a route needs richer terminal AI outcomes, communicate them through an optional callback on the existing provider-call options while preserving the original nullable return contract. Avoid making the route depend on a new provider export solely for outcome metadata.

**Why:** Many API route suites mock the established AI function with a minimal module factory. Adding a second route-level export dependency caused unrelated suites to fail at module load or request execution even though their tested behavior had not changed.

**How to apply:** Keep the established provider function as the route dependency, let production invoke the optional outcome callback, and default legacy mocks to completed for a real prediction or failed for null.