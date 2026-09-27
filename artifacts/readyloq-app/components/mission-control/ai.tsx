import React, { useState } from "react";
import { Alert, View } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useGetMissionControlOverview, useListMissionControlAgents, useListMissionControlAgentTasks, useGetMissionControlAgentTask, useCreateMissionControlAgentTask } from "@workspace/api-client-react";
import { Action, Body, date, errorText, Field, go, Label, Metric, Pager, QueryState, Row, Shell } from "./ui";
import { ScopePicker, useScope } from "./scope";

export function AiOperations() {
  const { isConnected } = useNetworkStatus();
  const { companyId } = useScope(); const [page, setPage] = useState(1), [prompt, setPrompt] = useState(""), [companyInput, setCompanyInput] = useState("");
  const overview = useGetMissionControlOverview(), roster = useListMissionControlAgents(), tasks = useListMissionControlAgentTasks({ companyId, page, limit: 20 }), create = useCreateMissionControlAgentTask(), qc = useQueryClient(), r = useRouter();
  const target = companyId ?? Number(companyInput);
  const analysis = overview.data?.aiAnalysisHealth;
  return <Shell title="AI operations" onRefresh={() => { void overview.refetch(); void roster.refetch(); void tasks.refetch(); }} refreshing={overview.isRefetching || roster.isRefetching || tasks.isRefetching}>
    <Label>AI ANALYSIS HEALTH / {analysis?.windowHours ?? 24} HOURS</Label>
    {analysis ? <><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 9 }}>
      <Metric value={analysis.completedCount} label="Completed" /><Metric value={analysis.failedCount} label="Failed" /><Metric value={analysis.pendingCount} label="Pending" />
    </View><Row title={analysis.latestResultAt ? "Latest analysis result" : "No analysis results in this window"} subtitle={analysis.latestResultAt ? date(analysis.latestResultAt) : "No completed or failed analyses have been recorded in the last 24 hours."} meta="PLATFORM-WIDE · SERVER-DERIVED" />
    {analysis.completedCount + analysis.failedCount + analysis.pendingCount === 0 && <Body muted>No analysis activity in this 24-hour window.</Body>}</> : <QueryState query={overview} empty="Analysis health is unavailable." />}
    <Label>EXECUTIVE AGENTS</Label>{roster.data ? <>{roster.data.agents.map(a => <Row key={a.identity} title={a.displayName} subtitle={a.role} meta={`${a.status.toUpperCase()} · ${a.capability ?? "No capability description"}`} />)}<Row title="Agent Zero" subtitle={`${roster.data.agentZero.realTaskCount} real tasks`} meta={roster.data.agentZero.available ? "AVAILABLE" : "UNAVAILABLE"} /></> : <QueryState query={roster} />}
    <ScopePicker /><Label>START AN INVESTIGATION</Label><Body muted>Investigations do not execute consequential changes. Approval is required for access actions.</Body>{!companyId && <Field value={companyInput} onChangeText={setCompanyInput} placeholder="Company ID" />}<Field value={prompt} onChangeText={setPrompt} placeholder="Investigation prompt" multiline />
    <Action label={create.isPending ? "Creating task" : "Create investigation"} disabled={!isConnected || create.isPending || !prompt.trim() || !Number.isInteger(target) || target <= 0} onPress={() => Alert.alert("Create investigation?", `Assign this investigation to company #${target}?`, [{ text: "Cancel", style: "cancel" }, { text: "Create", onPress: () => create.mutate({ data: { companyId: target, prompt: prompt.trim() } }, { onSuccess: task => { setPrompt(""); void qc.invalidateQueries({ queryKey: ["/api/mission-control/agents/tasks"] }); go(r, `/mission-control/ai/${task.id}`); } }) }])} />{create.isError && <Body>{errorText(create.error)}</Body>}
    <Label>TASK HISTORY / {tasks.data?.total ?? "—"}</Label>{tasks.data ? tasks.data.items.length ? <>{tasks.data.items.map(t => <Row key={t.id} title={`Task #${t.id} · ${t.status}`} subtitle={t.prompt} meta={`${t.companyName} · ${date(t.createdAt)}`} onPress={() => go(r, `/mission-control/ai/${t.id}`)} />)}<Pager page={page} total={tasks.data.totalPages} onChange={setPage} /></> : <QueryState query={tasks} /> : <QueryState query={tasks} />}
  </Shell>;
}
export function AiTaskDetail({ id }: { id: number }) {
  const q = useGetMissionControlAgentTask(id), r = useRouter();
  return <Shell title={`Investigation #${id}`} onRefresh={() => { void q.refetch(); }} refreshing={q.isRefetching}>{q.data ? <><Label>{q.data.status.toUpperCase()} / {q.data.companyName.toUpperCase()}</Label><Row title={q.data.prompt} subtitle={`Created by ${q.data.createdBy}`} meta={`${date(q.data.createdAt)} · completed ${date(q.data.completedAt)}`} onPress={() => go(r, `/mission-control/companies/${q.data?.companyId}`)} />
    <Label>RESULT</Label><Body>{q.data.result ?? q.data.error ?? "Awaiting result."}</Body><Label>DELEGATIONS</Label>{q.data.delegations?.map(d => <Row key={d.id} title={`${d.specialist} · ${d.status}`} subtitle={d.scope} meta={d.result ?? d.error ?? date(d.createdAt)} />)}<Label>WORK TRACE</Label>{q.data.traces?.map(t => <Row key={t.id} title={`${t.actor} · ${t.event}`} subtitle={t.detail} meta={date(t.createdAt)} />)}
  </> : <QueryState query={q} />}</Shell>;
}