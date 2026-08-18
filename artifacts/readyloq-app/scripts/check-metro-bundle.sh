#!/bin/bash
# check-metro-bundle.sh — Validates the Android Metro bundle before EAS build submission.
#
# Runs `expo export --platform android --no-minify` locally to catch bundling
# errors (e.g. vite/vitest modules leaking into the bundle via require.context)
# in ~30–90 seconds without spending an EAS build credit.
#
# Motivation: builds 204 and 205 each failed on EAS because Metro bundled
# vite/module-runner.js — illegal in Hermes.  A local export catches the same
# error cheaply.  The Metro blockList in metro.config.js is the authoritative
# guard; this script is the pre-flight check that confirms the guard is working.
#
# Output is written to an isolated temp directory and deleted on exit, so the
# committed dist/ directory is never touched.
#
# Usage (from workspace root):
#   bash artifacts/readyloq-app/scripts/check-metro-bundle.sh

set -euo pipefail

# Resolve the app root from this script's location regardless of the caller's CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "Metro bundle check — Android (no-minify)"
echo "App root: ${APP_ROOT}"
echo ""

cd "$APP_ROOT"

# ── Environment ───────────────────────────────────────────────────────────────
# expo export needs EXPO_PUBLIC_* vars to evaluate the config.  Bundle
# correctness is independent of which Clerk environment is active, so we fall
# back to the development test key when the live key is not available.
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-localhost}"
export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-${CLERK_PUBLISHABLE_KEY:-pk_test_placeholder}}"

# ── Isolated output directory ─────────────────────────────────────────────────
# Write the export to a temporary directory so the committed dist/ tree is
# never modified.  The cleanup trap runs on success, failure, and interruption.
EXPORT_TMP="$(mktemp -d)"
cleanup() {
  rm -rf "$EXPORT_TMP"
}
trap cleanup EXIT

EXIT_CODE=0

echo "Running: npx expo export --platform android --no-minify --output-dir <tmp>"
echo "────────────────────────────────────────────────────────────"

# Capture exit code without aborting — set -e would exit before cleanup.
npx expo export --platform android --no-minify --output-dir "$EXPORT_TMP" 2>&1 || EXIT_CODE=$?

echo "────────────────────────────────────────────────────────────"

echo ""
if [ "$EXIT_CODE" -ne 0 ]; then
  echo "Metro bundle check FAILED (exit ${EXIT_CODE})"
  echo "Fix the bundling error shown above before submitting an EAS build."
  exit "$EXIT_CODE"
else
  echo "Metro bundle check PASSED — bundle is clean."
  exit 0
fi
