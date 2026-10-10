/**
 * e2e: Portal role-access smoke tests
 *
 * Verifies that every company role (owner, manager, sales, technician) can:
 *   1. Sign in and reach /inspections.  The list must render at least one
 *      fixture inspection row (proves the API call succeeded and the
 *      ProtectedRoute let the user through).
 *   2. Click through to an inspection detail and confirm the fixture site
 *      address is visible (proves the detail route and API auth both work).
 *
 * Authentication strategy — Clerk sign-in token (ticket):
 *   Backend creates a short-lived sign-in token for the fixture user.
 *   clerk.signIn() uses the "ticket" strategy, which bypasses the normal
 *   password + 2FA flow entirely.  This avoids the #/factor-two redirect that
 *   appears when Clerk marks an account as requiring re-verification after a
 *   recent password change, and keeps tests independent of the credential state.
 *
 *   After clerk.signIn() the session is stored in localStorage.  A fresh
 *   testing token is injected before each page.goto() so Clerk stays in test
 *   mode across full-page reloads (testing tokens are short-lived).
 *
 * Required env vars:
 *   CLERK_SECRET_KEY              — Clerk Backend API key
 *   VITE_CLERK_PUBLISHABLE_KEY    — Clerk publishable key
 *   DEV_FIXTURE_SECRET            — Must match API server DEV_FIXTURE_SECRET
 *   API_URL                       — Direct API server URL (default http://localhost:3000)
 *   PORTAL_BASE_URL               — Portal origin (default http://localhost:80)
 *
 * Fixture data (seeded by dev-fixtures.ts on API server startup):
 *   Company:     ReadyLoq Fixture Co  (slug readyloq-fixture)
 *   Inspection 1: "42 Fixture Lane, Springfield"  (status: completed)
 *   Inspection 2: "99 Sample Blvd, Shelbyville"   (status: in_progress)
 *   Clerk emails: fixture-{role}@readyloq-test.dev  (role = owner|manager|sales|technician)
 *
 * NixOS / Replit run command:
 *   PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=$(nix-shell -p chromium --run 'which chromium') \
 *   PORTAL_BASE_URL=http://localhost:80 \
 *   CLERK_SECRET_KEY=<secret> VITE_CLERK_PUBLISHABLE_KEY=<key> \
 *   DEV_FIXTURE_SECRET=<secret> API_URL=http://localhost:3000 \
 *   pnpm test:e2e
 */

import { test, expect } from '@playwright/test';
import { clerk } from '@clerk/testing/playwright';
import { createClerkClient } from '@clerk/backend';
import {
  ROLES,
  DEV_FIXTURE_SECRET,
  FIXTURE_ADDRESSES,
  getOrCreateFixtureUser,
  gotoWithTestingToken,
  claimFixtureRole,
} from './helpers';

// ── Tests ────────────────────────────────────────────────────────────────────

for (const role of ROLES) {
  test(`${role}: inspections list shows fixture row and detail renders site address`, async ({ page }) => {
    const clerkSecretKey = process.env.CLERK_SECRET_KEY;
    if (!clerkSecretKey) {
      test.skip(true, 'CLERK_SECRET_KEY not set — skipping Clerk-dependent test');
    }
    if (!DEV_FIXTURE_SECRET) {
      test.skip(true, 'DEV_FIXTURE_SECRET not set — skipping fixture endpoint test');
    }

    const clerkApiClient = createClerkClient({ secretKey: clerkSecretKey! });

    // ── 1. Ensure the fixture Clerk user exists ────────────────────────────
    const clerkUserId = await getOrCreateFixtureUser(clerkApiClient, role);

    // ── 2. Link the user to the fixture company with the correct role ──────
    const claim = await claimFixtureRole(page, clerkUserId, role);
    expect(claim.companyId).toBeGreaterThan(0);

    // ── 3. Create a Clerk sign-in token (ticket) for the fixture user ──────
    // Ticket strategy bypasses password + 2FA — no re-verification prompts.
    const { token: signInTicket } =
      await clerkApiClient.signInTokens.createSignInToken({
        userId: clerkUserId,
        expiresInSeconds: 60,
      });

    // ── 4. Load the portal in test mode and sign in via ticket ────────────
    // The portal root redirects unauthenticated users to /login.  clerk.signIn()
    // stores the Clerk session in localStorage for the same origin so the next
    // navigation picks it up without going through the login page again.
    await gotoWithTestingToken(page, clerkApiClient, '/readyloq-portal/');

    await clerk.signIn({
      page,
      signInParams: { strategy: 'ticket', ticket: signInTicket },
    });

    // ── 5. Navigate to /inspections with a fresh testing token ────────────
    // clerk.signIn() does not trigger the <SignIn> component's forceRedirectUrl,
    // so we navigate explicitly.  The session is in localStorage (same origin)
    // so Clerk re-hydrates it on the new load.
    await gotoWithTestingToken(
      page,
      clerkApiClient,
      '/readyloq-portal/inspections',
    );
    await page.waitForLoadState('load');

    // ── 6. Wait for the inspections list to actually render ───────────────
    // The <h1>Inspections</h1> heading is always present once the ProtectedRoute
    // renders the list component — it appears before the API response arrives.
    await expect(
      page.getByRole('heading', { name: 'Inspections', exact: true }),
    ).toBeVisible({ timeout: 30_000 });

    // No error boundary may be showing.
    await expect(
      page.getByRole('heading', { name: /something went wrong/i }),
    ).not.toBeVisible();

    // URL must still be /inspections (not redirected to /login or /no-company).
    expect(page.url(), `Role "${role}" was redirected away from /inspections`).toContain('/inspections');
    expect(page.url()).not.toContain('/login');

    // ── 7. Wait for a fixture inspection row to appear ────────────────────
    // The list fetches /api/inspections; the fixture company has two seeded rows.
    // We wait for at least one fixture address to be visible in the table.
    const fixtureAddressPattern = new RegExp(FIXTURE_ADDRESSES.join('|'));
    const fixtureRow = page.getByText(fixtureAddressPattern).first();
    await expect(fixtureRow).toBeVisible({ timeout: 20_000 });

    // ── 8. Click through to an inspection detail ──────────────────────────
    // exact:true is required: Playwright's default name matching is a substring
    // match, so 'View' would also hit the "AI Review" sidebar nav link that
    // owner/manager roles see. The table rows render links whose accessible name
    // is exactly "View", which the exact match selects correctly.
    const viewLink = page.getByRole('link', { name: 'View', exact: true }).first();
    await expect(viewLink).toBeVisible({ timeout: 10_000 });
    await viewLink.click();
    await page.waitForLoadState('load');

    // ── 9. Verify the detail page renders the fixture site address ─────────
    // The detail page shows the inspection's siteAddress prominently.
    // This confirms both the route rendered and the API auth succeeded.
    await expect(
      page.getByText(fixtureAddressPattern).first(),
    ).toBeVisible({ timeout: 20_000 });

    // Detail must not show an error boundary.
    await expect(
      page.getByRole('heading', { name: /something went wrong/i }),
    ).not.toBeVisible();
  });
}
