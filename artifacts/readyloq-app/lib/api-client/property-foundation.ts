// Mobile uses its existing authenticated/base-path-aware transport, not a
// regenerated copy of its deliberately frozen Orval client.
import { customFetch } from "./custom-fetch";
import type { PropertyRosterResponse, PropertyVisitResponse, PropertyVisitRecord, PropertyLocationRecord, CreatePropertyLocation, UpdatePropertyLocation, PropertyCoverageRecord, PropertyCoverageState } from "@workspace/api-client-react";
export type { PropertyLocationRecord, PropertyRosterResponse, PropertyVisitResponse, PropertyCoverageRecord } from "@workspace/api-client-react";
const base = (id: number) => `/api/property-foundation/${id}`;
const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const getPropertyRoster = (id: number) => customFetch<PropertyRosterResponse>(`${base(id)}/roster`);
export const addPropertyLocation = (id: number, input: CreatePropertyLocation) => customFetch<PropertyLocationRecord>(`${base(id)}/locations`, json("POST", input));
export const updatePropertyLocation = (id: number, locationId: string, input: UpdatePropertyLocation) => customFetch<PropertyLocationRecord>(`${base(id)}/locations/${locationId}`, json("PATCH", input));
export const listPropertyVisits = (id: number) => customFetch<PropertyVisitRecord[]>(`${base(id)}/visits`);
export const createPropertyVisit = (id: number, clientKey: string) => customFetch<PropertyVisitResponse>(`${base(id)}/visits`, json("POST", { clientKey }));
export const getPropertyVisitCoverage = (id: number, visitId: string) => customFetch<PropertyVisitResponse>(`${base(id)}/visits/${visitId}`);
export const updatePropertyCoverage = (id: number, visitId: string, coverageId: string, input: { revision: number; state: PropertyCoverageState; inspectionId?: number | null; reason?: string }) =>
  customFetch<PropertyCoverageRecord>(`${base(id)}/visits/${visitId}/coverage/${coverageId}`, json("PATCH", input));
