import { useMemo, useState, useEffect, useCallback } from 'react';
import {
  useListIntelligenceRecords,
  useListIntelligenceCategories,
  useReviewIntelligenceRecord,
  getListIntelligenceRecordsQueryKey,
  type IntelligenceRecord,
  type IntelligenceReviewInputSeverity,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  X,
  ZoomIn,
  Brain,
  UserCheck,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Pencil,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

const PAGE_SIZE = 20;

const SEVERITY_OPTIONS: { value: IntelligenceReviewInputSeverity; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

function labelize(slug?: string | null): string {
  if (!slug) return '—';
  return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function FieldRow({
  label,
  ai,
  tech,
  managerEdit,
}: {
  label: string;
  ai: string;
  tech: string;
  managerEdit?: string;
}) {
  const techDiffers = ai !== '—' && tech !== '—' && ai !== tech;
  const managerChanged = Boolean(managerEdit) && managerEdit !== tech;
  return (
    <tr className="border-b border-border last:border-0">
      <td className="py-2 pr-4 text-xs font-medium text-muted-foreground whitespace-nowrap align-top">{label}</td>
      <td className="py-2 pr-4 text-sm align-top">{ai}</td>
      <td className={`py-2 text-sm align-top ${techDiffers ? 'text-amber-500 font-medium' : ''}`}>
        {tech}
        {techDiffers && <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-500">corrected</span>}
        {managerChanged && (
          <span className="ml-2 text-[10px] uppercase tracking-wide text-blue-500">
            → {managerEdit}
          </span>
        )}
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

// State tracks the manager's edits. Empty string means "unchanged from the record".
// Managers can only set values, not clear them — this avoids ambiguity between
// "I want to clear this field" and "I haven't changed this field yet."
interface LabelEdits {
  category: string;                    // '' = keep record.category
  subcategory: string;                 // '' = keep record.subcategory
  possiblePest: string;                // '' = keep record.possiblePest
  severity: string;                    // '' = keep record.severity
  possibleConduciveCondition: string;  // '' = keep record.possibleConduciveCondition
  possibleEntryPoint: string;          // '' = keep record.possibleEntryPoint
  correctiveAction: string;            // '' = keep record.correctiveAction
}

function initEdits(record: IntelligenceRecord | null): LabelEdits {
  return {
    category: record?.category ?? '',
    subcategory: record?.subcategory ?? '',
    possiblePest: record?.possiblePest ?? '',
    severity: record?.severity ?? '',
    possibleConduciveCondition: record?.possibleConduciveCondition ?? '',
    possibleEntryPoint: record?.possibleEntryPoint ?? '',
    correctiveAction: record?.correctiveAction ?? '',
  };
}

/**
 * Returns only the fields that should be sent to the API as corrections.
 *
 * Rules:
 * - category: sent only when non-empty and different from the record.
 * - subcategory: when the category is being changed, subcategory is ALWAYS
 *   included (even as '' to clear the old value) so we never persist a
 *   category/subcategory pair from two different taxonomy groups.
 *   When only subcategory changes, sent only when non-empty and different.
 * - possiblePest / severity: sent only when non-empty and different.
 *   An empty value is treated as "no change" so managers cannot accidentally
 *   clear a label by blanking a text field.
 */
function buildLabelPayload(
  edits: LabelEdits,
  record: IntelligenceRecord,
): Record<string, string> {
  const payload: Record<string, string> = {};

  const categoryChanged =
    Boolean(edits.category) && edits.category !== (record.category ?? '');

  if (categoryChanged) {
    payload.category = edits.category;
    // Always include subcategory when category changes so the old subcategory
    // is not silently retained under a different category.
    payload.subcategory = edits.subcategory; // may be '' — that's intentional
  } else if (edits.subcategory && edits.subcategory !== (record.subcategory ?? '')) {
    payload.subcategory = edits.subcategory;
  }

  // Pest: empty input is treated as "no change".
  if (edits.possiblePest && edits.possiblePest !== (record.possiblePest ?? '')) {
    payload.possiblePest = edits.possiblePest;
  }

  if (edits.severity && edits.severity !== (record.severity ?? '')) {
    payload.severity = edits.severity;
  }

  if (
    edits.possibleConduciveCondition &&
    edits.possibleConduciveCondition !== (record.possibleConduciveCondition ?? '')
  ) {
    payload.possibleConduciveCondition = edits.possibleConduciveCondition;
  }

  if (
    edits.possibleEntryPoint &&
    edits.possibleEntryPoint !== (record.possibleEntryPoint ?? '')
  ) {
    payload.possibleEntryPoint = edits.possibleEntryPoint;
  }

  if (
    edits.correctiveAction &&
    edits.correctiveAction !== (record.correctiveAction ?? '')
  ) {
    payload.correctiveAction = edits.correctiveAction;
  }

  return payload;
}

export function IntelligenceReview() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [page, setPage] = useState(1);
  const [editOpen, setEditOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [edits, setEdits] = useState<LabelEdits>({
    category: '',
    subcategory: '',
    possiblePest: '',
    severity: '',
    possibleConduciveCondition: '',
    possibleEntryPoint: '',
    correctiveAction: '',
  });

  const listParams = { status: 'confirmed', page, limit: PAGE_SIZE } as const;
  const { data, isLoading, isFetching } = useListIntelligenceRecords(listParams);
  const records = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const { data: categories = [] } = useListIntelligenceCategories();

  const selected: IntelligenceRecord | null = useMemo(
    () => records.find((r) => r.id === selectedId) ?? records[0] ?? null,
    [records, selectedId],
  );

  // Reset edits whenever the selected record changes.
  useEffect(() => {
    setEdits(initEdits(selected));
    setEditOpen(false);
  }, [selected?.id]);

  // Close lightbox on Escape.
  const closeLightbox = useCallback(() => setLightboxUrl(null), []);
  useEffect(() => {
    if (!lightboxUrl) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeLightbox(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [lightboxUrl, closeLightbox]);

  const selectedCategory = categories.find((c) => c.slug === edits.category);
  const subcategoryOptions = selectedCategory?.subcategories ?? [];

  // Derived: which fields will actually be sent in the review payload.
  const labelPayload = selected ? buildLabelPayload(edits, selected) : {};
  const edited = Object.keys(labelPayload).length > 0;

  const review = useReviewIntelligenceRecord({
    mutation: {
      onSuccess: (_res, vars) => {
        const action = vars.data.action;
        // Detect corrections from the payload that was actually submitted.
        const wasEdited = !!(
          vars.data.category ||
          vars.data.subcategory ||
          vars.data.possiblePest ||
          vars.data.severity ||
          vars.data.possibleConduciveCondition ||
          vars.data.possibleEntryPoint ||
          vars.data.correctiveAction
        );
        toast({
          title:
            action === 'approve'
              ? wasEdited ? 'Approved with corrections' : 'Approved for training'
              : 'Rejected',
          description:
            action === 'approve'
              ? wasEdited
                ? 'Labels corrected and record promoted to manager-verified.'
                : 'Record promoted to manager-verified and marked approved for training.'
              : 'Record rejected and excluded from the training dataset.',
        });
        setComment('');
        setSelectedId(null);
        setEditOpen(false);
        // If this was the last record on the last page, step back a page.
        if (records.length <= 1 && page > 1) setPage(page - 1);
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
      data: {
        action,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        // Only include label corrections on approve (not on reject).
        ...(action === 'approve' ? labelPayload : {}),
      },
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
                <li
                  key={r.id}
                  className={`flex items-center transition-colors hover:bg-muted/40 ${
                    selected?.id === r.id ? 'bg-muted/60' : ''
                  }`}
                >
                  {/* Thumbnail — opens lightbox */}
                  <button
                    className="group/thumb relative shrink-0 m-3 rounded-md overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setLightboxUrl(r.imageUrl)}
                    aria-label="View full-size image"
                  >
                    <img
                      src={r.thumbnailUrl ?? r.imageUrl}
                      alt=""
                      className="w-14 h-14 object-cover bg-muted block"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover/thumb:bg-black/40 transition-colors rounded-md">
                      <ZoomIn className="w-4 h-4 text-white opacity-0 group-hover/thumb:opacity-100 transition-opacity" />
                    </div>
                  </button>
                  {/* Text row — selects the record */}
                  <button
                    className="flex-1 min-w-0 py-3 pr-3 text-left focus:outline-none"
                    onClick={() => { setSelectedId(r.id); setComment(''); }}
                    data-testid={`review-queue-item-${r.id}`}
                  >
                    <div className="text-sm font-medium truncate">
                      {labelize(r.category)}{r.subcategory ? ` · ${labelize(r.subcategory)}` : ''}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                      <span>{format(new Date(r.createdAt), 'MMM d, yyyy')}</span>
                      {r.aiCorrected && <span className="text-amber-500">corrected</span>}
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

                <button
                  className="group/mainimg relative w-full block rounded-lg overflow-hidden bg-black/40"
                  onClick={() => setLightboxUrl(selected.imageUrl)}
                  aria-label="View full-size image"
                >
                  <img
                    src={selected.imageUrl}
                    alt="Finding"
                    className="w-full max-h-96 object-contain"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover/mainimg:bg-black/30 transition-colors">
                    <ZoomIn className="w-8 h-8 text-white opacity-0 group-hover/mainimg:opacity-100 transition-opacity drop-shadow-lg" />
                  </div>
                </button>

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
                      <FieldRow label="Category" ai={labelize(ai?.category)} tech={labelize(selected.category)} managerEdit={labelPayload.category ? labelize(labelPayload.category) : undefined} />
                      <FieldRow label="Subcategory" ai={labelize(ai?.subcategory)} tech={labelize(selected.subcategory)} managerEdit={labelPayload.subcategory ? labelize(labelPayload.subcategory) : undefined} />
                      <FieldRow label="Pest" ai={labelize(ai?.possiblePest)} tech={labelize(selected.possiblePest)} managerEdit={labelPayload.possiblePest ? labelize(labelPayload.possiblePest) : undefined} />
                      <FieldRow
                        label="Conducive condition"
                        ai={labelize(ai?.possibleConduciveCondition)}
                        tech={labelize(selected.possibleConduciveCondition)}
                        managerEdit={labelPayload.possibleConduciveCondition ? labelize(labelPayload.possibleConduciveCondition) : undefined}
                      />
                      <FieldRow
                        label="Entry point"
                        ai={labelize(ai?.possibleEntryPoint)}
                        tech={labelize(selected.possibleEntryPoint)}
                        managerEdit={labelPayload.possibleEntryPoint ? labelize(labelPayload.possibleEntryPoint) : undefined}
                      />
                      <FieldRow
                        label="Corrective action"
                        ai={ai?.suggestedCorrectiveAction ?? '—'}
                        tech={selected.correctiveAction ?? '—'}
                        managerEdit={labelPayload.correctiveAction ? labelize(labelPayload.correctiveAction) : undefined}
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

              {/* ── Edit labels ───────────────────────────────────────────────── */}
              <div className="bg-card border border-border rounded-xl overflow-hidden" data-testid="edit-labels-panel">
                <button
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-muted/40 transition-colors"
                  onClick={() => setEditOpen((v) => !v)}
                  data-testid="edit-labels-toggle"
                >
                  <span className="flex items-center gap-2">
                    <Pencil className="w-4 h-4 text-muted-foreground" />
                    Edit labels before approving
                    {edited && (
                      <Badge variant="secondary" className="text-xs">
                        {Object.keys(labelPayload).length} change{Object.keys(labelPayload).length !== 1 ? 's' : ''}
                      </Badge>
                    )}
                  </span>
                  {editOpen
                    ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                    : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </button>

                {editOpen && (
                  <div className="px-4 pb-4 pt-1 border-t border-border space-y-4">
                    <p className="text-xs text-muted-foreground">
                      Corrections here are saved alongside the approval (verification level&nbsp;4). Only changed fields are sent.
                    </p>

                    <div className="grid sm:grid-cols-2 gap-4">
                      {/* Category */}
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-category" className="text-xs font-medium">Category</Label>
                        <Select
                          value={edits.category || undefined}
                          onValueChange={(v) =>
                            setEdits((prev) => ({ ...prev, category: v, subcategory: '' }))
                          }
                        >
                          <SelectTrigger id="edit-category" data-testid="edit-category">
                            <SelectValue placeholder="Select category…" />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map((c) => (
                              <SelectItem key={c.slug} value={c.slug}>
                                {c.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {edits.category && edits.category !== (selected?.category ?? '') && (
                          <p className="text-[11px] text-amber-600">
                            Category changed — subcategory will be cleared unless you pick a new one below.
                          </p>
                        )}
                      </div>

                      {/* Subcategory — cascades from category */}
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-subcategory" className="text-xs font-medium">Subcategory</Label>
                        <Select
                          value={edits.subcategory || undefined}
                          onValueChange={(v) => setEdits((prev) => ({ ...prev, subcategory: v }))}
                          disabled={subcategoryOptions.length === 0}
                        >
                          <SelectTrigger id="edit-subcategory" data-testid="edit-subcategory">
                            <SelectValue placeholder={
                              subcategoryOptions.length === 0
                                ? 'Pick a category first'
                                : 'Select subcategory…'
                            } />
                          </SelectTrigger>
                          <SelectContent>
                            {subcategoryOptions.map((s) => (
                              <SelectItem key={s.slug} value={s.slug}>
                                {s.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Pest / species */}
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-pest" className="text-xs font-medium">Pest / species</Label>
                        <Input
                          id="edit-pest"
                          data-testid="edit-pest"
                          placeholder="e.g. german_cockroach"
                          value={edits.possiblePest}
                          onChange={(e) =>
                            setEdits((prev) => ({ ...prev, possiblePest: e.target.value }))
                          }
                        />
                      </div>

                      {/* Severity */}
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-severity" className="text-xs font-medium">Severity</Label>
                        <Select
                          value={edits.severity || undefined}
                          onValueChange={(v) => setEdits((prev) => ({ ...prev, severity: v }))}
                        >
                          <SelectTrigger id="edit-severity" data-testid="edit-severity">
                            <SelectValue placeholder="Select severity…" />
                          </SelectTrigger>
                          <SelectContent>
                            {SEVERITY_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Conducive condition */}
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-conducive-condition" className="text-xs font-medium">Conducive condition</Label>
                        <Input
                          id="edit-conducive-condition"
                          data-testid="edit-conducive-condition"
                          placeholder="e.g. moisture_intrusion"
                          value={edits.possibleConduciveCondition}
                          onChange={(e) =>
                            setEdits((prev) => ({ ...prev, possibleConduciveCondition: e.target.value }))
                          }
                        />
                      </div>

                      {/* Entry point */}
                      <div className="space-y-1.5">
                        <Label htmlFor="edit-entry-point" className="text-xs font-medium">Entry point</Label>
                        <Input
                          id="edit-entry-point"
                          data-testid="edit-entry-point"
                          placeholder="e.g. gap_around_pipe"
                          value={edits.possibleEntryPoint}
                          onChange={(e) =>
                            setEdits((prev) => ({ ...prev, possibleEntryPoint: e.target.value }))
                          }
                        />
                      </div>

                      {/* Corrective action — full width */}
                      <div className="space-y-1.5 sm:col-span-2">
                        <Label htmlFor="edit-corrective-action" className="text-xs font-medium">Corrective action</Label>
                        <Input
                          id="edit-corrective-action"
                          data-testid="edit-corrective-action"
                          placeholder="e.g. seal_entry_point_and_remove_harborage"
                          value={edits.correctiveAction}
                          onChange={(e) =>
                            setEdits((prev) => ({ ...prev, correctiveAction: e.target.value }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Actions ───────────────────────────────────────────────────── */}
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
                    {review.isPending
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <CheckCircle2 className="w-4 h-4" />}
                    {edited ? 'Correct & approve' : 'Approve for training'}
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

      {/* ── Lightbox ────────────────────────────────────────────────────── */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={closeLightbox}
          role="dialog"
          aria-modal="true"
          aria-label="Full-size evidence photo"
        >
          <button
            className="absolute top-4 right-4 z-10 flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-2 text-white text-sm font-medium transition-colors"
            onClick={closeLightbox}
            aria-label="Close"
          >
            <X className="w-4 h-4" /> Close
          </button>
          <img
            src={lightboxUrl}
            alt="Full-size evidence photo"
            className="max-w-[92vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
