/**
 * @platform/agent-registry
 *
 * Single source of truth for every named agent on the VYBE platform.
 * Both ReadyLoq and VYBE_HQ import from here — no per-app agent re-definition.
 *
 * ROSTER (from VYBE_HQ Command Center):
 *   Quinn Harlow   — Chief of Staff       (orchestration, briefings, task dispatch)
 *   Ada Reeves     — CTO                  (engineering, code review, architecture)
 *   Mara Linde     — QA Director          (quality audits, diagnostics, test coverage)
 *   Theo Vance     — Release Manager      (CI/CD, versioning, changelogs, deploys)
 *   Nadia Cole     — Product Manager      (roadmap, specs, backlog, user stories)
 *   Iris Moon      — Creative Director    (UI/UX, design direction, copy)
 *   Dario Sol      — Marketing Director   (campaigns, SEO, growth, social)
 *   Agent Zero     — Execution Engine     (the AI runner that acts on behalf of executives)
 *
 * DEPENDENCY GRAPH:
 *   agent-registry → shared-types → core
 *
 * USAGE:
 *   import { VYBE_AGENTS, createAgentRegistry } from "@platform/agent-registry";
 *
 *   const registry = createAgentRegistry();
 *   VYBE_AGENTS.forEach(a => registry.register(a));
 *   const quinn = registry.get("quinn-harlow");
 */
// ─── Factory ──────────────────────────────────────────────────────────────────
/**
 * Create a new in-memory PlatformAgentRegistry.
 * Typically called once at app startup; pass the VYBE_AGENTS roster to pre-fill.
 *
 * @example
 *   const registry = createAgentRegistry(VYBE_AGENTS);
 *   const quinn = registry.get("quinn-harlow");
 */
export function createAgentRegistry(initialAgents = []) {
    const entries = new Map();
    for (const agent of initialAgents) {
        entries.set(agent.id, { agent, status: agent.defaultStatus });
    }
    return {
        register(agent) {
            entries.set(agent.id, { agent, status: agent.defaultStatus });
        },
        unregister(id) {
            entries.delete(id);
        },
        get(id) {
            return entries.get(id);
        },
        list() {
            return Array.from(entries.values());
        },
        findAll(predicate) {
            return Array.from(entries.values()).filter(predicate);
        },
        findByCapability(capability) {
            return Array.from(entries.values()).filter(e => e.agent.capabilities.includes(capability));
        },
        findByDomain(domain) {
            return Array.from(entries.values()).filter(e => e.agent.domain === domain);
        },
        updateStatus(id, status, lastActiveAt) {
            const entry = entries.get(id);
            if (entry) {
                entry.status = status;
                if (lastActiveAt)
                    entry.lastActiveAt = lastActiveAt;
            }
        },
        applyRemoteSync(updates) {
            const now = new Date().toISOString();
            for (const update of updates) {
                const entry = entries.get(update.id);
                if (entry) {
                    entry.status = update.status;
                    entry.lastActiveAt = update.lastActiveAt;
                    entry.lastSyncedAt = now;
                    entry.syncError = undefined;
                }
            }
        },
    };
}
// ─── VYBE Live core agent roster ─────────────────────────────────────────────
//
// Canonical source of truth for all VYBE platform agents.
// Both VYBE_HQ (vybelive) and ReadyLoq import VYBE_AGENTS from here.
// Do NOT copy/paste these definitions into app repos.
//
// Order: Quinn (CoS) first, then executives alphabetically, Agent Zero last.
export const VYBE_AGENTS = [
    {
        id: "quinn-harlow",
        name: "Quinn Harlow",
        role: "Chief of Staff",
        domain: "operations",
        capabilities: ["task_dispatch", "briefing_generation", "memory_management"],
        defaultStatus: "active",
        initials: "QH",
        accentColor: "#a78bfa", // violet — primary orchestrator
        description: "Orchestrates daily operations, dispatches tasks to the executive team, generates briefings from live platform data, and maintains cross-session memory.",
    },
    {
        id: "ada-reeves",
        name: "Ada Reeves",
        role: "CTO",
        domain: "engineering",
        capabilities: ["code_review", "architecture_review", "diagnostics"],
        defaultStatus: "standby",
        initials: "AR",
        accentColor: "#38bdf8", // sky blue — technical clarity
        description: "Leads technical strategy, reviews code and architecture decisions, runs system diagnostics, and advises on engineering best practices.",
    },
    {
        id: "mara-linde",
        name: "Mara Linde",
        role: "QA Director",
        domain: "qa_diagnostics",
        capabilities: ["quality_audit", "diagnostics", "test_coverage"],
        defaultStatus: "standby",
        initials: "ML",
        accentColor: "#34d399", // emerald — quality / green gates
        description: "Owns quality standards across all platform outputs. Audits AI-generated content, runs diagnostics on failing systems, and reviews test coverage.",
    },
    {
        id: "theo-vance",
        name: "Theo Vance",
        role: "Release Manager",
        domain: "release",
        capabilities: ["release_management", "diagnostics"],
        defaultStatus: "standby",
        initials: "TV",
        accentColor: "#fb923c", // orange — ships things
        description: "Coordinates release pipelines, cuts version tags, writes changelogs, and gates production deploys on quality checks.",
    },
    {
        id: "nadia-cole",
        name: "Nadia Cole",
        role: "Product Manager",
        domain: "product",
        capabilities: ["product_planning", "user_story_authoring", "briefing_generation"],
        defaultStatus: "standby",
        initials: "NC",
        accentColor: "#f472b6", // pink — product + people
        description: "Maintains the product roadmap, triages and prioritizes the backlog, writes specs, and breaks epics into actionable user stories.",
    },
    {
        id: "iris-moon",
        name: "Iris Moon",
        role: "Creative Director",
        domain: "creative",
        capabilities: ["creative_direction", "copy_review"],
        defaultStatus: "standby",
        initials: "IM",
        accentColor: "#c084fc", // purple — creativity
        description: "Provides UI/UX direction, reviews design and copy for brand consistency, and guides the visual language of all platform surfaces.",
    },
    {
        id: "dario-sol",
        name: "Dario Sol",
        role: "Marketing Director",
        domain: "marketing",
        capabilities: ["marketing_campaigns", "seo_optimization", "copy_review"],
        defaultStatus: "standby",
        initials: "DS",
        accentColor: "#facc15", // amber — growth + attention
        description: "Plans and evaluates marketing campaigns, audits SEO performance, reviews outbound copy, and drives growth strategy.",
    },
    {
        id: "agent-zero",
        name: "Agent Zero",
        role: "Execution Engine",
        domain: "execution",
        capabilities: ["ai_execution", "task_dispatch", "memory_management"],
        defaultStatus: "standby",
        initials: "AZ",
        accentColor: "#17c4d3", // teal — the platform accent / AI core
        isExecutionEngine: true,
        description: "The AI execution engine that carries out tasks on behalf of all executive agents. Runs queued jobs, maintains execution memory, and reports results back to the dispatching agent.",
    },
];
// ─── Convenience lookup ───────────────────────────────────────────────────────
/** O(1) lookup map from agent id → PlatformAgent. Built from VYBE_AGENTS. */
export const VYBE_AGENTS_BY_ID = Object.fromEntries(VYBE_AGENTS.map(a => [a.id, a]));
/**
 * Executive agents only (excludes Agent Zero).
 * Useful for UIs that render the executive roster separately.
 */
export const VYBE_EXECUTIVES = VYBE_AGENTS.filter(a => !a.isExecutionEngine);
/** Agent Zero — the execution engine singleton. */
export const AGENT_ZERO = 
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
VYBE_AGENTS.find(a => a.isExecutionEngine);
/**
 * Endpoint convention for the shared agent status API.
 * Import this constant instead of hard-coding the URL in consuming apps.
 */
export const PLATFORM_AGENTS_API_URL = "https://vybe-live.replit.app/api/platform/agents";
