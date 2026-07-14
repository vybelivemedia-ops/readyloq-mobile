---
name: V11 Quinn founder-context unification
description: The single shared assembler for Quinn's founder-context preamble and which paths use it
---

# V11 Tier 1 — one shared founder-context assembler

Quinn's "founder-context preamble" (explicit operating profile + inferred behavioral
insights) is composed in exactly ONE place: `founderProfile.ts`.

- `getFounderProfilePreamble()` — full preamble for conversational/strategic reasoning
  (used by the converse path in `routes/missionControl.ts`).
- `getFounderProfileSummary(insights?)` — compact one-block summary for high-density
  surfaces (used by `cooMorningBriefing.ts`); pass already-fetched insight rows to avoid
  a redundant query.

Both compose `formatOperatingProfileForQuinn()` / `summarizeOperatingProfile()` (Tier 0,
`founderOperatingProfile.ts`, authoritative) + `formatProfileForQuinn()` / inferred rows
(supplementary, evidence-gated medium+).

**Why:** the operating-profile + inferred-insights join was duplicated across converse and
briefing; V11 Tier 1's rule is "never duplicate Quinn reasoning logic." New reasoning paths
must call the shared assembler, not re-join the two sources.

**How to apply:**
- The Founder **Decision Model** (`founderDecisionModel.ts` → `formatDecisionModelForQuinn`)
  is a SEPARATE, distinct context field (decision predictions + accuracy), NOT part of the
  preamble — do not fold it in.
- `autonomyEngine.ts` runs on deterministic signals and makes no AI founder-context
  preamble call, so it intentionally does not use the assembler.
- Tier 0 is authoritative and always present; inferred insights may be absent until enough
  behavior is observed (preamble degrades to operating-profile-only).
