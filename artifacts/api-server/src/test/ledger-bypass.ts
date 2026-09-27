/**
 * Test-only escape hatch for the inventory_transactions immutability trigger
 * (see src/lib/migrate-ledger-immutability.ts).
 *
 * Production request handlers must NEVER import or call this — it exists
 * solely so integration tests can reset/clean up ledger rows between runs
 * without weakening the trigger for real application traffic. It works by
 * setting `app.bypass_ledger_immutability = 'on'` via SET LOCAL inside an
 * explicit transaction, which the trigger checks and which automatically
 * reverts the moment the transaction commits or rolls back.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs `fn` inside a transaction with the ledger-immutability trigger
 * bypassed, so tests can UPDATE/DELETE `inventory_transactions` rows for
 * fixture cleanup. Use the `tx` passed into `fn` for the mutation itself —
 * a bypass set on a different connection/transaction has no effect.
 */
export async function withLedgerMutationBypass<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.bypass_ledger_immutability = 'on'`);
    return fn(tx);
  });
}
