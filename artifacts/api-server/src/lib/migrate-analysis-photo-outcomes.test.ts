import { describe, expect, it, vi } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("@workspace/db", () => ({
  db: { execute: executeMock },
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn() },
}));

import { migrateAnalysisPhotoOutcomes } from "./migrate-analysis-photo-outcomes";

describe("migrateAnalysisPhotoOutcomes", () => {
  it("uses one schema-qualified atomic add-if-missing statement", async () => {
    executeMock.mockResolvedValue({ rows: [] });

    await migrateAnalysisPhotoOutcomes();

    expect(executeMock).toHaveBeenCalledTimes(1);
    const statement = executeMock.mock.calls[0]?.[0] as {
      queryChunks?: unknown[];
    };
    const statementShape = JSON.stringify(statement);
    expect(statementShape).toContain("public.analysis_results");
    expect(statementShape).toContain("IF NOT EXISTS");
    expect(statementShape).toContain("photo_outcomes");
    expect(statementShape).not.toContain("information_schema");
  });
});