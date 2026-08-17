---
name: Metro vite/vitest blockList
description: Why vite, vitest, and __tests__ dirs must be blocked in Metro's resolver and the exact failure chain.
---

## Rule
`metro.config.js` must include regex patterns blocking `vite`, `vitest`, `__tests__/`, and `*.test/spec.*` from the Metro bundle.

Without these, a build fails with one of two errors depending on which block is missing:

1. **vite/vitest packages missing:** `SyntaxError: vite/dist/node/module-runner.js: Invalid call at line 916: import(filepath)` — Metro transformed Vite's Node ESM file which uses bare `import()`, illegal in Hermes.
2. **__tests__ dirs missing:** `Import "vitest" not found` with an import stack showing `app (require.context)` → a `__tests__/...test.ts` file.

## Root cause
Expo Router uses `require.context` to scan the entire `app/` directory tree for route files. If a task-agent adds a `__tests__/` subdirectory **inside** `app/` (e.g. `app/(app)/inspection-summary/__tests__/`), those test files — which import from `vitest` — are discovered by the scanner and Metro tries to bundle them. `vitest` internally imports from `vite`, and `vite/dist/node/module-runner.js` uses a dynamic `import()` that Hermes rejects.

## How to apply
The seven blockList regexes live in `metro.config.js` under `config.resolver.blockList`:

```js
// Block vite/vitest packages
/[/\\]node_modules[/\\]\.pnpm[/\\]vite[@+]/,
/[/\\]node_modules[/\\]\.pnpm[/\\]vitest[@+]/,
/[/\\]node_modules[/\\]vite[/\\]/,
/[/\\]node_modules[/\\]vitest[/\\]/,
// Block test files picked up by Expo Router's require.context
/[/\\]__tests__[/\\]/,
/\.test\.[jt]sx?$/,
/\.spec\.[jt]sx?$/,
```

If metro.config.js is ever regenerated or these patterns are removed, the next build whose task agents added `__tests__/` inside `app/` will fail.

**Why:** Task agents tend to place test files as siblings to the code they test. When that code lives in `app/`, the `__tests__/` dir ends up inside `app/`, making it visible to Expo Router's directory scanner.

**How to detect:** run `npx expo export --platform android --no-minify` locally; the full import stack appears in the error within ~30–90 seconds.
