import { describe, expect, it, vi } from "vitest";

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));

vi.mock("@workspace/db", () => ({
  db: { execute: executeMock },
}));

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

import { migrateMissionControl } from "./migrate-mission-control";

describe("Mission Control inspection event migration", () => {
  it("creates an additive event table and database-enforced append-only guard", async () => {
    executeMock.mockResolvedValue({ rows: [] });

    await migrateMissionControl();

    const statements = executeMock.mock.calls.map(([statement]) =>
      JSON.stringify(statement),
    );
    const createTable = statements.find((statement) =>
      statement.includes("mission_control_inspection_events"),
    );
    expect(createTable).toContain("CREATE TABLE IF NOT EXISTS");
    expect(createTable).toContain("recorded_at");
    expect(createTable).toContain("occurred_at");
    expect(createTable).toContain("newly_generated");
    expect(createTable).not.toContain("INSERT INTO");

    const immutableTrigger = statements.find(
      (statement) =>
        statement.includes("CREATE TRIGGER") &&
        statement.includes("mission_control_inspection_event_immutable_trigger"),
    );
    expect(immutableTrigger).toContain("BEFORE UPDATE OR DELETE");
    expect(immutableTrigger).toContain(
      "mission_control_inspection_event_immutable()",
    );
  });
});