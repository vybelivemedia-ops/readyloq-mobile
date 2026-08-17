/**
 * Idempotent migration: add failure_reason column to analysis_results.
 *
 * New column:
 *   failure_reason  TEXT  — server-provided reason the analysis was skipped
 *                           or failed (e.g. "Image resolution too low").
 *                           NULL when no specific reason or analysis succeeded.
 *
 * Safe to run multiple times. Run from the repo root:
 *   node lib/db/migrate-analysis-failure-reason.mjs
 */
import pg from "pg";

const { Pool } = pg;

async function columnExists(client, table, col) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, col],
  );
  return rows.length > 0;
}

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    if (!(await columnExists(client, "analysis_results", "failure_reason"))) {
      await client.query(`ALTER TABLE analysis_results ADD COLUMN failure_reason TEXT`);
      console.log("Added analysis_results.failure_reason");
    } else {
      console.log("analysis_results.failure_reason already exists — skipped");
    }

    console.log("Migration complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
