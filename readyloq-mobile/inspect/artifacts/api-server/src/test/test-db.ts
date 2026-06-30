/**
 * Helpers for isolating API tests onto a dedicated `<db>_test` database so that
 * destructive/transactional tests (branding activate, delete, restore-defaults)
 * never touch the shared development data.
 */

/** Derive the URL of the isolated test database from the primary DATABASE_URL. */
export function deriveTestDatabaseUrl(original = process.env.DATABASE_URL): string {
  if (!original) throw new Error("DATABASE_URL must be set to run API tests");
  const u = new URL(original);
  const name = u.pathname.replace(/^\//, "").replace(/\/$/, "") || "postgres";
  u.pathname = "/" + (name.endsWith("_test") ? name : `${name}_test`);
  return u.toString();
}

/** URL of the maintenance `postgres` database, used only to CREATE the test DB. */
export function adminDatabaseUrl(original = process.env.DATABASE_URL): string {
  if (!original) throw new Error("DATABASE_URL must be set to run API tests");
  const u = new URL(original);
  u.pathname = "/postgres";
  return u.toString();
}
