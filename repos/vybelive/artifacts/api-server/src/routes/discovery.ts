import { Router } from "express";
import {
  eq,
  and,
  or,
  ne,
  asc,
  desc,
  count,
  ilike,
  gte,
  inArray,
  notExists,
  sql,
} from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";
import { db, usersTable, streamsTable, followsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router = Router();

// Columns that make up a CreatorSummary (the shared discovery card shape).
const summaryColumns = {
  id: usersTable.id,
  username: usersTable.username,
  displayName: usersTable.displayName,
  avatarUrl: usersTable.avatarUrl,
  bio: usersTable.bio,
  followersCount: usersTable.followersCount,
  category: usersTable.category,
} as const;

type CreatorRow = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  followersCount: number;
  category: (typeof usersTable.$inferSelect)["category"];
};

const DISCOVERY_WINDOW_DAYS = 14;

// Scoring weights for suggested creators (deterministic, server-side).
const SCORE_SHARED_CATEGORY = 40;
const SCORE_SAME_CITY = 30;
const SCORE_SAME_REGION = 20;
const SCORE_SAME_COUNTRY = 10;
const SCORE_PER_INTEREST = 10;
const SCORE_INTEREST_CAP = 30;
const SCORE_PER_MUTUAL = 15;
const SCORE_MUTUAL_CAP = 45;

const CATEGORY_LABELS: Record<string, string> = {
  automotive: "Automotive",
  fitness: "Fitness",
  business: "Business",
  real_estate: "Real estate",
  podcast: "Podcast",
  gaming: "Gaming",
  music: "Music",
  lifestyle: "Lifestyle",
  travel: "Travel",
  food: "Food",
  education: "Education",
  tech: "Tech",
  sports: "Sports",
  other: "Other",
};

function categoryLabel(cat: string | null): string {
  if (!cat) return "this category";
  return CATEGORY_LABELS[cat] ?? cat;
}

function clampLimit(raw: unknown, fallback: number, max = 50): number {
  const n = parseInt(String(raw ?? fallback), 10);
  if (Number.isNaN(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function clampOffset(raw: unknown): number {
  const n = parseInt(String(raw ?? "0"), 10);
  if (Number.isNaN(n) || n < 0) return 0;
  return n;
}

// Bounded, index-friendly "viewer does not already follow this candidate"
// predicate. Uses a correlated NOT EXISTS anti-join (backed by
// follows_follower_followed_unq) instead of materializing the viewer's entire
// follow list into a notInArray(...) parameter list.
function notFollowedByViewer(viewerId: string, candidateCol: AnyPgColumn) {
  const excl = alias(followsTable, "excl_follows");
  return notExists(
    db
      .select({ one: sql`1` })
      .from(excl)
      .where(and(eq(excl.followerId, viewerId), eq(excl.followedId, candidateCol))),
  );
}

// GET /api/discovery/creators?section=&limit=&offset=
router.get("/discovery/creators", requireAuth, async (req, res) => {
  const viewerId = req.auth!.userId;
  const section = String(req.query["section"] ?? "");
  const limit = clampLimit(req.query["limit"], 20);
  const offset = clampOffset(req.query["offset"]);

  if (!["trending", "new", "growing", "nearby"].includes(section)) {
    res.status(400).json({ error: "Invalid section" });
    return;
  }

  const baseFilters = and(
    ne(usersTable.id, viewerId),
    notFollowedByViewer(viewerId, usersTable.id),
    eq(usersTable.accountStatus, "active"),
  );

  let rows: CreatorRow[];

  if (section === "new") {
    rows = await db
      .select(summaryColumns)
      .from(usersTable)
      .where(baseFilters)
      .orderBy(desc(usersTable.createdAt), asc(usersTable.id))
      .limit(limit)
      .offset(offset);
  } else if (section === "trending") {
    const since = new Date(Date.now() - DISCOVERY_WINDOW_DAYS * 86400_000);
    const activity = sql<number>`coalesce(sum(${streamsTable.totalViews}), 0)`;
    rows = await db
      .select(summaryColumns)
      .from(usersTable)
      .innerJoin(streamsTable, eq(streamsTable.userId, usersTable.id))
      .where(and(baseFilters, gte(streamsTable.createdAt, since)))
      .groupBy(usersTable.id)
      .orderBy(desc(activity), desc(usersTable.followersCount), asc(usersTable.id))
      .limit(limit)
      .offset(offset);
  } else if (section === "growing") {
    const since = new Date(Date.now() - DISCOVERY_WINDOW_DAYS * 86400_000);
    const growth = count(followsTable.id);
    rows = await db
      .select(summaryColumns)
      .from(usersTable)
      .innerJoin(followsTable, eq(followsTable.followedId, usersTable.id))
      .where(and(baseFilters, gte(followsTable.createdAt, since)))
      .groupBy(usersTable.id)
      .orderBy(desc(growth), desc(usersTable.followersCount), asc(usersTable.id))
      .limit(limit)
      .offset(offset);
  } else {
    // nearby
    const [viewer] = await db
      .select({
        locationCity: usersTable.locationCity,
        locationRegion: usersTable.locationRegion,
        locationCountry: usersTable.locationCountry,
      })
      .from(usersTable)
      .where(eq(usersTable.id, viewerId))
      .limit(1);

    const locConds = [];
    const caseParts = [];
    if (viewer?.locationCity) {
      locConds.push(eq(usersTable.locationCity, viewer.locationCity));
      caseParts.push(sql`WHEN ${usersTable.locationCity} = ${viewer.locationCity} THEN 3`);
    }
    if (viewer?.locationRegion) {
      locConds.push(eq(usersTable.locationRegion, viewer.locationRegion));
      caseParts.push(sql`WHEN ${usersTable.locationRegion} = ${viewer.locationRegion} THEN 2`);
    }
    if (viewer?.locationCountry) {
      locConds.push(eq(usersTable.locationCountry, viewer.locationCountry));
      caseParts.push(sql`WHEN ${usersTable.locationCountry} = ${viewer.locationCountry} THEN 1`);
    }

    if (locConds.length === 0) {
      res.json({ items: [] });
      return;
    }

    const proximity = sql<number>`CASE ${sql.join(caseParts, sql` `)} ELSE 0 END`;
    rows = await db
      .select(summaryColumns)
      .from(usersTable)
      .where(and(baseFilters, or(...locConds)))
      .orderBy(desc(proximity), desc(usersTable.followersCount), asc(usersTable.id))
      .limit(limit)
      .offset(offset);
  }

  // Section results exclude already-followed creators, so isFollowing is always
  // false here.
  res.json({ items: rows.map((r) => ({ ...r, isFollowing: false })) });
});

// GET /api/discovery/suggested?limit=
router.get("/discovery/suggested", requireAuth, async (req, res) => {
  const viewerId = req.auth!.userId;
  const limit = clampLimit(req.query["limit"], 20);

  const [viewer] = await db
    .select({
      category: usersTable.category,
      locationCity: usersTable.locationCity,
      locationRegion: usersTable.locationRegion,
      locationCountry: usersTable.locationCountry,
      collaborationInterests: usersTable.collaborationInterests,
    })
    .from(usersTable)
    .where(eq(usersTable.id, viewerId))
    .limit(1);

  // Bounded sample of who the viewer follows, used to find 2nd-degree overlap.
  const followingRows = await db
    .select({ id: followsTable.followedId })
    .from(followsTable)
    .where(eq(followsTable.followerId, viewerId))
    .limit(200);
  const followingIds = followingRows.map((f) => f.id);

  // ── Bounded candidate gathering ──────────────────────────────────────────
  // 1) Follow-graph overlap: creators followed by people the viewer follows.
  const mutualMap = new Map<string, number>();
  if (followingIds.length > 0) {
    const secondDegree = await db
      .select({ followedId: followsTable.followedId, mutual: count(followsTable.id) })
      .from(followsTable)
      .where(
        and(
          inArray(followsTable.followerId, followingIds),
          ne(followsTable.followedId, viewerId),
          notFollowedByViewer(viewerId, followsTable.followedId),
        ),
      )
      .groupBy(followsTable.followedId)
      .orderBy(desc(count(followsTable.id)))
      .limit(50);
    for (const row of secondDegree) mutualMap.set(row.followedId, Number(row.mutual));
  }

  // 2) Same content category.
  const categoryIds: string[] = [];
  if (viewer?.category) {
    const r = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.category, viewer.category),
          ne(usersTable.id, viewerId),
          notFollowedByViewer(viewerId, usersTable.id),
          eq(usersTable.accountStatus, "active"),
        ),
      )
      .orderBy(desc(usersTable.followersCount), asc(usersTable.id))
      .limit(50);
    for (const row of r) categoryIds.push(row.id);
  }

  // 3) Same location (city/region/country).
  const locationIds: string[] = [];
  const locConds = [];
  if (viewer?.locationCity) locConds.push(eq(usersTable.locationCity, viewer.locationCity));
  if (viewer?.locationRegion) locConds.push(eq(usersTable.locationRegion, viewer.locationRegion));
  if (viewer?.locationCountry) locConds.push(eq(usersTable.locationCountry, viewer.locationCountry));
  if (locConds.length > 0) {
    const r = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(
        and(
          or(...locConds),
          ne(usersTable.id, viewerId),
          notFollowedByViewer(viewerId, usersTable.id),
          eq(usersTable.accountStatus, "active"),
        ),
      )
      .orderBy(desc(usersTable.followersCount), asc(usersTable.id))
      .limit(50);
    for (const row of r) locationIds.push(row.id);
  }

  const candidateIds = Array.from(
    new Set<string>([...mutualMap.keys(), ...categoryIds, ...locationIds]),
  ).slice(0, 150);

  const viewerInterests = new Set(
    (viewer?.collaborationInterests ?? []).map((i) => i.trim().toLowerCase()).filter(Boolean),
  );

  // ── Fallback: nothing to personalize on → popular active creators ─────────
  if (candidateIds.length === 0) {
    const popular = await db
      .select(summaryColumns)
      .from(usersTable)
      .where(
        and(
          ne(usersTable.id, viewerId),
          notFollowedByViewer(viewerId, usersTable.id),
          eq(usersTable.accountStatus, "active"),
        ),
      )
      .orderBy(desc(usersTable.followersCount), asc(usersTable.id))
      .limit(limit);
    res.json({
      items: popular.map((r) => ({ ...r, isFollowing: false, reason: "Popular on VYBE" })),
    });
    return;
  }

  const candidates = await db
    .select({
      ...summaryColumns,
      locationCity: usersTable.locationCity,
      locationRegion: usersTable.locationRegion,
      locationCountry: usersTable.locationCountry,
      collaborationInterests: usersTable.collaborationInterests,
    })
    .from(usersTable)
    .where(and(inArray(usersTable.id, candidateIds), eq(usersTable.accountStatus, "active")));

  type Scored = CreatorRow & { score: number; reason: string };
  const scored: Scored[] = candidates.map((c) => {
    // Track contributing factors in priority order so ties resolve
    // deterministically (category > follow overlap > location > interests).
    let score = 0;
    let best = { weight: 0, text: "" };
    const consider = (weight: number, text: string) => {
      score += weight;
      if (weight > best.weight) best = { weight, text };
    };

    if (viewer?.category && c.category && c.category === viewer.category) {
      consider(SCORE_SHARED_CATEGORY, `Also streams ${categoryLabel(c.category)}`);
    }

    const mutual = mutualMap.get(c.id) ?? 0;
    if (mutual > 0) {
      consider(
        Math.min(mutual * SCORE_PER_MUTUAL, SCORE_MUTUAL_CAP),
        `Followed by ${mutual} ${mutual === 1 ? "creator" : "creators"} you follow`,
      );
    }

    if (viewer?.locationCity && c.locationCity && c.locationCity === viewer.locationCity) {
      consider(SCORE_SAME_CITY, `In ${c.locationCity}`);
    } else if (
      viewer?.locationRegion &&
      c.locationRegion &&
      c.locationRegion === viewer.locationRegion
    ) {
      consider(SCORE_SAME_REGION, `Near you in ${c.locationRegion}`);
    } else if (
      viewer?.locationCountry &&
      c.locationCountry &&
      c.locationCountry === viewer.locationCountry
    ) {
      consider(SCORE_SAME_COUNTRY, `In ${c.locationCountry}`);
    }

    const shared = (c.collaborationInterests ?? []).filter((i) =>
      viewerInterests.has(i.trim().toLowerCase()),
    );
    if (shared.length > 0) {
      consider(
        Math.min(shared.length * SCORE_PER_INTEREST, SCORE_INTEREST_CAP),
        `Shares your interest in ${shared[0]}`,
      );
    }

    return {
      id: c.id,
      username: c.username,
      displayName: c.displayName,
      avatarUrl: c.avatarUrl,
      bio: c.bio,
      followersCount: c.followersCount,
      category: c.category,
      score,
      reason: best.text || "Suggested for you",
    };
  });

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.followersCount - a.followersCount ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  res.json({
    items: scored.slice(0, limit).map((s) => ({
      id: s.id,
      username: s.username,
      displayName: s.displayName,
      avatarUrl: s.avatarUrl,
      bio: s.bio,
      followersCount: s.followersCount,
      category: s.category,
      isFollowing: false,
      reason: s.reason,
    })),
  });
});

// GET /api/discovery/browse?category=&q=&limit=&offset=
router.get("/discovery/browse", requireAuth, async (req, res) => {
  const viewerId = req.auth!.userId;
  const limit = clampLimit(req.query["limit"], 20);
  const offset = clampOffset(req.query["offset"]);
  const category = String(req.query["category"] ?? "").trim();
  const q = String(req.query["q"] ?? "").trim();

  const validCategories = Object.keys(CATEGORY_LABELS);
  if (category && !validCategories.includes(category)) {
    res.status(400).json({ error: "Invalid category" });
    return;
  }

  const filters = [
    ne(usersTable.id, viewerId),
    eq(usersTable.accountStatus, "active"),
  ];
  if (category) {
    filters.push(eq(usersTable.category, category as Exclude<CreatorRow["category"], null>));
  }
  if (q) {
    const pattern = `%${q}%`;
    filters.push(or(ilike(usersTable.username, pattern), ilike(usersTable.displayName, pattern))!);
  }

  const rows = await db
    .select(summaryColumns)
    .from(usersTable)
    .where(and(...filters))
    .orderBy(desc(usersTable.followersCount), asc(usersTable.id))
    .limit(limit)
    .offset(offset);

  res.json({ items: await withIsFollowing(rows, viewerId) });
});

// Annotate creators with whether the viewer already follows each one.
async function withIsFollowing<T extends { id: string }>(
  rows: T[],
  viewerId: string,
): Promise<(T & { isFollowing: boolean })[]> {
  if (rows.length === 0) return [];
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
