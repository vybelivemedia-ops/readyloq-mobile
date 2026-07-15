/**
 * @platform/asset-core
 *
 * Generic physical asset abstraction.
 *
 * "Property" is too limiting. "Asset" covers:
 *   Buildings, apartments, warehouses, restaurants, schools, hospitals
 *   Equipment, vehicles, manufacturing lines
 *   Cell towers, solar farms, data centres
 *   Any inspectable, manageable, or visitable entity
 *
 * CANONICAL SOURCE:
 *   ReadyLoq (primary):
 *     repos/readyloq-mobile/lib/db/src/schema/properties.ts
 *       — propertyProfilesTable: id (serial), companyId, addressKey (text,
 *         normalised), siteAddress (text, free-form), clientName, propertyType
 *         (free-text, no enum), technicianKnowledge, hotspots[] (zone+severity)
 *       — propertyNotesTable: id, companyId, addressKey, note, zone, category,
 *         authorName (separate table, not a simple text field)
 *     IMPORTANT — gap between canonical and stub:
 *       ReadyLoq does NOT have squareFootage, yearBuilt, lat/lng, isActive, or
 *       a structured AddressComponents. It uses free-text siteAddress + a
 *       normalised addressKey string as the primary lookup key.
 *       AssetRecord.address (AddressComponents) is a platform-forward design
 *       that ReadyLoq would derive from its siteAddress text.
 *       AssetType is a platform design decision — ReadyLoq uses a free-text
 *       propertyType field with no typed enum.
 *       AssetContact is a forward abstraction — ReadyLoq stores clientName
 *       inline on propertyProfilesTable, not in a separate contacts table.
 *     repos/readyloq-mobile/lib/db/src/schema/companies.ts
 *       — company (owner/manager) associated with properties
 *
 *   VYBE LIVE (secondary — stream venues):
 *     VYBE streams occur at physical locations but the current schema stores
 *     location only as a free-text string on stream records. asset-core
 *     provides the structured abstraction VYBE can migrate to.
 *
 * CROSS-APP USAGE:
 *   ReadyLoq: an AssetRecord is the site of a pest inspection.
 *             Type is "residential", "commercial", "warehouse", "restaurant", etc.
 *             Fields like areaSqm and yearBuilt inform inspection scope and pricing.
 *   VYBE: an AssetRecord is a venue where a creator streams.
 *         Type is "venue", "studio", etc.
 *
 * WHAT STAYS IN EACH APP:
 *   ReadyLoq: access instructions, treatment history, inspection-specific
 *             pricing, pest-type risk profiles per asset category.
 *   VYBE: streaming venue permissions, capacity, audience demographics.
 *
 * DEPENDENCY GRAPH:
 *   asset-core → shared-types  (no other platform deps — deliberate isolation)
 */

// ─── Address ──────────────────────────────────────────────────────────────────

/**
 * Structured postal address. All fields optional to support partial addresses
 * (e.g. only city + state for privacy-masked records).
 */
export interface AddressComponents {
  line1?: string;
  line2?: string;
  city?: string;
  /** State, province, or region. */
  state?: string;
  postalCode?: string;
  /** ISO 3166-1 alpha-2 country code, e.g. "US", "GB". */
  country?: string;
  /** Display-formatted single string (e.g. from geocoding API). */
  formatted?: string;
}

// ─── Geo coordinates ──────────────────────────────────────────────────────────

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
  /** Accuracy radius in metres, if from device GPS. */
  accuracyMetres?: number;
}

// ─── Asset type ───────────────────────────────────────────────────────────────

/**
 * Asset category covering the full range of inspectable / manageable entities.
 * Applications can extend this via their own domain type that intersects with
 * this base union — do not add domain-specific types to this package.
 */
export type AssetType =
  // Real estate
  | "residential"
  | "apartment_building"
  | "commercial"
  | "office"
  | "warehouse"
  | "industrial"
  | "restaurant"
  | "school"
  | "hospital"
  | "hotel"
  | "land"
  // Venues & spaces
  | "venue"
  | "studio"
  | "outdoor_space"
  // Infrastructure
  | "cell_tower"
  | "solar_farm"
  | "data_centre"
  | "utility_station"
  // Movable assets
  | "vehicle"
  | "equipment"
  | "manufacturing_line"
  // Fallback
  | "other";

// ─── Asset record ─────────────────────────────────────────────────────────────

/**
 * A physical (or logical) asset record shared across all domain contexts.
 *
 * ReadyLoq: domain fields (inspectionCount, lastInspectedAt, treatment history)
 *           are added in the app schema — not here.
 * VYBE: domain fields (streamCount, lastStreamAt, capacity) are added in the
 *       app schema — not here.
 *
 * The `metadata` field is the extension point for app-specific data that
 * doesn't belong in the shared schema.
 */
export interface AssetRecord {
  id: string;
  type: AssetType;
  /** Human-readable name (e.g. "123 Main St — Unit 4B", "The Forum", "Unit 7 HVAC"). */
  name: string;
  address: AddressComponents;
  coordinates?: GeoCoordinates;
  /** Gross floor area in square metres (real estate) or footprint (equipment). */
  areaSqm?: number;
  yearBuilt?: number;
  /** Whether this asset is active / available for inspection or visit. */
  isActive: boolean;
  /** Freeform notes visible to staff (not customers). */
  internalNotes?: string;
  /** App-specific extension fields — validated by the application layer. */
  metadata?: Record<string, unknown>;
  createdAt: string; // ISO-8601
  updatedAt: string;
}

// ─── Contact ──────────────────────────────────────────────────────────────────

/**
 * A person associated with an asset (owner, tenant, facility manager, etc.).
 * `role` is application-defined (e.g. "owner", "site_contact", "booker").
 */
export interface AssetContact {
  id: string;
  assetId: string;
  role: string;
  name: string;
  phone?: string;
  email?: string;
  isPrimary: boolean;
}

// ─── Store interface ──────────────────────────────────────────────────────────

export interface AssetSearchFilter {
  type?: AssetType;
  isActive?: boolean;
  nearCoordinates?: { coords: GeoCoordinates; radiusKm: number };
  nameContains?: string;
  /**
   * App-scoping key. Maps to companyId for ReadyLoq, creatorId for VYBE.
   * Undefined = no owner filter (admin queries).
   */
  ownerId?: string;
  limit?: number;
  offset?: number;
}

/**
 * CRUD + search interface for AssetRecords.
 *
 * EXTRACTION NOTE: ReadyLoq's properties are company-scoped (every query is
 * filtered by companyId). The ownerId field in AssetSearchFilter provides
 * this scoping generically. ReadyLoq passes companyId; VYBE passes creatorId.
 */
export interface AssetStore {
  create(record: Omit<AssetRecord, "id" | "createdAt" | "updatedAt">): Promise<AssetRecord>;
  get(assetId: string): Promise<AssetRecord | null>;
  update(assetId: string, patch: Partial<AssetRecord>): Promise<AssetRecord>;
  delete(assetId: string): Promise<void>;
  search(filter: AssetSearchFilter): Promise<AssetRecord[]>;
  /** Retrieve all contacts for an asset. */
  listContacts(assetId: string): Promise<AssetContact[]>;
  saveContact(contact: Omit<AssetContact, "id">): Promise<AssetContact>;
  deleteContact(contactId: string): Promise<void>;
}

// ─── Geocoding ────────────────────────────────────────────────────────────────

/**
 * Resolve a free-text address string to structured components + coordinates.
 * Implementation: Google Maps Geocoding API or equivalent.
 */
export interface GeocodingService {
  geocode(address: string): Promise<{
    components: AddressComponents;
    coordinates: GeoCoordinates;
  } | null>;
  /** Reverse-geocode coordinates to a formatted address. */
  reverseGeocode(coords: GeoCoordinates): Promise<AddressComponents | null>;
}
