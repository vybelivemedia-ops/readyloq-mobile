const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const fs = require("fs");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const platformPackagesRoot = path.resolve(workspaceRoot, "repos/platform/packages");
const rootNodeModules = path.resolve(workspaceRoot, "node_modules");
const appNodeModules = path.resolve(projectRoot, "node_modules");
const libRoot = path.resolve(workspaceRoot, "lib");

const config = getDefaultConfig(projectRoot);

// ── Anchor the project root to an absolute path ────────────────────────────────
// getDefaultConfig() returns projectRoot as "." (CWD-relative). On EAS cloud
// builds Metro may start from the workspace root rather than the app directory,
// making "." resolve to the wrong place. Pinning to an absolute path guarantees
// Metro always treats artifacts/readyloq-app as the project root.
config.projectRoot = projectRoot;

// ── watchFolders ──────────────────────────────────────────────────────────────
// We build the final set by merging:
//   1. Defaults from getDefaultConfig — Expo auto-discovers pnpm workspace
//      packages on Replit but may miss them on EAS (different working dirs).
//   2. rootNodeModules — EXPLICIT addition so that pnpm symlinks in the app's
//      node_modules/ can be followed to their real paths in workspaceRoot/
//      node_modules/.pnpm/ on BOTH Replit and EAS. Without this Metro cannot
//      resolve expo-router/entry.js or any other workspace-level package.
//   3. lib/ and repos/platform/packages/ — workspace source trees for hot-reload.
//
// On EAS cloud workers the pnpm install runs from the workspace root, placing
// all package files in rootNodeModules/.pnpm/. Metro needs rootNodeModules in
// watchFolders to traverse those symlinks. Watchman (if available) handles this
// efficiently; Node chokidar falls back gracefully when inotify watches are
// exhausted (continues bundling without full file watching).
const extraWatchFolders = new Set(config.watchFolders ?? []);
if (fs.existsSync(rootNodeModules)) extraWatchFolders.add(rootNodeModules);
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
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const blockListRegexes = blockedPaths.map(
  (p) => new RegExp(`^${escapeRegex(p)}`)
);

config.resolver = {
  ...config.resolver,
  nodeModulesPaths: [
    appNodeModules,
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
