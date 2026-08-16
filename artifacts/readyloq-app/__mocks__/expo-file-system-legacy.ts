/**
 * Minimal stub for expo-file-system/legacy used by vitest.
 * Only the symbols imported by BurstMeasurementManager and report-html are stubbed here.
 */
export const cacheDirectory = "/tmp/cache/";
export const documentDirectory = "/tmp/documents/";

export const EncodingType = {
  Base64: "base64" as const,
  UTF8: "utf8" as const,
};

export async function copyAsync(_opts: { from: string; to: string }): Promise<void> {}

export async function deleteAsync(
  _fileUri: string,
  _opts?: { idempotent?: boolean },
): Promise<void> {}

/** Default stub returns null (photo missing) so report-html gracefully omits the image. */
export async function readAsStringAsync(
  _uri: string,
  _opts?: { encoding?: string },
): Promise<string> {
  throw new Error("file not found");
}
