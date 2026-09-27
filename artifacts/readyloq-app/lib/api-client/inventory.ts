/**
 * Typed API client for technician chemical inventory management.
 *
 * Covers:
 *  GET  /technician/inventory                     — my on-hand quantities
 *  POST /technician/inventory/baseline            — set initial quantities (first-time)
 *  PATCH /technician/inventory/:productId         — update a single product's quantity
 *  GET  /technician/inventory/restock-events      — my restock history
 *  POST /technician/inventory/restock-events      — log a manual restock delivery
 *  GET  /manager/tech-activity/:userId            — manager activity timeline for a tech
 *  GET  /manager/team-inventory                   — all techs' inventory (manager)
 *  GET  /company/supplier-connections             — list supplier connections
 *  POST /company/supplier-connections             — save / update connection
 *  DELETE /company/supplier-connections/:id       — remove connection
 */

import { customFetch } from "./custom-fetch";

// ─── Core types ───────────────────────────────────────────────────────────────

export interface InventoryProduct {
  productId: number;
  productName: string;
  epaRegistrationNumber: string | null;
  activeIngredients: string;
  productType: string;
  manufacturerName: string | null;
  quantityOnHand: number;
  unit: string;
  /** Minimum on-hand quantity that triggers a manager restock alert. null = no alert configured. */
  restockThreshold: number | null;
  updatedAt: string;
  /** Timestamp of this technician's most recent treatment-log application of this product, if any. */
  lastAppliedAt: string | null;
  /**
   * totalProductOz recorded on that most recent application. ALWAYS fluid
   * ounces — treatment logs record totalProductOz in fl oz regardless of the
   * `unit` this product's on-hand balance is tracked in (e.g. gallon). Always
   * label this "oz" in the UI, never `unit`.
   */
  lastAppliedOz: number | null;
  /**
   * Manager team-inventory view only: sum of totalProductOz applied today.
   * ALWAYS fluid ounces — same caveat as lastAppliedOz above.
   */
  appliedToday?: number;
}

export interface RestockEvent {
  id: number;
  productId: number;
  productName: string;
  quantityReceived: number;
  unit: string;
  source: "manual" | "supplier_api" | "csv_import";
  supplierOrderRef: string | null;
  notes: string | null;
  receivedAt: string;
}

export interface TechActivityDay {
  date: string; // "YYYY-MM-DD"
  ordered: RestockEvent[];
  carried: {
    productId: number;
    productName: string;
    targetPest: string;
    notes?: string;
  }[];
  applied: {
    inspectionId: number;
    siteAddress: string;
    productId: number;
    productName: string;
    targetPest: string;
    siteClassification: string;
    totalProductOz: number | null;
    areaSqft: number | null;
    appliedAt: string;
  }[];
}

export interface TechActivityResponse {
  technicianId: string;
  technicianName: string | null;
  days: TechActivityDay[];
}

export interface TeamInventoryEntry {
  technicianId: string;
  technicianName: string | null;
  role: string;
  inventoryCount: number;
  lastRestockedAt: string | null;
  items: InventoryProduct[];
}

export interface SupplierConnection {
  id: number;
  supplierName: string;
  displayName: string | null;
  accountIdentifier: string;
  status: "active" | "error" | "disconnected" | "pending";
  statusMessage: string | null;
  lastSyncedAt: string | null;
  createdAt: string;
}

/** One row of a parsed supplier order CSV. */
export interface ImportRow {
  technicianId: string;
  productId?: number;
  productEpa?: string;
  productName?: string;
  quantity: number;
  unit: string;
  orderRef: string;
  date?: string;
}

/** Result returned from POST /company/supplier/import-csv. */
export interface ImportResult {
  imported: number;
  skipped: number;
  unmatched: Array<{ rowIndex: number; reason: string }>;
}

// ─── Truck Stock Health ───────────────────────────────────────────────────────
//
// A longer-range "days of coverage remaining" projection per product
// (on-hand ÷ recent average daily consumption), compared against the
// configured replenishment target window. Proactive and TRENDING — distinct
// from Today's Route Readiness (see daily-route.ts), which only looks at
// today's schedule, and from the existing reactive restockThreshold alert.

export type StockHealthStatus = "trending-short" | "healthy" | "no-target-configured" | "insufficient-data";

export interface TruckStockHealthItem {
  productId: number;
  productName: string;
  unit: string;
  quantityOnHand: number;
  projectedDaysCoverage: number | null;
  targetDaysOfSupply: number | null;
  targetScope: "combined" | "technician" | "product" | "company" | "none";
  status: StockHealthStatus;
}

export interface TruckStockHealth {
  technicianId: string;
  lookbackDays: number;
  items: TruckStockHealthItem[];
}

// ─── Inventory API wrappers ───────────────────────────────────────────────────

/** Fetch the calling technician's on-hand inventory. */
export async function getMyInventory(): Promise<InventoryProduct[]> {
  return customFetch<InventoryProduct[]>("/api/technician/inventory");
}

/** Set baseline quantities for multiple products at once (first-time setup).
 *  Pass `restockThreshold` on any item to set the alert level during initial
 *  truck setup; omit it to leave the threshold null (no alert configured). */
export async function setInventoryBaseline(
  items: { productId: number; quantityOnHand: number; unit: string; restockThreshold?: number | null }[],
): Promise<{ updated: number }> {
  return customFetch<{ updated: number }>("/api/technician/inventory/baseline", {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

/** Update the on-hand quantity (and optionally the restock threshold) for a
 *  single product.  Pass `restockThreshold: null` to clear an existing alert. */
export async function updateInventoryItem(
  productId: number,
  quantityOnHand: number,
  unit: string,
  restockThreshold?: number | null,
): Promise<InventoryProduct> {
  return customFetch<InventoryProduct>(`/api/technician/inventory/${productId}`, {
    method: "PATCH",
    body: JSON.stringify({
      quantityOnHand,
      unit,
      ...(restockThreshold !== undefined ? { restockThreshold } : {}),
    }),
  });
}

/** List all restock events for the calling technician. */
export async function getRestockEvents(limit = 50): Promise<RestockEvent[]> {
  return customFetch<RestockEvent[]>(`/api/technician/inventory/restock-events?limit=${limit}`);
}

/** Log a manual restock / delivery for the calling technician. */
export async function logRestockEvent(payload: {
  productId: number;
  quantityReceived: number;
  unit: string;
  source?: "manual" | "csv_import";
  supplierOrderRef?: string;
  notes?: string;
}): Promise<RestockEvent> {
  return customFetch<RestockEvent>("/api/technician/inventory/restock-events", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ─── Manager API wrappers ─────────────────────────────────────────────────────

/** Get a specific tech's activity timeline (ordered/carried/applied by day). */
export async function getTechActivity(
  userId: string,
  params?: { startDate?: string; endDate?: string; limit?: number },
): Promise<TechActivityResponse> {
  const qs = new URLSearchParams();
  if (params?.startDate) qs.set("startDate", params.startDate);
  if (params?.endDate) qs.set("endDate", params.endDate);
  if (params?.limit) qs.set("limit", String(params.limit));
  const q = qs.toString() ? `?${qs.toString()}` : "";
  return customFetch<TechActivityResponse>(`/api/manager/tech-activity/${encodeURIComponent(userId)}${q}`);
}

/** Get all techs' inventory summary (manager view). */
export async function getTeamInventory(): Promise<TeamInventoryEntry[]> {
  return customFetch<TeamInventoryEntry[]>("/api/manager/team-inventory");
}

/** Fetch the calling technician's Truck Stock Health projection. */
export async function getMyStockHealth(lookbackDays?: number): Promise<TruckStockHealth> {
  const q = lookbackDays ? `?lookbackDays=${lookbackDays}` : "";
  return customFetch<TruckStockHealth>(`/api/technician/inventory/stock-health${q}`);
}

/** Manager/owner: Truck Stock Health for every technician on the team. */
export async function getTeamStockHealth(lookbackDays?: number): Promise<TruckStockHealth[]> {
  const q = lookbackDays ? `?lookbackDays=${lookbackDays}` : "";
  return customFetch<TruckStockHealth[]>(`/api/manager/team-stock-health${q}`);
}

/**
 * Manager: set (or clear) the restock-alert threshold for a specific
 * technician's product.  The technician must have already added the product
 * to their inventory; this endpoint only updates existing rows.
 */
export async function setTechInventoryThreshold(
  technicianId: string,
  productId: number,
  restockThreshold: number | null,
): Promise<{ technicianId: string; productId: number; restockThreshold: number | null }> {
  return customFetch(`/api/manager/inventory/${encodeURIComponent(technicianId)}/${productId}`, {
    method: "PATCH",
    body: JSON.stringify({ restockThreshold }),
  });
}

// ─── Supplier connection wrappers ─────────────────────────────────────────────

/** List the company's supplier connections. */
export async function listSupplierConnections(): Promise<SupplierConnection[]> {
  return customFetch<SupplierConnection[]>("/api/company/supplier-connections");
}

/** Save (create or update) a supplier connection. */
export async function saveSupplierConnection(payload: {
  supplierName: string;
  displayName?: string;
  accountIdentifier: string;
  apiKey: string; // sent to server once; never returned
}): Promise<SupplierConnection> {
  return customFetch<SupplierConnection>("/api/company/supplier-connections", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Remove a supplier connection. */
export async function deleteSupplierConnection(id: number): Promise<void> {
  return customFetch<void>(`/api/company/supplier-connections/${id}`, {
    method: "DELETE",
  });
}

/**
 * Submit pre-parsed supplier order rows for import.
 *
 * The mobile client parses the CSV (see supplier-connections.tsx) and sends
 * the structured rows here. The server matches products by EPA number or name,
 * enforces tenant isolation, skips duplicate orderRefs, and updates inventory.
 */
export async function importSupplierCsv(payload: {
  rows: ImportRow[];
  supplierName?: string;
  displayName?: string;
}): Promise<ImportResult> {
  return customFetch<ImportResult>("/api/company/supplier/import-csv", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
