import app from "./app";
import { logger } from "./lib/logger";
import { ensureClerkNativeRedirectUrls } from "./lib/clerk-redirect-urls";

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

  // Fire-and-forget: register native OAuth redirect URLs with Clerk so
  // Google sign-in works in the standalone mobile app (production
  // instances enforce a redirect allowlist; dev instances do not).
  void ensureClerkNativeRedirectUrls();
});
