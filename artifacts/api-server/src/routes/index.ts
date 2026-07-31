import { Router, type IRouter } from "express";
import {
  requireAuth,
  requireCompany,
  requireRole,
  requireBetaAccess,
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

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use(storageRouter);
// PUBLIC: marketing-site lead capture (no auth — prospects aren't users yet).
router.use("/leads", leadsRouter);
// PUBLIC: customer-summary share links (no auth — the unguessable expiring
// token IS the credential; uniform 404 for anything invalid; never photos).
router.use("/share", shareRouter);

// Tenant data routes are additionally gated by requireBetaAccess: a technician
// whose beta access was paused is blocked here (owners/managers always pass).
router.use("/inspections", requireAuth, requireCompany, requireBetaAccess, inspectionsRouter);
router.use("/analysis", requireAuth, requireCompany, requireBetaAccess, analysisRouter);
router.use("/dataset", requireAuth, requireCompany, requireBetaAccess, datasetRouter);
router.use("/reports", requireAuth, requireCompany, requireBetaAccess, reportsRouter);
router.use("/analytics", requireAuth, requireCompany, requireBetaAccess, analyticsRouter);
router.use(
  "/intelligence",
  requireAuth,
  requireCompany,
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
  requireBetaAccess,
  intelligenceDatasetRouter,
);
router.use("/branding", brandingRouter);
router.use("/properties", requireAuth, requireCompany, requireBetaAccess, propertiesRouter);
// Beta Center + all-user feedback. NOT behind requireBetaAccess so a paused
// technician can still submit feedback and report client-side errors.
router.use("/beta", requireAuth, requireCompany, betaRouter);
// Opportunity Intelligence — the hidden Opportunity Log. Technicians are
// excluded at the API layer: requireRole("sales") means sales, manager, and
// owner only. Dismiss/settings are gated higher inside the router.
router.use(
  "/opportunities",
  requireAuth,
  requireCompany,
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
  requireBetaAccess,
  requireRole("manager"),
  customerSummariesRouter,
);
// Role Briefing — the role-adaptive dashboard read model. Deliberately NO
// requireRole: every role is served, and the payload shape is decided
// server-side from the DB-sourced user role (strict per-role sections).
router.use("/briefing", requireAuth, requireCompany, requireBetaAccess, briefingRouter);
// Sales Proposals — same sales+ audience as the Opportunity Log they bundle.
router.use(
  "/proposals",
  requireAuth,
  requireCompany,
  requireBetaAccess,
  requireRole("sales"),
  proposalsRouter,
);
// Gemini AI — chat conversations and image generation. Available to all
// authenticated beta users (no role restriction — used by Phase Next AI engines).
router.use("/gemini", requireAuth, requireCompany, requireBetaAccess, geminiRouter);
router.use(
  "/inspections/:inspectionId/bait-stations",
  requireAuth,
  requireCompany,
  requireBetaAccess,
  baitStationsRouter,
);
// Chemical product catalogue — available to all authenticated beta users.
// Products are platform-wide (no company scope); treatment logs are scoped.
router.use("/products", requireAuth, requireBetaAccess, productsRouter);
router.use(
  "/inspections/:inspectionId/treatment-logs",
  requireAuth,
  requireCompany,
  requireBetaAccess,
  treatmentLogsRouter,
);
// CRM Integration — manager+ only: fetching client lists and pushing
// completed inspections to FieldRoutes or PestPac.
router.use(
  "/crm",
  requireAuth,
  requireCompany,
  requireBetaAccess,
  requireRole("manager"),
  crmRouter,
);
// Daily rig + recent mixes — all authenticated beta users (technicians included).
// Sub-routes:  POST/GET /technician/daily-rig
//              GET      /technician/daily-rig/recent-mixes
router.use("/technician/daily-rig", requireAuth, requireCompany, requireBetaAccess, dailyRigRouter);

// Manager rapid-review queue — yesterday's completed inspections for 20-min callback validation.
router.use(
  "/review-queue",
  requireAuth,
  requireCompany,
  requireBetaAccess,
  requireRole("manager"),
  reviewQueueRouter,
);

export default router;
