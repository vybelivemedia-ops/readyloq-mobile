/**
 * Idempotent migration — creates the chemical inventory tables if they do not
 * already exist. Safe to run on every server startup.
 *
 * Tables created:
 *  - tech_inventory         (per-tech on-hand quantities)
 *  - tech_restock_events    (immutable delivery/restock audit log)
 *  - supplier_connections   (supplier portal credentials + sync state)
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export async function migrateInventoryTables(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tech_inventory (
        id                SERIAL PRIMARY KEY,
        company_id        INTEGER NOT NULL REFERENCES companies(id),
        technician_id     TEXT NOT NULL,
        product_id        INTEGER NOT NULL REFERENCES products(id),
        quantity_on_hand  REAL NOT NULL DEFAULT 0,
        unit              TEXT NOT NULL DEFAULT 'unit',
        created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT tech_inventory_uq UNIQUE (company_id, technician_id, product_id)
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS tech_inventory_company_idx
        ON tech_inventory (company_id)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS tech_inventory_technician_idx
        ON tech_inventory (technician_id)
    `);

    // Add restock_threshold column to existing tech_inventory rows (idempotent).
    await db.execute(sql`
      ALTER TABLE tech_inventory
        ADD COLUMN IF NOT EXISTS restock_threshold REAL
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS tech_restock_events (
        id                  SERIAL PRIMARY KEY,
        company_id          INTEGER NOT NULL REFERENCES companies(id),
        technician_id       TEXT NOT NULL,
        product_id          INTEGER NOT NULL REFERENCES products(id),
        quantity_received   REAL NOT NULL,
        unit                TEXT NOT NULL DEFAULT 'unit',
        source              TEXT NOT NULL DEFAULT 'manual',
        supplier_order_ref  TEXT,
        notes               TEXT,
        received_at         TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at          TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS tech_restock_events_company_idx
        ON tech_restock_events (company_id)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS tech_restock_events_technician_idx
        ON tech_restock_events (technician_id)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS tech_restock_events_received_at_idx
        ON tech_restock_events (received_at)
    `);

    // Unique partial index that enforces idempotency for CSV/supplier imports.
    // Only applies when supplier_order_ref IS NOT NULL so that manual restocks
    // (which have no order ref) can never conflict with each other.
    // This makes concurrent duplicate submissions safe at the DB level — the
    // second writer gets a conflict and the INSERT is silently skipped.
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS tech_restock_events_order_ref_uq
        ON tech_restock_events (company_id, technician_id, product_id, supplier_order_ref)
        WHERE supplier_order_ref IS NOT NULL
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS supplier_connections (
        id                    SERIAL PRIMARY KEY,
        company_id            INTEGER NOT NULL REFERENCES companies(id),
        supplier_name         TEXT NOT NULL,
        display_name          TEXT,
        account_identifier    TEXT NOT NULL,
        credentials_ref       TEXT,
        status                TEXT NOT NULL DEFAULT 'pending',
        status_message        TEXT,
        last_synced_at        TIMESTAMP,
        created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT supplier_connections_uq UNIQUE (company_id, supplier_name, account_identifier)
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS supplier_connections_company_idx
        ON supplier_connections (company_id)
    `);

    // ── Pending restock requests ──────────────────────────────────────────────
    // One row per (company, tech, product).  Created/re-opened when a treatment-
    // log deduction drops quantity_on_hand below restock_threshold.  The unique
    // constraint guarantees at most one alert row per tech/product pair so a
    // re-trigger after dismiss updates the existing row rather than duplicating.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS pending_restock_requests (
        id                  SERIAL PRIMARY KEY,
        company_id          INTEGER NOT NULL REFERENCES companies(id),
        technician_id       TEXT NOT NULL,
        product_id          INTEGER NOT NULL REFERENCES products(id),
        quantity_on_hand    REAL NOT NULL,
        restock_threshold   REAL NOT NULL,
        shortfall           REAL NOT NULL,
        status              TEXT NOT NULL DEFAULT 'pending',
        resolved_at         TIMESTAMP,
        created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT pending_restock_requests_uq
          UNIQUE (company_id, technician_id, product_id)
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS pending_restock_requests_company_idx
        ON pending_restock_requests (company_id)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS pending_restock_requests_status_idx
        ON pending_restock_requests (status)
    `);

    // ── Supplier orders ───────────────────────────────────────────────────────
    // Tracks placed orders (one row per approved alert). Separated from
    // tech_restock_events (receipt log) so CSV delivery confirmation still
    // works correctly and order placement is idempotent.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS supplier_orders (
        id               SERIAL PRIMARY KEY,
        company_id       INTEGER NOT NULL REFERENCES companies(id),
        alert_id         INTEGER NOT NULL,
        technician_id    TEXT NOT NULL,
        product_id       INTEGER NOT NULL REFERENCES products(id),
        supplier_name    TEXT NOT NULL,
        order_ref        TEXT NOT NULL,
        quantity_ordered REAL NOT NULL,
        unit             TEXT NOT NULL DEFAULT 'unit',
        status           TEXT NOT NULL DEFAULT 'placed',
        notes            TEXT,
        placed_at        TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        CONSTRAINT supplier_orders_alert_uq UNIQUE (company_id, alert_id)
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS supplier_orders_company_idx
        ON supplier_orders (company_id)
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS supplier_orders_technician_idx
        ON supplier_orders (technician_id)
    `);

    logger.info("[migrate-inventory] Inventory tables ready");
  } catch (err) {
    logger.error({ err }, "[migrate-inventory] Failed to create inventory tables");
    throw err;
  }
}
