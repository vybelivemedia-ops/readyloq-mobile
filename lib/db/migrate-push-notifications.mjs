/**
 * Idempotent migration: add push notification columns to the users table.
 *
 * New columns:
 *   push_token                TEXT                          — Expo push token (nullable)
 *   push_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE — owner opt-out flag
 *
 * Safe to run multiple times. Run from the repo root:
 *   node lib/db/migrate-push-notifications.mjs
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
    // push_token — nullable TEXT, no default
    if (!(await columnExists(client, "users", "push_token"))) {
      await client.query(`ALTER TABLE users ADD COLUMN push_token TEXT`);
      console.log("Added users.push_token");
    } else {
      console.log("users.push_token already exists — skipped");
    }

    // push_notifications_enabled — NOT NULL with DEFAULT TRUE
    if (!(await columnExists(client, "users", "push_notifications_enabled"))) {
      await client.query(
        `ALTER TABLE users ADD COLUMN push_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
      );
      console.log("Added users.push_notifications_enabled");
    } else {
      console.log("users.push_notifications_enabled already exists — skipped");
    }

    // critical_alert_sent — delivery idempotency flag on inspection_scorecards
    if (!(await columnExists(client, "inspection_scorecards", "critical_alert_sent"))) {
      await client.query(
        `ALTER TABLE inspection_scorecards ADD COLUMN critical_alert_sent BOOLEAN NOT NULL DEFAULT FALSE`,
      );
      console.log("Added inspection_scorecards.critical_alert_sent");
    } else {
      console.log("inspection_scorecards.critical_alert_sent already exists — skipped");
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
