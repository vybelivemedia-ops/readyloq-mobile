import { Router } from "express";
import { eq, and, or, desc, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  db,
  collaborationRequestsTable,
  notificationsTable,
  usersTable,
  type CollaborationRequest as CollaborationRequestRow,
} from "@workspace/db";
import {
  CreateCollaborationRequestBody,
  UpdateCollaborationStatusBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { resolveCollaborationTransition } from "../services/collaborationTransitions";

const router = Router();

const COLLAB_TYPE_LABELS: Record<string, string> = {
  co_stream: "co-stream",
  joint_podcast: "joint podcast",
  event: "event",
  other: "collaboration",
};

type CreatorSummary = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  followersCount: number;
  category: string | null;
};

async function loadCreatorSummaries(ids: string[]): Promise<Map<string, CreatorSummary>> {
  const map = new Map<string, CreatorSummary>();
  if (ids.length === 0) return map;
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
    .from(usersTable)
    .where(inArray(usersTable.id, ids));
  for (const r of rows) map.set(r.id, r);
  return map;
}

function hydrate(
  row: CollaborationRequestRow,
  viewerId: string,
  creators: Map<string, CreatorSummary>,
): Record<string, unknown> {
  const fromUser = creators.get(row.fromUserId) ?? null;
  const toUser = creators.get(row.toUserId) ?? null;
  return {
    id: row.id,
    type: row.type,
    message: row.message,
    status: row.status,
    direction: row.fromUserId === viewerId ? "outgoing" : "incoming",
    scheduledAt: row.scheduledAt ? row.scheduledAt.toISOString() : null,
    fromUser,
    toUser,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function hydrateList(
  rows: CollaborationRequestRow[],
  viewerId: string,
): Promise<Record<string, unknown>[]> {
  const ids = new Set<string>();
  for (const r of rows) {
    ids.add(r.fromUserId);
    ids.add(r.toUserId);
  }
  const creators = await loadCreatorSummaries([...ids]);
  return rows.map((r) => hydrate(r, viewerId, creators));
}

// POST /api/collaborations — send a collaboration request
router.post("/collaborations", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const parsed = CreateCollaborationRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid collaboration request" });
    return;
  }
  const { toUserId, type, message } = parsed.data;

  if (toUserId === userId) {
    res.status(400).json({ error: "You cannot send a collaboration request to yourself" });
    return;
  }

  const [recipient] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, toUserId));
  if (!recipient) {
    res.status(404).json({ error: "Recipient creator not found" });
    return;
  }

  const scheduledAt =
    parsed.data.scheduledAt != null ? new Date(parsed.data.scheduledAt) : null;

  const [row] = await db
    .insert(collaborationRequestsTable)
    .values({
      id: randomUUID(),
      fromUserId: userId,
      toUserId,
      type,
      message: message.trim(),
      ...(scheduledAt ? { scheduledAt } : {}),
    })
    .returning();

  const [sender] = await db
    .select({ displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  await db
    .insert(notificationsTable)
    .values({
      id: randomUUID(),
      userId: toUserId,
      type: "collaboration",
      title: "New collaboration request",
      message: `${sender?.displayName ?? "A creator"} wants to ${COLLAB_TYPE_LABELS[type] ?? "collaborate"} with you.`,
    })
    .catch((err) => req.log.error({ err, toUserId }, "collaboration notification failed"));

  const [hydrated] = await hydrateList([row!], userId);
  res.status(201).json(hydrated);
});

// GET /api/collaborations/incoming
router.get("/collaborations/incoming", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const rows = await db
    .select()
    .from(collaborationRequestsTable)
    .where(eq(collaborationRequestsTable.toUserId, userId))
    .orderBy(desc(collaborationRequestsTable.createdAt));
  res.json({ items: await hydrateList(rows, userId) });
});

// GET /api/collaborations/outgoing
router.get("/collaborations/outgoing", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const rows = await db
    .select()
    .from(collaborationRequestsTable)
    .where(eq(collaborationRequestsTable.fromUserId, userId))
    .orderBy(desc(collaborationRequestsTable.createdAt));
  res.json({ items: await hydrateList(rows, userId) });
});

// GET /api/collaborations/confirmed — accepted/scheduled, either direction
router.get("/collaborations/confirmed", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const rows = await db
    .select()
    .from(collaborationRequestsTable)
    .where(
      and(
        or(
          eq(collaborationRequestsTable.fromUserId, userId),
          eq(collaborationRequestsTable.toUserId, userId),
        ),
        inArray(collaborationRequestsTable.status, ["accepted", "scheduled"]),
      ),
    )
    .orderBy(desc(collaborationRequestsTable.updatedAt));
  res.json({ items: await hydrateList(rows, userId) });
});

// PATCH /api/collaborations/:collaborationId/status
router.patch("/collaborations/:collaborationId/status", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const collaborationId = String(req.params["collaborationId"]);

  const parsed = UpdateCollaborationStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid status update" });
    return;
  }
  const { action } = parsed.data;

  const [existing] = await db
    .select()
    .from(collaborationRequestsTable)
    .where(eq(collaborationRequestsTable.id, collaborationId));
  if (!existing) {
    res.status(404).json({ error: "Collaboration request not found" });
    return;
  }

  const isRecipient = existing.toUserId === userId;
  const isSender = existing.fromUserId === userId;

  const scheduledAtProvided = parsed.data.scheduledAt != null;
  const scheduledAtValid =
    scheduledAtProvided && !Number.isNaN(new Date(parsed.data.scheduledAt!).getTime());

  const outcome = resolveCollaborationTransition({
    status: existing.status,
    action,
    isSender,
    isRecipient,
    scheduledAtProvided,
    scheduledAtValid,
  });
  if (!outcome.ok) {
    res.status(outcome.status).json({ error: outcome.error });
    return;
  }

  const newStatus = outcome.newStatus;
  const scheduledAt: Date | null =
    newStatus === "scheduled" ? new Date(parsed.data.scheduledAt!) : existing.scheduledAt;

  const [updated] = await db
    .update(collaborationRequestsTable)
    .set({ status: newStatus, scheduledAt, updatedAt: new Date() })
    .where(eq(collaborationRequestsTable.id, collaborationId))
    .returning();

  // Notify the other party of the status change.
  const notifyUserId = isRecipient ? existing.fromUserId : existing.toUserId;
  const [actor] = await db
    .select({ displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  const actorName = actor?.displayName ?? "A creator";
  const statusVerb =
    newStatus === "accepted" ? "accepted"
    : newStatus === "declined" ? "declined"
    : newStatus === "scheduled" ? "scheduled"
    : "cancelled";

  await db
    .insert(notificationsTable)
    .values({
      id: randomUUID(),
      userId: notifyUserId,
      type: "collaboration",
      title: "Collaboration update",
      message: `${actorName} ${statusVerb} your collaboration request.`,
    })
    .catch((err) => req.log.error({ err, notifyUserId }, "collaboration update notification failed"));

  const [hydrated] = await hydrateList([updated!], userId);
  res.json(hydrated);
});

export default router;
