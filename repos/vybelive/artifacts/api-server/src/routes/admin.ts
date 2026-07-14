import { Router } from "express";
import { eq, ilike, desc, count } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, usersTable, streamsTable, subscriptionsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/auth";

const router = Router();

// GET /api/admin/metrics
router.get("/admin/metrics", requireAdmin, async (_req, res) => {
  const [[{ totalUsers }], [{ activeUsers }], [{ liveStreamsNow }], [{ totalStreams }]] =
    await Promise.all([
      db.select({ totalUsers: count() }).from(usersTable),
      db.select({ activeUsers: count() }).from(subscriptionsTable).where(eq(subscriptionsTable.status, "active")),
      db.select({ liveStreamsNow: count() }).from(streamsTable).where(eq(streamsTable.status, "live")),
      db.select({ totalStreams: count() }).from(streamsTable),
    ]);

  res.json({
    totalUsers: Number(totalUsers),
    activeUsers: Number(activeUsers),
    liveStreamsNow: Number(liveStreamsNow),
    totalStreams: Number(totalStreams),
    totalClips: 0,
    revenue: 0,
    newUsersToday: 0,
    newUsersThisWeek: 0,
    platformDistribution: [],
  });
});

// GET /api/admin/users
router.get("/admin/users", requireAdmin, async (req, res) => {
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "50"), 10), 200);
  const offset = parseInt(String(req.query["offset"] ?? "0"), 10);
  const search = req.query["search"] as string | undefined;

  const where = search
    ? ilike(usersTable.email, `%${search}%`)
    : undefined;

  const [items, [{ total }]] = await Promise.all([
    db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        username: usersTable.username,
        displayName: usersTable.displayName,
        role: usersTable.role,
        plan: usersTable.plan,
        followersCount: usersTable.followersCount,
        totalStreams: usersTable.totalStreams,
        createdAt: usersTable.createdAt,
      })
      .from(usersTable)
      .where(where)
      .orderBy(desc(usersTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(usersTable).where(where),
  ]);

  res.json({ items, total: Number(total) });
});

// GET /api/admin/streams
router.get("/admin/streams", requireAdmin, async (req, res) => {
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "50"), 10), 200);
  const offset = parseInt(String(req.query["offset"] ?? "0"), 10);
  const status = req.query["status"] as string | undefined;

  const where = status
    ? eq(streamsTable.status, status as "scheduled" | "live" | "ended")
    : undefined;

  const [items, [{ total }]] = await Promise.all([
    db
      .select({
        id: streamsTable.id,
        userId: streamsTable.userId,
        title: streamsTable.title,
        status: streamsTable.status,
        peakViewers: streamsTable.peakViewers,
        platforms: streamsTable.platforms,
        createdAt: streamsTable.createdAt,
      })
      .from(streamsTable)
      .where(where)
      .orderBy(desc(streamsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(streamsTable).where(where),
  ]);

  const enriched = await Promise.all(
    items.map(async (s) => {
      const [user] = await db
        .select({ displayName: usersTable.displayName })
        .from(usersTable)
        .where(eq(usersTable.id, s.userId))
        .limit(1);
      return { ...s, creatorName: user?.displayName ?? "Unknown" };
    })
  );

  res.json({ items: enriched, total: Number(total) });
});

// POST /api/admin/users/:userId/plan — manual plan override (admin only, beta use)
//
// Security: this endpoint is the server-authoritative override path for admins
// to grant or revoke plans during beta testing, in lieu of full payment integration.
// It is guarded by requireAdmin which verifies the JWT role=admin claim.
// Regular users cannot reach this route — any attempt returns 401/403.
router.post("/admin/users/:userId/plan", requireAdmin, async (req, res) => {
  const userId = String(req.params["userId"]);
  const { planId } = (req.body ?? {}) as { planId?: string };

  const VALID_PLANS = ["plan_free", "plan_pro", "plan_enterprise"] as const;
  type ValidPlanId = typeof VALID_PLANS[number];
  if (!planId || !(VALID_PLANS as readonly string[]).includes(planId)) {
    res.status(400).json({ error: `planId must be one of: ${VALID_PLANS.join(", ")}` });
    return;
  }

  const planName = (planId as ValidPlanId).replace("plan_", "") as "free" | "pro" | "enterprise";

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await db
    .update(usersTable)
    .set({ plan: planName })
    .where(eq(usersTable.id, userId));

  const currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const existing = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.userId, userId))
    .limit(1);

  let subscription;
  if (existing.length > 0) {
    [subscription] = await db
      .update(subscriptionsTable)
      .set({ planId, planName, status: "active", currentPeriodEnd, cancelAtPeriodEnd: false })
      .where(eq(subscriptionsTable.userId, userId))
      .returning();
  } else {
    [subscription] = await db
      .insert(subscriptionsTable)
      .values({ id: randomUUID(), userId, planId, planName, status: "active", currentPeriodEnd })
      .returning();
  }

  req.log.info({ adminId: req.auth!.userId, targetUserId: userId, planId }, "Admin plan override applied");
  res.json(subscription);
});

export default router;
