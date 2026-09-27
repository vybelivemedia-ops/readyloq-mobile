/**
 * Supplier adapter — pluggable interface for Veseris, Target Specialty, Univar.
 *
 * Design goals:
 *  - All I/O is async; implementations may be live API, webhook, or CSV polling.
 *  - The initial Veseris and Target Specialty adapters use a "CSV polling"
 *    fallback: they generate a provisional order reference locally and return it
 *    immediately. The actual order is submitted by uploading the order details to
 *    the supplier's portal; when the delivery CSV arrives, the existing
 *    /company/supplier/import-csv route confirms receipt and updates inventory.
 *  - Implementations must be stateless — any credential is passed via the
 *    SupplierConnection row's credentialsRef (which maps to a secret-store entry
 *    in production; treated as opaque in the current sandbox).
 *
 * Adding a new supplier:
 *  1. Extend the `SupportedSupplier` union.
 *  2. Implement SupplierAdapter.
 *  3. Register in createSupplierAdapter().
 */

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";
import { db, techRestockEventsTable, type SupplierConnection } from "@workspace/db";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface OrderLine {
  /** EPA registration number (null when not on file — fallback to productName). */
  productEpaNumber: string | null;
  productName: string;
  quantity: number;
  unit: string;
  technicianId: string;
  notes?: string;
}

export interface StockCheck {
  available: boolean;
  quantityAvailable?: number;
  unit?: string;
}

export interface OrderResult {
  /** Stable reference returned by the supplier; written to tech_restock_events.supplier_order_ref. */
  orderRef: string;
  estimatedDeliveryDays?: number;
  notes?: string;
}

export type OrderStatusValue =
  | { status: "pending" }
  | { status: "processing" }
  | { status: "shipped"; trackingNumber?: string }
  | { status: "delivered"; deliveredAt: string }
  | { status: "cancelled"; reason?: string };

// ─── Interface ────────────────────────────────────────────────────────────────

export interface SupplierAdapter {
  /**
   * Check whether the supplier has a product in stock.
   * May return { available: true } when stock cannot be confirmed (CSV-polling
   * mode does not have live catalog access).
   */
  checkStock(productEpaNumber: string): Promise<StockCheck>;

  /**
   * Submit a purchase order for one or more product lines.
   * Returns a stable order reference that is written to the audit log.
   */
  placeOrder(lines: OrderLine[]): Promise<OrderResult>;

  /**
   * Retrieve the current fulfilment status of a previously placed order.
   */
  getOrderStatus(orderRef: string): Promise<OrderStatusValue>;

  /**
   * Mark an order as received and log the actual quantity delivered.
   * In CSV-polling mode this is a no-op — delivery is confirmed via the
   * existing /company/supplier/import-csv route.
   */
  confirmDelivery(orderRef: string, quantityReceived: number): Promise<void>;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Generate a short random suffix for provisional order references. */
function randSuffix(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

/** Format today as YYYYMMDD (UTC). */
function today(): string {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * CSV-polling adapters have no live status API — the only signal that an
 * order has actually shipped/arrived is the delivery CSV import, which writes
 * a tech_restock_events row with source="csv_import" and this same orderRef
 * (see /company/supplier/import-csv). Until that row exists the order is
 * still "pending" from the adapter's point of view.
 */
async function checkCsvDeliveryStatus(
  companyId: number,
  orderRef: string,
): Promise<OrderStatusValue> {
  const [received] = await db
    .select({ receivedAt: techRestockEventsTable.receivedAt })
    .from(techRestockEventsTable)
    .where(
      and(
        eq(techRestockEventsTable.companyId, companyId),
        eq(techRestockEventsTable.supplierOrderRef, orderRef),
        eq(techRestockEventsTable.source, "csv_import"),
      ),
    )
    .limit(1);

  if (received) {
    return { status: "delivered", deliveredAt: received.receivedAt.toISOString() };
  }
  return { status: "pending" };
}

// ─── VerisAdapter — CSV polling fallback ─────────────────────────────────────
//
// Generates a provisional Veseris order reference of the form
//   VSR-YYYYMMDD-{8hexChars}
// and logs the order details so they can be manually submitted to
// the Veseris portal at distributors.veseris.com. Once the delivery
// CSV arrives, the existing import-csv endpoint confirms receipt.

export class VerisAdapter implements SupplierAdapter {
  constructor(private readonly connection: SupplierConnection) {}

  async checkStock(_productEpaNumber: string): Promise<StockCheck> {
    // CSV-polling mode: no live catalog access; report optimistically available.
    return { available: true };
  }

  async placeOrder(lines: OrderLine[]): Promise<OrderResult> {
    const orderRef = `VSR-${today()}-${randSuffix()}`;

    logger.info(
      {
        orderRef,
        accountIdentifier: this.connection.accountIdentifier,
        lineCount: lines.length,
        lines: lines.map((l) => ({
          epa: l.productEpaNumber,
          name: l.productName,
          qty: l.quantity,
          unit: l.unit,
          tech: l.technicianId,
        })),
      },
      "[veseris-adapter] provisional order generated (CSV-polling mode — submit to distributors.veseris.com)",
    );

    return {
      orderRef,
      estimatedDeliveryDays: 5,
      notes:
        "Provisional ref — upload order CSV to distributors.veseris.com. " +
        "Delivery confirmed when supplier CSV is imported via /company/supplier/import-csv.",
    };
  }

  async getOrderStatus(orderRef: string): Promise<OrderStatusValue> {
    // No live API; check whether the delivery CSV import has confirmed receipt.
    const status = await checkCsvDeliveryStatus(this.connection.companyId, orderRef);
    logger.debug({ orderRef, status }, "[veseris-adapter] getOrderStatus — CSV-polling mode");
    return status;
  }

  async confirmDelivery(orderRef: string, quantityReceived: number): Promise<void> {
    // No-op — delivery is confirmed through the CSV import route.
    logger.debug(
      { orderRef, quantityReceived },
      "[veseris-adapter] confirmDelivery — CSV-polling mode, no-op",
    );
  }
}

// ─── TargetSpecialtyAdapter — CSV polling fallback ───────────────────────────
//
// Same pattern as VerisAdapter but with Target Specialty's portal URL
// (tspest.com) and a TSP-prefixed order ref.

export class TargetSpecialtyAdapter implements SupplierAdapter {
  constructor(private readonly connection: SupplierConnection) {}

  async checkStock(_productEpaNumber: string): Promise<StockCheck> {
    return { available: true };
  }

  async placeOrder(lines: OrderLine[]): Promise<OrderResult> {
    const orderRef = `TSP-${today()}-${randSuffix()}`;

    logger.info(
      {
        orderRef,
        accountIdentifier: this.connection.accountIdentifier,
        lineCount: lines.length,
        lines: lines.map((l) => ({
          epa: l.productEpaNumber,
          name: l.productName,
          qty: l.quantity,
          unit: l.unit,
          tech: l.technicianId,
        })),
      },
      "[target-specialty-adapter] provisional order generated (CSV-polling mode — submit to tspest.com)",
    );

    return {
      orderRef,
      estimatedDeliveryDays: 4,
      notes:
        "Provisional ref — upload order CSV to tspest.com. " +
        "Delivery confirmed when supplier CSV is imported via /company/supplier/import-csv.",
    };
  }

  async getOrderStatus(orderRef: string): Promise<OrderStatusValue> {
    // No live API; check whether the delivery CSV import has confirmed receipt.
    const status = await checkCsvDeliveryStatus(this.connection.companyId, orderRef);
    logger.debug(
      { orderRef, status },
      "[target-specialty-adapter] getOrderStatus — CSV-polling mode",
    );
    return status;
  }

  async confirmDelivery(orderRef: string, quantityReceived: number): Promise<void> {
    logger.debug(
      { orderRef, quantityReceived },
      "[target-specialty-adapter] confirmDelivery — CSV-polling mode, no-op",
    );
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Return the appropriate SupplierAdapter for a connection row, or null if the
 * supplier has no adapter implementation yet (univar, other).
 *
 * Only connections with status "active" should reach this factory; the caller
 * is responsible for filtering by status before invoking.
 */
export function createSupplierAdapter(
  connection: SupplierConnection,
): SupplierAdapter | null {
  switch (connection.supplierName) {
    case "veseris":
      return new VerisAdapter(connection);
    case "target_specialty":
      return new TargetSpecialtyAdapter(connection);
    default:
      logger.debug(
        { supplierName: connection.supplierName },
        "[supplier-adapter] no adapter for this supplier yet — order placement skipped",
      );
      return null;
  }
}
