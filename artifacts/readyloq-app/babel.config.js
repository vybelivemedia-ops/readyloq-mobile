/**
 * Expo Router's babel plugin inlines `process.env.EXPO_ROUTER_APP_ROOT` into
 * expo-router/_ctx.android.js (and _ctx.ios.js) so Metro's `collect_dependencies`
 * can statically analyze the `require.context(...)` call.
 *
 * `babel-preset-expo` conditionally adds that plugin only when `hasModule('expo-router')`
 * succeeds.  In pnpm's isolated virtual store the resolution can fail inside a Metro
 * worker process (the package isn't in babel-preset-expo's own dependency closure),
 * so the plugin is silently skipped and the bundle fails with:
 *   "First argument of require.context should be a string denoting the directory to require"
 *
 * Fix: inline the entire plugin here with zero external requires, so it always runs
 * regardless of pnpm hoisting or worker-process module-resolution context.
 */

const nodePath = require("node:path");

/**
 * Minimal port of babel-preset-expo's expoRouterBabelPlugin.
 * Inlines EXPO_ROUTER_APP_ROOT / EXPO_ROUTER_ABS_APP_ROOT / EXPO_PROJECT_ROOT /
 * EXPO_ROUTER_IMPORT_MODE for the current file being transformed.
 */
function inlineExpoRouterEnvVars(api) {
  const t = api.types;

  // These values are injected by @expo/metro-config's babel-transformer.js into every
  // Babel caller.  They are read once per unique caller combination (Babel caches the
  // plugin result keyed on api.caller return values).
  const projectRoot = api.caller((c) => c?.projectRoot ?? null);
  const routerRoot = api.caller((c) => c?.routerRoot ?? null);
  const asyncRoutes = api.caller((c) => {
    if (!c) return false;
    if (c.isServer) return false;
    // In production non-web builds async routes are disabled
    const isDev = c.isDev != null ? c.isDev : process.env.NODE_ENV !== "production";
    const platform = c.platform ?? null;
    if (platform !== "web" && !isDev) return false;
    return c.asyncRoutes ?? false;
  });

  // Compute absolute app root (mirrors getExpoRouterAbsoluteAppRoot from common.js)
  function resolveAbsoluteAppRoot() {
    const rootModuleId = routerRoot ?? "./app";
    const root = projectRoot || "/";
    const resolved = nodePath.isAbsolute(rootModuleId)
      ? rootModuleId
      : nodePath.join(root, rootModuleId);
    // Safety: if resolved escapes the project root fall back to <projectRoot>/app
    if (projectRoot) {
      const rel = nodePath.relative(projectRoot, resolved);
      const isInside = rel && !rel.startsWith("..") && !nodePath.isAbsolute(rel);
      if (!isInside) return nodePath.join(projectRoot, "app");
    }
    return resolved;
  }

  const routerAbsoluteRoot = resolveAbsoluteAppRoot();
  const importMode = asyncRoutes ? "lazy" : "sync";

  return {
    name: "expo-router-env-inline",
    pre() {
      this.projectRoot = projectRoot || this.file.opts.root || "";
      this.isTestEnv = process.env.NODE_ENV === "test";
    },
    visitor: {
      MemberExpression(path, state) {
        const object = path.node.object;
        if (!t.isMemberExpression(object)) return;
        if (!t.isIdentifier(object.object) || object.object.name !== "process") return;
        if (!t.isIdentifier(object.property) || object.property.name !== "env") return;
        // Skip assignment targets
        if (t.isAssignmentExpression(path.parent) && path.parent.left === path.node) return;

        const key = path.toComputedKey();
        if (!t.isStringLiteral(key)) return;

        switch (key.value) {
          case "EXPO_PROJECT_ROOT":
            path.replaceWith(t.stringLiteral(state.projectRoot));
            return;
          case "EXPO_ROUTER_IMPORT_MODE":
            path.replaceWith(t.stringLiteral(importMode));
            return;
        }

        if (state.isTestEnv) return;

        switch (key.value) {
          case "EXPO_ROUTER_ABS_APP_ROOT":
            path.replaceWith(t.stringLiteral(routerAbsoluteRoot));
            return;
          case "EXPO_ROUTER_APP_ROOT": {
            const filename = state.filename || state.file.opts.filename;
            if (!filename) {
              throw new Error(
                "expo-router-env-inline: Unable to determine filename for EXPO_ROUTER_APP_ROOT"
              );
            }
            const appRoot = nodePath.relative(nodePath.dirname(filename), routerAbsoluteRoot);
            path.replaceWith(t.stringLiteral(appRoot));
            return;
          }
        }
      },
    },
  };
}

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: [
      "react-native-reanimated/plugin",
      // Inline port of babel-preset-expo's expoRouterBabelPlugin — no external
      // require() so it works regardless of pnpm hoisting / Metro worker isolation.
      inlineExpoRouterEnvVars,
    ],
  };
};
