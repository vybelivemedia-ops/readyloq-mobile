#!/bin/bash
# check-r8-flags.sh — Guard against R8 minification settings that crash the app at startup.
#
# Background: commit a31f9e7 enabled three R8 flags in gradle.properties that caused
# builds 194-201 to either fail at compile time or crash immediately at startup
# (NoClassDefFoundError in expo-task-manager). All three must stay false for beta stability.
# See .agents/memory/r8-fullmode-crash.md for full context.
#
# Run automatically by post-merge.sh and registered as the "android-r8-guard" validation step.

set -e

GRADLE_PROPS="artifacts/readyloq-app/android/gradle.properties"
FAILED=0

check_flag() {
  local flag="$1"
  local file="$2"

  # Get the effective value (last occurrence wins in Gradle)
  local value
  value=$(grep -E "^${flag}=" "$file" | tail -1 | cut -d'=' -f2 | tr -d '[:space:]')

  if [ "$value" = "true" ]; then
    echo "❌  FAIL: ${flag}=true in ${file}"
    echo "         This flag crashes the app at startup. Set it to false."
    FAILED=1
  else
    echo "✅  OK:   ${flag}=${value:-<not set>}"
  fi
}

echo "Checking R8/minification flags in ${GRADLE_PROPS}..."
echo ""

check_flag "android.enableR8.fullMode"                  "$GRADLE_PROPS"
check_flag "android.enableMinifyInReleaseBuilds"        "$GRADLE_PROPS"
check_flag "android.enableShrinkResourcesInReleaseBuilds" "$GRADLE_PROPS"

echo ""

if [ "$FAILED" -eq 1 ]; then
  echo "R8 guard FAILED — one or more flags are enabled."
  echo "These settings cause startup crashes (NoClassDefFoundError in expo-task-manager)."
  echo "Revert all three flags to false before triggering an EAS build."
  exit 1
else
  echo "R8 guard PASSED — all flags are correctly set to false."
  exit 0
fi
