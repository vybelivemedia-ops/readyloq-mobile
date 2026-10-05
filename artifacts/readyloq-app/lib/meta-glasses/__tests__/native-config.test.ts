import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("DAT native configuration", () => {
  it("keeps SDK 0.9.0 pinned and minimum Android API 31 consistent", () => {
    const config = JSON.parse(read("app.json"));
    const properties = config.expo.plugins.find((p: unknown[]) => Array.isArray(p) && p[0] === "expo-build-properties")[1];
    expect(properties.android.minSdkVersion).toBe(31);
    expect(read("android/gradle.properties")).toMatch(/^android\.minSdkVersion=31$/m);
    expect(read("android/app/build.gradle")).toContain('com.meta.wearable:mwdat-core:0.9.0');
    expect(read("android/app/build.gradle")).toContain('com.meta.wearable:mwdat-camera:0.9.0');
  });

  it("keeps callback configuration without secrets and replaces stale manifest credentials with resource references", () => {
    const module = { exports: {} as any };
    runInNewContext(read("plugins/withMetaWearables.js"), {
      module,
      require: () => ({ withAndroidManifest: (config: unknown, transform: (mod: unknown) => unknown) => transform(config) }),
    });
    const application = {
      "meta-data": [{ $: { "android:name": "com.meta.wearable.mwdat.CLIENT_TOKEN", "android:value": "stale-value" } }],
      activity: [{ $: { "android:name": ".MainActivity" } }],
    };
    const mod = { modResults: { manifest: { application: [application] } } };
    module.exports(mod);
    module.exports(mod);
    expect(application["meta-data"]).toHaveLength(2);
    expect(application["meta-data"].map((m) => m.$["android:value"])).toEqual([
      "@string/meta_wearables_client_token", "@string/meta_wearables_application_id",
    ]);
    expect((application.activity[0] as any)["intent-filter"]).toHaveLength(1);
    expect((application.activity[0] as any)["intent-filter"][0].data[0].$).toEqual({
      "android:scheme": "readyloq", "android:host": "mwdat",
    });
  });
});