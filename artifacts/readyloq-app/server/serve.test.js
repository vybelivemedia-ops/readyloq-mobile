const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const serverModules = [
  ["readyloq-app", require("./serve")],
  ["readyloq-api", require("../../readyloq-api/server/serve")],
];

function request(port, requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: requestPath,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf-8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

for (const [name, { createServer }] of serverModules) {
  test(`${name} static serving enforces canonical root boundaries`, async (t) => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "readyloq-serve-"));
    const staticRoot = path.join(tempRoot, "static-build");
    const outsideDir = path.join(tempRoot, "outside");
    const outsideFile = path.join(tempRoot, "secret.txt");
    fs.mkdirSync(path.join(staticRoot, "nested"), { recursive: true });
    fs.mkdirSync(path.join(staticRoot, "ios"), { recursive: true });
    fs.mkdirSync(path.join(staticRoot, "android"), { recursive: true });
    fs.mkdirSync(outsideDir);
    fs.writeFileSync(path.join(staticRoot, "nested", "asset.js"), "safe asset");
    fs.writeFileSync(path.join(staticRoot, "inside.txt"), "inside");
    fs.writeFileSync(outsideFile, "outside secret");
    fs.writeFileSync(path.join(outsideDir, "secret.txt"), "outside directory secret");
    fs.writeFileSync(path.join(staticRoot, "ios", "manifest.json"), '{"platform":"ios"}');
    fs.writeFileSync(
      path.join(staticRoot, "android", "manifest.json"),
      '{"platform":"android"}',
    );
    fs.symlinkSync(outsideFile, path.join(staticRoot, "leak.txt"));
    fs.symlinkSync(outsideDir, path.join(staticRoot, "leak-dir"), "dir");

    const server = createServer({
      staticRoot,
      landingPageTemplate: "landing",
      appName: "test",
    });
    t.after(async () => {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;

    const nested = await request(port, "/nested/asset.js");
    assert.equal(nested.status, 200);
    assert.equal(nested.body, "safe asset");
    assert.equal(nested.headers["content-type"], "application/javascript; charset=utf-8");

    const normalized = await request(port, "/nested/../inside.txt");
    assert.equal(normalized.status, 200);
    assert.equal(normalized.body, "inside");

    for (const traversalPath of [
      "/%2e%2e%2fsecret.txt",
      "/nested/../../secret.txt",
      `/%2F${outsideFile.replace(/^\/+/, "")}`,
      "/%2e%2e%5csecret.txt",
      "/leak.txt",
      "/leak-dir/secret.txt",
    ]) {
      const response = await request(port, traversalPath);
      assert.notEqual(response.body, "outside secret", traversalPath);
      assert.notEqual(
        response.body,
        "outside directory secret",
        traversalPath,
      );
      assert.ok(
        response.status === 403 || response.status === 404,
        `${traversalPath} returned ${response.status}`,
      );
    }

    const iosManifest = await request(port, "/manifest", {
      "expo-platform": "ios",
    });
    assert.equal(iosManifest.status, 200);
    assert.equal(iosManifest.body, '{"platform":"ios"}');
    assert.equal(iosManifest.headers["expo-protocol-version"], "1");
    assert.equal(iosManifest.headers["content-type"], "application/json");

    const androidManifest = await request(port, "/manifest", {
      "expo-platform": "android",
    });
    assert.equal(androidManifest.status, 200);
    assert.equal(androidManifest.body, '{"platform":"android"}');

    const injectedPlatform = await request(port, "/manifest", {
      "expo-platform": "ios, x-injected-header: yes",
    });
    assert.equal(injectedPlatform.status, 404);
    assert.equal(injectedPlatform.headers["expo-protocol-version"], undefined);
    assert.equal(injectedPlatform.headers["x-injected-header"], undefined);
  });
}