// ─── Mission Control OS Layer — Specialist Provider Registry ──────────────────
//
// A typed facade over the existing `specialistRegistry.ts` SPECIALISTS array.
//
// The existing registry is a flat array of `SpecialistDef` objects. This OS
// layer wraps it with a queryable `Map`-backed interface so components can do
// O(1) lookups by ID, filter by ownerRole, and search by trigger keyword —
// without having to import the raw array.
//
// Design rules:
//   • Never modifies the source SPECIALISTS array — read-only facade.
//   • All external-facing types use `SpecialistDescriptor` from `types.ts`,
//     not the internal `SpecialistDef` from `specialistRegistry.ts`.
//   • Consultation logic stays in `specialistRegistry.ts`; this class only
//     answers "who is registered?" questions.

import { SPECIALISTS } from "../specialistRegistry.js";
import type { SpecialistDescriptor } from "./types.js";

// ─── Adapter ──────────────────────────────────────────────────────────────────

function toDescriptor(def: (typeof SPECIALISTS)[number]): SpecialistDescriptor {
  return {
    id: def.id,
    name: def.name,
    kind: def.kind,
    purpose: def.purpose,
    ownerRole: def.ownerRole,
    collaboratorRoles: def.collaboratorRoles,
    triggers: def.triggers,
  };
}

// ─── SpecialistProviderRegistry class ────────────────────────────────────────

export class SpecialistProviderRegistry {
  private readonly _byId = new Map<string, SpecialistDescriptor>();
  private readonly _byOwner = new Map<string, SpecialistDescriptor[]>();

  constructor() {
    this._build();
  }

  private _build(): void {
    for (const def of SPECIALISTS) {
      const desc = toDescriptor(def);
      this._byId.set(desc.id, desc);

      const ownerList = this._byOwner.get(desc.ownerRole) ?? [];
      ownerList.push(desc);
      this._byOwner.set(desc.ownerRole, ownerList);
    }
  }

  /** Look up a specialist by stable ID. Returns null if not found. */
  get(id: string): SpecialistDescriptor | null {
    return this._byId.get(id) ?? null;
  }

  /** All registered specialists. */
  all(): SpecialistDescriptor[] {
    return [...this._byId.values()];
  }

  /** Total registered specialist count. */
  get size(): number {
    return this._byId.size;
  }

  /** Specialists owned by a given executive role. */
  forRole(ownerRole: string): SpecialistDescriptor[] {
    return this._byOwner.get(ownerRole) ?? [];
  }

  /**
   * Find specialists whose trigger list contains a keyword (substring match).
   * Case-insensitive.
   */
  matchTriggers(text: string): SpecialistDescriptor[] {
    const lower = text.toLowerCase();
    return this.all().filter((desc) =>
      desc.triggers.some((t) => lower.includes(t.toLowerCase())),
    );
  }

  /**
   * Find specialists whose name, purpose, or triggers contain the keyword.
   * Used for discovery / Quinn routing hints.
   */
  search(keyword: string): SpecialistDescriptor[] {
    const lower = keyword.toLowerCase();
    return this.all().filter(
      (d) =>
        d.name.toLowerCase().includes(lower) ||
        d.purpose.toLowerCase().includes(lower) ||
        d.triggers.some((t) => t.toLowerCase().includes(lower)),
    );
  }

  /** IDs of all registered specialists. */
  ids(): string[] {
    return [...this._byId.keys()];
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _registry: SpecialistProviderRegistry | null = null;

/**
 * Returns the process-singleton SpecialistProviderRegistry, creating it on
 * first call. The registry reads SPECIALISTS synchronously so it is available
 * before the first await.
 */
export function getSpecialistProviderRegistry(): SpecialistProviderRegistry {
  if (!_registry) _registry = new SpecialistProviderRegistry();
  return _registry;
}
