#!/usr/bin/env bash
# pre-push-check.sh — run before pushing any branch to origin
#
# Usage:
#   ./scripts/pre-push-check.sh              # all checks
#   ./scripts/pre-push-check.sh --platform-boundary
#   ./scripts/pre-push-check.sh --no-duplicate-platform
#   ./scripts/pre-push-check.sh --platform-versions
#
# Exit code 0 = all requested checks passed.
# Exit code 1 = one or more checks failed (push aborted).
#
# Install as a git hook:
#   ln -sf ../../scripts/pre-push-check.sh .git/hooks/pre-push

set -euo pipefail

RED='\033[0;31m'
GRN='\033[0;32m'
YEL='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0

pass() { echo -e "  ${GRN}✅ PASS${NC}  $1"; ((PASS++)); }
fail() { echo -e "  ${RED}❌ FAIL${NC}  $1"; ((FAIL++)); }
warn() { echo -e "  ${YEL}⚠️  WARN${NC}  $1"; ((SKIP++)); }
header() { echo -e "\n${YEL}▶ $1${NC}"; }

# ── Argument parsing ──────────────────────────────────────────────────────────
RUN_ALL=true
RUN_SYNC=false
RUN_CLEAN=false
RUN_BOUNDARY=false
RUN_NO_DUPE=false
RUN_VERSIONS=false
RUN_TYPECHECK=false
RUN_TESTS=false
RUN_GENERATED=false

if [[ $# -gt 0 ]]; then
  RUN_ALL=false
  for arg in "$@"; do
    case "$arg" in
      --sync)              RUN_SYNC=true ;;
      --clean)             RUN_CLEAN=true ;;
      --platform-boundary) RUN_BOUNDARY=true ;;
      --no-duplicate-platform) RUN_NO_DUPE=true ;;
      --platform-versions) RUN_VERSIONS=true ;;
      --typecheck)         RUN_TYPECHECK=true ;;
      --tests)             RUN_TESTS=true ;;
      --generated)         RUN_GENERATED=true ;;
      --all)               RUN_ALL=true ;;
      *)                   echo "Unknown flag: $arg"; exit 1 ;;
    esac
  done
fi

if $RUN_ALL; then
  RUN_SYNC=true; RUN_CLEAN=true; RUN_BOUNDARY=true
  RUN_NO_DUPE=true; RUN_VERSIONS=true; RUN_TYPECHECK=true
  RUN_TESTS=true; RUN_GENERATED=true
fi

echo "╔══════════════════════════════════════════════════════════╗"
echo "║           ReadyLoq pre-push verification                  ║"
echo "╚══════════════════════════════════════════════════════════╝"

# ── Check 1: Workspace is not behind origin ───────────────────────────────────
if $RUN_SYNC; then
  header "Sync check"
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "HEAD")
  if git fetch origin "$BRANCH" --quiet 2>/dev/null; then
    BEHIND=$(git rev-list --count HEAD..origin/"$BRANCH" 2>/dev/null || echo "0")
    AHEAD=$(git rev-list --count origin/"$BRANCH"..HEAD 2>/dev/null || echo "0")
    if [[ "$BEHIND" -gt 0 ]]; then
      fail "Local is $BEHIND commit(s) behind origin/$BRANCH — pull before pushing"
    else
      pass "Local is not behind origin/$BRANCH ($AHEAD commit(s) ahead)"
    fi
  else
    warn "Could not reach origin to check sync (offline?)"
  fi
fi

# ── Check 2: Working tree is clean ────────────────────────────────────────────
if $RUN_CLEAN; then
  header "Working tree"
  DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  if [[ "$DIRTY" -gt 0 ]]; then
    fail "Working tree has $DIRTY uncommitted change(s) — commit or stash first"
    git status --short
  else
    pass "Working tree is clean"
  fi
fi

# ── Check 3: No product code inside @platform/* ───────────────────────────────
if $RUN_BOUNDARY; then
  header "Platform boundary (no product code in @platform/*)"
  PLATFORM_DIR="repos/platform/packages"
  VIOLATIONS=0

  if [[ ! -d "$PLATFORM_DIR" ]]; then
    warn "repos/platform/ not found — skipping boundary check (run: git clone https://github.com/vybelivemedia-ops/platform.git repos/platform)"
  else
    # Product-specific identifiers that must not appear inside platform packages
    PRODUCT_PATTERNS=(
      "readyloq"
      "inspection"
      "pest"
      "technician"
      "findingsReview"
      "propertyProfile"
      "InspectionStore"
      "SyncEngine.*inspection"
    )

    for pat in "${PRODUCT_PATTERNS[@]}"; do
      HITS=$(grep -rl "$pat" "$PLATFORM_DIR" \
               --include="*.ts" --include="*.tsx" \
               --exclude-dir=node_modules --exclude-dir=dist \
               2>/dev/null | wc -l | tr -d ' ')
      if [[ "$HITS" -gt 0 ]]; then
        fail "Platform boundary violation: '$pat' found in $HITS platform file(s)"
        grep -rl "$pat" "$PLATFORM_DIR" --include="*.ts" --include="*.tsx" \
             --exclude-dir=node_modules --exclude-dir=dist 2>/dev/null \
          | head -5 | sed 's/^/    /'
        ((VIOLATIONS++))
      fi
    done

    if [[ "$VIOLATIONS" -eq 0 ]]; then
      pass "No product-specific code found inside @platform/* packages"
    fi
  fi
fi

# ── Check 4: No stale old-monorepo path references ────────────────────────────
if $RUN_NO_DUPE; then
  header "No duplicate / legacy platform references"
  OLD_PATHS=("repos/readyloq-mobile" "repos/vybelive")
  DUPE_FAIL=0

  for old_path in "${OLD_PATHS[@]}"; do
    if [[ -d "$old_path" ]]; then
      fail "Legacy directory still present: $old_path"
      ((DUPE_FAIL++))
    fi
    REFS=$(grep -r "$old_path" \
             --include="*.ts" --include="*.tsx" --include="*.json" --include="*.yaml" \
             --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
             . 2>/dev/null | grep -v ".git/" | wc -l | tr -d ' ')
    if [[ "$REFS" -gt 0 ]]; then
      fail "Source files still reference $old_path ($REFS occurrence(s))"
      grep -rl "$old_path" \
           --include="*.ts" --include="*.tsx" --include="*.json" --include="*.yaml" \
           --exclude-dir=node_modules --exclude-dir=dist . 2>/dev/null \
        | head -5 | sed 's/^/    /'
      ((DUPE_FAIL++))
    fi
  done

  if [[ "$DUPE_FAIL" -eq 0 ]]; then
    pass "No legacy monorepo path references found"
  fi
fi

# ── Check 5: @platform/* workspace dep versions are consistent ────────────────
if $RUN_VERSIONS; then
  header "Platform dependency version consistency"
  # All @platform/* deps in package.json files must use "workspace:*"
  WRONG=$(grep -r '"@platform/' \
            --include="package.json" \
            --exclude-dir=node_modules \
            . 2>/dev/null \
          | grep -v 'workspace:\*' \
          | grep -v '"name"' \
          | grep -v '/repos/platform/' \
          | wc -l | tr -d ' ')
  if [[ "$WRONG" -gt 0 ]]; then
    fail "@platform/* deps found using a version other than workspace:* ($WRONG occurrence(s))"
    grep -r '"@platform/' --include="package.json" --exclude-dir=node_modules . 2>/dev/null \
      | grep -v 'workspace:\*' | grep -v '"name"' | grep -v '/repos/platform/' \
      | head -10 | sed 's/^/    /'
  else
    pass "All @platform/* deps consistently use workspace:*"
  fi
fi

# ── Check 6: TypeScript (all packages) ────────────────────────────────────────
if $RUN_TYPECHECK; then
  header "TypeScript typecheck"
  if pnpm -r typecheck --if-present > /tmp/ts-out.txt 2>&1; then
    pass "tsc --noEmit passed across all packages"
  else
    fail "TypeScript errors detected"
    tail -30 /tmp/ts-out.txt | sed 's/^/    /'
  fi
fi

# ── Check 7: Tests ────────────────────────────────────────────────────────────
if $RUN_TESTS; then
  header "Test suite"
  if pnpm -r test --if-present > /tmp/test-out.txt 2>&1; then
    TESTS=$(grep -oE '[0-9]+ passed' /tmp/test-out.txt | tail -1 || echo "?")
    pass "Tests passed ($TESTS)"
  else
    fail "Test suite has failures"
    tail -30 /tmp/test-out.txt | sed 's/^/    /'
  fi
fi

# ── Check 8: Generated code is current ────────────────────────────────────────
if $RUN_GENERATED; then
  header "Generated code freshness"
  if ! command -v pnpm &>/dev/null; then
    warn "pnpm not available — skipping generated code check"
  else
    # Check if running the generator would produce any diff
    if pnpm --filter @workspace/api-zod generate > /tmp/gen-out.txt 2>&1; then
      GEN_DIFF=$(git diff --name-only 2>/dev/null | grep 'api-zod\|api-client' | wc -l | tr -d ' ')
      if [[ "$GEN_DIFF" -gt 0 ]]; then
        fail "Generated code is stale — $GEN_DIFF file(s) changed after re-running generator"
        git diff --name-only 2>/dev/null | grep 'api-zod\|api-client' | sed 's/^/    /'
      else
        pass "Generated code is up to date"
      fi
    else
      warn "Generator script not available — skipping generated code check"
    fi
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════"
echo -e "  Results: ${GRN}$PASS passed${NC}  ${RED}$FAIL failed${NC}  ${YEL}$SKIP skipped${NC}"
echo "══════════════════════════════════════════════════════════"

if [[ "$FAIL" -gt 0 ]]; then
  echo -e "\n${RED}Push aborted. Fix the failures above, then re-run.${NC}\n"
  exit 1
fi

echo -e "\n${GRN}All checks passed. Safe to push.${NC}\n"
exit 0
