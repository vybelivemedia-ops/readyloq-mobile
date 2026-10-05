import { beforeEach, describe, expect, it, vi } from "vitest";

const { uploadAsync, getInfoAsync, requestUploadUrl } = vi.hoisted(() => ({
  uploadAsync: vi.fn(),
  getInfoAsync: vi.fn(),
  requestUploadUrl: vi.fn(),
}));

vi.mock("expo-file-system/legacy", () => ({
  uploadAsync,
  getInfoAsync,
  deleteAsync: vi.fn(),
  FileSystemUploadType: { BINARY_CONTENT: 0 },
}));

vi.mock("./api", () => ({
  API_BASE: "https://api.example.test",
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  requestUploadUrl,
}));

vi.mock("./privacy/image-sanitizer", () => ({
  createSanitizedPhotoCopy: vi.fn(async (uri: string) => uri),
}));

import { doUpload, reserveUploadPath } from "./upload";

describe("create-only inspection upload client", () => {
  beforeEach(() => {
    uploadAsync.mockReset().mockResolvedValue({ status: 200 });
    getInfoAsync.mockReset().mockResolvedValue({ exists: true, size: 1024 });
    requestUploadUrl.mockReset().mockResolvedValue({
      uploadURL: "/api/storage/uploads/intents/9/content",
      objectPath: "/objects/companies/17/uploads/photo",
      uploadIntentId: 9,
    });
  });

  it("reserves exact inspection metadata with the durable client key", async () => {
    const result = await reserveUploadPath(
      "test-token",
      42,
      "stable-photo-operation",
      "photo.jpg",
      "file:///photo.jpg",
      "IMAGE/JPEG; charset=binary",
      "image",
    );

    expect(requestUploadUrl).toHaveBeenCalledWith("test-token", {
      name: "photo.jpg",
      size: 1024,
      contentType: "image/jpeg",
      purpose: "inspection-evidence",
      inspectionId: 42,
      mediaType: "image",
      clientKey: "stable-photo-operation",
    });
    expect(result).toMatchObject({
      uploadURL: "https://api.example.test/api/storage/uploads/intents/9/content",
      uploadIntentId: 9,
      expectedSize: 1024,
      storagePath: "/api/storage/objects/companies/17/uploads/photo",
    });
  });

  it("sends bearer auth, the create-only precondition, size, and optional MD5", async () => {
    await doUpload(
      "https://api.example.test/api/storage/uploads/intents/9/content",
      "file:///photo.jpg",
      "image/jpeg",
      1024,
      { algorithm: "md5", value: "AAAAAAAAAAAAAAAAAAAAAA==" },
      "test-token",
    );

    expect(uploadAsync).toHaveBeenCalledWith(
      "https://api.example.test/api/storage/uploads/intents/9/content",
      "file:///photo.jpg",
      expect.objectContaining({
        httpMethod: "PUT",
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Length": "1024",
          "Content-MD5": "AAAAAAAAAAAAAAAAAAAAAA==",
          "x-goog-if-generation-match": "0",
          Authorization: "Bearer test-token",
        },
      }),
    );
  });

  it("surfaces GCS precondition failure instead of retrying an overwrite", async () => {
    uploadAsync
      .mockResolvedValueOnce({ status: 200 })
      .mockResolvedValueOnce({ status: 412 });
    const args = [
      "https://api.example.test/api/storage/uploads/intents/9/content",
      "file:///photo.jpg",
      "image/jpeg",
      1024,
    ] as const;

    await doUpload(...args);
    await expect(doUpload(...args)).rejects.toThrow("Evidence upload failed (412).");
    expect(uploadAsync).toHaveBeenCalledTimes(2);
    expect(uploadAsync.mock.calls[1][2]).toMatchObject({
      headers: { "x-goog-if-generation-match": "0", "Content-Length": "1024" },
    });
  });
});