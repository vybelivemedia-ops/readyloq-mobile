import { execSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { adminDatabaseUrl, deriveTestDatabaseUrl } from "./test-db";
import { LEDGER_IMMUTABILITY_SQL_STATEMENTS } from "../lib/migrate-ledger-immutability";

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
  execSync("pnpm exec drizzle-kit push --force --config ./drizzle.config.ts", {
    cwd: dbPackageDir,
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: "inherit",
  });

  // drizzle-kit push only manages table/column/index structure — it doesn't
  // know about triggers, so the inventory_transactions immutability trigger
  // (see src/lib/migrate-ledger-immutability.ts) must be applied separately
  // against the test database using the exact same SQL production runs.
  const testClient = new pg.Client({ connectionString: testUrl });
  await testClient.connect();
  try {
    for (const statement of LEDGER_IMMUTABILITY_SQL_STATEMENTS) {
      await testClient.query(statement);
    }
  } finally {
    await testClient.end();
  }
}
