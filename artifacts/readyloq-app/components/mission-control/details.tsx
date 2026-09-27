import React, { useState } from "react";
import { Alert, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useGetMissionControlCompany, useGetMissionControlTechnician, useGetMissionControlInspection, useGetMissionControlDeviceSession, useGetMissionControlIncident, useListMissionControlIncidents, useUpdateMissionControlIncident, getGetMissionControlIncidentQueryKey } from "@workspace/api-client-react";
import { Action, Body, date, errorText, Field, go, Label, Metric, QueryState, Row, Shell } from "./ui";
import { ScopePicker, useScope } from "./scope";
import { RequestAccess } from "./governance";

export function CompanyDetail({ id }: { id: number }) {
  const q = useGetMissionControlCompany(id); const { setCompanyId } = useScope(); const r = useRouter();
  return <Shell title={q.data?.name ?? `Company #${id}`} onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}>
    {q.data ? <><Label>ACCOUNT / {q.data.accessStatus.toUpperCase()}</Label><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}><Metric value={q.data.userCount} label="People" /><Metric value={q.data.technicianCount} label="Technicians" /><Metric value={q.data.inspectionCount} label="Inspections" /></View>
      <Action label="Set operating scope" onPress={() => { setCompanyId(id, q.data.name); go(r, "/mission-control/inspections"); }} />
      {q.data.owner ? <Row title={q.data.owner.name} subtitle={q.data.owner.email} meta="ACCOUNT OWNER" /> : <Row title="Owner not assigned" subtitle="This company has no owner record." meta="ACCOUNT OWNER" />}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}><Action label="Company technicians" onPress={() => { setCompanyId(id, q.data.name); go(r, "/mission-control/technicians"); }} /><Action label="Company incidents" onPress={() => { setCompanyId(id, q.data.name); go(r, "/mission-control/incidents"); }} /></View>
      <Label>ACCESS CONTROL</Label><RequestAccess targetType="company" targetId={String(id)} currentEnabled={q.data.accessStatus === "enabled"} />
      <Label>TEAM / {q.data.users.length}</Label>{q.data.users.map(u => <View key={u.id}><Row title={u.name} subtitle={`${u.email} · ${u.role ?? "No role"}`} meta={`BETA ACCESS ${u.betaAccessEnabled ? "ENABLED" : "DISABLED"}`} onPress={u.role === "technician" ? () => go(r, `/mission-control/technicians/${encodeURIComponent(u.id)}`) : undefined} /><RequestAccess targetType="user" targetId={u.id} currentEnabled={u.betaAccessEnabled} /></View>)}
      <Label>RECENT INSPECTIONS</Label>{q.data.recentInspections.map(x => <Row key={x.id} title={x.siteAddress ?? `Inspection #${x.id}`} subtitle={x.technicianName ?? "Unassigned"} meta={date(x.createdAt)} onPress={() => go(r, `/mission-control/inspections/${x.id}`)} />)}
    </> : <QueryState query={q} />}
  </Shell>;
}
export function TechnicianDetail({ id }: { id: string }) {
  const q = useGetMissionControlTechnician(id), r = useRouter();
  return <Shell title={q.data?.name ?? "Technician"} onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}>
    {q.data ? <><Label>FIELD IDENTITY</Label><Row title={q.data.companyName} subtitle={`Status: ${q.data.status}`} meta={`LAST ACTIVE ${date(q.data.lastActiveAt)}`} onPress={() => go(r, `/mission-control/companies/${q.data?.companyId}`)} />
      <Label>INSPECTION & DEVICE HISTORY</Label><Body muted>Device sessions are linked to an inspection. Open a session below to inspect its event trace, then return to its inspection.</Body>
      {q.data.inspections.length ? q.data.inspections.map(x => <TechnicianInspectionTrail key={x.id} inspectionId={x.id} technicianId={id} title={x.siteAddress ?? `Inspection #${x.id}`} status={x.status} />) : <Body muted>No recent inspections or linked device sessions.</Body>}
    </> : <QueryState query={q} />}
  </Shell>;
}
function TechnicianInspectionTrail({ inspectionId, technicianId, title, status }: { inspectionId: number; technicianId: string; title: string; status: string }) {
  const q = useGetMissionControlInspection(inspectionId), r = useRouter();
  return <View style={{ gap: 8 }}><Row title={title} subtitle={`Inspection #${inspectionId} · ${status}`} onPress={() => go(r, `/mission-control/inspections/${inspectionId}`)} />
    {q.data?.deviceSessions.filter(x => x.userId === technicianId).map(x => <Row key={x.id} title={`Device session #${x.id}`} subtitle={`${x.eventCount} events · ${date(x.createdAt)}`} onPress={() => go(r, `/mission-control/sessions/${x.id}`)} />)}
    {q.isError && <Body muted>Session references are unavailable for inspection #{inspectionId}.</Body>}
  </View>;
}
export function InspectionDetail({ id }: { id: number }) {
  const q = useGetMissionControlInspection(id), r = useRouter();
  const [selectedMediaId, setSelectedMediaId] = useState<number | null>(null);
  return <Shell title={`Inspection #${id}`} onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}>
    {q.data ? <><Label>{q.data.status.toUpperCase()} / {q.data.companyName.toUpperCase()}</Label><Row title={q.data.siteAddress ?? "Address unavailable"} subtitle={q.data.technicianName ?? "Unassigned"} meta={`CREATED ${date(q.data.createdAt)} · COMPLETED ${date(q.data.completedAt)}`} onPress={() => go(r, `/mission-control/companies/${q.data?.companyId}`)} />
      {q.data.technicianId && <Row title={q.data.technicianName ?? "Assigned technician"} subtitle="Open field identity and session history" onPress={() => go(r, `/mission-control/technicians/${encodeURIComponent(q.data!.technicianId!)}`)} />}
      <Label>MEDIA EVIDENCE</Label><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}><Metric value={q.data.mediaCounts.photos} label="Photos" /><Metric value={q.data.mediaCounts.videos} label="Videos" /><Metric value={q.data.mediaCounts.pendingAnalysis} label="Pending analysis" /></View>
      {q.data.media.map(m => <Row key={m.id} title={`${m.mediaType} #${m.id}`} subtitle={`Source: ${m.captureSource ?? "Unknown"} · Quality: ${m.qualityScore ?? "—"}`} meta={`${date(m.capturedAt)} · TAP FOR ANALYSIS`} onPress={() => setSelectedMediaId(m.id)} />)}
      {selectedMediaId !== null && <View style={{ gap: 8 }}><Label>EVIDENCE #{selectedMediaId} / ANALYSIS</Label>
        {q.data.analysisStatuses.filter(a => a.mediaId === selectedMediaId).length ? q.data.analysisStatuses.filter(a => a.mediaId === selectedMediaId).map((a, i) => <Row key={`${a.mediaId}-${i}`} title={a.status} subtitle={a.error ?? "No error recorded"} meta={date(a.updatedAt)} />) : <Body muted>No analysis event recorded for this media item.</Body>}
        <Body muted>Capture and sync context for the inspection continues below.</Body>
      </View>}
      <Label>ANALYSIS PIPELINE</Label>{q.data.analysisStatuses.length ? q.data.analysisStatuses.map((a, i) => <Row key={`${a.mediaId}-${i}`} title={`Media #${a.mediaId} · ${a.status}`} subtitle={a.error ?? undefined} meta={date(a.updatedAt)} />) : <Body muted>No analysis events recorded.</Body>}
      <Label>SYNC HISTORY</Label>{q.data.syncLogs.length ? q.data.syncLogs.map(l => <Row key={l.id} title={l.status} subtitle={l.message} meta={date(l.createdAt)} />) : <Body muted>No sync events recorded.</Body>}
      <Label>DEVICE SESSIONS</Label>{q.data.deviceSessions.length ? q.data.deviceSessions.map(x => <Row key={x.id} title={`Session #${x.id}`} subtitle={`${x.eventCount} events · expires ${date(x.expiresAt)}`} meta={date(x.createdAt)} onPress={() => go(r, `/mission-control/sessions/${x.id}`)} />) : <Body muted>No device sessions attached.</Body>}
      <RelatedIncidents companyId={q.data.companyId} inspectionId={id} />
    </> : <QueryState query={q} />}
  </Shell>;
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
      {q.data.userId && <Row title="Session technician" subtitle={q.data.userId} onPress={() => go(r, `/mission-control/technicians/${encodeURIComponent(q.data!.userId!)}`)} />}
      <Row title={`Inspection #${q.data.inspectionId}`} subtitle="Evidence, analysis and synchronization" onPress={() => go(r, `/mission-control/inspections/${q.data!.inspectionId}`)} />
      <Label>EVENTS</Label>{q.data.events.map((e, i) => <Row key={i} title={e.type} subtitle={e.detail ?? undefined} meta={date(e.createdAt)} />)}
    </> : <QueryState query={q} />}
  </Shell>;
}
export function IncidentDetail({ id }: { id: number }) {
  const q = useGetMissionControlIncident(id), mutation = useUpdateMissionControlIncident(), qc = useQueryClient(), r = useRouter();
  const [note, setNote] = useState(""), [assignee, setAssignee] = useState("");
  const submit = (data: { action: "acknowledge" | "assign" | "escalate"; note?: string; assigneeId?: string }) => {
    Alert.alert("Confirm incident action", `Apply ${data.action} to incident #${id}? This action is recorded.`, [{ text: "Cancel", style: "cancel" }, { text: "Confirm", onPress: () => mutation.mutate({ id, data }, { onSuccess: () => { void qc.invalidateQueries({ queryKey: getGetMissionControlIncidentQueryKey(id) }); void qc.invalidateQueries({ queryKey: ["/api/mission-control/incidents"] }); void qc.invalidateQueries({ queryKey: ["/api/mission-control/audit"] }); setNote(""); } }) }]);
  };
  return <Shell title={`Incident #${id}`} onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}>
    {q.data ? <><Label>{q.data.severity.toUpperCase()} / {q.data.status.toUpperCase()}</Label><Row title={q.data.title} subtitle={q.data.description} meta={`${q.data.companyName} · ${date(q.data.createdAt)}`} onPress={() => go(r, `/mission-control/companies/${q.data?.companyId}`)} />
      <Row title="Response owner" subtitle={q.data.assignedTo ?? "Not assigned"} meta={`ACKNOWLEDGED ${date(q.data.acknowledgedAt)}`} />
      {q.data.inspectionId && <Row title={`Inspection #${q.data.inspectionId}`} onPress={() => go(r, `/mission-control/inspections/${q.data?.inspectionId}`)} />}
      {q.data.sessionId && <Row title={`Session #${q.data.sessionId}`} onPress={() => go(r, `/mission-control/sessions/${q.data?.sessionId}`)} />}
      <Label>RESPONSE ACTIONS</Label><Field value={note} onChangeText={setNote} placeholder="Response note" multiline /><Field value={assignee} onChangeText={setAssignee} placeholder="Assignee user ID" />
      <View style={{ gap: 8 }}><Action label={mutation.isPending ? "Saving" : "Acknowledge"} disabled={mutation.isPending} onPress={() => submit({ action: "acknowledge", note: note.trim() || undefined })} /><Action label="Assign" disabled={mutation.isPending || !assignee.trim()} onPress={() => submit({ action: "assign", assigneeId: assignee.trim(), note: note.trim() || undefined })} /><Action label="Escalate" danger disabled={mutation.isPending} onPress={() => submit({ action: "escalate", note: note.trim() || undefined })} /></View>
      {mutation.isError && <Body>{errorText(mutation.error)}</Body>}<Body muted>Resolution and dismissal are not exposed by the platform incident API.</Body>
    </> : <QueryState query={q} />}
  </Shell>;
}