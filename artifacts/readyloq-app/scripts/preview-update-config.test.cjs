const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { publicConfig, verifyBundle, PUBLIC_KEYS } = require("./preview-update-config.cjs");

function fixture() {
  const env = {
    EXPO_PUBLIC_DOMAIN: "example.com",
    EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_fixture",
    EXPO_PUBLIC_CLERK_PROXY_URL: "https://example.com/api/__clerk",
    SECRET_KEY: "must-not-export",
  };
  return {
    eas: { build: { preview: { channel: "preview", developmentClient: false, env: { ...env } }, production: { env } } },
    app: { expo: { runtimeVersion: "1.0.0", extra: { eas: { projectId: "test-id" } }, updates: { url: "https://u.expo.dev/test-id" } } },
  };
}

test("exports exactly three public settings, not the rest of the build environment", () => {
  const { eas, app } = fixture();
  assert.deepEqual(Object.keys(publicConfig(eas, app)), PUBLIC_KEYS);
});

test("rejects missing settings and preview/production drift without exposing values", () => {
  for (const key of PUBLIC_KEYS) {
    const { eas, app } = fixture();
    delete eas.build.production.env[key];
    assert.throws(() => publicConfig(eas, app), /Missing or invalid/);
    const other = fixture();
    other.eas.build.preview.env[key] = "wrong";
    assert.throws(() => publicConfig(other.eas, other.app), /settings differ/);
  }
});

test("rejects development credentials, incorrect channel, project URL, and runtime", () => {
  for (const mutate of [
    f => { f.eas.build.preview.channel = "production"; },
    f => { f.app.expo.runtimeVersion = "2.0.0"; },
    f => { f.app.expo.updates.url = "https://wrong.example"; },
    f => { f.eas.build.production.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = f.eas.build.preview.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_fixture"; },
  ]) {
    const f = fixture(); mutate(f);
    assert.throws(() => publicConfig(f.eas, f.app));
  }
});

test("checks the actual Android launch bundle, not a sourcemap or unrelated asset", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ota-config-test-"));
  try {
    const { eas, app } = fixture();
    const values = publicConfig(eas, app);
    fs.writeFileSync(path.join(directory, "metadata.json"), JSON.stringify({ fileMetadata: { android: { bundle: "entry.hbc" } } }));
    fs.writeFileSync(path.join(directory, "entry.hbc"), Buffer.from(Object.values(values).join("\0")));
    verifyBundle(directory, values);
    for (const key of PUBLIC_KEYS) {
      // A hostname is also a substring of the proxy URL. Remove both for the
      // missing-hostname case; substring presence alone is not origin proof.
      fs.writeFileSync(path.join(directory, "entry.hbc"), Object.entries(values).filter(([k]) =>
        k !== key && !(key === "EXPO_PUBLIC_DOMAIN" && k === "EXPO_PUBLIC_CLERK_PROXY_URL")
      ).map(([, v]) => v).join("\0"));
      assert.throws(() => verifyBundle(directory, values), /Compiled Android launch bundle is missing/);
    }
    fs.writeFileSync(path.join(directory, "metadata.json"), JSON.stringify({ fileMetadata: { android: { bundle: "../outside.hbc" } } }));
    assert.throws(() => verifyBundle(directory, values), /outside the export directory/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
