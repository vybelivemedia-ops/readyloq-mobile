import { Router } from "express";
import { Readable } from "stream";
import { eq, and, desc, inArray, sql, not, gt } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  db,
  conversationsTable,
  conversationParticipantsTable,
  directMessagesTable,
  messageReactionsTable,
  objectUploadsTable,
  usersTable,
  clipsTable,
  streamsTable,
  type MessageAttachment,
  type DirectMessage,
} from "@workspace/db";
import { SendMessageAttachmentBody, AddMessageReactionBody, SetTypingSignalBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { setTyping, getTypingUserIds } from "../lib/typingSignals";

const router = Router();
const objectStorageService = new ObjectStorageService();

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function isParticipant(conversationId: string, userId: string): Promise<boolean> {
  const [participant] = await db
    .select({ id: conversationParticipantsTable.id })
    .from(conversationParticipantsTable)
    .where(
      and(
        eq(conversationParticipantsTable.conversationId, conversationId),
        eq(conversationParticipantsTable.userId, userId)
      )
    );
  return Boolean(participant);
}

type SenderInfo = { displayName: string; username: string; avatarUrl: string | null };

type HydratedReaction = { emoji: string; count: number; reactedByMe: boolean };

/**
 * Hydrate raw message rows into the rich API shape: resolve attachment previews
 * (image/video URL, clip/stream/profile metadata) and aggregate reactions.
 * All lookups are batched to avoid N+1 queries.
 */
async function hydrateMessages(
  rows: (DirectMessage & SenderInfo)[],
  viewerId: string
): Promise<Record<string, unknown>[]> {
  const clipIds = new Set<string>();
  const streamIds = new Set<string>();
  const profileIds = new Set<string>();

  for (const r of rows) {
    const a = r.attachment;
    if (!a) continue;
    if (a.kind === "clip") clipIds.add(a.clipId);
    else if (a.kind === "stream") streamIds.add(a.streamId);
    else if (a.kind === "profile") profileIds.add(a.userId);
  }

  const [clips, streams, profiles, reactionRows] = await Promise.all([
    clipIds.size
      ? db
          .select({
            id: clipsTable.id,
            title: clipsTable.title,
            thumbnailUrl: clipsTable.thumbnailUrl,
            videoUrl: clipsTable.videoUrl,
            durationSeconds: clipsTable.durationSeconds,
          })
          .from(clipsTable)
          .where(inArray(clipsTable.id, [...clipIds]))
      : Promise.resolve([] as { id: string; title: string; thumbnailUrl: string | null; videoUrl: string | null; durationSeconds: number }[]),
    streamIds.size
      ? db
          .select({
            id: streamsTable.id,
            title: streamsTable.title,
            thumbnailUrl: streamsTable.thumbnailUrl,
            status: streamsTable.status,
          })
          .from(streamsTable)
          .where(inArray(streamsTable.id, [...streamIds]))
      : Promise.resolve([] as { id: string; title: string; thumbnailUrl: string | null; status: string }[]),
    profileIds.size
      ? db
          .select({
            id: usersTable.id,
            displayName: usersTable.displayName,
            username: usersTable.username,
            avatarUrl: usersTable.avatarUrl,
          })
          .from(usersTable)
          .where(inArray(usersTable.id, [...profileIds]))
      : Promise.resolve([] as { id: string; displayName: string; username: string; avatarUrl: string | null }[]),
    rows.length
      ? db
          .select({
            messageId: messageReactionsTable.messageId,
            emoji: messageReactionsTable.emoji,
            userId: messageReactionsTable.userId,
          })
          .from(messageReactionsTable)
          .where(inArray(messageReactionsTable.messageId, rows.map((r) => r.id)))
      : Promise.resolve([] as { messageId: string; emoji: string; userId: string }[]),
  ]);

  const clipMap = new Map(clips.map((c) => [c.id, c]));
  const streamMap = new Map(streams.map((s) => [s.id, s]));
  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  // Aggregate reactions per message: emoji -> { count, reactedByMe }
  const reactionsByMessage = new Map<string, Map<string, { count: number; reactedByMe: boolean }>>();
  for (const r of reactionRows) {
    let perMsg = reactionsByMessage.get(r.messageId);
    if (!perMsg) {
      perMsg = new Map();
      reactionsByMessage.set(r.messageId, perMsg);
    }
    const agg = perMsg.get(r.emoji) ?? { count: 0, reactedByMe: false };
    agg.count += 1;
    if (r.userId === viewerId) agg.reactedByMe = true;
    perMsg.set(r.emoji, agg);
  }

  function buildReactions(messageId: string): HydratedReaction[] {
    const perMsg = reactionsByMessage.get(messageId);
    if (!perMsg) return [];
    return [...perMsg.entries()].map(([emoji, v]) => ({ emoji, count: v.count, reactedByMe: v.reactedByMe }));
  }

  function buildAttachment(msg: DirectMessage): Record<string, unknown> | null {
    const a = msg.attachment;
    if (!a) return null;
    if (a.kind === "image" || a.kind === "video") {
      return {
        kind: a.kind,
        url: `/api/conversations/${msg.conversationId}/messages/${msg.id}/attachment`,
        width: a.width ?? null,
        height: a.height ?? null,
        durationSeconds: a.durationSeconds ?? null,
      };
    }
    if (a.kind === "clip") {
      const c = clipMap.get(a.clipId);
      return {
        kind: "clip",
        clipId: a.clipId,
        title: c?.title ?? null,
        thumbnailUrl: c?.thumbnailUrl ?? null,
        videoUrl: c?.videoUrl ?? null,
        durationSeconds: c?.durationSeconds ?? null,
      };
    }
    if (a.kind === "stream") {
      const s = streamMap.get(a.streamId);
      return {
        kind: "stream",
        streamId: a.streamId,
        title: s?.title ?? null,
        thumbnailUrl: s?.thumbnailUrl ?? null,
        status: s?.status ?? null,
      };
    }
    if (a.kind === "profile") {
      const p = profileMap.get(a.userId);
      return {
        kind: "profile",
        profileUserId: a.userId,
        displayName: p?.displayName ?? null,
        username: p?.username ?? null,
        avatarUrl: p?.avatarUrl ?? null,
      };
    }
    return null;
  }

  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    senderId: r.senderId,
    type: r.type,
    content: r.content,
    attachment: buildAttachment(r),
    reactions: buildReactions(r.id),
    createdAt: r.createdAt,
    senderName: r.displayName,
    senderUsername: r.username,
    senderAvatarUrl: r.avatarUrl,
  }));
}

async function aggregatedReactions(messageId: string, viewerId: string): Promise<HydratedReaction[]> {
  const rows = await db
    .select({ emoji: messageReactionsTable.emoji, userId: messageReactionsTable.userId })
    .from(messageReactionsTable)
    .where(eq(messageReactionsTable.messageId, messageId));
  const map = new Map<string, { count: number; reactedByMe: boolean }>();
  for (const r of rows) {
    const agg = map.get(r.emoji) ?? { count: 0, reactedByMe: false };
    agg.count += 1;
    if (r.userId === viewerId) agg.reactedByMe = true;
    map.set(r.emoji, agg);
  }
  return [...map.entries()].map(([emoji, v]) => ({ emoji, count: v.count, reactedByMe: v.reactedByMe }));
}

// GET /api/conversations/unread-count — must be before /:id routes
router.get("/conversations/unread-count", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;

  const participantRows = await db
    .select({ conversationId: conversationParticipantsTable.conversationId, lastReadAt: conversationParticipantsTable.lastReadAt })
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.userId, userId));

  if (participantRows.length === 0) {
    res.json({ unread: 0 });
    return;
  }

  let totalUnread = 0;
  for (const p of participantRows) {
    const whereClause = p.lastReadAt
      ? and(
          eq(directMessagesTable.conversationId, p.conversationId),
          not(eq(directMessagesTable.senderId, userId)),
          gt(directMessagesTable.createdAt, p.lastReadAt)
        )
      : and(
          eq(directMessagesTable.conversationId, p.conversationId),
          not(eq(directMessagesTable.senderId, userId))
        );

    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(directMessagesTable)
      .where(whereClause);
    totalUnread += row?.count ?? 0;
  }

  res.json({ unread: totalUnread });
});

// GET /api/conversations
router.get("/conversations", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "30"), 10), 100);
  const offset = parseInt(String(req.query["offset"] ?? "0"), 10);

  const myParticipations = await db
    .select({ conversationId: conversationParticipantsTable.conversationId, lastReadAt: conversationParticipantsTable.lastReadAt })
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.userId, userId));

  if (myParticipations.length === 0) {
    res.json({ items: [], total: 0 });
    return;
  }

  const conversationIds = myParticipations.map((p) => p.conversationId);
  const lastReadMap = new Map(myParticipations.map((p) => [p.conversationId, p.lastReadAt]));

  const conversations = await db
    .select()
    .from(conversationsTable)
    .where(inArray(conversationsTable.id, conversationIds))
    .orderBy(desc(conversationsTable.updatedAt))
    .limit(limit)
    .offset(offset);

  const enriched = await Promise.all(
    conversations.map(async (conv) => {
      const otherParticipants = await db
        .select({ userId: conversationParticipantsTable.userId })
        .from(conversationParticipantsTable)
        .where(
          and(
            eq(conversationParticipantsTable.conversationId, conv.id),
            not(eq(conversationParticipantsTable.userId, userId))
          )
        );

      const otherUserIds = otherParticipants.map((p) => p.userId);
      const otherUsers = otherUserIds.length > 0
        ? await db
            .select({ id: usersTable.id, displayName: usersTable.displayName, username: usersTable.username, avatarUrl: usersTable.avatarUrl })
            .from(usersTable)
            .where(inArray(usersTable.id, otherUserIds))
        : [];

      const [lastMsg] = await db
        .select()
        .from(directMessagesTable)
        .where(eq(directMessagesTable.conversationId, conv.id))
        .orderBy(desc(directMessagesTable.createdAt))
        .limit(1);

      const lastReadAt = lastReadMap.get(conv.id);
      const unreadWhereClause = lastReadAt
        ? and(
            eq(directMessagesTable.conversationId, conv.id),
            not(eq(directMessagesTable.senderId, userId)),
            gt(directMessagesTable.createdAt, lastReadAt)
          )
        : and(
            eq(directMessagesTable.conversationId, conv.id),
            not(eq(directMessagesTable.senderId, userId))
          );

      const [unreadRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(directMessagesTable)
        .where(unreadWhereClause);

      return {
        id: conv.id,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        otherUsers,
        lastMessage: lastMsg
          ? { id: lastMsg.id, content: previewText(lastMsg), senderId: lastMsg.senderId, createdAt: lastMsg.createdAt }
          : null,
        unreadCount: unreadRow?.count ?? 0,
      };
    })
  );

  res.json({ items: enriched, total: conversationIds.length });
});

// Conversation-list preview text for non-text messages.
function previewText(msg: DirectMessage): string {
  if (msg.content && msg.content.trim()) return msg.content;
  switch (msg.type) {
    case "image":
      return "📷 Photo";
    case "video":
      return "🎬 Video";
    case "shared_clip":
      return "🎞️ Shared a clip";
    case "shared_stream":
      return "🔴 Shared a livestream";
    case "shared_profile":
      return "👤 Shared a profile";
    default:
      return "";
  }
}

// POST /api/conversations — start or find existing DM
router.post("/conversations", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const otherUserId = typeof req.body?.otherUserId === "string" ? req.body.otherUserId : null;

  if (!otherUserId) {
    res.status(400).json({ error: "otherUserId is required" });
    return;
  }

  if (userId === otherUserId) {
    res.status(400).json({ error: "Cannot start a conversation with yourself" });
    return;
  }

  const [otherUser] = await db
    .select({ id: usersTable.id, displayName: usersTable.displayName, username: usersTable.username, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.id, otherUserId));

  if (!otherUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const myConvIds = await db
    .select({ conversationId: conversationParticipantsTable.conversationId })
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.userId, userId));

  const myIds = myConvIds.map((r) => r.conversationId);

  if (myIds.length > 0) {
    const shared = await db
      .select({ conversationId: conversationParticipantsTable.conversationId })
      .from(conversationParticipantsTable)
      .where(
        and(
          eq(conversationParticipantsTable.userId, otherUserId),
          inArray(conversationParticipantsTable.conversationId, myIds)
        )
      )
      .limit(1);

    if (shared.length > 0) {
      const [existing] = await db
        .select()
        .from(conversationsTable)
        .where(eq(conversationsTable.id, shared[0]!.conversationId));
      res.json({ id: existing!.id, otherUser, isNew: false });
      return;
    }
  }

  const convId = randomUUID();
  const now = new Date();
  await db.insert(conversationsTable).values({ id: convId, createdAt: now, updatedAt: now });
  await db.insert(conversationParticipantsTable).values([
    { id: randomUUID(), conversationId: convId, userId, joinedAt: now },
    { id: randomUUID(), conversationId: convId, userId: otherUserId, joinedAt: now },
  ]);

  res.json({ id: convId, otherUser, isNew: true });
});

// GET /api/conversations/:conversationId/messages
router.get("/conversations/:conversationId/messages", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const conversationId = String(req.params["conversationId"]);

  if (!(await isParticipant(conversationId, userId))) {
    res.status(403).json({ error: "Not a participant in this conversation" });
    return;
  }

  const PAGE = 50;
  const rows = await db
    .select({
      id: directMessagesTable.id,
      conversationId: directMessagesTable.conversationId,
      senderId: directMessagesTable.senderId,
      type: directMessagesTable.type,
      content: directMessagesTable.content,
      attachment: directMessagesTable.attachment,
      createdAt: directMessagesTable.createdAt,
      displayName: usersTable.displayName,
      username: usersTable.username,
      avatarUrl: usersTable.avatarUrl,
    })
    .from(directMessagesTable)
    .innerJoin(usersTable, eq(directMessagesTable.senderId, usersTable.id))
    .where(eq(directMessagesTable.conversationId, conversationId))
    .orderBy(desc(directMessagesTable.createdAt))
    .limit(PAGE);

  const items = await hydrateMessages(rows, userId);
  res.json({ items, hasMore: rows.length === PAGE });
});

// POST /api/conversations/:conversationId/messages — plain text
router.post("/conversations/:conversationId/messages", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const conversationId = String(req.params["conversationId"]);
  const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";

  if (!content || content.length > 4000) {
    res.status(400).json({ error: "content is required (max 4000 chars)" });
    return;
  }

  if (!(await isParticipant(conversationId, userId))) {
    res.status(403).json({ error: "Not a participant in this conversation" });
    return;
  }

  const msg = await insertMessageAndTouch(conversationId, userId, { type: "text", content, attachment: null });
  const [hydrated] = await hydrateMessages([await withSender(msg, userId)], userId);
  res.status(201).json(hydrated);
});

// POST /api/conversations/:conversationId/messages/attachment — media or shared entity
router.post("/conversations/:conversationId/messages/attachment", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const conversationId = String(req.params["conversationId"]);

  const parsed = SendMessageAttachmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid attachment payload" });
    return;
  }
  const body = parsed.data;
  const caption = body.content?.trim() || null;

  if (!(await isParticipant(conversationId, userId))) {
    res.status(403).json({ error: "Not a participant in this conversation" });
    return;
  }

  let attachment: MessageAttachment;

  if (body.type === "image" || body.type === "video") {
    const objectPath = body.objectPath?.trim() ?? "";
    // Only accept server-issued private object paths bound at upload time.
    if (!objectPath.startsWith("/objects/")) {
      res.status(400).json({ error: "A valid uploaded objectPath is required" });
      return;
    }
    // Verify the object was uploaded by THIS user. The upload ledger records the
    // issuing user at presigned-URL time; without this check any participant could
    // rebind the ACL of an arbitrary/leaked objectPath (object takeover).
    const [upload] = await db
      .select({ userId: objectUploadsTable.userId })
      .from(objectUploadsTable)
      .where(eq(objectUploadsTable.objectPath, objectPath));
    if (!upload || upload.userId !== userId) {
      res.status(404).json({ error: "Uploaded object not found" });
      return;
    }
    // Bind the uploaded object to the sender (owner) so the generic object route
    // never serves it to non-owners; participants read it via the attachment route.
    try {
      await objectStorageService.trySetObjectEntityAclPolicy(objectPath, {
        owner: userId,
        visibility: "private",
      });
    } catch (err) {
      req.log.error({ err, objectPath }, "Failed to bind attachment object ACL");
      res.status(400).json({ error: "Uploaded object not found" });
      return;
    }
    attachment = {
      kind: body.type,
      objectPath,
      ...(body.width != null ? { width: body.width } : {}),
      ...(body.height != null ? { height: body.height } : {}),
      ...(body.durationSeconds != null ? { durationSeconds: body.durationSeconds } : {}),
    };
  } else if (body.type === "shared_clip") {
    const clipId = body.clipId?.trim() ?? "";
    const [clip] = await db
      .select({ id: clipsTable.id, userId: clipsTable.userId })
      .from(clipsTable)
      .where(eq(clipsTable.id, clipId));
    if (!clip || clip.userId !== userId) {
      res.status(404).json({ error: "Clip not found or not owned by you" });
      return;
    }
    attachment = { kind: "clip", clipId };
  } else if (body.type === "shared_stream") {
    const streamId = body.streamId?.trim() ?? "";
    const [stream] = await db
      .select({ id: streamsTable.id, userId: streamsTable.userId })
      .from(streamsTable)
      .where(eq(streamsTable.id, streamId));
    if (!stream || stream.userId !== userId) {
      res.status(404).json({ error: "Stream not found or not owned by you" });
      return;
    }
    attachment = { kind: "stream", streamId };
  } else {
    // shared_profile — any existing creator profile may be shared.
    const profileUserId = body.profileUserId?.trim() ?? "";
    const [profile] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, profileUserId));
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    attachment = { kind: "profile", userId: profileUserId };
  }

  const dbType =
    body.type === "image" ? "image"
    : body.type === "video" ? "video"
    : body.type === "shared_clip" ? "shared_clip"
    : body.type === "shared_stream" ? "shared_stream"
    : "shared_profile";

  const msg = await insertMessageAndTouch(conversationId, userId, { type: dbType, content: caption, attachment });
  const [hydrated] = await hydrateMessages([await withSender(msg, userId)], userId);
  res.status(201).json(hydrated);
});

// GET /api/conversations/:conversationId/messages/:messageId/attachment — stream media
router.get("/conversations/:conversationId/messages/:messageId/attachment", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const conversationId = String(req.params["conversationId"]);
  const messageId = String(req.params["messageId"]);

  if (!(await isParticipant(conversationId, userId))) {
    res.status(403).json({ error: "Not a participant in this conversation" });
    return;
  }

  const [msg] = await db
    .select({ attachment: directMessagesTable.attachment })
    .from(directMessagesTable)
    .where(
      and(eq(directMessagesTable.id, messageId), eq(directMessagesTable.conversationId, conversationId))
    );

  const a = msg?.attachment;
  if (!a || (a.kind !== "image" && a.kind !== "video")) {
    res.status(404).json({ error: "No media attachment" });
    return;
  }

  try {
    // Authorization is the conversation-participant check above: the message
    // binds this object to the conversation, so any participant may read it
    // regardless of the object's owner-scoped ACL.
    const objectFile = await objectStorageService.getObjectEntityFile(a.objectPath);
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);

    // Do NOT blindly forward storage response headers. A shared object could
    // carry an attacker-influenced Content-Type (e.g. text/html) which, when
    // rendered in a webview/browser, becomes a stored-XSS vector. Force a safe
    // Content-Type derived from the declared attachment kind, forbid MIME
    // sniffing, and serve inline as a private resource.
    const storageContentType = response.headers.get("content-type") ?? "";
    const expectedPrefix = a.kind === "image" ? "image/" : "video/";
    const safeContentType = storageContentType
      .toLowerCase()
      .startsWith(expectedPrefix)
      ? storageContentType
      : "application/octet-stream";
    res.setHeader("Content-Type", safeContentType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "private, max-age=0, no-store");
    const contentLength = response.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving message attachment");
    res.status(500).json({ error: "Failed to serve attachment" });
  }
});

// POST /api/conversations/:conversationId/messages/:messageId/reactions
router.post("/conversations/:conversationId/messages/:messageId/reactions", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const conversationId = String(req.params["conversationId"]);
  const messageId = String(req.params["messageId"]);

  const parsed = AddMessageReactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "emoji is required" });
    return;
  }
  const emoji = parsed.data.emoji;

  if (!(await isParticipant(conversationId, userId))) {
    res.status(403).json({ error: "Not a participant in this conversation" });
    return;
  }

  const [msg] = await db
    .select({ id: directMessagesTable.id })
    .from(directMessagesTable)
    .where(
      and(eq(directMessagesTable.id, messageId), eq(directMessagesTable.conversationId, conversationId))
    );
  if (!msg) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  await db
    .insert(messageReactionsTable)
    .values({ id: randomUUID(), messageId, userId, emoji, createdAt: new Date() })
    .onConflictDoNothing();

  res.json({ reactions: await aggregatedReactions(messageId, userId) });
});

// DELETE /api/conversations/:conversationId/messages/:messageId/reactions/:emoji
router.delete("/conversations/:conversationId/messages/:messageId/reactions/:emoji", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const conversationId = String(req.params["conversationId"]);
  const messageId = String(req.params["messageId"]);
  const emoji = decodeURIComponent(String(req.params["emoji"]));

  if (!(await isParticipant(conversationId, userId))) {
    res.status(403).json({ error: "Not a participant in this conversation" });
    return;
  }

  const [msg] = await db
    .select({ id: directMessagesTable.id })
    .from(directMessagesTable)
    .where(
      and(eq(directMessagesTable.id, messageId), eq(directMessagesTable.conversationId, conversationId))
    );
  if (!msg) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  await db
    .delete(messageReactionsTable)
    .where(
      and(
        eq(messageReactionsTable.messageId, messageId),
        eq(messageReactionsTable.userId, userId),
        eq(messageReactionsTable.emoji, emoji)
      )
    );

  res.json({ reactions: await aggregatedReactions(messageId, userId) });
});

// GET /api/conversations/:conversationId/read-state
router.get("/conversations/:conversationId/read-state", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const conversationId = String(req.params["conversationId"]);

  if (!(await isParticipant(conversationId, userId))) {
    res.status(403).json({ error: "Not a participant in this conversation" });
    return;
  }

  const participants = await db
    .select({
      userId: conversationParticipantsTable.userId,
      lastReadAt: conversationParticipantsTable.lastReadAt,
    })
    .from(conversationParticipantsTable)
    .where(eq(conversationParticipantsTable.conversationId, conversationId));

  res.json({ participants });
});

// GET /api/conversations/:conversationId/typing
router.get("/conversations/:conversationId/typing", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const conversationId = String(req.params["conversationId"]);

  if (!(await isParticipant(conversationId, userId))) {
    res.status(403).json({ error: "Not a participant in this conversation" });
    return;
  }

  res.json({ typingUserIds: getTypingUserIds(conversationId, userId) });
});

// POST /api/conversations/:conversationId/typing
router.post("/conversations/:conversationId/typing", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const conversationId = String(req.params["conversationId"]);

  const parsed = SetTypingSignalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "isTyping is required" });
    return;
  }

  if (!(await isParticipant(conversationId, userId))) {
    res.status(403).json({ error: "Not a participant in this conversation" });
    return;
  }

  setTyping(conversationId, userId, parsed.data.isTyping);
  res.status(204).send();
});

// PUT /api/conversations/:conversationId/read
router.put("/conversations/:conversationId/read", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const conversationId = String(req.params["conversationId"]);

  if (!(await isParticipant(conversationId, userId))) {
    res.status(403).json({ error: "Not a participant in this conversation" });
    return;
  }

  await db
    .update(conversationParticipantsTable)
    .set({ lastReadAt: new Date() })
    .where(
      and(
        eq(conversationParticipantsTable.conversationId, conversationId),
        eq(conversationParticipantsTable.userId, userId)
      )
    );

  res.status(204).send();
});

// ─── Shared write helpers ─────────────────────────────────────────────────────

async function insertMessageAndTouch(
  conversationId: string,
  senderId: string,
  data: { type: DirectMessage["type"]; content: string | null; attachment: MessageAttachment | null }
): Promise<DirectMessage> {
  const now = new Date();
  const [newMsg] = await db
    .insert(directMessagesTable)
    .values({ id: randomUUID(), conversationId, senderId, type: data.type, content: data.content, attachment: data.attachment, createdAt: now })
    .returning();

  await db.update(conversationsTable).set({ updatedAt: now }).where(eq(conversationsTable.id, conversationId));
  await db
    .update(conversationParticipantsTable)
    .set({ lastReadAt: now })
    .where(
      and(
        eq(conversationParticipantsTable.conversationId, conversationId),
        eq(conversationParticipantsTable.userId, senderId)
      )
    );

  return newMsg!;
}

async function withSender(msg: DirectMessage, _viewerId: string): Promise<DirectMessage & SenderInfo> {
  const [sender] = await db
    .select({ displayName: usersTable.displayName, username: usersTable.username, avatarUrl: usersTable.avatarUrl })
    .from(usersTable)
    .where(eq(usersTable.id, msg.senderId));
  return { ...msg, displayName: sender!.displayName, username: sender!.username, avatarUrl: sender!.avatarUrl };
}

export default router;
