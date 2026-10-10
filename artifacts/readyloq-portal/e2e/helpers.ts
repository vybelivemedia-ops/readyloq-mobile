/**
 * Shared helpers for portal e2e specs — Clerk fixture-user setup and
 * testing-token navigation.
 *
 * See role-access.spec.ts for the full authentication-strategy rationale
 * (ticket sign-in, testing tokens on every goto, etc).
 */

import { setupClerkTestingToken } from '@clerk/testing/playwright';
import { createClerkClient } from '@clerk/backend';
import type { Page } from '@playwright/test';

export const ROLES = ['owner', 'manager', 'sales', 'technician'] as const;
export type Role = typeof ROLES[number];

/** Direct API server URL — used for fixture-setup calls only. */
export const API_URL = process.env.API_URL ?? 'http://localhost:3000';

/** Must match DEV_FIXTURE_SECRET on the API server. */
export const DEV_FIXTURE_SECRET = process.env.DEV_FIXTURE_SECRET ?? '';

/**
 * Site addresses seeded into the fixture company by dev-fixtures.ts.
 * At least one of these must appear on the inspections list after sign-in.
 */
export const FIXTURE_ADDRESSES = ['42 Fixture Lane', '99 Sample Blvd'];

/**
 * Returns the Clerk userId for the fixture account for a given role,
 * creating the account if it does not yet exist.
 * Idempotent: safe to call on every test run.
 * Does NOT reset the password — we sign in via ticket, not password.
 */
export async function getOrCreateFixtureUser(
  clerkApiClient: ReturnType<typeof createClerkClient>,
  role: Role,
): Promise<string> {
  const email = `fixture-${role}@readyloq-test.dev`;

  const { data: existing } = await clerkApiClient.users.getUserList({
    emailAddress: [email],
  });

  if (existing.length > 0) {
    return existing[0].id;
  }

  const user = await clerkApiClient.users.createUser({
    emailAddress: [email],
    password: 'FixtureInit#9999!',
    firstName: 'Fixture',
    lastName: role[0].toUpperCase() + role.slice(1),
    skipPasswordChecks: true,
  });
  return user.id;
}

/**
 * Creates a fresh Clerk testing token, injects it into the browser context,
 * then navigates to the given URL.
 *
 * Must be called before every page.goto() that loads a Clerk-protected route so
 * the SDK stays in test mode after the full-page reload (testing tokens are
 * short-lived and tied to the page context).
 */
export async function gotoWithTestingToken(
  page: Page,
  clerkApiClient: ReturnType<typeof createClerkClient>,
  url: string,
): Promise<void> {
  const { token } = await clerkApiClient.testingTokens.createTestingToken();
  await setupClerkTestingToken({ page, token });
  await page.goto(url);
}

/**
 * Links (or re-links) a Clerk user to the dev fixture company with the given
 * role via the dev-only claim-fixture-role endpoint.
 */
export async function claimFixtureRole(
  page: Page,
  clerkUserId: string,
  role: Role,
): Promise<{ ok: boolean; companyId: number }> {
  const res = await page.request.post(
    `${API_URL}/api/dev/claim-fixture-role`,
    {
      data: { clerkUserId, role },
      headers: {
        'content-type': 'application/json',
        'x-dev-fixture-secret': DEV_FIXTURE_SECRET,
      },
    },
  );
  if (!res.ok()) {
    throw new Error(`claim-fixture-role rejected for "${role}": ${await res.text()}`);
  }
  return res.json();
}
