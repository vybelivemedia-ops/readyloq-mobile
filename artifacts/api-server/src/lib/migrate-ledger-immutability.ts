/**
 * Database-enforced immutability for the inventory_transactions ledger.
 *
 * Until now, "inventory_transactions is append-only" was true only by coding
 * convention: no production route issues an UPDATE/DELETE against it, but
 * nothing at the database layer stopped a direct DB connection, an admin
 * script, or a future bug from silently mutating or deleting ledger history.
 *
 * This installs a BEFORE UPDATE/DELETE trigger that raises an exception for
 * any such statement, regardless of which code path or role issues it.
 * REVOKE-based protection isn't viable here — the application connects as
 * the table's owner (there is no separate, lower-privileged runtime role in
 * this deployment), and table owners always retain full DML rights over
 * their own tables no matter what is revoked. A trigger is the mechanism
 * that actually works under that constraint.
 *
 * A narrow, explicit escape hatch exists for legitimate test/ops cleanup:
 * setting the `app.bypass_ledger_immutability` session parameter to 'on'
 * inside an explicit transaction (via `SET LOCAL`) allows that transaction's
 * UPDATE/DELETE to proceed. Production request handlers never do this, so an
 * accidental mutation from application code — or a bare statement from a
 * direct psql session — is still blocked by default. See
 * src/test/ledger-bypass.ts for the sanctioned way to use it in tests.
 *
 * INSERT is completely untouched.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

/** Exported so the isolated test database (built via `drizzle-kit push`,
 * which only manages table/column/index structure — not triggers) can apply
 * the exact same trigger in src/test/global-setup.ts. */
export const LEDGER_IMMUTABILITY_SQL_STATEMENTS: string[] = [
  `
  CREATE OR REPLACE FUNCTION prevent_inventory_transactions_mutation()
  RETURNS TRIGGER AS $$
  BEGIN
    IF current_setting('app.bypass_ledger_immutability', true) = 'on' THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
    RAISE EXCEPTION
      'inventory_transactions is an append-only ledger: % is not permitted (row id %)',
      TG_OP, OLD.id;
  END;
  $$ LANGUAGE plpgsql;
  `,
  `DROP TRIGGER IF EXISTS inventory_transactions_immutable ON inventory_transactions;`,
  `
  CREATE TRIGGER inventory_transactions_immutable
    BEFORE UPDATE OR DELETE ON inventory_transactions
    FOR EACH ROW EXECUTE FUNCTION prevent_inventory_transactions_mutation();
  `,
];

export async function migrateLedgerImmutability(): Promise<void> {
  try {
    for (const statement of LEDGER_IMMUTABILITY_SQL_STATEMENTS) {
      await db.execute(sql.raw(statement));
    }
    logger.info(
      "[migrate-ledger-immutability] inventory_transactions UPDATE/DELETE trigger installed",
    );
  } catch (err) {
    logger.error({ err }, "[migrate-ledger-immutability] Migration failed");
    throw err;
  }
}
