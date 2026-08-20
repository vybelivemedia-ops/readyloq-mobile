/**
 * API client for technician finding corrections.
 *
 * Used by the offline sync engine to flush pendingCorrections queued while
 * the device was offline. Backed by PATCH /api/analysis/:id/findings/correct.
 */

import { customFetch } from "./custom-fetch";

export interface CorrectFindingInput {
  findingId: number;
  action: "accept" | "correct" | "dismiss";
  technicianSpecies?: string;
  updateStrategy?: "keep_existing" | "ai_regenerate";
  notes?: string;
}

/**
 * Apply a single technician correction to a server-side analysis finding.
 * Throws on network or server error — callers should catch and decide
 * whether to remove the item from the queue or keep it for retry.
 */
export async function correctFinding(
  analysisId: number,
  input: CorrectFindingInput,
): Promise<void> {
  await customFetch<void>(`/api/analysis/${analysisId}/findings/correct`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
