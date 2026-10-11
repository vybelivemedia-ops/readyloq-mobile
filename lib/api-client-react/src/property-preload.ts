import type { PropertyLocationRecord } from "./property-foundation";

// Contract only: no downloader, no offline AI, no claim of portal delivery.
// An authorized server response must populate this; never fabricate "complete".
export interface PropertyPreloadIdentity { userId: string; companyId: number; propertyId: number; routeDate: string }
export interface PropertyPreloadPackage extends PropertyPreloadIdentity {
  version: 1; generatedAt: string; expiresAt: string;
  completeness: { roster: boolean; history: boolean; treatments: boolean; followUps: boolean; briefing: boolean };
  roster: PropertyLocationRecord[];
  history: { spaceId: string; inspectionId: number; summary: string; capturedAt: string }[];
  treatments: { spaceId: string; inspectionId: number; summary: string }[];
  followUps: { spaceId: string; inspectionId: number; summary: string }[];
  briefing: { text: string; sourceInspectionIds: number[]; scope: "property" | "unit"; spaceId: string | null } | null;
}
export type PreloadReadiness = "not_downloaded" | "invalid" | "stale" | "partial" | "ready";
export function propertyPreloadKey(i: PropertyPreloadIdentity) {
  return JSON.stringify(["readyloq.property-preload", 1, i.userId, i.companyId, i.propertyId, i.routeDate]);
}
export function assessPropertyPreload(p: PropertyPreloadPackage | null, expected: PropertyPreloadIdentity, now = Date.now()): PreloadReadiness {
  if (!p) return "not_downloaded";
  try {
    if (p.version !== 1 || propertyPreloadKey(p) !== propertyPreloadKey(expected) || !expected.userId ||
      !Number.isSafeInteger(expected.companyId) || expected.companyId < 1 || !Number.isSafeInteger(expected.propertyId) || expected.propertyId < 1 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(expected.routeDate)) return "invalid";
    const routeDay = new Date(`${expected.routeDate}T00:00:00Z`);
    if (!Number.isFinite(routeDay.getTime()) || routeDay.toISOString().slice(0, 10) !== expected.routeDate) return "invalid";
    if (JSON.stringify(p).length > 500_000 || !Array.isArray(p.roster) || p.roster.length > 2048) return "invalid";
    const generated = Date.parse(p.generatedAt), expiry = Date.parse(p.expiresAt);
    if (!Number.isFinite(generated) || !Number.isFinite(expiry) || generated > now + 300_000 || expiry <= generated || expiry - generated > 48 * 3600_000) return "invalid";
    const ids = new Set<string>();
    for (const n of p.roster) {
      if (n.companyId !== expected.companyId || n.propertyId !== expected.propertyId || typeof n.id !== "string" || !n.id || n.id.length > 64 || ids.has(n.id) ||
        !["building", "floor", "unit", "common_area"].includes(n.kind) || !n.label || n.label.length > 120) return "invalid";
      ids.add(n.id);
    }
    if (p.roster.some((n) => n.parentId && !ids.has(n.parentId))) return "invalid";
    const spaces = new Set(p.roster.filter((n) => n.kind === "unit" || n.kind === "common_area").map((n) => n.id));
    const inspections = new Set<number>();
    for (const entries of [p.history, p.treatments, p.followUps]) {
      if (!Array.isArray(entries) || entries.length > 1000) return "invalid";
      for (const e of entries) {
        if (!spaces.has(e.spaceId) || !Number.isSafeInteger(e.inspectionId) || e.inspectionId < 1 || typeof e.summary !== "string" || e.summary.length > 2000) return "invalid";
        inspections.add(e.inspectionId);
      }
    }
    if (p.briefing) {
      if (!["property", "unit"].includes(p.briefing.scope) || typeof p.briefing.text !== "string" || p.briefing.text.length > 8000 ||
        !Array.isArray(p.briefing.sourceInspectionIds) || !p.briefing.sourceInspectionIds.length || p.briefing.sourceInspectionIds.length > 100 ||
        p.briefing.sourceInspectionIds.some((id) => !inspections.has(id)) ||
        (p.briefing.scope === "unit" ? !p.briefing.spaceId || !spaces.has(p.briefing.spaceId) ||
          p.briefing.sourceInspectionIds.some((id) => ![...p.history, ...p.treatments, ...p.followUps].some((e) => e.inspectionId === id && e.spaceId === p.briefing!.spaceId)) : p.briefing.spaceId !== null)) return "invalid";
    }
    const fields = ["roster", "history", "treatments", "followUps", "briefing"] as const;
    if (!p.completeness || fields.some((k) => typeof p.completeness[k] !== "boolean") || (p.completeness.briefing && !p.briefing)) return "invalid";
    if (expiry <= now) return "stale";
    return fields.every((k) => p.completeness[k]) ? "ready" : "partial";
  } catch { return "invalid"; }
}
