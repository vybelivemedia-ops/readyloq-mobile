/**
 * Idempotent migration for FAIE predictive restocking & adaptive logistics
 * (Task #918):
 *  - Adds a configurable replenishment lead-time column to
 *    `replenishment_targets` (company default / per-product override, same
 *    sentinel scoping already used for daysOfSupply) and to
 *    `supplier_connections` (per-supplier override).
 *  - Creates `predictive_restock_recommendations`, the persisted,
 *    dismissible/actionable predictive signal distinct from
 *    `pending_restock_requests` (reactive) and the derive-on-read Truck
 *    Stock Health / Route Readiness views.
 *
 * Safe to run on every server startup (mirrors migrate-warehouse.ts).
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export async function migratePredictiveRestocking(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE replenishment_targets
        ADD COLUMN IF NOT EXISTS lead_time_days REAL
    `);

    await db.execute(sql`
      ALTER TABLE supplier_connections
        ADD COLUMN IF NOT EXISTS lead_time_days REAL
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS predictive_restock_recommendations (
        id                          SERIAL PRIMARY KEY,
        company_id                  INTEGER NOT NULL REFERENCES companies(id),
        technician_id               TEXT NOT NULL,
        product_id                  INTEGER NOT NULL REFERENCES products(id),
        quantity_on_hand            REAL NOT NULL,
        unit                        TEXT NOT NULL DEFAULT 'unit',
        projected_daily_rate        REAL NOT NULL,
        lead_time_days              REAL NOT NULL,
        safety_stock_days           REAL NOT NULL,
        reorder_point_quantity      REAL NOT NULL,
        recommended_order_quantity  REAL NOT NULL,
        scheduled_stop_count        INTEGER NOT NULL DEFAULT 0,
        projected_breach_at         TIMESTAMP,
        recommended_by_at           TIMESTAMP NOT NULL,
        status                      TEXT NOT NULL DEFAULT 'pending',
        converted_alert_id          INTEGER,
        resolved_at                 TIMESTAMP,
        created_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT predictive_restock_recommendations_uq UNIQUE (company_id, technician_id, product_id)
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS predictive_restock_recommendations_company_idx
        ON predictive_restock_recommendations (company_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS predictive_restock_recommendations_status_idx
        ON predictive_restock_recommendations (status)
    `);

    logger.info("[migrate-predictive-restocking] Lead-time columns & predictive recommendations table ready");
  } catch (err) {
    logger.error({ err }, "[migrate-predictive-restocking] Migration failed");
    throw err;
  }
}
