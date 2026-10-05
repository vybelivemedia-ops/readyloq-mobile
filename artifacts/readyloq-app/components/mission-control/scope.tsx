import React, { createContext, useContext, useState } from "react";
import { useListMissionControlCompanies } from "@workspace/api-client-react";
import { Action, Body, Field, Label, Pager, Panel, QueryState } from "./ui";
import { View } from "react-native";

type OperatingScope = { companyId?: number; companyName?: string; setCompanyId: (id?: number, name?: string) => void };
const Scope = createContext<OperatingScope>({ setCompanyId: () => {} });
export function ScopeProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<{ id: number; name?: string } | null>(null);
  const setCompanyId = (id?: number, name?: string) => setSelected(id == null ? null : { id, name: name ?? (selected?.id === id ? selected.name : undefined) });
  return <Scope.Provider value={{ companyId: selected?.id, companyName: selected?.name, setCompanyId }}>{children}</Scope.Provider>;
}
export const useScope = () => useContext(Scope);
export function ScopePicker() {
  const { companyId, companyName, setCompanyId } = useScope();
  const [search, setSearch] = useState(""), [page, setPage] = useState(1);
  const q = useListMissionControlCompanies({ limit: 20, page, search: search.trim() || undefined });
  return <><Label>COMPANY FILTER · PLATFORM-WIDE ACCESS</Label><Panel>
    <Body>Read-only filter: {companyId ? companyName ?? q.data?.items.find(x => x.id === companyId)?.name ?? `Company #${companyId}` : "All companies"}</Body>
    <Body muted>Filtering records does not switch tenant authorization or change your Super Admin access.</Body>
    <View style={{ marginTop: 12 }}><Field value={search} onChangeText={v => { setSearch(v); setPage(1); }} placeholder="Find a company to scope" /></View>
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 13 }}>
    <Action label="All companies" onPress={() => setCompanyId(undefined)} />
    {q.data?.items.map(x => <Action key={x.id} label={x.name} onPress={() => setCompanyId(x.id, x.name)} />)}
    </View>
    {q.data ? q.data.items.length ? <><View style={{ marginTop: 12 }}><Pager page={page} total={q.data.totalPages} onChange={setPage} /></View><Body muted>{q.data.total} companies match. Search or page through the complete directory.</Body></> : <Body muted>No matching companies. Your selected scope remains unchanged.</Body> : <View style={{ marginTop: 12 }}><QueryState query={q} /></View>}
  </Panel></>;
}