import React, { useState } from "react";
import { Alert, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useGetMissionControlCompany, useGetMissionControlTechnician, useGetMissionControlInspection, useGetMissionControlDeviceSession, useGetMissionControlIncident, useListMissionControlIncidents, useUpdateMissionControlIncident, getGetMissionControlIncidentQueryKey, useGetMissionControlInspectionAnalysis, useGetMissionControlInspectionTimeline, useListMissionControlInspectionEvidence, useListMissionControlProperties } from "@workspace/api-client-react";
import type { IncidentUpdateAction, IncidentUpdateSeverity } from "@workspace/api-client-react";
import { Action, Body, date, errorText, Field, go, Label, Metric, QueryState, Row, Shell } from "./ui";
import { ScopePicker, useScope } from "./scope";
import { RequestAccess } from "./governance";

export function CompanyDetail({ id }: { id: number }) {
  const q = useGetMissionControlCompany(id), properties = useListMissionControlProperties({ companyId: id, page: 1, limit: 20 });
  const incidents = useListMissionControlIncidents({ companyId: id, page: 1, limit: 20 });
  const { setCompanyId } = useScope(); const r = useRouter();
  const openCompanyList = (path: string) => {
    setCompanyId(id, q.data?.name);
    go(r, `${path}${path.includes("?") ? "&" : "?"}companyId=${id}`);
  };
  return <Shell title={q.data?.name ?? `Company #${id}`} onRefresh={() => { void q.refetch(); void properties.refetch(); void incidents.refetch(); }} refreshing={q.isRefetching || properties.isRefetching || incidents.isRefetching}>
    {q.data ? <><Label>ACCOUNT / {q.data.accessStatus.toUpperCase()}</Label><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
        <Metric value={q.data.userCount} label="People" onPress={() => go(r, `/mission-control/companies/${id}/team`)} />
        <Metric value={q.data.technicianCount} label="Technicians" onPress={() => openCompanyList("/mission-control/technicians")} />
        <Metric value={q.data.inspectionCount} label="Inspections" onPress={() => openCompanyList("/mission-control/inspections")} />
        <Metric value={q.data.openIncidentCount} label="Open incidents" onPress={() => openCompanyList("/mission-control/incidents?activeOnly=true")} />
      </View>
      <Label>OPERATIONAL SIGNALS</Label><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
        <Metric value={q.data.inspectionsTodayCount} label="Inspections today" onPress={() => openCompanyList("/mission-control/inspections?createdToday=true")} />
        <Metric value={q.data.inspectionsProcessingCount} label="Processing" onPress={() => openCompanyList("/mission-control/inspections?status=processing")} />
        <Metric value={q.data.inspectionsCompletedCount} label="Completed" onPress={() => openCompanyList("/mission-control/inspections?status=completed")} />
        <Metric value={q.data.failedSyncCount} label="Failed syncs" onPress={() => openCompanyList("/mission-control/inspections?syncStatus=failed")} />
        <Metric value={q.data.failedAnalysisCount} label="Failed analysis" onPress={() => openCompanyList("/mission-control/inspections?analysisStatus=failed")} />
        <Metric value={q.data.pendingAnalysisCount} label="Pending analysis" onPress={() => openCompanyList("/mission-control/inspections?analysisStatus=pending")} />
      </View><Body muted>Created-today results use the same server time boundary as this company metric.</Body>
      {q.data.owner ? <Row title={q.data.owner.name ?? "Name not recorded"} subtitle={q.data.owner.email ?? "Email not recorded"} meta="ACCOUNT OWNER" /> : <Row title="Owner not assigned" subtitle="This company has no owner record." meta="ACCOUNT OWNER" />}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}><Action label="Company technicians" onPress={() => openCompanyList("/mission-control/technicians")} /><Action label="Company incidents" onPress={() => openCompanyList("/mission-control/incidents")} /><Action label="Company properties" onPress={() => openCompanyList("/mission-control/properties")} /></View>
      <Label>ACCESS CONTROL</Label><RequestAccess targetType="company" targetId={String(id)} currentEnabled={q.data.accessStatus === "enabled"} />
      <Label>TEAM / {q.data.users.length} RETURNED</Label><Body muted>The company detail API returns up to 250 users and does not provide paginated user results; this may not be the complete company roster.</Body>{q.data.users.length ? q.data.users.map(u => <View key={u.id}><Row title={u.name ?? "Name not recorded"} subtitle={`${u.email ?? "Email not recorded"} · ${u.role ?? "No role"}`} meta={`BETA ACCESS ${u.betaAccessEnabled ? "ENABLED" : "DISABLED"}`} onPress={u.role === "technician" ? () => go(r, `/mission-control/technicians/${encodeURIComponent(u.id)}`) : undefined} /><RequestAccess targetType="user" targetId={u.id} currentEnabled={u.betaAccessEnabled} /></View>) : <Body muted>No team members are recorded for this company.</Body>}
      <Label>PROPERTY INVENTORY / {properties.data?.total ?? "—"}</Label>{properties.data ? properties.data.items.length ? properties.data.items.map(x => <Row key={x.id} title={x.siteAddress} subtitle={x.propertyType ?? "Type not set"} meta={`PROPERTY #${x.id} · ${x.inspectionCount} inspections`} onPress={() => go(r, `/mission-control/properties/${x.id}`)} />) : <Body muted>No properties found for this company.</Body> : <QueryState query={properties} />}
      <Label>RECENT INSPECTIONS / {q.data.recentInspections.length}</Label>{q.data.recentInspections.length ? q.data.recentInspections.map(x => <Row key={x.id} title={x.siteAddress ?? `Inspection #${x.id}`} subtitle={x.technicianName ?? "Unassigned"} meta={date(x.createdAt)} onPress={() => go(r, `/mission-control/inspections/${x.id}`)} />) : <Body muted>No recent inspection records are available for this company.</Body>}
      <Label>INCIDENTS / {incidents.data?.total ?? "—"}</Label>{incidents.data ? incidents.data.items.length ? incidents.data.items.map(x => <Row key={x.id} title={x.title} subtitle={`${x.severity} · ${x.status}`} meta={`INCIDENT #${x.id} · ${date(x.createdAt)}`} onPress={() => go(r, `/mission-control/incidents/${x.id}`)} />) : <Body muted>No incidents recorded for this company.</Body> : <QueryState query={incidents} />}
    </> : <QueryState query={q} />}
  </Shell>;
}
export function TechnicianDetail({ id }: { id: string }) {
  const q = useGetMissionControlTechnician(id), r = useRouter();
  const { setCompanyId } = useScope();
  const openInspectionHistory = (filter?: string) => {
    if (!q.data) return;
    setCompanyId(q.data.companyId, q.data.companyName);
    const base = `/mission-control/inspections?companyId=${q.data.companyId}&technicianId=${encodeURIComponent(q.data.id)}`;
    go(r, filter ? `${base}&${filter}` : base);
  };
  return <Shell title={q.data?.name ?? "Technician"} onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}>
    {q.data ? <><Label>FIELD IDENTITY</Label><Row title={q.data.companyName} subtitle={`Status: ${q.data.status}`} meta={`TECHNICIAN ${q.data.id} · LAST ACTIVE ${date(q.data.lastActiveAt)}`} onPress={() => go(r, `/mission-control/companies/${q.data?.companyId}`)} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
        <Metric value={q.data.inspectionCount} label="Inspections" onPress={() => openInspectionHistory()} />
        <Metric value={q.data.pendingAnalysisCount} label="Pending analysis" onPress={() => openInspectionHistory("analysisStatus=pending")} />
        <Metric value={q.data.failedAnalysisCount} label="Failed analysis" onPress={() => openInspectionHistory("analysisStatus=failed")} />
        <Metric value={q.data.failedSyncCount} label="Failed syncs" onPress={() => openInspectionHistory("syncStatus=failed")} />
      </View>
      <Body muted>Each metric opens the server-filtered inspection history for this technician and company.</Body>
      <Label>INSPECTION HISTORY / {q.data.inspections.length}</Label>
      {q.data.inspections.length ? q.data.inspections.map(x => <Row key={x.id} title={x.siteAddress ?? `Inspection #${x.id}`} subtitle={`${x.companyName} · ${x.status}`} meta={`INSPECTION #${x.id} · ${date(x.createdAt)}`} onPress={() => go(r, `/mission-control/inspections/${x.id}`)} />) : <Body muted>No recent inspections are available.</Body>}
      <Label>DEVICE SESSIONS / {q.data.deviceSessions.length}</Label>
      {q.data.deviceSessions.length ? q.data.deviceSessions.map(x => <Row key={x.id} title={`Session #${x.id}`} subtitle={`${x.eventCount} events · expires ${date(x.expiresAt)}`} meta={`STARTED ${date(x.createdAt)}`} onPress={() => go(r, `/mission-control/sessions/${x.id}`)} />) : <Body muted>No device sessions are linked to this technician.</Body>}
    </> : <QueryState query={q} />}
  </Shell>;
}
export function InspectionDetail({ id }: { id: number }) {
  const q = useGetMissionControlInspection(id), evidence = useListMissionControlInspectionEvidence(id);
  const analysis = useGetMissionControlInspectionAnalysis(id), timeline = useGetMissionControlInspectionTimeline(id), r = useRouter();
  const refresh = () => { void q.refetch(); void evidence.refetch(); void analysis.refetch(); void timeline.refetch(); };
  return <Shell title={`Inspection #${id}`} onRefresh={refresh} refreshing={q.isRefetching || evidence.isRefetching || analysis.isRefetching || timeline.isRefetching}>
    {q.data ? <><Label>{q.data.status.toUpperCase()} / {q.data.companyName.toUpperCase()}</Label><Row title={q.data.siteAddress ?? "Address unavailable"} subtitle={q.data.technicianName ?? "Unassigned"} meta={`CREATED ${date(q.data.createdAt)} · COMPLETED ${date(q.data.completedAt)}`} onPress={() => go(r, `/mission-control/companies/${q.data?.companyId}`)} />
      {q.data.technicianId && <Row title={q.data.technicianName ?? "Assigned technician"} subtitle="Open field identity and session history" onPress={() => go(r, `/mission-control/technicians/${encodeURIComponent(q.data!.technicianId!)}`)} />}
      {q.data.propertyId && <Row title={`Property #${q.data.propertyId}`} subtitle="Open property inspection history" onPress={() => go(r, `/mission-control/properties/${q.data!.propertyId}`)} />}
        <Label>MEDIA EVIDENCE</Label><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
          <Metric value={q.data.mediaCounts.total} label="Evidence items" onPress={() => go(r, `/mission-control/inspections/${id}/evidence-list`)} />
          <Metric value={q.data.mediaCounts.photos} label="Photos" onPress={() => go(r, `/mission-control/inspections/${id}/evidence-list?mediaType=photo`)} />
          <Metric value={q.data.mediaCounts.videos} label="Videos" onPress={() => go(r, `/mission-control/inspections/${id}/evidence-list?mediaType=video`)} />
          <Metric value={q.data.mediaCounts.pendingAnalysis} label="Pending analysis" onPress={() => go(r, `/mission-control/inspections/${id}/evidence-list?analysisStatus=pending`)} />
        </View>
       {evidence.data ? evidence.data.items.length ? evidence.data.items.map(item => <Row key={item.id} title={item.filename ?? `${item.mediaType} evidence #${item.id}`} subtitle={`Processing ${item.processingStatus} · analysis ${item.analysisStatus} · ${item.captureSource}`} meta={`${date(item.capturedAt)} · EVIDENCE #${item.id}`} onPress={() => go(r, `/mission-control/inspections/${id}/evidence/${item.id}`)} />) : <Body muted>No evidence records are linked to this inspection.</Body> : <QueryState query={evidence} />}
       <Label>AI ANALYSIS</Label>{analysis.data ? <Row title={`State: ${analysis.data.state}`} subtitle={`Provider ${analysis.data.provider ?? "not reported"} · model ${analysis.data.model ?? "not reported"}`} meta={`${analysis.data.runs.length} persisted runs · latest #${analysis.data.latestAnalysisId ?? "not recorded"}`} onPress={() => go(r, `/mission-control/inspections/${id}/analysis`)} /> : <QueryState query={analysis} empty="Analysis results are unavailable." />}
      <Label>SYNC HISTORY</Label>{q.data.syncLogs.length ? q.data.syncLogs.map(l => <Row key={l.id} title={l.status} subtitle={l.message} meta={date(l.createdAt)} />) : <Body muted>No sync events recorded.</Body>}
      <Label>DEVICE SESSIONS</Label>{q.data.deviceSessions.length ? q.data.deviceSessions.map(x => <Row key={x.id} title={`Session #${x.id}`} subtitle={`${x.eventCount} events · expires ${date(x.expiresAt)}`} meta={date(x.createdAt)} onPress={() => go(r, `/mission-control/sessions/${x.id}`)} />) : <Body muted>No device sessions attached.</Body>}
        <Label>INSPECTION TIMELINE</Label>{timeline.data ? <>
          {([
            ["persisted_historical_event", "PERSISTED HISTORICAL EVENTS"],
            ["current_state_derived", "CURRENT-STATE SNAPSHOTS"],
            ["newly_generated_event", "NEWLY GENERATED EVENTS"],
          ] as const).map(([provenance, heading]) => {
            const events = timeline.data.items.filter(event => event.provenance === provenance);
            return <View key={provenance}>
              <Label>{heading}</Label>
              {events.length ? events.map(event => {
                const path = inspectionTimelinePath(event, id);
                const timestamp = event.provenance === "current_state_derived"
                  ? event.observedAt ? `OBSERVED ${date(event.observedAt)}` : "OBSERVATION TIME NOT RECORDED"
                  : event.occurredAt
                    ? `OCCURRED ${date(event.occurredAt)}`
                    : event.recordedAt
                      ? `RECORDED ${date(event.recordedAt)}`
                      : "EVENT TIME NOT RECORDED";
                return <Row
                  key={event.id}
                  title={`${event.type.replace(/_/g, " ")} · ${event.eventType.replace(/[._]/g, " ")}${event.status ? ` · ${event.status}` : ""}`}
                  subtitle={`${event.detail} · Source ${event.sourceType} #${event.sourceId}`}
                  meta={`${timestamp} · ${event.provenance.replace(/_/g, " ").toUpperCase()}`}
                  onPress={path ? () => go(r, path) : undefined}
                />;
              }) : <Body muted>No {heading.toLowerCase()} are returned for this inspection.</Body>}
            </View>;
          })}
        </> : <QueryState query={timeline} />}
        <Body muted>Snapshots describe records as observed now; their recordedAt values are not presented as historical transitions. Historical and newly generated events appear only when the API has a persisted timestamp. Lifecycle changes not retained by the platform cannot be reconstructed here, so their absence does not mean they did not occur.</Body>
      <RelatedIncidents companyId={q.data.companyId} inspectionId={id} />
    </> : <QueryState query={q} />}
  </Shell>;
}
function inspectionTimelinePath(event: {
  type: string;
  eventType: string;
  relatedId: number | null;
}, inspectionId: number): string | undefined {
  if (event.type === "evidence" && event.relatedId != null) {
    return `/mission-control/inspections/${inspectionId}/evidence/${event.relatedId}`;
  }
  if (event.type === "analysis") return `/mission-control/inspections/${inspectionId}/analysis`;
  if (event.type === "incident" && event.relatedId != null) {
    return `/mission-control/incidents/${event.relatedId}`;
  }
  if (event.type === "incident_action" && event.relatedId != null) {
    return `/mission-control/audit?action=${encodeURIComponent(event.eventType)}&targetType=incident&targetId=${event.relatedId}`;
  }
  if (event.type === "device_session" && event.relatedId != null) {
    return `/mission-control/sessions/${event.relatedId}`;
  }
  return undefined;
}
function RelatedIncidents({ companyId, inspectionId }: { companyId: number; inspectionId: number }) {
  const q = useListMissionControlIncidents({ companyId, page: 1, limit: 100 }), r = useRouter();
  const linked = q.data?.items.filter(x => x.inspectionId === inspectionId) ?? [];
  return <><Label>INCIDENT RESPONSE</Label>{linked.map(x => <Row key={x.id} title={x.title} subtitle={`${x.severity} · ${x.status}`} meta={`INCIDENT #${x.id}`} onPress={() => go(r, `/mission-control/incidents/${x.id}`)} />)}
    {!linked.length && <Body muted>{q.isLoading ? "Checking for related incidents…" : q.isError ? "Incident references are unavailable." : "No incident linked in the first 100 company records."}</Body>}
    <Action label="View company incidents" onPress={() => go(r, `/mission-control/incidents?companyId=${companyId}`)} />
  </>;
}
export function SessionDetail({ id }: { id: number }) {
  const q = useGetMissionControlDeviceSession(id), r = useRouter();
  return <Shell title={`Device session #${id}`} onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}>
    {q.data ? <><Label>SESSION TRACE</Label><Row title={q.data.companyName} subtitle={`User ${q.data.userId ?? "Unknown"} · ${q.data.eventCount} events`} meta={`START ${date(q.data.createdAt)} · EXPIRES ${date(q.data.expiresAt)}`} onPress={() => go(r, `/mission-control/inspections/${q.data?.inspectionId}`)} />
      {q.data.userId && <Row title="Session user" subtitle={q.data.userId} meta="Search platform identity" onPress={() => go(r, `/mission-control/search?q=${encodeURIComponent(q.data!.userId!)}`)} />}
      <Row title={`Inspection #${q.data.inspectionId}`} subtitle="Evidence, analysis and synchronization" onPress={() => go(r, `/mission-control/inspections/${q.data!.inspectionId}`)} />
      <Label>EVENTS</Label>{q.data.events.map((e, i) => <Row key={i} title={e.type} subtitle={e.detail ?? undefined} meta={date(e.createdAt)} />)}
    </> : <QueryState query={q} />}
  </Shell>;
}
export function IncidentDetail({ id }: { id: number }) {
  const q = useGetMissionControlIncident(id), mutation = useUpdateMissionControlIncident(), qc = useQueryClient(), r = useRouter();
  const { isConnected } = useNetworkStatus();
  const [note, setNote] = useState(""), [assignee, setAssignee] = useState("");
  const [actionResult, setActionResult] = useState<{ action: string; status: string; updatedAt: string | null } | null>(null);
  const severityRank: Record<IncidentUpdateSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  const escalationLevels: IncidentUpdateSeverity[] = q.data
    ? (["low", "medium", "high", "critical"] as IncidentUpdateSeverity[]).filter(level => severityRank[level] > severityRank[q.data!.severity])
    : [];
  const submit = (data: { action: IncidentUpdateAction; note?: string; assigneeId?: string; severity?: IncidentUpdateSeverity }) => {
    Alert.alert("Confirm incident action", `Apply ${data.action} to incident #${id}? This action is recorded.`, [{ text: "Cancel", style: "cancel" }, { text: "Confirm", onPress: () => {
      setActionResult(null);
      mutation.mutate({ id, data }, { onSuccess: result => {
        setActionResult({ action: data.action, status: result.status, updatedAt: result.updatedAt ?? null });
        void qc.invalidateQueries({ queryKey: getGetMissionControlIncidentQueryKey(id) });
        void qc.invalidateQueries({ queryKey: ["/api/mission-control/incidents"] });
        void qc.invalidateQueries({ queryKey: ["/api/mission-control/audit"] });
        setNote("");
      } });
    } }]);
  };
  return <Shell title={`Incident #${id}`} onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}>
     {q.data ? <><Label>{q.data.severity.toUpperCase()} / {q.data.status.toUpperCase()}</Label><Row title={q.data.title} subtitle={q.data.description} meta={`${q.data.companyName} · CREATED ${date(q.data.createdAt)} · UPDATED ${date(q.data.updatedAt)}`} onPress={() => go(r, `/mission-control/companies/${q.data?.companyId}`)} />
      <Row title="Response owner" subtitle={q.data.assignedTo ?? "Not assigned"} meta={`ACKNOWLEDGED ${date(q.data.acknowledgedAt)}`} />
       {q.data.sourceType && <Row title={`Source: ${q.data.sourceType}`} subtitle={q.data.sourceId ? `Source record ${q.data.sourceId}` : "No source record ID is recorded"} />}
       {q.data.userId && <Row title="Related user" subtitle={q.data.userId} onPress={() => go(r, `/mission-control/search?q=${encodeURIComponent(q.data!.userId!)}`)} />}
      {q.data.inspectionId && <Row title={`Inspection #${q.data.inspectionId}`} onPress={() => go(r, `/mission-control/inspections/${q.data?.inspectionId}`)} />}
      {q.data.sessionId && <Row title={`Session #${q.data.sessionId}`} onPress={() => go(r, `/mission-control/sessions/${q.data?.sessionId}`)} />}
       <Label>RESPONSE ACTIONS</Label><Field value={note} onChangeText={setNote} placeholder="Response note" multiline />
        <Field value={assignee} onChangeText={setAssignee} placeholder="Assignee Super Admin user ID" />
       <View style={{ gap: 8 }}>
          <Action label="Claim" disabled={!isConnected || mutation.isPending || !!q.data.assignedTo || q.data.status === "resolved" || q.data.status === "dismissed"} onPress={() => submit({ action: "claim", note: note.trim() || undefined })} />
         <Action label={mutation.isPending ? "Saving" : "Acknowledge"} disabled={!isConnected || mutation.isPending || q.data.status !== "open" || !!q.data.acknowledgedAt} onPress={() => submit({ action: "acknowledge", note: note.trim() || undefined })} />
          <Action label="Assign" disabled={!isConnected || mutation.isPending || !assignee.trim() || assignee.trim() === q.data.assignedTo || q.data.status === "resolved" || q.data.status === "dismissed"} onPress={() => submit({ action: "assign", assigneeId: assignee.trim(), note: note.trim() || undefined })} />
          {escalationLevels.map(level => <Action key={level} label={`Escalate to ${level}`} danger disabled={!isConnected || mutation.isPending || q.data.status === "resolved" || q.data.status === "dismissed"} onPress={() => submit({ action: "escalate", severity: level, note: note.trim() || undefined })} />)}
          {!escalationLevels.length && <Body muted>There is no higher severity available for escalation.</Body>}
         <Action label="Resolve" disabled={!isConnected || mutation.isPending || q.data.status === "resolved"} onPress={() => submit({ action: "resolve", note: note.trim() || undefined })} />
       </View>
       {mutation.isError && <Body>{errorText(mutation.error)}</Body>}
       {actionResult && <><Row title="Action confirmed by the server" subtitle={`${actionResult.action} · resulting status ${actionResult.status}`} meta={date(actionResult.updatedAt)} />
          <Action label="Review matching audit actions" onPress={() => go(r, "/mission-control/audit?action=" + encodeURIComponent("incident_" + actionResult.action) + "&targetType=incident&targetId=" + id)} />
       </>}
        {q.data.sourceType === "sync_log" && <><Label>SYNC RECOVERY</Label><Body muted>The platform API does not expose a safe replay operation. Legacy or uncertain enterprise sync failures cannot be replayed from Mission Control.</Body></>}
       <Body muted>Dismissal is not exposed by the platform incident API. Resolve records the server-confirmed result.</Body>
    </> : <QueryState query={q} />}
  </Shell>;
}