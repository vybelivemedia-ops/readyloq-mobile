import { describe, expect, it, vi } from "vitest";
import { decode as jpegDecode, encode as jpegEncode } from "jpeg-js";

vi.mock("expo-crypto", () => ({ randomUUID: () => "privacy-test-id" }));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  EncodingType: { Base64: "base64" },
  readAsStringAsync: vi.fn(),
  writeAsStringAsync: vi.fn(),
  deleteAsync: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("expo-image-manipulator", () => ({
  manipulateAsync: vi.fn(),
  SaveFormat: { JPEG: "jpeg" },
}));

import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import {
  createSanitizedPhotoCopy,
  removeLocationMetadata,
  stripJpegMetadata,
} from "../image-sanitizer";

function segment(marker: number, payload: string): number[] {
  const bytes = Array.from(payload, (char) => char.charCodeAt(0));
  const length = bytes.length + 2;
  return [0xff, marker, (length >> 8) & 255, length & 255, ...bytes];
}

function jpegWithLocationMetadata(): Uint8Array {
  const cleanJpeg = jpegEncode({
    width: 3,
    height: 2,
    data: new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
      255, 255, 0, 255, 255, 0, 255, 255, 255, 255, 255, 255,
    ]),
  }, 90).data;
  const metadata = [
    ...segment(0xe1, "Exif\0\0GPSLatitude=37.421998;GPSLongitude=-122.084"),
    ...segment(0xe1, "http://ns.adobe.com/xap/1.0/\0<GPSLatitude>37.4</GPSLatitude>"),
    ...segment(0xed, "IPTC Location: private-address"),
    ...segment(0xed, "Photoshop 3.0\0IPTC City=private-city"),
    ...segment(0xfe, "Private GPS camera comment"),
  ];
  return new Uint8Array([
    ...cleanJpeg.subarray(0, 2),
    ...metadata,
    ...cleanJpeg.subarray(2),
  ]);
}

function metadataMarkers(jpeg: Uint8Array): number[] {
  const markers: number[] = [];
  let position = 2;
  while (position < jpeg.length) {
    if (jpeg[position] !== 0xff) throw new Error("Invalid JPEG marker stream");
    while (jpeg[position] === 0xff) position++;
    const marker = jpeg[position++];
    if (marker === 0xda) break;
    if (marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    const length = (jpeg[position] << 8) | jpeg[position + 1];
    if (marker >= 0xe0 && marker <= 0xef || marker === 0xfe) markers.push(marker);
    position += length;
  }
  return markers;
}

describe("mobile photo privacy sanitizer", () => {
  it("writes a durable sanitized JPEG from the native re-encode result", async () => {
    const source = jpegWithLocationMetadata();
    const manipulatedUri = "file:///cache/reencoded.jpg";
    vi.mocked(ImageManipulator.manipulateAsync).mockResolvedValue({
      uri: manipulatedUri,
      width: 3,
      height: 2,
    });
    vi.mocked(FileSystem.readAsStringAsync).mockResolvedValue(
      Buffer.from(source).toString("base64"),
    );

    const resultUri = await createSanitizedPhotoCopy("file:///camera/source.jpg");

    expect(ImageManipulator.manipulateAsync).toHaveBeenCalledWith(
      "file:///camera/source.jpg",
      [],
      { compress: 1, format: ImageManipulator.SaveFormat.JPEG },
    );
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledOnce();
    const [writtenUri, writtenBase64, options] = vi.mocked(FileSystem.writeAsStringAsync).mock.calls[0];
    expect(writtenUri).toBe(resultUri);
    expect(options?.encoding).toBe(FileSystem.EncodingType.Base64);

    const writtenBytes = new Uint8Array(Buffer.from(writtenBase64, "base64"));
    expect(metadataMarkers(writtenBytes)).toEqual([]);
    expect(new TextDecoder().decode(writtenBytes)).not.toMatch(/GPSLatitude|GPSLongitude|Photoshop 3\.0|Private GPS/);
    const decoded = jpegDecode(writtenBytes, { useTArray: true });
    expect([decoded.width, decoded.height]).toEqual([3, 2]);
    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(manipulatedUri, { idempotent: true });
  });

  it("strips EXIF GPS, XMP, and IPTC segments while retaining a decodable JPEG", () => {
    const source = jpegWithLocationMetadata();
    const sanitized = stripJpegMetadata(source);
    const decoded = jpegDecode(sanitized, { useTArray: true });

    expect(metadataMarkers(source)).toEqual(expect.arrayContaining([0xe1, 0xe1, 0xed, 0xed, 0xfe]));
    expect(metadataMarkers(sanitized)).toEqual([]);
    expect(decoded.width).toBe(3);
    expect(decoded.height).toBe(2);
    expect(decoded.data.length).toBeGreaterThan(0);
    expect(new TextDecoder().decode(sanitized)).not.toMatch(/GPSLatitude|GPSLongitude|Photoshop 3\.0|Private GPS/);
  });

  it("removes nested location JSON keys without dropping measurement calibration", () => {
    const safe = removeLocationMetadata({
      providerId: "media-import",
      FocalLenIn35mmFilm: 26,
      PixelXDimension: 4032,
      location: "room 12",
      gpsLatitude: 37.4,
      metadata: {
        laserMeasurement: { value: 14, unit: "mm" },
        GPSInfo: { GPSLongitude: -122.08 },
        deviceLocation: { coordinates: { latitude: 37.4, longitude: -122.08 } },
      },
    });

    expect(safe).toEqual({
      providerId: "media-import",
      FocalLenIn35mmFilm: 26,
      PixelXDimension: 4032,
      metadata: {
        laserMeasurement: { value: 14, unit: "mm" },
      },
    });
    expect(JSON.stringify(safe)).not.toMatch(/gps|latitude|longitude|coordinates|location/i);
  });

  it("removes GPS nested inside laserMeasurement metadata", () => {
    const captureMetadata = removeLocationMetadata({
      laserMeasurement: {
        kind: "distance",
        value: 14,
        unit: "mm",
        metadata: {
          deviceId: "laser-1",
          gps: { latitude: 37.4, longitude: -122.08 },
        },
      },
    });

    expect(captureMetadata).toEqual({
      laserMeasurement: {
        kind: "distance",
        value: 14,
        unit: "mm",
        metadata: { deviceId: "laser-1" },
      },
    });
    expect(JSON.stringify(captureMetadata)).not.toMatch(/gps|latitude|longitude/i);
  });
});