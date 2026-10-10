import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

/**
 * Ensure the durable per-photo provider claim table exists before the API
 * starts accepting analysis requests. Idempotent for repeated server starts.
 */
export async function migrateAnalysisProviderGuard(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS analysis_provider_attempts (
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      inspection_id INTEGER NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
      media_path TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      state TEXT NOT NULL DEFAULT 'failed',
      lease_until TIMESTAMP,
      lease_token TEXT,
      provider_result JSONB,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (company_id, inspection_id, media_path)
    )
  `);
  await db.execute(sql`
    ALTER TABLE analysis_provider_attempts
      ADD COLUMN IF NOT EXISTS provider_result JSONB
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS analysis_provider_daily_budgets (
      scope_id INTEGER NOT NULL,
      budget_date DATE NOT NULL,
      consumed_calls INTEGER NOT NULL DEFAULT 0 CHECK (consumed_calls >= 0),
      daily_limit INTEGER NOT NULL CHECK (daily_limit >= 0),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (scope_id, budget_date)
    )
  `);
  logger.info("migrateAnalysisProviderGuard: ensured durable provider attempts and daily budgets");
}
