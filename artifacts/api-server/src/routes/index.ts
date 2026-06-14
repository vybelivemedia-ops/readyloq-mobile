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
import trainingRouter from "./training";
import analyticsRouter from "./analytics";
import intelligenceRouter from "./intelligence";
import brandingRouter from "./branding";
import propertiesRouter from "./properties";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use(storageRouter);

router.use("/inspections", requireAuth, requireCompany, inspectionsRouter);
router.use("/analysis", requireAuth, requireCompany, analysisRouter);
router.use("/dataset", requireAuth, requireCompany, datasetRouter);
router.use("/reports", requireAuth, requireCompany, reportsRouter);
router.use("/training", requireAuth, requireCompany, trainingRouter);
router.use("/analytics", requireAuth, requireCompany, analyticsRouter);
router.use(
  "/intelligence",
  requireAuth,
  requireCompany,
  requireRole("manager"),
  intelligenceRouter,
);
router.use("/branding", brandingRouter);
router.use("/properties", requireAuth, requireCompany, propertiesRouter);

export default router;
