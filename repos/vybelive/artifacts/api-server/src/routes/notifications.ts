import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router = Router();

// GET /api/notifications
router.get("/notifications", requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "20"), 10), 100);
  const unreadOnly = req.query["unreadOnly"] === "true";

  const where = unreadOnly
    ? and(
        eq(notificationsTable.userId, req.auth!.userId),
        eq(notificationsTable.read, false)
      )
    : eq(notificationsTable.userId, req.auth!.userId);

  const notifications = await db
    .select()
    .from(notificationsTable)
    .where(where)
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit);

  res.json(notifications);
});

// PATCH /api/notifications/:notificationId/read
router.patch("/notifications/:notificationId/read", requireAuth, async (req, res) => {
  const [notification] = await db
    .update(notificationsTable)
    .set({ read: true })
    .where(
      and(
        eq(notificationsTable.id, String(req.params.notificationId)),
        eq(notificationsTable.userId, req.auth!.userId)
      )
    )
    .returning();

  if (!notification) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  res.json(notification);
});

// POST /api/notifications/read-all
router.post("/notifications/read-all", requireAuth, async (req, res) => {
  await db
    .update(notificationsTable)
    .set({ read: true })
    .where(eq(notificationsTable.userId, req.auth!.userId));
  res.status(204).send();
});

export default router;
