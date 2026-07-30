const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const fs = require("fs");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const platformPackagesRoot = path.resolve(workspaceRoot, "repos/platform/packages");
const rootNodeModules = path.resolve(workspaceRoot, "node_modules");

const config = getDefaultConfig(projectRoot);

// Watch source packages in the monorepo but NOT the pnpm store — the store
// contains thousands of static directories that push Metro past the inotify
// watcher limit (ENOSPC) in constrained environments.  node_modules/.pnpm is
// added to the blockList below so Metro uses it for resolution only.
const extraWatchFolders = [];
// Watch shared lib packages (source only)
const libRoot = path.resolve(workspaceRoot, "lib");
if (fs.existsSync(libRoot)) extraWatchFolders.push(libRoot);
// Watch platform packages (source only)
if (fs.existsSync(platformPackagesRoot)) {
  extraWatchFolders.push(platformPackagesRoot);
}
config.watchFolders = extraWatchFolders;

// NOTE: do NOT add node_modules/.pnpm to blockedPaths.  Metro resolves
// pnpm-managed packages by following symlinks into .pnpm/; blocking that
// path prevents Metro from reading the real files behind those symlinks and
// causes "Unable to resolve module" errors on EAS (EAGER_BUNDLE phase).
// The ENOSPC watcher fix is handled by keeping .pnpm out of watchFolders
// (above), which is sufficient — Metro doesn't watch paths outside of
// watchFolders and the projectRoot regardless.
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
