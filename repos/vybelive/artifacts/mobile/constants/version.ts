// ─── Single source of truth for app version ───────────────────────────────────
// To bump a release, change ONLY this file.
// Also update artifacts/api-server/src/routes/system.ts to match.

export const APP_VERSION = "0.9.20";
export const BUILD_NUMBER = "124";
export const RELEASE_NAME = "Multistream Foundation";

/** Compact version string used in footers and log tags: "0.9.20 (124)" */
export const VERSION_STRING = `${APP_VERSION} (${BUILD_NUMBER})`;
