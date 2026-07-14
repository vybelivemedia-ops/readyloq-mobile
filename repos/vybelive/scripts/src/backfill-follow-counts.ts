/**
 * VYBE LIVE — Backfill follow counts
 *
 * Recomputes the denormalized `users.followers_count` and
 * `users.following_count` columns from the authoritative `follows` edge table.
 * Run once after introducing the follow graph (or any time the counters are
 * suspected to have drifted). Idempotent: safe to run repeatedly.
 */

import { db, pool, usersTable } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main(): Promise<void> {
  const result = await db.transaction(async (tx) => {
    // followers_count = number of edges where this user is the followed party.
    await tx.update(usersTable).set({
      followersCount: sql`(
        SELECT COUNT(*)::int FROM follows WHERE follows.followed_id = ${usersTable.id}
      )`,
    });

    // following_count = number of edges where this user is the follower.
    await tx.update(usersTable).set({
      followingCount: sql`(
        SELECT COUNT(*)::int FROM follows WHERE follows.follower_id = ${usersTable.id}
      )`,
    });

    const [{ users }] = await tx
      .select({ users: sql<number>`COUNT(*)::int` })
      .from(usersTable);
    return { users };
  });

  console.log(`Backfill complete — reconciled follow counts for ${result.users} users.`);
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
