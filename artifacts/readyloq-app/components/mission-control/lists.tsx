import React, { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import { useGetMissionControlMe, useGetMissionControlOverview, useListMissionControlCompanies, useListMissionControlTechnicians, useListMissionControlInspections, useListMissionControlIncidents, useListMissionControlAudit } from "@workspace/api-client-react";
import { Action, Body, date, Field, go, Label, Metric, Pager, QueryState, Row, Shell } from "./ui";
import { ScopePicker, useScope } from "./scope";

export function Overview() {
  const me = useGetMissionControlMe(), q = useGetMissionControlOverview(), r = useRouter();
  return <Shell title="Mission Control" onRefresh={() => { void q.refetch(); void me.refetch(); }} refreshing={q.isRefetching}>
    {me.isLoading ? <QueryState query={me} /> : me.isError ? <QueryState query={me} /> : !me.data?.isSuperAdmin ? <Row title="Restricted" subtitle="This surface is reserved for platform administrators." /> : <>
      <Label>PLATFORM PULSE</Label>
      {q.data ? <><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
        <Metric value={q.data.kpis.activeCompanyCount} label="Active companies" /><Metric value={q.data.kpis.technicianCount} label="Technicians" /><Metric value={q.data.kpis.inspectionCount} label="Inspections" /><Metric value={q.data.kpis.openIncidentCount} label="Open incidents" />
      </View><Label>LIVE SIGNALS</Label>{q.data.recentAlerts.length ? q.data.recentAlerts.map(a => <Row key={a.id} title={a.title} subtitle={a.message} meta={`${a.severity.toUpperCase()} · ${date(a.createdAt)}`} tone={a.severity === "critical" ? "#f85149" : undefined} onPress={a.companyId ? () => go(r, `/mission-control/companies/${a.companyId}`) : undefined} />) : <Row title="No recent alerts" subtitle="Nothing requiring attention is currently reported." />}</> : <QueryState query={q} />}
      <ScopePicker />
    </>}
  </Shell>;
}
export function Companies() {
  const [search, setSearch] = useState(""), [page, setPage] = useState(1); const q = useListMissionControlCompanies({ page, limit: 20, search: search.trim() || undefined }); const r = useRouter();
  return <Shell title="Companies" onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}><ScopePicker /><Label>DIRECTORY / {q.data?.total ?? "—"}</Label><Field value={search} onChangeText={v => { setSearch(v); setPage(1); }} placeholder="Search companies" />
    {q.data ? q.data.items.length ? <>{q.data.items.map(x => <Row key={x.id} title={x.name} subtitle={`${x.accessStatus} · ${x.userCount} people · ${x.inspectionCount} inspections`} meta={`LAST ACTIVITY ${date(x.lastActivityAt)}`} onPress={() => go(r, `/mission-control/companies/${x.id}`)} />)}<Pager page={page} total={q.data.totalPages} onChange={setPage} /></> : <QueryState query={q} empty="No companies match this search." /> : <QueryState query={q} />}
  </Shell>;
}
export function Technicians() {
  const { companyId } = useScope(); const [search, setSearch] = useState(""), [page, setPage] = useState(1), r = useRouter();
  const q = useListMissionControlTechnicians({ companyId, search: search.trim() || undefined, page, limit: 20 });
  return <Shell title="Technicians" onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}><ScopePicker /><Label>FIELD PERSONNEL / {q.data?.total ?? "—"}</Label><Field value={search} onChangeText={v => { setSearch(v); setPage(1); }} placeholder="Search technicians" />
    {q.data ? q.data.items.length ? <>{q.data.items.map(x => <Row key={x.id} title={x.name} subtitle={`${x.companyName} · ${x.status}`} meta={`LAST ACTIVE ${date(x.lastActiveAt)}`} onPress={() => go(r, `/mission-control/technicians/${encodeURIComponent(x.id)}`)} />)}<Pager page={page} total={q.data.totalPages} onChange={setPage} /></> : <QueryState query={q} /> : <QueryState query={q} />}
  </Shell>;
}
export function Inspections() {
  const { companyId } = useScope(); const [search, setSearch] = useState(""), [page, setPage] = useState(1), [status, setStatus] = useState<string | undefined>(), r = useRouter();
  const q = useListMissionControlInspections({ companyId, search: search.trim() || undefined, status, page, limit: 20 });
  return <Shell title="Inspections" onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}><ScopePicker /><Label>CAPTURE ACTIVITY / {q.data?.total ?? "—"}</Label><Field value={search} onChangeText={v => { setSearch(v); setPage(1); }} placeholder="Search inspections" />
    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>{["All", "pending", "completed"].map(v => <Action key={v} label={v} onPress={() => { setStatus(v === "All" ? undefined : v); setPage(1); }} />)}</View><Body muted>Filter: {status ?? "all statuses"}</Body>
    {q.data ? q.data.items.length ? <>{q.data.items.map(x => <Row key={x.id} title={x.siteAddress || `Inspection #${x.id}`} subtitle={`${x.companyName} · ${x.technicianName ?? "Unassigned"}`} meta={`#${x.id} · ${x.status.toUpperCase()} · ${date(x.createdAt)}`} onPress={() => go(r, `/mission-control/inspections/${x.id}`)} />)}<Pager page={page} total={q.data.totalPages} onChange={setPage} /></> : <QueryState query={q} /> : <QueryState query={q} />}
  </Shell>;
}
export function Incidents() {
  const { companyId } = useScope(); const { companyId: linkedCompany } = useLocalSearchParams<{ companyId?: string }>(); const linkedId = Number(linkedCompany);
  const effectiveCompanyId = companyId ?? (Number.isInteger(linkedId) && linkedId > 0 ? linkedId : undefined);
  const [page, setPage] = useState(1), [status, setStatus] = useState<string | undefined>(), r = useRouter();
  const q = useListMissionControlIncidents({ companyId: effectiveCompanyId, status, page, limit: 20 });
  return <Shell title="Incidents" onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}><ScopePicker />{effectiveCompanyId && <Body muted>Company scope: #{effectiveCompanyId}</Body>}<Label>RESPONSE QUEUE / {q.data?.total ?? "—"}</Label>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{["All", "open", "acknowledged", "investigating", "resolved", "dismissed"].map(v => <Action key={v} label={v} onPress={() => { setStatus(v === "All" ? undefined : v); setPage(1); }} />)}</View><Body muted>Filter: {status ?? "all statuses"}</Body>
    {q.data ? q.data.items.length ? <>{q.data.items.map(x => <Row key={x.id} title={x.title} subtitle={`${x.companyName} · ${x.description}`} meta={`${x.severity.toUpperCase()} · ${x.status.toUpperCase()} · ${date(x.createdAt)}`} tone={x.severity === "critical" ? "#f85149" : undefined} onPress={() => go(r, `/mission-control/incidents/${x.id}`)} />)}<Pager page={page} total={q.data.totalPages} onChange={setPage} /></> : <QueryState query={q} /> : <QueryState query={q} />}
  </Shell>;
}
export function Audit() {
  const [page, setPage] = useState(1), [action, setAction] = useState(""); const q = useListMissionControlAudit({ page, limit: 20, action: action.trim() || undefined });
  return <Shell title="Audit trail" onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}><Label>GOVERNED ACTIVITY / {q.data?.total ?? "—"}</Label><Field value={action} onChangeText={v => { setAction(v); setPage(1); }} placeholder="Filter by action" />
    {q.data ? q.data.items.length ? <>{q.data.items.map(x => <Row key={x.id} title={x.action} subtitle={`${x.actorName || x.actorId} → ${x.targetType} #${x.targetId}`} meta={`${date(x.createdAt)}${x.details ? ` · ${x.details}` : ""}`} />)}<Pager page={page} total={q.data.totalPages} onChange={setPage} /></> : <QueryState query={q} /> : <QueryState query={q} />}
  </Shell>;
}