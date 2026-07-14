import { Router } from "express";
import { randomUUID } from "crypto";
import { db, reportsTable } from "@workspace/db";
import { CreateReportBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";

const router = Router();

// POST /api/reports
router.post("/reports", requireAuth, async (req, res) => {
  const parsed = CreateReportBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [report] = await db
    .insert(reportsTable)
    .values({
      id: randomUUID(),
      reporterId: req.auth!.userId,
      targetType: parsed.data.targetType as "stream" | "clip" | "user",
      targetId: parsed.data.targetId,
      reason: parsed.data.reason as "spam" | "harassment" | "copyright" | "inappropriate" | "other",
      details: parsed.data.details ?? null,
    })
    .returning();

  res.status(201).json(report);
});

export default router;
