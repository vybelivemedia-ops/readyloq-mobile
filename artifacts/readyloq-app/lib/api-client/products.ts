/**
 * Typed API client for the chemical product catalogue and treatment logs.
 *
 * Follows the same customFetch / base-URL / auth pattern as bait-stations.ts.
 * All functions throw on non-2xx responses (customFetch behaviour).
 */
import { customFetch } from "./custom-fetch";

// ─── Product catalogue ────────────────────────────────────────────────────────

export interface ProductLabelRules {
  id: number;
  productId: number;
  approvedPestTypes: string[];
  approvedSiteClassifications: string[];
  requiredEquipmentTypes: string[];
  nozzleSpec: string | null;
  pressurePsi: string | null;
  dropletSize: string | null;
  maxRateOzPer1000Sqft: number | null;
  maxRateOzPerGallon: number | null;
  mixingSteps: string[];
  maxTempF: number | null;
  phytotoxicityNotes: string | null;
  reEntryIntervalHours: number | null;
  /** Minimum whole days before this product may legally be reapplied to the
   *  same site. Null when the label sets no such minimum. */
  retreatmentIntervalDays: number | null;
  createdAt: string;
}

export interface Product {
  id: number;
  name: string;
  epaRegistrationNumber: string | null;
  productType: "restricted-use" | "general-use";
  activeIngredients: string;
  signalWord: "DANGER" | "WARNING" | "CAUTION" | "NONE" | null;
  manufacturerName: string | null;
  isActive: boolean;
  createdAt: string;
  /** Inlined from product_label_rules; populated by GET /products and GET /products/:id. */
  labelRules: ProductLabelRules | null;
}

/** Fetch all active products. Pass pest/site to filter server-side. */
export async function listProducts(params?: {
  pest?: string;
  site?: string;
}): Promise<Product[]> {
  const qs = new URLSearchParams();
  if (params?.pest) qs.set("pest", params.pest);
  if (params?.site) qs.set("site", params.site);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return customFetch<Product[]>(`/api/products${suffix}`);
}

/** Fetch a single product with label rules inline. */
export async function getProduct(productId: number): Promise<Product> {
  return customFetch<Product>(`/api/products/${productId}`);
}

/** Fetch label rules for a specific product. */
export async function getProductLabelRules(
  productId: number,
): Promise<ProductLabelRules> {
  return customFetch<ProductLabelRules>(`/api/products/${productId}/label-rules`);
}

// ─── Treatment logs ───────────────────────────────────────────────────────────

export interface ChecklistItem {
  label: string;
  checked: boolean;
}

export interface TreatmentLogInput {
  productId: number;
  targetPest: string;
  siteClassification: string;
  areaSqft?: number;
  linearFt?: number;
  dilutionOzPerGallon?: number;
  totalProductOz?: number;
  equipmentUsed?: string;
  checklistItems?: ChecklistItem[];
  tempAtApplicationF?: number;
  environmentalWarningAcknowledged: boolean;
  notes?: string;
  appliedAt?: string;
}

export interface TreatmentLog {
  id: number;
  companyId: number;
  inspectionId: number;
  productId: number;
  technicianId: string | null;
  targetPest: string;
  siteClassification: string;
  areaSqft: number | null;
  linearFt: number | null;
  dilutionOzPerGallon: number | null;
  totalProductOz: number | null;
  equipmentUsed: string | null;
  checklistItems: ChecklistItem[];
  tempAtApplicationF: number | null;
  environmentalWarningAcknowledged: boolean;
  notes: string | null;
  appliedAt: string;
  createdAt: string;
  /** Joined product summary returned by GET /inspections/:id/treatment-logs. */
  product?: {
    id: number;
    name: string;
    productType: string;
    activeIngredients: string;
    epaRegistrationNumber: string | null;
  } | null;
  /**
   * Truck stock remaining after this application was deducted. Null when the
   * technician has no inventory baseline for the selected product, or when
   * totalProductOz was not provided (non-volumetric applications).
   */
  updatedInventory?: {
    productId: number;
    quantityOnHand: number;
    unit: string;
  } | null;
}

export interface RateLimitError {
  error: "rate_exceeds_label_maximum";
  message: string;
  appliedRate: number;
  maxRate: number;
  productName: string;
}

/** POST a completed treatment log. Throws RateLimitError on 422. */
export async function createTreatmentLog(
  inspectionId: number,
  input: TreatmentLogInput,
): Promise<TreatmentLog> {
  return customFetch<TreatmentLog>(
    `/api/inspections/${inspectionId}/treatment-logs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

/** GET all treatment logs for an inspection (with product detail joined). */
export async function listTreatmentLogs(
  inspectionId: number,
): Promise<TreatmentLog[]> {
  return customFetch<TreatmentLog[]>(
    `/api/inspections/${inspectionId}/treatment-logs`,
  );
}
