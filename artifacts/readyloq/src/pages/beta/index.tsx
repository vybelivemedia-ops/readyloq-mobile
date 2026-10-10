import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Rocket,
  Camera,
  Video,
  Brain,
  FileText,
  ClipboardList,
  MessageSquare,
  AlertTriangle,
  Users,
  CheckCircle2,
  Circle,
  Copy,
  Check,
  UserPlus,
} from "lucide-react";
import {
  useGetAnalyticsDashboard,
  useListFeedback,
  useUpdateFeedback,
  useListErrorEvents,
  useGetChecklist,
  useToggleChecklistItem,
  useListTesters,
  useUpdateTesterAccess,
  useCreateInvite,
  useListInvites,
  getListFeedbackQueryKey,
  getGetChecklistQueryKey,
  getListTestersQueryKey,
  getListInvitesQueryKey,
  CreateInviteInputRole,
  UpdateFeedbackInputStatus,
} from "@workspace/api-client-react";
import type { BetaFeedback, ChecklistItem, Tester, Invite } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser } from "@/hooks/use-current-user";

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const SEVERITY_STYLES: Record<string, string> = {
  high: "bg-red-500/15 text-red-400 border-red-500/30",
  medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  low: "bg-sky-500/15 text-sky-400 border-sky-500/30",
};

const TYPE_STYLES: Record<string, string> = {
  bug: "bg-red-500/15 text-red-400 border-red-500/30",
  feature: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  ai_accuracy: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
};

const TYPE_LABELS: Record<string, string> = {
  bug: "Bug",
  feature: "Feature",
  ai_accuracy: "AI accuracy",
};

const CATEGORY_STYLES: Record<string, string> = {
  upload: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  ai: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  report: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  auth: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};

function StatCard({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: typeof Camera;
  label: string;
  value: number | string;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0">
          {loading ? (
            <Skeleton className="h-6 w-12 mb-1" />
          ) : (
            <p className="text-xl font-bold leading-none">{value}</p>
          )}
          <p className="text-xs text-muted-foreground mt-1 truncate">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function OverviewTab() {
  const { data: dash, isLoading } = useGetAnalyticsDashboard();
  const { data: checklist } = useGetChecklist();
  const { data: feedback } = useListFeedback();
  const { data: errors } = useListErrorEvents();

  const openFeedback = (feedback ?? []).filter((f) => f.status === "open").length;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground mb-2">Beta activity</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard icon={ClipboardList} label="Inspections" value={dash?.totalInspections ?? 0} loading={isLoading} />
          <StatCard icon={Camera} label="Photos captured" value={dash?.photosCaptured ?? 0} loading={isLoading} />
          <StatCard icon={Video} label="Videos captured" value={dash?.videosCaptured ?? 0} loading={isLoading} />
          <StatCard icon={Brain} label="AI analyses" value={dash?.aiAnalysesCompleted ?? 0} loading={isLoading} />
          <StatCard icon={FileText} label="Reports" value={dash?.totalReports ?? 0} loading={isLoading} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard
          icon={ClipboardList}
          label="Checklist complete"
          value={checklist ? `${checklist.completed}/${checklist.total}` : "—"}
        />
        <StatCard icon={MessageSquare} label="Open feedback" value={openFeedback} />
        <StatCard icon={AlertTriangle} label="Errors logged" value={errors?.summary.total ?? 0} />
      </div>
    </div>
  );
}

function FeedbackRow({ item }: { item: BetaFeedback }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const update = useUpdateFeedback();

  const setStatus = async (status: string) => {
    try {
      await update.mutateAsync({
        id: item.id,
        data: { status: status as (typeof UpdateFeedbackInputStatus)[keyof typeof UpdateFeedbackInputStatus] },
      });
      queryClient.invalidateQueries({ queryKey: getListFeedbackQueryKey() });
    } catch {
      toast({ title: "Couldn't update feedback", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium text-sm">{item.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">{item.description}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <Badge variant="outline" className={TYPE_STYLES[item.type] ?? ""}>
              {TYPE_LABELS[item.type] ?? item.type}
            </Badge>
            {item.severity ? (
              <Badge variant="outline" className={SEVERITY_STYLES[item.severity] ?? ""}>
                {item.severity}
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-[11px] text-muted-foreground">{timeAgo(item.createdAt)}</span>
          <Select value={item.status} onValueChange={setStatus}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="triaged">Triaged</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

function FeedbackTab() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const { data, isLoading } = useListFeedback(
    statusFilter === "all" ? undefined : { status: statusFilter },
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground">
          {data?.length ?? 0} item{(data?.length ?? 0) === 1 ? "" : "s"}
        </h3>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="triaged">Triaged</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      ) : (data?.length ?? 0) === 0 ? (
        <EmptyState icon={MessageSquare} text="No feedback yet." />
      ) : (
        <div className="space-y-3">
          {data!.map((f) => <FeedbackRow key={f.id} item={f} />)}
        </div>
      )}
    </div>
  );
}

function ErrorsTab() {
  const { data, isLoading } = useListErrorEvents();

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const summary = data?.summary;
  const events = data?.events ?? [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard icon={AlertTriangle} label="Total" value={summary?.total ?? 0} />
        <StatCard icon={Camera} label="Upload" value={summary?.upload ?? 0} />
        <StatCard icon={Brain} label="AI" value={summary?.ai ?? 0} />
        <StatCard icon={FileText} label="Report" value={summary?.report ?? 0} />
        <StatCard icon={Users} label="Auth" value={summary?.auth ?? 0} />
      </div>
      {events.length === 0 ? (
        <EmptyState icon={CheckCircle2} text="No errors logged. Nice." />
      ) : (
        <div className="space-y-2">
          {events.map((e) => (
            <Card key={e.id}>
              <CardContent className="p-3 flex items-start gap-3">
                <Badge variant="outline" className={`shrink-0 ${CATEGORY_STYLES[e.category] ?? ""}`}>
                  {e.category}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-mono break-words">{e.message}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {e.source} · {timeAgo(e.createdAt)}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function TesterRow({ tester }: { tester: Tester }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const update = useUpdateTesterAccess();
  const { data: currentUser } = useCurrentUser();

  const isSelf = currentUser?.id === tester.id;
  const isManagerTester = tester.role === "manager" || tester.role === "owner";

  const toggle = async (next: boolean) => {
    try {
      await update.mutateAsync({ userId: tester.id, data: { betaAccess: next } });
      queryClient.invalidateQueries({ queryKey: getListTestersQueryKey() });
    } catch {
      toast({ title: "Couldn't update access", variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
          <span className="text-xs font-bold text-primary uppercase">{tester.role[0]}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium capitalize">{tester.role}</p>
            <span className="text-[11px] text-muted-foreground">·</span>
            <span className="text-[11px] text-muted-foreground">{timeAgo(tester.lastSeenAt)}</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {tester.inspectionCount} inspection{tester.inspectionCount === 1 ? "" : "s"} ·{" "}
            {tester.feedbackCount} feedback
          </p>
        </div>
        {isManagerTester ? (
          <Badge variant="outline" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">
            Always on
          </Badge>
        ) : (
          <Switch
            checked={tester.betaAccess}
            onCheckedChange={toggle}
            disabled={update.isPending || isSelf}
          />
        )}
      </CardContent>
    </Card>
  );
}

function InviteRow({ invite }: { invite: Invite }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(invite.token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium capitalize">{invite.role} invite</p>
          <p className="text-[11px] text-muted-foreground truncate font-mono">{invite.token}</p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 shrink-0" onClick={copy}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </CardContent>
    </Card>
  );
}

function TestersTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: testers, isLoading } = useListTesters();
  const { data: invites } = useListInvites();
  const createInvite = useCreateInvite();
  const [role, setRole] = useState<(typeof CreateInviteInputRole)[keyof typeof CreateInviteInputRole]>(
    CreateInviteInputRole.technician,
  );

  const pendingInvites = (invites ?? []).filter((i) => !i.acceptedAt);

  const handleCreate = async () => {
    try {
      await createInvite.mutateAsync({ data: { role } });
      toast({ title: "Invite created", description: "Copy the token and share it with your tester." });
      queryClient.invalidateQueries({ queryKey: getListInvitesQueryKey() });
    } catch {
      toast({ title: "Couldn't create invite", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" />
            Invite a tester
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-2">
          <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="technician">Technician</SelectItem>
              <SelectItem value="manager">Manager</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleCreate} disabled={createInvite.isPending}>
            {createInvite.isPending ? "Creating…" : "Create invite"}
          </Button>
        </CardContent>
      </Card>

      {pendingInvites.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Pending invites</h3>
          {pendingInvites.map((i) => <InviteRow key={i.id} invite={i} />)}
        </div>
      ) : null}

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground">Team</h3>
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : (testers?.length ?? 0) === 0 ? (
          <EmptyState icon={Users} text="No testers yet." />
        ) : (
          <div className="space-y-2">
            {testers!.map((t) => <TesterRow key={t.id} tester={t} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function ChecklistTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetChecklist();
  const toggle = useToggleChecklistItem();

  const onToggle = async (item: ChecklistItem) => {
    try {
      await toggle.mutateAsync({ itemKey: item.key, data: { done: !item.done } });
      queryClient.invalidateQueries({ queryKey: getGetChecklistQueryKey() });
    } catch {
      toast({ title: "Couldn't update checklist", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
      </div>
    );
  }

  const items = data?.items ?? [];
  const groups = items.reduce<Record<string, ChecklistItem[]>>((acc, item) => {
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Launch readiness</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {data?.completed ?? 0} of {data?.total ?? 0} complete
            </p>
          </div>
          <div className="text-2xl font-bold text-primary">
            {data && data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0}%
          </div>
        </CardContent>
      </Card>

      {Object.entries(groups).map(([category, catItems]) => (
        <div key={category} className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground capitalize">{category}</h3>
          {catItems.map((item) => (
            <Card key={item.key}>
              <CardContent className="p-3">
                <button
                  type="button"
                  className="flex items-start gap-3 w-full text-left"
                  onClick={() => onToggle(item)}
                  disabled={toggle.isPending}
                >
                  {item.done ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0">
                    <p className={`text-sm font-medium ${item.done ? "line-through text-muted-foreground" : ""}`}>
                      {item.label}
                    </p>
                    {item.detail ? (
                      <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                    ) : null}
                  </div>
                </button>
              </CardContent>
            </Card>
          ))}
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon: Icon, text }: { icon: typeof Camera; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
      <Icon className="h-8 w-8 mb-2 opacity-50" />
      <p className="text-sm">{text}</p>
    </div>
  );
}

export default function BetaCenter() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
          <Rocket className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Beta Center</h1>
          <p className="text-sm text-muted-foreground">Run your closed beta — feedback, errors, testers, and launch readiness.</p>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
          <TabsTrigger value="errors">Errors</TabsTrigger>
          <TabsTrigger value="testers">Testers</TabsTrigger>
          <TabsTrigger value="checklist">Checklist</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4"><OverviewTab /></TabsContent>
        <TabsContent value="feedback" className="mt-4"><FeedbackTab /></TabsContent>
        <TabsContent value="errors" className="mt-4"><ErrorsTab /></TabsContent>
        <TabsContent value="testers" className="mt-4"><TestersTab /></TabsContent>
        <TabsContent value="checklist" className="mt-4"><ChecklistTab /></TabsContent>
      </Tabs>
    </div>
  );
}
