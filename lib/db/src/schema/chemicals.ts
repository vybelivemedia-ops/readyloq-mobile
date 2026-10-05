/**
 * Chemical inventory schema — per-tech on-hand quantities, restock events,
 * and supplier connection records.
 *
 * Design notes:
 *  - Per-tech inventory is keyed by (companyId, technicianId, productId).
 *    Drivers and walkers carry completely different kit profiles.
 *  - Restock events are immutable audit rows; quantity_on_hand in
 *    tech_inventory is the running balance, updated on each restock.
 *  - Supplier connections store the account identifier but never the
 *    raw API key — credentials are stored server-side in env/secrets.
 *  - Morning kit declarations reuse technicianDailyRigsTable (already exists).
 *    Copy-Yesterday functionality is handled in the API layer (date query).
 */

import {
  pgTable,
  serial,
  text,
  integer,
  real,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { productsTable } from "./products";

// ─── Tech inventory (per-tech on-hand quantities) ─────────────────────────────

export const techInventoryTable = pgTable(
  "tech_inventory",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),
    /** Clerk userId of the technician who owns this inventory row. */
    technicianId: text("technician_id").notNull(),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id),
    /** Quantity currently on hand (e.g. 32 oz, 5 units). */
    quantityOnHand: real("quantity_on_hand").notNull().default(0),
    /** Human-readable unit matching product label (oz, lb, ml, unit, bag, etc.) */
    unit: text("unit").notNull().default("unit"),
    /**
     * Minimum on-hand quantity (same unit as quantityOnHand) below which a
     * manager restock alert fires after each treatment-log deduction.
     * Null = no threshold configured for this tech/product pair.
     */
    restockThreshold: real("restock_threshold"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tech_inventory_uq").on(t.companyId, t.technicianId, t.productId),
    index("tech_inventory_company_idx").on(t.companyId),
    index("tech_inventory_technician_idx").on(t.technicianId),
  ],
);

// ─── Tech restock events (immutable audit log) ────────────────────────────────

export const techRestockEventsTable = pgTable(
  "tech_restock_events",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),
    technicianId: text("technician_id").notNull(),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id),
    quantityReceived: real("quantity_received").notNull(),
    unit: text("unit").notNull().default("unit"),
    /** "manual" — tech/manager entered; "supplier_api" — pulled from supplier
     *  portal; "csv_import" — uploaded from supplier CSV export. */
    source: text("source").notNull().default("manual"),
    /** External order/delivery reference from the supplier (optional). */
    supplierOrderRef: text("supplier_order_ref"),
    notes: text("notes"),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("tech_restock_events_company_idx").on(t.companyId),
    index("tech_restock_events_technician_idx").on(t.technicianId),
    index("tech_restock_events_product_idx").on(t.productId),
    index("tech_restock_events_received_at_idx").on(t.receivedAt),
  ],
);

// ─── Supplier connections ─────────────────────────────────────────────────────
//
// One row per supplier account per company. The actual API key or OAuth token
// is NEVER stored here — it lives in a server-side secret store. This table
// only tracks the account identifier, sync state, and status.

export const supplierConnectionsTable = pgTable(
  "supplier_connections",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),
    /** Supplier identifier: "veseris" | "target_specialty" | "univar" | "other" */
    supplierName: text("supplier_name").notNull(),
    /** Human-readable display name (e.g. "Veseris - Southeast Region"). */
    displayName: text("display_name"),
    /** Account identifier at the supplier (email or account number). */
    accountIdentifier: text("account_identifier").notNull(),
    /** Opaque reference used by the sync job to load credentials from secrets. */
    credentialsRef: text("credentials_ref"),
    /** "active" | "error" | "disconnected" | "pending" */
    status: text("status").notNull().default("pending"),
    statusMessage: text("status_message"),
    lastSyncedAt: timestamp("last_synced_at"),
    /**
     * Per-supplier override for replenishment lead time (days from order
     * placement to delivery). Null = no override at this scope; the
     * predictive-restocking forecast falls back to a per-product override
     * (replenishment_targets) or the company default. See
     * lib/predictive-restocking.ts's resolveLeadTimeDays().
     */
    leadTimeDays: real("lead_time_days"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("supplier_connections_uq").on(t.companyId, t.supplierName, t.accountIdentifier),
    index("supplier_connections_company_idx").on(t.companyId),
  ],
);

// ─── Pending restock requests ─────────────────────────────────────────────────
//
// One row per (company, tech, product). Created/re-opened by the treatment-log
// deduction path whenever quantity_on_hand drops below restock_threshold.
// Managers dismiss or approve from the portal; approvals feed into Task #884
// (supplier order placement). The unique constraint means re-dropping below
// threshold after a dismiss reopens the same row rather than creating duplicates.

export const pendingRestockRequestsTable = pgTable(
  "pending_restock_requests",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),
    /** Clerk userId of the technician whose stock triggered the alert. */
    technicianId: text("technician_id").notNull(),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id),
    /** Quantity on hand at the moment the alert fired (same unit as inventory). */
    quantityOnHand: real("quantity_on_hand").notNull(),
    /** Threshold that was crossed. */
    restockThreshold: real("restock_threshold").notNull(),
    /** restockThreshold − quantityOnHand — how much needs to be ordered. */
    shortfall: real("shortfall").notNull(),
    /** "pending" | "approved" | "dismissed" */
    status: text("status").notNull().default("pending"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pending_restock_requests_uq").on(t.companyId, t.technicianId, t.productId),
    index("pending_restock_requests_company_idx").on(t.companyId),
    index("pending_restock_requests_status_idx").on(t.status),
  ],
);

// ─── Supplier orders ──────────────────────────────────────────────────────────
//
// One row per approved restock alert. Records the provisional order reference
// returned by the supplier adapter at the moment of approval.
//
// Separation of concerns:
//  - This table tracks PLACED orders (order intent, not receipt).
//  - tech_restock_events tracks RECEIVED inventory (delivery confirmation).
//    The CSV import route writes a receipt event when the delivery arrives;
//    its deduplication logic is on supplier_order_ref so the two tables
//    never collide.
//
// The unique constraint on (company_id, alert_id) makes approval idempotent:
// a duplicate PATCH /approve for the same alert cannot generate a second order.

export const supplierOrdersTable = pgTable(
  "supplier_orders",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),
    /** FK to pending_restock_requests.id — not a hard FK to keep migration simple. */
    alertId: integer("alert_id").notNull(),
    technicianId: text("technician_id").notNull(),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id),
    /** Supplier that fulfilled the order ("veseris" | "target_specialty" | …). */
    supplierName: text("supplier_name").notNull(),
    /** Stable reference returned by the supplier adapter (written to audit log). */
    orderRef: text("order_ref").notNull(),
    quantityOrdered: real("quantity_ordered").notNull(),
    unit: text("unit").notNull().default("unit"),
    /** "placed" | "shipped" | "delivered" | "cancelled" */
    status: text("status").notNull().default("placed"),
    notes: text("notes"),
    placedAt: timestamp("placed_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("supplier_orders_alert_uq").on(t.companyId, t.alertId),
    index("supplier_orders_company_idx").on(t.companyId),
    index("supplier_orders_technician_idx").on(t.technicianId),
  ],
);

// ─── Warehouse inventory (company-level balance per product) ─────────────────
//
// The Warehouse tier sits above technician trucks: a company-wide on-hand
// balance per product, distinct from any technician's tech_inventory row.
// Stock enters the warehouse via a supplier receipt and leaves it only via a
// transfer into a specific technician's truck (see the transfer endpoint,
// which enforces the balance can never go negative).

export const warehouseInventoryTable = pgTable(
  "warehouse_inventory",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id),
    /** Quantity currently on hand in the warehouse (same unit semantics as tech_inventory). */
    quantityOnHand: real("quantity_on_hand").notNull().default(0),
    unit: text("unit").notNull().default("unit"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("warehouse_inventory_uq").on(t.companyId, t.productId),
    index("warehouse_inventory_company_idx").on(t.companyId),
  ],
);

// ─── Inventory transactions (immutable movement ledger) ───────────────────────
//
// A generic, append-only record of every stock movement in the system:
//  - "warehouse_receipt"           supplier          → warehouse
//  - "warehouse_to_truck_transfer" warehouse         → technician truck
//  - "truck_receipt"               supplier / manual → technician truck
//                                   (mirrors tech_restock_events)
//  - "truck_deduction"             technician truck  → property (treatment log)
//  - "truck_deduction_reversal"    property          → technician truck
//                                   (a treatment log was deleted/corrected)
//  - "truck_adjustment"            adjustment:baseline / adjustment:manual
//                                   ↔ technician truck (a technician set an
//                                   absolute on-hand count via the baseline
//                                   or PATCH routes rather than a relative
//                                   receipt/deduction; quantity is the
//                                   resulting delta, direction encoded in
//                                   source/destination)
//
// Rows are never updated or deleted by application code — this table exists
// purely as the audit trail behind the purpose-built balance tables
// (tech_inventory, warehouse_inventory) and their own event tables.

export const inventoryTransactionsTable = pgTable(
  "inventory_transactions",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id),
    quantity: real("quantity").notNull(),
    unit: text("unit").notNull().default("unit"),
    movementType: text("movement_type").notNull(),
    /** Structured origin, e.g. "supplier", "warehouse", "truck:<clerkUserId>", "property:<inspectionId>". */
    source: text("source").notNull(),
    /** Structured destination, using the same conventions as `source`. */
    destination: text("destination").notNull(),
    /** Clerk userId of the technician truck involved (source or destination), for per-tech history queries. Null for warehouse-only movements. */
    technicianId: text("technician_id"),
    /** Clerk userId of the user who performed/triggered this movement. */
    actingUserId: text("acting_user_id").notNull(),
    /** Optional link back to the domain row that caused this movement (treatment log id, restock event id, etc.). */
    referenceId: integer("reference_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("inventory_transactions_company_idx").on(t.companyId),
    index("inventory_transactions_technician_idx").on(t.technicianId),
    index("inventory_transactions_product_idx").on(t.productId),
    index("inventory_transactions_created_at_idx").on(t.createdAt),
  ],
);

// ─── Replenishment targets (configured window, consumed by Truck Stock Health) ─
//
// Stores the target replenishment window (days of on-hand supply desired).
// Consumed by inventory-forecasting.ts's resolveReplenishmentTarget() to
// compute Truck Stock Health projections; a later predictive-restocking task
// may also use it to generate reorder recommendations. Scoping uses non-null sentinel
// values so a plain (companyId, technicianId, productId) unique index works
// without the NULL-distinctness pitfalls of a nullable unique key:
//
//   technicianId = ""  → applies to all technicians
//   productId    = 0   → applies to all products
//
// So exactly one row per company has technicianId="" AND productId=0 (the
// company default). distanceAdjustmentFactor is only meaningful — and only
// ever set by the API — on technician-scoped rows (technicianId !== "").

export const replenishmentTargetsTable = pgTable(
  "replenishment_targets",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),
    /** "" = applies to all technicians. */
    technicianId: text("technician_id").notNull().default(""),
    /** 0 = applies to all products. Not a hard FK — 0 is a sentinel, not a real product id. */
    productId: integer("product_id").notNull().default(0),
    /** Target days of on-hand supply for this scope. Null = no override at this scope (row kept only for its distanceAdjustmentFactor). */
    daysOfSupply: real("days_of_supply"),
    /** Multiplier applied to a technician's computed buffer (e.g. 1.5 = carry 50% more) for a longer/farther route. Only set on technician-scoped rows. */
    distanceAdjustmentFactor: real("distance_adjustment_factor"),
    /**
     * Configured supplier replenishment lead time (days from order placement
     * to delivery), reusing this table's existing sentinel scoping. Only
     * ever set on technicianId="" rows (company default: productId=0, or a
     * per-product override: productId=<id>) — lead time is a supply-chain
     * property, not a per-technician one. Resolution precedence (most to
     * least specific): per-product override → per-supplier override
     * (supplier_connections.leadTimeDays) → company default. See
     * lib/predictive-restocking.ts's resolveLeadTimeDays().
     */
    leadTimeDays: real("lead_time_days"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("replenishment_targets_uq").on(t.companyId, t.technicianId, t.productId),
    index("replenishment_targets_company_idx").on(t.companyId),
  ],
);

// ─── Predictive restock recommendations ────────────────────────────────────
//
// A third, distinct proactive signal (alongside Today's Route Readiness and
// Truck Stock Health): a specific, dated, dismissible/actionable
// recommendation generated when the adaptive forecast in
// lib/predictive-restocking.ts projects a technician/product will breach its
// safety-stock floor before a newly-placed order could arrive (on-hand
// consumption trend + upcoming scheduled-route demand + configured supplier
// lead time). One row per (company, technician, product) — recomputed
// in-place rather than duplicated, mirroring pending_restock_requests.
//
// Distinct from pending_restock_requests (the reactive, static-threshold
// alert fired synchronously inside the treatment-log deduction transaction):
// this table is forward-looking and recomputed from the trend/schedule
// forecast, not from a single deduction crossing a fixed number. "Acting on"
// a recommendation converts it into a pending_restock_requests row so it
// flows through the exact same manager-approval → supplier-order pipeline —
// this table never places a supplier order directly.
export const predictiveRestockRecommendationsTable = pgTable(
  "predictive_restock_recommendations",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),
    technicianId: text("technician_id").notNull(),
    productId: integer("product_id")
      .notNull()
      .references(() => productsTable.id),
    /** Snapshot of on-hand quantity (same unit as tech_inventory) at the time this was last (re)computed. */
    quantityOnHand: real("quantity_on_hand").notNull(),
    unit: text("unit").notNull().default("unit"),
    /** Recency-weighted daily consumption rate, blended with upcoming scheduled-route demand (see computePredictiveRestockForecast). */
    projectedDailyRate: real("projected_daily_rate").notNull(),
    /** Resolved supplier lead time (days) used for this computation. */
    leadTimeDays: real("lead_time_days").notNull(),
    /** Resolved safety-stock window (days) used for this computation — the technician/product's effective replenishment target. */
    safetyStockDays: real("safety_stock_days").notNull(),
    /** projectedDailyRate * (leadTimeDays + safetyStockDays) — order when on-hand drops below this. */
    reorderPointQuantity: real("reorder_point_quantity").notNull(),
    /** max(0, reorderPointQuantity - quantityOnHand) — how much to order to clear the trigger. */
    recommendedOrderQuantity: real("recommended_order_quantity").notNull(),
    /** Count of the technician's scheduled stops in the forecast window, factored into projectedDailyRate — surfaced for manager transparency. */
    scheduledStopCount: integer("scheduled_stop_count").notNull().default(0),
    /** Projected date on-hand quantity reaches zero at the current rate, if no action is taken. Null when the rate is zero/unknown. */
    projectedBreachAt: timestamp("projected_breach_at"),
    /** Date by which the order should be placed so replenishment arrives before the safety-stock floor is breached (now, if already overdue). */
    recommendedByAt: timestamp("recommended_by_at").notNull(),
    /** "pending" | "dismissed" | "converted" (converted → a pending_restock_requests row was created; see convertedAlertId) */
    status: text("status").notNull().default("pending"),
    /** Set when status="converted" — the pending_restock_requests.id this recommendation was turned into. */
    convertedAlertId: integer("converted_alert_id"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("predictive_restock_recommendations_uq").on(t.companyId, t.technicianId, t.productId),
    index("predictive_restock_recommendations_company_idx").on(t.companyId),
    index("predictive_restock_recommendations_status_idx").on(t.status),
  ],
);

// ─── Zod schemas & TypeScript types ──────────────────────────────────────────

export const insertTechInventorySchema = createInsertSchema(techInventoryTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  companyId: true,
});

export const insertTechRestockEventSchema = createInsertSchema(techRestockEventsTable).omit({
  id: true,
  createdAt: true,
  companyId: true,
});

export const insertSupplierConnectionSchema = createInsertSchema(supplierConnectionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  companyId: true,
  credentialsRef: true,
  lastSyncedAt: true,
});

export const selectTechInventorySchema = createSelectSchema(techInventoryTable);
export const selectTechRestockEventSchema = createSelectSchema(techRestockEventsTable);
export const selectSupplierConnectionSchema = createSelectSchema(supplierConnectionsTable);

export type TechInventory = typeof techInventoryTable.$inferSelect;
export type InsertTechInventory = z.infer<typeof insertTechInventorySchema>;
export type TechRestockEvent = typeof techRestockEventsTable.$inferSelect;
export type InsertTechRestockEvent = z.infer<typeof insertTechRestockEventSchema>;
export type SupplierConnection = typeof supplierConnectionsTable.$inferSelect;
export type InsertSupplierConnection = z.infer<typeof insertSupplierConnectionSchema>;
export type PendingRestockRequest = typeof pendingRestockRequestsTable.$inferSelect;
export type SupplierOrder = typeof supplierOrdersTable.$inferSelect;

export const selectWarehouseInventorySchema = createSelectSchema(warehouseInventoryTable);
export const selectInventoryTransactionSchema = createSelectSchema(inventoryTransactionsTable);
export const selectReplenishmentTargetSchema = createSelectSchema(replenishmentTargetsTable);
export const selectPredictiveRestockRecommendationSchema = createSelectSchema(
  predictiveRestockRecommendationsTable,
);

export type WarehouseInventory = typeof warehouseInventoryTable.$inferSelect;
export type InventoryTransaction = typeof inventoryTransactionsTable.$inferSelect;
export type ReplenishmentTarget = typeof replenishmentTargetsTable.$inferSelect;
export type PredictiveRestockRecommendation = typeof predictiveRestockRecommendationsTable.$inferSelect;
