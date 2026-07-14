---
name: AI integration env vars not in deployment
description: Why prod AI fails with 401-to-public-OpenAI while dev works, and the fix
---

# Replit AI integration env vars don't auto-reach a stale deployment

**Symptom:** In production/deployment logs, OpenAI calls fail with
`401 Incorrect API key provided: _DUMMY_A***KEY_` and the error/stack references
`https://platform.openai.com/...` (the PUBLIC OpenAI API). Meanwhile dev works
(or fails only with `429 insufficient_quota`, which means it IS reaching the proxy).

**Root cause:** The dummy `AI_INTEGRATIONS_OPENAI_API_KEY` string is normal — real
auth happens through `AI_INTEGRATIONS_OPENAI_BASE_URL` (the Replit AI proxy). If the
deployment is missing `AI_INTEGRATIONS_OPENAI_BASE_URL`, the OpenAI SDK falls back to
the public `api.openai.com` and the dummy key 401s. A deployment published BEFORE the
AI integration was connected won't have the integration env vars.

**Why it matters here (Mission Control / Quinn):** With AI dead in prod, Quinn drops to
the deterministic fallback. That fallback only creates an Objective when the founder's
message mechanically starts with an action verb (fix/launch/build/research/audit/…) and
is >4 words. Conversational phrasing ("Release", "Yes", "look into X") gets routed to
approval-gating or chit-chat, so NO objective is created and the Objectives tab stays
empty even though tasks/approvals pile up.

**How to apply:**
- Diagnose by comparing dev vs prod: dev has `AI_INTEGRATIONS_OPENAI_BASE_URL` set; prod
  doesn't (visible via the 401-to-public-OpenAI in deployment logs).
- Fix = republish the app so the deployment picks up the current integration env vars.
- Immediate workaround with no redeploy: send Quinn an action-verb directive
  ("Launch a full audit of our onboarding funnel and improve activation") — the
  deterministic gate creates an objective even without AI.
- Production runs a SEPARATE database; 0 objectives in prod ≠ broken code if dev verified fine.
