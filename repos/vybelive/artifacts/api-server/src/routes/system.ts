import { Router } from "express";

const router = Router();

// ─── Version constants ─────────────────────────────────────────────────────────
// Keep in sync with artifacts/mobile/constants/version.ts.
// Both files must be updated together on every release.
const APP_VERSION = "0.9.18";
const BUILD_NUMBER = "122";
const RELEASE_NAME = "Multistream Foundation";

// GET /api/system/version — returns build identity for startup version checks
router.get("/system/version", (_req, res) => {
  res.json({
    version: APP_VERSION,
    build: BUILD_NUMBER,
    release: RELEASE_NAME,
    environment: process.env["NODE_ENV"] ?? "production",
  });
});

export default router;
