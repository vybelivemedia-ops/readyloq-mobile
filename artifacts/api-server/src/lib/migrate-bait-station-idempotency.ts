import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

/**
 * Add nullable idempotency metadata without modifying legacy stations.
 * PostgreSQL's ordinary unique-index NULL semantics allow every pre-existing
 * station (client_key NULL) to remain untouched.
 */
export async function migrateBaitStationIdempotency(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE bait_stations
      ADD COLUMN IF NOT EXISTS client_key TEXT,
      ADD COLUMN IF NOT EXISTS client_payload_hash TEXT
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS bait_stations_company_inspection_client_key_unique
      ON bait_stations (company_id, inspection_id, client_key)
  `);
  logger.info("migrateBaitStationIdempotency: ensured bait station idempotency index");
}