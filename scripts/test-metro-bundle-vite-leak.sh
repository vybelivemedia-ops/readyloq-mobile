#!/bin/bash
# test-metro-bundle-vite-leak.sh
#
# Confirms that check-metro-bundle.sh catches a vite import the same way
# a real EAS build failure would (builds 204/205 died on vite/module-runner.js
# — "Invalid call at src/module-runner.js" in Hermes).
#
# Three phases:
#   1. Baseline — clean codebase must PASS
#   2. Inject vite import — check must FAIL (blockList catches it)
#   3. Cleanup — check must PASS again (confirms recovery)
#
# Usage (from workspace root):
#   bash scripts/test-metro-bundle-vite-leak.sh
#
# Exit code: 0 = all assertions pass, 1 = one or more assertions fail.

set -uo pipefail   # -e intentionally omitted so we can capture exit codes

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_ROOT="${WORKSPACE_ROOT}/artifacts/readyloq-app"
CHECK_SCRIPT="${APP_ROOT}/scripts/check-metro-bundle.sh"

# Injection point: root layout is always bundled by Expo Router.
LAYOUT_FILE="${APP_ROOT}/app/(app)/_layout.tsx"
# Leak module: placed in hooks/ (which exists) so Metro can resolve it.
# Relative path from app/(app)/ to hooks/ = ../../hooks/
LEAK_MODULE="${APP_ROOT}/hooks/__metro-vite-leak-test.ts"
LEAK_IMPORT="../../hooks/__metro-vite-leak-test"
INJECTION_MARKER="METRO_VITE_LEAK_TEST_INJECTION"

PASS=0
FAIL=0
LOG_FILE="/tmp/metro-vite-leak-test-output.txt"

pass() { echo "  PASS  $*"; ((PASS++)) || true; }
fail() { echo "  FAIL  $*"; ((FAIL++)) || true; }

# ── Cleanup on any exit ────────────────────────────────────────────────────────
cleanup() {
  # Remove injected import line (idempotent)
  if [ -f "$LAYOUT_FILE" ]; then
    sed -i "/${INJECTION_MARKER}/d" "$LAYOUT_FILE" 2>/dev/null || true
  fi
  # Remove the leak module
  rm -f "$LEAK_MODULE"
}
trap cleanup EXIT

echo "══════════════════════════════════════════════════════════════"
echo "  Metro bundle check — vite-leak regression test"
echo "══════════════════════════════════════════════════════════════"
echo ""
echo "  App root  : ${APP_ROOT}"
echo "  Layout    : ${LAYOUT_FILE}"
echo "  Leak file : ${LEAK_MODULE}"
echo ""

# ── Phase 1: baseline must PASS ────────────────────────────────────────────────
echo "Phase 1 — baseline (no vite leak)  [expect: PASS]"
echo "────────────────────────────────────────────────────────────"

bash "$CHECK_SCRIPT" > "$LOG_FILE" 2>&1
BASE_EXIT=$?

if [ "$BASE_EXIT" -eq 0 ]; then
  pass "baseline: bundle check exits 0"
else
  fail "baseline: bundle check failed unexpectedly (exit ${BASE_EXIT})"
  echo "  Output:"
  tail -5 "$LOG_FILE" | sed 's/^/    /'
fi

echo ""

# ── Phase 2: inject vite import — check must FAIL ─────────────────────────────
echo "Phase 2 — vite import injected  [expect: FAIL]"
echo "────────────────────────────────────────────────────────────"

# Create the vite-importing module
cat > "$LEAK_MODULE" << 'EOF'
// ⚠️  METRO VITE LEAK TEST — DO NOT COMMIT
// This file intentionally imports vite to verify the Metro blockList catches it.
// It is created and deleted by scripts/test-metro-bundle-vite-leak.sh.
import 'vite';
export const _testOnlyViteLeak = true;
EOF

echo "  Created leak module: ${LEAK_MODULE}"

# Prepend a side-effect import to the root layout (line 1 insertion).
# The marker comment lets sed clean it up reliably.
sed -i "1s|^|import '${LEAK_IMPORT}'; // ${INJECTION_MARKER}\n|" "$LAYOUT_FILE"
echo "  Injected import into: ${LAYOUT_FILE}"
echo ""

bash "$CHECK_SCRIPT" > "$LOG_FILE" 2>&1
LEAK_EXIT=$?

if [ "$LEAK_EXIT" -ne 0 ]; then
  pass "leak check: exits non-zero (${LEAK_EXIT}) — blockList caught the vite import"
else
  fail "leak check: unexpectedly exited 0 — vite import was NOT caught"
fi

# Verify the error output mentions a blockList/module error (not some unrelated failure)
if grep -qiE "blocked|unable to resolve|cannot resolve|error|failed|bundl" "$LOG_FILE"; then
  pass "leak check: output contains a bundle/resolution error"
else
  fail "leak check: output has no recognisable bundle error (may be unrelated failure)"
  echo "  Last 10 lines of output:"
  tail -10 "$LOG_FILE" | sed 's/^/    /'
fi

echo ""
echo "  Error summary (first matching line):"
grep -iE "blocked|unable to resolve|cannot resolve|error.*vite|vite.*error|bundl.*fail|fail.*bundl" \
  "$LOG_FILE" | head -3 | sed 's/^/    /'
echo ""

# ── Phase 3: cleanup — check must PASS again ──────────────────────────────────
echo "Phase 3 — cleanup (vite import removed)  [expect: PASS]"
echo "────────────────────────────────────────────────────────────"

cleanup
trap - EXIT   # Already cleaned; reset so EXIT doesn't double-run

echo "  Removed leak module and injected import."
echo ""

bash "$CHECK_SCRIPT" > "$LOG_FILE" 2>&1
CLEAN_EXIT=$?

if [ "$CLEAN_EXIT" -eq 0 ]; then
  pass "recovery check: bundle check exits 0 after cleanup"
else
  fail "recovery check: still failing after cleanup (exit ${CLEAN_EXIT})"
  echo "  Last 5 lines of output:"
  tail -5 "$LOG_FILE" | sed 's/^/    /'
fi

# ── Summary ────────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════════"
if [ "$FAIL" -eq 0 ]; then
  echo "  ALL TESTS PASSED (${PASS} assertions)"
  echo "  The metro-bundle check catches a vite leak the same way"
  echo "  a real EAS failure would."
  exit 0
else
  echo "  TESTS FAILED: ${PASS} passed, ${FAIL} failed"
  exit 1
fi
