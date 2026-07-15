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
export const REPLIT_SIDECAR_ENDPOINT =
  process.env["REPLIT_SIDECAR_ENDPOINT"] ?? "http://127.0.0.1:1106";

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
  constructor(message?: string) {
    super(
      message ??
        "Object storage is not configured. Provision a Replit App Storage bucket " +
          "and set the required environment variables.",
    );
    this.name = "StorageNotConfiguredError";
    Object.setPrototypeOf(this, StorageNotConfiguredError.prototype);
  }
}

// ─── Sidecar presigned URL primitives ────────────────────────────────────────

/** HTTP methods supported by the Replit sidecar signing endpoint. */
export type SignedUrlMethod = "GET" | "PUT" | "DELETE" | "HEAD";

/**
 * Request body sent to the sidecar's `/object-storage/signed-object-url` endpoint.
 * Both apps POST this exact shape (snake_case per sidecar API contract).
 *
 * Example (ReadyLoq):
 *   POST http://127.0.0.1:1106/object-storage/signed-object-url
 *   { bucket_name, object_name, method: "PUT", expires_at, content_type? }
 */
export interface SidecarSignedUrlRequest {
  bucket_name: string;
  object_name: string;
  method: SignedUrlMethod;
  /** ISO-8601 expiry timestamp, e.g. new Date(Date.now() + ttlSec * 1000).toISOString() */
  expires_at: string;
  /** Optional content-type constraint (VYBE uses this; ReadyLoq omits it). */
  content_type?: string;
}

// ─── Storage namespace (scoping) ─────────────────────────────────────────────

/**
 * Controls how object keys are prefixed before being sent to the sidecar.
 *
 * ReadyLoq injects a company-scoped namespace (multi-tenant isolation).
 * VYBE injects IdentityNamespace (single-tenant, no scoping).
 *
 * The namespace is the only difference between the two storage implementations
 * at the logical level — everything else (sidecar, GCS client, error handling)
 * is identical.
 */
export interface StorageNamespace {
  /**
   * Transform a logical path (e.g. "inspections/abc/photo.jpg") into the
   * actual object key stored in the bucket.
   */
  scope(path: string): string;
  /**
   * Reverse a scoped key back to the logical path, for display/linking.
   */
  unscope(key: string): string;
}

/** No-op namespace — keys are stored as-is (VYBE / single-tenant default). */
export const IdentityNamespace: StorageNamespace = {
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
export function companyNamespace(companyId: string | number): StorageNamespace {
  const prefix = `companies/${companyId}/`;
  return {
    scope: (path) => `${prefix}${path}`,
    unscope: (key) => (key.startsWith(prefix) ? key.slice(prefix.length) : key),
  };
}

// ─── Upload / download types ──────────────────────────────────────────────────

export interface UploadOptions {
  /** MIME type sent as Content-Type in the presigned PUT. */
  contentType: string;
  /**
   * For React Native / Expo consumers, supply a local file URI (file:///…)
   * and the implementation uses expo-file-system's uploadAsync.
   * For Node.js / web consumers, supply a Buffer or ReadableStream.
   */
  body: string | Uint8Array | ReadableStream;
}

export interface UploadResult {
  /** Scoped object key as stored in the bucket. */
  key: string;
  /** Public or CDN URL to reference the object. */
  url: string;
  /** Byte size confirmed by the sidecar response, if available. */
  sizeBytes?: number;
}

export interface PresignedUrlOptions {
  /** Expiry in seconds (sidecar default: 3600). */
  expiresIn?: number;
}

// ─── Object storage service interface ────────────────────────────────────────

/**
 * Platform-level contract for an injectable object storage service.
 *
 * NOTE: The concrete implementations in both apps are `ObjectStorageService`
 * concrete classes with richer, GCS-specific method sets that do not yet
 * implement this interface. This is the forward-looking platform contract
 * toward which both implementations are converging.
 *
 * Future migration (Phase 3+): both concrete classes should implement this
 * interface so callers can work against the abstraction instead of the
 * GCS-specific class.
 *
 * Usage (ReadyLoq multi-tenant):
 *   const storage: ObjectStorageService = new ConcreteStorageService({
 *     namespace: companyNamespace(companyId),
 *   });
 *
 * Usage (VYBE single-tenant):
 *   const storage: ObjectStorageService = new ConcreteStorageService({
 *     namespace: IdentityNamespace,
 *   });
 */
export interface ObjectStorageService {
  /** Upload an object; returns the scoped key and a public URL. */
  upload(logicalPath: string, options: UploadOptions): Promise<UploadResult>;
  /** Get a presigned GET URL for an object. */
  getUrl(logicalPath: string, options?: PresignedUrlOptions): Promise<string>;
  /** Delete an object by logical path. */
  delete(logicalPath: string): Promise<void>;
  /** Check whether an object exists. */
  exists(logicalPath: string): Promise<boolean>;
  /** List objects under a logical prefix. */
  list(
    prefix: string,
  ): Promise<Array<{ key: string; sizeBytes: number; lastModified: string }>>;
}
