/**
 * Idempotent migration: add a composite expression index on
 * (company_id, COALESCE(scheduled_date, created_at)) to the inspections table.
 *
 * This index lets GET /api/schedule seek directly to the requested date window
 * without scanning every inspection for the company, making response time
 * proportional to the window size rather than total company history.
 *
 * Safe to run multiple times. Run from the repo root:
 *   node lib/db/migrate-schedule-index.mjs
 */
import pg from "pg";

const { Pool } = pg;

async function indexExists(client, name) {
  const { rows } = await client.query(
    `SELECT 1 FROM pg_indexes WHERE indexname = $1`,
    [name],
  );
  return rows.length > 0;
}

async function run() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const INDEX_NAME = "inspections_company_cal_date_idx";

    if (await indexExists(client, INDEX_NAME)) {
      console.log(`Index "${INDEX_NAME}" already exists — skipped.`);
    } else {
      // CONCURRENTLY avoids an exclusive table lock during index creation.
      // CREATE INDEX CONCURRENTLY must NOT run inside a transaction; this
      // pg client call is not wrapped in one.
      await client.query(`
        CREATE INDEX CONCURRENTLY ${INDEX_NAME}
        ON inspections (company_id, COALESCE(scheduled_date, created_at))
      `);
      console.log(`Created index "${INDEX_NAME}".`);
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
