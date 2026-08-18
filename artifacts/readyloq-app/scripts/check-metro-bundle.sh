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
#   bash artifacts/readyloq-app/scripts/check-metro-bundle.sh          # normal check
#   bash artifacts/readyloq-app/scripts/check-metro-bundle.sh --test   # self-test

set -euo pipefail

# Resolve the app root from this script's location regardless of the caller's CWD.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

METRO_CONFIG="${APP_ROOT}/metro.config.js"

# ── Environment ───────────────────────────────────────────────────────────────
# expo export needs EXPO_PUBLIC_* vars to evaluate the config.  Bundle
# correctness is independent of which Clerk environment is active, so we fall
# back to the development test key when the live key is not available.
export EXPO_PUBLIC_DOMAIN="${EXPO_PUBLIC_DOMAIN:-localhost}"
export EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY="${EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:-${CLERK_PUBLISHABLE_KEY:-pk_test_placeholder}}"

# ── Self-test mode ─────────────────────────────────────────────────────────────
# bash artifacts/readyloq-app/scripts/check-metro-bundle.sh --test
#
# Verifies end-to-end that the vite/vitest blockList in metro.config.js actually
# stops the contamination that caused builds 204–205 to fail.  The test:
#   1. Comments out the four vite/vitest blockList regexes.
#   2. Runs expo export and expects a non-zero exit code.
#   3. Restores metro.config.js unconditionally (even on Ctrl-C).
#   4. Reports PASS/FAIL based on whether the export failed as expected.
#
# A PASS means the guard is real — removing it breaks the build.
# A FAIL means the guard is ineffective and must be investigated.
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--test" ]; then
  echo "=== Metro bundle self-test: verifying the vite/vitest blockList is effective ==="
  echo "App root: ${APP_ROOT}"
  echo ""

  cd "$APP_ROOT"

  METRO_BACKUP="${METRO_CONFIG}.self-test-bak"
  EXPORT_TMP="$(mktemp -d)"

  # Restore metro.config.js and clean up temp dir on any exit (success,
  # failure, or interruption).
  restore_all() {
    if [ -f "$METRO_BACKUP" ]; then
      cp "$METRO_BACKUP" "$METRO_CONFIG"
      rm -f "$METRO_BACKUP"
      echo ""
      echo "(metro.config.js restored)"
    fi
    rm -rf "$EXPORT_TMP"
  }
  trap restore_all EXIT

  # Step 1 — disable the four vite/vitest blockList regexes.
  echo "Step 1: Commenting out vite/vitest blockList entries in metro.config.js ..."
  cp "$METRO_CONFIG" "$METRO_BACKUP"

  # Match lines whose content includes the vite/vitest resolver regexes and
  # prepend a JS comment marker.  GNU sed `\|...|` uses `|` as the regex
  # delimiter so the `/` characters inside the pattern don't need escaping.
  # The four target lines all contain "node_modules" and "vite":
  #   /[/\\]node_modules[/\\]\.pnpm[/\\]vite[@+]/,
  #   /[/\\]node_modules[/\\]\.pnpm[/\\]vitest[@+]/,
  #   /[/\\]node_modules[/\\]vite[/\\]/,
  #   /[/\\]node_modules[/\\]vitest[/\\]/,
  sed -i '\|node_modules.*vite|s|^|// SELF-TEST-DISABLED: |' "$METRO_CONFIG"

  # Verify that the substitution actually modified lines.
  DISABLED_COUNT=$(grep -c "SELF-TEST-DISABLED" "$METRO_CONFIG" || true)
  if [ "$DISABLED_COUNT" -lt 4 ]; then
    echo "ERROR: expected to disable 4 vite/vitest blockList lines, found ${DISABLED_COUNT}."
    echo "The blockList regexes may have changed.  Update the sed pattern in this script."
    exit 2
  fi
  echo "  Disabled ${DISABLED_COUNT} vite/vitest blockList line(s)."
  echo ""

  # Step 2 — run the export and capture the exit code.
  echo "Step 2: Running expo export without the blockList (~60–90 s) ..."
  echo "────────────────────────────────────────────────────────────"

  TEST_EXIT_CODE=0
  npx expo export --platform android --no-minify --output-dir "$EXPORT_TMP" 2>&1 \
    || TEST_EXIT_CODE=$?

  echo "────────────────────────────────────────────────────────────"
  echo ""

  # Step 3 — restore immediately (the trap also runs on exit, making this
  # idempotent; calling it early gives cleaner log ordering).
  echo "Step 3: Restoring metro.config.js ..."
  restore_all
  trap - EXIT   # prevent double-restore on clean exit below

  echo ""

  # Step 4 — assert that the export failed.
  echo "Step 4: Asserting expo export exited non-zero (contaminated bundle expected) ..."
  echo ""

  if [ "$TEST_EXIT_CODE" -ne 0 ]; then
    echo "Self-test PASSED — export failed (exit ${TEST_EXIT_CODE}) as expected when the"
    echo "vite/vitest blockList was removed.  The guard is effective."
    exit 0
  else
    echo "Self-test FAILED — expo export succeeded even without the vite/vitest blockList."
    echo ""
    echo "Possible causes:"
    echo "  • vite/vitest are no longer reachable from the app's import graph"
    echo "    (the blockList may now guard a path that no longer exists)."
    echo "  • The sed pattern above did not disable the correct lines."
    echo "    Run: grep -n 'vite' ${METRO_CONFIG}"
    echo "  • A Metro or Expo upgrade changed how blockList is applied."
    echo ""
    echo "Investigate before relying on the Metro bundle check as a pre-flight guard."
    exit 1
  fi
fi

# ── Normal check ──────────────────────────────────────────────────────────────

echo "Metro bundle check — Android (no-minify)"
echo "App root: ${APP_ROOT}"
echo ""

cd "$APP_ROOT"

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
