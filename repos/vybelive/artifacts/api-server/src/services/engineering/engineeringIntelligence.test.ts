import { describe, expect, it } from "vitest";
import { detectEngineeringEvents } from "./engineeringIntelligence";
import type { EngineeringSnapshot } from "./types";

// These tests lock in the predecessor contract for engineering-event detection.
// The wiring bug they guard against: collectSnapshot compares a fresh in-memory
// snapshot BEFORE persisting it, so its immediate predecessor is the LATEST
// persisted row. Using a "second-newest" lookup there either lagged detection by
// one cycle or (with a single prior snapshot) returned null and emitted nothing.

function makeSnapshot(over: Partial<EngineeringSnapshot> = {}): EngineeringSnapshot {
  return {
    id: over.id ?? "snap",
    productId: over.productId ?? "prod-1",
    productSlug: "vybe-live",
    productName: "VYBE Live",
    capturedAt: over.capturedAt ?? "2026-06-29T00:00:00.000Z",
    repository: {
      branch: "main",
      latestCommit: null,
      recentCommits: [],
      openPullRequests: [],
      openIssues: 0,
      ...(over.repository ?? {}),
    },
    build: {
      status: "passing",
      lastSuccessfulBuildAt: null,
      failedBuilds: 0,
      buildDurationMs: null,
      artifactPath: null,
      ...(over.build ?? {}),
    },
    deployment: {
      status: "deployed",
      productionHealth: "healthy",
      activeServices: [],
      history: [],
      urls: [],
      ...(over.deployment ?? {}),
    },
    runtime: { errors: [], warnings: [], unhealthyServices: [], ...(over.runtime ?? {}) },
    healthScore: over.healthScore ?? 100,
    launchReadiness:
      over.launchReadiness ?? { score: 100, state: "ready", factors: [] },
    blockers: over.blockers ?? [],
    deploymentRisk: over.deploymentRisk ?? "low",
    launchRisk: over.launchRisk ?? "low",
    providers: over.providers ?? [],
  };
}

describe("detectEngineeringEvents", () => {
  it("emits no events when there is no predecessor (first snapshot)", () => {
    const curr = makeSnapshot({ build: { status: "failing" } as EngineeringSnapshot["build"] });
    expect(detectEngineeringEvents(null, curr)).toEqual([]);
  });

  it("emits no events when nothing material changed vs the predecessor", () => {
    const prev = makeSnapshot({ id: "a", capturedAt: "2026-06-29T00:00:00.000Z" });
    const curr = makeSnapshot({ id: "b", capturedAt: "2026-06-29T01:00:00.000Z" });
    expect(detectEngineeringEvents(prev, curr)).toEqual([]);
  });

  it("detects a build failure against the immediate predecessor", () => {
    const prev = makeSnapshot({ id: "a", build: { status: "passing" } as EngineeringSnapshot["build"] });
    const curr = makeSnapshot({ id: "b", build: { status: "failing" } as EngineeringSnapshot["build"] });
    const events = detectEngineeringEvents(prev, curr);
    expect(events.map((e) => e.type)).toContain("build_failed");
    expect(events.every((e) => e.snapshotId === "b")).toBe(true);
  });

  it("detects production degradation against the immediate predecessor", () => {
    const prev = makeSnapshot({
      id: "a",
      deployment: { status: "deployed", productionHealth: "healthy", activeServices: [], history: [], urls: [] },
    });
    const curr = makeSnapshot({
      id: "b",
      deployment: { status: "deployed", productionHealth: "down", activeServices: [], history: [], urls: [] },
    });
    expect(detectEngineeringEvents(prev, curr).map((e) => e.type)).toContain("production_degraded");
  });
});
