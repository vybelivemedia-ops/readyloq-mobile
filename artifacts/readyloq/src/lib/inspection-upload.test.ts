import { describe, expect, it, vi } from "vitest";
import { uploadInspectionEvidence } from "./inspection-upload";

describe("uploadInspectionEvidence", () => {
  it("reserves with inspection, type, stable retry key, exact bytes, then registers the returned intent", async () => {
    const blob = new Blob(["photo-bytes"], { type: "image/jpeg" });
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(blob))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        uploadURL: "/api/storage/uploads/intents/72/content",
        objectPath: "/objects/companies/14/uploads/photo-a.jpg",
        uploadIntentId: 72,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await uploadInspectionEvidence({
      url: "blob:captured-photo",
      filename: "inspection-12-photo-a.jpg",
      inspectionId: 12,
      mediaType: "photo",
      clientKey: "web-inspection-12-photo-a",
      fetcher,
    });

    const reservationRequest = fetcher.mock.calls[1][1]!;
    expect(JSON.parse(String(reservationRequest.body))).toEqual({
      name: "inspection-12-photo-a.jpg",
      size: blob.size,
      contentType: "image/jpeg",
      purpose: "inspection-evidence",
      inspectionId: 12,
      mediaType: "photo",
      clientKey: "web-inspection-12-photo-a",
    });
    expect(fetcher.mock.calls[2][0]).toBe("/api/storage/uploads/intents/72/content");
    expect(fetcher.mock.calls[2][1]?.headers).toEqual({
      "Content-Type": "image/jpeg",
      "x-goog-if-generation-match": "0",
    });
    expect(result).toEqual({
      path: "/api/storage/objects/companies/14/uploads/photo-a.jpg",
      uploadIntentId: 72,
    });
  });

  it("replays an already-registered intent without another PUT", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(new Blob(["photo"], { type: "image/jpeg" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        uploadURL: "",
        objectPath: "/objects/companies/14/uploads/photo-a.jpg",
        uploadIntentId: 72,
      }), { status: 200 }));

    const result = await uploadInspectionEvidence({
      url: "blob:captured-photo",
      filename: "photo.jpg",
      inspectionId: 12,
      mediaType: "photo",
      clientKey: "web-inspection-12-photo-a",
      fetcher,
    });

    expect(result.uploadIntentId).toBe(72);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("renews an upload reservation for an already-uploaded blob without uploading it twice", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(new Blob(["photo"], { type: "image/jpeg" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        uploadURL: "/api/storage/uploads/intents/72/content",
        objectPath: "/objects/companies/14/uploads/photo-a.jpg",
        uploadIntentId: 72,
      }), { status: 200 }));

    const result = await uploadInspectionEvidence({
      url: "blob:captured-photo",
      filename: "photo.jpg",
      inspectionId: 12,
      mediaType: "photo",
      clientKey: "web-inspection-12-photo-a",
      uploadBlob: false,
      fetcher,
    });

    expect(result.uploadIntentId).toBe(72);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not continue when reservation fails", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(new Blob(["photo"], { type: "image/jpeg" })))
      .mockResolvedValueOnce(new Response(null, { status: 409 }));

    await expect(uploadInspectionEvidence({
      url: "blob:captured-photo",
      filename: "photo.jpg",
      inspectionId: 12,
      mediaType: "photo",
      clientKey: "web-inspection-12-photo-a",
      fetcher,
    })).rejects.toThrow("Upload could not start (409).");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});