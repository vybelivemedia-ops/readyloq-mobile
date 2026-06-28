#!/usr/bin/env bash
# EAS Build pre-install hook.
# Replaces EAS's default `npm ci` step.
#
# Purpose: npm 10.x (used by EAS workers) has a known crash bug:
#   "npm ERR! Exit handler never called!"
# Upgrading to npm 11.x before install avoids it.
#
# EAS runs this script from the project root (readyloq-mobile/) because
# the root eas.json sets workingdir: "./readyloq-mobile".
set -euo pipefail

echo "==> Current npm version: $(npm --version)"
echo "==> Upgrading npm to 11.6.2 to avoid npm@10 Exit-handler bug..."
npm install -g npm@11.6.2
echo "==> npm version after upgrade: $(npm --version)"

echo "==> Running npm ci in $(pwd)..."
npm ci
echo "==> Install complete."
