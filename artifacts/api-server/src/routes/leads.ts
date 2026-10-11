import { Router, type IRouter } from "express";
import rateLimit from "express-rate-limit";
import { db, leadsTable, type Lead } from "@workspace/db";
import { CreateLeadBody } from "@workspace/api-zod";
import { sendPilotDetails } from "../lib/pilot-details-mailer";

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
    // Persist first. Never display the inbox confirmation for an unsent email.
    // Other marketing contact/demo workflows retain their existing behavior.
    if (row.source === "readyloq-pilot") {
      const delivery = await sendPilotDetails(row.email, row.id);
      if (delivery !== "accepted") {
        return res.status(delivery === "unconfigured" ? 503 : 502).json({
          error: delivery === "unconfigured"
            ? "Your signup was saved, but pilot email delivery is not configured yet. Please try again later."
            : "Your signup was saved, but we couldn't send the pilot email. Please try again later.",
        });
      }
    }
    return res.status(201).json(serialize(row));
  } catch {
    return res.status(500).json({ error: "Failed to submit. Please try again." });
  }
});

export default router;
