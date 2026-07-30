import app from "./app";
import { logger } from "./lib/logger";
import { ensureClerkNativeRedirectUrls } from "./lib/clerk-redirect-urls";
import { ensureProductsSeed } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Idempotent product catalogue seed — inserts any missing seed products on
  // startup. Safe to run every boot; skips rows that already exist.
  void ensureProductsSeed().catch((seedErr) => {
    logger.warn({ err: seedErr }, "Product seed failed — catalogue may be incomplete");
  });

  // Fire-and-forget: register native OAuth redirect URLs with Clerk so
  // Google sign-in works in the standalone mobile app (production
  // instances enforce a redirect allowlist; dev instances do not).
  void ensureClerkNativeRedirectUrls();
});
