import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { conversations, messages } from "@workspace/db";
import { eq, asc, and } from "drizzle-orm";
import { ai } from "@workspace/integrations-gemini-ai";
import { generateImage } from "@workspace/integrations-gemini-ai/image";
import { getCompanyId } from "../lib/tenant";

const router: IRouter = Router();

// GET /gemini/conversations
router.get("/conversations", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const rows = await db
      .select()
      .from(conversations)
      .where(eq(conversations.companyId, companyId))
      .orderBy(asc(conversations.createdAt));
    return res.json(
      rows.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt.toISOString(),
      })),
    );
  } catch {
    return res.status(500).json({ error: "Failed to list conversations" });
  }
});

// POST /gemini/conversations
router.post("/conversations", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const { title } = req.body as { title?: string };
    if (!title || typeof title !== "string") {
      return res.status(400).json({ error: "title is required" });
    }
    const [row] = await db.insert(conversations).values({ companyId, title }).returning();
    return res.status(201).json({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt.toISOString(),
    });
  } catch {
    return res.status(500).json({ error: "Failed to create conversation" });
  }
});

// GET /gemini/conversations/:id
router.get("/conversations/:id", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(404).json({ error: "Not found" });

    const [conv] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.companyId, companyId)));
    if (!conv) return res.status(404).json({ error: "Not found" });

    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));

    return res.json({
      id: conv.id,
      title: conv.title,
      createdAt: conv.createdAt.toISOString(),
      messages: msgs.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch {
    return res.status(500).json({ error: "Failed to get conversation" });
  }
});

// DELETE /gemini/conversations/:id
router.delete("/conversations/:id", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(404).json({ error: "Not found" });

    const deleted = await db
      .delete(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.companyId, companyId)))
      .returning();
    if (!deleted.length) return res.status(404).json({ error: "Not found" });

    return res.status(204).send();
  } catch {
    return res.status(500).json({ error: "Failed to delete conversation" });
  }
});

// GET /gemini/conversations/:id/messages
router.get("/conversations/:id/messages", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const id = Number(req.params.id);
    if (isNaN(id)) return res.status(404).json({ error: "Not found" });

    // Verify conversation belongs to caller's company before returning messages.
    const [conv] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.companyId, companyId)));
    if (!conv) return res.status(404).json({ error: "Not found" });

    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));

    return res.json(
      msgs.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    );
  } catch {
    return res.status(500).json({ error: "Failed to list messages" });
  }
});

// POST /gemini/conversations/:id/messages  (SSE stream)
router.post("/conversations/:id/messages", async (req: Request, res: Response) => {
  const companyId = getCompanyId(req);
  const id = Number(req.params.id);
  if (isNaN(id)) return res.status(404).json({ error: "Not found" });

  const { content } = req.body as { content?: string };
  if (!content || typeof content !== "string") {
    return res.status(400).json({ error: "content is required" });
  }

  try {
    const [conv] = await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.companyId, companyId)));
    if (!conv) return res.status(404).json({ error: "Not found" });

    // Save the user message
    await db.insert(messages).values({ conversationId: id, role: "user", content });

    // Load full history for context
    const history = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, id))
      .orderBy(asc(messages.createdAt));

    // Set up SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let fullResponse = "";

    const stream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents: history.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      config: { maxOutputTokens: 8192 },
    });

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
      }
    }

    // Persist the assistant response
    await db.insert(messages).values({
      conversationId: id,
      role: "assistant",
      content: fullResponse,
    });

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    return res.end();
  } catch {
    if (!res.headersSent) {
      return res.status(500).json({ error: "Failed to send message" });
    }
    res.write(`data: ${JSON.stringify({ error: "Stream failed" })}\n\n`);
    return res.end();
  }
});

// POST /gemini/generate-image
router.post("/generate-image", async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body as { prompt?: string };
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt is required" });
    }
    const result = await generateImage(prompt);
    return res.json(result);
  } catch {
    return res.status(500).json({ error: "Failed to generate image" });
  }
});

export default router;
