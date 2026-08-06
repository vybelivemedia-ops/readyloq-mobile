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
/**
 * The functional area an agent is responsible for.
 * Maps 1-to-1 with the VYBE_HQ sidebar sections.
 */
export type AgentDomain = "operations" | "engineering" | "qa_diagnostics" | "release" | "product" | "creative" | "marketing" | "execution";
/**
 * Typed capability token. A single agent may have multiple capabilities.
 * Used by the registry's findByCapability() to route work to the right agent.
 */
export type AgentCapability = "task_dispatch" | "briefing_generation" | "code_review" | "architecture_review" | "diagnostics" | "quality_audit" | "test_coverage" | "release_management" | "product_planning" | "user_story_authoring" | "creative_direction" | "copy_review" | "marketing_campaigns" | "seo_optimization" | "ai_execution" | "memory_management";
/** Runtime status of an agent at a given moment. */
export type AgentStatus = "active" | "standby" | "busy" | "offline";
/**
 * A named platform agent — either a human-role executive agent or the
 * AI execution engine (Agent Zero).
 *
 * All fields are readonly. Agents are immutable descriptors; runtime state
 * (status overrides, last-active timestamps) lives in AgentRegistryEntry.
 */
export interface PlatformAgent {
    /**
     * Stable identifier used as the registry key.
     * Format: kebab-case of the agent's full name or codename.
     * e.g. "quinn-harlow", "ada-reeves", "agent-zero"
     */
    readonly id: string;
    /** Full display name. */
    readonly name: string;
    /** Job title / role label shown in UIs (e.g. "Chief of Staff"). */
    readonly role: string;
    /** Primary functional domain this agent owns. */
    readonly domain: AgentDomain;
    /** Everything this agent can do — used for capability-based routing. */
    readonly capabilities: readonly AgentCapability[];
    /**
     * Default status when no live override is available.
     * Production integrations should override this from the live API response.
     */
    readonly defaultStatus: AgentStatus;
    /**
     * Two-character initials for avatar rendering.
     * e.g. "QH" (Quinn Harlow), "AZ" (Agent Zero)
     */
    readonly initials: string;
    /**
     * Hex color used for this agent's avatar and accent elements in UIs.
     * Colors are chosen to be distinct and accessible on dark backgrounds.
     */
    readonly accentColor: string;
    /**
     * True only for Agent Zero — the AI execution engine.
     * Executive agents have isExecutionEngine = false (or undefined).
     * UIs use this to render Agent Zero differently (e.g. as a system node).
     */
    readonly isExecutionEngine?: boolean;
    /**
     * Short description of what this agent does — shown in tooltips / detail views.
     */
    readonly description: string;
}
/**
 * A live registry entry wrapping an agent descriptor with runtime state.
 * The registry stores AgentRegistryEntries; callers read PlatformAgent from .agent.
 */
export interface AgentRegistryEntry {
    agent: PlatformAgent;
    /** Current status — may be overridden by a live sync from the platform API. */
    status: AgentStatus;
    /** ISO-8601 timestamp of the last received activity for this agent. */
    lastActiveAt?: string;
    /** ISO-8601 timestamp of the last status sync from the remote platform. */
    lastSyncedAt?: string;
    /** Any error message from the last remote sync attempt. */
    syncError?: string;
}
export interface PlatformAgentRegistry {
    /** Register an agent using its default status. */
    register(agent: PlatformAgent): void;
    /** Remove an agent from the registry. */
    unregister(id: string): void;
    /** Retrieve an entry by agent id. */
    get(id: string): AgentRegistryEntry | undefined;
    /** List all registered entries. */
    list(): AgentRegistryEntry[];
    /** Find entries whose agent matches a predicate. */
    findAll(predicate: (entry: AgentRegistryEntry) => boolean): AgentRegistryEntry[];
    /** Convenience: find agents with a given capability. */
    findByCapability(capability: AgentCapability): AgentRegistryEntry[];
    /** Convenience: find agents with a given domain. */
    findByDomain(domain: AgentDomain): AgentRegistryEntry[];
    /** Update the live status of a registered agent. */
    updateStatus(id: string, status: AgentStatus, lastActiveAt?: string): void;
    /**
     * Apply a batch status update from a remote sync response.
     * Any agent id not present in the update retains its current status.
     */
    applyRemoteSync(updates: Array<{
        id: string;
        status: AgentStatus;
        lastActiveAt?: string;
    }>): void;
}
/**
 * Create a new in-memory PlatformAgentRegistry.
 * Typically called once at app startup; pass the VYBE_AGENTS roster to pre-fill.
 *
 * @example
 *   const registry = createAgentRegistry(VYBE_AGENTS);
 *   const quinn = registry.get("quinn-harlow");
 */
export declare function createAgentRegistry(initialAgents?: readonly PlatformAgent[]): PlatformAgentRegistry;
export declare const VYBE_AGENTS: readonly PlatformAgent[];
/** O(1) lookup map from agent id → PlatformAgent. Built from VYBE_AGENTS. */
export declare const VYBE_AGENTS_BY_ID: Readonly<Record<string, PlatformAgent>>;
/**
 * Executive agents only (excludes Agent Zero).
 * Useful for UIs that render the executive roster separately.
 */
export declare const VYBE_EXECUTIVES: readonly PlatformAgent[];
/** Agent Zero — the execution engine singleton. */
export declare const AGENT_ZERO: PlatformAgent;
/**
 * Shape of a single agent record returned by the platform's live-status API.
 *
 * GET https://vybe-live.replit.app/api/platform/agents
 * → { agents: PlatformAgentSyncRecord[] }
 *
 * Both VYBE_HQ and ReadyLoq call this endpoint to get live status.
 * The endpoint is implemented in the vybelive API server.
 */
export interface PlatformAgentSyncRecord {
    id: string;
    status: AgentStatus;
    lastActiveAt?: string;
}
export interface PlatformAgentSyncResponse {
    agents: PlatformAgentSyncRecord[];
    syncedAt: string;
}
/**
 * Endpoint convention for the shared agent status API.
 * Import this constant instead of hard-coding the URL in consuming apps.
 */
export declare const PLATFORM_AGENTS_API_URL: "https://vybe-live.replit.app/api/platform/agents";
//# sourceMappingURL=index.d.ts.map