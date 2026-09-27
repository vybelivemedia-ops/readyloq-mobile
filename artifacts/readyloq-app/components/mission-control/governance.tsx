import React, { useState } from "react";
import { Alert, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useDecideMissionControlApproval, useListMissionControlApprovals, useRequestMissionControlApproval } from "@workspace/api-client-react";
import type { MissionControlApproval, MissionControlApprovalRequest } from "@workspace/api-client-react";
import { Action, Body, date, errorText, Field, Label, Pager, Panel, QueryState, Row, Shell } from "./ui";

function decodeRequest(raw: string): { type?: string; id?: string; action?: string; reason?: string } | null {
  try { const v: unknown = JSON.parse(raw); if (typeof v !== "object" || !v) return null; const o = v as Record<string, unknown>; return { type: String(o.targetType ?? o.type ?? ""), id: String(o.targetId ?? o.id ?? ""), action: String(o.action ?? ""), reason: String(o.reason ?? "") }; } catch { return null; }
}
export function RequestAccess({ targetType, targetId, currentEnabled }: { targetType: "company" | "user"; targetId: string; currentEnabled: boolean }) {
  const { isConnected } = useNetworkStatus();
  const [reason, setReason] = useState(""), [expanded, setExpanded] = useState(false); const m = useRequestMissionControlApproval(), qc = useQueryClient();
  const action: MissionControlApprovalRequest["action"] = targetType === "company" ? currentEnabled ? "suspend" : "enable" : currentEnabled ? "beta_disable" : "beta_enable";
  return <View style={{ gap: 9, marginTop: 8, marginBottom: 14 }}><Action label={expanded ? "Cancel request" : `Request ${action.replace("_", " ")}`} onPress={() => setExpanded(!expanded)} />
    {expanded && <Panel><Body muted>Another administrator must decide this request before access changes. Your request will be recorded in the audit trail.</Body><View style={{ height: 10 }} /><Field value={reason} onChangeText={setReason} placeholder="Reason for access change" multiline /><View style={{ height: 10 }} /><Action label={m.isPending ? "Submitting" : "Submit access request"} disabled={!isConnected || m.isPending || !reason.trim()} onPress={() => m.mutate({ data: { targetType, targetId, action, reason: reason.trim() } }, { onSuccess: () => { setExpanded(false); setReason(""); void qc.invalidateQueries({ queryKey: ["/api/mission-control/approvals"] }); Alert.alert("Request filed", "A second administrator can now review it in Approvals."); } })} />{m.isError && <Body>{errorText(m.error)}</Body>}</Panel>}
  </View>;
}
export function Approvals() {
  const { isConnected } = useNetworkStatus();
  const [page, setPage] = useState(1), [status, setStatus] = useState<string | undefined>("pending"), [choice, setChoice] = useState<{ item: MissionControlApproval; decision: "approve" | "reject" } | null>(null), [note, setNote] = useState("");
  const q = useListMissionControlApprovals({ page, limit: 20, status }); const m = useDecideMissionControlApproval(), qc = useQueryClient();
  const target = choice ? decodeRequest(choice.item.request) : null;
  const confirm = () => {
    if (!choice || !note.trim()) return;
    m.mutate({ id: choice.item.id, data: { decision: choice.decision, note: note.trim() } }, { onSuccess: () => {
      setChoice(null); setNote(""); for (const key of ["/api/mission-control/approvals", "/api/mission-control/companies", "/api/mission-control/technicians", "/api/mission-control/audit", "/api/mission-control/overview"]) void qc.invalidateQueries({ queryKey: [key] });
    } });
  };
  return <Shell title="Approvals" onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}><Label>SECOND-ADMIN DECISIONS</Label><Body muted>Approval applies the requested access change immediately. You cannot decide your own request.</Body>
    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>{["pending", "approved", "rejected", "All"].map(x => <Action key={x} label={x} onPress={() => { setPage(1); setStatus(x === "All" ? undefined : x); setChoice(null); }} />)}</View><Body muted>Filter: {status ?? "all decisions"}</Body>
    {q.data ? q.data.items.length ? <>{q.data.items.map(x => <Panel key={x.id}><Row title={`#${x.id} · ${x.type}`} subtitle={x.request} meta={`${x.status.toUpperCase()} · requested ${date(x.createdAt)}`} /><Body muted>Requested by {x.requestedBy}{x.decidedBy ? ` · decided by ${x.decidedBy}` : ""}</Body>{x.note && <Body>{x.note}</Body>}
      {x.status === "pending" && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}><View style={{ flexGrow: 1, minWidth: 145 }}><Action label="Review approval" onPress={() => { setChoice({ item: x, decision: "approve" }); setNote(""); }} /></View><View style={{ flexGrow: 1, minWidth: 145 }}><Action label="Review rejection" onPress={() => { setChoice({ item: x, decision: "reject" }); setNote(""); }} /></View></View>}</Panel>)}<Pager page={page} total={q.data.totalPages} onChange={setPage} /></> : <QueryState query={q} empty="No requests in this view." /> : <QueryState query={q} />}
    {choice && <Panel accent={choice.decision === "approve" ? "#d29922" : undefined}><Label>DECISION / #{choice.item.id}</Label><Body>{choice.decision === "approve" ? "Apply this access change?" : "Reject this request?"}</Body><Body muted>{target ? `${target.action} · ${target.type} #${target.id} · ${target.reason}` : choice.item.request}</Body><Body muted>{choice.decision === "approve" ? "This takes effect immediately. Verify the target and reason before proceeding." : "Rejection records the decision without changing access."}</Body><View style={{ height: 12 }} /><Field value={note} onChangeText={setNote} placeholder="Decision note required" multiline /><View style={{ height: 12 }} /><Action label={m.isPending ? "Saving decision" : choice.decision === "approve" ? "Confirm approval and apply" : "Confirm rejection"} danger={choice.decision === "approve"} disabled={!isConnected || !note.trim() || m.isPending} onPress={() => Alert.alert("Final confirmation", `Are you sure you want to ${choice.decision} request #${choice.item.id}?`, [{ text: "Cancel", style: "cancel" }, { text: "Confirm", onPress: confirm }])} /><View style={{ height: 8 }} /><Action label="Cancel decision" onPress={() => setChoice(null)} />{m.isError && <Body>{errorText(m.error)}</Body>}</Panel>}
  </Shell>;
}