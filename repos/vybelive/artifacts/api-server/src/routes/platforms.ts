import { Router } from "express";
import { eq, and, count, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, platformsTable, usersTable } from "@workspace/db";
import { ConnectPlatformBody, UpdatePlatformBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { getPlanLimits } from "../lib/entitlements";

const router = Router();

// GET /api/platforms
router.get("/platforms", requireAuth, async (req, res) => {
  const platforms = await db
    .select()
    .from(platformsTable)
    .where(eq(platformsTable.userId, req.auth!.userId));
  res.json(platforms);
});

// POST /api/platforms
//
// Entitlement enforcement: the free plan is capped at 1 platform.
// The check and insert run inside a single transaction with a
// SELECT ... FOR UPDATE on the user row so concurrent requests cannot
// both pass the count check and both insert (TOCTOU prevention).
router.post("/platforms", requireAuth, async (req, res) => {
  const parsed = ConnectPlatformBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const userId = req.auth!.userId;

  let platform: typeof platformsTable.$inferSelect | undefined;
  let limitReached = false;

  await db.transaction(async (tx) => {
    // Lock the user row for the duration of this transaction so concurrent
    // POST /api/platforms requests from the same free account cannot both
    // observe count=0 and both insert a second platform.
    // With drizzle-orm/node-postgres (pg driver), tx.execute() returns a
    // pg QueryResult<T> where rows are in .rows[], not the top-level object.
    const result = await tx.execute<{ plan: string }>(
      sql`SELECT plan FROM ${usersTable} WHERE id = ${userId} FOR UPDATE`
    );
    const user = result.rows[0];

    if (!user) {
      return;
    }

    const limits = getPlanLimits(user.plan);

    if (limits.maxPlatforms !== null) {
      const [{ total }] = await tx
        .select({ total: count() })
        .from(platformsTable)
        .where(eq(platformsTable.userId, userId));

      if (total >= limits.maxPlatforms) {
        limitReached = true;
        return;
      }
    }

    [platform] = await tx
      .insert(platformsTable)
      .values({
        id: randomUUID(),
        userId,
        name: parsed.data.name,
        type: parsed.data.type as
          | "youtube"
          | "twitch"
          | "kick"
          | "facebook"
          | "instagram"
          | "tiktok"
          | "custom_rtmp",
        rtmpUrl: parsed.data.rtmpUrl ?? null,
        streamKey: parsed.data.streamKey ?? null,
      })
      .returning();
  });

  if (limitReached) {
    res.status(403).json({
      error:
        "Free plan is limited to 1 streaming platform. Upgrade to Pro or Enterprise to connect more.",
      code: "PLATFORM_LIMIT_REACHED",
    });
    return;
  }

  if (!platform) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.status(201).json(platform);
});

// PATCH /api/platforms/:platformId
router.patch("/platforms/:platformId", requireAuth, async (req, res) => {
  const parsed = UpdatePlatformBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [updated] = await db
    .update(platformsTable)
    .set(parsed.data)
    .where(
      and(
        eq(platformsTable.id, String(req.params.platformId)),
        eq(platformsTable.userId, req.auth!.userId)
      )
    )
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Platform not found" });
    return;
  }
  res.json(updated);
});

// DELETE /api/platforms/:platformId
router.delete("/platforms/:platformId", requireAuth, async (req, res) => {
  await db
    .delete(platformsTable)
    .where(
      and(
        eq(platformsTable.id, String(req.params.platformId)),
        eq(platformsTable.userId, req.auth!.userId)
      )
    );
  res.status(204).send();
});

export default router;
