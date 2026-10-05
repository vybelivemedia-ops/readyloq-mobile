import React, { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { ListMissionControlCompaniesAccessStatus, ListMissionControlIncidentsActiveOnly, ListMissionControlIncidentsHasSession, ListMissionControlIncidentsSourceType, ListMissionControlInspectionsAnalysisStatus, ListMissionControlInspectionsCreatedToday, ListMissionControlInspectionsSyncStatus, ListMissionControlTechniciansCompanyAccess, MissionControlIncidentSeverity, MissionControlIncidentStatus, useGetMissionControlMe, useGetMissionControlOverview, useListMissionControlCompanies, useListMissionControlTechnicians, useListMissionControlInspections, useListMissionControlIncidents, useListMissionControlAudit } from "@workspace/api-client-react";
import type { ListMissionControlCompaniesAccessStatus as CompanyAccessStatus, ListMissionControlIncidentsActiveOnly as IncidentActiveOnly, ListMissionControlIncidentsHasSession as IncidentHasSession, ListMissionControlIncidentsSourceType as IncidentSourceType, ListMissionControlInspectionsAnalysisStatus as InspectionAnalysisStatus, ListMissionControlInspectionsCreatedToday as InspectionCreatedToday, ListMissionControlInspectionsSyncStatus as InspectionSyncStatus, ListMissionControlTechniciansCompanyAccess as TechnicianCompanyAccess, MissionControlIncidentSeverity as IncidentSeverity, MissionControlIncidentStatus as IncidentStatus } from "@workspace/api-client-react";
import { Action, Body, date, Field, go, Label, Metric, Pager, QueryState, Row, Shell } from "./ui";
import { ScopePicker, useScope } from "./scope";

type InspectionStatus = "pending" | "processing" | "completed";
const inspectionStatuses: InspectionStatus[] = ["pending", "processing", "completed"];
const inspectionSyncStatuses: InspectionSyncStatus[] = Object.values(ListMissionControlInspectionsSyncStatus);
const inspectionAnalysisStatuses: InspectionAnalysisStatus[] = Object.values(ListMissionControlInspectionsAnalysisStatus);
const inspectionCreatedTodayValues: InspectionCreatedToday[] = Object.values(ListMissionControlInspectionsCreatedToday);
const incidentStatuses: IncidentStatus[] = Object.values(MissionControlIncidentStatus);
const incidentSeverities: IncidentSeverity[] = Object.values(MissionControlIncidentSeverity);
const incidentSourceTypes: IncidentSourceType[] = Object.values(ListMissionControlIncidentsSourceType);
const companyAccessStatuses: CompanyAccessStatus[] = Object.values(ListMissionControlCompaniesAccessStatus);
const technicianCompanyAccessValues: TechnicianCompanyAccess[] = Object.values(ListMissionControlTechniciansCompanyAccess);
const incidentActiveOnlyValues: IncidentActiveOnly[] = Object.values(ListMissionControlIncidentsActiveOnly);
const incidentHasSessionValues: IncidentHasSession[] = Object.values(ListMissionControlIncidentsHasSession);
function validFilterValue<T extends string>(value: string | undefined, values: readonly T[]): T | undefined {
  return values.find(candidate => candidate === value);
}

export function Overview() {
  const me = useGetMissionControlMe(), q = useGetMissionControlOverview(), r = useRouter(), colors = useColors();
  const { setCompanyId } = useScope();
  const drilldown = (path: string) => { setCompanyId(undefined); go(r, path); };
  return <Shell title="Mission Control" onRefresh={() => { void q.refetch(); void me.refetch(); }} refreshing={q.isRefetching}>
    {me.isLoading ? <QueryState query={me} /> : me.isError ? <QueryState query={me} /> : !me.data?.isSuperAdmin ? <Row title="Restricted" subtitle="This surface is reserved for platform administrators." /> : <>
      <Label>PLATFORM PULSE</Label>
       {q.data ? <><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
           <Metric value={q.data.kpis.activeCompanyCount} label="Active companies" onPress={() => drilldown("/mission-control/companies?accessStatus=enabled")} testID="metric-active-companies" />
           <Metric value={q.data.kpis.activeTechnicianCount} label="Active technicians" onPress={() => drilldown("/mission-control/technicians?companyAccess=enabled")} testID="metric-technicians" />
          <Metric value={q.data.kpis.inspectionCount} label="Inspections" onPress={() => drilldown("/mission-control/inspections")} testID="metric-inspections" />
           <Metric value={q.data.kpis.inspectionsTodayCount} label="Inspections today" onPress={() => drilldown("/mission-control/inspections?createdToday=true")} testID="metric-inspections-today" />
          <Metric value={q.data.kpis.inspectionsProcessingCount} label="Processing" onPress={() => drilldown("/mission-control/inspections?status=processing")} testID="metric-inspections-processing" />
          <Metric value={q.data.kpis.inspectionsCompletedCount} label="Completed" onPress={() => drilldown("/mission-control/inspections?status=completed")} testID="metric-inspections-completed" />
          <Metric value={q.data.kpis.failedSyncCount} label="Failed syncs" onPress={() => drilldown("/mission-control/inspections?syncStatus=failed")} testID="metric-failed-syncs" />
          <Metric value={q.data.kpis.failedAnalysisCount} label="Failed analysis" onPress={() => drilldown("/mission-control/inspections?analysisStatus=failed")} testID="metric-failed-analysis" />
          <Metric value={q.data.kpis.pendingAnalysisCount} label="Pending analysis" onPress={() => drilldown("/mission-control/inspections?analysisStatus=pending")} testID="metric-pending-analysis" />
           <Metric value={q.data.kpis.openIncidentCount} label="Active incidents" onPress={() => drilldown("/mission-control/incidents?activeOnly=true")} testID="metric-open-incidents" />
          <Metric value={q.data.kpis.pendingApprovalCount} label="Pending approvals" onPress={() => drilldown("/mission-control/approvals?status=pending")} testID="metric-pending-approvals" />
           <Metric value={q.data.kpis.problemDeviceSessionCount} label="Active incident records linked to sessions" onPress={() => drilldown("/mission-control/incidents?activeOnly=true&hasSession=true")} testID="metric-problem-sessions" />
           <Metric value={q.data.kpis.unacknowledgedAlertCount} label="Unacknowledged alerts" onPress={() => drilldown("/mission-control/incidents?status=open&activeOnly=true")} testID="metric-unacknowledged-alerts" />
         </View><Body muted>The session-linked KPI counts active incident records (not distinct sessions). Incident drill-downs show the server-filtered total and results, with pagination.</Body><Label>LIVE SIGNALS</Label>{q.data.recentAlerts.length ? q.data.recentAlerts.map(a => <Row key={a.id} title={a.title} subtitle={a.message} meta={`${a.severity.toUpperCase()} · ${date(a.createdAt)}`} tone={a.severity === "critical" ? colors.destructive : undefined} onPress={a.companyId ? () => go(r, `/mission-control/companies/${a.companyId}`) : undefined} />) : <Row title="No recent alerts" subtitle={q.data.kpis.unacknowledgedAlertCount ? `${q.data.kpis.unacknowledgedAlertCount} unacknowledged alerts are counted, but no recent alert record is available to display.` : "No recent alerts are available from the platform API."} />}</> : <QueryState query={q} />}
      <ScopePicker />
    </>}
  </Shell>;
}
export function Companies() {
  const { accessStatus: linkedAccessStatus } = useLocalSearchParams<{ accessStatus?: string }>();
  const [search, setSearch] = useState(""), [page, setPage] = useState(1), [accessOverride, setAccessOverride] = useState<CompanyAccessStatus | "" | null>(null);
  const accessStatus = accessOverride === null ? validFilterValue(linkedAccessStatus, companyAccessStatuses) : accessOverride || undefined;
  const q = useListMissionControlCompanies({ page, limit: 20, search: search.trim() || undefined, accessStatus }), r = useRouter();
  return <Shell title="Companies" onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}><ScopePicker /><Label>DIRECTORY / {q.data?.total ?? "—"}</Label><Field value={search} onChangeText={v => { setSearch(v); setPage(1); }} placeholder="Search companies" />
    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}><Action label="All access states" onPress={() => { setAccessOverride(""); setPage(1); }} />{companyAccessStatuses.map(v => <Action key={v} label={v} onPress={() => { setAccessOverride(v); setPage(1); }} />)}</View>
    <Body muted>Access filter: {accessStatus ?? "all"}</Body>
    {q.data ? q.data.items.length ? <>{q.data.items.map(x => <Row key={x.id} title={x.name} subtitle={`${x.accessStatus} · ${x.userCount} people · ${x.technicianCount} technicians · ${x.inspectionCount} inspections`} meta={`LAST ACTIVITY ${date(x.lastActivityAt)} · ${x.openIncidentCount} open incidents · ${x.failedSyncCount} sync failures · ${x.failedAnalysisCount} failed analyses`} onPress={() => go(r, `/mission-control/companies/${x.id}`)} />)}<Pager page={page} total={q.data.totalPages} onChange={setPage} /></> : <QueryState query={q} empty="No companies match this search and access filter." /> : <QueryState query={q} />}
  </Shell>;
}
export function Technicians() {
  const { companyId } = useScope(); const { companyId: linkedCompany, companyAccess: linkedCompanyAccess } = useLocalSearchParams<{ companyId?: string; companyAccess?: string }>(); const linkedId = Number(linkedCompany);
  const effectiveCompanyId = companyId ?? (Number.isSafeInteger(linkedId) && linkedId > 0 ? linkedId : undefined);
  const [search, setSearch] = useState(""), [page, setPage] = useState(1), [accessOverride, setAccessOverride] = useState<TechnicianCompanyAccess | "" | null>(null), r = useRouter();
  const companyAccess = accessOverride === null ? validFilterValue(linkedCompanyAccess, technicianCompanyAccessValues) : accessOverride || undefined;
  const q = useListMissionControlTechnicians({ companyId: effectiveCompanyId, companyAccess, search: search.trim() || undefined, page, limit: 20 });
  return <Shell title="Technicians" onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}><ScopePicker />{effectiveCompanyId && <Body muted>Company filter: #{effectiveCompanyId} · platform authorization unchanged</Body>}<Label>FIELD PERSONNEL / {q.data?.total ?? "—"}</Label><Field value={search} onChangeText={v => { setSearch(v); setPage(1); }} placeholder="Search technicians" />
    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}><Action label="All company access states" onPress={() => { setAccessOverride(""); setPage(1); }} />{technicianCompanyAccessValues.map(v => <Action key={v} label={`Company ${v}`} onPress={() => { setAccessOverride(v); setPage(1); }} />)}</View>
    <Body muted>Company access filter: {companyAccess ?? "all"}</Body>
    {q.data ? q.data.items.length ? <>{q.data.items.map(x => <Row key={x.id} title={x.name ?? "Name not recorded"} subtitle={`${x.companyName} · ${x.status} · ${x.inspectionCount} inspections`} meta={`LAST ACTIVE ${date(x.lastActiveAt)} · ${x.failedSyncCount} sync failures · ${x.failedAnalysisCount} failed analyses · ${x.pendingAnalysisCount} pending`} onPress={() => go(r, `/mission-control/technicians/${encodeURIComponent(x.id)}`)} />)}<Pager page={page} total={q.data.totalPages} onChange={setPage} /></> : <QueryState query={q} /> : <QueryState query={q} />}
  </Shell>;
}
export function Inspections() {
  const { companyId } = useScope(); const { companyId: linkedCompany, technicianId: linkedTechnicianId, createdToday: linkedCreatedToday, status: linkedStatus, syncStatus: linkedSyncStatus, analysisStatus: linkedAnalysisStatus } = useLocalSearchParams<{ companyId?: string; technicianId?: string; createdToday?: string; status?: string; syncStatus?: string; analysisStatus?: string }>();
  const linkedCompanyId = Number(linkedCompany), effectiveCompanyId = companyId ?? (Number.isSafeInteger(linkedCompanyId) && linkedCompanyId > 0 ? linkedCompanyId : undefined);
  const [search, setSearch] = useState(""), [page, setPage] = useState(1), [statusOverride, setStatusOverride] = useState<InspectionStatus | "" | null>(null);
  const [syncOverride, setSyncOverride] = useState<InspectionSyncStatus | "" | null>(null), [analysisOverride, setAnalysisOverride] = useState<InspectionAnalysisStatus | "" | null>(null), r = useRouter();
  const [technicianOverride, setTechnicianOverride] = useState<string | null>(null), [createdTodayOverride, setCreatedTodayOverride] = useState<InspectionCreatedToday | "" | null>(null);
  const technicianId = technicianOverride === null ? linkedTechnicianId?.trim() || undefined : technicianOverride.trim() || undefined;
  const createdToday = createdTodayOverride === null ? validFilterValue(linkedCreatedToday, inspectionCreatedTodayValues) : createdTodayOverride || undefined;
  const status = statusOverride === null ? validFilterValue(linkedStatus, inspectionStatuses) : statusOverride || undefined;
  const syncStatus = syncOverride === null ? validFilterValue(linkedSyncStatus, inspectionSyncStatuses) : syncOverride || undefined;
  const analysisStatus = analysisOverride === null ? validFilterValue(linkedAnalysisStatus, inspectionAnalysisStatuses) : analysisOverride || undefined;
  const q = useListMissionControlInspections({ companyId: effectiveCompanyId, technicianId, createdToday, search: search.trim() || undefined, status, syncStatus, analysisStatus, page, limit: 20 });
  return <Shell title="Inspections" onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}><ScopePicker />{effectiveCompanyId && <Body muted>Company filter: #{effectiveCompanyId} · platform authorization unchanged</Body>}<Label>CAPTURE ACTIVITY / {q.data?.total ?? "—"}</Label><Field value={search} onChangeText={v => { setSearch(v); setPage(1); }} placeholder="Search inspections" />
    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
      <Action label="All statuses" onPress={() => { setStatusOverride(""); setPage(1); }} />
      {inspectionStatuses.map(v => <Action key={v} label={v} onPress={() => { setStatusOverride(v); setPage(1); }} />)}
      {inspectionSyncStatuses.map(v => <Action key={`sync-${v}`} label={`Sync ${v}`} onPress={() => { setSyncOverride(v); setPage(1); }} />)}
      {inspectionAnalysisStatuses.map(v => <Action key={`analysis-${v}`} label={`Analysis ${v}`} onPress={() => { setAnalysisOverride(v); setPage(1); }} />)}
      {inspectionCreatedTodayValues.map(v => <Action key={`created-${v}`} label={v === "true" ? "Created today" : "Not created today"} onPress={() => { setCreatedTodayOverride(v); setPage(1); }} />)}
      <Action label="Any date" onPress={() => { setCreatedTodayOverride(""); setPage(1); }} />
      <Action label="Clear inspection filters" onPress={() => { setStatusOverride(""); setSyncOverride(""); setAnalysisOverride(""); setTechnicianOverride(""); setCreatedTodayOverride(""); setPage(1); }} />
    </View><Body muted>Filters: status {status ?? "all"} · sync {syncStatus ?? "all"} · analysis {analysisStatus ?? "all"} · created today {createdToday ?? "all"} · technician {technicianId ?? "all"}</Body>
    {q.data ? q.data.items.length ? <>{q.data.items.map(x => <Row key={x.id} title={x.siteAddress || `Inspection #${x.id}`} subtitle={`${x.companyName} · ${x.technicianName ?? "Unassigned"}`} meta={`#${x.id} · ${x.status.toUpperCase()} · ${date(x.createdAt)}`} onPress={() => go(r, `/mission-control/inspections/${x.id}`)} />)}<Pager page={page} total={q.data.totalPages} onChange={setPage} /></> : <QueryState query={q} /> : <QueryState query={q} />}
  </Shell>;
}
export function Incidents() {
  const colors = useColors();
  const { companyId } = useScope(); const { companyId: linkedCompany, status: linkedStatus, severity: linkedSeverity, sourceType: linkedSourceType, activeOnly: linkedActiveOnly, hasSession: linkedHasSession } = useLocalSearchParams<{ companyId?: string; status?: string; severity?: string; sourceType?: string; activeOnly?: string; hasSession?: string }>(); const linkedId = Number(linkedCompany);
  const effectiveCompanyId = companyId ?? (Number.isSafeInteger(linkedId) && linkedId > 0 ? linkedId : undefined);
  const [page, setPage] = useState(1), [statusOverride, setStatusOverride] = useState<IncidentStatus | "" | null>(null);
  const [severityOverride, setSeverityOverride] = useState<IncidentSeverity | "" | null>(null), [sourceOverride, setSourceOverride] = useState<IncidentSourceType | "" | null>(null), r = useRouter();
  const [activeOverride, setActiveOverride] = useState<IncidentActiveOnly | "" | null>(null), [sessionOverride, setSessionOverride] = useState<IncidentHasSession | "" | null>(null);
  const status = statusOverride === null ? validFilterValue(linkedStatus, incidentStatuses) : statusOverride || undefined;
  const severity = severityOverride === null ? validFilterValue(linkedSeverity, incidentSeverities) : severityOverride || undefined;
  const sourceType = sourceOverride === null ? validFilterValue(linkedSourceType, incidentSourceTypes) : sourceOverride || undefined;
  const activeOnly = activeOverride === null ? validFilterValue(linkedActiveOnly, incidentActiveOnlyValues) : activeOverride || undefined;
  const hasSession = sessionOverride === null ? validFilterValue(linkedHasSession, incidentHasSessionValues) : sessionOverride || undefined;
  const q = useListMissionControlIncidents({ companyId: effectiveCompanyId, status, severity, sourceType, activeOnly, hasSession, page, limit: 20 });
   return <Shell title="Incidents" onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}><ScopePicker />{effectiveCompanyId && <Body muted>Company scope: #{effectiveCompanyId}</Body>}<Label>SERVER RESPONSE QUEUE / {q.data?.total ?? "—"}</Label>
     <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Action label="All" onPress={() => { setStatusOverride(""); setPage(1); }} />
        {incidentStatuses.map(v => <Action key={v} label={v} onPress={() => { setStatusOverride(v); setPage(1); }} />)}
        {incidentSeverities.map(v => <Action key={`severity-${v}`} label={v} onPress={() => { setSeverityOverride(v); setPage(1); }} />)}
        {incidentSourceTypes.map(v => <Action key={`source-${v}`} label={v.replace("_", " ")} onPress={() => { setSourceOverride(v); setPage(1); }} />)}
        <Action label="Any activity" onPress={() => { setActiveOverride(""); setPage(1); }} />
        <Action label="Active only" onPress={() => { setActiveOverride(ListMissionControlIncidentsActiveOnly.true); setPage(1); }} />
        <Action label="Any session" onPress={() => { setSessionOverride(""); setPage(1); }} />
        <Action label="Has session" onPress={() => { setSessionOverride(ListMissionControlIncidentsHasSession.true); setPage(1); }} />
        <Action label="Clear all incident filters" onPress={() => { setStatusOverride(""); setSeverityOverride(""); setSourceOverride(""); setActiveOverride(""); setSessionOverride(""); setPage(1); }} />
       </View><Body muted>Server filters: status {status ?? "all"} · severity {severity ?? "all"} · source {sourceType ?? "all"} · active only {activeOnly ?? "all"} · has session {hasSession ?? "all"}. Total is the matching server result count; pages contain server-filtered records.</Body>
     {q.data ? q.data.items.length ? <>{q.data.items.map(x => <Row key={x.id} title={x.title} subtitle={`${x.companyName} · ${x.description}`} meta={`${x.severity.toUpperCase()} · ${x.status.toUpperCase()} · ${date(x.createdAt)}`} tone={x.severity === "critical" ? colors.destructive : undefined} onPress={() => go(r, `/mission-control/incidents/${x.id}`)} />)}<Pager page={page} total={q.data.totalPages} onChange={setPage} /></> : <QueryState query={q} /> : <QueryState query={q} />}
  </Shell>;
}
export function Audit() {
  const { action: linkedAction, targetType: linkedTargetType, targetId: linkedTargetId } = useLocalSearchParams<{ action?: string; targetType?: string; targetId?: string }>();
  const [page, setPage] = useState(1), [actionOverride, setActionOverride] = useState<string | null>(null); const action = actionOverride ?? linkedAction ?? "";
  const targetIdNumber = Number(linkedTargetId);
  const targetFilter = linkedTargetType === "incident" && Number.isSafeInteger(targetIdNumber) && targetIdNumber > 0
    ? { targetType: "incident", targetId: String(targetIdNumber) }
    : undefined;
  const q = useListMissionControlAudit({ page, limit: 20, action: action.trim() || undefined, targetType: targetFilter?.targetType, targetId: targetFilter?.targetId }), r = useRouter();
  return <Shell title="Audit trail" onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}><Label>{targetFilter ? `INCIDENT #${targetFilter.targetId} ACTIONS / ${q.data?.total ?? "—"}` : `GOVERNED ACTIVITY / ${q.data?.total ?? "—"}`}</Label><Field value={action} onChangeText={v => { setActionOverride(v); setPage(1); }} placeholder="Filter by action" />
    {targetFilter && <Body muted>Action filter applies only to incident #{targetFilter.targetId}; clearing it shows all audit actions for this incident.</Body>}
    {q.data ? <>
      {q.data.items.length ? q.data.items.map(x => {
        const targetPath = auditTargetPath(x.targetType, x.targetId);
        return <Row key={x.id} title={x.action} subtitle={`${x.actorName || x.actorId} → ${x.targetType} #${x.targetId}`} meta={`${date(x.createdAt)}${x.details ? ` · ${x.details}` : ""}`} onPress={targetPath ? () => go(r, targetPath) : undefined} />;
      }) : <QueryState query={q} empty={targetFilter ? "No audit actions are recorded for this incident and action filter." : "No audit actions are recorded."} />}
      {q.data.totalPages > 1 && <Pager page={page} total={q.data.totalPages} onChange={setPage} />}
    </> : <QueryState query={q} />}
  </Shell>;
}

function auditTargetPath(targetType: string, targetId: string): string | undefined {
  const id = Number(targetId), validNumericId = Number.isSafeInteger(id) && id > 0;
  if (targetType === "company" && validNumericId) return `/mission-control/companies/${id}`;
  if (targetType === "property" && validNumericId) return `/mission-control/properties/${id}`;
  if (targetType === "inspection" && validNumericId) return `/mission-control/inspections/${id}`;
  if (targetType === "incident" && validNumericId) return `/mission-control/incidents/${id}`;
  if (targetType === "technician") return `/mission-control/technicians/${encodeURIComponent(targetId)}`;
  if (targetType === "user") return `/mission-control/search?q=${encodeURIComponent(targetId)}`;
  return undefined;
}