/**
 * Pure-logic helper for InspectionDetail's url → captureMetadata cross-reference.
 *
 * InspectionDetail.tsx uses this to look up the captureMetadata for a finding's
 * evidence photo so it can pass it to FindingCard as the `captureMetadata` prop.
 *
 * Keeping the lookup as a standalone function makes it testable without a React
 * Native environment, and makes the URL-mismatch behaviour explicit.
 */

/** Minimal shape of an InspectionMedia record needed for the lookup. */
export interface MediaRecord {
  url: string;
  captureMetadata?: Record<string, unknown> | null;
}

/**
 * Resolve the captureMetadata for a finding's imageUrl by scanning the
 * inspection's photo array.
 *
 * Returns `null` when:
 *  - `imageUrl` is absent / falsy (finding has no image)
 *  - no media record's `url` matches `imageUrl` exactly (partial offline sync,
 *    URL mismatch, etc.)
 *  - the matching record exists but has no `captureMetadata` field
 *
 * The caller (FindingCard) must treat a `null` result as "no measurement stamp"
 * and render without the measurement strip.
 */
export function lookupCaptureMetadata(
  photos: MediaRecord[],
  imageUrl: string | null | undefined,
): Record<string, unknown> | null {
  if (!imageUrl) return null;
  const match = photos.find((m) => m.url === imageUrl);
  if (!match) return null;
  return match.captureMetadata ?? null;
}
