#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const APP_DIR = path.resolve(__dirname, "..");
const bakPath = path.join(APP_DIR, "package.json.bak");

if (fs.existsSync(bakPath)) {
  fs.copyFileSync(bakPath, path.join(APP_DIR, "package.json"));
  fs.unlinkSync(bakPath);
  console.log("✓ Restored package.json");
} else {
  console.log("  package.json.bak not found — nothing to restore");
}

fs.rmSync(path.join(APP_DIR, "vendor"), { recursive: true, force: true });
console.log("✓ Removed vendor/");
