#!/bin/bash
set -e
pnpm install --frozen-lockfile --prefer-offline

# Guard: fail fast if a task agent re-enabled R8 minification flags.
# These flags cause startup crashes (NoClassDefFoundError). See scripts/check-r8-flags.sh.
bash scripts/check-r8-flags.sh
# Multi-tenancy backfill MUST run before push. It creates the companies table,
# the reserved platform/legacy companies, and fills company_id on every existing
# row so the (non-interactive) push can enforce NOT NULL + FKs + unique indexes
# without an interactive truncate prompt. Idempotent: safe to run repeatedly.
node lib/db/migrate-tenancy.mjs
pnpm --filter @workspace/db push
