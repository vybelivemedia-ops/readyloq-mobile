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

## Fix applied

Added `expoRouterBabelPlugin` directly to `babel.config.js` as an explicit plugin, bypassing the `hasModule` check entirely:

```js
const { expoRouterBabelPlugin } = require("babel-preset-expo/build/expo-router-plugin");

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: [
      "react-native-reanimated/plugin",
      expoRouterBabelPlugin, // ensures EXPO_ROUTER_APP_ROOT is always inlined
    ],
  };
};
```

Also added `babel-preset-expo: "~54.0.0"` to the app's `devDependencies` so it is always a direct, resolvable dep on EAS.

## How to apply

If this error reappears after Expo SDK upgrades: verify `expoRouterBabelPlugin` is still exported from `babel-preset-expo/build/expo-router-plugin.js` and that the explicit plugin in `babel.config.js` still uses the correct import path.

**Why:** The plugin is stateless for non-ctx files (visitor only triggers on `process.env.EXPO_ROUTER_APP_ROOT` member expressions), so double-application via the preset AND the explicit entry is harmless.
