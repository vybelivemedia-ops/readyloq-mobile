# ADR-019: Product-Specific Code Must Not Enter @platform/*

**Status:** Accepted  
**Date:** 2026-07-18  
**Author:** Platform Architecture  
**Supersedes:** Nothing  
**See also:** ADR-003 (ai-core scope), ADR-011 (Governance), ADR-017 (product AI agents), GOVERNANCE.md § 2 and § 8

---

## Context

As the platform grows and both ReadyLoq and VYBE mature, there will be recurring pressure to add product-specific shortcuts into `@platform/*` packages. Common patterns:

- "This type needs a `pestSpecies` field — let's just make it optional."
- "Quinn already does this — can we add it to `platform-intelligence` so both apps get it?"
- "ReadyLoq's scoring model is pretty general — let's move it to `ai-core`."
- "The inspection report template is useful, we should share it."

Each of these seems harmless in isolation. Collectively, they reverse the architectural separation entirely and produce a platform indistinguishable from a shared monorepo of application code.

This ADR establishes the canonical boundary rule and the test for enforcing it.

---

## Decision

**Product-specific code must not be added to any package under `@platform/*`, regardless of how useful it seems at the time.**

This applies to:
- Type definitions
- Interfaces and abstract classes
- Constants and enums
- Prompt templates and AI instruction strings (zero tolerance — no prompt fragment of any kind)
- Business rules embedded as code or configuration
- Domain identifiers used as structural types (e.g., `inspectionId` as a typed field vs `entityId: string`)
- Event kinds specific to one product (e.g., `inspection.completed`, `stream.started`)

---

## The Canonical Test

Before merging any addition to a `@platform/*` package, ask:

> "Does this make sense for a pest inspection platform AND a live-streaming platform AND a hypothetical third, unrelated platform we haven't built yet?"

If the answer is **yes for all three**, it belongs in the platform.  
If the answer is **yes for one or two**, it belongs in the application.

There is no middle ground. "Mostly generic with one product-specific field" is not a platform type — it is an application type that has been incorrectly shared.

---

## Product Ownership (canonical statement)

**Stays in ReadyLoq — forever:**
- Pest intelligence, species recognition, infestation scoring, pest risk models
- AI guidance rules for pest treatment and remediation
- Inspection memory — what was found, where, when, with what confidence
- Coverage zone logic — which areas of a property have been inspected
- Property/asset business rules — pricing, pest risk by building age, treatment history
- Proposal engine, CRM, lead management, service agreement templates
- Report templates — PDF layouts, section headings, compliance language
- Inspector AI agent — prompts, memory schema, findings vocabulary, scorecard rules

**Stays in VYBE — forever:**
- Mission Control — Quinn, Agent Zero, executive AI objectives, autonomy engine rules
- Agent goal hierarchies, task scheduling, retrospective schemas, tool inventories
- Social publishing — platform-specific RTMP logic, audience policies, moderation rules
- Creator analytics — subscriber tiers, revenue splits, monetisation rules
- Audience intelligence — demographic targeting, engagement scoring
- Streaming business logic — visibility rules, content policies, stream state machines

---

## Consequences

**What this enables:**
- The platform boundary remains meaningful over time. New engineers joining the project can trust that `@platform/*` contains only generic infrastructure, not a mix of app code and shared code.
- New products can adopt `@platform/*` without being exposed to pest-inspection or creator-streaming domain logic.
- Both ReadyLoq and VYBE can evolve their domain models independently without platform review gates.

**What this constrains:**
- Teams cannot take shortcuts by adding a "quick optional field" to a platform type when a clean application-layer wrapper would serve equally well. The anti-corruption layer pattern (see GOVERNANCE.md § 6) is the correct mechanism: the application wraps the platform type and adds its own fields.
- Legitimate generalisation proposals — where a pattern truly appears in both apps independently — require an ADR, sign-off from both teams, and removal of the originating domain-specific version from both apps. Generalisation without removal is accumulation.

**Enforcement:**  
The CI forbidden-string grep (see GOVERNANCE.md § 7) catches the most common violations. Code review checklists enforce the rest. Any PR that adds a field with a domain-specific name to a platform type must be blocked regardless of whether the name appears in the grep list — the test above (three-platform question) is the final arbiter.

**What is not covered by this ADR:**  
The specific forbidden string list is maintained in GOVERNANCE.md § 2, not here. This ADR establishes the principle; GOVERNANCE.md is the operational reference.
