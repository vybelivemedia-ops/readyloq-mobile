import type { PropertyLocationRecord } from "./property-foundation";
export interface PropertyPreloadIdentity {
    userId: string;
    companyId: number;
    propertyId: number;
    routeDate: string;
}
export interface PropertyPreloadPackage extends PropertyPreloadIdentity {
    version: 1;
    generatedAt: string;
    expiresAt: string;
    completeness: {
        roster: boolean;
        history: boolean;
        treatments: boolean;
        followUps: boolean;
        briefing: boolean;
    };
    roster: PropertyLocationRecord[];
    history: {
        spaceId: string;
        inspectionId: number;
        summary: string;
        capturedAt: string;
    }[];
    treatments: {
        spaceId: string;
        inspectionId: number;
        summary: string;
    }[];
    followUps: {
        spaceId: string;
        inspectionId: number;
        summary: string;
    }[];
    briefing: {
        text: string;
        sourceInspectionIds: number[];
        scope: "property" | "unit";
        spaceId: string | null;
    } | null;
}
export type PreloadReadiness = "not_downloaded" | "invalid" | "stale" | "partial" | "ready";
export declare function propertyPreloadKey(i: PropertyPreloadIdentity): string;
export declare function assessPropertyPreload(p: PropertyPreloadPackage | null, expected: PropertyPreloadIdentity, now?: number): PreloadReadiness;
//# sourceMappingURL=property-preload.d.ts.map