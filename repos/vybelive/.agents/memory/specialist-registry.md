---
name: Mission Control specialist registry
description: How claude-code-template specialist agents are integrated into Mission Control — ownership model, seams, and constraints.
---

# Specialist registry design

- Specialists (from `.claude/agents/*.md` + `.claude/skills/*`) are NOT standalone chatbots. They are bench members owned by executives; their findings merge into the owning executive's report via `inspectAndReport(focus?)`.
- **Why:** the user explicitly required no duplicate routing/memory and no separate chat surfaces — Quinn stays the single orchestrator.
- **How to apply:** any new specialist gets an entry in the SPECIALISTS array in the registry service with an `ownerRole`; consultation happens only inside existing exec/orchestrator seams (inspectAndReport, applyLaunchStrategySkill, Quinn context bench section). Never add a specialist route that chats directly.
- Prompt loader walks up from cwd to find `.claude` (api-server cwd is the artifact dir, repo root holds `.claude`); strips YAML front matter; caches.
- Confidence = avg confidence of successful runs from `specialist_runs` table, else 60 baseline. `consultSpecialist` never throws — failures are recorded as failed runs and the base exec report still ships.
- `hackathon-ai-strategist` template was deliberately excluded per user decision (out of product scope).
