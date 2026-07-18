/**
 * @platform/storage-core
 *
 * Object storage contracts and shared primitives for both applications.
 *
 * CANONICAL SOURCES (both are near-identical implementations):
 *
 *   ReadyLoq (superset — multi-tenant):
 *     artifacts/readyloq-app/../api-server/src/lib/objectStorage.ts
 *     - ObjectStorageService class (searchPublicObject, downloadObject,
 *       getObjectEntityUploadURL(companyId), getObjectEntityFile, ACL helpers)
 *     - objectPathCompanyScope() for multi-tenant key namespacing
 *
 *   VYBE (single-tenant):
 *     repos/vybelive/artifacts/api-server/src/lib/objectStorage.ts
 *     - ObjectStorageService class (identical base, no company scoping)
 *     - getObjectEntityUploadURL(contentType?) without companyId
 *     repos/vybelive/artifacts/api-server/src/services/storageService.ts
 *     - StorageNotConfiguredError, recording/clip upload helpers
 *
 * SHARED INFRASTRUCTURE:
 *   Both apps target the Replit object storage sidecar at 127.0.0.1:1106.
 *   Both use the same presigned URL JSON request shape.
 *   Both throw ObjectNotFoundError (structurally identical class).
 *
 * PLATFORM vs APPLICATION:
 *   Platform (here):  shared error classes, namespace abstraction,
 *                     sidecar endpoint constant, service interface contract.
 *   Application:      concrete ObjectStorageService implementations,
 *                     ACL logic, recording/clip helpers, env-var wiring.
 *
 * DEPENDENCY GRAPH:
 *   storage-core → core
 *   evidence-core → storage-core
 *   live-session-core → storage-core
 *   sync-engine → storage-core
 *   asset-core → storage-core
 */
// ─── Infrastructure constants ─────────────────────────────────────────────────
/**
 * Replit object storage sidecar endpoint.
 * Both applications hardcode this value — it is a Replit-platform constant.
 * Override via environment variable in non-Replit deployments.
 */
export const REPLIT_SIDECAR_ENDPOINT = process.env["REPLIT_SIDECAR_ENDPOINT"] ?? "http://127.0.0.1:1106";
// ─── Shared error classes ─────────────────────────────────────────────────────
/**
 * Thrown when a requested object does not exist in storage.
 * Canonical — identical class in both ReadyLoq and VYBE.
 *
 * Usage: catch ObjectNotFoundError to return 404 in route handlers.
 */
export class ObjectNotFoundError extends Error {
    constructor() {
        super("Object not found");
        this.name = "ObjectNotFoundError";
        Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
    }
}
/**
 * Thrown when object storage is not configured (missing env vars).
 *
 * ReadyLoq checks PRIVATE_OBJECT_DIR / PUBLIC_OBJECT_SEARCH_PATHS.
 * VYBE checks DEFAULT_OBJECT_STORAGE_BUCKET_ID.
 * Both throw a descriptive error on missing configuration.
 */
export class StorageNotConfiguredError extends Error {
    constructor(message) {
        super(message ??
            "Object storage is not configured. Provision a Replit App Storage bucket " +
                "and set the required environment variables.");
        this.name = "StorageNotConfiguredError";
        Object.setPrototypeOf(this, StorageNotConfiguredError.prototype);
    }
}
/** No-op namespace — keys are stored as-is (VYBE / single-tenant default). */
export const IdentityNamespace = {
    scope: (path) => path,
    unscope: (key) => key,
};
/**
 * Company-scoped namespace for ReadyLoq multi-tenant isolation.
 * Stores objects under `companies/{companyId}/…` so a key from one company
 * can never be resolved to another's data.
 *
 * Accepts both string and numeric company IDs — ReadyLoq uses numeric DB IDs.
 *
 * Example:
 *   companyNamespace(5).scope("inspections/abc/photo.jpg")
 *   → "companies/5/inspections/abc/photo.jpg"
 */
export function companyNamespace(companyId) {
    const prefix = `companies/${companyId}/`;
    return {
        scope: (path) => `${prefix}${path}`,
        unscope: (key) => (key.startsWith(prefix) ? key.slice(prefix.length) : key),
    };
}
//# sourceMappingURL=index.js.map