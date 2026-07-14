/**
 * Postinstall patch: disable Android native linking for expo-meta-wearables-dat.
 *
 * The package's Android library depends on com.meta.wearable:mwdat-* from
 * GitHub Packages, which requires a GITHUB_TOKEN that is not present in the
 * EAS cloud build environment. Removing the "android" entry from the package's
 * expo-module.config.json stops Expo's auto-linker from including it in the
 * Android native build, preventing a Gradle authentication failure.
 *
 * Runtime behaviour: expo-meta-wearables-dat calls requireNativeModule("EMWDAT")
 * at the top level of its JS bundle. If the native module is not linked,
 * requireNativeModule throws — MetaWearablesContext already catches this and
 * falls back to its built-in simulation hook (same path as Expo Go).
 */

const fs = require("fs");
const path = require("path");

const configPath = path.join(
  __dirname,
  "..",
  "node_modules",
  "expo-meta-wearables-dat",
  "expo-module.config.json"
);

if (fs.existsSync(configPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (config.android) {
      delete config.android;
      // Also remove "android" from the platforms array so the linker skips it
      if (Array.isArray(config.platforms)) {
        config.platforms = config.platforms.filter((p) => p !== "android");
      }
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
      console.log(
        "[patch-meta-dat] Disabled Android native linking for expo-meta-wearables-dat " +
          "(GitHub Packages auth not available in EAS; JS simulation fallback active)."
      );
    }
  } catch (err) {
    console.warn("[patch-meta-dat] Could not patch expo-meta-wearables-dat:", err.message);
  }
} else {
  // Package not installed — nothing to patch.
}
