import { customFetch } from "./custom-fetch";

export type PropertyLocationKind = "building" | "floor" | "unit" | "common_area";
export type PropertyCoverageState = "not_inspected" | "in_progress" | "inspected" | "no_access";
export interface PropertyLocationRecord {
  id: string; companyId: number; propertyId: number; parentId: string | null;
  kind: PropertyLocationKind; label: string; commonAreaType: string | null;
  revision: number; archivedAt: string | null; createdAt: string;
}
export interface PropertyCoverageRecord {
  id: string; companyId: number; propertyId: number; visitId: string; spaceId: string;
  snapshot: { label: string; kind: "unit" | "common_area"; commonAreaType: string | null;
    ancestors: { id: string; label: string; kind: PropertyLocationKind }[] };
  state: PropertyCoverageState; inspectionId: number | null; reason: string | null; revision: number;
}
export interface PropertyVisitRecord {
  id: string; companyId: number; propertyId: number; clientKey: string; createdBy: string; createdAt: string;
}
export interface PropertyRosterResponse { propertyId: number; locations: PropertyLocationRecord[] }
export interface PropertyVisitResponse { visit: PropertyVisitRecord; coverage: PropertyCoverageRecord[] }
export type CreatePropertyLocation = {
  id: string; label: string; kind: PropertyLocationKind; parentId?: string | null; commonAreaType?: string | null;
};
export type UpdatePropertyLocation = {
  revision: number; label?: string; parentId?: string | null; commonAreaType?: string | null;
  archived?: boolean; reason?: string;
};
const path = (propertyId: number) => `/api/property-foundation/${propertyId}`;
const json = (method: string, body: unknown) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const getPropertyRoster = (id: number) => customFetch<PropertyRosterResponse>(`${path(id)}/roster`);
export const addPropertyLocation = (id: number, body: CreatePropertyLocation) => customFetch<PropertyLocationRecord>(`${path(id)}/locations`, json("POST", body));
export const updatePropertyLocation = (id: number, locationId: string, body: UpdatePropertyLocation) => customFetch<PropertyLocationRecord>(`${path(id)}/locations/${locationId}`, json("PATCH", body));
export const listPropertyVisits = (id: number) => customFetch<PropertyVisitRecord[]>(`${path(id)}/visits`);
export const createPropertyVisit = (id: number, clientKey: string) => customFetch<PropertyVisitResponse>(`${path(id)}/visits`, json("POST", { clientKey }));
export const getPropertyVisitCoverage = (id: number, visitId: string) => customFetch<PropertyVisitResponse>(`${path(id)}/visits/${visitId}`);
export const updatePropertyCoverage = (id: number, visitId: string, coverageId: string, body: {
  revision: number; state: PropertyCoverageState; inspectionId?: number | null; reason?: string;
}) => customFetch<PropertyCoverageRecord>(`${path(id)}/visits/${visitId}/coverage/${coverageId}`, json("PATCH", body));
