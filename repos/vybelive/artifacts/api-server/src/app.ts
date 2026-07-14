import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// ── Trust proxy (Replit reverse-proxy) ───────────────────────────────────
// Required so rate-limit and logging see the real client IP, not the proxy IP.
app.set("trust proxy", 1);

// ── Security headers (Helmet) ─────────────────────────────────────────────
// Helmet sets a secure baseline for HTTP headers. Since this is a JSON REST
// API (no HTML served), we disable browser-only policies that would produce
// noisy invalid-header warnings while keeping all headers that harden the API.
app.use(
  helmet({
    contentSecurityPolicy: false,   // not an HTML endpoint
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }, // allow mobile clients
  }),
);

// ── CORS ──────────────────────────────────────────────────────────────────
// Native mobile HTTP doesn't use CORS, but Expo web-preview and published
// web builds do. We allowlist Replit dev/prod domains and Expo's dev proxy.
function buildCorsOrigins(): (string | RegExp)[] {
  const origins: (string | RegExp)[] = [];

  // Replit workspace dev domain (Expo web preview, API test panel)
  if (process.env["REPLIT_DEV_DOMAIN"]) {
    origins.push(`https://${process.env["REPLIT_DEV_DOMAIN"]}`);
  }
  // Replit production domains (comma-separated)
  if (process.env["REPLIT_DOMAINS"]) {
    for (const d of process.env["REPLIT_DOMAINS"].split(",")) {
      const trimmed = d.trim();
      if (trimmed) origins.push(`https://${trimmed}`);
    }
  }
  // Expo Go dev proxy (*.janeway.replit.dev, *.expo.dev)
  origins.push(/\.replit\.dev$/);
  origins.push(/\.expo\.dev$/);

  // Local development only
  if (process.env["NODE_ENV"] !== "production") {
    origins.push(/^http:\/\/localhost(:\d+)?$/);
    origins.push(/^http:\/\/127\.0\.0\.1(:\d+)?$/);
  }

  return origins;
}

app.use(
  cors({
    origin: buildCorsOrigins(),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Accept"],
    credentials: true,
    maxAge: 86400, // preflight cache: 24h
  }),
);

// ── Request body limits ───────────────────────────────────────────────────
// The Stripe webhook route requires the raw request body (a Buffer) so that
// stripe.webhooks.constructEvent() can verify the Stripe-Signature header.
// We mount express.raw() for that specific path BEFORE express.json() so
// body-parser sets req._body=true and the global JSON parser skips it.
app.use("/api/subscriptions/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: true, limit: "64kb" }));

// ── Structured request logging (pino-http) ─────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// ── Auth rate limiters ────────────────────────────────────────────────────
//
// Applied before the router so they run even if a route throws.
// skipSuccessfulRequests: only failed requests count towards the window,
// preventing legitimate users from being locked out by their own traffic.

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // 10 failed attempts per IP per window
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many login attempts — please wait 15 minutes and try again" },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many registration attempts — please wait an hour" },
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many token refresh attempts" },
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,                    // 5 requests per IP per hour
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many password reset attempts — please wait an hour" },
});

// Apply limiters per-route before the main router mounts
app.post("/api/auth/login", loginLimiter);
app.post("/api/auth/register", registerLimiter);
app.post("/api/auth/refresh", refreshLimiter);
app.post("/api/auth/forgot-password", forgotPasswordLimiter);

// ── Application routes ────────────────────────────────────────────────────
app.use("/api", router);

// ── Global error handler ──────────────────────────────────────────────────
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled error");
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error" });
});

export default app;
