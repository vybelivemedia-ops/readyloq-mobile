# ADR-017: Product-Specific AI Agents Live in Applications, Not the Platform

**Status:** Accepted  
**Date:** 2026-07-18  
**Author:** Platform Architecture  
**Supersedes:** Nothing  
**See also:** ADR-003 (ai-core scope), ADR-012 (platform-intelligence), ADR-019 (platform boundary)

---

## Context

Both ReadyLoq and VYBE include AI agent systems:

- **ReadyLoq** has an AI inspection assistant — it analyses captured evidence, surfaces findings, generates narratives, scores coverage, and guides the technician through multi-zone inspections. As the product matures this becomes a full inspection AI agent with memory, guidance, and decision-making.

- **VYBE** has Quinn and Agent Zero — AI executives that manage the live session, orchestrate creator actions, schedule autonomous tasks, and monitor stream health through Mission Control. These are sophisticated, long-running agents with goal hierarchies and retrospective learning.

The question for the platform is: where does the AI agent infrastructure live?

**Option A — Platform owns the agent framework**  
`@platform/platform-intelligence` implements the full agent: perception, planning, memory, action execution, tool-use, reflection. ReadyLoq and VYBE both import a `createAgent()` factory from the platform and extend it.

Drawback: the goal structures, tool inventories, memory schemas, and action grammars of an inspection agent and a live-stream executive agent are completely different. Abstracting them into a common agent framework forces one of two bad outcomes — either the abstraction is so thin it adds no value, or it becomes so opinionated that one product's agent must fight the framework to do anything useful.

**Option B — Applications own their agents; platform owns only agent infrastructure primitives**  
`@platform/platform-intelligence` provides the *substrate*: `PluginRegistry`, `WorkflowEngine`, `IntelligenceSession`, `GuidanceEngine`, `MemoryOrchestrator`, `ProviderCoordinator`, `EventRouter`. These are the OS-level building blocks — scheduling, routing, state management, plugin lifecycle.

ReadyLoq's inspection agent is assembled in `readyloq-app/` and `api-server/` using these building blocks, with pest-domain prompts, inspection memory schemas, scorecard rules, and coverage guidance all living in the application layer.

VYBE's Quinn / Agent Zero are assembled in `vybelive/` using the same building blocks, with mission-control schemas, autonomy engine rules, creator tool inventory, and social publishing actions all living in VYBE.

---

## Decision

**Option B — applications own their AI agents; the platform owns only generic agent infrastructure.**

Concretely:
- `@platform/platform-intelligence` provides orchestration primitives — plugin registry, workflow engine, session management, event routing, memory interface, guidance interface, provider coordination. Zero domain logic. Zero prompt templates.
- `@platform/ai-core` provides the AI provider abstraction — `AIProvider`, `AIProviderFactory`, `ConfidenceScore`. Zero domain logic. Zero prompt templates.
- ReadyLoq owns its Inspector AI agent in full: prompts, memory schema, coverage rules, scorecard generation, findings vocabulary, report narrative templates.
- VYBE owns Quinn and Agent Zero in full: goal hierarchies, task scheduling, tool inventory, mission-control schemas, autonomy engine rules, retrospective logic.

---

## Consequences

**What this enables:**
- Both agents can evolve at product velocity without platform review gates.
- Platform primitives can be improved (better scheduling, richer memory interfaces, more capable event routing) without touching either product's agent logic.
- A third application can build a completely different kind of AI agent — a logistics planner, a financial advisor, a content recommendation engine — on the same platform substrate.

**What this constrains:**
- Common agent patterns (tool-use loops, reflection chains, goal decomposition) that both ReadyLoq and VYBE independently implement may diverge. If this becomes expensive, the right mitigation is to introduce a higher-level `@platform/agent-framework` package — but only once two concrete implementations exist to extract from, not speculatively.

**The test:**  
Ask: "Does this agent logic make sense for a live-streaming platform AND a pest inspection platform AND a hypothetical third platform?" If yes, it might belong in `@platform/platform-intelligence`. If the answer is "only for one of them", it lives in the application.

**What is forbidden in platform-intelligence and ai-core:**  
- Pest species, infestation scoring, inspection memory schemas, report templates, treatment guidance.
- Stream titles, creator tiers, Mission Control goal structures, autonomy engine rules, retrospective schemas.
- Any prompt template of any kind.
- Any reference to Quinn, Agent Zero, Inspector AI, or any product's named agent.
