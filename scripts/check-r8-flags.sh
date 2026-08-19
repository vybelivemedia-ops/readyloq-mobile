#!/bin/bash
# check-r8-flags.sh — Guard against R8 minification settings that crash the app at startup.
#
# Background: commit a31f9e7 enabled three R8 flags in gradle.properties that caused
# builds 194-201 to either fail at compile time or crash immediately at startup
# (NoClassDefFoundError in expo-task-manager). All three must stay false for beta stability.
# See .agents/memory/r8-fullmode-crash.md for full context.
#
# Parsing: delegates to scripts/parse-gradle-prop.mjs — a full Java Properties spec
# parser that handles line continuations, Unicode escapes, and all separator forms.
#
# Usage:
#   bash scripts/check-r8-flags.sh          # normal check
#   bash scripts/check-r8-flags.sh --test   # run self-tests

set -euo pipefail

# Allow callers (and tests) to override the properties file path via env var.
GRADLE_PROPS="${GRADLE_PROPS:-artifacts/readyloq-app/android/gradle.properties}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARSER="${SCRIPT_DIR}/parse-gradle-prop.mjs"

# ---------------------------------------------------------------------------
# resolve_flag <flag-name> <file>
#   Delegates to the Node.js parser for spec-compliant Java properties parsing.
#   Exits 2 if the file cannot be read.
# ---------------------------------------------------------------------------
resolve_flag() {
  local flag="$1"
  local file="$2"
  if [ ! -r "$file" ]; then
    echo "ERROR: cannot read ${file}" >&2
    exit 2
  fi
  node "$PARSER" "$file" "$flag"
}

# ---------------------------------------------------------------------------
# is_truthy <value>
#   Returns 0 (success/true) for Groovy-truthy aliases: true/TRUE/y/Y/1.
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
# check_flag <flag-name> <file>  — sets FAILED=1 on a truthy value
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
    FAILED=1
  else
    local display="${value:-<not set>}"
    echo "OK:   ${flag}=${display}"
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
      echo "  FAIL  is_truthy('${val}') — expected truthy"
      ((fail++)) || true
    fi
  }

  assert_falsy() {
    local val="$1"
    if ! is_truthy "$val"; then
      echo "  PASS  is_truthy('${val}') => falsy"
      ((pass++)) || true
    else
      echo "  FAIL  is_truthy('${val}') — expected falsy"
      ((fail++)) || true
    fi
  }

  # assert_resolves <desc> <file-content> <flag> <expected-value>
  assert_resolves() {
    local desc="$1" content="$2" flag="$3" expected="$4"
    local tmpf; tmpf=$(mktemp)
    printf '%s' "$content" > "$tmpf"
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
  echo "=== resolve_flag() — '=' separator ==="
  assert_resolves "normal false"              $'android.enableR8.fullMode=false'               "android.enableR8.fullMode" "false"
  assert_resolves "normal true"               $'android.enableR8.fullMode=true'                "android.enableR8.fullMode" "true"
  assert_resolves "uppercase TRUE"            $'android.enableR8.fullMode=TRUE'                "android.enableR8.fullMode" "TRUE"
  assert_resolves "spaces around ="           $'android.enableR8.fullMode = true'              "android.enableR8.fullMode" "true"
  assert_resolves "leading whitespace"        $'  android.enableR8.fullMode=true'              "android.enableR8.fullMode" "true"
  assert_resolves "last-wins false→true"      $'android.enableR8.fullMode=false\nandroid.enableR8.fullMode=true'  "android.enableR8.fullMode" "true"
  assert_resolves "last-wins true→false"      $'android.enableR8.fullMode=true\nandroid.enableR8.fullMode=false' "android.enableR8.fullMode" "false"
  assert_resolves "value 1 (int truthy)"      $'android.enableMinifyInReleaseBuilds=1'         "android.enableMinifyInReleaseBuilds" "1"
  assert_resolves "value y (char truthy)"     $'android.enableShrinkResourcesInReleaseBuilds=y' "android.enableShrinkResourcesInReleaseBuilds" "y"
  assert_resolves "missing key"               $'something.else=true'                           "android.enableR8.fullMode" ""
  assert_resolves "# comment line skipped"    $'# android.enableR8.fullMode=true\nandroid.enableR8.fullMode=false' "android.enableR8.fullMode" "false"

  echo ""
  echo "=== resolve_flag() — ':' separator ==="
  assert_resolves "colon separator true"      $'android.enableR8.fullMode:true'                "android.enableR8.fullMode" "true"
  assert_resolves "colon + spaces true"       $'android.enableR8.fullMode : true'              "android.enableR8.fullMode" "true"
  assert_resolves "colon separator false"     $'android.enableMinifyInReleaseBuilds:false'     "android.enableMinifyInReleaseBuilds" "false"
  assert_resolves "colon + leading ws TRUE"   $'  android.enableR8.fullMode:TRUE'              "android.enableR8.fullMode" "TRUE"

  echo ""
  echo "=== resolve_flag() — whitespace-only separator ==="
  assert_resolves "ws separator true"         $'android.enableR8.fullMode true'                "android.enableR8.fullMode" "true"
  assert_resolves "ws separator false"        $'android.enableMinifyInReleaseBuilds false'     "android.enableMinifyInReleaseBuilds" "false"
  assert_resolves "ws separator TRUE"         $'android.enableShrinkResourcesInReleaseBuilds TRUE' "android.enableShrinkResourcesInReleaseBuilds" "TRUE"
  assert_resolves "ws sep + leading ws"       $'  android.enableR8.fullMode  true'             "android.enableR8.fullMode" "true"

  echo ""
  echo "=== resolve_flag() — line continuation ==="
  # Trailing backslash: value spans two physical lines (the bypass vector from reviewer)
  assert_resolves "continuation tru+e"        $'android.enableR8.fullMode=tru\\\ne'            "android.enableR8.fullMode" "true"
  assert_resolves "continuation fal+se"       $'android.enableR8.fullMode=fal\\\nse'           "android.enableR8.fullMode" "false"
  assert_resolves "continuation leading ws"   $'android.enableMinifyInReleaseBuilds=tru\\\n   e' "android.enableMinifyInReleaseBuilds" "true"

  echo ""
  echo "=== resolve_flag() — CR-only line endings ==="
  # Java Properties accepts LF, CRLF, and bare CR as line terminators.
  assert_resolves "CR separator true"         $'android.enableR8.fullMode=true\r'              "android.enableR8.fullMode" "true"
  assert_resolves "CR separator false"        $'android.enableR8.fullMode=false\r'             "android.enableR8.fullMode" "false"
  assert_resolves "CR last-wins false→true"   $'android.enableR8.fullMode=false\randroid.enableR8.fullMode=true\r' "android.enableR8.fullMode" "true"
  assert_resolves "CR last-wins true→false"   $'android.enableR8.fullMode=true\randroid.enableR8.fullMode=false\r' "android.enableR8.fullMode" "false"

  echo ""
  echo "=== resolve_flag() — Unicode escapes ==="
  # \u0074 = 't', so \u0074rue = true
  assert_resolves "unicode \\u0074rue"        $'android.enableR8.fullMode=\\u0074rue'          "android.enableR8.fullMode" "true"
  assert_resolves "unicode \\u0066alse"       $'android.enableR8.fullMode=\\u0066alse'         "android.enableR8.fullMode" "false"
  assert_resolves "unicode TRUE all caps"     $'android.enableMinifyInReleaseBuilds=\\u0054RUE' "android.enableMinifyInReleaseBuilds" "TRUE"

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
