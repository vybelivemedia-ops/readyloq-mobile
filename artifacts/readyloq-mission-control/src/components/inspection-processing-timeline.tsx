import { getGetMissionControlInspectionTimelineQueryKey, useGetMissionControlInspectionTimeline } from "@workspace/api-client-react";

const milestones = [
  ["inspection.created", "Inspection creation"],
  ["evidence.captured", "Device-reported capture"],
  ["upload.reserved", "Upload reservation"],
  ["evidence.registered", "Evidence registration"],
  ["analysis.attempt_started", "AI attempt start"],
  ["analysis.result_saved", "Analysis result"],
  ["inspection.completed", "Inspection completion"],
] as const;

const time = (value: string | null) => value ? new Date(value).toLocaleString() : "Not recorded";

export function InspectionProcessingTimeline({ inspectionId }: { inspectionId: number }) {
  const query = useGetMissionControlInspectionTimeline(inspectionId, {
    query: { queryKey: getGetMissionControlInspectionTimelineQueryKey(inspectionId),
      refetchInterval: 30_000, staleTime: 0 },
  });
  const entries = query.data?.items ?? [];
  const missing = milestones.filter(([type]) => !entries.some(
    (entry) => entry.provenance === "newly_generated_event" && entry.eventType === type,
  ));
  const hasSyncHistory = entries.some((entry) => entry.provenance !== "current_state_derived"
    && (entry.sourceType === "inspection_sync_logs" || entry.sourceType === "enterprise_outbox"));

  return (
    <section className="surface overflow-hidden mt-5" data-testid="inspection-processing-timeline">
      <div className="p-6 border-b border-[#e4e9e3]">
        <div className="eyebrow">PROCESSING / PROVENANCE</div>
        <h2 className="display text-2xl font-bold mt-2">Inspection lifecycle</h2>
        <p className="text-sm text-[#70817e] mt-2">
          Recorded events are historical facts. Current-state snapshots are not past transitions.
          Missing milestones may not have occurred or may predate event recording; legacy history is never reconstructed.
        </p>
        <button className="btn btn-light mt-3" onClick={() => query.refetch()}>Refresh lifecycle</button>
      </div>
      {query.isLoading ? <p className="p-6">Loading recorded history…</p>
        : query.isError ? <div className="p-6" role="alert">
          Processing history unavailable. <button className="btn btn-light" onClick={() => query.refetch()}>Try again</button>
        </div> : <>
          {entries.map((entry) => (
            <div className="row-link items-start" key={entry.id} data-testid={`processing-event-${entry.id}`}>
              <div className="min-w-0 flex-1">
                <div className="font-bold">{entry.detail}</div>
                <div className="text-xs text-[#70817e] mt-1 break-all">
                  {entry.eventType} · {entry.sourceType} #{entry.sourceId}
                </div>
                <div className="text-xs text-[#70817e] mt-1">
                  {entry.provenance === "current_state_derived"
                    ? `Snapshot observed ${time(entry.observedAt)}`
                    : `Occurred ${time(entry.occurredAt)} · Recorded ${time(entry.recordedAt)}`}
                </div>
              </div>
              <span className="status shrink-0">
                {entry.provenance === "current_state_derived" ? "Current snapshot"
                  : entry.provenance === "newly_generated_event" ? "Recorded lifecycle event" : "Recorded history"}
              </span>
            </div>
          ))}
          {(missing.length > 0 || !hasSyncHistory) && <div className="p-6 text-sm text-[#70817e]" data-testid="unavailable-milestones">
            <strong>Milestones unavailable:</strong> {[...missing.map(([, label]) => label),
              ...(!hasSyncHistory ? ["External synchronization"] : [])].join(", ")}.
            No timestamp or event is inferred for these steps.
          </div>}
        </>}
    </section>
  );
}
