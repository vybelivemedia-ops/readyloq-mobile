import { Router, type IRouter } from "express";
import { HealthCheckResponse, GetServerVersionResponse } from "@workspace/api-zod";

import { buildInfo } from "../lib/buildInfo";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/version", (_req, res) => {
  const data = GetServerVersionResponse.parse(buildInfo);
  res.json(data);
});

export default router;
