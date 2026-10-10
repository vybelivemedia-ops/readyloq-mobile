import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db, companiesTable, clientPortalAccessTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  requireAuth,
  requireClerkAuth,
  requireCompany,
  requireRole,
  requireBetaAccess,
  requireSuperAdmin,
} from "../middleware/require-auth";
import healthRouter from "./health";
import authRouter from "./auth";
import inspectionsRouter from "./inspections";
import analysisRouter from "./analysis";
import datasetRouter from "./dataset";
import reportsRouter from "./reports";
import analyticsRouter from "./analytics";
import intelligenceRouter from "./intelligence";
import intelligenceDatasetRouter from "./intelligence-dataset";
import brandingRouter from "./branding";
import propertiesRouter from "./properties";
import storageRouter from "./storage";
import leadsRouter from "./leads";
import betaRouter from "./beta";
import opportunitiesRouter from "./opportunities";
import scorecardsRouter from "./scorecards";
import customerSummariesRouter from "./customer-summaries";
import proposalsRouter from "./proposals";
import briefingRouter from "./briefing";
import shareRouter from "./share";
import geminiRouter from "./gemini";
import baitStationsRouter from "./bait-stations";
import productsRouter from "./products";
import treatmentLogsRouter from "./treatment-logs";
import crmRouter from "./crm";
import dailyRigRouter from "./daily-rig";
import reviewQueueRouter from "./review-queue";
import metaGlassesRouter from "./meta-glasses";
import billingRouter from "./billing";
import adminRouter from "./admin";
import transcribeRouter from "./transcribe";
import integrationsRouter from "./integrations";
import playbooksRouter from "./playbooks";
import executiveRouter from "./executive";
import scheduleRouter from "./schedule";
import clientPortalRouter from "./client-portal";
import portalMessagesRouter from "./portal-messages";
import inventoryRouter from "./inventory";
import faieAssistantRouter from "./faie-assistant";
import missionControlRouter, { missionControlMeHandler } from "./mission-control";

const router: IRouter = Router();

// Suspension is enforced at the server boundary for every normal company-scoped
// route. A suspended status is not merely a Mission Control display setting.
const requireActiveCompany = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (!req.user?.companyId) {
    res.status(403).json({ error: "No company", code: "no_company" });
    return;
  }
  const [company] = await db.select({ accessSuspended: companiesTable.accessSuspended })
    .from(companiesTable).where(eq(companiesTable.id, req.user.companyId));
  if (!company) {
    res.status(403).json({ error: "Company unavailable", code: "company_unavailable" });
    return;
  }
  if (company.accessSuspended) {
    res.status(403).json({ error: "Company access suspended", code: "company_access_suspended" });
    return;
  }
  next();
};

// Cross-company platform diagnostics and reversible admin actions. This route
// intentionally has no tenant or beta-access middleware.
router.get("/mission-control/me", requireAuth, missionControlMeHandler);
router.use("/mission-control", requireAuth, requireSuperAdmin, missionControlRouter);

router.use(healthRouter);
// Company-management paths require an already-active tenant. Account profile,
// company creation, and invite acceptance remain available for onboarding.
router.use("/auth/company/members", requireAuth, requireCompany, requireActiveCompany);
router.use("/auth/invites", requireAuth, requireCompany, requireActiveCompany);
router.use("/auth", authRouter);
// PUBLIC: marketing-site lead capture (no auth — prospects aren't users yet).
router.use("/leads", leadsRouter);
// PUBLIC: customer-summary share links (no auth — the unguessable expiring
// token IS the credential; uniform 404 for anything invalid; never photos).
router.use("/share", shareRouter);
// PUBLIC: FAIE marketing-site assistant (no auth — anonymous prospects chat
// before signing up). Stateless: no conversation persistence, tight per-IP
// rate limit enforced inside the router.
router.use("/faie-assistant", faieAssistantRouter);

// These routers contain both public and tenant-authenticated resources. Guard
// only the tenant paths here so public platform assets remain public.
router.use("/branding/company", requireAuth, requireCompany, requireActiveCompany);
router.use("/branding/profiles", requireAuth, requireCompany, requireActiveCompany);
router.use("/branding/restore-defaults", requireAuth, requireCompany, requireActiveCompany);
router.use("/storage/uploads", requireAuth, requireCompany, requireActiveCompany);
router.use("/storage/objects", requireAuth, requireCompany, requireActiveCompany);
// Must follow the storage path guards: the same router also serves public
// objects, which deliberately bypass tenant authentication.
router.use(storageRouter);

// Tenant data routes are additionally gated by requireBetaAccess: a technician
// whose beta access was paused is blocked here (owners/managers always pass).
router.use("/inspections", requireAuth, requireCompany, requireActiveCompany, requireBetaAccess, inspectionsRouter);
router.use("/analysis", requireAuth, requireCompany, requireActiveCompany, requireBetaAccess, analysisRouter);
router.use("/dataset", requireAuth, requireCompany, requireActiveCompany, requireBetaAccess, datasetRouter);
router.use("/reports", requireAuth, requireCompany, requireActiveCompany, requireBetaAccess, reportsRouter);
router.use("/analytics", requireAuth, requireCompany, requireActiveCompany, requireBetaAccess, analyticsRouter);
router.use(
  "/intelligence",
  requireAuth,
  requireCompany,
  requireActiveCompany,
  requireBetaAccess,
  requireRole("manager"),
  intelligenceRouter,
);
// Intelligence Dataset & AI Learning Center: company-private contribution →
// technician review → manager verification. Manager-only actions are guarded
// per-route inside the router (requireRole("manager")).
router.use(
  "/intelligence-dataset",
  requireAuth,
  requireCompany,
  requireActiveCompany,
  requireBetaAccess,
  intelligenceDatasetRouter,
);
router.use("/branding", brandingRouter);
router.use("/properties", requireAuth, requireCompany, requireActiveCompany, requireBetaAccess, propertiesRouter);
// Beta Center + all-user feedback. NOT behind requireBetaAccess so a paused
// technician can still submit feedback and report client-side errors.
router.use("/beta", requireAuth, requireCompany, requireActiveCompany, betaRouter);
// Opportunity Intelligence — the hidden Opportunity Log. Technicians are
// excluded at the API layer: requireRole("sales") means sales, manager, and
// owner only. Dismiss/settings are gated higher inside the router.
router.use(
  "/opportunities",
  requireAuth,
  requireCompany,
  requireActiveCompany,
  requireBetaAccess,
  requireRole("sales"),
  opportunitiesRouter,
);
// Inspection Scorecards — management coaching data. Manager+ ONLY: quality
// scoring never reaches technicians (or sales).
router.use(
  "/scorecards",
  requireAuth,
  requireCompany,
  requireActiveCompany,
  requireBetaAccess,
  requireRole("manager"),
  scorecardsRouter,
);
// Customer Summaries — manager+ ONLY: generating, editing, and (critically)
// approving what a customer may see is a management decision.
router.use(
  "/customer-summaries",
  requireAuth,
  requireCompany,
  requireActiveCompany,
  requireBetaAccess,
  requireRole("manager"),
  customerSummariesRouter,
);
// Role Briefing — the role-adaptive dashboard read model. Deliberately NO
// requireRole: every role is served, and the payload shape is decided
// server-side from the DB-sourced user role (strict per-role sections).
router.use("/briefing", requireAuth, requireCompany, requireActiveCompany, requireBetaAccess, briefingRouter);
// Sales Proposals — same sales+ audience as the Opportunity Log they bundle.
router.use(
  "/proposals",
  requireAuth,
  requireCompany,
  requireActiveCompany,
  requireBetaAccess,
  requireRole("sales"),
  proposalsRouter,
);
// Gemini AI — chat conversations and image generation. Available to all
// authenticated beta users (no role restriction — used by Phase Next AI engines).
router.use("/gemini", requireAuth, requireCompany, requireActiveCompany, requireBetaAccess, geminiRouter);
router.use(
  "/inspections/:inspectionId/bait-stations",
  requireAuth,
  requireCompany,
  requireActiveCompany,
  requireBetaAccess,
  baitStationsRouter,
);
// Chemical product catalogue — available to all authenticated beta users.
// Products are platform-wide (no company scope); treatment logs are scoped.
router.use("/products", requireAuth, requireActiveCompanyIfAssigned, requireBetaAccess, productsRouter);
router.use(
  "/inspections/:inspectionId/treatment-logs",
  requireAuth,
  requireCompany,
  requireActiveCompany,
  requireBetaAccess,
  treatmentLogsRouter,
);
// CRM Integration — manager+ only: fetching client lists and pushing
// completed inspections to FieldRoutes or PestPac.
router.use(
  "/crm",
  requireAuth,
  requireCompany,
  requireActiveCompany,
  requireBetaAccess,
  requireRole("manager"),
  crmRouter,
);
// Field-service platform integrations (PestPac / FieldRoutes).
// Config (PUT/DELETE) is owner-only; GET config and POST sync are manager+.
router.use(
  "/integrations",
  requireAuth,
  requireCompany,
  requireActiveCompany,
  requireBetaAccess,
  requireRole("manager"),
  integrationsRouter,
);
// Company Playbooks + Learning Engine.
// GET /active and GET /compliance are open to all authenticated beta users.
// GET / (full list) is manager+; POST/PUT/DELETE are owner-only (enforced inside router).
router.use(
  "/playbooks",
  requireAuth,
  requireCompany,
  requireActiveCompany,
  requireBetaAccess,
  playbooksRouter,
);
// Daily rig + recent mixes — all authenticated beta users (technicians included).
// Sub-routes:  POST/GET /technician/daily-rig
//              GET      /technician/daily-rig/recent-mixes
router.use("/technician/daily-rig", requireAuth, requireCompany, requireActiveCompany, requireBetaAccess, dailyRigRouter);
router.use("/executive", requireAuth, requireCompany, requireActiveCompany, requireBetaAccess);
router.use(executiveRouter);

// Client portal — read-only access for external property managers.
// Uses requireClerkAuth (not requireAuth) so external PM logins never
// auto-create a usersTable row. Internal managers who also use the invite
// endpoints still get req.user attached (read-only lookup) so the inline
// requireCompany + requireRole("manager") guards inside the router work.
router.use("/client", requireClerkAuth, requireActiveClientCompany, clientPortalRouter);

// In-portal messaging — provider/dispatcher side.
// requireAuth + requireCompany enforce company scoping.
router.use("/portal-messages", requireAuth, requireCompany, requireActiveCompany, requireBetaAccess, portalMessagesRouter);

// Chemical inventory — per-tech on-hand quantities, restock events, supplier
// connections, and manager activity timeline. Auth levels are enforced inside
// the router (technician / manager / owner as appropriate).
router.use("/technician/inventory", requireAuth, requireCompany, requireActiveCompany, requireBetaAccess);
router.use("/manager", requireAuth, requireCompany, requireActiveCompany, requireBetaAccess);
router.use("/company", requireAuth, requireCompany, requireActiveCompany, requireBetaAccess);
router.use(inventoryRouter);

// Scheduling calendar — read and mutate scheduled dates / technician assignments.
// Technicians may read (scoped to their own stops server-side); managers, owners,
// and sales reps see the full team's schedule. Only managers/owners may mutate.
// Per-route enforcement is inside scheduleRouter.
router.use(
  "/schedule",
  requireAuth,
  requireCompany,
  requireActiveCompany,
  requireBetaAccess,
  scheduleRouter,
);

// Manager rapid-review queue — yesterday's completed inspections for 20-min callback validation.
router.use(
  "/review-queue",
  requireAuth,
  requireCompany,
  requireActiveCompany,
  requireActiveCompany,
  requireBetaAccess,
  requireRole("manager"),
  reviewQueueRouter,
);

// Meta Live AI glasses — mixed auth: session + events are auth-gated internally;
// webhook endpoints are public but HMAC-verified with META_APP_SECRET.
router.use("/meta-glasses/session", requireAuth, requireCompany, requireActiveCompany, requireBetaAccess);
router.use("/meta-glasses/events", requireAuth, requireCompany, requireActiveCompany, requireBetaAccess);
router.use("/meta-glasses/frame-drop-stats", requireAuth, requireCompany, requireActiveCompany, requireBetaAccess);
router.use("/meta-glasses", metaGlassesRouter);

// Billing — Stripe subscription management.
// /plans is public; subscription/checkout/portal are Owner-only (enforced inside billingRouter).
for (const path of [
  "/billing/license",
  "/billing/subscription",
  "/billing/checkout",
  "/billing/seats",
  "/billing/portal",
]) {
  router.use(path, requireAuth, requireCompany, requireActiveCompany);
}
router.use("/billing", billingRouter);

// Platform super-admin account tools require Clerk authentication and a current
// server-verified Super Admin role inside adminRouter. Elevation uses only the
// separate governed Mission Control approval/bootstrap routes.
router.use("/admin", adminRouter);

// Cloud voice transcription — auth-gated; used by mobile as Whisper fallback.
router.use("/transcribe", requireAuth, requireCompany, requireActiveCompany);
router.use(transcribeRouter);

export default router;

async function requireActiveCompanyIfAssigned(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user?.companyId) {
    next();
    return;
  }
  await requireActiveCompany(req, res, next);
}

async function requireActiveClientCompany(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.user?.companyId) {
    await requireActiveCompany(req, res, next);
    return;
  }

  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
    return;
  }
  const [access] = await db
    .select({ companyId: clientPortalAccessTable.companyId })
    .from(clientPortalAccessTable)
    .where(eq(clientPortalAccessTable.clerkUserId, userId))
    .limit(1);
  if (!access) {
    next();
    return;
  }
  const [company] = await db.select({ accessSuspended: companiesTable.accessSuspended })
    .from(companiesTable).where(eq(companiesTable.id, access.companyId));
  if (!company || company.accessSuspended) {
    if (!company) {
      res.status(403).json({ error: "Company unavailable", code: "company_unavailable" });
      return;
    }
    res.status(403).json({ error: "Company access suspended", code: "company_access_suspended" });
    return;
  }
  next();
}
