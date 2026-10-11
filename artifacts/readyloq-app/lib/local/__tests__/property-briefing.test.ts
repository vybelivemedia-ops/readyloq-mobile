import { describe, it, expect } from "vitest";
import { PropertyBriefingLoader, briefingForIdentity, type IdentityBriefing } from "../property-briefing";
import { assessPropertyPreload, propertyPreloadKey, type PropertyPreloadPackage } from "@workspace/api-client-react";

describe("identity-safe property briefings", () => {
  it("hides prior property before effects run and clears it on failed fetch", async () => {
    let state: IdentityBriefing<string> | null = { identity: "company1/propertyA", value: "Prior memory" };
    expect(briefingForIdentity(state, "company1/propertyB")).toBeNull();
    new PropertyBriefingLoader<string>().load("company1/propertyB", () => Promise.reject(new Error("offline")), (v) => { state = v; });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(briefingForIdentity(state, "company1/propertyB")).toBeNull();
  });
  it("ignores late responses from earlier addresses", async () => {
    const loader = new PropertyBriefingLoader<string>();
    let resolveA!: (v: string) => void;
    let state: IdentityBriefing<string> | null = null;
    loader.load("A", () => new Promise((resolve) => { resolveA = resolve; }), (v) => { state = v; });
    await Promise.resolve();
    loader.load("B", async () => "B memory", (v) => { state = v; });
    resolveA("A memory");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(briefingForIdentity(state, "B")).toBe("B memory");
    expect(briefingForIdentity(state, "A")).toBeNull();
  });
  it("does not publish after cancellation", async () => {
    const loader = new PropertyBriefingLoader<string>();
    const states: IdentityBriefing<string>[] = [];
    const cancel = loader.load("A", async () => "late", (v) => states.push(v));
    cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(states).toEqual([{ identity: "A", value: null }]);
  });
});

describe("bounded offline preload contract (no downloader)", () => {
  const identity = { userId: "userA", companyId: 1, propertyId: 2, routeDate: "2026-10-11" };
  const now = Date.parse("2026-10-11T12:00:00Z");
  const packageFor = (): PropertyPreloadPackage => ({
    ...identity, version: 1, generatedAt: "2026-10-11T10:00:00Z", expiresAt: "2026-10-11T18:00:00Z",
    completeness: { roster: true, history: true, treatments: true, followUps: true, briefing: true },
    roster: [{ id: "unitA", companyId: 1, propertyId: 2, parentId: null, kind: "common_area", label: "Basement", commonAreaType: "basement", revision: 1, archivedAt: null, createdAt: "2026-10-11T10:00:00Z" }],
    history: [{ spaceId: "unitA", inspectionId: 5, summary: "Documented prior observation", capturedAt: "2026-10-10T10:00:00Z" }],
    treatments: [], followUps: [],
    briefing: { text: "Review prior observation", scope: "unit", spaceId: "unitA", sourceInspectionIds: [5] },
  });
  it("identifies missing, ready, partial and stale packages", () => {
    expect(assessPropertyPreload(null, identity, now)).toBe("not_downloaded");
    expect(assessPropertyPreload(packageFor(), identity, now)).toBe("ready");
    const partial = packageFor(); partial.completeness.treatments = false;
    expect(assessPropertyPreload(partial, identity, now)).toBe("partial");
    expect(assessPropertyPreload(packageFor(), identity, now + 86400_000)).toBe("stale");
  });
  it.each([
    { ...identity, userId: "userB" }, { ...identity, companyId: 9 }, { ...identity, propertyId: 9 }, { ...identity, routeDate: "2026-10-12" },
  ])("rejects identity mismatch %j", (expected) => {
    expect(propertyPreloadKey(expected)).not.toBe(propertyPreloadKey(identity));
    expect(assessPropertyPreload(packageFor(), expected, now)).toBe("invalid");
  });
  it("rejects foreign records, ungrounded briefing, future times and oversized data", () => {
    const foreign = packageFor(); foreign.roster[0].companyId = 9;
    expect(assessPropertyPreload(foreign, identity, now)).toBe("invalid");
    const invented = packageFor(); invented.briefing!.sourceInspectionIds = [999];
    expect(assessPropertyPreload(invented, identity, now)).toBe("invalid");
    const future = packageFor(); future.generatedAt = "2026-10-12T10:00:00Z";
    expect(assessPropertyPreload(future, identity, now)).toBe("invalid");
    const huge = packageFor(); huge.history[0].summary = "x".repeat(500_001);
    expect(assessPropertyPreload(huge, identity, now)).toBe("invalid");
  });
  it("does not use another unit's records as this unit's briefing sources", () => {
    const p = packageFor();
    p.roster.push({ ...p.roster[0], id: "unitB", label: "Other common area" });
    p.history[0].spaceId = "unitB";
    expect(assessPropertyPreload(p, identity, now)).toBe("invalid");
  });
  it("rejects impossible route dates and malformed stable IDs", () => {
    const badDay = { ...identity, routeDate: "2026-02-30" };
    expect(assessPropertyPreload({ ...packageFor(), ...badDay }, badDay, now)).toBe("invalid");
    const p = packageFor();
    p.roster[0].id = "";
    expect(assessPropertyPreload(p, identity, now)).toBe("invalid");
  });
});
