/**
 * withMetaWearables — Expo config plugin
 *
 * Injects the Meta Wearables Data (MWDAT) Android manifest requirements
 * without duplicating the existing MainActivity entry:
 *
 *   1. Two <meta-data> tags in <application>:
 *        com.meta.wearable.mwdat.APPLICATION_ID  → process.env.META_APP_ID
 *        com.meta.wearable.mwdat.CLIENT_TOKEN    → process.env.META_CLIENT_TOKEN
 *
 *   2. A new <intent-filter> inside the existing .MainActivity for the
 *      deep-link scheme used by Meta Wearables:
 *        readyloq://mwdat
 *
 * Values are read from environment variables at EAS build time so that
 * no credentials are committed to source control.
 */

const { withAndroidManifest } = require("expo/config-plugins");

module.exports = function withMetaWearables(config) {
  return withAndroidManifest(config, (mod) => {
    const appId = process.env.META_APP_ID;
    const clientToken = process.env.META_CLIENT_TOKEN;

    if (!appId || !clientToken) {
      console.warn(
        "[withMetaWearables] META_APP_ID or META_CLIENT_TOKEN is not set. " +
          "Meta Wearables will not be registered in this build."
      );
      return mod;
    }

    const application = mod.modResults.manifest.application?.[0];
    if (!application) return mod;

    // ── 1. <meta-data> in <application> ──────────────────────────────────────
    if (!application["meta-data"]) application["meta-data"] = [];

    const META_KEYS = [
      {
        name: "com.meta.wearable.mwdat.APPLICATION_ID",
        value: appId,
      },
      {
        name: "com.meta.wearable.mwdat.CLIENT_TOKEN",
        value: clientToken,
      },
    ];

    for (const { name, value } of META_KEYS) {
      const alreadyPresent = application["meta-data"].some(
        (m) => m.$?.["android:name"] === name
      );
      if (!alreadyPresent) {
        application["meta-data"].push({
          $: { "android:name": name, "android:value": value },
        });
      }
    }

    // ── 2. intent-filter in MainActivity ─────────────────────────────────────
    const activities = application.activity ?? [];
    const mainActivity = activities.find(
      (a) => a.$?.["android:name"] === ".MainActivity"
    );
    if (!mainActivity) return mod;

    if (!mainActivity["intent-filter"]) mainActivity["intent-filter"] = [];

    const MWDAT_SCHEME = "readyloq";
    const MWDAT_HOST = "mwdat";

    const mwdatFilterExists = mainActivity["intent-filter"].some((filter) => {
      const data = filter.data ?? [];
      return data.some(
        (d) =>
          d.$?.["android:scheme"] === MWDAT_SCHEME &&
          d.$?.["android:host"] === MWDAT_HOST
      );
    });

    if (!mwdatFilterExists) {
      mainActivity["intent-filter"].push({
        action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
        category: [
          { $: { "android:name": "android.intent.category.DEFAULT" } },
          { $: { "android:name": "android.intent.category.BROWSABLE" } },
        ],
        data: [
          {
            $: {
              "android:scheme": MWDAT_SCHEME,
              "android:host": MWDAT_HOST,
            },
          },
        ],
      });
    }

    return mod;
  });
};
