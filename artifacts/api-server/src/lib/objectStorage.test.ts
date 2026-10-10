import { createHash } from "crypto";
import { Readable, Writable } from "stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { objectStorageClient, ObjectStorageService } from "./objectStorage";

function notFound() {
  return Object.assign(new Error("not found"), { code: 404 });
}

describe("server-mediated inspection uploads", () => {
  const originalPrivateObjectDir = process.env.PRIVATE_OBJECT_DIR;
  const sidecarFetch = vi.fn();

  beforeEach(() => {
    process.env.PRIVATE_OBJECT_DIR = "/bucket/private";
    sidecarFetch.mockReset();
    vi.stubGlobal("fetch", sidecarFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (originalPrivateObjectDir === undefined) delete process.env.PRIVATE_OBJECT_DIR;
    else process.env.PRIVATE_OBJECT_DIR = originalPrivateObjectDir;
  });

  it("creates a company-scoped path without asking the unsupported sidecar signer", () => {
    const objectPath = new ObjectStorageService().createInspectionUploadPath(17);

    expect(objectPath).toMatch(/^\/objects\/companies\/17\/uploads\/[A-Za-z0-9-]+$/);
    expect(sidecarFetch).not.toHaveBeenCalled();
  });

  it("streams bounded bytes through GCS with CRC32C and a create-only generation precondition", async () => {
    const bytes = Buffer.from("inspection evidence");
    const md5 = createHash("md5").update(bytes).digest("base64");
    const written: Buffer[] = [];
    const createWriteStream = vi.fn(() => new Writable({
      write(chunk, _encoding, callback) {
        written.push(Buffer.from(chunk));
        callback();
      },
    }));
    const file = {
      getMetadata: vi.fn().mockRejectedValue(notFound()),
      createWriteStream,
    };
    const bucket = { file: vi.fn(() => file) };
    vi.spyOn(objectStorageClient, "bucket").mockReturnValue(bucket as never);

    const result = await new ObjectStorageService().uploadInspectionStream(
      17,
      "/objects/companies/17/uploads/test-object",
      Readable.from([bytes]),
      {
        contentType: "image/jpeg",
        expectedSize: bytes.length,
        checksum: { algorithm: "md5", value: md5 },
      },
    );

    expect(result).toBe("created");
    expect(Buffer.concat(written)).toEqual(bytes);
    expect(createWriteStream).toHaveBeenCalledWith(expect.objectContaining({
      resumable: false,
      validation: "crc32c",
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType: "image/jpeg" },
    }));
    expect(sidecarFetch).not.toHaveBeenCalled();
  });

  it("verifies bytes and existing metadata before treating a retry as successful", async () => {
    const bytes = Buffer.from("same evidence");
    const md5 = createHash("md5").update(bytes).digest("base64");
    const file = {
      getMetadata: vi.fn().mockResolvedValue([{
        size: bytes.length,
        contentType: "image/jpeg",
        md5Hash: md5,
      }]),
      createWriteStream: vi.fn(),
    };
    vi.spyOn(objectStorageClient, "bucket").mockReturnValue({
      file: vi.fn(() => file),
    } as never);

    const result = await new ObjectStorageService().uploadInspectionStream(
      17,
      "/objects/companies/17/uploads/test-object",
      Readable.from([bytes]),
      { contentType: "image/jpeg", expectedSize: bytes.length },
    );

    expect(result).toBe("already-exists");
    expect(file.createWriteStream).not.toHaveBeenCalled();
  });

  it("does not accept a 412 retry whose existing object digest differs", async () => {
    const bytes = Buffer.from("retry payload");
    const differentMd5 = createHash("md5").update("different").digest("base64");
    const file = {
      getMetadata: vi.fn()
        .mockRejectedValueOnce(notFound())
        .mockResolvedValueOnce([{
          size: bytes.length,
          contentType: "image/jpeg",
          md5Hash: differentMd5,
        }]),
      createWriteStream: vi.fn(() => new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
        final(callback) {
          callback(Object.assign(new Error("precondition failed"), { code: 412 }));
        },
      })),
    };
    vi.spyOn(objectStorageClient, "bucket").mockReturnValue({
      file: vi.fn(() => file),
    } as never);

    await expect(new ObjectStorageService().uploadInspectionStream(
      17,
      "/objects/companies/17/uploads/test-object",
      Readable.from([bytes]),
      { contentType: "image/jpeg", expectedSize: bytes.length },
    )).rejects.toMatchObject({ code: 412 });
  });

  it("walks every object-storage page instead of reporting only the first page", async () => {
    const getFiles = vi.fn()
      .mockResolvedValueOnce([
        [{ name: "private/companies/17/uploads/first" }],
        { pageToken: "next-page" },
        {},
      ])
      .mockResolvedValueOnce([
        [{ name: "private/companies/17/uploads/second" }],
        {},
        {},
      ]);
    vi.spyOn(objectStorageClient, "bucket").mockReturnValue({ getFiles } as never);

    const result = await new ObjectStorageService().listCompanyUploadObjects(17, 1);

    expect(result).toEqual({
      objectPaths: [
        "/objects/companies/17/uploads/first",
        "/objects/companies/17/uploads/second",
      ],
      truncated: false,
    });
    expect(getFiles).toHaveBeenCalledTimes(2);
    expect(getFiles.mock.calls[1][0]).toMatchObject({ pageToken: "next-page" });
  });

  it("accepts the SDK's null next-page query on the final object page", async () => {
    const getFiles = vi.fn().mockResolvedValue([
      [{ name: "private/companies/17/uploads/last-page" }],
      null,
      {},
    ]);
    vi.spyOn(objectStorageClient, "bucket").mockReturnValue({ getFiles } as never);

    const result = await new ObjectStorageService().listCompanyUploadObjects(17, 1);

    expect(result).toEqual({
      objectPaths: ["/objects/companies/17/uploads/last-page"],
      truncated: false,
    });
    expect(getFiles).toHaveBeenCalledTimes(1);
  });
});