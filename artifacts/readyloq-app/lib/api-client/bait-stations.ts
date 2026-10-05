/**
 * Thin non-generated wrappers for the bait-stations API routes.
 * Uses the same customFetch / base-URL infrastructure as the generated client.
 */
import { customFetch } from "./custom-fetch";
import {
  createBaitStation as createBaitStationGenerated,
  type BaitStation as ApiBaitStation,
  type BaitStationInput as ApiBaitStationInput,
} from "@workspace/api-client-react";

export type BaitStationInput = Omit<ApiBaitStationInput, "status"> & {
  status: NonNullable<ApiBaitStationInput["status"]>;
};
export type BaitStationRecord = ApiBaitStation;

export async function createBaitStation(
  inspectionId: number,
  input: BaitStationInput,
): Promise<BaitStationRecord> {
  return createBaitStationGenerated(inspectionId, input);
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
