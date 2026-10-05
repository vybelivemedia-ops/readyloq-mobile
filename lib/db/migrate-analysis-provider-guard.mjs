/**
 * Add the durable per-company/inspection/media AI provider attempt guard.
 * Safe to run repeatedly. Run with DATABASE_URL set:
 *   node lib/db/migrate-analysis-provider-guard.mjs
 */
import pg from "pg";

const { Pool } = pg;

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(`
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
    await pool.query(`
      ALTER TABLE analysis_provider_attempts
        ADD COLUMN IF NOT EXISTS provider_result JSONB
    `);
    console.log("Ensured analysis_provider_attempts exists.");
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});