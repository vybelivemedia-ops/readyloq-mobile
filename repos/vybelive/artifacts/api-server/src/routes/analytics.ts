import { Router } from "express";
import { eq, and, gte, desc } from "drizzle-orm";
import { db, streamsTable, clipsTable, usersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { getPlanLimits } from "../lib/entitlements";

const router = Router();

function getPeriodStart(period: string): Date {
  const now = new Date();
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

// GET /api/analytics/overview
router.get("/analytics/overview", requireAuth, async (req, res) => {
  const period = (req.query["period"] as string) ?? "30d";
  const periodStart = getPeriodStart(period);
  const userId = req.auth!.userId;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user || !getPlanLimits(user.plan).advancedAnalytics) {
    res.status(403).json({
      error: "Advanced analytics require a Pro or Enterprise subscription.",
      code: "PLAN_UPGRADE_REQUIRED",
    });
    return;
  }

  const streams = await db
    .select()
    .from(streamsTable)
    .where(
      and(
        eq(streamsTable.userId, userId),
        gte(streamsTable.createdAt, periodStart)
      )
    )
    .orderBy(desc(streamsTable.totalViews))
    .limit(5);

  const allStreams = await db
    .select()
    .from(streamsTable)
    .where(and(eq(streamsTable.userId, userId), gte(streamsTable.createdAt, periodStart)));

  const clips = await db
    .select()
    .from(clipsTable)
    .where(and(eq(clipsTable.userId, userId), gte(clipsTable.createdAt, periodStart)));

  const totalViews = allStreams.reduce((s, st) => s + st.totalViews, 0);
  const totalWatchHours = allStreams.reduce(
    (s, st) => s + (st.durationSeconds * st.avgViewers) / 3600,
    0
  );
  const avgViewersPerStream = allStreams.length > 0
    ? allStreams.reduce((s, st) => s + st.avgViewers, 0) / allStreams.length
    : 0;
  const peakViewers = allStreams.reduce((m, st) => Math.max(m, st.peakViewers), 0);

  // Per-platform view attribution is not tracked yet — multistream destinations
  // do not report back real per-platform analytics. Return an empty breakdown
  // rather than synthesizing fake numbers by dividing totals across platforms.
  const platformBreakdown: { platform: string; views: number; watchHours: number; followers: number }[] = [];

  res.json({
    period,
    totalViews,
    totalWatchHours,
    avgViewersPerStream,
    peakViewers,
    totalStreams: allStreams.length,
    totalClips: clips.length,
    followerGrowth: Math.floor((user?.followersCount ?? 0) * 0.1),
    revenueEstimate: 0,
    platformBreakdown,
    dailyViews: [],
    topStreams: streams,
  });
});

// GET /api/analytics/streams/:streamId
router.get("/analytics/streams/:streamId", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;

  const [user] = await db
    .select({ plan: usersTable.plan })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user || !getPlanLimits(user.plan).advancedAnalytics) {
    res.status(403).json({
      error: "Advanced analytics require a Pro or Enterprise subscription.",
      code: "PLAN_UPGRADE_REQUIRED",
    });
    return;
  }

  const [stream] = await db
    .select()
    .from(streamsTable)
    .where(
      and(
        eq(streamsTable.id, String(req.params.streamId)),
        eq(streamsTable.userId, userId)
      )
    )
    .limit(1);

  if (!stream) {
    res.status(404).json({ error: "Stream not found" });
    return;
  }

  const clips = await db
    .select()
    .from(clipsTable)
    .where(eq(clipsTable.streamId, stream.id));

  res.json({
    streamId: stream.id,
    peakViewers: stream.peakViewers,
    avgViewers: stream.avgViewers,
    totalViews: stream.totalViews,
    watchHours: (stream.durationSeconds * stream.avgViewers) / 3600,
    chatMessages: 0,
    clipsGenerated: clips.length,
    platformBreakdown: stream.platforms.map((p) => ({
      platform: p,
      views: Math.floor(stream.totalViews / Math.max(stream.platforms.length, 1)),
      watchHours: 0,
    })),
  });
});

export default router;
