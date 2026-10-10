/**
 * Idempotent startup migration: ensure the briefing_email_opt_out column
 * exists on the users table. Called once on server boot before any request
 * handler runs.
 *
 * New column:
 *   briefing_email_opt_out  BOOLEAN NOT NULL DEFAULT FALSE
 *     — when TRUE the daily executive briefing email is suppressed for this
 *       user even if they are an owner with a valid email address on file.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

async function columnExists(table: string, column: string): Promise<boolean> {
  const result = await db.execute(
    sql`SELECT 1 FROM information_schema.columns
        WHERE table_name = ${table} AND column_name = ${column}`,
  );
  return result.rows.length > 0;
}

export async function migrateBriefingEmailColumn(): Promise<void> {
  if (!(await columnExists("users", "briefing_email_opt_out"))) {
    await db.execute(
      sql`ALTER TABLE users ADD COLUMN briefing_email_opt_out BOOLEAN NOT NULL DEFAULT FALSE`,
    );
    logger.info("migrateBriefingEmail: added users.briefing_email_opt_out");
  }
}
