import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for ReadyLoq Company Portal e2e tests.
 *
 * Typical usage (against the already-running workflow dev server):
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=<nix chromium path> \
 *   CLERK_SECRET_KEY=<key> VITE_CLERK_PUBLISHABLE_KEY=<key> \
 *   DEV_FIXTURE_SECRET=<secret> API_URL=http://localhost:3000 \
 *   pnpm test:e2e
 *
 * Self-starting (Playwright manages its own portal dev server on port 4500):
 *   START_WEB_SERVER=1 \
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=<nix chromium path> \
 *   CLERK_SECRET_KEY=<key> VITE_CLERK_PUBLISHABLE_KEY=<key> \
 *   DEV_FIXTURE_SECRET=<secret> API_URL=http://localhost:3000 \
 *   pnpm test:e2e
 *
 * Required env vars:
 *   CLERK_SECRET_KEY           — Clerk Backend API key
 *   VITE_CLERK_PUBLISHABLE_KEY — Clerk publishable key
 *   DEV_FIXTURE_SECRET         — Must match the value set on the API server
 *                                (set via Replit Secrets, not a committed file)
 *
 * NixOS / Replit note: the Playwright-downloaded headless shell lacks patched X11
 * rpaths. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to the nix-store Chromium so
 * tests can run inside Replit without nix-shell:
 *
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(nix-shell -p chromium --run 'which chromium')
 */
const chromiumExec = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

// When START_WEB_SERVER=1 Playwright starts its own portal instance on port 4500.
// The baseURL must match the self-started server's origin (not the workflow server).
const selfStart = Boolean(process.env.START_WEB_SERVER);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // roles share the fixture company — run sequentially
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    // When self-starting the portal on port 4500, resolve absolute page paths
    // against that origin. Otherwise use the already-running workflow server.
    // Note: test paths include the full /readyloq-portal/ prefix because
    // Playwright resolves absolute paths from the origin, not from any path
    // prefix that might be embedded in baseURL.
    baseURL: selfStart
      ? 'http://localhost:4500'
      : (process.env.PORTAL_BASE_URL ?? 'http://localhost:80'),
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  // Optional self-start: Playwright manages its own portal dev instance.
  // Requires BASE_PATH (Vite fails without it) and overrides baseURL above.
  // reuseExistingServer:true lets the command be skipped if something is already
  // listening on port 4500 (e.g. a warm-up from a previous run).
  webServer: selfStart
    ? {
        command: 'pnpm run dev',
        url: 'http://localhost:4500/readyloq-portal/',
        reuseExistingServer: true,
        timeout: 120_000,
        env: {
          PORT: '4500',
          BASE_PATH: '/readyloq-portal',
          VITE_CLERK_PUBLISHABLE_KEY: process.env.VITE_CLERK_PUBLISHABLE_KEY ?? '',
        },
      }
    : undefined,

  globalSetup: './e2e/global.setup.ts',

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(chromiumExec
          ? {
              launchOptions: {
                executablePath: chromiumExec,
                args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
              },
            }
          : {}),
      },
    },
  ],
});
