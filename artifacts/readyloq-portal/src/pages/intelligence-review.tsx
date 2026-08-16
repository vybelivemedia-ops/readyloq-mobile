import { useMemo, useState } from 'react';
import {
  useListIntelligenceRecords,
  useReviewIntelligenceRecord,
  getListIntelligenceRecordsQueryKey,
  type IntelligenceRecord,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, CheckCircle2, XCircle, Brain, UserCheck, ShieldCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

const PAGE_SIZE = 20;

function labelize(slug?: string | null): string {
  if (!slug) return '—';
  return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function FieldRow({ label, ai, tech }: { label: string; ai: string; tech: string }) {
  const differs = ai !== '—' && tech !== '—' && ai !== tech;
  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-2 pr-4 text-xs font-medium text-muted-foreground whitespace-nowrap align-top">{label}</td>
      <td className="py-2 pr-4 text-sm align-top">{ai}</td>
      <td className={`py-2 text-sm align-top ${differs ? 'text-amber-500 font-medium' : ''}`}>
        {tech}
        {differs && <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-500">corrected</span>}
      </td>
    </tr>
  );
}

function VerificationBadge({ level }: { level: number }) {
  const label =
    level >= 5 ? 'Expert verified' :
    level >= 4 ? 'Manager approved' :
    level >= 3 ? 'Peer confirmed' :
    level >= 2 ? 'Technician confirmed' : 'Unverified';
  return <Badge variant="secondary" className="capitalize">{label} · L{level}</Badge>;
}

export function IntelligenceReview() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [page, setPage] = useState(1);

  const listParams = { status: 'confirmed', page, limit: PAGE_SIZE } as const;
  const { data, isLoading, isFetching } = useListIntelligenceRecords(listParams);
  const records = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const selected: IntelligenceRecord | null = useMemo(
    () => records.find((r) => r.id === selectedId) ?? records[0] ?? null,
    [records, selectedId],
  );

  const review = useReviewIntelligenceRecord({
    mutation: {
      onSuccess: (_res, vars) => {
        toast({
          title: vars.data.action === 'approve' ? 'Approved for training' : 'Rejected',
          description:
            vars.data.action === 'approve'
              ? 'Record promoted to manager-verified and marked approved for training.'
              : 'Record rejected and excluded from the training dataset.',
        });
        setComment('');
        setSelectedId(null);
        // If this was the last record on the last page, step back a page so the
        // queue never strands the manager on an empty page.
        if (records.length <= 1 && page > 1) setPage(page - 1);
        // Invalidate every cached page of the pending queue.
        queryClient.invalidateQueries({ queryKey: [getListIntelligenceRecordsQueryKey()[0]] });
      },
      onError: (err: any) => {
        toast({
          title: 'Review failed',
          description: err?.data?.error ?? err?.message ?? 'Unexpected error',
          variant: 'destructive',
        });
      },
    },
  });

  const act = (action: 'approve' | 'reject') => {
    if (!selected) return;
    review.mutate({
      id: selected.id,
      data: { action, ...(comment.trim() ? { comment: comment.trim() } : {}) },
    });
  };

  const ai = selected?.aiPrediction;

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">AI Review Queue</h1>
        <p className="text-muted-foreground mt-1">
          Review technician-confirmed findings. Approving promotes a record to manager-verified and marks it approved for training.
        </p>
      </div>

      {isLoading ? (
        <div className="p-12 flex justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      ) : records.length === 0 && page === 1 ? (
        <div className="bg-card border border-border rounded-xl p-12 text-center text-muted-foreground">
          <ShieldCheck className="w-10 h-10 mx-auto mb-3 opacity-50" />
          No records awaiting manager review.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Queue */}
          <div className="bg-card border border-border rounded-xl overflow-hidden lg:max-h-[75vh] lg:overflow-y-auto">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">Pending review ({total})</span>
              {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
            </div>
            <ul className="divide-y divide-border">
              {records.map((r) => (
                <li key={r.id}>
                  <button
                    className={`w-full flex items-center gap-3 p-3 text-left hover:bg-muted/40 transition-colors ${
                      selected?.id === r.id ? 'bg-muted/60' : ''
                    }`}
                    onClick={() => { setSelectedId(r.id); setComment(''); }}
                    data-testid={`review-queue-item-${r.id}`}
                  >
                    <img
                      src={r.thumbnailUrl ?? r.imageUrl}
                      alt=""
                      className="w-14 h-14 rounded-md object-cover bg-muted shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {labelize(r.category)}{r.subcategory ? ` · ${labelize(r.subcategory)}` : ''}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                        <span>{format(new Date(r.createdAt), 'MMM d, yyyy')}</span>
                        {r.aiCorrected && <span className="text-amber-500">corrected</span>}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-border flex items-center justify-between text-sm">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  disabled={page <= 1 || isFetching}
                  onClick={() => { setPage(page - 1); setSelectedId(null); }}
                  data-testid="review-queue-prev"
                >
                  <ChevronLeft className="w-4 h-4" /> Prev
                </Button>
                <span className="text-muted-foreground">Page {page} of {totalPages}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  disabled={page >= totalPages || isFetching}
                  onClick={() => { setPage(page + 1); setSelectedId(null); }}
                  data-testid="review-queue-next"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>

          {/* Detail */}
          {selected && (
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-card border border-border rounded-xl p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <VerificationBadge level={selected.verificationLevel} />
                    {selected.severity && (
                      <Badge variant="outline" className="capitalize">{selected.severity}</Badge>
                    )}
                    {selected.aiCorrected != null && (
                      <Badge variant={selected.aiCorrected ? 'destructive' : 'secondary'}>
                        {selected.aiCorrected ? 'AI corrected by technician' : 'AI confirmed'}
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Record #{selected.id} · {selected.confirmVotes} confirm / {selected.disputeVotes} dispute
                  </div>
                </div>

                <img
                  src={selected.imageUrl}
                  alt="Finding"
                  className="w-full max-h-96 object-contain rounded-lg bg-black/40"
                />

                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                        <th className="py-2 pr-4 font-semibold w-36">Field</th>
                        <th className="py-2 pr-4 font-semibold">
                          <span className="inline-flex items-center gap-1"><Brain className="w-3.5 h-3.5" /> AI prediction</span>
                        </th>
                        <th className="py-2 font-semibold">
                          <span className="inline-flex items-center gap-1"><UserCheck className="w-3.5 h-3.5" /> Technician correction</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <FieldRow label="Category" ai={labelize(ai?.category)} tech={labelize(selected.category)} />
                      <FieldRow label="Subcategory" ai={labelize(ai?.subcategory)} tech={labelize(selected.subcategory)} />
                      <FieldRow label="Pest" ai={labelize(ai?.possiblePest)} tech={labelize(selected.possiblePest)} />
                      <FieldRow
                        label="Conducive condition"
                        ai={labelize(ai?.possibleConduciveCondition)}
                        tech={labelize(selected.possibleConduciveCondition)}
                      />
                      <FieldRow label="Entry point" ai={labelize(ai?.possibleEntryPoint)} tech={labelize(selected.possibleEntryPoint)} />
                      <FieldRow
                        label="Corrective action"
                        ai={ai?.suggestedCorrectiveAction ?? '—'}
                        tech={selected.correctiveAction ?? '—'}
                      />
                    </tbody>
                  </table>
                </div>

                {(ai?.rationale || selected.notes || selected.whatIsShown) && (
                  <div className="grid sm:grid-cols-2 gap-3 text-sm">
                    {ai?.rationale && (
                      <div className="bg-muted/40 rounded-lg p-3">
                        <div className="text-xs font-semibold text-muted-foreground mb-1">AI rationale</div>
                        {ai.rationale}
                        {typeof ai.confidence === 'number' && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Confidence: {(ai.confidence * 100).toFixed(0)}%
                          </div>
                        )}
                      </div>
                    )}
                    {(selected.whatIsShown || selected.notes) && (
                      <div className="bg-muted/40 rounded-lg p-3">
                        <div className="text-xs font-semibold text-muted-foreground mb-1">Technician notes</div>
                        {selected.whatIsShown && <div>{selected.whatIsShown}</div>}
                        {selected.notes && <div className="text-muted-foreground mt-1">{selected.notes}</div>}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                <Textarea
                  placeholder="Optional review comment…"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={2}
                  data-testid="review-comment"
                />
                <div className="flex gap-3">
                  <Button
                    className="flex-1 gap-2"
                    disabled={review.isPending}
                    onClick={() => act('approve')}
                    data-testid="review-approve"
                  >
                    {review.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    Approve for training
                  </Button>
                  <Button
                    variant="destructive"
                    className="flex-1 gap-2"
                    disabled={review.isPending}
                    onClick={() => act('reject')}
                    data-testid="review-reject"
                  >
                    <XCircle className="w-4 h-4" />
                    Reject
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
