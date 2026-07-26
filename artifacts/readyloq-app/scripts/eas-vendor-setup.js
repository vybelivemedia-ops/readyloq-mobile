#!/usr/bin/env node
/**
 * Vendors the @platform/* workspace packages into artifacts/readyloq-app/vendor/
 * so EAS Cloud builds can resolve them without pnpm workspace context.
 *
 * Usage: node scripts/eas-vendor-setup.js
 * Restore: node scripts/eas-vendor-restore.js
 */
const fs = require("fs");
const path = require("path");

const APP_DIR = path.resolve(__dirname, "..");
const PLATFORM_DIR = path.resolve(APP_DIR, "../../repos/platform/packages");
const VENDOR_DIR = path.resolve(APP_DIR, "vendor", "@platform");

const PACKAGES = [
  { name: "core", useDist: true },
  { name: "camera-core", useDist: false },
  { name: "shared-types", useDist: false },
  { name: "provider-registry", useDist: false },
  { name: "smart-vision", useDist: false },
  { name: "device-core", useDist: true },
  { name: "measurement-core", useDist: true },
];

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

fs.rmSync(path.join(APP_DIR, "vendor"), { recursive: true, force: true });
fs.mkdirSync(VENDOR_DIR, { recursive: true });

for (const { name, useDist } of PACKAGES) {
  const srcPkg = path.join(PLATFORM_DIR, name);
  const destPkg = path.join(VENDOR_DIR, name);
  fs.mkdirSync(destPkg, { recursive: true });

  if (useDist) {
    copyDir(path.join(srcPkg, "dist"), path.join(destPkg, "dist"));
  } else {
    copyDir(path.join(srcPkg, "src"), path.join(destPkg, "src"));
  }

  const origPkgPath = path.join(srcPkg, "package.json");
  let pkgJson;
  if (fs.existsSync(origPkgPath)) {
    pkgJson = JSON.parse(fs.readFileSync(origPkgPath, "utf8"));
  } else {
    pkgJson = {
      name: `@platform/${name}`,
      version: "0.1.0",
      private: true,
      main: "./src/index.ts",
      exports: { ".": "./src/index.ts" },
    };
  }

  if (useDist) {
    pkgJson.main = "./dist/index.js";
    pkgJson.exports = { ".": "./dist/index.js" };
  }

  for (const depType of ["dependencies", "devDependencies", "peerDependencies"]) {
    if (!pkgJson[depType]) continue;
    for (const [dep, ver] of Object.entries(pkgJson[depType])) {
      if (dep.startsWith("@platform/") && String(ver).startsWith("workspace:")) {
        const depName = dep.replace("@platform/", "");
        pkgJson[depType][dep] = `file:../${depName}`;
      }
    }
  }

  fs.writeFileSync(
    path.join(destPkg, "package.json"),
    JSON.stringify(pkgJson, null, 2)
  );
  console.log(`✓ @platform/${name}  (${useDist ? "dist" : "src"})`);
}

const appPkgPath = path.join(APP_DIR, "package.json");
const appPkg = JSON.parse(fs.readFileSync(appPkgPath, "utf8"));
fs.writeFileSync(appPkgPath + ".bak", JSON.stringify(appPkg, null, 2));

const PLATFORM_DEPS = [
  "@platform/camera-core",
  "@platform/provider-registry",
  "@platform/shared-types",
  "@platform/smart-vision",
  "@platform/device-core",
  "@platform/measurement-core",
];
for (const dep of PLATFORM_DEPS) {
  if (appPkg.dependencies?.[dep]) {
    const n = dep.replace("@platform/", "");
    appPkg.dependencies[dep] = `file:vendor/@platform/${n}`;
  }
}
fs.writeFileSync(appPkgPath, JSON.stringify(appPkg, null, 2));
console.log("✓ Patched package.json  (run eas-vendor-restore.js to undo)");
