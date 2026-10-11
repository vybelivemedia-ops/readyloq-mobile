export type PropertyLocationKind = "building" | "floor" | "unit" | "common_area";
export type PropertyCoverageState = "not_inspected" | "in_progress" | "inspected" | "no_access";
export interface PropertyLocationRecord {
    id: string;
    companyId: number;
    propertyId: number;
    parentId: string | null;
    kind: PropertyLocationKind;
    label: string;
    commonAreaType: string | null;
    revision: number;
    archivedAt: string | null;
    createdAt: string;
}
export interface PropertyCoverageRecord {
    id: string;
    companyId: number;
    propertyId: number;
    visitId: string;
    spaceId: string;
    snapshot: {
        label: string;
        kind: "unit" | "common_area";
        commonAreaType: string | null;
        ancestors: {
            id: string;
            label: string;
            kind: PropertyLocationKind;
        }[];
    };
    state: PropertyCoverageState;
    inspectionId: number | null;
    reason: string | null;
    revision: number;
}
export interface PropertyVisitRecord {
    id: string;
    companyId: number;
    propertyId: number;
    clientKey: string;
    createdBy: string;
    createdAt: string;
}
export interface PropertyRosterResponse {
    propertyId: number;
    locations: PropertyLocationRecord[];
}
export interface PropertyVisitResponse {
    visit: PropertyVisitRecord;
    coverage: PropertyCoverageRecord[];
}
export type CreatePropertyLocation = {
    id: string;
    label: string;
    kind: PropertyLocationKind;
    parentId?: string | null;
    commonAreaType?: string | null;
};
export type UpdatePropertyLocation = {
    revision: number;
    label?: string;
    parentId?: string | null;
    commonAreaType?: string | null;
    archived?: boolean;
    reason?: string;
};
export declare const getPropertyRoster: (id: number) => Promise<PropertyRosterResponse>;
export declare const addPropertyLocation: (id: number, body: CreatePropertyLocation) => Promise<PropertyLocationRecord>;
export declare const updatePropertyLocation: (id: number, locationId: string, body: UpdatePropertyLocation) => Promise<PropertyLocationRecord>;
export declare const listPropertyVisits: (id: number) => Promise<PropertyVisitRecord[]>;
export declare const createPropertyVisit: (id: number, clientKey: string) => Promise<PropertyVisitResponse>;
export declare const getPropertyVisitCoverage: (id: number, visitId: string) => Promise<PropertyVisitResponse>;
export declare const updatePropertyCoverage: (id: number, visitId: string, coverageId: string, body: {
    revision: number;
    state: PropertyCoverageState;
    inspectionId?: number | null;
    reason?: string;
}) => Promise<PropertyCoverageRecord>;
//# sourceMappingURL=property-foundation.d.ts.map