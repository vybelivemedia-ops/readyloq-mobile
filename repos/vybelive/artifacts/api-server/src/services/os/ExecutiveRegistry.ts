// ─── Mission Control OS Layer — Executive Registry ────────────────────────────
//
// A typed, queryable registry of AI executive descriptors that is derived
// entirely from the existing `executiveCapabilities/index.ts` constants and the
// `ai_executives` DB table.
//
// This layer does NOT replace the capability inspector logic in
// `executiveCapabilities/`. It only provides a unified lookup surface so that
// future OS components (Quinn Orchestrator, Objective Manager, Execution
// Providers) can ask "what executives exist?" without importing from multiple
// places.
//
// Design rules:
//   • Registry is populated lazily on first use — no startup cost.
//   • Deterministic `CAPABILITY_INFO` / `ROLES_WITH_CAPABILITY` values are
//     combined with DB rows for live exec state (name, status).
//   • A static fallback is used if the DB is unavailable — the system degrades
//     gracefully rather than crashing.

import { db, aiExecutivesTable } from "@workspace/db";
import { logger } from "../../lib/logger.js";
import {
  CAPABILITY_INFO,
  ROLES_WITH_CAPABILITY,
} from "../executiveCapabilities/index.js";
import type { ExecutiveDescriptor } from "./types.js";

// ─── Static capability map ────────────────────────────────────────────────────
// Built from the deterministic constants in executiveCapabilities so we never
// rely solely on the DB for structural information.

const CAPABLE_ROLES = new Set<string>(ROLES_WITH_CAPABILITY);

function buildStaticDescriptor(role: string): ExecutiveDescriptor {
  const info = CAPABILITY_INFO[role];
  return {
    role,
    name: roleToDisplayName(role),
    responsibility: info?.responsibility ?? `${role} executive`,
    resources: info?.resources ?? [],
    hasCapability: CAPABLE_ROLES.has(role),
  };
}

function roleToDisplayName(role: string): string {
  return role
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ─── ExecutiveRegistry class ──────────────────────────────────────────────────

export class ExecutiveRegistry {
  /** In-memory descriptor map, keyed by role slug. */
  private _descriptors = new Map<string, ExecutiveDescriptor>();
  private _loaded = false;

  /**
   * Load descriptors from the DB, merging with static capability data.
   * Idempotent — subsequent calls are no-ops unless `force` is true.
   */
  async load(force = false): Promise<void> {
    if (this._loaded && !force) return;

    // Start with the static capability-backed descriptors.
    for (const role of Object.keys(CAPABILITY_INFO)) {
      this._descriptors.set(role, buildStaticDescriptor(role));
    }

    // Merge live DB rows — these may include additional exec roles
    // that do not have a deterministic capability inspector (e.g. "chief_of_staff").
    try {
      const rows = await db.select().from(aiExecutivesTable);

      for (const row of rows) {
        const role = row.role;
        const existing = this._descriptors.get(role);
        this._descriptors.set(role, {
          role,
          name: row.name,
          responsibility:
            existing?.responsibility ?? CAPABILITY_INFO[role]?.responsibility ?? `${role} executive`,
          resources: existing?.resources ?? CAPABILITY_INFO[role]?.resources ?? [],
          hasCapability: CAPABLE_ROLES.has(role),
        });
      }

      logger.info(
        { count: this._descriptors.size },
        "os/ExecutiveRegistry: loaded from DB",
      );
    } catch (err) {
      logger.warn(
        { err },
        "os/ExecutiveRegistry: DB load failed — using static capability map only",
      );
    }

    this._loaded = true;
  }

  /** Returns the descriptor for a given role slug, or null if not registered. */
  get(role: string): ExecutiveDescriptor | null {
    return this._descriptors.get(role) ?? null;
  }

  /** Returns all registered descriptors. */
  all(): ExecutiveDescriptor[] {
    return [...this._descriptors.values()];
  }

  /** Returns descriptors for roles that have a deterministic capability inspector. */
  withCapability(): ExecutiveDescriptor[] {
    return this.all().filter((d) => d.hasCapability);
  }

  /** Returns only the role slugs. */
  roles(): string[] {
    return [...this._descriptors.keys()];
  }

  /** Total number of registered executives. */
  get size(): number {
    return this._descriptors.size;
  }

  /**
   * Find executives whose responsibility or name matches a keyword.
   * Case-insensitive substring match.
   */
  search(keyword: string): ExecutiveDescriptor[] {
    const lower = keyword.toLowerCase();
    return this.all().filter(
      (d) =>
        d.role.toLowerCase().includes(lower) ||
        d.name.toLowerCase().includes(lower) ||
        d.responsibility.toLowerCase().includes(lower),
    );
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _registry: ExecutiveRegistry | null = null;

/** Returns the process-singleton ExecutiveRegistry, creating it on first call. */
export function getExecutiveRegistry(): ExecutiveRegistry {
  if (!_registry) _registry = new ExecutiveRegistry();
  return _registry;
}
