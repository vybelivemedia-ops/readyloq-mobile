/**
 * Periodic predictive-restock recompute (Task #918).
 *
 * The adaptive forecast is also recomputed event-triggered, right after each
 * treatment-log deduction (see recomputePredictiveRecommendationForProduct in
 * treatment-logs.ts) — but a technician/product pair whose demand is driven
 * mostly by an upcoming *schedule* change (a new route added, not a new
 * deduction) would otherwise never get re-evaluated. This sweep re-derives
 * every company's recommendations every 6 hours so the forecast stays
 * "adaptive... recalculated periodically" even without fresh consumption
 * events, per the task's explicit "periodically (or on-demand)" requirement.
 */

import cron from "node-cron";
import { db, companiesTable } from "@workspace/db";
import { recomputeAllPredictiveRecommendationsForCompany } from "./predictive-restocking";
import { logger } from "./logger";

export interface PredictiveRestockSweepResult {
  companies: number;
  technicians: number;
  evaluated: number;
  flagged: number;
}

export async function runPredictiveRestockSweep(): Promise<PredictiveRestockSweepResult> {
  const companies = await db.select({ id: companiesTable.id }).from(companiesTable);

  let technicians = 0;
  let evaluated = 0;
  let flagged = 0;

  for (const company of companies) {
    try {
      const result = await recomputeAllPredictiveRecommendationsForCompany(company.id);
      technicians += result.technicianCount;
      evaluated += result.evaluated;
      flagged += result.flagged;
    } catch (err) {
      logger.error({ err, companyId: company.id }, "predictive-restocking-scheduler: failed to process company");
    }
  }

  const summary = { companies: companies.length, technicians, evaluated, flagged };
  logger.info(summary, "predictive-restocking-scheduler: sweep complete");
  return summary;
}

/**
 * Registers the periodic sweep (every 6 hours). Call once at server startup.
 */
export function startPredictiveRestockScheduler(): void {
  cron.schedule(
    "0 */6 * * *",
    () => {
      void runPredictiveRestockSweep().catch((err) => {
        logger.error({ err }, "predictive-restocking-scheduler: unhandled sweep error");
      });
    },
    { timezone: "UTC" },
  );

  logger.info("predictive-restocking-scheduler: registered 6-hourly sweep");
}
