---
name: EAS Android bundle fix
description: Root cause and fix for "Unknown error. See logs of the Bundle JavaScript build phase" — process.env.EXPO_ROUTER_APP_ROOT not replaced in _ctx.android.js during export:embed
---

## Root cause

`babel-preset-expo/build/index.js` conditionally adds `expoRouterBabelPlugin` via:
```js
if (hasModule('expo-router')) extraPlugins.push(expoRouterBabelPlugin);
```

`hasModule` uses `require.resolve`. In pnpm's virtual store, `babel-preset-expo` runs inside a Metro worker process spawned from the CLI. In that worker context `expo-router` is **not** in `babel-preset-expo`'s direct dependency closure, so the resolution fails silently → plugin is never added → `process.env.EXPO_ROUTER_APP_ROOT` is never replaced → Metro's `collect_dependencies` throws `"First argument of require.context should be a string denoting the directory to require"` on `expo-router/_ctx.android.js`.

This only manifests in `export:embed` (the EAS/Gradle bundling path). `expo export` works because it uses a different Metro code path where the resolution succeeds (the CLI process context vs. a spawned worker).

**Why `babel.config.js` (same process) works but `babel-preset-expo` inside a worker doesn't:** `babel.config.js` is evaluated in the main CLI process during Metro startup. The worker processes inherit Node.js module resolution but `require.resolve('expo-router')` from deep inside the pnpm virtual store's `babel-preset-expo` directory fails because pnpm does not hoist that package's peer into the worker's reachable `node_modules`.

## Fix applied (final — fully inlined, zero external requires)

The `.easignore` excludes `node_modules/` entirely. EAS runs a fresh `pnpm install` after
extracting the archive. A top-level `require("babel-preset-expo/build/expo-router-plugin")`
in `babel.config.js` runs before Metro workers are even warm, so pnpm resolution timing
can cause it to fail.

**Final fix**: the plugin logic is fully inlined in `babel.config.js` as a plain JS function
with only `require("node:path")` (always available). No dependency on `babel-preset-expo`
resolution from `babel.config.js` at all.

The inlined function (`inlineExpoRouterEnvVars`) mirrors `expoRouterBabelPlugin` exactly:
- `api.caller(c => c?.projectRoot)` — gets project root from Metro caller
- `api.caller(c => c?.routerRoot)` — gets router root (`"app"`) from Metro caller
- Visitor replaces `process.env.EXPO_ROUTER_APP_ROOT` with `path.relative(dirname(file), absAppRoot)`

Also added `babel-preset-expo: "~54.0.0"` to the app's `devDependencies` (harmless extra).

## How to apply

If this error reappears after Expo SDK upgrades: re-read `babel-preset-expo/build/expo-router-plugin.js`
and `common.js` to check if the caller keys (`routerRoot`, `projectRoot`, `asyncRoutes`) changed,
then update the inline function in `babel.config.js`.

**Why:** The plugin is stateless for non-ctx files (visitor only triggers on specific
`process.env.*` member expressions). Double-application via the preset AND the explicit entry
is harmless — the second pass finds no matching nodes.
