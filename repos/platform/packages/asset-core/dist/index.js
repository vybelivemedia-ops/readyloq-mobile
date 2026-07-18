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
 *   ReadyLoq (primary — richest asset schema):
 *     repos/readyloq-mobile/lib/db/src/schema/properties.ts
 *       — properties table: id, companyId, address (full structured),
 *         lat/lng, squareFootage, yearBuilt, propertyType, accessInstructions,
 *         contactName, contactPhone, contactEmail, notes, isActive
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
export {};
//# sourceMappingURL=index.js.map