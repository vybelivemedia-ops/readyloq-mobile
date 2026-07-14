import { Router } from "express";
import { eq, desc, count } from "drizzle-orm";
import { randomUUID } from "crypto";
import { z } from "zod";
import { db, betaWaitlistTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/auth.js";
import { sendWaitlistConfirmation } from "../services/email.js";

const router = Router();

const waitlistInputSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  creatorType: z.enum([
    "content_creator",
    "car_enthusiast",
    "fitness_trainer",
    "performer",
    "business",
    "event_organizer",
    "other",
  ]),
});

// POST /waitlist — public signup
router.post("/waitlist", async (req, res) => {
  const parsed = waitlistInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  const { firstName, lastName, email, creatorType } = parsed.data;

  const id = randomUUID();

  req.log.info({ email, creatorType }, "Waitlist signup received");

  try {
    const [entry] = await db
      .insert(betaWaitlistTable)
      .values({ id, firstName, lastName, email, creatorType })
      .returning();

    // Email is fire-and-forget: the signup is already persisted above, so a
    // delivery failure can NEVER lose the signup. Both outcomes are logged.
    sendWaitlistConfirmation({ to: email, firstName })
      .then(() => {
        req.log.info({ email }, "Waitlist welcome email sent");
      })
      .catch((err) => {
        req.log.error({ err, email }, "Waitlist welcome email failed");
      });

    res.status(201).json(entry);
  } catch (err: unknown) {
    const isUniqueViolation = (e: unknown): boolean => {
      if (!e || typeof e !== "object") return false;
      const obj = e as Record<string, unknown>;
      if (obj["code"] === "23505") return true;
      if (obj["cause"] && isUniqueViolation(obj["cause"])) return true;
      const msg = String(obj["message"] ?? "");
      return msg.includes("unique") || msg.includes("duplicate");
    };
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "This email is already on the waitlist." });
      return;
    }
    req.log.error({ err }, "Failed to insert waitlist entry");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/waitlist — admin only
router.get("/admin/waitlist", requireAdmin, async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10)));
  const offset = (page - 1) * limit;

  const [entries, [{ total }]] = await Promise.all([
    db
      .select()
      .from(betaWaitlistTable)
      .orderBy(desc(betaWaitlistTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(betaWaitlistTable),
  ]);

  res.json({ entries, total: Number(total) });
});

export default router;
