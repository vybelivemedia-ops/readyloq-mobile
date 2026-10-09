#!/usr/bin/env node
// No EAS CLI, credentials, dotenv files, or build-profile fallback.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");

const APP_ROOT = path.resolve(__dirname, "..");
const PUBLIC_KEYS = [
  "EXPO_PUBLIC_DOMAIN",
  "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "EXPO_PUBLIC_CLERK_PROXY_URL",
];

function publicConfig(eas, app) {
  const preview = eas.build?.preview;
  const production = eas.build?.production?.env;
  if (preview?.channel !== "preview" || preview.developmentClient !== false) {
    throw new Error("Preview must be a release build subscribed to preview.");
  }
  const id = app.expo?.extra?.eas?.projectId;
  if (!id || app.expo?.updates?.url !== `https://u.expo.dev/${id}`) {
    throw new Error("Update URL must match the configured Expo project.");
  }
  if (app.expo.runtimeVersion !== "1.0.0") {
    throw new Error("This preview publishing path targets APK runtime 1.0.0; review a new native build first.");
  }
  const result = {};
  for (const key of PUBLIC_KEYS) {
    const value = production?.[key];
    if (typeof value !== "string" || !value || /[\r\n]/.test(value)) {
      throw new Error(`Missing or invalid production public setting: ${key}`);
    }
    if (preview.env?.[key] !== value) {
      throw new Error(`Preview and production public settings differ: ${key}`);
    }
    result[key] = value;
  }
  if (result.EXPO_PUBLIC_DOMAIN.includes("/") ||
      result.EXPO_PUBLIC_DOMAIN.endsWith(".replit.dev") ||
      !result.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY.startsWith("pk_live_") ||
      result.EXPO_PUBLIC_CLERK_PROXY_URL !== `https://${result.EXPO_PUBLIC_DOMAIN}/api/__clerk`) {
    throw new Error("Preview update requires production API and live Clerk configuration.");
  }
  return result;
}

function verifyBundle(directory, values) {
  const metadata = JSON.parse(fs.readFileSync(path.join(directory, "metadata.json"), "utf8"));
  const bundlePath = metadata.fileMetadata?.android?.bundle;
  if (!bundlePath) throw new Error("Export has no Android launch bundle.");
  const absolute = path.resolve(directory, bundlePath);
  if (!absolute.startsWith(path.resolve(directory) + path.sep)) {
    throw new Error("Android launch bundle is outside the export directory.");
  }
  const bundle = fs.readFileSync(absolute);
  for (const key of PUBLIC_KEYS) {
    if (!bundle.includes(Buffer.from(values[key]))) {
      throw new Error(`Compiled Android launch bundle is missing ${key}.`);
    }
  }
}

function main() {
  const values = publicConfig(
    JSON.parse(fs.readFileSync(path.join(APP_ROOT, "eas.json"), "utf8")),
    JSON.parse(fs.readFileSync(path.join(APP_ROOT, "app.json"), "utf8")),
  );
  if (process.argv.includes("--eas")) {
    for (const [key, value] of Object.entries(values)) {
      // Arguments are never echoed. set-env shares values with later EAS steps.
      execFileSync("set-env", [key, value], { stdio: "ignore" });
    }
    console.log("Production public bundle settings loaded (values withheld).");
  } else if (process.argv.includes("--bundle")) {
    for (const key of PUBLIC_KEYS) {
      if (process.env[key] !== values[key]) {
        throw new Error(`Publishing environment differs from production: ${key}`);
      }
    }
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "readyloq-preview-ota-"));
    try {
      execFileSync("pnpm", ["exec", "expo", "export", "--platform", "android", "--output-dir", directory], {
        cwd: APP_ROOT,
        env: { ...process.env, ...values, EXPO_NO_DOTENV: "1", CI: "1" },
        stdio: "inherit",
      });
      verifyBundle(directory, values);
      console.log("Android launch bundle contains all three production public settings (values withheld).");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  } else {
    console.log("Preview channel, runtime, project, and production public settings validated (values withheld).");
  }
}

module.exports = { PUBLIC_KEYS, publicConfig, verifyBundle };
if (require.main === module) {
  try { main(); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
