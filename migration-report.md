# ReadyLoq Phase 3 — Platform Extraction Migration Report

**Date:** 2026-07-18
**Baseline commit (local HEAD):** `648ceae`
**Platform repository:** `vybelivemedia-ops/platform` (`repos/platform/`, 18 packages)

---

## 1. Migrated ReadyLoq Features

The following features were present in the local git history (ref `648ceae`) but were not included in the GitHub remote split commit (`6f245cd`). They have been confirmed present in the current canonical ReadyLoq baseline.

### 1.1 Gemini AI Conversation Layer
- **`artifacts/api-server/src/routes/gemini.ts`** *(new)* — REST endpoints for starting conversations, sending messages, and retrieving history
- **`lib/integrations-gemini-ai/`** *(new package)* — Replit-managed Gemini AI client library (batch processor, image analysis, unified client)
- **`lib/db/src/schema/conversations.ts`** *(new)* — AI conversation persistence schema
- **`lib/db/src/schema/messages.ts`** *(new)* — Conversation message schema
- **`lib/api-spec/openapi.yaml`** — Updated with Gemini conversation endpoints
- **`lib/api-zod/src/generated/types/`** — 212 generated Zod type files covering the full API surface
- **`lib/api-client-react/src/generated/api.ts`** — Updated React Query client (UseQueryOptions alias for TS compatibility)

### 1.2 AI Analysis Pipeline
- **`artifacts/api-server/src/routes/analysis.ts`** — Analysis results with video evidence, photo zones, and summary endpoints
- **`artifacts/api-server/src/lib/intelligence-ai.ts`** — AI intelligence model (confidence calibration, batch analysis)
- **`artifacts/api-server/src/lib/report-narrative-ai.ts`** — Narrative report generation via AI
- **`artifacts/readyloq/src/pages/analysis/detail.tsx`** — Analysis detail view (web dashboard)

### 1.3 Technician Findings Review Workflow
- **`artifacts/readyloq-app/app/(app)/findings-review/[localId].tsx`** *(new screen)* — Technician review UI for AI-flagged findings
- **`artifacts/readyloq-app/lib/local/inspection-store.ts`** — Coverage zone tracking, async-dedupe carry-over for still-saved photos
- **`artifacts/readyloq-app/app/(app)/inspection-summary/[localId].tsx`** — Improved summary screen with AI insights

### 1.4 Inspection Synchronization
- **`artifacts/api-server/src/routes/inspections.ts`** — Per-inspection advisory lock, error event reporting
- **`artifacts/readyloq-app/lib/sync/engine.ts`** — Single-flight sync, offline two-writer merge rule
- **`artifacts/readyloq-app/app/(app)/(tabs)/inspections.tsx`** — Inspections tab with live sync status
- **`artifacts/readyloq-app/app/_layout.tsx`** — Route registration for findings-review screen
- **`artifacts/readyloq-app/package.json`** — Dependency updates for sync dependencies

### 1.5 Media Upload Improvements
- **`artifacts/readyloq-app/components/AiInsightsPanel.tsx`** — Improved AI insights panel (panel rendering fixes)
- **`artifacts/readyloq-app/app/(app)/new-inspection.tsx`** — Media upload flow improvements

### 1.6 Platform Vision Layer (Abstraction)
- **`artifacts/readyloq-app/lib/vision/types.ts`** — Converted from local definitions to pure `@platform/shared-types` + `@platform/camera-core` re-exports
- **`artifacts/readyloq-app/lib/vision/quality-gate.ts`** — Now delegates to `@platform/smart-vision QualityScorer`
- **`artifacts/readyloq-app/lib/vision/provider-registry.ts`** — Now delegates to `@platform/provider-registry Registry`

---

## 2. Removed Duplicated Platform Code

| Removed | Size | Reason |
|---------|------|--------|
| `repos/readyloq-mobile/` | 180 MB | Legacy monorepo directory — all content already present at flat paths |
| `repos/vybelive/` | 25 MB | VYBE Live codebase — wrong project, unrelated to ReadyLoq |
| Local `CaptureProvider` / `EvidenceItem` type definitions | — | Replaced by `@platform/shared-types` + `@platform/camera-core` re-exports |
| Local `QualityScorer` implementation | — | Replaced by `@platform/smart-vision` |
| Local provider `Registry` implementation | — | Replaced by `@platform/provider-registry` |

---

## 3. Platform Packages Consumed

ReadyLoq currently depends on 4 of the 18 available `@platform` packages:

| Package | Used In | Purpose |
|---------|---------|---------|
| `@platform/camera-core` | `readyloq-app/lib/vision/types.ts` | `CaptureProvider`, `CaptureSession` contracts |
| `@platform/provider-registry` | `readyloq-app/lib/vision/provider-registry.ts` | Runtime plug-in registry |
| `@platform/shared-types` | `readyloq-app/lib/vision/types.ts` | `EvidenceItem`, shared AI contracts |
| `@platform/smart-vision` | `readyloq-app/lib/vision/quality-gate.ts` | On-device `QualityScorer` |

### Platform Packages Not Yet Consumed (Future Adoption)

`ai-core`, `asset-core`, `device-core`, `evidence-core`, `live-session-core`, `local-intelligence`, `measurement-core`, `meta-wearables`, `platform-intelligence`, `storage-core`, `sync-engine`, `ui-core`, `voice-intelligence`

These are available in `repos/platform/packages/*` when ReadyLoq needs them.

---

## 4. Old Monorepo Path References

Search of all `.ts`, `.tsx`, and `.json` source files for `repos/readyloq-mobile` or `repos/vybelive`:

**Result: NONE found.** ✅

---

## 5. Verification Results

| Check | Result | Notes |
|-------|--------|-------|
| `pnpm install` | ✅ Pass | 32 workspace packages, lockfile up to date |
| `pnpm typecheck` | ✅ Pass* | *Pre-existing TS7030 in `api-server/src/routes/gemini.ts:121` (not all code paths return a value) — documented baseline |
| `api-server tests` | ✅ Pass | 13 test files, **181 tests**, all passed |
| `pnpm lint` | ℹ️ Not configured | No ESLint or similar configured in workspace |
| `pnpm build` | ⚠️ Partial | `mockup-sandbox` (design tool) requires `PORT` env var at build time — pre-existing limitation unrelated to ReadyLoq app code |

---

## 6. Blockers and Follow-up Work

### Blocker 1 — `repos/platform/` is a local directory, not a git submodule
**Impact:** Fresh clones of `readyloq-mobile` will fail — `pnpm-workspace.yaml` references `repos/platform/packages/*` which won't exist.

**Resolution:** `git submodule add git@github.com:vybelivemedia-ops/platform.git repos/platform` pinned to `3f91d8b7`, then commit. Requires a git write operation (currently blocked in the main agent, suitable for a project task agent).

**Workaround until resolved:** After cloning, run `git submodule update --init --recursive` or manually clone the platform repo into `repos/platform/`.

### Blocker 2 — `repos/readyloq-mobile/` and `repos/vybelive/` deletions
**Status:** Deleted from filesystem. Will be included in the next git commit.

### Follow-up 1 — Fix pre-existing TS7030 in `gemini.ts:121`
`src/routes/gemini.ts` line 121 has a function where not all code paths return a value. Low risk (test suite passes), but should be addressed in the next sprint.

### Follow-up 2 — Add lint configuration
No `eslint` or similar is configured. Recommend adding a shared `@workspace/eslint-config` and wiring it across all artifacts for consistency.

### Follow-up 3 — Fix `mockup-sandbox` build for CI
The mockup-sandbox `vite.config.ts` requires `PORT` at config-evaluation time. Fix by making `PORT` optional (defaulting to a known dev port) so `vite build` works without the runtime env var.

---

## 7. Architecture Boundary Status

```
readyloq-mobile (this repo)
├── artifacts/api-server      ← ReadyLoq-specific server logic
├── artifacts/readyloq-app    ← Mobile app (Expo)
├── artifacts/readyloq        ← Web dashboard
├── artifacts/readyloq-marketing ← Marketing site
├── lib/                      ← ReadyLoq-specific shared libraries
│   ├── api-spec/             ← OpenAPI spec
│   ├── api-client-react/     ← React Query client (generated)
│   ├── api-zod/              ← Zod schemas (generated, 212 types)
│   ├── db/                   ← Drizzle schema (ReadyLoq tables)
│   ├── integrations-gemini-ai/ ← Gemini AI integration wrapper
│   └── integrations/         ← External service integrations
└── repos/platform/           ← @platform/* packages (local workspace link)
```

The architecture boundary is clean: no ReadyLoq source file imports directly from `repos/platform/` by path — all platform dependencies go through `@platform/*` package names resolved by pnpm workspace.

---

## 8. Platform Consumption Strategy (Architectural Decision — 2026-07-18)

The three-layer separation is now the canonical model:

```
@platform/*         ← reusable infrastructure (independent repository)
ReadyLoq            ← pest inspection product (consumes @platform/*)
VYBE                ← creator/streaming product (consumes @platform/*)
```

**Consumption model by phase:**

| Phase | How ReadyLoq (and VYBE) consume @platform/* |
|-------|---------------------------------------------|
| Active development | Local workspace link via `pnpm-workspace.yaml → repos/platform/packages/*`. No publish step. Changes are immediately available. |
| Platform API stabilizing | Optional: git-based dep (`github:vybelivemedia-ops/platform#<sha>`) or submodule, if isolation between repos is needed before semver is ready. |
| Platform API stable | Publish packages to GitHub Packages (or equivalent) as versioned releases. Both apps declare explicit semver deps (`@platform/camera-core: ^1.0.0`). Remove `repos/platform/` from workspace. |

**Why not a git submodule now:** The platform API is still evolving. Locking into the submodule workflow (detached HEAD, `git submodule update` on every pull, bifurcated clone steps) adds friction without benefit at this stage. The current workspace link gives identical behavior for local development. The submodule was a validation-tool suggestion, not an architectural requirement.

**Decision:** No submodule. Proceed directly to versioned packages once the platform API stabilizes. Use a setup script as the interim fresh-clone workaround:

```bash
# scripts/setup-platform.sh — run once after cloning readyloq-mobile
git clone https://github.com/vybelivemedia-ops/platform.git repos/platform
pnpm install
```
