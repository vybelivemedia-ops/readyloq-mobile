/**
 * Unit tests — KPI tile deep-link route mapping
 *
 * These tests import the shared KPI_DEEP_LINK_FILTERS constant that
 * executive-dashboard.tsx uses directly for its onPress handlers.  Changing
 * any card's filter value in the dashboard without updating the constant will
 * cause these tests to fail — preventing silent label/route drift.
 */

import { describe, expect, it } from "vitest";
import { KPI_DEEP_LINK_FILTERS } from "../kpi-deep-links";

describe("KPI_DEEP_LINK_FILTERS — 'Avg Quality Score' tile", () => {
  it("maps avgQualityScore to 'critical' (opens the Critical Risks tab)", () => {
    expect(KPI_DEEP_LINK_FILTERS.avgQualityScore).toBe("critical");
  });

  it("does NOT map avgQualityScore to 'pipeline' (must not open the Pipeline tab)", () => {
    expect(KPI_DEEP_LINK_FILTERS.avgQualityScore).not.toBe("pipeline");
  });

  it("does NOT map avgQualityScore to 'all' (must not land on the default tab)", () => {
    expect(KPI_DEEP_LINK_FILTERS.avgQualityScore).not.toBe("all");
  });
});

describe("KPI_DEEP_LINK_FILTERS — 'Open Pipeline' tile", () => {
  it("maps openPipeline to 'pipeline' (opens the Pipeline tab)", () => {
    expect(KPI_DEEP_LINK_FILTERS.openPipeline).toBe("pipeline");
  });

  it("does NOT map openPipeline to 'critical' (must not mis-route to Critical Risks)", () => {
    expect(KPI_DEEP_LINK_FILTERS.openPipeline).not.toBe("critical");
  });
});

describe("KPI_DEEP_LINK_FILTERS — 'Critical Risk Sites' tile", () => {
  it("maps criticalRiskSites to 'critical' (opens the Critical Risks tab)", () => {
    expect(KPI_DEEP_LINK_FILTERS.criticalRiskSites).toBe("critical");
  });

  it("does NOT map criticalRiskSites to 'pipeline'", () => {
    expect(KPI_DEEP_LINK_FILTERS.criticalRiskSites).not.toBe("pipeline");
  });
});

describe("KPI_DEEP_LINK_FILTERS — all entries are valid AuditFilter values", () => {
  const VALID_FILTERS = ["all", "pipeline", "pending", "critical"] as const;

  it("every filter value in the map is a recognised AuditFilter", () => {
    for (const value of Object.values(KPI_DEEP_LINK_FILTERS)) {
      expect(VALID_FILTERS).toContain(value);
    }
  });
});
