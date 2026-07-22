---
name: Platform package build setup
description: How platform packages are built and typechecked; key pitfalls with tsconfig and exports; CaptureDeviceProvider backward-compat design.
---

# Platform package build setup

## The rule
Platform packages under `repos/platform/packages/*/` need a local `tsconfig.json` to run `build` (`tsc -p tsconfig.json`). That tsconfig extends `repos/platform/tsconfig.json` (created in Phase 15). Project references in per-package tsconfigs should NOT list other platform packages — TypeScript resolves them through `node_modules` symlinks, not project refs. Adding project refs to packages without `composite: true` breaks builds.

**Why:** `repos/platform/tsconfig.json` was missing. Without it, `build` failed for all platform packages. `typecheck` (`tsc --noEmit`) used to be a false-positive no-op — it walked up to the workspace root tsconfig.json which has `files: []`, checking nothing.

**How to apply:** When creating a new platform package, add `tsconfig.json` that only sets `outDir`/`rootDir` and `include: ["src"]`. No `references` array unless all referenced packages have composite builds.

## @platform/core exports fix
`@platform/core` had no `src/index.ts` — only compiled `dist/` files. Its `package.json` used to point to `src/index.ts` causing TS2307 errors for packages that import `@platform/shared-types` (which imports core). Fix: updated exports to `dist/index.d.ts` and `dist/index.js`.

**Why:** `moduleResolution: bundler` follows `exports` in package.json. If exports points to a non-existent file, TypeScript errors even with `import type`.

**How to apply:** If any platform package's `build` or `typecheck` produces TS2307 for `@platform/core`, check that `core/package.json` exports `dist/` not `src/`.

## CaptureDeviceProvider backward-compat design
`CaptureDeviceProvider` makes all `DeviceProvider` lifecycle methods **optional** (connect, disconnect, getStatus, checkHealth, getPermissions, on, emit, initialize, teardown, identity, priority, name). This allows:
- Existing ReadyLoq plain-object providers (`VisionProvider = RequestCaptureProvider`) to still compile with no changes.
- New hardware implementations to add the full lifecycle when registering with DeviceRegistry.

**Why:** Making the methods required broke 3 ReadyLoq provider files (native camera, media import, WiFi camera) that return simple objects. Task required zero ReadyLoq app regressions. The interface DECLARES the lifecycle; concrete enforcement is per-implementation.

**How to apply:** When checking if a CaptureProvider supports device lifecycle, use `'connect' in provider && typeof provider.connect === 'function'` narrowing.
