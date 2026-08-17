---
name: Metro vite/vitest blockList
description: Why vite and vitest must be blocked in Metro's resolver and how it was done.
---

## Rule
`metro.config.js` must include regex patterns blocking `vite` and `vitest` from the Metro bundle. Without these, a build that reaches ~2279 modules fails with:

> `SyntaxError: vite/dist/node/module-runner.js: Invalid call at line 916: import(filepath)`

## Why
`vitest.config.ts` lives at `artifacts/readyloq-app/` root and imports `from "vitest/config"`, which chains into `vite/dist/node/module-runner.js`. Metro watches the full project root. If any import path in the bundle graph reaches that file, Metro tries to transform the Vite Node ESM file — which uses bare `import()` — and Hermes rejects it.

## How to apply
The four blockList regexes are already in `metro.config.js`:

```js
/[/\\]node_modules[/\\]\.pnpm[/\\]vite[@+]/,
/[/\\]node_modules[/\\]\.pnpm[/\\]vitest[@+]/,
/[/\\]node_modules[/\\]vite[/\\]/,
/[/\\]node_modules[/\\]vitest[/\\]/,
```

If metro.config.js is ever regenerated or these patterns are removed, the next build that reaches vitest.config.ts will fail with the same SyntaxError. Re-add all four regexes to `config.resolver.blockList`.

**Symptom:** build fails after 2200–2300 modules with the `module-runner.js` SyntaxError.
**Diagnosis:** run `npx expo export --platform android --no-minify` locally to reproduce in ~30s.
