---
name: Gemini AI integration wiring
description: How the Replit-managed Gemini proxy is wired into the api-server; the @google/genai runtime resolution gotcha.
---

## Rule

When adding a new `@google/*` (or any other esbuild-externalized) package as a transitive dep via a workspace lib, you MUST also add it as a **direct dependency** of `artifacts/api-server/package.json`.

**Why:** `build.mjs` externalizes all `@google/*` packages (`"@google/*"` glob in the `external` array). esbuild therefore does not bundle `@google/genai` into `dist/index.mjs`. At runtime, Node resolves the import relative to the dist file — but pnpm does **not** hoist workspace-lib transitive deps to the root `node_modules`. The package ends up only in `lib/integrations-gemini-ai/node_modules/@google/genai`, which is invisible to the api-server dist. Adding it as a direct dep in api-server/package.json installs it where Node can find it.

**How to apply:** Any time you wire a new workspace lib into the api-server and that lib has deps covered by the `external` glob list in `build.mjs`, add those deps directly to `artifacts/api-server/package.json` then re-run `pnpm install --no-frozen-lockfile`.

## Integration setup summary

- Provider: Replit AI Integrations proxy (Gemini) — no user API key needed
- Env vars auto-provisioned: `AI_INTEGRATIONS_GEMINI_BASE_URL`, `AI_INTEGRATIONS_GEMINI_API_KEY`
- Provision call: `setupReplitAIIntegrations({ providerSlug: "gemini", ... })` in JS sandbox
- Template source: `.local/skills/ai-integrations-gemini/templates/lib/`
- Workspace package: `@workspace/integrations-gemini-ai` (lib/integrations-gemini-ai/)
- DB tables: `conversations`, `messages` — generic AI utility tables, no company_id
- Routes: `/api/gemini/conversations` (CRUD + SSE stream), `/api/gemini/generate-image`
- Auth: mounted behind `requireAuth + requireCompany + requireBetaAccess`
- Model used: `gemini-2.5-flash` for chat; `gemini-2.5-flash-image` for image gen
- SSE stream note: Orval cannot generate typed hooks for SSE — consume with `fetch` + `ReadableStream` on client
