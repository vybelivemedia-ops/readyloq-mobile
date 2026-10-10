import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  analysisResultsTable,
  inspectionMediaTable,
  inspectionSyncLogsTable,
  inspectionsTable,
  metaGlassesSessionsTable,
  missionControlAuditTable,
  missionControlIncidentsTable,
  missionControlInspectionEventsTable,
} from "@workspace/db";
import { getTableName } from "drizzle-orm";
import { getMissionControlInspectionTimeline } from "./mission-control-inspection-timeline";

const companyId = 14;
const inspectionId = 29;
const stamp = (value: string) => new Date(value);

function createExecutor() {
  const rows: Record<string, Record<string, unknown>[]> = {
    inspections: [
      {
        id: inspectionId,
        companyId,
        status: "completed",
        createdAt: stamp("2024-01-01T10:00:00Z"),
      },
      {
        id: inspectionId + 1,
        companyId: companyId + 1,
        status: "failed",
        createdAt: stamp("2024-01-01T10:01:00Z"),
      },
    ],
    inspection_media: [
      {
        id: 31,
        companyId,
        inspectionId,
        mediaType: "photo",
        capturedAt: null,
        createdAt: stamp("2024-01-01T10:02:00Z"),
      },
      {
        id: 32,
        companyId: companyId + 1,
        inspectionId,
        mediaType: "video",
        capturedAt: stamp("2024-01-01T10:03:00Z"),
        createdAt: stamp("2024-01-01T10:03:00Z"),
      },
    ],
    analysis_results: [
      {
        id: 41,
        companyId,
        inspectionId,
        status: "complete",
        createdAt: stamp("2024-01-01T10:04:00Z"),
      },
    ],
    inspection_sync_logs: [
      {
        id: 51,
        companyId,
        inspectionId,
        systemType: "pestpac",
        success: false,
        syncedAt: stamp("2024-01-01T10:05:00Z"),
      },
      {
        id: 52,
        companyId,
        inspectionId,
        systemType: "pestpac",
        success: true,
        syncedAt: stamp("2024-01-01T10:05:00Z"),
      },
      {
        id: 53,
        companyId: companyId + 1,
        inspectionId,
        systemType: "pestpac",
        success: true,
        syncedAt: stamp("2024-01-01T10:06:00Z"),
      },
    ],
    meta_glasses_sessions: [
      {
        id: 61,
        companyId,
        inspectionId,
        createdAt: stamp("2024-01-01T10:07:00Z"),
      },
    ],
    mission_control_incidents: [
      {
        id: 71,
        companyId,
        inspectionId,
        status: "open",
        severity: "high",
        createdAt: stamp("2024-01-01T10:08:00Z"),
      },
      {
        id: 72,
        companyId: companyId + 1,
        inspectionId,
        status: "open",
        severity: "critical",
        createdAt: stamp("2024-01-01T10:09:00Z"),
      },
    ],
    mission_control_inspection_events: [
      {
        id: 81,
        companyId,
        inspectionId,
        eventType: "sync.recovered",
        entityType: "inspection",
        entityId: String(inspectionId),
        sourceRecordType: "inspection_sync_logs",
        sourceRecordId: "52",
        occurredAt: stamp("2024-01-01T10:10:00Z"),
        recordedAt: stamp("2024-01-01T10:11:00Z"),
        payload: { status: "success" },
      },
      {
        id: 82,
        companyId: companyId + 1,
        inspectionId,
        eventType: "foreign.event",
        entityType: "inspection",
        entityId: String(inspectionId),
        sourceRecordType: "inspection",
        sourceRecordId: String(inspectionId),
        occurredAt: stamp("2024-01-01T10:12:00Z"),
        recordedAt: stamp("2024-01-01T10:12:00Z"),
        payload: {},
      },
      {
        id: 83,
        companyId,
        inspectionId,
        eventType: "incident.acknowledge",
        entityType: "incident",
        entityId: "71",
        sourceRecordType: "mission_control_audit",
        sourceRecordId: "91",
        occurredAt: stamp("2024-01-01T10:13:00Z"),
        recordedAt: stamp("2024-01-01T10:13:00Z"),
        payload: { action: "acknowledge" },
      },
    ],
    mission_control_audit: [
      {
        id: 91,
        targetType: "incident",
        targetId: "71",
        action: "incident_acknowledge",
        details: { private: "do not expose" },
        createdAt: stamp("2024-01-01T10:13:00Z"),
      },
      {
        id: 91,
        targetType: "incident",
        targetId: "71",
        action: "incident_acknowledge",
        details: { private: "do not expose" },
        createdAt: stamp("2024-01-01T10:13:00Z"),
      },
      {
        id: 92,
        targetType: "incident",
        targetId: "72",
        action: "incident_resolve",
        details: { private: "foreign" },
        createdAt: stamp("2024-01-01T10:14:00Z"),
      },
    ],
  };

  const queries: { table: string; sql: string; params: unknown[] }[] = [];
  const dialect = new PgDialect();
  const executor = {
    select: () => {
      let tableName = "";
      let predicate: unknown;
      const query = {
        from(table: unknown) {
          tableName = getTableName(table as never);
          return query;
        },
        where(condition: { getSQL: () => unknown }) {
          predicate = condition;
          const compiled = dialect.sqlToQuery(condition as never);
          queries.push({
            table: tableName,
            sql: compiled.sql,
            params: compiled.params,
          });
          return query;
        },
        then(
          resolve: (value: Record<string, unknown>[]) => unknown,
          reject: (reason: unknown) => unknown,
        ) {
          try {
            const found = rows[tableName] ?? [];
            let filtered: Record<string, unknown>[];
            if (tableName === "mission_control_audit") {
              const incidentTargetIds = new Set(["71"]);
              filtered = found.filter(
                (row) =>
                  row.targetType === "incident" &&
                  incidentTargetIds.has(String(row.targetId)),
              );
            } else {
              filtered = found.filter(
                (row) =>
                  row.companyId === companyId &&
                  row.inspectionId === inspectionId,
              );
              if (tableName === "inspections") {
                filtered = found.filter(
                  (row) => row.id === inspectionId && row.companyId === companyId,
                );
              }
            }
            void predicate;
            return Promise.resolve(filtered).then(resolve, reject);
          } catch (error) {
            return Promise.reject(error).then(resolve, reject);
          }
        },
      };
      return query;
    },
  };

  return { executor, queries, rows };
}

describe("getMissionControlInspectionTimeline", () => {
  it("orders equal-time lifecycle events by numeric source event identity", async () => {
    const { executor, rows } = createExecutor();
    const template = rows.mission_control_inspection_events![0]!;
    rows.mission_control_inspection_events = [10, 9, 11].map((id) => ({
      ...template, id, eventType: "analysis.result_saved", sourceRecordType: "analysis_results",
      sourceRecordId: String(id),
    }));
    const entries = await getMissionControlInspectionTimeline({ companyId, inspectionId }, executor);
    expect(entries.filter((entry) => entry.provenance === "newly_generated_event")
      .map((entry) => entry.id)).toEqual([
        "mission-control-event:9", "mission-control-event:10", "mission-control-event:11",
      ]);
  });
  it("marks legacy rows as snapshots or persisted attempts without inventing transitions", async () => {
    const { executor } = createExecutor();
    const entries = await getMissionControlInspectionTimeline(
      { companyId, inspectionId },
      executor,
    );

    const bySource = (sourceType: string, sourceId: string) =>
      entries.find(
        (entry) =>
          entry.sourceType === sourceType && entry.sourceId === sourceId,
      );
    expect(bySource("inspections", String(inspectionId))).toMatchObject({
      provenance: "current_state_derived",
      status: "completed",
      occurredAt: null,
      detail: "Current inspection state observed",
    });
    expect(bySource("analysis_results", "41")).toMatchObject({
      provenance: "current_state_derived",
      occurredAt: null,
    });
    expect(bySource("inspection_media", "31")).toMatchObject({
      provenance: "current_state_derived",
      occurredAt: null,
    });
    expect(bySource("inspection_sync_logs", "51")).toMatchObject({
      provenance: "persisted_historical_event",
      eventType: "sync_attempt",
      status: "failed",
      occurredAt: stamp("2024-01-01T10:05:00Z"),
    });
    expect(entries.some((entry) => /upload|ai.started|capture.started/i.test(entry.eventType))).toBe(false);
  });

  it("orders persisted timestamps deterministically and emits append-only events as new", async () => {
    const { executor } = createExecutor();
    const entries = await getMissionControlInspectionTimeline(
      { companyId, inspectionId },
      executor,
    );
    const syncIds = entries
      .filter((entry) => entry.eventType === "sync_attempt")
      .map((entry) => entry.id);
    // The append-only event for source log 52 replaces its historical mirror.
    expect(syncIds).toEqual(["sync-attempt:51"]);

    const newEvent = entries.find((entry) => entry.id === "mission-control-event:81");
    expect(newEvent).toMatchObject({
      provenance: "newly_generated_event",
      sourceType: "inspection_sync_logs",
      sourceId: "52",
      eventType: "sync.recovered",
      occurredAt: stamp("2024-01-01T10:10:00Z"),
      recordedAt: stamp("2024-01-01T10:11:00Z"),
    });
    expect(entries.find((entry) => entry.id === "mission-control-event:82")).toBeUndefined();
  });

  it("queries every source in the authoritative company and inspection scope", async () => {
    const { executor, queries } = createExecutor();
    await getMissionControlInspectionTimeline(
      { companyId, inspectionId },
      executor,
    );

    const scopedTables = [
      "inspections",
      "inspection_media",
      "analysis_results",
      "inspection_sync_logs",
      "meta_glasses_sessions",
      "mission_control_incidents",
      "mission_control_inspection_events",
    ];
    for (const table of scopedTables) {
      const query = queries.find((candidate) => candidate.table === table);
      expect(query?.sql).toContain("company_id");
      expect(
        query?.sql.includes("inspection_id") ||
          query?.sql.includes('"inspections"."id"'),
      ).toBe(true);
      expect(query?.params).toContain(companyId);
      expect(query?.params).toContain(inspectionId);
    }
    const auditQuery = queries.find(
      (candidate) => candidate.table === "mission_control_audit",
    );
    expect(auditQuery?.params).toContain("71");
    expect(auditQuery?.params).not.toContain("72");
  });

  it("deduplicates incident actions and omits raw audit details", async () => {
    const { executor } = createExecutor();
    const entries = await getMissionControlInspectionTimeline(
      { companyId, inspectionId },
      executor,
    );
    const actions = entries.filter(
      (entry) => entry.sourceType === "mission_control_audit",
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      eventType: "incident.acknowledge",
      detail: "Inspection event recorded",
      sourceId: "91",
      relatedId: 71,
      provenance: "newly_generated_event",
    });
    expect(JSON.stringify(actions[0])).not.toContain("private");
  });
});