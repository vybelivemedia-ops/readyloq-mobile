import { Router, type IRouter } from "express";
import healthRouter from "./health";
import inspectionsRouter from "./inspections";
import analysisRouter from "./analysis";
import datasetRouter from "./dataset";
import reportsRouter from "./reports";
import trainingRouter from "./training";
import analyticsRouter from "./analytics";
import intelligenceRouter from "./intelligence";
import brandingRouter from "./branding";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/inspections", inspectionsRouter);
router.use("/analysis", analysisRouter);
router.use("/dataset", datasetRouter);
router.use("/reports", reportsRouter);
router.use("/training", trainingRouter);
router.use("/analytics", analyticsRouter);
router.use("/intelligence", intelligenceRouter);
router.use("/branding", brandingRouter);

export default router;
