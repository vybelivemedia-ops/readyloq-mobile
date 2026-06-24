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

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use(storageRouter);
// PUBLIC: marketing-site lead capture (no auth — prospects aren't users yet).
router.use("/leads", leadsRouter);

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

export default router;
