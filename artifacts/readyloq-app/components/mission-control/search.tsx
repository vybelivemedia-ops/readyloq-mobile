import React, { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { getSearchMissionControlQueryKey, useSearchMissionControl } from "@workspace/api-client-react";
import { Body, Field, go, Label, QueryState, Row, Shell } from "./ui";

const MAX_SEARCH_LENGTH = 120;

export function GlobalSearch() {
  const { q: linkedQuery } = useLocalSearchParams<{ q?: string }>();
  const [text, setText] = useState((linkedQuery ?? "").slice(0, MAX_SEARCH_LENGTH));
  useEffect(() => { if (linkedQuery !== undefined) setText(linkedQuery.slice(0, MAX_SEARCH_LENGTH)); }, [linkedQuery]);
  const router = useRouter();
  const search = text.trim();
  const enabled = search.length >= 2;
  const params = { q: enabled ? search : "  " };
  const q = useSearchMissionControl(params, { query: { enabled, queryKey: getSearchMissionControlQueryKey(params) } });
  const destination = (kind: string, recordId: string, inspectionId: number | null) => {
    if (kind === "company" && Number.isSafeInteger(Number(recordId))) return `/mission-control/companies/${recordId}`;
    if (kind === "technician") return `/mission-control/technicians/${encodeURIComponent(recordId)}`;
    if (kind === "property" && Number.isSafeInteger(Number(recordId))) return `/mission-control/properties/${recordId}`;
    if (kind === "inspection" && inspectionId) return `/mission-control/inspections/${inspectionId}`;
    if (kind === "evidence" && inspectionId) return `/mission-control/inspections/${inspectionId}/evidence/${recordId}`;
    if (kind === "incident" && Number.isSafeInteger(Number(recordId))) return `/mission-control/incidents/${recordId}`;
    return undefined;
  };

  return <Shell title="Platform search" onRefresh={() => { if (enabled) void q.refetch(); }} refreshing={q.isRefetching}>
    <Body muted>Find companies, technicians, properties, inspections, evidence, and incidents across the platform. Results are limited to records returned by the Super Admin API.</Body>
    <Field value={text} onChangeText={value => setText(value.slice(0, MAX_SEARCH_LENGTH))} placeholder="Name, address, or record ID" maxLength={MAX_SEARCH_LENGTH} />
    {!enabled ? <Body muted>Enter at least two characters to search.</Body> : <>
      <Label>PLATFORM RECORDS / {q.data?.items.length ?? "—"}</Label>
      {q.data ? q.data.items.length ? q.data.items.map((hit, index) => {
        const path = destination(hit.kind, hit.id, hit.inspectionId);
        return <Row key={`${hit.kind}-${hit.id}-${index}`} title={hit.title} subtitle={hit.subtitle ?? undefined} meta={`${hit.kind.toUpperCase()} · ID ${hit.id}${hit.inspectionId ? ` · INSPECTION #${hit.inspectionId}` : ""}`} onPress={path ? () => go(router, path) : undefined} />;
      }) : <Body muted>No platform records match this search.</Body> : <QueryState query={q} empty="Search results are unavailable." />}
    </>}
  </Shell>;
}