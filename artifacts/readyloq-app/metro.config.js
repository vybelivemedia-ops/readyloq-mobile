const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const fs = require("fs");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const platformPackagesRoot = path.resolve(workspaceRoot, "repos/platform/packages");
const rootNodeModules = path.resolve(workspaceRoot, "node_modules");

const config = getDefaultConfig(projectRoot);

// ── watchFolders: different strategy for Replit dev vs EAS cloud build ────────
//
// Problem: pnpm symlinks packages through node_modules/.pnpm (the virtual
// store). When Metro follows a symlink, the real file's absolute path lands
// inside .pnpm. Metro silently refuses to bundle files whose real path is
// outside all watched directories (projectRoot + watchFolders), so if the
// workspace root isn't watched, any pnpm-linked module fails to resolve.
//
// Replit constraint: the Replit container's inotify limit is ~65 536 watches.
// Watching the full workspace root (including node_modules/.pnpm which has
// ~200k+ entries) exhausts that limit immediately → ENOSPC / build hang.
//
// Solution: on Replit (REPLIT_DEV_DOMAIN is always set), only watch specific
// source dirs; on EAS (no REPLIT_DEV_DOMAIN), watch the workspace root so
// Metro can follow .pnpm symlinks. EAS VMs have no meaningful inotify cap.
const isReplit = !!process.env.REPLIT_DEV_DOMAIN;
const extraWatchFolders = [];
// Always watch shared lib packages (source only)
const libRoot = path.resolve(workspaceRoot, "lib");
if (fs.existsSync(libRoot)) extraWatchFolders.push(libRoot);
// Always watch platform packages (source only)
if (fs.existsSync(platformPackagesRoot)) {
  extraWatchFolders.push(platformPackagesRoot);
}
// On EAS: watch workspace root so Metro can resolve pnpm virtual-store symlinks.
// On Replit: omit to stay within the inotify limit.
if (!isReplit && fs.existsSync(workspaceRoot)) {
  extraWatchFolders.push(workspaceRoot);
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
