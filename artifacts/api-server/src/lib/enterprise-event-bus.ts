/**
 * In-process event bus for enterprise integration triggers.
 *
 * Fires `inspection:finalized` after the full finalization pipeline completes
 * (report, narrative, scorecard, property memory). The EnterpriseAdapterRouter
 * listens here and dispatches to the configured external system (PestPac, ServSuite,
 * FieldRoutes) without blocking the technician's completion response.
 *
 * Single-process only. No durable queue — if the process restarts between
 * finalization and the listener firing, the sync is retried via the manual
 * POST /api/integrations/sync route or the next scheduled re-sync sweep.
 */

import { EventEmitter } from "events";

export interface InspectionFinalizedEvent {
  companyId: number;
  inspectionId: number;
}

class EnterpriseEventBus extends EventEmitter {
  emitInspectionFinalized(event: InspectionFinalizedEvent): void {
    this.emit("inspection:finalized", event);
  }

  onInspectionFinalized(
    listener: (event: InspectionFinalizedEvent) => void,
  ): () => void {
    this.on("inspection:finalized", listener);
    return () => this.off("inspection:finalized", listener);
  }
}

export const enterpriseEventBus = new EnterpriseEventBus();
// Each integration config is one listener; generous cap still catches real leaks.
enterpriseEventBus.setMaxListeners(50);
