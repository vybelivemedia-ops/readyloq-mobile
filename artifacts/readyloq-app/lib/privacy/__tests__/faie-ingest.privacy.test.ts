import { beforeEach, describe, expect, it, vi } from "vitest";
import { decode as jpegDecode, encode as jpegEncode } from "jpeg-js";

const fsState = vi.hoisted(() => ({
  files: new Map<string, string>(),
  downloadAsync: vi.fn(),
  readAsStringAsync: vi.fn(),
  writeAsStringAsync: vi.fn(),
  deleteAsync: vi.fn(),
}));

vi.mock("expo-crypto", () => ({ randomUUID: () => "remote-privacy-test-id" }));
vi.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "file:///cache/",
  documentDirectory: "file:///documents/",
  EncodingType: { Base64: "base64" },
  downloadAsync: fsState.downloadAsync,
  readAsStringAsync: fsState.readAsStringAsync,
  writeAsStringAsync: fsState.writeAsStringAsync,
  deleteAsync: fsState.deleteAsync,
}));
vi.mock("expo-image-manipulator", () => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { JPEG: "jpeg" },
}));
vi.mock("@/lib/api", () => ({ API_BASE: "https://readyloq.example" }));

import * as ImageManipulator from "expo-image-manipulator";
import { ingestAllUploadedPhotos, sendPhotoToFaieDataset, ingestAnonymizedFaieData } from "../../faie-ingest";

function segment(marker: number, payload: string): number[] {
  const bytes = Array.from(payload, (character) => character.charCodeAt(0));
  const length = bytes.length + 2;
  return [0xff, marker, (length >> 8) & 255, length & 255, ...bytes];
}

function remoteJpegWithGps(): Uint8Array {
  const clean = jpegEncode({
    width: 3,
    height: 2,
    data: new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
      255, 255, 0, 255, 255, 0, 255, 255, 255, 255, 255, 255,
    ]),
  }, 90).data;
  const exif = segment(0xe1, "Exif\0\0GPSLatitude=37.421998;GPSLongitude=-122.084");
  return new Uint8Array([...clean.subarray(0, 2), ...exif, ...clean.subarray(2)]);
}

describe("remote photo FAIE privacy boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsState.files.clear();
    fsState.downloadAsync.mockImplementation(async (_remote: string, local: string) => ({
      uri: local,
      status: 200,
    }));
    fsState.readAsStringAsync.mockImplementation(async (uri: string) => {
      if (uri === "file:///cache/faie-source-remote-privacy-test-id") {
        return Buffer.from(remoteJpegWithGps()).toString("base64");
      }
      return fsState.files.get(uri) ?? "";
    });
    fsState.writeAsStringAsync.mockImplementation(async (uri: string, data: string) => {
      fsState.files.set(uri, data);
    });
    fsState.deleteAsync.mockResolvedValue(undefined);
  });

  it("sanitizes a downloaded existing remote JPEG before encoding it into the FAIE request", async () => {
    const manipulatedUri = "file:///cache/native-reencoded.jpg";
    vi.mocked(ImageManipulator.manipulateAsync).mockResolvedValue({
      uri: manipulatedUri,
      width: 3,
      height: 2,
    });
    fsState.readAsStringAsync.mockImplementation(async (uri: string) => {
      if (uri === "file:///cache/faie-source-remote-privacy-test-id" || uri === manipulatedUri) {
        return Buffer.from(remoteJpegWithGps()).toString("base64");
      }
      return fsState.files.get(uri) ?? "";
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
    });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await ingestAllUploadedPhotos({
        getToken: async () => "test-auth-token",
        photoUri: "/api/storage/previously-uploaded.jpg",
        companyId: "company-test",
        technicianId: "technician-test",
      });

      expect(fsState.downloadAsync).toHaveBeenCalledOnce();
      expect(fsState.downloadAsync.mock.calls[0][2]).toEqual({
        headers: { Authorization: "Bearer test-auth-token" },
      });
      expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
        "file:///cache/faie-source-remote-privacy-test-id",
        [],
        { compress: 1, format: ImageManipulator.SaveFormat.JPEG },
      );
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0][0]).toBe("https://readyloq.example/api/v1/faie/training/ingest-global");
      expect(fetchMock.mock.calls[0][1]?.headers.Authorization).toBe("Bearer test-auth-token");

      const postedBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { imageBytes: string };
      const sanitizedBytes = new Uint8Array(Buffer.from(postedBody.imageBytes, "base64"));
      expect(new TextDecoder().decode(sanitizedBytes)).not.toMatch(/GPSLatitude|GPSLongitude/);
      const decoded = jpegDecode(sanitizedBytes, { useTArray: true });
      expect([decoded.width, decoded.height]).toEqual([3, 2]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it.each(["dataset", "global", "anonymized"])("skips unsigned %s training without touching evidence", async (kind) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const base = { photoUri: "file:///saved-inspection-photo.jpg", getToken: async () => null };
      if (kind === "dataset") await sendPhotoToFaieDataset({ ...base, findingId: 1, label: "Ants", confidence: 0.9 });
      if (kind === "global") await ingestAllUploadedPhotos({ ...base, technicianId: "test-tech" });
      if (kind === "anonymized") await ingestAnonymizedFaieData({
        ...base, pestOrDefectCategory: "Ants", visualConfidence: 0.9, structuralContext: "Kitchen",
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(fsState.downloadAsync).not.toHaveBeenCalled();
      expect(fsState.readAsStringAsync).not.toHaveBeenCalled();
      expect(fsState.deleteAsync).not.toHaveBeenCalled();
    } finally {
      warning.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});