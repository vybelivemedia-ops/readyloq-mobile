/**
 * Idempotent migration — creates the Warehouse tier, transaction ledger, and
 * replenishment-target tables if they do not already exist. Safe to run on
 * every server startup (mirrors migrate-inventory.ts).
 *
 * Tables created:
 *  - warehouse_inventory     (company-level on-hand balance per product)
 *  - inventory_transactions  (immutable, append-only movement ledger)
 *  - replenishment_targets   (company default / per-tech / per-product
 *                             days-of-supply + per-tech distance factor)
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export async function migrateWarehouseTables(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS warehouse_inventory (
        id                SERIAL PRIMARY KEY,
        company_id        INTEGER NOT NULL REFERENCES companies(id),
        product_id        INTEGER NOT NULL REFERENCES products(id),
        quantity_on_hand  REAL NOT NULL DEFAULT 0,
        unit              TEXT NOT NULL DEFAULT 'unit',
        created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT warehouse_inventory_uq UNIQUE (company_id, product_id)
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS warehouse_inventory_company_idx
        ON warehouse_inventory (company_id)
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS inventory_transactions (
        id                SERIAL PRIMARY KEY,
        company_id        INTEGER NOT NULL REFERENCES companies(id),
        product_id        INTEGER NOT NULL REFERENCES products(id),
        quantity          REAL NOT NULL,
        unit              TEXT NOT NULL DEFAULT 'unit',
        movement_type     TEXT NOT NULL,
        source            TEXT NOT NULL,
        destination       TEXT NOT NULL,
        technician_id     TEXT,
        acting_user_id    TEXT NOT NULL,
        reference_id      INTEGER,
        notes             TEXT,
        created_at        TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS inventory_transactions_company_idx
        ON inventory_transactions (company_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS inventory_transactions_technician_idx
        ON inventory_transactions (technician_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS inventory_transactions_product_idx
        ON inventory_transactions (product_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS inventory_transactions_created_at_idx
        ON inventory_transactions (created_at)
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS replenishment_targets (
        id                          SERIAL PRIMARY KEY,
        company_id                  INTEGER NOT NULL REFERENCES companies(id),
        technician_id               TEXT NOT NULL DEFAULT '',
        product_id                  INTEGER NOT NULL DEFAULT 0,
        days_of_supply              REAL,
        distance_adjustment_factor  REAL,
        created_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at                  TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT replenishment_targets_uq UNIQUE (company_id, technician_id, product_id)
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS replenishment_targets_company_idx
        ON replenishment_targets (company_id)
    `);

    logger.info("[migrate-warehouse] Warehouse/ledger/replenishment tables ready");
  } catch (err) {
    logger.error({ err }, "[migrate-warehouse] Migration failed");
    throw err;
  }
}
