import { Router } from "express";
import { z } from "zod";
import { requireAdmin } from "../middlewares/auth.js";
import {
  isEmailConfigured,
  sendBetaInvitation,
  sendWaitlistConfirmation,
} from "../services/email.js";

const router = Router();

const sendTestEmailSchema = z.object({
  to: z.string().email(),
  template: z.enum(["welcome", "invitation"]).default("invitation"),
  firstName: z.string().min(1).optional(),
});

// POST /admin/email/test — admin-only. Sends a real beta email (welcome or
// invitation) to a specified address so delivery can be verified end-to-end.
router.post("/admin/email/test", requireAdmin, async (req, res) => {
  const parsed = sendTestEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    return;
  }

  // Never fake success — if SMTP isn't configured, say so explicitly.
  if (!isEmailConfigured()) {
    res.status(503).json({
      error:
        "Email is not configured. Set SMTP_USER and SMTP_PASS (Gmail address + App Password) in Replit Secrets.",
    });
    return;
  }

  const { to, template, firstName } = parsed.data;

  try {
    const result =
      template === "welcome"
        ? await sendWaitlistConfirmation({ to, firstName: firstName ?? "there" })
        : await sendBetaInvitation({ to, firstName });

    req.log.info({ to, template, messageId: result.messageId }, "Test beta email sent");
    res.status(200).json({ sent: true, to, template, messageId: result.messageId });
  } catch (err) {
    req.log.error({ err, to, template }, "Test beta email failed to send");
    res.status(502).json({ sent: false, to, template, error: "Failed to send test email" });
  }
});

export default router;
