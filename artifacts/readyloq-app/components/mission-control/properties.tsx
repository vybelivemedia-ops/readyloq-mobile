import React, { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useListMissionControlProperties, useGetMissionControlProperty } from "@workspace/api-client-react";
import { Body, date, Field, go, Label, Metric, Pager, QueryState, Row, Shell } from "./ui";
import { ScopePicker, useScope } from "./scope";

export function Properties() {
  const { companyId } = useScope(), { companyId: linkedCompany } = useLocalSearchParams<{ companyId?: string }>(), linkedId = Number(linkedCompany);
  const effectiveCompanyId = companyId ?? (Number.isSafeInteger(linkedId) && linkedId > 0 ? linkedId : undefined);
  const [search, setSearch] = useState(""), [page, setPage] = useState(1), r = useRouter();
  const q = useListMissionControlProperties({ companyId: effectiveCompanyId, search: search.trim() || undefined, page, limit: 20 });
  return <Shell title="Properties" onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}><ScopePicker />{effectiveCompanyId && <Body muted>Company filter: #{effectiveCompanyId} · platform authorization unchanged</Body>}<Label>PROPERTY DIRECTORY / {q.data?.total ?? "—"}</Label><Field value={search} onChangeText={v => { setSearch(v); setPage(1); }} placeholder="Search properties" />
    {q.data ? q.data.items.length ? <>{q.data.items.map(x => <Row key={x.id} title={x.siteAddress} subtitle={`${x.companyName} · ${x.propertyType ?? "Type not set"}`} meta={`${x.inspectionCount} INSPECTIONS · ${date(x.updatedAt)}`} onPress={() => go(r, `/mission-control/properties/${x.id}`)} />)}<Pager page={page} total={q.data.totalPages} onChange={setPage} /></> : <QueryState query={q} empty="No properties match this scope." /> : <QueryState query={q} />}
  </Shell>;
}
export function PropertyDetail({ id }: { id: number }) {
  const q = useGetMissionControlProperty(id), r = useRouter();
  return <Shell title={q.data?.siteAddress ?? `Property #${id}`} onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}>{q.data ? <>
    <Label>PROPERTY / {q.data.companyName.toUpperCase()}</Label><Row title={q.data.siteAddress} subtitle={q.data.propertyType ?? "Property type not set"} meta={`UPDATED ${date(q.data.updatedAt)}`} onPress={() => go(r, `/mission-control/companies/${q.data?.companyId}`)} />
    <Metric value={q.data.inspectionCount} label="Inspections" /><Label>INSPECTION REFERENCES</Label>{q.data.inspections.length ? q.data.inspections.map(x => <Row key={x.id} title={`Inspection #${x.id}`} subtitle={x.status} meta={date(x.createdAt)} onPress={() => go(r, `/mission-control/inspections/${x.id}`)} />) : <Body muted>No inspections recorded for this property.</Body>}
  </> : <QueryState query={q} />}</Shell>;
}