const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const fs = require("fs");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const platformPackagesRoot = path.resolve(workspaceRoot, "repos/platform/packages");
const rootNodeModules = path.resolve(workspaceRoot, "node_modules");

const config = getDefaultConfig(projectRoot);

// ── Anchor the project root to an absolute path ────────────────────────────────
// getDefaultConfig() returns projectRoot as "." (relative to CWD). During
// EAS cloud builds Metro may be started from the workspace root rather than
// the app directory, making "." resolve to the wrong place. Setting an
// explicit absolute path guarantees Metro always treats artifacts/readyloq-app
// as the project root regardless of the working directory.
config.projectRoot = projectRoot;

// ── watchFolders ──────────────────────────────────────────────────────────────
// getDefaultConfig() already discovers pnpm workspace packages and adds
// node_modules to watchFolders via @expo/config workspace detection. We MERGE
// (not replace) with our additional source trees so that:
//   1. node_modules stays in watchFolders — Metro can follow pnpm symlinks
//      through node_modules/.pnpm to their real package locations.
//   2. lib/ and repos/platform/packages/ are also watched for hot-reload.
//
// Note: inotify usage is low (~9 FDs active), so watching node_modules does
// not exhaust the 65 536-watch limit in practice.
const extraWatchFolders = new Set(config.watchFolders ?? []);
const libRoot = path.resolve(workspaceRoot, "lib");
if (fs.existsSync(libRoot)) extraWatchFolders.add(libRoot);
if (fs.existsSync(platformPackagesRoot)) extraWatchFolders.add(platformPackagesRoot);
config.watchFolders = [...extraWatchFolders];

// ── Blocked paths ─────────────────────────────────────────────────────────────
const homeDir = process.env.HOME || "/home/runner";
const blockedPaths = [
  path.join(homeDir, ".config"),
  path.join(homeDir, ".npm"),
  path.join(homeDir, ".nvm"),
  path.join(homeDir, ".yarn"),
  path.join(workspaceRoot, ".config"),
  path.join(workspaceRoot, ".cache"),
  path.join(workspaceRoot, ".git"),
  path.join(workspaceRoot, "artifacts/readyloq-app/.expo"),
];

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const blockListRegexes = blockedPaths.map(
  (p) => new RegExp(`^${escapeRegex(p)}`)
);

config.resolver = {
  ...config.resolver,
  nodeModulesPaths: [
    path.resolve(projectRoot, "node_modules"),
    ...(fs.existsSync(rootNodeModules) ? [rootNodeModules] : []),
  ],
  blockList: blockListRegexes,
};

config.transformer = {
  ...config.transformer,
  transformIgnorePatterns: [
    "node_modules/(?!(@platform/.*|@react-native/.*|react-native|@react-navigation/.*|expo|@expo/.*|@unimodules/.*|unimodules|sentry-expo|@sentry/.*|react-native-svg|@expo-google-fonts/.*|@stardazed/.*|@tanstack/.*|@clerk/.*|zod-validation-error))",
  ],
};

module.exports = config;
