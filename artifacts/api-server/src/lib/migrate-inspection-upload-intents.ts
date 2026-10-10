import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

/**
 * Keep upload reservations after parent inspection deletion so read-only
 * reconciliation can identify retained object orphans without deleting bytes.
 */
export async function migrateInspectionUploadIntents(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS inspection_upload_intents (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      company_id INTEGER NOT NULL,
      inspection_id INTEGER NOT NULL,
      client_key TEXT NOT NULL,
      media_type TEXT NOT NULL,
      content_type TEXT NOT NULL,
      expected_size INTEGER NOT NULL CHECK (expected_size > 0),
      checksum_algorithm TEXT,
      checksum_value TEXT,
      object_path TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'reserved'
        CHECK (state IN ('reserved', 'registered', 'abandoned')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      registered_media_id INTEGER
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS inspection_upload_intents_user_company_inspection_key_unique
      ON inspection_upload_intents (user_id, company_id, inspection_id, client_key)
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS inspection_upload_intents_object_path_unique
      ON inspection_upload_intents (object_path)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS inspection_upload_intents_company_state_expiry_idx
      ON inspection_upload_intents (company_id, state, expires_at)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS inspection_upload_intents_inspection_idx
      ON inspection_upload_intents (inspection_id)
  `);
  logger.info("migrateInspectionUploadIntents: ensured durable inspection upload reservations");
}