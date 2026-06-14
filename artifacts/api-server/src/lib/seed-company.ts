import { db, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Resolve the company that demo/seed data belongs to. Dev seed data is attached
 * to the reserved "legacy" company — the same bucket the tenancy migration assigns
 * pre-existing rows to — creating it if it does not yet exist so the seeds work on
 * a fresh database too.
 */
export async function getSeedCompanyId(): Promise<number> {
  const [existing] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.slug, "legacy"));
  if (existing) return existing.id;
  const [row] = await db
    .insert(companiesTable)
    .values({ name: "Legacy", slug: "legacy" })
    .returning();
  return row.id;
}
