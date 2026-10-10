/**
 * Playwright global setup — initialises the Clerk testing environment.
 *
 * clerkSetup configures the Clerk Frontend SDK to accept testing tokens
 * (generated via the Backend API in each test). This must run before any
 * test that uses setupClerkTestingToken or clerk.signIn.
 *
 * Requires VITE_CLERK_PUBLISHABLE_KEY (Clerk publishable key).
 * Only works with Clerk development instances (pk_test_* keys).
 */
import { clerkSetup } from '@clerk/testing/playwright';
import type { FullConfig } from '@playwright/test';

export default async function globalSetup(_config: FullConfig) {
  await clerkSetup({
    publishableKey: process.env.VITE_CLERK_PUBLISHABLE_KEY,
  });
}
