/**
 * Portal Messages — provider (dispatcher / manager) side.
 *
 * Mounted at /api/portal-messages with requireAuth + requireCompany applied
 * at the router level in routes/index.ts.  All queries are scoped to
 * req.user.companyId so cross-company data leakage is impossible.
 *
 * Mirrors the client-facing routes in client-portal.ts:
 *   GET  /portal-messages/buildings/:address/messages        — fetch history
 *   POST /portal-messages/buildings/:address/messages        — send as provider
 *   GET  /portal-messages/buildings/:address/messages/stream — SSE stream
 */

import { Router } from "express";
import { db, portalMessagesTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import { messageBus } from "../lib/message-bus";

const router = Router();

// ─── GET /portal-messages/buildings/:address/messages ─────────────────────────

router.get("/buildings/:address/messages", async (req, res) => {
  const companyId: number | undefined = (req as any).user?.companyId;
  if (!companyId) return res.status(401).json({ error: "Unauthorized" });

  const address = decodeURIComponent(req.params.address);

  const rows = await db
    .select()
    .from(portalMessagesTable)
    .where(
      and(
        eq(portalMessagesTable.companyId, companyId),
        eq(portalMessagesTable.siteAddress, address),
      ),
    )
    .orderBy(asc(portalMessagesTable.createdAt))
    .limit(100);

  return res.json(rows.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })));
});

// ─── POST /portal-messages/buildings/:address/messages ────────────────────────

const providerMessageSchema = z.object({ message: z.string().min(1).max(2000) });

router.post("/buildings/:address/messages", async (req, res) => {
  const companyId: number | undefined = (req as any).user?.companyId;
  if (!companyId) return res.status(401).json({ error: "Unauthorized" });

  const address = decodeURIComponent(req.params.address);

  const body = providerMessageSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid message" });

  const { userId } = getAuth(req);
  const user = (req as any).user;
  const senderName: string | null =
    user?.name ?? user?.email ?? null;

  const [msg] = await db
    .insert(portalMessagesTable)
    .values({
      companyId,
      siteAddress: address,
      senderType: "provider",
      senderClerkId: userId!,
      senderName,
      message: body.data.message,
    })
    .returning();

  messageBus.publish(msg);

  return res.status(201).json({ ...msg, createdAt: msg.createdAt.toISOString() });
});

// ─── GET /portal-messages/buildings/:address/messages/stream (SSE) ────────────

router.get("/buildings/:address/messages/stream", async (req, res) => {
  const companyId: number | undefined = (req as any).user?.companyId;
  if (!companyId) { res.status(401).end(); return; }

  const address = decodeURIComponent(req.params.address);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);

  const unsubscribe = messageBus.subscribe(companyId, address, (msg) => {
    res.write(`data: ${JSON.stringify({ ...msg, createdAt: msg.createdAt.toISOString() })}\n\n`);
  });

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

export default router;
