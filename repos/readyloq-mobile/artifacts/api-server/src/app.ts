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
import { logger } from "./lib/logger";

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
});

app.use("/api", apiLimiter, router);

export default app;
