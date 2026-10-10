export type InspectionEvidenceType = "photo" | "video";

export interface InspectionUploadResult {
  path: string;
  uploadIntentId: number;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface UploadInspectionEvidenceOptions {
  url: string;
  filename: string;
  inspectionId: number;
  mediaType: InspectionEvidenceType;
  clientKey: string;
  fallbackContentType?: string;
  uploadBlob?: boolean;
  fetcher?: FetchLike;
}

/**
 * Upload one captured inspection blob under a stable, inspection-scoped intent.
 * Keep clientKey stable across retries so an ambiguous PUT reuses the same
 * object path and registration reservation.
 */
export async function uploadInspectionEvidence({
  url,
  filename,
  inspectionId,
  mediaType,
  clientKey,
  fallbackContentType = "image/jpeg",
  uploadBlob = true,
  fetcher = fetch,
}: UploadInspectionEvidenceOptions): Promise<InspectionUploadResult> {
  if (!url.startsWith("blob:") && !url.startsWith("data:")) {
    throw new Error("Inspection evidence must be uploaded from a local blob.");
  }

  const blobResponse = await fetcher(url);
  if (!blobResponse.ok) throw new Error("Could not read the captured evidence for upload.");
  const blob = await blobResponse.blob();
  if (blob.size < 1) throw new Error("Captured evidence is empty.");

  const contentType = (blob.type || fallbackContentType).split(";")[0].trim().toLowerCase();
  const reservationResponse = await fetcher("/api/storage/uploads/request-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: filename,
      size: blob.size,
      contentType,
      purpose: "inspection-evidence",
      inspectionId,
      mediaType,
      clientKey,
    }),
  });
  if (!reservationResponse.ok) {
    throw new Error(`Upload could not start (${reservationResponse.status}).`);
  }
  const reservation = await reservationResponse.json() as {
    uploadURL: string;
    objectPath: string;
    uploadIntentId: number;
  };
  if (
    typeof reservation.uploadIntentId !== "number" ||
    !Number.isSafeInteger(reservation.uploadIntentId) ||
    reservation.uploadIntentId < 1 ||
    typeof reservation.objectPath !== "string" ||
    !reservation.objectPath.startsWith(`/objects/companies/`)
  ) {
    throw new Error("Upload reservation response is invalid.");
  }

  // A replay may report an already-registered intent with no URL. In that
  // case the same path/intent is returned and registration remains idempotent.
  if (uploadBlob && reservation.uploadURL) {
    // The browser derives Content-Length from the Blob (setting it directly is
    // forbidden by Fetch); the authenticated server endpoint counts the stream
    // against the reservation. GCS itself enforces ifGenerationMatch=0, so a
    // replay PUT cannot replace bytes already stored at this path.
    const putResponse = await fetcher(reservation.uploadURL, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "x-goog-if-generation-match": "0",
      },
      body: blob,
    });
    if (!putResponse.ok) {
      throw new Error(`Evidence upload failed (${putResponse.status}).`);
    }
  }

  return {
    path: `/api/storage${reservation.objectPath}`,
    uploadIntentId: reservation.uploadIntentId,
  };
}