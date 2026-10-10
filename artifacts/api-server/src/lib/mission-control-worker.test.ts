import { describe, expect, it } from "vitest";
import { buildCompanyDiagnostics, buildInvestigationPrompt, specialistContext } from "./mission-control-worker";
import { executiveRegistry, selectSpecialists } from "./mission-control-executives";

describe("Mission Control investigation context", () => {
  it("includes only bounded diagnostic rows belonging to the task company", () => {
    const diagnostics = buildCompanyDiagnostics(
      41,
      [
        { id: 1, companyId: 41, status: "failed", createdAt: "2025-01-01", siteAddress: "private address" },
        { id: 2, companyId: 99, status: "complete", createdAt: "2025-01-02" },
      ],
      [
        { id: 3, companyId: 41, category: "ai", source: "server", inspectionId: 1, message: "private error text" },
        { id: 4, companyId: 99, category: "auth", source: "client", message: "other tenant secret" },
      ],
      [
        { id: 5, companyId: 41, systemType: "pestpac", inspectionId: 1, errorMessage: "private sync text" },
        { id: 6, companyId: 99, systemType: "fieldroutes", inspectionId: 2 },
      ],
      [
        { id: 7, companyId: 41, inspectionId: 1, status: "failed", analysisErrors: 1 },
        { id: 8, companyId: 99, inspectionId: 2, status: "failed", analysisErrors: 5 },
      ],
    );

    expect(JSON.stringify(diagnostics)).toContain('"id":1');
    expect(JSON.stringify(diagnostics)).toContain('"id":3');
    expect(JSON.stringify(diagnostics)).not.toContain('"id":2');
    expect(JSON.stringify(diagnostics)).not.toContain('"id":4');
    expect(JSON.stringify(diagnostics)).not.toContain('"id":6');
    expect(JSON.stringify(diagnostics)).not.toContain('"id":8');
    expect(JSON.stringify(diagnostics)).not.toContain("private address");
    expect(JSON.stringify(diagnostics)).not.toContain("private error text");
    expect(JSON.stringify(diagnostics)).not.toContain("other tenant secret");

    const prompt = buildInvestigationPrompt("Investigate failures", diagnostics);
    expect(prompt).toContain("Root-cause hypothesis");
    expect(prompt).toContain('"companyId":41');
    expect(prompt).not.toContain('"companyId":99');
  });

  it("caps each diagnostic family before constructing model context", () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({
      id: index + 1,
      companyId: 41,
      category: "ai",
    }));
    const diagnostics = buildCompanyDiagnostics(41, rows, rows, rows, rows);
    expect(diagnostics.recentInspections).toHaveLength(10);
    expect(diagnostics.recentErrors).toHaveLength(25);
    expect(diagnostics.recentSyncFailures).toHaveLength(25);
    expect(diagnostics.recentAnalysisFailures).toHaveLength(25);
  });

  it("routes to real registered specialists without granting mutation permissions", () => {
    expect(selectSpecialists("Investigate sync and AI analysis failures")).toEqual(["theo", "nadia"]);
    expect(selectSpecialists("Please inspect our visit")).toEqual(["ada"]);
    expect(selectSpecialists("What happened?")).toEqual(["iris"]);
    expect(executiveRegistry.every((agent) => !/execute|write|change records/i.test(agent.capability))).toBe(true);
  });

  it("restricts specialist evidence to the assigned company and role", () => {
    const diagnostics = buildCompanyDiagnostics(41,
      [{ id: 1, companyId: 41 }, { id: 2, companyId: 99 }],
      [{ id: 3, companyId: 41 }, { id: 4, companyId: 99 }],
      [{ id: 5, companyId: 41 }, { id: 6, companyId: 99 }],
      [{ id: 7, companyId: 41 }, { id: 8, companyId: 99 }],
    );
    expect(specialistContext("theo", diagnostics)).toEqual({
      companyId: 41, recentSyncFailures: [{ id: 5, systemType: undefined, inspectionId: undefined, syncedAt: undefined }],
    });
    expect(JSON.stringify(specialistContext("iris", diagnostics))).not.toContain('"id":8');
    expect(specialistContext("ada", diagnostics)).not.toHaveProperty("recentErrors");
  });
});