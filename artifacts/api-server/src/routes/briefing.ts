import { Router, type IRouter } from "express";
import { buildBriefing } from "../lib/briefing";
import { getCompanyId } from "../lib/tenant";

/**
 * Role Briefing — the single role-adaptive dashboard endpoint.
 *
 * SECURITY: mounted behind `requireAuth + requireCompany + requireBetaAccess`
 * (see routes/index.ts) with NO requireRole — every role is allowed in, and
 * the response shape is decided server-side from the DB-sourced req.user.role.
 * A technician's response physically contains no sales/manager/owner keys.
 * Detail routes (/opportunities, /scorecards, /customer-summaries, /proposals)
 * keep their own stricter role gates.
 */

const router: IRouter = Router();

// GET /briefing — the caller's role-shaped view of the Inspection
// Intelligence Record (top-N slices + counts only).
router.get("/", async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    const companyId = getCompanyId(req);
    const briefing = await buildBriefing(user.role, companyId);
    return res.json(briefing);
  } catch {
    return res.status(500).json({ error: "Failed to build briefing" });
  }
});

export default router;
