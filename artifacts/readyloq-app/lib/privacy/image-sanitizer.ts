import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_LOOKUP = (() => {
  const lookup = new Uint8Array(256);
  for (let i = 0; i < BASE64_ALPHABET.length; i++) {
    lookup[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return lookup;
})();

function base64ToBytes(input: string): Uint8Array {
  const value = input.replace(/\s/g, "");
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const output = new Uint8Array(Math.max(0, (value.length * 3) / 4 - padding));
  let offset = 0;
  for (let i = 0; i < value.length; i += 4) {
    const a = BASE64_LOOKUP[value.charCodeAt(i)];
    const b = BASE64_LOOKUP[value.charCodeAt(i + 1)];
    const c = value[i + 2] === "=" ? 0 : BASE64_LOOKUP[value.charCodeAt(i + 2)];
    const d = value[i + 3] === "=" ? 0 : BASE64_LOOKUP[value.charCodeAt(i + 3)];
    const chunk = (a << 18) | (b << 12) | (c << 6) | d;
    if (offset < output.length) output[offset++] = (chunk >> 16) & 255;
    if (offset < output.length) output[offset++] = (chunk >> 8) & 255;
    if (offset < output.length) output[offset++] = chunk & 255;
  }
  return output;
}

function bytesToBase64(bytes: Uint8Array): string {
  let output = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const hasB = i + 1 < bytes.length;
    const hasC = i + 2 < bytes.length;
    const b = hasB ? bytes[i + 1] : 0;
    const c = hasC ? bytes[i + 2] : 0;
    output += BASE64_ALPHABET[a >> 2];
    output += BASE64_ALPHABET[((a & 3) << 4) | (b >> 4)];
    output += hasB ? BASE64_ALPHABET[((b & 15) << 2) | (c >> 6)] : "=";
    output += hasC ? BASE64_ALPHABET[c & 63] : "=";
  }
  return output;
}

/**
 * Remove every JPEG application/comment segment. Those segments carry EXIF
 * (including GPS), XMP and IPTC; stripping all APP markers is intentionally
 * stricter than trying to recognize individual metadata dialects.
 *
 * Image orientation is normalized by ImageManipulator before this runs, so
 * removing EXIF does not change displayed pixel orientation.
 */
export function stripJpegMetadata(input: Uint8Array): Uint8Array {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) {
    throw new Error("Photo privacy sanitization failed: image is not a JPEG.");
  }

  const output: Uint8Array[] = [input.subarray(0, 2)];
  let position = 2;
  let foundScan = false;
  let foundEnd = false;

  while (position < input.length) {
    const markerStart = position;
    if (input[position] !== 0xff) {
      throw new Error("Photo privacy sanitization failed: malformed JPEG marker stream.");
    }
    while (position < input.length && input[position] === 0xff) position++;
    if (position >= input.length) break;

    const marker = input[position++];
    if (marker === 0x00) {
      throw new Error("Photo privacy sanitization failed: malformed JPEG marker.");
    }

    if (marker === 0xd9) {
      output.push(input.subarray(markerStart, position));
      foundEnd = true;
      break;
    }

    // SOI, TEM and restart markers have no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      output.push(input.subarray(markerStart, position));
      continue;
    }

    if (position + 2 > input.length) {
      throw new Error("Photo privacy sanitization failed: truncated JPEG segment.");
    }
    const segmentLength = (input[position] << 8) | input[position + 1];
    const segmentEnd = position + segmentLength;
    if (segmentLength < 2 || segmentEnd > input.length) {
      throw new Error("Photo privacy sanitization failed: invalid JPEG segment length.");
    }

    const isMetadata = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) output.push(input.subarray(markerStart, segmentEnd));
    position = segmentEnd;

    if (marker === 0xda) {
      foundScan = true;
      const scanStart = position;
      // Skip entropy-coded scan data while respecting escaped FF bytes and
      // restart markers; continue parsing if the JPEG has another scan.
      while (position < input.length) {
        if (input[position] !== 0xff) {
          position++;
          continue;
        }
        let next = position + 1;
        while (next < input.length && input[next] === 0xff) next++;
        if (next >= input.length) break;
        const scanMarker = input[next];
        if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) {
          position = next + 1;
          continue;
        }
        break;
      }
      output.push(input.subarray(scanStart, position));
    }
  }

  if (!foundScan || !foundEnd) {
    throw new Error("Photo privacy sanitization failed: incomplete JPEG image.");
  }
  const outputLength = output.reduce((length, part) => length + part.length, 0);
  const sanitized = new Uint8Array(outputLength);
  let offset = 0;
  for (const part of output) {
    sanitized.set(part, offset);
    offset += part.length;
  }
  return sanitized;
}

/**
 * Remove location-bearing fields from arbitrary provider/capture JSON while
 * preserving measurement/calibration values and unrelated provenance.
 */
export function removeLocationMetadata<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => removeLocationMetadata(item)) as T;
  }
  if (!value || typeof value !== "object") return value;

  const safe: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/(gps|latitude|longitude|altitude|coordinates?|geolocation|geospatial|geographic|geotag|location|(^|[^a-z])(lat|lng|lon)([^a-z]|$)|position)/i.test(key)) {
      continue;
    }
    safe[key] = removeLocationMetadata(child);
  }
  return safe as T;
}

/**
 * Re-encode through Expo's native image decoder/encoder (which applies source
 * orientation), then strip and verify metadata before writing a durable copy.
 * Failure is deliberately fatal to callers: raw source bytes must never be
 * used as a fallback.
 */
export async function createSanitizedPhotoCopy(
  sourceUri: string,
  destinationUri?: string,
): Promise<string> {
  let manipulatedUri: string | undefined;
  try {
    const result = await ImageManipulator.manipulateAsync(sourceUri, [], {
      compress: 1,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    manipulatedUri = result.uri;
    const encoded = await FileSystem.readAsStringAsync(result.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (!encoded) throw new Error("Image processor returned an empty image.");

    const sanitizedBytes = stripJpegMetadata(base64ToBytes(encoded));
    if (!destinationUri && !FileSystem.documentDirectory) {
      throw new Error("Durable photo storage is unavailable.");
    }
    const sanitizedUri = destinationUri
      ?? `${FileSystem.documentDirectory}readyloq-sanitized-${Crypto.randomUUID()}.jpg`;
    await FileSystem.writeAsStringAsync(sanitizedUri, bytesToBase64(sanitizedBytes), {
      encoding: FileSystem.EncodingType.Base64,
    });
    return sanitizedUri;
  } catch (error) {
    if (destinationUri) {
      await FileSystem.deleteAsync(destinationUri, { idempotent: true }).catch(() => {});
    }
    throw new Error(
      `Photo privacy sanitization failed: ${error instanceof Error ? error.message : "unknown image error"}`,
    );
  } finally {
    if (manipulatedUri && manipulatedUri !== sourceUri) {
      await FileSystem.deleteAsync(manipulatedUri, { idempotent: true }).catch(() => {});
    }
  }
}