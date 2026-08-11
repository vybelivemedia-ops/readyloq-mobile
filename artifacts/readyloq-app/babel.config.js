const { expoRouterBabelPlugin } = require("babel-preset-expo/build/expo-router-plugin");

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    plugins: [
      "react-native-reanimated/plugin",
      // Explicitly include the expo-router Babel plugin here as a safeguard.
      // babel-preset-expo conditionally adds this plugin via hasModule('expo-router'),
      // but in pnpm's isolated virtual store the resolution can fail when the preset
      // runs inside a Metro worker process (the package isn't in babel-preset-expo's
      // own dependency closure). Adding it here ensures it always runs regardless of
      // pnpm hoisting, so process.env.EXPO_ROUTER_APP_ROOT is properly inlined for
      // expo-router/_ctx.android.js (and _ctx.ios.js) during export:embed / EAS builds.
      expoRouterBabelPlugin,
    ],
  };
};
