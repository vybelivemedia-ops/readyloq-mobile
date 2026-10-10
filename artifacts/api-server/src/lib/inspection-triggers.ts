/**
 * Inspection event triggers — enterprise bridge wiring.
 *
 * Call setupInspectionTriggers() once at server startup to register all
 * inspection lifecycle listeners. Currently handles:
 *
 *   inspection:finalized → EnterpriseAdapterRouter.dispatch()
 *     Fires after the full finalization pipeline (report, narrative, scorecard,
 *     property memory) completes. Dispatches the structured inspection payload
 *     to the company's configured enterprise system (PestPac, ServSuite, FieldRoutes).
 *
 * The listener is intentionally best-effort: errors are caught and logged inside
 * EnterpriseAdapterRouter.dispatch() and never propagate to the event bus.
 */

import { enterpriseEventBus } from "./enterprise-event-bus";
import { EnterpriseAdapterRouter } from "../services/integration/enterprise-router";
import { logger } from "./logger";

export function setupInspectionTriggers(): void {
  enterpriseEventBus.onInspectionFinalized(async (event) => {
    logger.info(
      { companyId: event.companyId, inspectionId: event.inspectionId },
      "[EnterpriseBridge] Inspection finalized — routing to enterprise adapters",
    );

    try {
      await EnterpriseAdapterRouter.dispatch(event);
      logger.info(
        { companyId: event.companyId, inspectionId: event.inspectionId },
        "[EnterpriseBridge] Dispatch complete",
      );
    } catch (err) {
      // EnterpriseAdapterRouter.dispatch() catches its own errors — this catch
      // is a final safety net so the event bus never crashes the process.
      logger.error(
        { err, companyId: event.companyId, inspectionId: event.inspectionId },
        "[EnterpriseBridge] Unhandled error in dispatch — this is a bug",
      );
    }
  });

  logger.info("[EnterpriseBridge] Inspection triggers registered");
}
