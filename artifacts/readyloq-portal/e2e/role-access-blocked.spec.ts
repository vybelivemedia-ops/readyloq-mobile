/**
 * e2e: Portal role-access blocking tests
 *
 * role-access.spec.ts proves every role can reach the routes it IS allowed
 * to see. This spec proves the inverse: a role that should NOT see a route
 * is actually kept out, not just incidentally missing from the happy-path
 * list.
 *
 * How ProtectedRoute enforces this (see src/App.tsx):
 *   `roles && !roles.includes(me.effectiveRole)` sets redirectTo = '/'.
 *   The '/' route renders <IndexRedirect> (src/pages/index.tsx), which
 *   immediately routes the signed-in user to their own role's default page
 *   (technician -> /inspections, sales -> /opportunities). So a blocked
 *   navigation never idles on '/' — it bounces straight through it.
 *
 * Consequently "redirected to /" is verified as: the browser never renders
 * the target (blocked) route or an error boundary, and instead settles on
 * the signed-in user's own role-appropriate landing route. If ProtectedRoute
 * were broken and let the user through, the assertion that the blocked
 * route's own heading is absent would fail.
 *
 * Required env vars: same as role-access.spec.ts (CLERK_SECRET_KEY,
 * VITE_CLERK_PUBLISHABLE_KEY, DEV_FIXTURE_SECRET, API_URL, PORTAL_BASE_URL).
 */

import { test, expect } from '@playwright/test';
import { clerk } from '@clerk/testing/playwright';
import { createClerkClient } from '@clerk/backend';
import {
  DEV_FIXTURE_SECRET,
  getOrCreateFixtureUser,
  gotoWithTestingToken,
  claimFixtureRole,
  type Role,
} from './helpers';

// ── Cases ────────────────────────────────────────────────────────────────────
// Each case names a route this role must NOT be able to reach, plus the
// heading that route renders when allowed through (so we can assert its
// absence) and the route's `roles` list from src/App.tsx for reference.

interface BlockedCase {
  role: Role;
  path: string;
  /** Heading only visible if the ProtectedRoute incorrectly let the role through. */
  disallowedHeading: RegExp;
}

const BLOCKED_CASES: BlockedCase[] = [
  // technician is not in roles for these (see src/App.tsx):
  { role: 'technician', path: '/dashboard', disallowedHeading: /^operational briefing$/i },
  { role: 'technician', path: '/reports', disallowedHeading: /^reports$/i },
  { role: 'technician', path: '/team', disallowedHeading: /^team performance$/i },
  { role: 'technician', path: '/analytics', disallowedHeading: /^analytics dashboard$/i },
  // sales is not in roles for these:
  { role: 'sales', path: '/dashboard', disallowedHeading: /^operational briefing$/i },
  { role: 'sales', path: '/team', disallowedHeading: /^team performance$/i },
  { role: 'sales', path: '/analytics', disallowedHeading: /^analytics dashboard$/i },
];

/** Each role's own IndexRedirect landing page (src/pages/index.tsx). */
const ROLE_LANDING_PATH: Record<Role, string> = {
  owner: '/dashboard',
  manager: '/dashboard',
  sales: '/opportunities',
  technician: '/inspections',
};

for (const { role, path, disallowedHeading } of BLOCKED_CASES) {
  test(`${role}: navigating to ${path} is blocked, not allowed through`, async ({ page }) => {
    const clerkSecretKey = process.env.CLERK_SECRET_KEY;
    if (!clerkSecretKey) {
      test.skip(true, 'CLERK_SECRET_KEY not set — skipping Clerk-dependent test');
    }
    if (!DEV_FIXTURE_SECRET) {
      test.skip(true, 'DEV_FIXTURE_SECRET not set — skipping fixture endpoint test');
    }

    const clerkApiClient = createClerkClient({ secretKey: clerkSecretKey! });

    // ── 1. Ensure the fixture Clerk user exists and has the target role ────
    const clerkUserId = await getOrCreateFixtureUser(clerkApiClient, role);
    const claim = await claimFixtureRole(page, clerkUserId, role);
    expect(claim.companyId).toBeGreaterThan(0);

    // ── 2. Sign in via ticket strategy (bypasses password + 2FA) ───────────
    const { token: signInTicket } =
      await clerkApiClient.signInTokens.createSignInToken({
        userId: clerkUserId,
        expiresInSeconds: 60,
      });

    await gotoWithTestingToken(page, clerkApiClient, '/readyloq-portal/');
    await clerk.signIn({
      page,
      signInParams: { strategy: 'ticket', ticket: signInTicket },
    });

    // ── 3. Navigate directly to the route this role must NOT see ───────────
    await gotoWithTestingToken(
      page,
      clerkApiClient,
      `/readyloq-portal${path}`,
    );
    await page.waitForLoadState('load');

    // ── 4. The disallowed page's own heading must never appear ─────────────
    await expect(page.getByRole('heading', { name: disallowedHeading })).not.toBeVisible();

    // ── 5. No error boundary — a broken guard must not surface as a crash ──
    await expect(
      page.getByRole('heading', { name: /something went wrong/i }),
    ).not.toBeVisible();

    // ── 6. The browser must have moved off the blocked path entirely ───────
    // ProtectedRoute redirects to '/', and IndexRedirect immediately continues
    // to this role's own landing route — so the final URL should be that
    // landing route, never the blocked path and never a bare '/'.
    const landingPath = ROLE_LANDING_PATH[role];
    await expect(page).toHaveURL(new RegExp(`${landingPath}$`), { timeout: 20_000 });
    expect(
      page.url(),
      `Role "${role}" was NOT blocked from "${path}" — it stayed on the disallowed route`,
    ).not.toContain(path);

    // ── 7. Sanity: the landing route itself must render cleanly ────────────
    // (Proves step 6 didn't just land on another broken/blank page.)
    await expect(
      page.getByRole('heading', { name: /something went wrong/i }),
    ).not.toBeVisible();
  });
}
