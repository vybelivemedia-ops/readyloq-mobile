---
name: pnpm selective overrides location
description: where to put pnpm.overrides selector syntax (name@range or parent>child) vs plain-name overrides
---

`pnpm-workspace.yaml`'s top-level `overrides:` key only reliably applies **plain package-name**
overrides (e.g. `esbuild: 0.27.3`) and optional-dependency removals (e.g. `foo>bar-native: '-'`).

Selector-style overrides — `"pkg@range": "version"` (target only one version-line of a package) or
`"parent>pkg": "version"` (target only when required by a specific parent) — silently do **not**
apply when placed in `pnpm-workspace.yaml`. `pnpm install --force` reports "up to date" / succeeds
with no error, and the target package's resolved version in `pnpm-lock.yaml` never changes — there's
no warning that the override was ignored.

**Why:** discovered while patching a multi-version-line transitive vulnerability (three concurrent
`brace-expansion` majors pulled in by three different `minimatch` majors) — plain-name overrides in
pnpm-workspace.yaml worked fine for single-version packages, but per-version-line selectors placed
there were no-ops.

**How to apply:** put selector-syntax overrides in the root `package.json`'s `"pnpm": { "overrides": {...} }`
field instead (this repo already had `"react-native-ble-plx>expo": "54.0.36"` there as a working
precedent). After adding/editing overrides, verify by grepping the resulting `pnpm-lock.yaml` for the
actual resolved version — don't trust the install log alone, and don't trust naive text search for
"who requires this dependency" either (a crude `awk`/grep scan across the flat `packages:`/`snapshots:`
sections can attribute a transitive dep to the wrong parent if package headers have trailing peer-dep
suffixes); parse indentation-aware or use `pnpm why <pkg>`.
