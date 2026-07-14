import { useGetExecutive, useListExecutiveTasks, useListExecutiveMemory, useListExecutiveMessages, useSendExecutiveMessage, useGetExecutiveReport, useRunExecutiveReport, useGetExecutiveProfileMemory, useListObjectives, useListApprovals, useListSpecialists, getGetExecutiveQueryKey, getListExecutiveTasksQueryKey, getListExecutiveMessagesQueryKey, getListExecutiveMemoryQueryKey, getGetExecutiveReportQueryKey, getGetExecutiveProfileMemoryQueryKey, getListObjectivesQueryKey, getListApprovalsQueryKey, getListSpecialistsQueryKey } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Terminal, Plus, FileBarChart, RefreshCw, Loader2, BriefcaseBusiness, Target, ShieldAlert, ShieldCheck, Boxes, CircleCheck, CircleSlash, Bot, Puzzle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { format, formatDistanceToNow } from "date-fns";
import { ReportView } from "@/components/ReportView";
import { execStatusStyle } from "@/lib/execStatus";

export default function ExecutiveDetail() {
  const { executiveId } = useParams();
  const queryClient = useQueryClient();
  const [chatMessage, setChatMessage] = useState("");
  const [running, setRunning] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [commandVerb, setCommandVerb] = useState<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  const { data: detail, isLoading, isError: detailError } = useGetExecutive(executiveId || "", { query: { enabled: !!executiveId, queryKey: getGetExecutiveQueryKey(executiveId || ""), refetchInterval: running ? 3000 : false } });
  const { data: tasks = [], isError: tasksError } = useListExecutiveTasks(executiveId || "", { query: { enabled: !!executiveId, queryKey: getListExecutiveTasksQueryKey(executiveId || ""), refetchInterval: running ? 1500 : false } });
  const { data: messages = [], isError: messagesError } = useListExecutiveMessages(executiveId || "", { query: { enabled: !!executiveId, queryKey: getListExecutiveMessagesQueryKey(executiveId || ""), refetchInterval: running ? 2500 : false } });
  const { data: memories = [], isError: memoriesError } = useListExecutiveMemory(executiveId || "", { query: { enabled: !!executiveId, queryKey: getListExecutiveMemoryQueryKey(executiveId || "") } });
  const { data: profileMemory, isError: profileMemoryError } = useGetExecutiveProfileMemory(executiveId || "", { query: { enabled: !!executiveId, queryKey: getGetExecutiveProfileMemoryQueryKey(executiveId || "") } });
  const professionalMemories = profileMemory?.memories ?? [];

  const { data: allObjectives = [], isLoading: objectivesLoading, isError: objectivesError } = useListObjectives({ query: { enabled: !!executiveId, queryKey: getListObjectivesQueryKey() } });
  const { data: pendingApprovals = [] } = useListApprovals({ status: "pending" }, { query: { enabled: !!executiveId, queryKey: getListApprovalsQueryKey({ status: "pending" }) } });
  const ownedObjectives = allObjectives.filter((o) => o.createdByExecutiveId === executiveId);
  const execApprovals = pendingApprovals.filter((a) => a.executiveId === executiveId);

  const { data: specialistsData, isLoading: specialistsLoading, isError: specialistsError } = useListSpecialists({ query: { enabled: !!executiveId, queryKey: getListSpecialistsQueryKey() } });
  const allSpecialists = specialistsData?.specialists ?? [];
  const execRole = detail?.executive.role;
  const connectedTools = execRole
    ? allSpecialists.filter((s) => s.ownerRole === execRole || s.collaboratorRoles.includes(execRole) || s.ownerRole === "shared")
    : [];

  const sendMessage = useSendExecutiveMessage();
  const { data: reportResult } = useGetExecutiveReport(executiveId || "", { query: { enabled: !!executiveId, queryKey: getGetExecutiveReportQueryKey(executiveId || "") } });
  const runReport = useRunExecutiveReport();
  const report = reportResult?.report ?? null;

  const isChiefOfStaff = detail?.executive.role === "chief_of_staff";

  const activeTask = activeTaskId ? tasks.find((t) => t.id === activeTaskId) : undefined;
  const progress = activeTask?.progress ?? 5;

  // Stop polling once the command task finishes; refresh report + chat so the
  // structured report and completion message land immediately.
  useEffect(() => {
    if (!running || !activeTask || !executiveId) return;
    if (activeTask.status === "done" || activeTask.status === "blocked") {
      setRunning(false);
      setActiveTaskId(null);
      setCommandVerb(null);
      queryClient.invalidateQueries({ queryKey: getGetExecutiveReportQueryKey(executiveId) });
      queryClient.invalidateQueries({ queryKey: getListExecutiveMessagesQueryKey(executiveId) });
    }
  }, [running, activeTask, executiveId, queryClient]);

  const handleRunReport = () => {
    if (!executiveId) return;
    runReport.mutate(
      { executiveId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetExecutiveReportQueryKey(executiveId) });
        },
      },
    );
  };

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (detailError) {
    return (
      <div className="mx-auto max-w-md rounded-md border border-rose-500/30 bg-rose-500/10 p-4 text-center font-mono text-xs text-rose-300">
        Failed to establish a link to this executive. The channel may be down — try again shortly.
      </div>
    );
  }
  if (isLoading || !detail) return <div className="text-center py-20 font-mono animate-pulse">[ ESTABLISHING SECURE LINK... ]</div>;

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim() || !executiveId) return;
    
    sendMessage.mutate(
      { executiveId, data: { content: chatMessage } },
      {
        onSuccess: (data) => {
          setChatMessage("");
          queryClient.invalidateQueries({ queryKey: getListExecutiveMessagesQueryKey(executiveId) });
          if (data.command?.detected && data.command.taskId) {
            setRunning(true);
            setActiveTaskId(data.command.taskId);
            setCommandVerb(data.command.verb ?? null);
            queryClient.invalidateQueries({ queryKey: getListExecutiveTasksQueryKey(executiveId) });
          }
        }
      }
    );
  };

  const exec = detail.executive;

  return (
    <div className="h-full flex flex-col gap-6 max-w-6xl mx-auto animate-in fade-in duration-300">
      {/* Header Profile */}
      <div className="bg-card border border-border p-6 rounded-lg flex items-start gap-6 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-full opacity-10 bg-gradient-to-l from-current" style={{ color: exec.accentColor }} />
        
        <div className="w-20 h-20 rounded-md flex items-center justify-center text-3xl font-bold font-mono border" style={{ backgroundColor: `${exec.accentColor}10`, color: exec.accentColor, borderColor: `${exec.accentColor}40` }}>
          {exec.avatarInitials}
        </div>
        
        <div className="flex-1">
          <div className="flex items-center gap-4 mb-1">
            <h1 className="text-3xl font-bold">{exec.name}</h1>
            <div className="flex items-center gap-2 px-3 py-1 rounded bg-secondary border border-border">
              <div className={`w-2 h-2 rounded-full ${execStatusStyle(exec.status).dot}`} />
              <span className="text-xs font-mono uppercase">{exec.status}</span>
            </div>
          </div>
          <p className="text-muted-foreground font-mono mb-4 text-sm">{exec.title} &mdash; {exec.tagline}</p>
          
          <div className="flex flex-wrap gap-2">
            {exec.specialties.map(spec => (
              <span key={spec} className="px-2 py-0.5 text-xs bg-secondary text-secondary-foreground rounded border border-border">{spec}</span>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-right shrink-0">
          <div className="text-xs text-muted-foreground font-mono uppercase">Model</div>
          <div className="text-xs font-mono text-foreground">{exec.model}</div>
          <div className="text-xs text-muted-foreground font-mono uppercase">Open</div>
          <div className="text-xs font-mono text-primary">{detail.openTasks}</div>
          <div className="text-xs text-muted-foreground font-mono uppercase">Done</div>
          <div className="text-xs font-mono text-emerald-400">{detail.completedTasks}</div>
          <div className="text-xs text-muted-foreground font-mono uppercase">Blocked</div>
          <div className={`text-xs font-mono ${detail.blockedTasks > 0 ? "text-destructive" : "text-muted-foreground"}`}>{detail.blockedTasks}</div>
          <div className="text-xs text-muted-foreground font-mono uppercase">Memory</div>
          <div className="text-xs font-mono text-foreground">{detail.memoryCount}</div>
          <div className="text-xs text-muted-foreground font-mono uppercase">Messages</div>
          <div className="text-xs font-mono text-foreground">{detail.messageCount}</div>
        </div>
      </div>

      {/* Mandate & Connected Tools */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-card border border-border rounded-lg overflow-hidden">
          <div className="p-3 border-b border-border bg-secondary/50 flex items-center gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-primary" />
            <h3 className="font-mono text-xs uppercase font-bold tracking-wider">Mandate</h3>
          </div>
          <div className="p-4">
            {detail.capability ? (
              <>
                <p className="text-sm leading-relaxed text-foreground/90">{detail.capability.responsibility}</p>
                {detail.capability.resources.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      <Boxes className="w-3 h-3" /> Inspected Resources
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {detail.capability.resources.map((r) => (
                        <span key={r} className="rounded border border-border bg-secondary px-2 py-0.5 font-mono text-[10px] text-secondary-foreground">
                          {r}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground font-mono">
                {isChiefOfStaff
                  ? `${exec.name} coordinates the executive team and aggregates their reports.`
                  : "No structured mandate registered for this executive."}
              </p>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 bg-card border border-border rounded-lg overflow-hidden">
          <div className="p-3 border-b border-border bg-secondary/50 flex items-center gap-2">
            <Puzzle className="w-3.5 h-3.5 text-primary" />
            <h3 className="font-mono text-xs uppercase font-bold tracking-wider">Connected Tools ({connectedTools.length})</h3>
          </div>
          <div className="p-3">
            {specialistsLoading ? (
              <div className="p-4 text-center text-xs text-muted-foreground font-mono animate-pulse">Loading tools…</div>
            ) : specialistsError ? (
              <div className="p-4 text-center text-xs text-destructive font-mono">Tools unavailable.</div>
            ) : connectedTools.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground font-mono">No specialists or skills connected to {exec.name}.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {connectedTools.map((tool) => (
                  <div key={tool.id} className="rounded border border-border bg-background p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {tool.kind === "agent" ? <Bot className="w-3.5 h-3.5 text-primary shrink-0" /> : <Puzzle className="w-3.5 h-3.5 text-accent shrink-0" />}
                        <span className="text-sm font-medium truncate">{tool.name}</span>
                      </div>
                      {tool.available ? (
                        <CircleCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <CircleSlash className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{tool.purpose}</p>
                    <div className="mt-2 flex items-center gap-3 font-mono text-[10px] text-muted-foreground/70">
                      <span className="uppercase">{tool.kind}</span>
                      <span>·</span>
                      <span>{tool.confidence}% conf</span>
                      <span>·</span>
                      <span>{tool.runCount} runs</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Capability Report */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="p-4 border-b border-border bg-secondary/50 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <FileBarChart className="w-4 h-4 text-primary" />
            <h3 className="font-mono text-sm uppercase font-bold tracking-wider">Capability Report</h3>
            {report && (
              <span className="text-[10px] font-mono text-muted-foreground/70">
                {formatDistanceToNow(new Date(report.createdAt), { addSuffix: true })}
              </span>
            )}
          </div>
          {!isChiefOfStaff && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleRunReport}
              disabled={runReport.isPending}
              className="font-mono text-xs h-8 gap-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${runReport.isPending ? "animate-spin" : ""}`} />
              {runReport.isPending ? "SCANNING..." : report ? "RE-RUN" : "RUN REPORT"}
            </Button>
          )}
        </div>
        <div className="p-5">
          {isChiefOfStaff ? (
            <p className="text-sm text-muted-foreground font-mono">
              {exec.name} aggregates every executive's report into the daily briefing. View it on the{" "}
              <Link href="/" className="text-primary hover:underline">Overview</Link> dashboard.
            </p>
          ) : report ? (
            <ReportView report={report} />
          ) : (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground font-mono mb-1">No report on file.</p>
              <p className="text-xs text-muted-foreground/70 font-mono mb-4">
                {reportResult?.responsibility ?? "Run a scan to inspect live project resources."}
              </p>
              {reportResult && reportResult.resources.length > 0 && (
                <div className="flex flex-wrap gap-2 justify-center">
                  {reportResult.resources.map((r) => (
                    <span key={r} className="px-2 py-0.5 text-[10px] font-mono bg-secondary text-secondary-foreground rounded border border-border">
                      {r}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        
        {/* Left Col: Tasks & Memory */}
        <div className="lg:col-span-1 flex flex-col gap-6 overflow-hidden">

          {/* Owned Objectives & Approvals */}
          <div className="flex flex-col bg-card border border-border rounded-lg overflow-hidden">
            <div className="p-3 border-b border-border bg-secondary/50 flex items-center gap-2">
              <Target className="w-3.5 h-3.5 text-primary" />
              <h3 className="font-mono text-xs uppercase font-bold tracking-wider">Owned Objectives ({ownedObjectives.length})</h3>
            </div>
            <div className="max-h-56 overflow-y-auto p-2 space-y-2">
              {execApprovals.length > 0 && (
                <Link href="/objectives" className="flex items-center gap-2 p-2 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-mono hover:bg-amber-500/20 transition-colors">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                  {execApprovals.length} pending approval{execApprovals.length === 1 ? "" : "s"} awaiting sign-off
                </Link>
              )}
              {objectivesLoading ? (
                <div className="p-4 text-center text-xs text-muted-foreground font-mono animate-pulse">Loading objectives…</div>
              ) : objectivesError ? (
                <div className="p-4 text-center text-xs text-destructive font-mono">Objectives unavailable.</div>
              ) : ownedObjectives.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground font-mono">No objectives originated by {exec.name} yet.</div>
              ) : ownedObjectives.map((o) => (
                <Link key={o.id} href={`/objectives/${o.id}`} className="block p-3 rounded border border-border bg-background hover:border-primary/40 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium leading-tight">{o.title}</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-secondary uppercase shrink-0">{o.status.replace(/_/g, ' ')}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-[10px] font-mono text-muted-foreground">
                    <span>{o.openTaskCount}/{o.taskCount} open</span>
                    {o.pendingApprovalCount > 0 && <span className="text-amber-400">{o.pendingApprovalCount} approval{o.pendingApprovalCount === 1 ? "" : "s"}</span>}
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Tasks */}
          <div className="flex-1 flex flex-col bg-card border border-border rounded-lg overflow-hidden min-h-[300px]">
            <div className="p-3 border-b border-border bg-secondary/50 flex justify-between items-center">
              <h3 className="font-mono text-xs uppercase font-bold tracking-wider">Active Directives</h3>
              <Button size="icon" variant="ghost" className="h-6 w-6"><Plus className="w-4 h-4" /></Button>
            </div>
            <div className="overflow-y-auto p-2 space-y-2">
              {tasksError ? (
                <div className="p-4 text-center text-xs text-destructive font-mono">Directives unavailable — the channel may be down.</div>
              ) : tasks.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground font-mono">No active directives.</div>
              ) : tasks.map(task => (
                <div key={task.id} className="p-3 rounded border border-border bg-background flex flex-col gap-2">
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-sm font-medium leading-tight">{task.title}</span>
                  </div>
                  <div className="flex justify-between items-center mt-2">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-secondary uppercase">{task.status.replace('_', ' ')}</span>
                    <span className={`text-[10px] font-mono uppercase ${task.priority === 'critical' ? 'text-destructive' : 'text-muted-foreground'}`}>{task.priority}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Memory */}
          <div className="flex-1 flex flex-col bg-card border border-border rounded-lg overflow-hidden min-h-[300px]">
            <div className="p-3 border-b border-border bg-secondary/50 flex justify-between items-center">
              <h3 className="font-mono text-xs uppercase font-bold tracking-wider">Long-term Memory ({detail.memoryCount})</h3>
            </div>
            <div className="overflow-y-auto p-2 space-y-2">
              {memoriesError ? (
                 <div className="p-4 text-center text-xs text-destructive font-mono">Memory banks unreachable — retrying shortly.</div>
              ) : memories.length === 0 ? (
                 <div className="p-4 text-center text-xs text-muted-foreground font-mono">Memory banks empty.</div>
              ) : memories.map(mem => (
                <div key={mem.id} className="p-3 rounded border border-border bg-background text-sm text-muted-foreground border-l-2" style={{ borderLeftColor: exec.accentColor }}>
                  <span className="font-mono text-[10px] uppercase block mb-1 text-primary">{mem.kind}</span>
                  {mem.content}
                </div>
              ))}
            </div>
          </div>

          {/* Professional Memory (V9) */}
          <div className="flex-1 flex flex-col bg-card border border-border rounded-lg overflow-hidden min-h-[300px]">
            <div className="p-3 border-b border-border bg-secondary/50 flex items-center gap-2">
              <BriefcaseBusiness className="w-3.5 h-3.5 text-primary" />
              <h3 className="font-mono text-xs uppercase font-bold tracking-wider">Professional Memory ({professionalMemories.length})</h3>
            </div>
            <div className="overflow-y-auto p-2 space-y-2">
              {profileMemoryError ? (
                <div className="p-4 text-center text-xs text-destructive font-mono">Professional memory unavailable — the channel may be down.</div>
              ) : professionalMemories.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground font-mono">No professional experience recorded yet. It accumulates from real work and is cited in recommendations.</div>
              ) : professionalMemories.map(mem => (
                <div key={mem.id} className="p-3 rounded border border-border bg-background text-sm text-muted-foreground">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-mono text-[10px] uppercase text-primary">{mem.kind.replace(/_/g, " ")}</span>
                    <span className="font-mono text-[9px] text-muted-foreground/50">weight {mem.weight}</span>
                  </div>
                  <p className="leading-relaxed">{mem.content}</p>
                  {mem.keywords.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {mem.keywords.map((k) => (
                        <span key={k} className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">{k}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Col: Comms / Chat */}
        <div className="lg:col-span-2 flex flex-col bg-card border border-border rounded-lg overflow-hidden">
           <div className="p-4 border-b border-border bg-secondary/50 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-primary" />
              <h3 className="font-mono text-sm uppercase font-bold tracking-wider">Secure Comms Channel</h3>
           </div>

           {running && (
             <div className="px-4 py-3 border-b border-border bg-primary/5">
               <div className="flex items-center justify-between mb-2">
                 <div className="flex items-center gap-2">
                   <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                   <span className="font-mono text-[11px] uppercase tracking-wider text-primary">
                     Executing {commandVerb ?? "command"}…
                   </span>
                 </div>
                 <span className="font-mono text-[11px] text-muted-foreground">{progress}%</span>
               </div>
               <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                 <div className="h-full bg-primary transition-all duration-700" style={{ width: `${progress}%` }} />
               </div>
             </div>
           )}

           <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-4 space-y-6">
             {messagesError ? (
                <div className="h-full flex items-center justify-center text-sm font-mono text-destructive">
                  Comms channel disrupted — unable to load transmissions. Retrying…
                </div>
             ) : messages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm font-mono text-muted-foreground">
                  Channel open. Awaiting transmission...
                </div>
             ) : messages.map((msg, i) => (
                <div key={msg.id} className={`flex flex-col max-w-[85%] ${msg.role === 'founder' ? 'ml-auto items-end' : 'mr-auto items-start'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-mono text-muted-foreground uppercase">{msg.role === 'founder' ? 'Founder' : exec.name}</span>
                    <span className="text-[10px] font-mono text-muted-foreground/50">{format(new Date(msg.createdAt), 'HH:mm:ss')}</span>
                  </div>
                  <div className={`p-3 rounded-lg text-sm ${msg.role === 'founder' ? 'bg-primary/20 text-primary-foreground border border-primary/30 rounded-tr-sm' : 'bg-secondary text-secondary-foreground border border-border rounded-tl-sm'}`}>
                    {msg.content}
                  </div>
                </div>
             ))}
           </div>

           {isChiefOfStaff ? (
             <div className="p-4 border-t border-border bg-background">
               <form onSubmit={handleSendMessage} className="flex gap-2">
                 <Input
                   value={chatMessage}
                   onChange={(e) => setChatMessage(e.target.value)}
                   placeholder={`Command ${exec.name}...`}
                   className="font-mono bg-secondary/50 border-border focus-visible:ring-primary"
                   disabled={sendMessage.isPending}
                 />
                 <Button type="submit" disabled={!chatMessage.trim() || sendMessage.isPending} className="bg-primary text-primary-foreground hover:bg-primary/90 font-mono w-24">
                   {sendMessage.isPending ? 'TX...' : 'TRANSMIT'}
                 </Button>
               </form>
             </div>
           ) : (
             <div className="p-4 border-t border-border bg-secondary/30 flex items-center gap-3">
               <div className="w-1.5 h-1.5 rounded-full bg-primary/50 flex-shrink-0" />
               <p className="text-xs text-muted-foreground font-mono">
                 To direct {exec.name}, tell{" "}
                 <Link href="/" className="text-primary hover:underline">Quinn</Link>
                 {" "}what you need — she'll coordinate this executive on your behalf.
               </p>
             </div>
           )}
        </div>

      </div>
    </div>
  );
}
