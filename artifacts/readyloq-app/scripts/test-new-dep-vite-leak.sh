#!/bin/bash
# test-new-dep-vite-leak.sh — Regression test: confirms check-metro-bundle.sh
# catches a vite module leak introduced by a new dependency.
#
# Background
# ----------
# The Metro blockList in metro.config.js blocks vite/vitest from being bundled.
# If a developer adds a package whose import graph transitively pulls in vite,
# check-metro-bundle.sh should detect it and exit non-zero — before an EAS
# build credit is spent.
#
# Proof strategy
# --------------
# A bare non-zero exit is insufficient — the export could fail for an unrelated
# reason.  This test establishes two pre-conditions before running the export:
#
#   Pre-condition 1 — vite IS installed in Metro's nodeModulesPaths:
#     Checks that vite exists under the workspace node_modules so it would be
#     resolvable by Metro without the blockList.
#
#   Pre-condition 2 — vite IS resolvable from the probe's directory:
#     Uses Node.js require() with the same resolution paths Metro uses
#     (app node_modules + workspace root node_modules) to confirm vite can
#     actually be found from the app/ directory without any blockList.
#
# Then it runs a single expo export (with the blockList active) and asserts:
#
#   • The export exits non-zero.
#   • The error output contains "__new-dep-probe__" — proving Metro traversed
#     the import chain to the probe file (not a generic unrelated failure).
#   • The error output also contains "vite" — proving it is specifically the
#     probe's vite import that caused the rejection.  Because the probe is
#     named __new-dep-probe__ (no "vite" in its filename), any match on "vite"
#     in the output is unambiguous: it refers to the rejected module, not the
#     probe's own path.
#
# Together these three assertions prove the blockList is the specific cause:
# vite IS reachable (pre-conditions), Metro DID traverse to the probe
# (__new-dep-probe__ in error), and the probe's vite import is what failed
# ("vite" in the error, independently of the probe filename).
#
# Cleanup
# -------
# All file mutations are reversed unconditionally on EXIT, SIGTERM, and SIGHUP.
# For SIGKILL (which cannot be trapped), every mutation uses a unique marker
# string so that check-metro-bundle.sh (and the stale-run guard at the top of
# this script) can detect and remove the leftover modifications without a backup
# file.
#
# Expected output on a healthy repo:
#   Regression test PASSED — blockList caught the probe's vite import as expected.
#
# Usage (from workspace root or app directory):
#   bash artifacts/readyloq-app/scripts/test-new-dep-vite-leak.sh
#
# Run this test when:
#   • A new dependency is added that might pull vite into its transitive closure.
#   • metro.config.js blockList or resolver configuration changes.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE_ROOT="$(cd "${APP_ROOT}/../.." && pwd)"

METRO_CONFIG="${APP_ROOT}/metro.config.js"
LAYOUT_FILE="${APP_ROOT}/app/_layout.tsx"
# Probe filename deliberately does NOT contain "vite" so assertion 3 (grep for
# "vite" in the error output) is fully independent of the probe's own name.
PROBE_FILE="${APP_ROOT}/app/__new-dep-probe__.ts"
LAYOUT_BACKUP="${LAYOUT_FILE}.new-dep-test-bak"

# Unique marker embedded in every mutation so they can be found without backups.
PROBE_IMPORT_MARKER="REGRESSION-TEST-PROBE"

# ── Stale-run guard ───────────────────────────────────────────────────────────
# If a previous run was killed with SIGKILL (unkillable, trap does not fire),
# marker strings left in the files let us clean up before proceeding.
echo "=== New-dependency vite-leak regression test ==="
echo "App root: ${APP_ROOT}"
echo ""

stale_cleanup() {
  local cleaned=0
  if grep -q "$PROBE_IMPORT_MARKER" "$LAYOUT_FILE" 2>/dev/null; then
    # Marker still present — the probe import is active.  Restore from backup
    # (which was captured before injection) or fall back to sed removal.
    echo "WARNING: Removing stale probe import from app/_layout.tsx ..."
    if [ -f "$LAYOUT_BACKUP" ]; then
      cp "$LAYOUT_BACKUP" "$LAYOUT_FILE"
      rm -f "$LAYOUT_BACKUP"
    else
      sed -i "/${PROBE_IMPORT_MARKER}/d" "$LAYOUT_FILE"
    fi
    cleaned=1
  elif [ -f "$LAYOUT_BACKUP" ]; then
    # Marker is gone (e.g. check-metro-bundle.sh already cleaned it) but the
    # backup file was not removed.  Delete the orphaned backup WITHOUT restoring
    # from it — _layout.tsx is already clean and may contain legitimate edits
    # made after the interrupted run.
    echo "WARNING: Removing orphaned backup (probe already cleaned from _layout.tsx) ..."
    rm -f "$LAYOUT_BACKUP"
    cleaned=1
  fi
  # Remove stale probe file.
  if [ -f "$PROBE_FILE" ]; then
    rm -f "$PROBE_FILE"
    cleaned=1
  fi
  if [ "$cleaned" -eq 1 ]; then
    echo "  Stale files from interrupted run removed.  Starting fresh."
    echo ""
  fi
}
stale_cleanup

# ── Sanity checks ─────────────────────────────────────────────────────────────
if [ ! -f "$LAYOUT_FILE" ]; then
  echo "ERROR: app/_layout.tsx not found at ${LAYOUT_FILE}"
  echo "Run from the workspace root or readyloq-app directory."
  exit 2
fi
if [ ! -f "$METRO_CONFIG" ]; then
  echo "ERROR: metro.config.js not found at ${METRO_CONFIG}"
  exit 2
fi

cd "$APP_ROOT"

# ── Cleanup on any signal ─────────────────────────────────────────────────────
# Traps fire for EXIT, SIGTERM, SIGHUP.  For SIGKILL use the stale-run guard
# above (runs at the start of every invocation) and the marker-based detection
# in check-metro-bundle.sh.
restore_all() {
  if grep -q "$PROBE_IMPORT_MARKER" "$LAYOUT_FILE" 2>/dev/null; then
    # Marker still present — probe injection is active.  Restore from backup
    # (the clean pre-injection copy) or fall back to sed removal.
    if [ -f "$LAYOUT_BACKUP" ]; then
      cp "$LAYOUT_BACKUP" "$LAYOUT_FILE"
      rm -f "$LAYOUT_BACKUP"
    else
      sed -i "/${PROBE_IMPORT_MARKER}/d" "$LAYOUT_FILE"
    fi
  elif [ -f "$LAYOUT_BACKUP" ]; then
    # Marker is already gone but backup is still on disk — delete it without
    # restoring.  _layout.tsx is clean and may have legitimate post-injection
    # edits; restoring an old backup would silently overwrite them.
    rm -f "$LAYOUT_BACKUP"
  fi
  rm -f "$PROBE_FILE"
  echo ""
  echo "(Cleanup: app/_layout.tsx restored, probe file removed)"
}
trap restore_all EXIT SIGTERM SIGHUP

# ── Pre-condition 1: vite is installed in workspace node_modules ───────────────
echo "Pre-condition 1: Checking vite is installed in workspace node_modules ..."

VITE_MAIN=""
VITE_STORE_DIR="$(ls -d "${WORKSPACE_ROOT}/node_modules/.pnpm/vite@"*/node_modules/vite 2>/dev/null | head -1)"
if [ -n "$VITE_STORE_DIR" ] && [ -f "${VITE_STORE_DIR}/dist/node/index.js" ]; then
  VITE_MAIN="${VITE_STORE_DIR}/dist/node/index.js"
elif [ -f "${WORKSPACE_ROOT}/node_modules/vite/dist/node/index.js" ]; then
  VITE_MAIN="${WORKSPACE_ROOT}/node_modules/vite/dist/node/index.js"
fi

if [ -z "$VITE_MAIN" ]; then
  echo ""
  echo "ERROR: vite is not found in ${WORKSPACE_ROOT}/node_modules."
  echo "vite must be installed (it is a workspace dev dep used by Vite-based web"
  echo "apps) so that Metro's nodeModulesPaths can resolve it.  Run 'pnpm install'"
  echo "from the workspace root and retry."
  exit 2
fi
echo "  OK — vite found at: ${VITE_MAIN}"
echo ""

# ── Pre-condition 2: vite is resolvable from app/ via Metro's resolution paths ─
echo "Pre-condition 2: Confirming vite is resolvable from app/ via Node require ..."
echo "  (uses the same nodeModulesPaths Metro's resolver uses)"

APP_NM="${APP_ROOT}/node_modules"
ROOT_NM="${WORKSPACE_ROOT}/node_modules"

VITE_RESOLVED="$(node -e "
  const Module = require('module');
  const paths = ['${APP_NM}', '${ROOT_NM}'];
  // createRequire needs a file path (not a directory) as the 'from' specifier.
  const req = Module.createRequire('${APP_ROOT}/app/_probe_resolution_check_.js');
  try {
    const p = req.resolve('vite', { paths });
    process.stdout.write(p);
  } catch (e) {
    process.stderr.write('resolve failed: ' + e.message + '\n');
    process.exit(1);
  }
" 2>&1)" || {
  echo ""
  echo "ERROR: vite is not resolvable from app/ using Metro's nodeModulesPaths."
  echo "  Attempted paths: ${APP_NM}, ${ROOT_NM}"
  echo "  Node error: ${VITE_RESOLVED}"
  echo ""
  echo "Without a resolvable vite, the Metro blockList cannot be the cause of any"
  echo "failure — the test cannot make a valid claim.  Run 'pnpm install' and retry."
  exit 2
}

echo "  OK — vite resolves to: ${VITE_RESOLVED}"
echo "  Without the Metro blockList, the probe's 'import vite' would reach this file."
echo ""

# ── Step 1: Create the probe file ─────────────────────────────────────────────
echo "Step 1: Creating probe file app/__new-dep-probe__.ts ..."
cat > "$PROBE_FILE" << 'EOF'
// __new-dep-probe__.ts — TEMPORARY regression test file.
// Created by test-new-dep-vite-leak.sh to simulate a new dependency that
// transitively imports a build-tool module.  Deleted immediately after the
// test completes.  Do NOT commit this file.
//
// @ts-ignore — intentional for this regression test only
import "vite";
EOF
echo "  Created: ${PROBE_FILE}"
echo ""

# ── Step 2: Inject probe import into app/_layout.tsx ─────────────────────────
echo "Step 2: Injecting probe import into app/_layout.tsx ..."
cp "$LAYOUT_FILE" "$LAYOUT_BACKUP"

# The marker string in the comment lets restore_all (and check-metro-bundle.sh)
# detect and remove this line even if the backup file is missing (SIGKILL case).
PROBE_IMPORT_LINE="import \"./__new-dep-probe__\"; // ${PROBE_IMPORT_MARKER}: removed by test cleanup"

# Write to a temp file in the same directory then atomically rename it into
# place.  This eliminates the truncation window: if SIGKILL hits before rename,
# _layout.tsx is still intact (backup + original) with no partial content.
LAYOUT_TMP="$(mktemp "${LAYOUT_FILE}.tmp.XXXXXX")"
{ echo "$PROBE_IMPORT_LINE"; cat "$LAYOUT_BACKUP"; } > "$LAYOUT_TMP"
mv "$LAYOUT_TMP" "$LAYOUT_FILE"
echo "  Injected: ${PROBE_IMPORT_LINE}"
echo ""

# ── Step 3: Run check-metro-bundle.sh and capture output ─────────────────────
echo "Step 3: Running check-metro-bundle.sh with blockList active (~60–90 s) ..."
echo "  The blockList should reject the probe's 'import vite', exiting non-zero."
echo "────────────────────────────────────────────────────────────"

EXPORT_OUTPUT_FILE="$(mktemp)"
EXPORT_EXIT=0
# Set METRO_BUNDLE_CHECK_SKIP_STALE_PROBE=1 so check-metro-bundle.sh does NOT
# remove the probe import we just injected (the stale-probe guard is for
# ordinary invocations after an interrupted test, not for active test runs).
METRO_BUNDLE_CHECK_SKIP_STALE_PROBE=1 bash "${SCRIPT_DIR}/check-metro-bundle.sh" 2>&1 \
  | tee "$EXPORT_OUTPUT_FILE" || EXPORT_EXIT=$?

echo "────────────────────────────────────────────────────────────"
echo ""

# ── Step 4: Restore files before asserting ────────────────────────────────────
echo "Step 4: Restoring app/_layout.tsx and removing probe file ..."
restore_all
trap - EXIT SIGTERM SIGHUP   # prevent double-restore on clean exit below
echo ""

# ── Step 5: Assert exit code ──────────────────────────────────────────────────
if [ "$EXPORT_EXIT" -eq 0 ]; then
  rm -f "$EXPORT_OUTPUT_FILE"
  echo "Regression test FAILED — check-metro-bundle.sh exited 0 (success) even"
  echo "though app/_layout.tsx imported a file containing 'import \"vite\"'."
  echo ""
  echo "Pre-conditions confirmed vite IS resolvable, so the blockList should have"
  echo "rejected it.  Investigate:"
  echo "  grep -n 'vite' ${METRO_CONFIG}"
  exit 1
fi

# ── Step 6: Assert the error is probe-specific, not a generic failure ─────────
# Verify "__new-dep-probe__" appears in the output — this proves Metro followed the
# import chain to the probe file rather than failing for an unrelated reason.
PROBE_IN_OUTPUT="$(grep "__new-dep-probe__" "$EXPORT_OUTPUT_FILE" || true)"

# Assertion 3: look for a Metro resolver diagnostic that names both the failing
# module ("vite") and the importing file ("__new-dep-probe__") on the SAME line.
# Metro emits exactly this in its "Unable to resolve module vite from .../
# app/__new-dep-probe__.ts" error line.  No single line of the probe's source
# file contains both strings (the import statement is "import \"vite\"" and the
# filename appears only in comments on a separate line), so this match cannot be
# a false positive from Metro echoing the probe's source context.
VITE_PROBE_DIAGNOSTIC="$(grep -F "vite" "$EXPORT_OUTPUT_FILE" | grep -F "__new-dep-probe__" || true)"

rm -f "$EXPORT_OUTPUT_FILE"

if [ -z "$PROBE_IN_OUTPUT" ]; then
  echo "Regression test FAILED — export exited non-zero (exit ${EXPORT_EXIT}) but"
  echo "the error output does not mention '__new-dep-probe__'.  Metro did not"
  echo "traverse the import chain to the probe — the failure is unrelated to the guard."
  echo ""
  echo "Possible causes:"
  echo "  • The probe import was not injected into _layout.tsx before the export."
  echo "  • An earlier error in _layout.tsx prevented Metro from reaching the probe."
  echo "  • check-metro-bundle.sh's stale-probe guard removed the probe import"
  echo "    before the export ran (this should not happen — investigate the guards)."
  exit 1
fi

if [ -z "$VITE_PROBE_DIAGNOSTIC" ]; then
  echo "Regression test FAILED — export exited non-zero (exit ${EXPORT_EXIT}) and"
  echo "'__new-dep-probe__' appears in the error, but no single output line contains"
  echo "both 'vite' and '__new-dep-probe__'.  Metro reached the probe but did not"
  echo "emit the expected resolver diagnostic tying vite to the probe."
  echo ""
  echo "Expected: a line matching 'Unable to resolve module vite from .../app/__new-dep-probe__'"
  echo "Inspect the export output above.  The blockList may have changed the error"
  echo "format, or a different error triggered before vite resolution."
  exit 1
fi

# ── All assertions passed ─────────────────────────────────────────────────────
echo "Regression test PASSED — blockList caught the probe's vite import as expected."
echo ""
echo "  Pre-condition 1: vite is installed at a path in Metro's nodeModulesPaths."
echo "  Pre-condition 2: vite IS resolvable from app/ via Node require — without"
echo "                   the blockList, the probe's import would reach it."
echo "  Assertion 1:     check-metro-bundle.sh exited non-zero (exit ${EXPORT_EXIT})."
echo "  Assertion 2:     '__new-dep-probe__' appears in the error — Metro traversed"
echo "                   the import chain to the probe file."
echo "  Assertion 3:     A single error line contains both 'vite' and '__new-dep-probe__'"
echo "                   — Metro's resolver diagnostic explicitly ties the failing"
echo "                   module (vite) to the probe file.  This cannot be a false"
echo "                   positive from source-context echoes."
echo ""
echo "check-metro-bundle.sh will catch this class of leak before an EAS build is"
echo "submitted."
exit 0
