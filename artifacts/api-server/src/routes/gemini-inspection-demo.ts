import { Router, json, type ErrorRequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { analyzeDemoPhoto, DemoAnalysisError, DEMO_PARSER_CONTRACT, DEMO_BUILD_VERSION } from "../lib/gemini-inspection-demo";

// Scoped override before the normal small JSON parser. No other endpoint's
// upload limit is expanded. Base64 plus notes must fit within 7 MiB.
export const geminiDemoBodyParser = json({ limit: "7mb" });

export function createGeminiInspectionDemoRouter() {
  const router = Router();
  let activeRequests = 0;
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
    message: { error: "Demo limit reached. Please try again later.", code: "DEMO_RATE_LIMIT" },
  });
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-ReadyLoq-Demo-Parser", DEMO_PARSER_CONTRACT);
    res.setHeader("X-ReadyLoq-Demo-Build", DEMO_BUILD_VERSION);
    if (process.env.NODE_ENV === "production" && process.env.READYLOQ_GEMINI_DEMO_ENABLED !== "true") {
      res.status(404).json({ error: "Demo unavailable", code: "DEMO_DISABLED" });
      return;
    }
    next();
  });
  // Lightweight metadata on the existing resource; never calls Gemini or
  // returns credentials, configuration values, tenant data or photo content.
  router.head("/analyze", rateLimit({ windowMs: 15 * 60 * 1000, max: 60 }), (_req, res) => {
    res.status(204).end();
  });
  // Enforce the availability/rate gate BEFORE allocating a larger JSON body.
  router.use(limiter, geminiDemoBodyParser);
  const bodyErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
    if (err?.type === "entity.too.large" || err?.type === "entity.parse.failed") {
      res.status(err.type === "entity.too.large" ? 413 : 400)
        .json({ error: "Provide a valid photo request within the 5-MB photo limit.", code: "INVALID_INPUT" });
      return;
    }
    next(err);
  };
  router.use(bodyErrorHandler);
  router.post("/analyze", async (req, res) => {
    if (req.get("X-ReadyLoq-Demo-Client") !== DEMO_BUILD_VERSION) {
      res.status(409).json({
        code: "DEMO_VERSION_MISMATCH",
        error: `Stale or mismatched demo client. Server build ${DEMO_BUILD_VERSION}. Reload the current workspace preview; no analysis was run.`,
      });
      return;
    }
    if (activeRequests >= 2) {
      res.setHeader("Retry-After", "15");
      res.status(429).json({ error: "The demo is busy. Please try again shortly.", code: "DEMO_BUSY" });
      return;
    }
    activeRequests++;
    const controller = new AbortController();
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.on("close", disconnected);
    try {
      const result = await analyzeDemoPhoto(req.body, controller.signal, error => {
        req.log?.warn({ demoFailureCode: error.code, diagnostic: error.message, attempt: "initial" },
          "Gemini demo validation failed; requesting one bounded correction");
      });
      if (!res.destroyed && !controller.signal.aborted) res.json(result);
    } catch (err) {
      if (!res.destroyed && !controller.signal.aborted) {
        const error = err instanceof DemoAnalysisError ? err :
          new DemoAnalysisError(502, "DEMO_ERROR", "The demo could not complete the analysis.");
        req.log?.warn({ demoFailureCode: error.code, diagnostic: error.message }, "Gemini demo assessment unavailable");
        res.status(error.status).json({ error: error.message, code: error.code });
      }
    } finally {
      res.off("close", disconnected);
      activeRequests--;
    }
  });
  return router;
}

export default createGeminiInspectionDemoRouter();
