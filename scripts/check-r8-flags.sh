#!/bin/bash
# check-r8-flags.sh — Guard against R8 minification settings that crash the app at startup.
#
# Background: commit a31f9e7 enabled three R8 flags in gradle.properties that caused
# builds 194-201 to either fail at compile time or crash immediately at startup
# (NoClassDefFoundError in expo-task-manager). All three must stay false for beta stability.
# See .agents/memory/r8-fullmode-crash.md for full context.
#
# Parsing rules (matches Gradle + Groovy behaviour):
#   - Optional whitespace around '='
#   - Leading/trailing whitespace on key and value
#   - Inline # comments stripped
#   - Last occurrence of a duplicate key wins
#   - Truthy values: case-insensitive "true", "y", "1"  (Groovy String.toBoolean() + ints)
#
# Usage:
#   bash scripts/check-r8-flags.sh          # normal check
#   bash scripts/check-r8-flags.sh --test   # run self-tests

set -euo pipefail

GRADLE_PROPS="artifacts/readyloq-app/android/gradle.properties"

# ---------------------------------------------------------------------------
# resolve_flag <flag-name> <file>
#   Returns the effective value of the last matching key, with whitespace and
#   inline comments stripped.  Dots in the key are escaped for the regex.
# ---------------------------------------------------------------------------
resolve_flag() {
  local flag="$1"
  local file="$2"
  local escaped_flag
  escaped_flag=$(printf '%s' "$flag" | sed 's/\./\\./g')
  # Wrap grep in a group so a no-match exit-1 doesn't abort under pipefail.
  { grep -E "^[[:space:]]*${escaped_flag}[[:space:]]*=" "$file" 2>/dev/null || true; } \
    | tail -1 \
    | sed -E 's/^[[:space:]]*[^=]+=[[:space:]]*//' \
    | sed -E 's/[[:space:]]*#.*//'                 \
    | tr -d '[:space:]'
}

# ---------------------------------------------------------------------------
# is_truthy <value>
#   Returns 0 (true) for case-insensitive "true", "y", or "1".
# ---------------------------------------------------------------------------
is_truthy() {
  local val
  val=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  case "$val" in
    true|y|1) return 0 ;;
    *)         return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# check_flag <flag-name> <file> <failed-ref>
# ---------------------------------------------------------------------------
check_flag() {
  local flag="$1"
  local file="$2"
  local value
  value=$(resolve_flag "$flag" "$file")

  if is_truthy "$value"; then
    echo "FAIL: ${flag}=${value}"
    echo "      This setting crashes the app at startup (NoClassDefFoundError in expo-task-manager)."
    echo "      Set it to false in ${file}."
    return 1
  else
    local display="${value:-<not set>}"
    echo "OK:   ${flag}=${display}"
    return 0
  fi
}

# ---------------------------------------------------------------------------
# Self-test mode: bash scripts/check-r8-flags.sh --test
# ---------------------------------------------------------------------------
run_tests() {
  local pass=0 fail=0

  assert_truthy() {
    local val="$1"
    if is_truthy "$val"; then
      echo "  PASS  is_truthy('${val}')"
      ((pass++)) || true
    else
      echo "  FAIL  is_truthy('${val}') expected truthy"
      ((fail++)) || true
    fi
  }

  assert_falsy() {
    local val="$1"
    if ! is_truthy "$val"; then
      echo "  PASS  is_truthy('${val}') => falsy"
      ((pass++)) || true
    else
      echo "  FAIL  is_truthy('${val}') expected falsy"
      ((fail++)) || true
    fi
  }

  assert_resolves() {
    local desc="$1" content="$2" flag="$3" expected="$4"
    local tmpf; tmpf=$(mktemp)
    printf '%s\n' "$content" > "$tmpf"
    local got; got=$(resolve_flag "$flag" "$tmpf")
    rm -f "$tmpf"
    if [ "$got" = "$expected" ]; then
      echo "  PASS  resolve '${desc}' => '${got}'"
      ((pass++)) || true
    else
      echo "  FAIL  resolve '${desc}': expected '${expected}', got '${got}'"
      ((fail++)) || true
    fi
  }

  echo "=== is_truthy() ==="
  assert_truthy "true"
  assert_truthy "TRUE"
  assert_truthy "True"
  assert_truthy "y"
  assert_truthy "Y"
  assert_truthy "1"
  assert_falsy  "false"
  assert_falsy  "FALSE"
  assert_falsy  "False"
  assert_falsy  "0"
  assert_falsy  "n"
  assert_falsy  ""

  echo ""
  echo "=== resolve_flag() ==="
  assert_resolves "normal false"              "android.enableR8.fullMode=false"              "android.enableR8.fullMode" "false"
  assert_resolves "normal true"              "android.enableR8.fullMode=true"               "android.enableR8.fullMode" "true"
  assert_resolves "uppercase TRUE"           "android.enableR8.fullMode=TRUE"               "android.enableR8.fullMode" "TRUE"
  assert_resolves "spaces around ="         "android.enableR8.fullMode = true"             "android.enableR8.fullMode" "true"
  assert_resolves "leading whitespace"       "  android.enableR8.fullMode=true"             "android.enableR8.fullMode" "true"
  assert_resolves "inline comment stripped"  "android.enableR8.fullMode=true # enabled"    "android.enableR8.fullMode" "true"
  assert_resolves "last-wins false→true"     "$(printf 'android.enableR8.fullMode=false\nandroid.enableR8.fullMode=true')" \
                                                                                            "android.enableR8.fullMode" "true"
  assert_resolves "last-wins true→false"     "$(printf 'android.enableR8.fullMode=true\nandroid.enableR8.fullMode=false')" \
                                                                                            "android.enableR8.fullMode" "false"
  assert_resolves "value 1 (int truthy)"     "android.enableMinifyInReleaseBuilds=1"        "android.enableMinifyInReleaseBuilds" "1"
  assert_resolves "value y (char truthy)"    "android.enableShrinkResourcesInReleaseBuilds=y" "android.enableShrinkResourcesInReleaseBuilds" "y"
  assert_resolves "missing key"              "something.else=true"                          "android.enableR8.fullMode" ""

  echo ""
  if [ "$fail" -gt 0 ]; then
    echo "TESTS FAILED: ${pass} passed, ${fail} failed"
    exit 1
  else
    echo "ALL TESTS PASSED (${pass} assertions)"
    exit 0
  fi
}

if [ "${1:-}" = "--test" ]; then
  run_tests
fi

# ---------------------------------------------------------------------------
# Main guard
# ---------------------------------------------------------------------------
echo "Checking R8/minification flags in ${GRADLE_PROPS} ..."
echo ""

FAILED=0
check_flag "android.enableR8.fullMode"                    "$GRADLE_PROPS" || FAILED=1
check_flag "android.enableMinifyInReleaseBuilds"          "$GRADLE_PROPS" || FAILED=1
check_flag "android.enableShrinkResourcesInReleaseBuilds" "$GRADLE_PROPS" || FAILED=1

echo ""

if [ "$FAILED" -eq 1 ]; then
  echo "R8 guard FAILED — one or more flags are enabled."
  echo "Revert all three flags to false before triggering an EAS build."
  exit 1
else
  echo "R8 guard PASSED — all flags are correctly set to false."
  exit 0
fi
