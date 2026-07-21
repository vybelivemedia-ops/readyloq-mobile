const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const fs = require("fs");

const workspaceRoot = path.resolve(__dirname, "../..");
const platformPackagesRoot = path.resolve(workspaceRoot, "repos/platform/packages");
const rootNodeModules = path.resolve(workspaceRoot, "node_modules");

const config = getDefaultConfig(__dirname);

if (fs.existsSync(platformPackagesRoot)) {
  config.watchFolders = [platformPackagesRoot];
}

config.resolver = {
  ...config.resolver,
  unstable_enableSymlinks: true,
  nodeModulesPaths: [
    path.resolve(__dirname, "node_modules"),
    ...(fs.existsSync(rootNodeModules) ? [rootNodeModules] : []),
  ],
};

config.transformer = {
  ...config.transformer,
  transformIgnorePatterns: [
    "node_modules/(?!(@platform/.*|@react-native/.*|react-native|@react-navigation/.*|expo|@expo/.*|@unimodules/.*|unimodules|sentry-expo|@sentry/.*|react-native-svg|@expo-google-fonts/.*|@stardazed/.*|@tanstack/.*|@clerk/.*|zod-validation-error))",
  ],
};

module.exports = config;
