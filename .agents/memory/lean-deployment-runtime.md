---
name: Lean deployment runtime
description: ReadyLoq Autoscale image-size constraint and production dependency packaging rule.
---

ReadyLoq publishing must exclude the full workspace `node_modules` tree and retain a production-only API dependency tree inside the API build output. Keep generated static and API `dist` output in the final image.

**Why:** The monorepo dependency tree adds multiple gigabytes and pushes Autoscale over its 8 GiB image-layer limit. Excluding all dependencies without packaging a runtime tree makes static output disappear or prevents the API from starting.

**How to apply:** When API dependencies or bundler externals change, keep the external list minimal and verify the isolated production output can start without resolving anything from workspace-level `node_modules`.