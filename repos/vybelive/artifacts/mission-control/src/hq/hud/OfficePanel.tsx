import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetExecutiveReport,
  useRunExecutiveReport,
  useListExecutiveMessages,
  useListExecutiveTasks,
  useSendExecutiveMessage,
  getGetExecutiveReportQueryKey,
  getListExecutiveMessagesQueryKey,
  getListExecutiveTasksQueryKey,
} from "@workspace/api-client-react";
import { ArrowLeft, FileBarChart, Loader2, RefreshCw, Terminal, Target } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReportView } from "@/components/ReportView";
import { execStatusStyle } from "@/lib/execStatus";
import { DEPARTMENTS } from "../lib/departments";
import type { HQExecutive } from "../lib/hqTypes";
import { useHQUI } from "../lib/HQUIContext";
import { blip } from "../lib/sound";

export function OfficePanel({ executive }: { executive: HQExecutive }) {
  const { exitOffice, soundOn } = useHQUI();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const [shown, setShown] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [running, setRunning] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [commandVerb, setCommandVerb] = useState<string | null>(null);
  const [objectiveId, setObjectiveId] = useState<string | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const id = executive.id;

  const { data: reportResult } = useGetExecutiveReport(id, {
    query: { queryKey: getGetExecutiveReportQueryKey(id) },
  });
  const runReport = useRunExecutiveReport();
  const { data: messages = [] } = useListExecutiveMessages(id, {
    query: { queryKey: getListExecutiveMessagesQueryKey(id), refetchInterval: running ? 2500 : 8000 },
  });
  const { data: tasks = [] } = useListExecutiveTasks(id, {
    query: { queryKey: getListExecutiveTasksQueryKey(id), refetchInterval: running ? 1500 : false },
  });
  const sendMessage = useSendExecutiveMessage();
  const report = reportResult?.report ?? null;
  const isChief = executive.role === "chief_of_staff";

  const activeTask = activeTaskId ? tasks.find((t) => t.id === activeTaskId) : undefined;
  const progress = activeTask?.progress ?? 5;

  useEffect(() => {
    const t = setTimeout(() => setShown(true), 50);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  // Stop polling once the command task finishes; refresh report + chat so the
  // structured report and completion message land immediately.
  useEffect(() => {
    if (!running || !activeTask) return;
    if (activeTask.status === "done" || activeTask.status === "blocked") {
      setRunning(false);
      setActiveTaskId(null);
      setCommandVerb(null);
      queryClient.invalidateQueries({ queryKey: getGetExecutiveReportQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getListExecutiveMessagesQueryKey(id) });
    }
  }, [running, activeTask, id, queryClient]);

  const handleRun = () => {
    runReport.mutate(
      { executiveId: id },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetExecutiveReportQueryKey(id) }) },
    );
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;
    if (soundOn) blip("select");
    sendMessage.mutate(
      { executiveId: id, data: { content: chatMessage } },
      {
        onSuccess: (data) => {
          setChatMessage("");
          queryClient.invalidateQueries({ queryKey: getListExecutiveMessagesQueryKey(id) });
          if (data.command?.detected && data.command.objectiveId) {
            setObjectiveId(data.command.objectiveId);
            setCommandVerb(data.command.verb ?? "orchestrate");
          }
          if (data.command?.detected && data.command.taskId) {
            setRunning(true);
            setActiveTaskId(data.command.taskId);
            setCommandVerb(data.command.verb ?? null);
            queryClient.invalidateQueries({ queryKey: getListExecutiveTasksQueryKey(id) });
          }
        },
      },
    );
  };

  const close = () => {
    if (soundOn) blip("exit");
    exitOffice();
  };

  return (
    <div
      className={`absolute top-0 right-0 z-30 h-full w-[min(460px,94vw)] flex flex-col bg-card/90 backdrop-blur-md border-l border-border transition-transform duration-500 ${
        shown ? "translate-x-0" : "translate-x-full"
      }`}
    >
      {/* header */}
      <div className="p-5 border-b border-border relative overflow-hidden shrink-0">
        <div className="absolute top-0 right-0 w-32 h-full opacity-10 bg-gradient-to-l from-current" style={{ color: executive.accentColor }} />
        <button onClick={close} className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground mb-4 transition-colors">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to command center
        </button>
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-md flex items-center justify-center text-xl font-bold font-mono border"
            style={{ backgroundColor: `${executive.accentColor}15`, color: executive.accentColor, borderColor: `${executive.accentColor}40` }}
          >
            {executive.avatarInitials}
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-bold truncate">{executive.name}</h2>
            <p className="text-xs text-muted-foreground font-mono truncate">
              {DEPARTMENTS[executive.role].label} — {executive.title}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <div className={`w-2 h-2 rounded-full ${execStatusStyle(executive.status).dot}`} />
              <span className="text-[10px] font-mono uppercase text-muted-foreground">{executive.status} • {executive.openCount} open</span>
            </div>
          </div>
        </div>
      </div>

      {/* report */}
      <div className="p-5 border-b border-border max-h-[40%] overflow-y-auto shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FileBarChart className="w-4 h-4 text-primary" />
            <h3 className="font-mono text-xs uppercase font-bold tracking-wider">Capability Report</h3>
            {report && (
              <span className="text-[10px] font-mono text-muted-foreground/70">
                {formatDistanceToNow(new Date(report.createdAt), { addSuffix: true })}
              </span>
            )}
          </div>
          {!isChief && (
            <Button size="sm" variant="outline" onClick={handleRun} disabled={runReport.isPending} className="font-mono text-xs h-7 gap-2">
              <RefreshCw className={`w-3 h-3 ${runReport.isPending ? "animate-spin" : ""}`} />
              {runReport.isPending ? "SCAN" : report ? "RE-RUN" : "RUN"}
            </Button>
          )}
        </div>
        {isChief ? (
          <p className="text-xs text-muted-foreground font-mono">Aggregates every executive into the daily briefing shown in the command center.</p>
        ) : report ? (
          <ReportView report={report} />
        ) : (
          <p className="text-xs text-muted-foreground font-mono">{reportResult?.responsibility ?? "No report on file. Run a scan to inspect live resources."}</p>
        )}
      </div>

      {/* command-in-progress banner */}
      {running && (
        <div className="px-5 py-3 border-b border-border bg-primary/5 shrink-0">
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

      {/* objective dispatched banner (chief orchestration) */}
      {objectiveId && (
        <div className="px-5 py-3 border-b border-border bg-primary/5 shrink-0">
          <button
            onClick={() => {
              if (soundOn) blip("select");
              navigate(`/objectives/${objectiveId}`);
            }}
            className="flex items-center justify-between w-full group"
          >
            <div className="flex items-center gap-2">
              <Target className="w-3.5 h-3.5 text-primary" />
              <span className="font-mono text-[11px] uppercase tracking-wider text-primary">
                Objective dispatched — view orchestration
              </span>
            </div>
            <ArrowLeft className="w-3.5 h-3.5 text-primary rotate-180 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>
      )}

      {/* chat */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border shrink-0">
        <Terminal className="w-4 h-4 text-primary" />
        <h3 className="font-mono text-xs uppercase font-bold tracking-wider">Secure Comms</h3>
      </div>
      <div ref={chatRef} className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs font-mono text-muted-foreground">Channel open. Awaiting transmission...</div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`flex flex-col max-w-[88%] ${msg.role === "founder" ? "ml-auto items-end" : "mr-auto items-start"}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-mono text-muted-foreground uppercase">{msg.role === "founder" ? "You" : executive.name}</span>
                <span className="text-[10px] font-mono text-muted-foreground/50">{format(new Date(msg.createdAt), "HH:mm")}</span>
              </div>
              <div className={`p-3 rounded-lg text-sm ${msg.role === "founder" ? "bg-primary/20 border border-primary/30 rounded-tr-sm" : "bg-secondary border border-border rounded-tl-sm"}`}>
                {msg.content}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="p-4 border-t border-border shrink-0">
        <form onSubmit={handleSend} className="flex gap-2">
          <Input
            value={chatMessage}
            onChange={(e) => setChatMessage(e.target.value)}
            placeholder={`Command ${executive.name.split(" ")[0]}...`}
            className="font-mono bg-secondary/50 border-border focus-visible:ring-primary"
            disabled={sendMessage.isPending}
          />
          <Button type="submit" disabled={!chatMessage.trim() || sendMessage.isPending} className="bg-primary text-primary-foreground hover:bg-primary/90 font-mono">
            {sendMessage.isPending ? "TX" : "SEND"}
          </Button>
        </form>
      </div>
    </div>
  );
}
