import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListProposals,
  getListProposalsQueryKey,
  useCreateProposal,
  useGetProposal,
  getGetProposalQueryKey,
  useUpdateProposal,
  useDeleteProposal,
  useListSalesOpportunities,
  getListSalesOpportunitiesQueryKey,
  type SalesProposal,
  type SalesOpportunity,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  FileSignature,
  Plus,
  Building2,
  ShieldCheck,
  Trash2,
  CircleDollarSign,
} from "lucide-react";

/**
 * Sales Proposals — bundle verified opportunities into a customer proposal.
 *
 * Proposals only reference REAL opportunities from this company (the API
 * validates every ID). Once sent, a proposal becomes a record: it can be
 * marked accepted/declined but never deleted.
 */

const PROPOSAL_STATUSES = ["draft", "sent", "accepted", "declined"] as const;

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-blue-500/15 text-blue-500",
  accepted: "bg-emerald-500/15 text-emerald-500",
  declined: "bg-red-500/15 text-red-400",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="secondary" className={STATUS_STYLES[status] ?? ""}>
      {status}
    </Badge>
  );
}

function CreateProposalDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [property, setProperty] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [intro, setIntro] = useState("");

  const { data: opportunities, isLoading } = useListSalesOpportunities(undefined, {
    query: { queryKey: getListSalesOpportunitiesQueryKey() },
  });

  const byProperty = useMemo(() => {
    const map = new Map<string, SalesOpportunity[]>();
    for (const opp of opportunities ?? []) {
      if (opp.status === "dismissed" || opp.status === "lost") continue;
      const list = map.get(opp.propertyAddress) ?? [];
      list.push(opp);
      map.set(opp.propertyAddress, list);
    }
    return map;
  }, [opportunities]);

  const create = useCreateProposal({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProposalsQueryKey() });
        toast({ title: "Proposal created" });
        onClose();
      },
      onError: (error) => {
        toast({
          title: "Failed to create proposal",
          description: error instanceof Error ? error.message : undefined,
          variant: "destructive",
        });
      },
    },
  });

  const toggle = (id: number) =>
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const propertyOpportunities = property ? (byProperty.get(property) ?? []) : [];
  const canSubmit = title.trim().length > 0 && property !== null && selectedIds.length > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Proposal</DialogTitle>
          <DialogDescription>
            Bundle verified opportunities for one property into a proposal.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : byProperty.size === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No open opportunities to propose yet. Opportunities appear as technicians
            verify findings in the field.
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Title</p>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Spring exclusion & prevention package"
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Property</p>
              <div className="flex flex-wrap gap-2">
                {[...byProperty.keys()].map((address) => (
                  <Button
                    key={address}
                    size="sm"
                    variant={property === address ? "default" : "outline"}
                    onClick={() => {
                      setProperty(address);
                      setSelectedIds([]);
                    }}
                  >
                    <Building2 className="h-3.5 w-3.5 mr-1" />
                    {address}
                  </Button>
                ))}
              </div>
            </div>
            {property && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">
                  Opportunities to include
                </p>
                <div className="space-y-2">
                  {propertyOpportunities.map((opp) => (
                    <label
                      key={opp.id}
                      className="flex items-start gap-2 rounded-md border p-2.5 cursor-pointer hover:border-primary/40"
                    >
                      <Checkbox
                        checked={selectedIds.includes(opp.id)}
                        onCheckedChange={() => toggle(opp.id)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{opp.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {opp.status} · {opp.estimatedValueTier} value
                          {opp.estimatedAnnualValue != null
                            ? ` · $${opp.estimatedAnnualValue.toLocaleString()}/yr`
                            : ""}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">
                Intro <span className="font-normal">(optional)</span>
              </p>
              <Textarea
                value={intro}
                onChange={(e) => setIntro(e.target.value)}
                placeholder="Opening message for the customer…"
                rows={3}
              />
            </div>
            <Button
              className="w-full"
              disabled={!canSubmit || create.isPending}
              onClick={() =>
                create.mutate({
                  data: {
                    title: title.trim(),
                    propertyAddress: property!,
                    opportunityIds: selectedIds,
                    intro: intro.trim() === "" ? null : intro.trim(),
                  },
                })
              }
            >
              Create draft
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProposalDetailDialog({
  proposalId,
  onClose,
}: {
  proposalId: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editingNotes, setEditingNotes] = useState<string | null>(null);

  const { data, isLoading } = useGetProposal(proposalId, {
    query: { queryKey: getGetProposalQueryKey(proposalId) },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListProposalsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetProposalQueryKey(proposalId) });
  };

  const update = useUpdateProposal({
    mutation: {
      onSuccess: () => {
        invalidate();
        setEditingNotes(null);
        toast({ title: "Proposal updated" });
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

  const remove = useDeleteProposal({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Draft deleted" });
        onClose();
      },
      onError: (error) => {
        toast({
          title: "Delete failed",
          description: error instanceof Error ? error.message : undefined,
          variant: "destructive",
        });
      },
    },
  });

  const setStatus = (status: (typeof PROPOSAL_STATUSES)[number]) =>
    update.mutate({ id: proposalId, data: { status } });

  const totalValue = (data?.opportunities ?? []).reduce(
    (sum, opp) => sum + (opp.estimatedAnnualValue ?? 0),
    0,
  );

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
              <Badge variant="outline">
                {data.opportunityIds.length} opportunit
                {data.opportunityIds.length === 1 ? "y" : "ies"}
              </Badge>
              {totalValue > 0 && (
                <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-500">
                  <CircleDollarSign className="h-3 w-3 mr-1" />
                  ${totalValue.toLocaleString()}/yr est.
                </Badge>
              )}
            </div>
            {data.intro && <p className="text-sm text-muted-foreground">{data.intro}</p>}

            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Included opportunities</p>
              {data.opportunities.map((opp) => (
                <div key={opp.id} className="rounded-md border p-2.5">
                  <p className="text-sm font-medium">{opp.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{opp.rationale}</p>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3 text-emerald-500" />
                    {opp.evidenceFindingIds.length} verified finding
                    {opp.evidenceFindingIds.length === 1 ? "" : "s"}
                    {opp.estimatedAnnualValue != null
                      ? ` · $${opp.estimatedAnnualValue.toLocaleString()}/yr`
                      : ""}
                  </p>
                </div>
              ))}
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Internal notes</p>
              {editingNotes === null ? (
                <div className="flex items-start gap-2">
                  <p className="text-sm text-muted-foreground flex-1">
                    {data.notes || "None"}
                  </p>
                  {data.status === "draft" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingNotes(data.notes ?? "")}
                    >
                      Edit
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Textarea
                    value={editingNotes}
                    onChange={(e) => setEditingNotes(e.target.value)}
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={update.isPending}
                      onClick={() =>
                        update.mutate({
                          id: proposalId,
                          data: { notes: editingNotes.trim() === "" ? null : editingNotes },
                        })
                      }
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingNotes(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              {data.status === "draft" && (
                <>
                  <Button size="sm" disabled={update.isPending} onClick={() => setStatus("sent")}>
                    Mark sent
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-400 hover:text-red-400"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate({ id: proposalId })}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete draft
                  </Button>
                </>
              )}
              {data.status === "sent" && (
                <>
                  <Button
                    size="sm"
                    disabled={update.isPending}
                    onClick={() => setStatus("accepted")}
                  >
                    Customer accepted
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={update.isPending}
                    onClick={() => setStatus("declined")}
                  >
                    Customer declined
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function ProposalsPage() {
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const params = statusFilter ? { status: statusFilter } : undefined;
  const { data: proposals, isLoading } = useListProposals(params, {
    query: { queryKey: getListProposalsQueryKey(params) },
  });

  const rows: SalesProposal[] = proposals ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileSignature className="h-6 w-6 text-primary" /> Proposals
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Customer proposals built from verified opportunities
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> New Proposal
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={statusFilter === null ? "default" : "outline"}
          onClick={() => setStatusFilter(null)}
        >
          All
        </Button>
        {PROPOSAL_STATUSES.map((status) => (
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
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <FileSignature className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <p className="font-medium">No proposals yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create a proposal by bundling opportunities for a property.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((proposal) => (
            <Card
              key={proposal.id}
              className="cursor-pointer hover:border-primary/40 transition-colors"
              onClick={() => setSelectedId(proposal.id)}
            >
              <CardContent className="py-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{proposal.title}</p>
                    <p className="text-sm text-muted-foreground truncate">
                      {proposal.propertyAddress}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <Badge variant="outline">
                      {proposal.opportunityIds.length} opportunit
                      {proposal.opportunityIds.length === 1 ? "y" : "ies"}
                    </Badge>
                    <StatusBadge status={proposal.status} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Updated {new Date(proposal.updatedAt).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {createOpen && <CreateProposalDialog onClose={() => setCreateOpen(false)} />}
      {selectedId !== null && (
        <ProposalDetailDialog proposalId={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}
