#!/bin/bash
# check-r8-flags.sh — Guard against R8 minification settings that crash the app at startup.
#
# Background: commit a31f9e7 enabled three R8 flags in gradle.properties that caused
# builds 194-201 to either fail at compile time or crash immediately at startup
# (NoClassDefFoundError in expo-task-manager). All three must stay false for beta stability.
# See .agents/memory/r8-fullmode-crash.md for full context.
#
# Run automatically by post-merge.sh and registered as the "android-r8-guard" validation step.
#
# Parsing rules (matches Gradle's own behaviour):
#   - leading/trailing whitespace on either side of '=' is ignored
#   - last occurrence of a duplicate key wins
#   - inline comments after the value are stripped

set -e

GRADLE_PROPS="artifacts/readyloq-app/android/gradle.properties"
FAILED=0

# resolve_flag <flag-name> <file>
# Prints the effective value of the flag (last occurrence wins, whitespace trimmed).
resolve_flag() {
  local flag="$1"
  local file="$2"
  # Match lines of the form: [whitespace]flag[whitespace]=[whitespace]value[optional comment]
  # Strip leading whitespace, the key and '=', then trim the value.
  grep -E "^[[:space:]]*$(echo "$flag" | sed 's/\./\\./g')[[:space:]]*=" "$file" \
    | tail -1 \
    | sed -E 's/^[[:space:]]*[^=]+=[[:space:]]*//' \
    | sed -E 's/[[:space:]]*#.*//' \
    | tr -d '[:space:]'
}

check_flag() {
  local flag="$1"
  local file="$2"
  local value
  value=$(resolve_flag "$flag" "$file")

  if [ "$value" = "true" ]; then
    echo "FAIL: ${flag}=true"
    echo "      This setting crashes the app at startup (NoClassDefFoundError in expo-task-manager)."
    echo "      Set it to false in ${file}."
    FAILED=1
  else
    local display="${value:-<not set>}"
    echo "OK:   ${flag}=${display}"
  fi
}

echo "Checking R8/minification flags in ${GRADLE_PROPS} ..."
echo ""

check_flag "android.enableR8.fullMode"                    "$GRADLE_PROPS"
check_flag "android.enableMinifyInReleaseBuilds"          "$GRADLE_PROPS"
check_flag "android.enableShrinkResourcesInReleaseBuilds" "$GRADLE_PROPS"

echo ""

if [ "$FAILED" -eq 1 ]; then
  echo "R8 guard FAILED — one or more flags are enabled."
  echo "Revert all three flags to false before triggering an EAS build."
  exit 1
else
  echo "R8 guard PASSED — all flags are correctly set to false."
  exit 0
fi
