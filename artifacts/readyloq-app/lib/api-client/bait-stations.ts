/**
 * Thin non-generated wrappers for the bait-stations API routes.
 * Uses the same customFetch / base-URL infrastructure as the generated client.
 */
import { customFetch } from "./custom-fetch";

export interface BaitStationInput {
  label: string;
  locationType?: string;
  status: "active" | "missing" | "damaged" | "removed";
  notes?: string;
  lastCheckedAt?: string;
}

export interface BaitStationRecord extends BaitStationInput {
  id: number;
  inspectionId: number;
  companyId: number;
  createdAt: string;
  lastCheckedAt?: string;
}

export async function createBaitStation(
  inspectionId: number,
  input: BaitStationInput,
): Promise<BaitStationRecord> {
  return customFetch<BaitStationRecord>(`/api/inspections/${inspectionId}/bait-stations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function updateBaitStation(
  inspectionId: number,
  stationId: number,
  input: Partial<BaitStationInput>,
): Promise<BaitStationRecord> {
  return customFetch<BaitStationRecord>(
    `/api/inspections/${inspectionId}/bait-stations/${stationId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}
