import { Router, type IRouter } from "express";
import { requireAuth, requireRole } from "../middleware/require-auth";
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

router.use("/inspections", requireAuth, inspectionsRouter);
router.use("/analysis", requireAuth, analysisRouter);
router.use("/dataset", requireAuth, datasetRouter);
router.use("/reports", requireAuth, reportsRouter);
router.use("/training", requireAuth, trainingRouter);
router.use("/analytics", requireAuth, analyticsRouter);
router.use("/intelligence", requireAuth, requireRole("manager"), intelligenceRouter);
router.use("/branding", requireAuth, brandingRouter);
router.use("/properties", requireAuth, propertiesRouter);

export default router;
