const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.transformer = {
  ...config.transformer,
  transformIgnorePatterns: [
    "node_modules/(?!(@platform/.*|@react-native/.*|react-native|@react-navigation/.*|expo|@expo/.*|@unimodules/.*|unimodules|sentry-expo|@sentry/.*|react-native-svg|@expo-google-fonts/.*|@stardazed/.*|@tanstack/.*|@clerk/.*|zod-validation-error))",
  ],
};

module.exports = config;
