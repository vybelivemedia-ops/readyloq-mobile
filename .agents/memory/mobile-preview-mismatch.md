---
name: Mobile preview mismatch
description: Distinguish the field app's workflow from the registered mobile preview.
---

The ReadyLoq field app runs in its own Expo Dev Server workflow, but the registered mobile artifact named ReadyLoq API is a different Expo project. Do not present a screenshot of the latter as verification of the former.

**Why:** A screenshot attempt for the field app returned "Artifact not found" while the separate registered mobile artifact was available.

**How to apply:** Verify field-app logic with its own Metro logs, typecheck, tests, and an authenticated device run when needed; do not infer field-app UI behavior from the other preview.