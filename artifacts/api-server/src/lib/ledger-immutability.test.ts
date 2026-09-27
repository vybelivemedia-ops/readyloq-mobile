/**
 * DB-level immutability of the inventory_transactions ledger (Task #936).
 *
 * Verifies the BEFORE UPDATE/DELETE trigger installed by
 * migrate-ledger-immutability.ts actually blocks direct SQL mutation —
 * "immutable" is a database-enforced invariant now, not just an absence of
 * UPDATE/DELETE code paths in the routes.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, companiesTable, productsTable, inventoryTransactionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { withLedgerMutationBypass } from "../test/ledger-bypass";

const SLUG = "ledger-immutability-test-co";

let companyId: number;
let productId: number;
let rowId: number;

beforeAll(async () => {
  const [existingCompany] = await db.select().from(companiesTable).where(eq(companiesTable.slug, SLUG));
  companyId = existingCompany
    ? existingCompany.id
    : (await db.insert(companiesTable).values({ name: "Ledger Immutability Test Co", slug: SLUG }).returning())[0]!
        .id;

  const [product] = await db
    .insert(productsTable)
    .values({
      name: "Ledger Immutability Test Product",
      productType: "general-use",
      activeIngredients: "Test 1%",
    })
    .returning();
  productId = product!.id;

  const [row] = await db
    .insert(inventoryTransactionsTable)
    .values({
      companyId,
      productId,
      quantity: 1,
      unit: "unit",
      movementType: "warehouse_receipt",
      source: "supplier",
      destination: "warehouse",
      actingUserId: "ledger_immutability_test_actor",
    })
    .returning();
  rowId = row!.id;
});

afterAll(async () => {
  await withLedgerMutationBypass((tx) => tx.delete(inventoryTransactionsTable).where(eq(inventoryTransactionsTable.id, rowId)));
  await db.delete(productsTable).where(eq(productsTable.id, productId));
});

describe("inventory_transactions immutability trigger", () => {
  it("rejects a direct UPDATE with no bypass set", async () => {
    // drizzle-orm wraps the underlying pg error as `Failed query: ...` and
    // puts the actual Postgres RAISE EXCEPTION message on `.cause`.
    await expect(
      db.update(inventoryTransactionsTable).set({ quantity: 999 }).where(eq(inventoryTransactionsTable.id, rowId)),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only ledger/i) } });
  });

  it("rejects a direct DELETE with no bypass set", async () => {
    await expect(
      db.delete(inventoryTransactionsTable).where(eq(inventoryTransactionsTable.id, rowId)),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/append-only ledger/i) } });

    // Confirm the row really does still exist — the trigger didn't just log
    // a warning, it genuinely stopped the statement.
    const [row] = await db.select().from(inventoryTransactionsTable).where(eq(inventoryTransactionsTable.id, rowId));
    expect(row).toBeDefined();
  });

  it("still permits UPDATE/DELETE when the sanctioned test bypass is set", async () => {
    await withLedgerMutationBypass((tx) =>
      tx.update(inventoryTransactionsTable).set({ notes: "bypass ok" }).where(eq(inventoryTransactionsTable.id, rowId)),
    );
    const [updated] = await db.select().from(inventoryTransactionsTable).where(eq(inventoryTransactionsTable.id, rowId));
    expect(updated!.notes).toBe("bypass ok");
  });

  it("does not block INSERT", async () => {
    const [row] = await db
      .insert(inventoryTransactionsTable)
      .values({
        companyId,
        productId,
        quantity: 2,
        unit: "unit",
        movementType: "warehouse_receipt",
        source: "supplier",
        destination: "warehouse",
        actingUserId: "ledger_immutability_test_actor",
      })
      .returning();
    expect(row).toBeDefined();
    await withLedgerMutationBypass((tx) =>
      tx.delete(inventoryTransactionsTable).where(eq(inventoryTransactionsTable.id, row!.id)),
    );
  });
});
