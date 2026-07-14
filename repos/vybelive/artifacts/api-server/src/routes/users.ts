import { Router } from "express";
import { randomUUID } from "crypto";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  streamsTable,
  clipsTable,
  followsTable,
  notificationsTable,
} from "@workspace/db";
import { UpdateMeBody } from "@workspace/api-zod";
import { requireAuth, optionalAuth } from "../middlewares/auth";

const router = Router();

function toPublicUser(user: typeof usersTable.$inferSelect) {
  const { passwordHash, refreshTokenHash, ...pub } = user;
  void passwordHash;
  void refreshTokenHash;
  return pub;
}

// PATCH /api/users/me
router.patch("/users/me", requireAuth, async (req, res) => {
  const parsed = UpdateMeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [updated] = await db
    .update(usersTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(usersTable.id, req.auth!.userId))
    .returning();

  res.json(toPublicUser(updated));
});

// GET /api/users/me/stats
router.get("/users/me/stats", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const streams = await db
    .select()
    .from(streamsTable)
    .where(eq(streamsTable.userId, userId));

  const clips = await db
    .select()
    .from(clipsTable)
    .where(eq(clipsTable.userId, userId));

  const totalViews = streams.reduce((s, st) => s + st.totalViews, 0);
  const totalWatchHours = streams.reduce((s, st) => s + (st.durationSeconds * st.avgViewers) / 3600, 0);
  const avgViewersPerStream = streams.length > 0
    ? streams.reduce((s, st) => s + st.avgViewers, 0) / streams.length
    : 0;
  const peakConcurrentViewers = Math.max(0, ...streams.map((s) => s.peakViewers));

  res.json({
    totalViews,
    totalFollowers: user.followersCount,
    totalStreams: user.totalStreams,
    totalClips: user.totalClips,
    totalWatchHours,
    avgViewersPerStream,
    peakConcurrentViewers,
  });
});

// ─── Follow graph ────────────────────────────────────────────────────────────

// GET /api/users/followers?userId=&limit=&offset=
router.get("/users/followers", optionalAuth, async (req, res) => {
  const targetId = String(req.query["userId"] ?? "");
  if (!targetId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "30"), 10) || 30, 100);
  const offset = Math.max(parseInt(String(req.query["offset"] ?? "0"), 10) || 0, 0);

  const rows = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      avatarUrl: usersTable.avatarUrl,
      bio: usersTable.bio,
      followersCount: usersTable.followersCount,
      category: usersTable.category,
    })
    .from(followsTable)
    .innerJoin(usersTable, eq(followsTable.followerId, usersTable.id))
    .where(eq(followsTable.followedId, targetId))
    .orderBy(desc(followsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json({ items: await withIsFollowing(rows, req.auth?.userId) });
});

// GET /api/users/following?userId=&limit=&offset=
router.get("/users/following", optionalAuth, async (req, res) => {
  const targetId = String(req.query["userId"] ?? "");
  if (!targetId) {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "30"), 10) || 30, 100);
  const offset = Math.max(parseInt(String(req.query["offset"] ?? "0"), 10) || 0, 0);

  const rows = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      avatarUrl: usersTable.avatarUrl,
      bio: usersTable.bio,
      followersCount: usersTable.followersCount,
      category: usersTable.category,
    })
    .from(followsTable)
    .innerJoin(usersTable, eq(followsTable.followedId, usersTable.id))
    .where(eq(followsTable.followerId, targetId))
    .orderBy(desc(followsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json({ items: await withIsFollowing(rows, req.auth?.userId) });
});

// POST /api/users/:userId/follow
router.post("/users/:userId/follow", requireAuth, async (req, res) => {
  const followerId = req.auth!.userId;
  const followedId = String(req.params.userId);

  if (followerId === followedId) {
    res.status(400).json({ error: "You cannot follow yourself" });
    return;
  }

  const [target] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.id, followedId))
    .limit(1);

  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Atomic + idempotent: insert the follow edge and bump both counters in a
  // single transaction. onConflictDoNothing makes concurrent/duplicate follows
  // safe — counters only move when a new edge is actually created.
  const inserted = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(followsTable)
      .values({ id: randomUUID(), followerId, followedId })
      .onConflictDoNothing({
        target: [followsTable.followerId, followsTable.followedId],
      })
      .returning({ id: followsTable.id });

    if (rows.length === 0) return false;

    await tx
      .update(usersTable)
      .set({ followersCount: sql`${usersTable.followersCount} + 1` })
      .where(eq(usersTable.id, followedId));
    await tx
      .update(usersTable)
      .set({ followingCount: sql`${usersTable.followingCount} + 1` })
      .where(eq(usersTable.id, followerId));

    return true;
  });

  if (inserted) {
    const [follower] = await db
      .select({ displayName: usersTable.displayName })
      .from(usersTable)
      .where(eq(usersTable.id, followerId))
      .limit(1);

    await db
      .insert(notificationsTable)
      .values({
        id: randomUUID(),
        userId: followedId,
        type: "new_follower",
        title: "New follower",
        message: `${follower?.displayName ?? "Someone"} started following you.`,
      })
      .catch((err) => req.log.error({ err, followedId }, "new_follower notification failed"));
  }

  const [updated] = await db
    .select({ followersCount: usersTable.followersCount })
    .from(usersTable)
    .where(eq(usersTable.id, followedId))
    .limit(1);

  res.json({ following: true, followersCount: updated?.followersCount ?? 0 });
});

// DELETE /api/users/:userId/follow
router.delete("/users/:userId/follow", requireAuth, async (req, res) => {
  const followerId = req.auth!.userId;
  const followedId = String(req.params.userId);

  const [target] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, followedId))
    .limit(1);

  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Atomic + idempotent: delete the edge and decrement counters in one
  // transaction. Counters only move when an edge was actually removed.
  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(followsTable)
      .where(
        and(
          eq(followsTable.followerId, followerId),
          eq(followsTable.followedId, followedId),
        ),
      )
      .returning({ id: followsTable.id });

    if (deleted.length === 0) return;

    await tx
      .update(usersTable)
      .set({ followersCount: sql`GREATEST(${usersTable.followersCount} - 1, 0)` })
      .where(eq(usersTable.id, followedId));
    await tx
      .update(usersTable)
      .set({ followingCount: sql`GREATEST(${usersTable.followingCount} - 1, 0)` })
      .where(eq(usersTable.id, followerId));
  });

  const [updated] = await db
    .select({ followersCount: usersTable.followersCount })
    .from(usersTable)
    .where(eq(usersTable.id, followedId))
    .limit(1);

  res.json({ following: false, followersCount: updated?.followersCount ?? 0 });
});

// GET /api/users/:userId
router.get("/users/:userId", optionalAuth, async (req, res) => {
  const userId = String(req.params.userId);

  const [user] = await db
    .select({
      id: usersTable.id,
      username: usersTable.username,
      displayName: usersTable.displayName,
      bio: usersTable.bio,
      avatarUrl: usersTable.avatarUrl,
      followersCount: usersTable.followersCount,
      followingCount: usersTable.followingCount,
      totalStreams: usersTable.totalStreams,
      totalClips: usersTable.totalClips,
      category: usersTable.category,
      locationCity: usersTable.locationCity,
      locationRegion: usersTable.locationRegion,
      locationCountry: usersTable.locationCountry,
      socialLinks: usersTable.socialLinks,
      collaborationInterests: usersTable.collaborationInterests,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const recentStreams = await db
    .select({
      id: streamsTable.id,
      title: streamsTable.title,
      status: streamsTable.status,
      thumbnailUrl: streamsTable.thumbnailUrl,
      totalViews: streamsTable.totalViews,
      createdAt: streamsTable.createdAt,
    })
    .from(streamsTable)
    .where(eq(streamsTable.userId, userId))
    .orderBy(desc(streamsTable.createdAt))
    .limit(6);

  const recentClips = await db
    .select({
      id: clipsTable.id,
      title: clipsTable.title,
      thumbnailUrl: clipsTable.thumbnailUrl,
      createdAt: clipsTable.createdAt,
    })
    .from(clipsTable)
    .where(eq(clipsTable.userId, userId))
    .orderBy(desc(clipsTable.createdAt))
    .limit(6);

  let isFollowing = false;
  if (req.auth?.userId && req.auth.userId !== userId) {
    const [follow] = await db
      .select({ id: followsTable.id })
      .from(followsTable)
      .where(
        and(
          eq(followsTable.followerId, req.auth.userId),
          eq(followsTable.followedId, userId),
        ),
      )
      .limit(1);
    isFollowing = !!follow;
  }

  res.json({ ...user, isFollowing, recentStreams, recentClips });
});

// Annotate a list of creators with whether the current viewer follows each one.
async function withIsFollowing<T extends { id: string }>(
  rows: T[],
  viewerId: string | undefined,
): Promise<(T & { isFollowing: boolean })[]> {
  if (!viewerId || rows.length === 0) {
    return rows.map((r) => ({ ...r, isFollowing: false }));
  }
  const followed = await db
    .select({ followedId: followsTable.followedId })
    .from(followsTable)
    .where(
      and(
        eq(followsTable.followerId, viewerId),
        inArray(
          followsTable.followedId,
          rows.map((r) => r.id),
        ),
      ),
    );
  const followedSet = new Set(followed.map((f) => f.followedId));
  return rows.map((r) => ({ ...r, isFollowing: followedSet.has(r.id) }));
}

export default router;
