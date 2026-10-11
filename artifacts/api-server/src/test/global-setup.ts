import { spawnSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { adminDatabaseUrl, deriveTestDatabaseUrl } from "./test-db";
import { LEDGER_IMMUTABILITY_SQL_STATEMENTS } from "../lib/migrate-ledger-immutability";
import { PROPERTY_FOUNDATION_SQL } from "../lib/migrate-property-foundation";

/**
 * Runs once before the test suite: creates the isolated `<db>_test` database (if
 * needed) and pushes the current Drizzle schema into it. The test workers
 * receive DATABASE_URL pointed at this database via the `env` block in
 * vitest.config.ts.
 */
export default async function setup() {
  const testUrl = deriveTestDatabaseUrl();
  const dbName = new URL(testUrl).pathname.replace(/^\//, "");

  const admin = new pg.Client({ connectionString: adminDatabaseUrl() });
  await admin.connect();
  try {
    const { rows } = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName],
    );
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.end();
  }

  const dbPackageDir = path.resolve(process.cwd(), "../../lib/db");
  // Composite FKs must not be added before their target unique indexes.
  // Prepare the additive foundation first when upgrading an existing test DB.
  const prepare = new pg.Client({ connectionString: testUrl });
  await prepare.connect();
  try {
    const { rows } = await prepare.query("SELECT to_regclass('public.property_profiles') AS existing");
    if (rows[0]?.existing) {
      await prepare.query("BEGIN");
      await prepare.query("SELECT pg_advisory_xact_lock(73194021)");
      await prepare.query("SET LOCAL lock_timeout='5s'");
      for (const statement of PROPERTY_FOUNDATION_SQL) await prepare.query(statement);
      await prepare.query("COMMIT");
    }
  } finally { await prepare.end(); }
  const push = spawnSync("pnpm", ["exec", "drizzle-kit", "push", "--force", "--config", "./drizzle.config.ts"], {
    cwd: dbPackageDir,
    env: { ...process.env, DATABASE_URL: testUrl },
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  const output = `${push.stdout ?? ""}\n${push.stderr ?? ""}`;
  process.stdout.write(output);
  if (push.error || push.status !== 0 || /(^|\n)(error:|Error:)/i.test(output))
    throw new Error("Isolated test schema push failed; refusing to test a partial schema");

  // drizzle-kit push only manages table/column/index structure — it doesn't
  // know about triggers, so the inventory_transactions immutability trigger
  // (see src/lib/migrate-ledger-immutability.ts) must be applied separately
  // against the test database using the exact same SQL production runs.
  const testClient = new pg.Client({ connectionString: testUrl });
  await testClient.connect();
  try {
    for (const statement of PROPERTY_FOUNDATION_SQL) await testClient.query(statement);
    for (const statement of LEDGER_IMMUTABILITY_SQL_STATEMENTS) {
      await testClient.query(statement);
    }
  } finally {
    await testClient.end();
  }
}
