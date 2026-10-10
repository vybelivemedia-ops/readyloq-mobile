import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { db, leadsTable, type Lead } from "@workspace/db";
import { CreateLeadBody } from "@workspace/api-zod";

const router: IRouter = Router();

// Public, unauthenticated endpoint — tighten the per-IP limit well below the
// global /api limiter so the form can't be used to spam the leads table.
const leadsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many submissions, please try again later." },
});

function serialize(row: Lead) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

// POST /leads — capture a demo request or contact inquiry from the marketing site.
router.post("/", leadsLimiter, async (req, res) => {
  const parsed = CreateLeadBody.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: "Invalid request", issues: parsed.error.issues });
  }
  try {
    const [row] = await db.insert(leadsTable).values(parsed.data).returning();
    return res.status(201).json(serialize(row));
  } catch {
    return res.status(500).json({ error: "Failed to submit. Please try again." });
  }
});

export default router;
