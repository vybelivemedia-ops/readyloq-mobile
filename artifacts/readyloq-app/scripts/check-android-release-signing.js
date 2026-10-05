#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const gradlePath = path.resolve(__dirname, "../android/app/build.gradle");
const source = fs.readFileSync(gradlePath, "utf8");

function extractBlock(text, declaration, label) {
  const match = declaration.exec(text);
  if (!match) {
    throw new Error(`Missing ${label} block in ${path.relative(process.cwd(), gradlePath)}`);
  }

  const open = text.indexOf("{", match.index);
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = open; i < text.length; i += 1) {
    const current = text[i];
    const next = text[i + 1];

    if (lineComment) {
      if (current === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (current === "\\") {
        i += 1;
      } else if (current === quote) {
        quote = null;
      }
      continue;
    }
    if (current === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }
    if (current === "'" || current === '"') {
      quote = current;
      continue;
    }
    if (current === "{") depth += 1;
    if (current === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }

  throw new Error(`Unclosed ${label} block`);
}

try {
  const android = extractBlock(source, /\bandroid\s*\{/, "android");
  const signingConfigs = extractBlock(android, /\bsigningConfigs\s*\{/, "signingConfigs");
  const buildTypes = extractBlock(android, /\bbuildTypes\s*\{/, "buildTypes");
  const releaseSigning = extractBlock(signingConfigs, /\brelease\s*\{/, "release signing config");
  const releaseBuildType = extractBlock(buildTypes, /\brelease\s*\{/, "release build type");

  if (!/\bsigningConfig\s+signingConfigs\.release\b/.test(releaseBuildType)) {
    throw new Error("Android release build type must explicitly use signingConfigs.release");
  }
  if (/^\s*signingConfig\s+.*\bdebug\b/im.test(releaseBuildType)) {
    throw new Error("Android release build type must never use signingConfigs.debug");
  }
  if (/^\s*signingConfig\s+.*\bdebug\b/im.test(releaseSigning)) {
    throw new Error("Android release signing config must never alias the debug signing config");
  }
  const debugKeystoreMarker = /debug\.keystore|androiddebugkey/i;
  if (debugKeystoreMarker.test(releaseSigning) || debugKeystoreMarker.test(releaseBuildType)) {
    throw new Error("Android release signing must never reference the debug keystore or alias");
  }

  process.stdout.write("Android release signing guard passed.\n");
} catch (error) {
  process.stderr.write(`Android release signing guard failed: ${error.message}\n`);
  process.exitCode = 1;
}