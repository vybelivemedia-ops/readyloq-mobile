/**
 * founderUser — resolve the single "founder / owner" VYBE user for the
 * unauthenticated Mission Control surface.
 *
 * Mission Control is unauthenticated by convention (it is the founder's internal
 * HQ). Social Command Center endpoints need a concrete VYBE user whose
 * oauth_connections and content they operate on. Rather than bolt partial auth
 * onto only the new routes, we resolve a designated founder user server-side.
 *
 * Resolution order (first match wins):
 *   1. FOUNDER_USER_ID env var (explicit override)
 *   2. The oldest user with role = "admin"
 *   3. The oldest active user
 *
 * Returns null only when there are no users at all — callers surface an honest
 * "no founder account" state instead of fabricating data.
 */

import { db, usersTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";

export interface FounderUser {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  role: "creator" | "admin";
  plan: "free" | "pro" | "enterprise";
  followersCount: number;
}

const SELECT = {
  id: usersTable.id,
  email: usersTable.email,
  username: usersTable.username,
  displayName: usersTable.displayName,
  avatarUrl: usersTable.avatarUrl,
  role: usersTable.role,
  plan: usersTable.plan,
  followersCount: usersTable.followersCount,
} as const;

let _cached: FounderUser | null = null;

/**
 * Resolve the founder user. Result is memoized for the process lifetime once a
 * user is found (the designated founder does not change at runtime). Pass
 * `{ fresh: true }` to bypass the cache (e.g. right after seeding).
 */
export async function resolveFounderUser(
  opts: { fresh?: boolean } = {},
): Promise<FounderUser | null> {
  if (_cached && !opts.fresh) return _cached;

  const explicitId = process.env["FOUNDER_USER_ID"]?.trim();
  if (explicitId) {
    const [row] = await db
      .select(SELECT)
      .from(usersTable)
      .where(eq(usersTable.id, explicitId))
      .limit(1);
    if (row) {
      _cached = row;
      return row;
    }
  }

  const [admin] = await db
    .select(SELECT)
    .from(usersTable)
    .where(eq(usersTable.role, "admin"))
    .orderBy(asc(usersTable.createdAt))
    .limit(1);
  if (admin) {
    _cached = admin;
    return admin;
  }

  const [first] = await db
    .select(SELECT)
    .from(usersTable)
    .where(eq(usersTable.accountStatus, "active"))
    .orderBy(asc(usersTable.createdAt))
    .limit(1);
  _cached = first ?? null;
  return _cached;
}

/** Test/seed hook — clears the memoized founder so the next resolve re-queries. */
export function clearFounderCache(): void {
  _cached = null;
}
