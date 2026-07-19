const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const workspaceRoot = path.resolve(__dirname, "../..");
const platformPackagesRoot = path.resolve(workspaceRoot, "repos/platform/packages");

const config = getDefaultConfig(__dirname);

config.watchFolders = [platformPackagesRoot];

config.resolver = {
  ...config.resolver,
  unstable_enableSymlinks: true,
  nodeModulesPaths: [
    path.resolve(__dirname, "node_modules"),
    path.resolve(workspaceRoot, "node_modules"),
  ],
};

config.transformer = {
  ...config.transformer,
  transformIgnorePatterns: [
    "node_modules/(?!(@platform/.*|@react-native/.*|react-native|@react-navigation/.*|expo|@expo/.*|@unimodules/.*|unimodules|sentry-expo|@sentry/.*|react-native-svg|@expo-google-fonts/.*|@stardazed/.*|@tanstack/.*|@clerk/.*|zod-validation-error))",
  ],
};

module.exports = config;
