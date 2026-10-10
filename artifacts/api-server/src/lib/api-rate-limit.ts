import rateLimit from "express-rate-limit";

/** Shared IP budget for normal API traffic, including FAIE ingestion. */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  // Glasses have a separate polling budget in app.ts.
  skip: (req) => req.baseUrl.toLowerCase() === "/api"
    && (req.path === "/meta-glasses" || req.path.startsWith("/meta-glasses/")),
});
