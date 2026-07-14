/**
 * @platform/property-core
 *
 * Generic physical location / venue abstraction.
 *
 * CANONICAL SOURCE:
 *   ReadyLoq (primary — richest property schema):
 *     repos/readyloq-mobile/lib/db/src/schema/properties.ts
 *       — properties table: id, companyId, address (full structured),
 *         lat/lng, squareFootage, yearBuilt, propertyType, accessInstructions,
 *         contactName, contactPhone, contactEmail, notes, isActive
 *     repos/readyloq-mobile/lib/db/src/schema/companies.ts
 *       — company (owner/manager) associated with properties
 *
 *   VYBE LIVE (secondary — stream venues):
 *     VYBE streams occur at physical locations but the current schema stores
 *     location only as a free-text string on stream records. property-core
 *     provides the structured abstraction VYBE can migrate to.
 *
 * CROSS-APP USAGE:
 *   ReadyLoq: a PropertyRecord is the physical site of a pest inspection.
 *             Fields like squareFootage and yearBuilt inform the inspection
 *             scope and pricing. "residential" and "commercial" are the key
 *             property types.
 *   VYBE: a PropertyRecord is a venue where a creator streams. "venue" type.
 *         The creator's home, a concert hall, a studio.
 *
 * WHAT STAYS IN EACH APP:
 *   ReadyLoq: pest-inspection access instructions, key contact roles,
 *             treatment history, property-specific pricing logic.
 *   VYBE: streaming venue permissions, capacity, audience demographics.
 *
 * DEPENDENCY GRAPH:
 *   property-core → shared-types  (no other platform deps)
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

// ─── Property type ────────────────────────────────────────────────────────────

/**
 * Coarse property category. Both apps extend this with domain-specific subtypes
 * in their own schemas — this union covers the shared base.
 *
 * ReadyLoq adds: "warehouse", "strata", "restaurant", "hotel"
 * VYBE adds:     "studio", "concert_hall", "outdoor"
 */
export type PropertyType =
  | "residential"
  | "commercial"
  | "industrial"
  | "venue"
  | "office"
  | "land"
  | "other";

// ─── Property record ──────────────────────────────────────────────────────────

/**
 * A physical location record shared across all domain contexts.
 *
 * ReadyLoq: inspectionCount, lastInspectedAt, etc. are added in the app schema.
 * VYBE: streamCount, lastStreamAt, etc. are added in the app schema.
 * Neither field set belongs in this generic type.
 */
export interface PropertyRecord {
  id: string;
  type: PropertyType;
  /** Human-readable name (e.g. "123 Main St — Unit 4B", "The Forum"). */
  name: string;
  address: AddressComponents;
  coordinates?: GeoCoordinates;
  /** Gross floor area in square metres. */
  areaSqm?: number;
  yearBuilt?: number;
  /** Whether this property is active / bookable. */
  isActive: boolean;
  /** Freeform notes visible to staff (not customers). */
  internalNotes?: string;
  /** App-specific extension fields. */
  metadata?: Record<string, unknown>;
  createdAt: string; // ISO-8601
  updatedAt: string;
}

// ─── Contact ──────────────────────────────────────────────────────────────────

/**
 * A person associated with a property (owner, tenant, venue manager, etc.).
 * Role string is app-defined (e.g. "owner", "technician_contact", "booker").
 */
export interface PropertyContact {
  id: string;
  propertyId: string;
  role: string;
  name: string;
  phone?: string;
  email?: string;
  isPrimary: boolean;
}

// ─── Store interface ──────────────────────────────────────────────────────────

export interface PropertySearchFilter {
  type?: PropertyType;
  isActive?: boolean;
  nearCoordinates?: { coords: GeoCoordinates; radiusKm: number };
  nameContains?: string;
  /** App-scoping key (e.g. companyId for ReadyLoq, creatorId for VYBE). */
  ownerId?: string;
  limit?: number;
  offset?: number;
}

/**
 * CRUD + search interface for PropertyRecords.
 *
 * EXTRACTION NOTE: ReadyLoq's properties are company-scoped (every query is
 * filtered by companyId). The ownerId field in PropertySearchFilter provides
 * this scoping generically. ReadyLoq passes companyId; VYBE passes creatorId.
 */
export interface PropertyStore {
  create(record: Omit<PropertyRecord, "id" | "createdAt" | "updatedAt">): Promise<PropertyRecord>;
  get(propertyId: string): Promise<PropertyRecord | null>;
  update(propertyId: string, patch: Partial<PropertyRecord>): Promise<PropertyRecord>;
  delete(propertyId: string): Promise<void>;
  search(filter: PropertySearchFilter): Promise<PropertyRecord[]>;
  /** Retrieve all contacts for a property. */
  listContacts(propertyId: string): Promise<PropertyContact[]>;
  saveContact(contact: Omit<PropertyContact, "id">): Promise<PropertyContact>;
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
