/**
 * Minimal stub for expo-file-system/legacy used by vitest.
 * Only the symbols imported by BurstMeasurementManager are stubbed here.
 */
export const cacheDirectory = "/tmp/cache/";

export async function copyAsync(_opts: { from: string; to: string }): Promise<void> {}

export async function deleteAsync(
  _fileUri: string,
  _opts?: { idempotent?: boolean },
): Promise<void> {}
