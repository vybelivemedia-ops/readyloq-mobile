---
name: AI provider failover & OpenAI proxy quota
description: Why the OpenAI Replit-proxy path can be quota-dead account-wide and how the provider factory fails over
---

# AI provider failover

**Rule:** Never let the AI factory drop straight from a failed real provider to the mock. Fail over to every other *available* real provider first, and promote the one that succeeds to primary so later requests skip the dead provider.

**Why:** The Replit AI Integrations OpenAI proxy returned 429 `insufficient_quota` on ALL models (gpt-4o through gpt-5.4), even after re-provisioning fresh credentials with `setupReplitAIIntegrations` — it's an upstream/account-level quota condition, not a stale key or model issue. Meanwhile the Anthropic proxy on the same account worked fine (HTTP 200). With the old primary→mock design, this made the dashboard show 100% deterministic fallbacks while "OpenAI selected" looked healthy.

**How to apply:**
- Diagnose with direct curl to `$AI_INTEGRATIONS_<PROVIDER>_BASE_URL` before touching code — provider-slug quotas are independent, so test each slug separately.
- `OPENAI_API_KEY` in this workspace is a decommissioned placeholder ("sk-decom…") — never a valid public-API fallback.
- Anthropic proxy: `POST {base}/v1/messages`, `x-api-key` header, `anthropic-version: 2023-06-01`; supported models are the proxy's own list (`claude-sonnet-4-6`, `claude-haiku-4-5` — NOT dated names like `claude-3-5-haiku-20241022`, those 400 UNSUPPORTED_MODEL).
- Anthropic has no `response_format` — enforce JSON via system-prompt instruction + strip markdown fences before parsing.
- After a restart, resolution starts at the priority list again, so the first request pays two fast 429s before failing over — acceptable; a health/cooldown cache would remove it if it ever matters.
- Prod deployments only get `AI_INTEGRATIONS_*` env vars after a republish.
