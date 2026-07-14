---
name: Founder profile learning sources
description: Why deterministic signals are load-bearing in the founder profile pipeline and how the 7 learning sources are wired
---

# Founder profile learning

**Rule:** Every founder-interaction source must emit at least one deterministic signal derived from the action itself (objective launched, approval decided, post edited, correction cue). Never rely on AI extraction alone.

**Why:** `extractSignals` returns `[]` whenever the AI call falls back (`fromFallback`) — and the OpenAI quota being exhausted means ALL extraction silently produces nothing. With a sparse history (<10 messages), the conservative extractor plus fallback left 8 of 10 categories at zero even though the pipeline "worked".

**How to apply:**
- 7 sources feed the profile: Quinn chat, approval decisions (incl. release-keyword → release_philosophy, decision speed → decision_patterns), objective directives, founder→exec DMs (executive_trust), marketing post decisions, founder corrections (regex cues), message length (communication_style).
- Live hooks are fire-and-forget (`void ...catch`) and must never block route responses.
- Rebuild/backfill must mirror live ingestion exactly: chat replay is restricted to chief_of_staff messages; non-chief founder DMs feed ONLY the exec-engagement step, or messages get double-counted and inflate confidence.
- Objectives can't be attributed by `createdByExecutiveId` (always Quinn, including autonomous engines) — backfill links them to the founder via word-overlap with founder messages.
- Categories with no evidence stay at zero by design (no fabrication); priorities/risk-tolerance need the AI pass and fill in only when quota is available.
