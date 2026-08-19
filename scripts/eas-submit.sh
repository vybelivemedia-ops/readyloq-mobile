#!/bin/bash
# eas-submit.sh — Safe EAS build submission wrapper.
#
# Runs the two mandatory pre-flight checks before calling `eas build`.
# Prevents an R8 flag re-enable or a Metro bundle regression from burning
# an EAS build credit (see BUILDING.md for background).
#
# Usage (from workspace root):
#   bash scripts/eas-submit.sh --platform android --profile preview --non-interactive --no-wait
#
# All flags except --dry-run are forwarded verbatim to `eas build`.
#
# Flags:
#   --dry-run         Run the pre-flight checks but skip the actual eas build call.
#                     Use this to verify checks pass without spending a build credit.
#   --platform <p>    Forwarded to eas build (android | ios | all)
#   --profile <p>     Forwarded to eas build (preview | production | development)
#   --non-interactive Forwarded to eas build
#   --no-wait         Forwarded to eas build (strongly recommended — avoids bash timeout)
#   Any other flag    Forwarded to eas build unchanged
#
# Environment:
#   EXPO_TOKEN        Required. Set as a Replit secret.
#   EAS_NO_VCS        Defaults to 1 (required in the Replit sandbox).
#   EAS_SKIP_AUTO_FINGERPRINT  Defaults to 1.

set -uo pipefail   # -e intentionally omitted so check failures produce clear messages

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_ROOT="${WORKSPACE_ROOT}/artifacts/readyloq-app"

R8_CHECK="${SCRIPT_DIR}/check-r8-flags.sh"
# Allow env-var override so tests can stub the Metro check without modifying
# the actual bundle script or running a full 60–90 s Metro build.
METRO_CHECK="${METRO_CHECK:-${APP_ROOT}/scripts/check-metro-bundle.sh}"

# ── Parse flags ────────────────────────────────────────────────────────────────
# Strip --dry-run before forwarding the rest to eas build.
DRY_RUN=0
EAS_ARGS=()
for arg in "$@"; do
  if [ "$arg" = "--dry-run" ]; then
    DRY_RUN=1
  else
    EAS_ARGS+=("$arg")
  fi
done

# ── Pretty output helpers ──────────────────────────────────────────────────────
banner()  { echo ""; echo "══════════════════════════════════════════════════════"; echo "  $*"; echo "══════════════════════════════════════════════════════"; }
step()    { echo ""; echo "▶  $*"; }
ok()      { echo "  ✔  $*"; }
err()     { echo "  ✖  $*" >&2; }

# ── Guard: EXPO_TOKEN ─────────────────────────────────────────────────────────
# ── Self-test mode ─────────────────────────────────────────────────────────────
# bash scripts/eas-submit.sh --test
# Verifies that:
#   1. A truthy R8 flag in gradle.properties aborts the wrapper with exit 1
#      BEFORE `eas build` would be called.
#   2. All three flags being falsy allows the wrapper to proceed (in dry-run).
# Uses GRADLE_PROPS env-var override accepted by check-r8-flags.sh so no real
# file is modified; the EXPO_TOKEN guard is bypassed because --dry-run is used.
if [ "${1:-}" = "--test" ]; then
  PASS=0; FAIL=0
  pass_test() { echo "  PASS  $1"; ((PASS++)) || true; }
  fail_test() { echo "  FAIL  $1"; ((FAIL++)) || true; }

  # ── Test 1: R8 flag truthy → wrapper exits 1 (eas build NOT called) ──────────
  TMP_PROPS=$(mktemp)
  cat > "$TMP_PROPS" <<'PROPS'
android.enableR8.fullMode=true
android.enableMinifyInReleaseBuilds=false
android.enableShrinkResourcesInReleaseBuilds=false
PROPS

  # Run wrapper in dry-run to avoid needing EXPO_TOKEN; truthy flag must abort.
  GRADLE_PROPS="$TMP_PROPS" bash "$0" --dry-run >/dev/null 2>&1
  EXIT_CODE=$?
  if [ "$EXIT_CODE" -ne 0 ]; then
    pass_test "truthy R8 flag: wrapper exits non-zero (eas build blocked)"
  else
    fail_test "truthy R8 flag: wrapper should have exited non-zero but returned 0"
  fi

  # Confirm the guard stops BEFORE the dry-run 'would run' message.
  OUTPUT=$(GRADLE_PROPS="$TMP_PROPS" bash "$0" --dry-run 2>&1 || true)
  if echo "$OUTPUT" | grep -q "Would run"; then
    fail_test "truthy R8 flag: 'Would run' message should NOT appear when guard fails"
  else
    pass_test "truthy R8 flag: 'Would run' message absent — eas build truly blocked"
  fi

  rm -f "$TMP_PROPS"

  # ── Test 2: all flags false → wrapper proceeds past R8 guard ─────────────────
  TMP_PROPS=$(mktemp)
  cat > "$TMP_PROPS" <<'PROPS'
android.enableR8.fullMode=false
android.enableMinifyInReleaseBuilds=false
android.enableShrinkResourcesInReleaseBuilds=false
PROPS

  # Metro check will also run; stub it by temporarily overriding METRO_CHECK.
  # We only care that the R8 guard passes and the wrapper reaches dry-run output.
  # Use an inline stub that always succeeds so Metro doesn't slow down the test.
  TMPMETRO=$(mktemp)
  echo '#!/bin/bash'; echo 'exit 0' > "$TMPMETRO"
  chmod +x "$TMPMETRO"

  OUTPUT=$(GRADLE_PROPS="$TMP_PROPS" METRO_CHECK="$TMPMETRO" bash "$0" --dry-run 2>&1 || true)
  if echo "$OUTPUT" | grep -q "Would run"; then
    pass_test "all flags false: wrapper proceeds to dry-run output"
  else
    fail_test "all flags false: expected 'Would run' in output but got: ${OUTPUT}"
  fi

  rm -f "$TMP_PROPS" "$TMPMETRO"

  echo ""
  if [ "$FAIL" -gt 0 ]; then
    echo "EAS submit wrapper tests FAILED: ${PASS} passed, ${FAIL} failed"
    exit 1
  else
    echo "EAS submit wrapper tests PASSED (${PASS} assertions)"
    exit 0
  fi
fi

if [ -z "${EXPO_TOKEN:-}" ] && [ "$DRY_RUN" -eq 0 ]; then
  err "EXPO_TOKEN is not set. Export it before running this script."
  echo ""
  echo "  On Replit the token is a managed secret — it should be available"
  echo "  automatically. If missing, re-add it in the Replit Secrets panel."
  exit 1
fi

banner "EAS Submit — pre-flight checks"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "  [DRY RUN] Checks will run; eas build will NOT be called."
fi

# ── Check 1: R8 flags (~1 s) ──────────────────────────────────────────────────
step "Check 1/2: R8 flags guard  (~1 s)"
echo "──────────────────────────────────────────────────────"
R8_EXIT=0
bash "$R8_CHECK" 2>&1 || R8_EXIT=$?
echo "──────────────────────────────────────────────────────"

if [ "$R8_EXIT" -eq 0 ]; then
  ok "R8 flags guard passed"
else
  err "R8 flags guard FAILED — eas build aborted."
  echo "" >&2
  echo "  Fix: revert all three flags to false in" >&2
  echo "  artifacts/readyloq-app/android/gradle.properties:" >&2
  echo "" >&2
  echo "    android.enableR8.fullMode=false" >&2
  echo "    android.enableMinifyInReleaseBuilds=false" >&2
  echo "    android.enableShrinkResourcesInReleaseBuilds=false" >&2
  echo "" >&2
  echo "  Do NOT add -dontwarn rules as a workaround — they silence the" >&2
  echo "  compile error but not the runtime NoClassDefFoundError crash." >&2
  exit 1
fi

# ── Check 2: Metro bundle (~60-90 s) ─────────────────────────────────────────
step "Check 2/2: Metro bundle check  (~60-90 s)"
echo "──────────────────────────────────────────────────────"
METRO_EXIT=0
bash "$METRO_CHECK" 2>&1 || METRO_EXIT=$?
echo "──────────────────────────────────────────────────────"

if [ "$METRO_EXIT" -eq 0 ]; then
  ok "Metro bundle check passed"
else
  err "Metro bundle check FAILED — eas build aborted."
  echo "" >&2
  echo "  Fix the bundling error shown above, then re-run:" >&2
  echo "    bash artifacts/readyloq-app/scripts/check-metro-bundle.sh" >&2
  exit 1
fi

# ── Both checks passed ────────────────────────────────────────────────────────
banner "Both checks passed"

if [ "$DRY_RUN" -eq 1 ]; then
  echo ""
  echo "  [DRY RUN] Would run from ${APP_ROOT}:"
  echo "    EAS_NO_VCS=1 EAS_SKIP_AUTO_FINGERPRINT=1 EXPO_TOKEN=<token> \\"
  echo "      npx eas build ${EAS_ARGS[*]:-<no flags provided>}"
  echo ""
  echo "  Remove --dry-run to submit the actual build."
  exit 0
fi

# ── Submit ────────────────────────────────────────────────────────────────────
echo ""
echo "  Submitting from: ${APP_ROOT}"
echo "  Command:  npx eas build ${EAS_ARGS[*]}"
echo ""

cd "$APP_ROOT"

export EAS_NO_VCS="${EAS_NO_VCS:-1}"
export EAS_SKIP_AUTO_FINGERPRINT="${EAS_SKIP_AUTO_FINGERPRINT:-1}"

npx eas build "${EAS_ARGS[@]}"
