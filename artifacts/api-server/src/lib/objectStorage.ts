import { Storage, File } from "@google-cloud/storage";
import { Readable, Transform, Writable } from "stream";
import { createHash, randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  getObjectAclPolicy,
  setObjectAclPolicy,
} from "./objectAcl";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class InspectionUploadConstraintError extends Error {
  closeConnection: boolean;
  constructor(message: string, closeConnection = false) {
    super(message);
    this.name = "InspectionUploadConstraintError";
    this.closeConnection = closeConnection;
    Object.setPrototypeOf(this, InspectionUploadConstraintError.prototype);
  }
}

export class InspectionUploadTimeoutError extends Error {
  closeConnection = true;
  constructor(message: string) {
    super(message);
    this.name = "InspectionUploadTimeoutError";
    Object.setPrototypeOf(this, InspectionUploadTimeoutError.prototype);
  }
}

export interface InspectionUploadConstraints {
  contentType: string;
  expectedSize: number;
  checksum?: { algorithm: "md5"; value: string };
}

const MAX_INSPECTION_UPLOAD_SIZE = 150 * 1024 * 1024;
const INSPECTION_UPLOAD_TIMEOUT_MS = 15 * 60 * 1000;

export class ObjectStorageService {
  constructor() {}

  getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((path) => path.trim())
          .filter((path) => path.length > 0)
      )
    );
    if (paths.length === 0) {
      throw new Error(
        "PUBLIC_OBJECT_SEARCH_PATHS not set. Create a bucket in 'Object Storage' " +
          "tool and set PUBLIC_OBJECT_SEARCH_PATHS env var (comma-separated paths)."
      );
    }
    return paths;
  }

  getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }
    return dir;
  }

  async searchPublicObject(filePath: string): Promise<File | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const fullPath = `${searchPath}/${filePath}`;

      const { bucketName, objectName } = parseObjectPath(fullPath);
      const bucket = objectStorageClient.bucket(bucketName);
      const file = bucket.file(objectName);

      const [exists] = await file.exists();
      if (exists) {
        return file;
      }
    }

    return null;
  }

  async downloadObject(file: File, cacheTtlSec: number = 3600): Promise<Response> {
    const [metadata] = await file.getMetadata();
    const aclPolicy = await getObjectAclPolicy(file);
    const isPublic = aclPolicy?.visibility === "public";

    const nodeStream = file.createReadStream();
    const webStream = Readable.toWeb(nodeStream) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": (metadata.contentType as string) || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (metadata.size) {
      headers["Content-Length"] = String(metadata.size);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(companyId: number): Promise<string> {
    const privateObjectDir = this.getPrivateObjectDir();
    if (!privateObjectDir) {
      throw new Error(
        "PRIVATE_OBJECT_DIR not set. Create a bucket in 'Object Storage' " +
          "tool and set PRIVATE_OBJECT_DIR env var."
      );
    }

    // Namespace uploads under the caller's company. The company id encoded in
    // the object path is the tenant boundary enforced at serve time, so a URL
    // from one company can never be read by another (see objectPathCompanyScope).
    const objectId = randomUUID();
    const fullPath = `${privateObjectDir}/companies/${companyId}/uploads/${objectId}`;

    const { bucketName, objectName } = parseObjectPath(fullPath);

    return signObjectURL({
      bucketName,
      objectName,
      method: "PUT",
      ttlSec: 900,
    });
  }

  createInspectionUploadPath(companyId: number): string {
    return `/objects/companies/${companyId}/uploads/${randomUUID()}`;
  }

  async uploadInspectionStream(
    companyId: number,
    objectPath: string,
    input: Readable,
    constraints: InspectionUploadConstraints,
  ): Promise<"created" | "already-exists"> {
    if (
      !Number.isSafeInteger(constraints.expectedSize) ||
      constraints.expectedSize <= 0 ||
      constraints.expectedSize > MAX_INSPECTION_UPLOAD_SIZE
    ) {
      throw new InspectionUploadConstraintError("Upload size is outside the supported limit");
    }
    const expectedPrefix = `/objects/companies/${companyId}/uploads/`;
    const objectId = objectPath.startsWith(expectedPrefix)
      ? objectPath.slice(expectedPrefix.length)
      : "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(objectId)) {
      throw new ObjectNotFoundError();
    }
    const file = this.getObjectEntityFileHandle(objectPath);
    const verifyExisting = async (actualMd5?: string): Promise<void> => {
      const metadata = await this.getObjectEntityMetadata(objectPath);
      const contentType = metadata.contentType?.split(";")[0].trim().toLowerCase();
      if (
        metadata.size !== constraints.expectedSize ||
        contentType !== constraints.contentType ||
        !actualMd5 ||
        metadata.md5Hash !== actualMd5 ||
        (constraints.checksum && metadata.md5Hash !== constraints.checksum.value)
      ) {
        const error = new Error("An object already exists with different upload metadata");
        Object.assign(error, { code: 412 });
        throw error;
      }
    };

    const md5 = createHash("md5");
    let receivedSize = 0;
    let actualMd5: string | undefined;
    const validate = new Transform({
      transform(chunk: Buffer | string, _encoding, callback) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        receivedSize += bytes.length;
        if (receivedSize > constraints.expectedSize) {
          callback(new InspectionUploadConstraintError("Upload body exceeds reserved size", true));
          return;
        }
        md5.update(bytes);
        callback(null, bytes);
      },
      flush(callback) {
        if (receivedSize !== constraints.expectedSize) {
          callback(new InspectionUploadConstraintError("Upload body does not match reserved size"));
          return;
        }
        actualMd5 = md5.digest("base64");
        if (constraints.checksum && actualMd5 !== constraints.checksum.value) {
          callback(new InspectionUploadConstraintError("Upload body does not match reserved MD5"));
          return;
        }
        callback();
      },
    });
    const pump = async (destination: Writable): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        let settled = false;
        let timeout: ReturnType<typeof setTimeout>;
        const cleanup = () => {
          clearTimeout(timeout);
          input.removeListener("error", fail);
          input.removeListener("close", onClose);
          validate.removeListener("error", fail);
          destination.removeListener("error", fail);
        };
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          input.unpipe(validate);
          validate.unpipe(destination);
          validate.destroy();
          if (!destination.destroyed) destination.destroy();
          if (
            (error instanceof InspectionUploadConstraintError && error.closeConnection) ||
            error instanceof InspectionUploadTimeoutError
          ) {
            input.pause();
          } else {
            input.resume();
          }
          reject(error);
        };
        const onClose = () => {
          if (!input.readableEnded) fail(new InspectionUploadConstraintError("Upload stream closed early"));
        };
        timeout = setTimeout(
          () => fail(new InspectionUploadTimeoutError("Inspection upload timed out")),
          INSPECTION_UPLOAD_TIMEOUT_MS,
        );
        timeout.unref?.();
        input.once("error", fail);
        input.once("close", onClose);
        validate.once("error", fail);
        destination.once("error", fail);
        destination.once("finish", () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        });
        input.pipe(validate).pipe(destination);
      });

    let objectAlreadyExists = false;
    try {
      await this.getObjectEntityMetadata(objectPath);
      objectAlreadyExists = true;
    } catch (error) {
      if (!(error instanceof ObjectNotFoundError)) throw error;
    }

    if (objectAlreadyExists) {
      await pump(new Writable({ write(_chunk, _encoding, callback) { callback(); } }));
      await verifyExisting(actualMd5);
      return "already-exists";
    }

    try {
      const writer = file.createWriteStream({
        resumable: false,
        validation: "crc32c",
        timeout: INSPECTION_UPLOAD_TIMEOUT_MS,
        metadata: { contentType: constraints.contentType },
        preconditionOpts: { ifGenerationMatch: 0 },
      });
      await pump(writer);
      return "created";
    } catch (error) {
      if (storageErrorCode(error) === 412) {
        await verifyExisting(actualMd5);
        return "already-exists";
      }
      throw error;
    }
  }

  async getObjectEntityFile(objectPath: string): Promise<File> {
    const objectFile = this.getObjectEntityFileHandle(objectPath);
    const [exists] = await objectFile.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    return objectFile;
  }

  async getObjectEntityMetadata(objectPath: string): Promise<{
    size: number;
    contentType: string | null;
    md5Hash: string | null;
  }> {
    const objectFile = this.getObjectEntityFileHandle(objectPath);
    try {
      const [metadata] = await objectFile.getMetadata();
      const size = Number(metadata.size);
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new Error("Storage object returned an invalid size");
      }
      return {
        size,
        contentType: typeof metadata.contentType === "string" ? metadata.contentType : null,
        md5Hash: typeof metadata.md5Hash === "string" ? metadata.md5Hash : null,
      };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        Number((error as { code: unknown }).code) === 404
      ) {
        throw new ObjectNotFoundError();
      }
      throw error;
    }
  }

  async listCompanyUploadObjects(
    companyId: number,
    pageSize = 500,
  ): Promise<{ objectPaths: string[]; truncated: boolean }> {
    let privateDir = this.getPrivateObjectDir();
    if (privateDir.endsWith("/")) privateDir = privateDir.slice(0, -1);
    const { bucketName, objectName } = parseObjectPath(
      `${privateDir}/companies/${companyId}/uploads`,
    );
    const prefix = `${objectName}/`;
    const bucket = objectStorageClient.bucket(bucketName);
    const objectPaths: string[] = [];
    let pageToken: string | undefined;
    do {
      const [files, nextQuery] = await bucket.getFiles({
        prefix,
        maxResults: pageSize,
        autoPaginate: false,
        ...(pageToken ? { pageToken } : {}),
      });
      objectPaths.push(
        ...files.map((file) =>
          `/objects/companies/${companyId}/uploads/${file.name.slice(prefix.length)}`,
        ),
      );
      pageToken = nextQuery?.pageToken;
    } while (pageToken);
    return {
      objectPaths,
      truncated: false,
    };
  }

  /**
   * Return the object handle after validating its canonical entity path.
   *
   * This deliberately does not call exists(). Callers that are going to read
   * the object can let the read establish existence, avoiding a separate
   * unbounded metadata request before the bounded read.
   */
  getObjectEntityFileHandle(objectPath: string): File {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split("/");
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const entityId = parts.slice(1).join("/");
    let entityDir = this.getPrivateObjectDir();
    if (!entityDir.endsWith("/")) {
      entityDir = `${entityDir}/`;
    }
    const objectEntityPath = `${entityDir}${entityId}`;
    const { bucketName, objectName } = parseObjectPath(objectEntityPath);
    return objectStorageClient.bucket(bucketName).file(objectName);
  }

  normalizeObjectEntityPath(rawPath: string): string {
    if (!rawPath.startsWith("https://storage.googleapis.com/")) {
      return rawPath;
    }

    const url = new URL(rawPath);
    const rawObjectPath = url.pathname;

    let objectEntityDir = this.getPrivateObjectDir();
    if (!objectEntityDir.endsWith("/")) {
      objectEntityDir = `${objectEntityDir}/`;
    }

    if (!rawObjectPath.startsWith(objectEntityDir)) {
      return rawObjectPath;
    }

    const entityId = rawObjectPath.slice(objectEntityDir.length);
    return `/objects/${entityId}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith("/")) {
      return normalizedPath;
    }

    const objectFile = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(objectFile, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: File;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }

  /**
   * Upload a raw buffer directly to object storage from the server side.
   * Returns the normalized `/objects/companies/<id>/uploads/<uuid>` path that
   * can be stored in the DB and later served via signed-URL or object endpoints.
   *
   * Use this when a server-side process (e.g. a webhook) receives binary data
   * and needs to persist it without a round-trip presigned URL.
   */
  async uploadObjectBuffer(
    companyId: number,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    const objectId = randomUUID();
    // Derive GCS bucket + object from the private dir + company namespace.
    const entityDir = this.getPrivateObjectDir();
    const entityId = `companies/${companyId}/uploads/${objectId}`;
    const fullGcsPath = `${entityDir}/${entityId}`;
    const { bucketName, objectName } = parseObjectPath(fullGcsPath);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    await file.save(buffer, { contentType, resumable: false });
    // Return the canonical /objects/… path (mirrors normalizeObjectEntityPath output).
    return `/objects/${entityId}`;
  }

  /** Reports are immutable, company/report-scoped private objects, never public URLs. */
  async uploadReportPdf(companyId: number, reportId: number, buffer: Buffer, sourceHash: string): Promise<string> {
    if (!buffer.subarray(0, 5).equals(Buffer.from("%PDF-")) || buffer.length < 1024) {
      throw new Error("Refusing to store an empty or invalid report PDF");
    }
    if (!/^[0-9a-f]{64}$/.test(sourceHash)) throw new Error("Invalid report source fingerprint");
    const objectPath = `/objects/companies/${companyId}/reports/${reportId}/${randomUUID()}-${sourceHash}.pdf`;
    const file = this.getObjectEntityFileHandle(objectPath);
    await file.save(buffer, {
      contentType: "application/pdf",
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
    });
    // Verify the stored bytes before publishing the path to customers. A
    // successful upload response alone does not prove that the object is usable.
    const [stored] = await file.download();
    if (stored.length !== buffer.length ||
        createHash("sha256").update(stored).digest("hex") !== createHash("sha256").update(buffer).digest("hex")) {
      throw new Error("Stored report PDF did not match the generated bytes");
    }
    return objectPath;
  }

  async downloadReportPdf(companyId: number, reportId: number, objectPath: string): Promise<Buffer> {
    const expectedPrefix = `/objects/companies/${companyId}/reports/${reportId}/`;
    if (!objectPath.startsWith(expectedPrefix) ||
         !/^[0-9a-f-]{36}-[0-9a-f]{64}\.pdf$/.test(objectPath.slice(expectedPrefix.length))) {
      throw new ObjectNotFoundError();
    }
    const file = await this.getObjectEntityFile(objectPath);
    const [buffer] = await file.download();
    if (buffer.length < 1024 || !buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new Error("Stored report PDF is invalid");
    }
    return buffer;
  }
}

function parseObjectPath(path: string): {
  bucketName: string;
  objectName: string;
} {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }

  const bucketName = pathParts[1];
  const objectName = pathParts.slice(2).join("/");

  return {
    bucketName,
    objectName,
  };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  // Replit's signer endpoint currently ignores request fields for query
  // parameters and extension headers. Keep this helper for generic legacy
  // uploads only; inspection evidence is written through uploadInspectionStream
  // where GCS itself enforces the create-only precondition.
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(30_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, ` +
        `make sure you're running on Replit`
    );
  }

  const { signed_url: signedURL } = (await response.json()) as { signed_url: string };
  return signedURL;
}

function storageErrorCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = Number((error as { code: unknown }).code);
  return Number.isInteger(code) ? code : undefined;
}

/**
 * Determine which company an object entity path belongs to, based on its
 * namespaced prefix. New uploads live under `companies/{id}/...`; objects
 * created before multi-tenancy have no company segment and map to the legacy
 * company (only legacy-company members may read them).
 *
 * Example: "/objects/companies/5/uploads/abc" -> 5; "/objects/uploads/abc" -> "legacy".
 */
export function objectPathCompanyScope(objectPath: string): number | "legacy" {
  const withoutPrefix = objectPath.replace(/^\/objects\//, "");
  const parts = withoutPrefix.split("/");
  if (parts[0] === "companies" && parts.length >= 2) {
    const cid = Number(parts[1]);
    if (Number.isInteger(cid) && cid > 0) return cid;
  }
  return "legacy";
}
