/**
 * Idempotent startup migration: ensure push notification columns exist on the
 * users table. Called once on server boot before any request handler runs.
 *
 * New columns:
 *   push_token                 TEXT                           — Expo push token (nullable)
 *   push_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE  — owner opt-out flag
 *
 * Uses raw SQL so it does not depend on Drizzle's schema state and can safely
 * run against a database that was provisioned before this migration was added.
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

export async function migratePushNotificationColumns(): Promise<void> {
  // Push token columns on users
  if (!(await columnExists("users", "push_token"))) {
    await db.execute(sql`ALTER TABLE users ADD COLUMN push_token TEXT`);
    logger.info("migratePushNotifications: added users.push_token");
  }

  if (!(await columnExists("users", "push_notifications_enabled"))) {
    await db.execute(
      sql`ALTER TABLE users ADD COLUMN push_notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE`,
    );
    logger.info("migratePushNotifications: added users.push_notifications_enabled");
  }

  // Push failure flag on users — surfaces delivery errors in the owner dashboard
  if (!(await columnExists("users", "push_last_failed_at"))) {
    await db.execute(sql`ALTER TABLE users ADD COLUMN push_last_failed_at TIMESTAMPTZ`);
    logger.info("migratePushNotifications: added users.push_last_failed_at");
  }

  // Delivery idempotency flag on inspection_scorecards
  if (!(await columnExists("inspection_scorecards", "critical_alert_sent"))) {
    await db.execute(
      sql`ALTER TABLE inspection_scorecards ADD COLUMN critical_alert_sent BOOLEAN NOT NULL DEFAULT FALSE`,
    );
    logger.info("migratePushNotifications: added inspection_scorecards.critical_alert_sent");
  }
}
