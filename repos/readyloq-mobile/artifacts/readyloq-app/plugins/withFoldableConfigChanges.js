const { withAndroidManifest } = require("expo/config-plugins");

/**
 * Foldable support: Android restarts the Activity on fold/unfold unless the
 * relevant config changes are declared as self-handled. Expo's template
 * already declares most of them on MainActivity, but omits
 * `smallestScreenSize` and `density` — the two that change when a foldable
 * opens or closes. Without them, a fold/unfold mid-inspection tears down the
 * Activity (camera session, in-memory state) instead of letting React Native
 * relayout in place.
 */
const REQUIRED_CONFIG_CHANGES = ["smallestScreenSize", "density"];

module.exports = function withFoldableConfigChanges(config) {
  return withAndroidManifest(config, (mod) => {
    const application = mod.modResults.manifest.application?.[0];
    const activities = application?.activity ?? [];
    const mainActivity = activities.find(
      (a) => a.$?.["android:name"] === ".MainActivity",
    );
    if (!mainActivity) return mod;

    const existing = (mainActivity.$["android:configChanges"] ?? "")
      .split("|")
      .filter(Boolean);
    for (const value of REQUIRED_CONFIG_CHANGES) {
      if (!existing.includes(value)) existing.push(value);
    }
    mainActivity.$["android:configChanges"] = existing.join("|");
    return mod;
  });
};
