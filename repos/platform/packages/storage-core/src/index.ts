/**
 * @platform/storage-core
 *
 * Unified object storage service for the Replit sidecar endpoint.
 *
 * CANONICAL SOURCE:
 *   Both apps have near-identical implementations — ReadyLoq's is the superset:
 *   repos/readyloq-mobile/artifacts/readyloq-app/lib/objectStorage.ts
 *     + objectPathCompanyScope() for multi-tenant path namespacing
 *   repos/vybelive/artifacts/api-server/src/lib/objectStorage.ts
 *     (same base, no company scoping — single-tenant)
 *
 * SIDECAR ENDPOINT:
 *   Both apps target http://127.0.0.1:1106 (Replit object storage sidecar).
 *   The sidecar returns presigned PUT URLs; the client uploads directly to
 *   the bucket via a plain HTTP PUT with the file body.
 *
 * MULTI-TENANCY:
 *   ReadyLoq uses objectPathCompanyScope(companyId, path) to namespace all
 *   keys under companies/{companyId}/… so tenant data never leaks across
 *   companies. VYBE is single-tenant and does not scope paths.
 *   The StorageNamespace interface in this package makes scoping optional
 *   and injectable — callers provide a namespace adapter, default is the
 *   identity (no-op) namespace for backward compatibility.
 *
 * GENERALISATION NEEDED (before extraction):
 *   - Move sidecar base URL to an environment variable rather than hardcoding
 *     127.0.0.1:1106 so tests and non-Replit deployments can override it.
 *   - Return typed error objects instead of throwing raw Error strings.
 */

// ─── Storage namespace (scoping) ─────────────────────────────────────────────

/**
 * Controls how object keys are prefixed before being sent to the sidecar.
 * ReadyLoq injects a CompanyNamespace; VYBE injects IdentityNamespace.
 */
export interface StorageNamespace {
  /**
   * Transform a logical path (e.g. "inspections/abc/photo.jpg") into the
   * actual object key that will be stored in the bucket.
   */
  scope(path: string): string;
  /**
   * Reverse a scoped key back to the logical path, for display/linking.
   */
  unscope(key: string): string;
}

/** No-op namespace — keys are stored as-is (single-tenant default). */
export const IdentityNamespace: StorageNamespace = {
  scope: (path) => path,
  unscope: (key) => key,
};

/** Company-scoped namespace used by ReadyLoq multi-tenant. */
export function companyNamespace(companyId: string): StorageNamespace {
  const prefix = `companies/${companyId}/`;
  return {
    scope: (path) => `${prefix}${path}`,
    unscope: (key) => (key.startsWith(prefix) ? key.slice(prefix.length) : key),
  };
}

// ─── Upload options ───────────────────────────────────────────────────────────

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
  /** Scoped object key (as stored in the bucket). */
  key: string;
  /** Public or CDN URL to reference the object. */
  url: string;
  /** Byte size confirmed by the sidecar response, if available. */
  sizeBytes?: number;
}

// ─── Download / URL options ───────────────────────────────────────────────────

export interface PresignedUrlOptions {
  /** Expiry in seconds (sidecar default: 3600). */
  expiresIn?: number;
}

// ─── Service interface ────────────────────────────────────────────────────────

/**
 * Platform object storage service.
 *
 * Usage (ReadyLoq multi-tenant):
 *   const storage = new ObjectStorageService({ namespace: companyNamespace(companyId) });
 *   await storage.upload("inspections/123/photo.jpg", { contentType: "image/jpeg", body: uri });
 *
 * Usage (VYBE single-tenant):
 *   const storage = new ObjectStorageService();
 *   await storage.upload("streams/abc/thumbnail.jpg", { contentType: "image/jpeg", body: buffer });
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
  list(prefix: string): Promise<Array<{ key: string; sizeBytes: number; lastModified: string }>>;
}
