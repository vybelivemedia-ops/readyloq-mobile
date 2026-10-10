#!/usr/bin/env bash
set -euo pipefail

API_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_ROOT="$(cd "$API_DIR/../.." && pwd)"
DEPLOY_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$DEPLOY_DIR"
}
trap cleanup EXIT

cd "$API_DIR"
node ./build.mjs

cd "$WORKSPACE_ROOT"
pnpm --filter @workspace/api-server deploy --prod --legacy "$DEPLOY_DIR"

rm -rf "$API_DIR/dist/node_modules"
cp -a "$DEPLOY_DIR/node_modules" "$API_DIR/dist/node_modules"

echo "Packaged production API runtime dependencies in dist/node_modules"