/**
 * Development-only fixture data.
 *
 * Creates a stable "ReadyLoq Fixture Co" company plus two sample inspections
 * so every portal role (owner, manager, sales, technician) can be linked to a
 * real company and immediately see data on the /inspections page during e2e
 * testing.
 *
 * IDEMPOTENT: Safe to call on every dev-server boot; it skips rows that
 * already exist and never touches production (guard at call-site).
 *
 * Usage:
 *   import { ensureDevFixtures } from "./seed/dev-fixtures";
 *   if (process.env.NODE_ENV !== "production") await ensureDevFixtures();
 */

import { db } from "@workspace/db";
import { companiesTable, inspectionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

/** Stable slug that identifies the dev fixture company. */
export const DEV_FIXTURE_SLUG = "readyloq-fixture";
export const DEV_FIXTURE_COMPANY_NAME = "ReadyLoq Fixture Co";

/**
 * Fixture email addresses used as Clerk test accounts.
 * Each email maps to one of the four supported portal roles.
 * The testing agent creates real Clerk accounts with these emails;
 * POST /api/dev/claim-fixture-role then links the resulting clerk_user_id
 * to the fixture company with the matching role.
 */
export const DEV_FIXTURE_EMAILS: Record<string, string> = {
  owner: "fixture-owner@readyloq-test.dev",
  manager: "fixture-manager@readyloq-test.dev",
  sales: "fixture-sales@readyloq-test.dev",
  technician: "fixture-technician@readyloq-test.dev",
};

export async function ensureDevFixtures(): Promise<void> {
  try {
    // ── 1. Ensure fixture company exists ──────────────────────────────────────
    let [company] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.slug, DEV_FIXTURE_SLUG));

    if (!company) {
      const [inserted] = await db
        .insert(companiesTable)
        .values({ name: DEV_FIXTURE_COMPANY_NAME, slug: DEV_FIXTURE_SLUG })
        .returning();
      company = inserted;
      logger.info(
        { companyId: company.id },
        "[dev-fixtures] Created fixture company",
      );
    }

    const companyId = company.id;

    // ── 2. Ensure at least two sample inspections exist ───────────────────────
    const existing = await db
      .select({ id: inspectionsTable.id })
      .from(inspectionsTable)
      .where(eq(inspectionsTable.companyId, companyId));

    if (existing.length < 2) {
      await db.insert(inspectionsTable).values([
        {
          companyId,
          siteAddress: "42 Fixture Lane, Springfield",
          clientName: "Test Client A",
          technicianName: "Fixture Technician",
          status: "completed",
          pestTypes: ["Cockroach", "Ant"],
          notes: "Dev fixture inspection — safe to ignore.",
        },
        {
          companyId,
          siteAddress: "99 Sample Blvd, Shelbyville",
          clientName: "Test Client B",
          technicianName: "Fixture Technician",
          status: "in_progress",
          pestTypes: ["Rodent"],
          notes: "Dev fixture inspection (in progress) — safe to ignore.",
        },
      ]);
      logger.info(
        { companyId },
        "[dev-fixtures] Seeded sample inspections for fixture company",
      );
    }
  } catch (err) {
    // Non-fatal: a seed failure must never crash the dev server.
    logger.warn({ err }, "[dev-fixtures] Fixture seed failed — non-fatal");
  }
}
