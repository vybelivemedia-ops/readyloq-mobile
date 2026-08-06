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

// ─── Domain types ─────────────────────────────────────────────────────────────

/**
 * The functional area an agent is responsible for.
 * Maps 1-to-1 with the VYBE_HQ sidebar sections.
 */
export type AgentDomain =
  | "operations"       // top-level orchestration, daily briefings, objectives
  | "engineering"      // code, architecture, infrastructure
  | "qa_diagnostics"   // quality gates, test coverage, diagnostics
  | "release"          // CI/CD, versioning, changelogs, deploys
  | "product"          // roadmap, specs, backlog, user stories
  | "creative"         // UI/UX, design direction, brand copy
  | "marketing"        // campaigns, SEO, growth, social
  | "execution";       // AI execution engine — acts on behalf of all executives

/**
 * Typed capability token. A single agent may have multiple capabilities.
 * Used by the registry's findByCapability() to route work to the right agent.
 */
export type AgentCapability =
  | "task_dispatch"          // can receive + dispatch tasks to other agents/tools
  | "briefing_generation"    // produces daily/weekly briefings from live data
  | "code_review"            // analyzes diffs, suggests fixes, approves/blocks PRs
  | "architecture_review"    // evaluates system design and ADRs
  | "diagnostics"            // runs system health probes, interprets failure patterns
  | "quality_audit"          // reviews output quality against rubrics
  | "test_coverage"          // generates/reviews test suites, tracks coverage
  | "release_management"     // cuts releases, writes changelogs, coordinates deploys
  | "product_planning"       // writes specs, triages backlog, prioritizes work
  | "user_story_authoring"   // breaks epics into actionable user stories
  | "creative_direction"     // provides UI/UX direction and design critique
  | "copy_review"            // reviews and improves written content
  | "marketing_campaigns"    // plans and evaluates marketing campaigns
  | "seo_optimization"       // audits and improves SEO
  | "ai_execution"           // runs AI sub-tasks on behalf of other agents
  | "memory_management";     // maintains cross-session agent memory

/** Runtime status of an agent at a given moment. */
export type AgentStatus =
  | "active"    // working on a task right now
  | "standby"   // idle, ready to receive tasks
  | "busy"      // queued / scheduled, not immediately responsive
  | "offline";  // unreachable / not deployed in this environment

// ─── Core types ───────────────────────────────────────────────────────────────

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

// ─── Registry entry ───────────────────────────────────────────────────────────

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

// ─── Registry interface ───────────────────────────────────────────────────────

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
  applyRemoteSync(updates: Array<{ id: string; status: AgentStatus; lastActiveAt?: string }>): void;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Create a new in-memory PlatformAgentRegistry.
 * Typically called once at app startup; pass the VYBE_AGENTS roster to pre-fill.
 *
 * @example
 *   const registry = createAgentRegistry(VYBE_AGENTS);
 *   const quinn = registry.get("quinn-harlow");
 */
export function createAgentRegistry(
  initialAgents: readonly PlatformAgent[] = [],
): PlatformAgentRegistry {
  const entries = new Map<string, AgentRegistryEntry>();

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
      return Array.from(entries.values()).filter(e =>
        e.agent.capabilities.includes(capability),
      );
    },

    findByDomain(domain) {
      return Array.from(entries.values()).filter(e => e.agent.domain === domain);
    },

    updateStatus(id, status, lastActiveAt) {
      const entry = entries.get(id);
      if (entry) {
        entry.status = status;
        if (lastActiveAt) entry.lastActiveAt = lastActiveAt;
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

export const VYBE_AGENTS: readonly PlatformAgent[] = [
  {
    id: "quinn-harlow",
    name: "Quinn Harlow",
    role: "Chief of Staff",
    domain: "operations",
    capabilities: ["task_dispatch", "briefing_generation", "memory_management"],
    defaultStatus: "active",
    initials: "QH",
    accentColor: "#a78bfa",  // violet — primary orchestrator
    description:
      "Orchestrates daily operations, dispatches tasks to the executive team, generates briefings from live platform data, and maintains cross-session memory.",
  },
  {
    id: "ada-reeves",
    name: "Ada Reeves",
    role: "CTO",
    domain: "engineering",
    capabilities: ["code_review", "architecture_review", "diagnostics"],
    defaultStatus: "standby",
    initials: "AR",
    accentColor: "#38bdf8",  // sky blue — technical clarity
    description:
      "Leads technical strategy, reviews code and architecture decisions, runs system diagnostics, and advises on engineering best practices.",
  },
  {
    id: "mara-linde",
    name: "Mara Linde",
    role: "QA Director",
    domain: "qa_diagnostics",
    capabilities: ["quality_audit", "diagnostics", "test_coverage"],
    defaultStatus: "standby",
    initials: "ML",
    accentColor: "#34d399",  // emerald — quality / green gates
    description:
      "Owns quality standards across all platform outputs. Audits AI-generated content, runs diagnostics on failing systems, and reviews test coverage.",
  },
  {
    id: "theo-vance",
    name: "Theo Vance",
    role: "Release Manager",
    domain: "release",
    capabilities: ["release_management", "diagnostics"],
    defaultStatus: "standby",
    initials: "TV",
    accentColor: "#fb923c",  // orange — ships things
    description:
      "Coordinates release pipelines, cuts version tags, writes changelogs, and gates production deploys on quality checks.",
  },
  {
    id: "nadia-cole",
    name: "Nadia Cole",
    role: "Product Manager",
    domain: "product",
    capabilities: ["product_planning", "user_story_authoring", "briefing_generation"],
    defaultStatus: "standby",
    initials: "NC",
    accentColor: "#f472b6",  // pink — product + people
    description:
      "Maintains the product roadmap, triages and prioritizes the backlog, writes specs, and breaks epics into actionable user stories.",
  },
  {
    id: "iris-moon",
    name: "Iris Moon",
    role: "Creative Director",
    domain: "creative",
    capabilities: ["creative_direction", "copy_review"],
    defaultStatus: "standby",
    initials: "IM",
    accentColor: "#c084fc",  // purple — creativity
    description:
      "Provides UI/UX direction, reviews design and copy for brand consistency, and guides the visual language of all platform surfaces.",
  },
  {
    id: "dario-sol",
    name: "Dario Sol",
    role: "Marketing Director",
    domain: "marketing",
    capabilities: ["marketing_campaigns", "seo_optimization", "copy_review"],
    defaultStatus: "standby",
    initials: "DS",
    accentColor: "#facc15",  // amber — growth + attention
    description:
      "Plans and evaluates marketing campaigns, audits SEO performance, reviews outbound copy, and drives growth strategy.",
  },
  {
    id: "agent-zero",
    name: "Agent Zero",
    role: "Execution Engine",
    domain: "execution",
    capabilities: ["ai_execution", "task_dispatch", "memory_management"],
    defaultStatus: "standby",
    initials: "AZ",
    accentColor: "#17c4d3",  // teal — the platform accent / AI core
    isExecutionEngine: true,
    description:
      "The AI execution engine that carries out tasks on behalf of all executive agents. Runs queued jobs, maintains execution memory, and reports results back to the dispatching agent.",
  },
] as const;

// ─── Convenience lookup ───────────────────────────────────────────────────────

/** O(1) lookup map from agent id → PlatformAgent. Built from VYBE_AGENTS. */
export const VYBE_AGENTS_BY_ID: Readonly<Record<string, PlatformAgent>> =
  Object.fromEntries(VYBE_AGENTS.map(a => [a.id, a]));

/**
 * Executive agents only (excludes Agent Zero).
 * Useful for UIs that render the executive roster separately.
 */
export const VYBE_EXECUTIVES: readonly PlatformAgent[] = VYBE_AGENTS.filter(
  a => !a.isExecutionEngine,
);

/** Agent Zero — the execution engine singleton. */
export const AGENT_ZERO: PlatformAgent =
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  VYBE_AGENTS.find(a => a.isExecutionEngine)!;

// ─── Remote sync helpers ──────────────────────────────────────────────────────

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
  syncedAt: string; // ISO-8601
}

/**
 * Endpoint convention for the shared agent status API.
 * Import this constant instead of hard-coding the URL in consuming apps.
 */
export const PLATFORM_AGENTS_API_URL =
  "https://vybe-live.replit.app/api/platform/agents" as const;
