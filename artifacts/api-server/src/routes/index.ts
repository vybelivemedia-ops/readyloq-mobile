import { Router, type IRouter } from "express";
import {
  requireAuth,
  requireCompany,
  requireRole,
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

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use(storageRouter);
// PUBLIC: marketing-site lead capture (no auth — prospects aren't users yet).
router.use("/leads", leadsRouter);

router.use("/inspections", requireAuth, requireCompany, inspectionsRouter);
router.use("/analysis", requireAuth, requireCompany, analysisRouter);
router.use("/dataset", requireAuth, requireCompany, datasetRouter);
router.use("/reports", requireAuth, requireCompany, reportsRouter);
router.use("/analytics", requireAuth, requireCompany, analyticsRouter);
router.use(
  "/intelligence",
  requireAuth,
  requireCompany,
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
  intelligenceDatasetRouter,
);
router.use("/branding", brandingRouter);
router.use("/properties", requireAuth, requireCompany, propertiesRouter);

export default router;
