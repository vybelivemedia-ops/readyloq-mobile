---
name: Workspace lockfile refresh
description: Avoid unrelated Expo peer snapshot churn when updating a single workspace package's lockfile entries.
---

When adding dependencies for one workspace package, review the lockfile diff carefully: a root-level `pnpm install --lockfile-only` can recompute peer-resolution metadata for unrelated Expo packages in addition to the intended importer entries.

**Why:** The lockfile can gain noisy, unrelated changes even when the package versions themselves have not changed, making a focused feature change harder to review.

**How to apply:** Keep the target package's importer records needed for reproducible installs. Avoid treating unrelated peer snapshot normalization as part of the feature unless it is intentionally being updated and independently validated.