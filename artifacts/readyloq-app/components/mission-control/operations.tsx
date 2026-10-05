import React from "react";
import { MissionControlEvidenceAnalysisStatus, MissionControlEvidenceMediaType, useGetMissionControlInspection, useGetMissionControlInspectionAnalysis, useGetMissionControlInspectionEvidence, useListMissionControlInspectionEvidence } from "@workspace/api-client-react";
import type { MissionControlEvidenceAnalysisStatus as EvidenceAnalysisStatus, MissionControlEvidenceMediaType as EvidenceMediaType } from "@workspace/api-client-react";
import { Body, date, go, Label, Metric, QueryState, Row, Shell } from "./ui";
import { useRouter } from "expo-router";

const evidenceMediaTypes: EvidenceMediaType[] = Object.values(MissionControlEvidenceMediaType);
const evidenceAnalysisStatuses: EvidenceAnalysisStatus[] = Object.values(MissionControlEvidenceAnalysisStatus);
function filterValue<T extends string>(value: string | undefined, values: readonly T[]): T | undefined {
  return values.find(item => item === value);
}

export function InspectionEvidenceList({ inspectionId, linkedMediaType, linkedAnalysisStatus }: { inspectionId: number; linkedMediaType?: string; linkedAnalysisStatus?: string }) {
  const q = useListMissionControlInspectionEvidence(inspectionId), inspection = useGetMissionControlInspection(inspectionId), router = useRouter();
  const mediaType = filterValue(linkedMediaType, evidenceMediaTypes);
  const analysisStatus = filterValue(linkedAnalysisStatus, evidenceAnalysisStatuses);
  const filteredItems = q.data?.items.filter(item => (!mediaType || item.mediaType === mediaType) && (!analysisStatus || item.analysisStatus === analysisStatus)) ?? [];
  const expectedCount = mediaType && !analysisStatus
    ? mediaType === "photo" ? inspection.data?.mediaCounts.photos : mediaType === "video" ? inspection.data?.mediaCounts.videos : undefined
    : analysisStatus === "pending" && !mediaType
      ? inspection.data?.mediaCounts.pendingAnalysis
      : !mediaType && !analysisStatus
        ? inspection.data?.mediaCounts.total
        : undefined;
  const filterLabel = mediaType ? `MEDIA TYPE / ${mediaType.toUpperCase()}` : analysisStatus ? `ANALYSIS / ${analysisStatus.toUpperCase()}` : "ALL MEDIA";
  const invalidFilter = (linkedMediaType !== undefined && !mediaType) || (linkedAnalysisStatus !== undefined && !analysisStatus);
  return <Shell title={`Inspection #${inspectionId} evidence`} onRefresh={() => { void q.refetch(); void inspection.refetch(); }} refreshing={q.isRefetching || inspection.isRefetching}>
    <Label>{filterLabel} / {filteredItems.length} MATCHING RECORDS RETURNED</Label>
    {invalidFilter && <Body muted>An unsupported evidence filter was ignored. Results reflect only filters supported by the evidence API response.</Body>}
    <Body muted>The evidence endpoint returns up to 500 records without pagination. Inspection summary counts are server-provided; this list filters the persisted evidence records returned by the API.</Body>
    {q.data && expectedCount !== undefined && expectedCount !== filteredItems.length && <Body muted>{`The inspection summary reports ${expectedCount} matching records, while the evidence list returned ${filteredItems.length}. These counts may differ because the list endpoint is capped at 500 and does not paginate.`}</Body>}
    {q.data && expectedCount === undefined && (mediaType || analysisStatus) && <Body muted>No inspection summary metric exactly matches this filter; the count above reflects matching records returned by the evidence list.</Body>}
    {q.data ? filteredItems.length ? filteredItems.map(item => <Row key={item.id} title={item.filename ?? `${item.mediaType} evidence #${item.id}`} subtitle={`Processing ${item.processingStatus} · analysis ${item.analysisStatus} · ${item.captureSource}`} meta={`${date(item.capturedAt)} · EVIDENCE #${item.id}`} onPress={() => go(router, `/mission-control/inspections/${inspectionId}/evidence/${item.id}`)} />) : <Body muted>No returned evidence records match this filter.</Body> : <QueryState query={q} />}
  </Shell>;
}

export function EvidenceDetail({ inspectionId, evidenceId }: { inspectionId: number; evidenceId: number }) {
  const q = useGetMissionControlInspectionEvidence(inspectionId, evidenceId);
  return <Shell title={q.data?.filename ?? `Evidence #${evidenceId}`} onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}>
    {q.data ? <>
      <Label>INSPECTION #{q.data.inspectionId} / {q.data.mediaType.toUpperCase()}</Label>
      <Row title={`Evidence #${q.data.id}`} subtitle={`Company #${q.data.companyId} · ${q.data.captureSource}`} meta={`CAPTURED ${date(q.data.capturedAt)} · RECORDED ${date(q.data.createdAt)}`} />
      <Row title={`Processing: ${q.data.processingStatus}`} subtitle={`Analysis: ${q.data.analysisStatus}`} meta={`Zone: ${q.data.zone ?? "Not recorded"}`} />
      <Metric value={q.data.qualityScore ?? "—"} label="Quality score" />
      <Row title={`Provider: ${q.data.provider ?? "Not reported"}`} subtitle={`Model: ${q.data.model ?? "Not reported"}`} />
      {q.data.error && <Row title="Processing error" subtitle={q.data.error} />}
      <Label>STORED FINDINGS / {q.data.findings.length}</Label>
      {q.data.findings.length ? q.data.findings.map(f => <Row key={f.id} title={`${f.category} · ${f.severity}`} subtitle={f.description} meta={`Finding #${f.id} · Confidence ${f.confidence} · ${f.location ?? "Location not recorded"}`} />) : <Body muted>No findings are recorded for this evidence item.</Body>}
      <Body muted>Private media storage URLs are not exposed by the Mission Control API.</Body>
    </> : <QueryState query={q} />}
  </Shell>;
}

export function InspectionAnalysis({ inspectionId }: { inspectionId: number }) {
  const q = useGetMissionControlInspectionAnalysis(inspectionId);
  return <Shell title={`Inspection #${inspectionId} AI`} onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}>
    {q.data ? <>
      <Label>PERSISTED ANALYSIS / {q.data.state.toUpperCase()}</Label>
      <Row title={`Latest analysis #${q.data.latestAnalysisId ?? "not recorded"}`} subtitle={`Provider: ${q.data.provider ?? "Not reported"} · Model: ${q.data.model ?? "Not reported"}`} />
      <Label>ANALYSIS RUNS / {q.data.runs.length}</Label>
      {q.data.runs.length ? q.data.runs.map(run => <React.Fragment key={run.id}>
        <Row key={`run-${run.id}`} title={`Run #${run.id} · ${run.state}`} subtitle={run.error ?? undefined} meta={`RESULT RECORDED ${date(run.recordedAt)}${run.analysisErrors == null ? "" : ` · ${run.analysisErrors} errors`}`} />
        <Body key={`coverage-${run.id}`} muted>{`Required: ${run.requiredZones.map(z => z.label).join(", ") || "None recorded"} · Covered: ${run.coveredZones.map(z => z.label).join(", ") || "None recorded"} · Uncovered: ${run.uncoveredZones.map(z => z.label).join(", ") || "None recorded"}`}</Body>
        {run.findings.map(f => <Row key={`run-${run.id}-finding-${f.id}`} title={`${f.category} · ${f.severity}`} subtitle={f.description} meta={`Finding #${f.id} · Confidence ${f.confidence} · ${f.location ?? "Location not recorded"}`} />)}
        {!run.findings.length && <Body key={`empty-${run.id}`} muted>No persisted findings in this run.</Body>}
      </React.Fragment>) : <Body muted>No persisted analysis runs are available for this inspection.</Body>}
    </> : <QueryState query={q} empty="AI analysis detail is unavailable." />}
  </Shell>;
}