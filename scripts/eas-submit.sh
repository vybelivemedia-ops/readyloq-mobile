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
METRO_CHECK="${APP_ROOT}/scripts/check-metro-bundle.sh"

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
