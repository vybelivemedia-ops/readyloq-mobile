# ReadyLoq Gemini inspection hackathon demo

This branch adds the current sample-photo Gemini demo to the existing ReadyLoq
portal. It is based on GitHub `main`; unrelated unpublished workspace commits
are intentionally excluded.

- Page: `/readyloq-portal/gemini-demo`
- API: `/api/gemini-inspection-demo/analyze` (`HEAD` checks availability/version;
  `POST` analyzes a sample photo).
- Demo compatibility build: `demo-compat-3`; parser contract: `3`.
- Model: Gemini 2.5 Flash through the existing server-side Replit Gemini client.
- Server configuration names: `AI_INTEGRATIONS_GEMINI_BASE_URL` and
  `AI_INTEGRATIONS_GEMINI_API_KEY`. Use workspace secrets; never put values in Git.
- Production remains disabled unless `READYLOQ_GEMINI_DEMO_ENABLED=true`.
  This branch does not publish, deploy or enable that flag.

Use non-sensitive sample photos only. No inspection, report or sync records are
created. Findings require technician review. Missing evidence, uncertainty or
required fields remain errors after at most one bounded model correction.
Format tolerance accepts a single JSON fence with a short presentation-only
preface and capitalization/whitespace normalization of qualitative confidence.
It does not invent findings or convert numeric confidence.

The exact public demo page is isolated; other portal routes retain the base
repository's Clerk and role guards. The API rejects stale client build markers
before provider work. The page distinguishes API/version problems from photo
validation errors.

Focused verification from the repository root:

```sh
pnpm --filter @workspace/api-server exec vitest run --config vitest.gemini-demo.config.ts
pnpm --filter @workspace/api-server exec tsc -p tsconfig.gemini-demo-check.json --noEmit
pnpm --filter @workspace/api-server exec vitest run --root ../readyloq-portal --config vitest.gemini-demo.config.mjs
pnpm --filter @workspace/api-client-react exec tsc --build tsconfig.json
pnpm --filter @workspace/readyloq-portal run typecheck
```
