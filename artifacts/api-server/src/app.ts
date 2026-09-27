import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import faieRouter from "./routes/faie";
import devRouter from "./routes/dev";
import { logger } from "./lib/logger";
import { WebhookHandlers } from "./lib/webhookHandlers";
import { setupInspectionTriggers } from "./lib/inspection-triggers";

const app: Express = express();

app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

// CORS: the API is called same-origin by the ReadyLoq app, and cross-origin by
// the public marketing site (ReadyLoq.com -> app.readyloq.com/api for lead
// capture). Reflect only known origins instead of every origin — a credentialed
// wildcard would let any site make authenticated requests. CORS_ALLOWED_ORIGINS
// is a comma-separated list of production origins (e.g. https://readyloq.com,
// https://www.readyloq.com, https://app.readyloq.com).
const isProduction = process.env.NODE_ENV === "production";

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// Replit dev/preview origins are allowed ONLY outside production, so the proxied
// workspace keeps working without widening the credentialed-CORS surface in
// prod — there, only CORS_ALLOWED_ORIGINS may make authenticated requests.
const isReplitDevOrigin = (origin: string): boolean => {
  if (isProduction) return false;
  try {
    const { hostname } = new URL(origin);
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname.endsWith(".replit.dev") ||
      hostname.endsWith(".repl.co") ||
      hostname.endsWith(".replit.app")
    );
  } catch {
    return false;
  }
};

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      // No Origin header = non-browser (curl, server-to-server) or same-origin.
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || isReplitDevOrigin(origin)) {
        return callback(null, true);
      }
      // Unknown origin: don't set CORS headers so the browser blocks the read.
      return callback(null, false);
    },
  }),
);

// ── Stripe webhook — MUST be registered before express.json() ────────────────
// stripe-replit-sync requires the raw Buffer body; express.json() would parse
// it and break HMAC signature verification.
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      return res.status(400).json({ error: "Missing stripe-signature" });
    }
    const sig = Array.isArray(signature) ? signature[0] : signature;
    if (!Buffer.isBuffer(req.body)) {
      logger.error("Stripe webhook: body is not a Buffer — express.json() ran first");
      return res.status(500).json({ error: "Webhook processing error" });
    }
    try {
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      return res.status(200).json({ received: true });
    } catch (err) {
      logger.error({ err }, "Stripe webhook processing failed");
      return res.status(400).json({ error: "Webhook processing error" });
    }
  },
);

// ── FAIE training ingest — /v1/faie/... ──────────────────────────────────────
// Mounted BEFORE the global express.json() so these routes get the generous
// 20 MB JSON limit rather than the global 100 KB default. Intentionally
// unauthenticated: mobile clients post fire-and-forget after field photo
// uploads and finding reviews. Payloads include base64 JPEG images (~1–4 MB).
app.use("/v1/faie", express.json({ limit: "20mb" }), faieRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  // Glasses poll every 3 seconds while in use. Their traffic must not consume
  // the same IP budget as inspection uploads and sync.
  skip: (req) => req.path === "/meta-glasses" || req.path.startsWith("/meta-glasses/"),
});

const glassesLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1200, // three continuously polling sessions per IP, plus event traffic
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many glasses requests, please try again later." },
  skip: (req) => !(req.path === "/meta-glasses" || req.path.startsWith("/meta-glasses/")),
});

// ── Dev/test-only routes — fixture seeding for e2e tests ─────────────────────
// Mounted BEFORE the main /api router so they bypass the catch-all auth/company
// middleware in the main router which intercepts /dev/* paths.
//
// Gating strategy — ALL three conditions must be satisfied simultaneously:
//   1. REPLIT_DEPLOYMENT must be absent (Replit sets it in every prod deployment).
//      This is the fail-closed environment gate: if the server is deployed,
//      the router is never registered regardless of other env vars.
//   2. DEV_FIXTURE_SECRET must be present. The secret is the primary runtime
//      control; if it is missing the router never mounts.
//   3. Inside the router, every request must present the same secret value in the
//      x-dev-fixture-secret header (a second independent check in the handler).
//
// NODE_ENV is not used because the dev workflow does not set it, making an
// explicit === "development" check always-false in practice.
if (!process.env.REPLIT_DEPLOYMENT && process.env.DEV_FIXTURE_SECRET) {
  app.use("/api/dev", express.json(), devRouter);
}

app.use("/api", apiLimiter, glassesLimiter, router);

// ── Enterprise Bridge — register inspection lifecycle triggers ────────────────
// Must run after all middleware and routes are registered so the event bus
// listener is alive before any finalization can fire.
setupInspectionTriggers();

export default app;
