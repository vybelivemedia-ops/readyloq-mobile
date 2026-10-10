import { and, eq, inArray } from "drizzle-orm";
import { PROCESSING_MILESTONES } from "./inspection-processing-events";
import {
  analysisResultsTable,
  db,
  inspectionMediaTable,
  inspectionSyncLogsTable,
  inspectionsTable,
  metaGlassesSessionsTable,
  missionControlAuditTable,
  missionControlIncidentsTable,
  missionControlInspectionEventsTable,
} from "@workspace/db";

export type MissionControlTimelineProvenance =
  | "persisted_historical_event"
  | "current_state_derived"
  | "newly_generated_event";

export type MissionControlInspectionTimelineEntry = {
  id: string;
  eventType: string;
  status: string | null;
  detail: string;
  sourceType: string;
  sourceId: string;
  relatedId: number | null;
  provenance: MissionControlTimelineProvenance;
  occurredAt: Date | null;
  recordedAt: Date | null;
  observedAt: Date | null;
};

export type MissionControlInspectionTimelineScope = {
  companyId: number;
  inspectionId: number;
};

type TimelineExecutor = {
  select: (...args: any[]) => any;
};

/**
 * Read a privacy-minimal inspection timeline after its caller has validated
 * that the inspection belongs to the requested company.
 *
 * Mutable rows are represented as snapshots observed now, never as historical
 * status transitions. Only explicit event timestamps (sync attempts, audit
 * actions, capture time, and append-only events) populate occurredAt.
 */
export async function getMissionControlInspectionTimeline<
  TExecutor extends TimelineExecutor,
>(
  scope: MissionControlInspectionTimelineScope,
  executor: TExecutor = db as unknown as TExecutor,
): Promise<MissionControlInspectionTimelineEntry[]> {
  const { companyId, inspectionId } = scope;
  const observedAt = new Date();

  const [
    [inspection],
    media,
    analyses,
    syncAttempts,
    sessions,
    incidents,
    persistedEvents,
  ] = await Promise.all([
    executor
      .select({
        id: inspectionsTable.id,
        companyId: inspectionsTable.companyId,
        status: inspectionsTable.status,
        createdAt: inspectionsTable.createdAt,
      })
      .from(inspectionsTable)
      .where(
        and(
          eq(inspectionsTable.id, inspectionId),
          eq(inspectionsTable.companyId, companyId),
        ),
      ),
    executor
      .select({
        id: inspectionMediaTable.id,
        mediaType: inspectionMediaTable.mediaType,
        capturedAt: inspectionMediaTable.capturedAt,
        createdAt: inspectionMediaTable.createdAt,
      })
      .from(inspectionMediaTable)
      .where(
        and(
          eq(inspectionMediaTable.inspectionId, inspectionId),
          eq(inspectionMediaTable.companyId, companyId),
        ),
      ),
    executor
      .select({
        id: analysisResultsTable.id,
        status: analysisResultsTable.status,
        createdAt: analysisResultsTable.createdAt,
      })
      .from(analysisResultsTable)
      .where(
        and(
          eq(analysisResultsTable.inspectionId, inspectionId),
          eq(analysisResultsTable.companyId, companyId),
        ),
      ),
    executor
      .select({
        id: inspectionSyncLogsTable.id,
        systemType: inspectionSyncLogsTable.systemType,
        success: inspectionSyncLogsTable.success,
        syncedAt: inspectionSyncLogsTable.syncedAt,
      })
      .from(inspectionSyncLogsTable)
      .where(
        and(
          eq(inspectionSyncLogsTable.inspectionId, inspectionId),
          eq(inspectionSyncLogsTable.companyId, companyId),
        ),
      ),
    executor
      .select({
        id: metaGlassesSessionsTable.id,
        createdAt: metaGlassesSessionsTable.createdAt,
      })
      .from(metaGlassesSessionsTable)
      .where(
        and(
          eq(metaGlassesSessionsTable.inspectionId, inspectionId),
          eq(metaGlassesSessionsTable.companyId, companyId),
        ),
      ),
    executor
      .select({
        id: missionControlIncidentsTable.id,
        status: missionControlIncidentsTable.status,
        severity: missionControlIncidentsTable.severity,
        createdAt: missionControlIncidentsTable.createdAt,
      })
      .from(missionControlIncidentsTable)
      .where(
        and(
          eq(missionControlIncidentsTable.inspectionId, inspectionId),
          eq(missionControlIncidentsTable.companyId, companyId),
        ),
      ),
    executor
      .select()
      .from(missionControlInspectionEventsTable)
      .where(
        and(
          eq(missionControlInspectionEventsTable.inspectionId, inspectionId),
          eq(missionControlInspectionEventsTable.companyId, companyId),
        ),
      ),
  ]);

  // Audit rows have no company_id of their own. Restrict them through incident
  // IDs already selected by both authoritative scope columns; never query all
  // incident audit rows and filter their details in application code.
  const incidentIds = (incidents as Array<{ id: number }>).map((incident) =>
    String(incident.id),
  );
  const auditRows = incidentIds.length
    ? await executor
        .select({
          id: missionControlAuditTable.id,
          action: missionControlAuditTable.action,
          targetId: missionControlAuditTable.targetId,
          createdAt: missionControlAuditTable.createdAt,
        })
        .from(missionControlAuditTable)
        .where(
          and(
            eq(missionControlAuditTable.targetType, "incident"),
            inArray(missionControlAuditTable.targetId, incidentIds),
          ),
        )
    : [];

  const entries: MissionControlInspectionTimelineEntry[] = [];
  const numericRelatedId = (value: string): number | null => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  };
  if (inspection) {
    entries.push({
      id: `inspection:${inspection.id}`,
      eventType: "inspection_state_snapshot",
      status: inspection.status,
      detail: "Current inspection state observed",
      sourceType: "inspections",
      sourceId: String(inspection.id),
      relatedId: inspection.id,
      provenance: "current_state_derived",
      occurredAt: null,
      recordedAt: inspection.createdAt,
      observedAt,
    });
  }

  for (const row of media) {
    entries.push({
      id: `media:${row.id}`,
      eventType: "evidence_record_snapshot",
      status: "attached",
      detail: `${row.mediaType} evidence record observed`,
      sourceType: "inspection_media",
      sourceId: String(row.id),
      relatedId: row.id,
      provenance: "current_state_derived",
      occurredAt: row.capturedAt,
      recordedAt: row.createdAt,
      observedAt,
    });
  }

  for (const row of analyses) {
    entries.push({
      id: `analysis:${row.id}`,
      eventType: "analysis_result_snapshot",
      status: row.status,
      detail: "Current persisted analysis result observed",
      sourceType: "analysis_results",
      sourceId: String(row.id),
      relatedId: row.id,
      provenance: "current_state_derived",
      occurredAt: null,
      recordedAt: row.createdAt,
      observedAt,
    });
  }

  for (const row of sessions) {
    entries.push({
      id: `device-session:${row.id}`,
      eventType: "device_session_snapshot",
      status: "present",
      detail: "Current device session record observed",
      sourceType: "meta_glasses_sessions",
      sourceId: String(row.id),
      relatedId: row.id,
      provenance: "current_state_derived",
      occurredAt: null,
      recordedAt: row.createdAt,
      observedAt,
    });
  }

  for (const row of incidents) {
    entries.push({
      id: `incident:${row.id}`,
      eventType: "incident_state_snapshot",
      status: row.status,
      detail: `Current incident state observed (${row.severity} severity)`,
      sourceType: "mission_control_incidents",
      sourceId: String(row.id),
      relatedId: row.id,
      provenance: "current_state_derived",
      occurredAt: null,
      recordedAt: row.createdAt,
      observedAt,
    });
  }

  const mirroredSyncIds = new Set(
    (persistedEvents as Array<{ sourceRecordType: string; sourceRecordId: string }>)
      .filter((event) => event.sourceRecordType === "inspection_sync_logs")
      .map((event) => event.sourceRecordId),
  );
  for (const row of syncAttempts) {
    if (mirroredSyncIds.has(String(row.id))) continue;
    entries.push({
      id: `sync-attempt:${row.id}`,
      eventType: "sync_attempt",
      status: row.success ? "success" : "failed",
      detail: `External sync attempt ${row.success ? "succeeded" : "failed"} (${row.systemType})`,
      sourceType: "inspection_sync_logs",
      sourceId: String(row.id),
      relatedId: row.id,
      provenance: "persisted_historical_event",
      occurredAt: row.syncedAt,
      recordedAt: row.syncedAt,
      observedAt: null,
    });
  }

  // The unique source row is the event identity. This also protects against a
  // duplicate row returned by a future query join without collapsing distinct
  // actions that legitimately share an action name and timestamp.
  const newlyGeneratedAuditIds = new Set(
    (persistedEvents as Array<{
      sourceRecordType: string;
      sourceRecordId: string;
    }>)
      .filter((event) => event.sourceRecordType === "mission_control_audit")
      .map((event) => event.sourceRecordId),
  );
  const seenAuditIds = new Set<number>();
  for (const row of auditRows) {
    if (
      seenAuditIds.has(row.id) ||
      newlyGeneratedAuditIds.has(String(row.id))
    ) continue;
    seenAuditIds.add(row.id);
    entries.push({
      id: `incident-action:${row.id}`,
      eventType: row.action,
      status: null,
      detail: "Incident action recorded",
      sourceType: "mission_control_audit",
      sourceId: String(row.id),
      relatedId: numericRelatedId(row.targetId),
      provenance: "persisted_historical_event",
      occurredAt: row.createdAt,
      recordedAt: row.createdAt,
      observedAt: null,
    });
  }

  for (const row of persistedEvents) {
    entries.push({
      id: `mission-control-event:${row.id}`,
      eventType: row.eventType,
      status: null,
      detail: PROCESSING_MILESTONES[row.eventType as keyof typeof PROCESSING_MILESTONES]
        ?? "Inspection event recorded",
      sourceType: row.sourceRecordType,
      sourceId: row.sourceRecordId,
      relatedId: numericRelatedId(row.entityId),
      provenance: "newly_generated_event",
      occurredAt: row.occurredAt,
      recordedAt: row.recordedAt,
      observedAt: null,
    });
  }

  const orderTime = (entry: MissionControlInspectionTimelineEntry): number => {
    const value =
      entry.provenance === "current_state_derived"
        ? entry.observedAt
        : entry.occurredAt ?? entry.recordedAt;
    return value?.getTime() ?? Number.POSITIVE_INFINITY;
  };

  return entries.sort(
    (a, b) =>
      orderTime(a) - orderTime(b) ||
      a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
}