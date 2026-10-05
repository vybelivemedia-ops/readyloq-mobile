import { beforeEach, describe, expect, it, vi } from "vitest";

const { uploadAsync, getInfoAsync, requestUploadUrl } = vi.hoisted(() => ({
  uploadAsync: vi.fn(),
  getInfoAsync: vi.fn(),
  requestUploadUrl: vi.fn(),
}));

// Mock native modules before importing the upload client. This keeps Vitest
// from resolving React Native / Expo entry points containing Flow syntax.
vi.mock("expo-file-system/legacy", () => ({
  uploadAsync,
  getInfoAsync,
  deleteAsync: vi.fn(),
  FileSystemUploadType: { BINARY_CONTENT: 0 },
}));

vi.mock("../../api", () => ({
  API_BASE: "https://api.readyloq.test",
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  requestUploadUrl,
}));

vi.mock("../image-sanitizer", () => ({
  createSanitizedPhotoCopy: vi.fn(async (uri: string) => uri),
}));

import { doUpload, reserveUploadPath } from "../../upload";

describe("authenticated inspection upload intent client", () => {
  beforeEach(() => {
    uploadAsync.mockReset().mockResolvedValue({ status: 204 });
    getInfoAsync.mockReset().mockResolvedValue({ exists: true, size: 2048 });
    requestUploadUrl.mockReset().mockResolvedValue({
      uploadURL: "/api/storage/uploads/intents/912/content",
      objectPath: "/objects/companies/17/uploads/photo-intent-912",
      uploadIntentId: 912,
    });
  });

  it("retries the same intent path with bearer auth instead of a raw signed URL", async () => {
    const token = "clerk-session-token";
    const args = [
      token,
      42,
      "inspection-42-photo-stable-key",
      "photo.jpg",
      "file:///documents/photo.jpg",
      "image/jpeg",
      "image" as const,
    ] as const;

    const first = await reserveUploadPath(...args);
    await doUpload(
      first.uploadURL,
      args[4],
      "image/jpeg",
      first.expectedSize,
      first.checksum,
      token,
    );

    const retry = await reserveUploadPath(...args);
    await doUpload(
      retry.uploadURL,
      args[4],
      "image/jpeg",
      retry.expectedSize,
      retry.checksum,
      token,
    );

    expect(requestUploadUrl).toHaveBeenCalledTimes(2);
    expect(requestUploadUrl.mock.calls[0]).toEqual(requestUploadUrl.mock.calls[1]);
    expect(requestUploadUrl).toHaveBeenNthCalledWith(1, token, {
      name: "photo.jpg",
      size: 2048,
      contentType: "image/jpeg",
      purpose: "inspection-evidence",
      inspectionId: 42,
      mediaType: "image",
      clientKey: "inspection-42-photo-stable-key",
    });
    expect(first).toMatchObject({
      uploadIntentId: 912,
      storagePath: "/api/storage/objects/companies/17/uploads/photo-intent-912",
    });
    expect(retry).toMatchObject({
      uploadIntentId: first.uploadIntentId,
      storagePath: first.storagePath,
    });

    const authenticatedIntentEndpoint =
      "https://api.readyloq.test/api/storage/uploads/intents/912/content";
    expect(uploadAsync).toHaveBeenCalledTimes(2);
    for (const [url, _localUri, options] of uploadAsync.mock.calls) {
      expect(url).toBe(authenticatedIntentEndpoint);
      expect(url).not.toMatch(/storage\.googleapis\.com|signed/i);
      expect(options).toMatchObject({
        httpMethod: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "x-goog-if-generation-match": "0",
          "Content-Length": "2048",
        },
      });
    }
  });
});