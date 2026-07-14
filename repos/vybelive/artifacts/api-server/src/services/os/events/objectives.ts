// ─── OS Event Bus — Objective Domain Events ───────────────────────────────────
// Full objective lifecycle — including the Phase 1 events that are already
// emitted by ObjectiveManager.ts, carried forward here so the EventPayloadMap
// is the single source of truth.

import type { OSObjective } from "../types.js";

export interface ObjectivesEventMap {
  /** New objective created (any source). */
  "objective.created": {
    objective: OSObjective;
  };
  /** Objective status changed (any transition). */
  "objective.updated": {
    objective: OSObjective;
    newStatus: string;
  };
  /** Objective moved into active execution. */
  "objective.in_progress": {
    objective: OSObjective;
  };
  /** Objective blocked waiting for founder approval. */
  "objective.needs_approval": {
    objective: OSObjective;
    reason: string;
    approvalId: string;
  };
  /** All workstreams done, briefing generated. */
  "objective.completed": {
    objective: OSObjective;
  };
  /** Objective could not be completed. */
  "objective.failed": {
    objective: OSObjective;
    reason: string;
  };
  /** A measurable intermediate milestone was reached. */
  "objective.milestone_reached": {
    objective: OSObjective;
    milestone: string;
    progressPercent: number;
  };
}
