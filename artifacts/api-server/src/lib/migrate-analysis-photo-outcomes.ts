/**
 * Idempotent startup migration for per-photo analysis outcomes.
 *
 * The JSON column lets newer API workers report deferred/rate-limited photos
 * while remaining compatible with analysis rows created before this field.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

export async function migrateAnalysisPhotoOutcomes(): Promise<void> {
  // This is intentionally one atomic statement. A startup worker can race
  // another worker, so an information_schema check followed by ALTER TABLE is
  // not safe. The explicit schema also prevents a search_path from selecting a
  // different table.
  await db.execute(
    sql`ALTER TABLE public.analysis_results
        ADD COLUMN IF NOT EXISTS photo_outcomes JSONB DEFAULT '[]'::jsonb`,
  );
  logger.info("migrateAnalysisPhotoOutcomes: ensured analysis_results.photo_outcomes");
}
