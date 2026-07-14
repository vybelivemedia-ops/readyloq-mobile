import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSalesOpportunities,
  getListSalesOpportunitiesQueryKey,
  useGetSalesOpportunityTrends,
  getGetSalesOpportunityTrendsQueryKey,
  useGetSalesOpportunity,
  getGetSalesOpportunityQueryKey,
  useUpdateSalesOpportunity,
  useGetOpportunitySettings,
  getGetOpportunitySettingsQueryKey,
  useUpdateOpportunitySettings,
  useListOpportunityNotes,
  getListOpportunityNotesQueryKey,
  useAddOpportunityNote,
  type SalesOpportunity,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useCurrentUser, isManagerRole } from "@/hooks/use-current-user";
import {
  Lightbulb,
  TrendingUp,
  Building2,
  ShieldCheck,
  Settings2,
  Eye,
  CircleDollarSign,
  AlertTriangle,
  MessageSquare,
  Flame,
} from "lucide-react";

/**
 * Opportunity Log — management-only view of AI-mined business opportunities.
 *
 * Every opportunity shown here is grounded in verified inspection findings
 * (the API rejects candidates without real evidence IDs). Value is a tier,
 * never a fabricated dollar figure — the only dollar amount on this page is
 * `estimatedAnnualValue`, which is HUMAN-entered by sales/management and
 * clearly labeled as their own estimate. Technicians never see this page:
 * the nav item and route are role-gated, and the API returns 403 regardless.
 */

const STATUSES = ["new", "reviewed", "quoted", "won", "lost", "dismissed"] as const;

const CATEGORY_LABELS: Record<string, string> = {
  revenue: "Revenue",
  additional_service: "Additional Service",
  structural: "Structural",
  conducive_condition: "Conducive Condition",
  property_risk: "Property Risk",
  pest_trend: "Pest Trend",
  preventative: "Preventative",
};

const STATUS_STYLES: Record<string, string> = {
  new: "bg-primary/15 text-primary",
  reviewed: "bg-blue-500/15 text-blue-500",
  quoted: "bg-amber-500/15 text-amber-500",
  won: "bg-emerald-500/15 text-emerald-500",
  lost: "bg-red-500/15 text-red-400",
  dismissed: "bg-muted text-muted-foreground",
};

const TIER_STYLES: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-amber-500/15 text-amber-500",
  high: "bg-emerald-500/15 text-emerald-500",
};

const RISK_STYLES: Record<string, string> = {
  low: "bg-slate-500/15 text-slate-400",
  medium: "bg-amber-500/15 text-amber-400",
  high: "bg-orange-500/15 text-orange-400",
  critical: "bg-red-500/15 text-red-400",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="secondary" className={STATUS_STYLES[status] ?? ""}>
      {status}
    </Badge>
  );
}

function TierBadge({ tier }: { tier: string }) {
  return (
    <Badge variant="secondary" className={TIER_STYLES[tier] ?? ""}>
      <CircleDollarSign className="h-3 w-3 mr-1" />
      {tier} value
    </Badge>
  );
}

function PriorityBadge({ priority }: { priority: number | undefined }) {
  if (priority == null) return null;
  const style =
    priority >= 70
      ? "bg-red-500/15 text-red-400"
      : priority >= 40
        ? "bg-amber-500/15 text-amber-400"
        : "bg-muted text-muted-foreground";
  return (
    <Badge variant="secondary" className={style}>
      <Flame className="h-3 w-3 mr-1" />
      P{priority}
    </Badge>
  );
}

function RiskBadge({ riskLevel }: { riskLevel: string | null | undefined }) {
  if (!riskLevel) return null;
  return (
    <Badge variant="secondary" className={RISK_STYLES[riskLevel] ?? ""}>
      <AlertTriangle className="h-3 w-3 mr-1" />
      {riskLevel} risk
    </Badge>
  );
}

function formatDollars(value: number) {
  return `$${value.toLocaleString()}`;
}

/** Immutable notes thread — corrections are new notes, nothing is edited. */
function NotesThread({ opportunityId }: { opportunityId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState("");

  const { data: notes, isLoading } = useListOpportunityNotes(opportunityId, {
    query: { queryKey: getListOpportunityNotesQueryKey(opportunityId) },
  });
  const addNote = useAddOpportunityNote({
    mutation: {
      onSuccess: () => {
        setDraft("");
        queryClient.invalidateQueries({
          queryKey: getListOpportunityNotesQueryKey(opportunityId),
        });
      },
      onError: () => toast({ title: "Failed to add note", variant: "destructive" }),
    },
  });

  return (
    <div className="border-t pt-3 mt-1">
      <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
        <MessageSquare className="h-3.5 w-3.5" /> Notes
        <span className="font-normal">(permanent — corrections are new notes)</span>
      </p>
      {isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : (
        <div className="space-y-2 max-h-40 overflow-y-auto mb-2">
          {(notes ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No notes yet.</p>
          ) : (
            (notes ?? []).map((note) => (
              <div key={note.id} className="rounded-md bg-muted/40 px-2.5 py-1.5">
                <p className="text-sm whitespace-pre-wrap">{note.body}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5 capitalize">
                  {note.authorRole} · {new Date(note.createdAt).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note…"
          rows={1}
          className="min-h-9 text-sm"
        />
        <Button
          size="sm"
          disabled={addNote.isPending || draft.trim().length === 0}
          onClick={() => addNote.mutate({ id: opportunityId, data: { body: draft.trim() } })}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function OpportunityDetailDialog({
  opportunityId,
  canDismiss,
  onClose,
}: {
  opportunityId: number;
  canDismiss: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [valueDraft, setValueDraft] = useState<string | null>(null);
  const { data, isLoading } = useGetSalesOpportunity(opportunityId, {
    query: { queryKey: getGetSalesOpportunityQueryKey(opportunityId) },
  });
  const update = useUpdateSalesOpportunity({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSalesOpportunitiesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSalesOpportunityTrendsQueryKey() });
        queryClient.invalidateQueries({
          queryKey: getGetSalesOpportunityQueryKey(opportunityId),
        });
        setValueDraft(null);
        toast({ title: "Opportunity updated" });
      },
      onError: (error) => {
        toast({
          title: "Update failed",
          description: error instanceof Error ? error.message : undefined,
          variant: "destructive",
        });
      },
    },
  });

  const setStatus = (status: (typeof STATUSES)[number]) =>
    update.mutate({ id: opportunityId, data: { status } });

  const saveValue = () => {
    if (valueDraft === null) return;
    const trimmed = valueDraft.trim();
    if (trimmed === "") {
      update.mutate({ id: opportunityId, data: { estimatedAnnualValue: null } });
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 0) {
      toast({ title: "Enter a whole dollar amount", variant: "destructive" });
      return;
    }
    update.mutate({ id: opportunityId, data: { estimatedAnnualValue: parsed } });
  };

  const nextActions: { label: string; status: (typeof STATUSES)[number] }[] = [];
  if (data) {
    if (data.status === "new") nextActions.push({ label: "Mark reviewed", status: "reviewed" });
    if (data.status === "reviewed") nextActions.push({ label: "Mark quoted", status: "quoted" });
    if (data.status === "quoted") nextActions.push({ label: "Mark won", status: "won" });
  }
  const isClosed = data?.status === "dismissed" || data?.status === "won" || data?.status === "lost";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        {isLoading || !data ? (
          <div className="space-y-3 py-4">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6">{data.title}</DialogTitle>
              <DialogDescription>{data.propertyAddress}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={data.status} />
              <PriorityBadge priority={data.priority} />
              <RiskBadge riskLevel={data.riskLevel} />
              <TierBadge tier={data.estimatedValueTier} />
              <Badge variant="outline">{CATEGORY_LABELS[data.category] ?? data.category}</Badge>
              <Badge variant="outline">
                {Math.round(data.confidence * 100)}% confidence
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{data.rationale}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
              Backed by {data.evidenceFindingIds.length} verified finding
              {data.evidenceFindingIds.length === 1 ? "" : "s"} from inspection #
              {data.inspectionId}
            </div>
            {data.evidenceImagePaths.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {data.evidenceImagePaths.slice(0, 6).map((path) => (
                  <img
                    key={path}
                    src={path}
                    alt="Evidence"
                    className="h-20 w-full rounded-md object-cover border"
                  />
                ))}
              </div>
            )}

            <div className="border-t pt-3">
              <p className="text-xs font-semibold text-muted-foreground mb-1">
                Estimated annual value
                <span className="font-normal"> (your estimate — never AI-generated)</span>
              </p>
              {valueDraft === null ? (
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">
                    {data.estimatedAnnualValue != null
                      ? `${formatDollars(data.estimatedAnnualValue)}/yr`
                      : "Not set"}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setValueDraft(data.estimatedAnnualValue?.toString() ?? "")}
                  >
                    {data.estimatedAnnualValue != null ? "Edit" : "Set value"}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={valueDraft}
                    onChange={(e) => setValueDraft(e.target.value)}
                    placeholder="Whole dollars, blank to clear"
                    className="h-8 text-sm"
                  />
                  <Button size="sm" disabled={update.isPending} onClick={saveValue}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setValueDraft(null)}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              {nextActions.map((action) => (
                <Button
                  key={action.status}
                  size="sm"
                  disabled={update.isPending}
                  onClick={() => setStatus(action.status)}
                >
                  {action.label}
                </Button>
              ))}
              {canDismiss && data.status === "quoted" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-400 hover:text-red-400"
                  disabled={update.isPending}
                  onClick={() => setStatus("lost")}
                >
                  Mark lost
                </Button>
              )}
              {canDismiss && !isClosed && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={update.isPending}
                  onClick={() => setStatus("dismissed")}
                >
                  Dismiss
                </Button>
              )}
            </div>

            <NotesThread opportunityId={opportunityId} />

            {data.events.length > 0 && (
              <div className="border-t pt-3 mt-1">
                <p className="text-xs font-semibold text-muted-foreground mb-2">Activity</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {data.events.slice(0, 10).map((event) => (
                    <div
                      key={event.id}
                      className="flex items-center justify-between text-xs text-muted-foreground"
                    >
                      <span className="capitalize">{event.action.replace(/_/g, " ")}</span>
                      <span>{new Date(event.createdAt).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useGetOpportunitySettings({
    query: { queryKey: getGetOpportunitySettingsQueryKey() },
  });
  const update = useUpdateOpportunitySettings({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetOpportunitySettingsQueryKey() });
        toast({ title: "Settings saved" });
      },
      onError: () => toast({ title: "Save failed", variant: "destructive" }),
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Opportunity Mining Settings</DialogTitle>
          <DialogDescription>
            Controls the background AI that mines verified findings for opportunities.
          </DialogDescription>
        </DialogHeader>
        {isLoading || !data ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Opportunity mining</p>
                <p className="text-xs text-muted-foreground">
                  When off, no new opportunities are generated.
                </p>
              </div>
              <Switch
                checked={data.enabled}
                disabled={update.isPending}
                onCheckedChange={(enabled) => update.mutate({ data: { enabled } })}
              />
            </div>
            <div>
              <p className="text-sm font-medium mb-1">
                Minimum confidence: {Math.round(data.minConfidence * 100)}%
              </p>
              <p className="text-xs text-muted-foreground mb-2">
                Candidates below this evidence-confidence level are discarded.
              </p>
              <div className="flex gap-2">
                {[0.3, 0.5, 0.7, 0.9].map((value) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={data.minConfidence === value ? "default" : "outline"}
                    disabled={update.isPending}
                    onClick={() => update.mutate({ data: { minConfidence: value } })}
                  >
                    {Math.round(value * 100)}%
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function OpportunitiesPage() {
  const { data: currentUser } = useCurrentUser();
  const isManager = isManagerRole(currentUser?.role);
  const isOwner = currentUser?.role === "owner";

  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const params = statusFilter ? { status: statusFilter } : undefined;
  const { data: opportunities, isLoading } = useListSalesOpportunities(params, {
    query: { queryKey: getListSalesOpportunitiesQueryKey(params) },
  });
  const { data: trends } = useGetSalesOpportunityTrends({
    query: { queryKey: getGetSalesOpportunityTrendsQueryKey() },
  });

  const rows: SalesOpportunity[] = opportunities ?? [];
  const openCount =
    (trends?.byStatus?.new ?? 0) + (trends?.byStatus?.reviewed ?? 0) + (trends?.byStatus?.quoted ?? 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Lightbulb className="h-6 w-6 text-primary" /> Opportunity Log
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            AI-surfaced opportunities, every one backed by verified inspection evidence
          </p>
        </div>
        {isOwner && (
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="h-4 w-4 mr-2" /> Mining Settings
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Open</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-bold">{openCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Won</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-bold text-emerald-500">{trends?.byStatus?.won ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              High Value
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-bold">{trends?.byTier?.high ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">Total</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-2xl font-bold">{trends?.total ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {trends && trends.topProperties.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" /> Hottest Properties
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-2">
              {trends.topProperties.slice(0, 5).map((p) => (
                <Badge key={p.propertyAddress} variant="outline" className="gap-1">
                  <Building2 className="h-3 w-3" />
                  {p.propertyAddress} · {p.count}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={statusFilter === null ? "default" : "outline"}
          onClick={() => setStatusFilter(null)}
        >
          All
        </Button>
        {STATUSES.map((status) => (
          <Button
            key={status}
            size="sm"
            variant={statusFilter === status ? "default" : "outline"}
            className="capitalize"
            onClick={() => setStatusFilter(status)}
          >
            {status}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Lightbulb className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <p className="font-medium">No opportunities yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              As technicians verify findings in the field, the AI will surface business
              opportunities here automatically.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((opp) => (
            <Card
              key={opp.id}
              className="cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => setSelectedId(opp.id)}
            >
              <CardContent className="py-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{opp.title}</p>
                    <p className="text-sm text-muted-foreground truncate">
                      {opp.propertyAddress}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <PriorityBadge priority={opp.priority} />
                    <RiskBadge riskLevel={opp.riskLevel} />
                    <Badge variant="outline">
                      {CATEGORY_LABELS[opp.category] ?? opp.category}
                    </Badge>
                    <TierBadge tier={opp.estimatedValueTier} />
                    <StatusBadge status={opp.status} />
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3 text-emerald-500" />
                    {opp.evidenceFindingIds.length} finding
                    {opp.evidenceFindingIds.length === 1 ? "" : "s"}
                  </span>
                  <span className="flex items-center gap-1">
                    <Eye className="h-3 w-3" />
                    {Math.round(opp.confidence * 100)}% confidence
                  </span>
                  {opp.estimatedAnnualValue != null && (
                    <span className="flex items-center gap-1 text-emerald-500 font-medium">
                      <CircleDollarSign className="h-3 w-3" />
                      {formatDollars(opp.estimatedAnnualValue)}/yr
                    </span>
                  )}
                  <span>{new Date(opp.updatedAt).toLocaleDateString()}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedId !== null && (
        <OpportunityDetailDialog
          opportunityId={selectedId}
          canDismiss={isManager}
          onClose={() => setSelectedId(null)}
        />
      )}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
