import {
  useGetInspection,
  useGetInspectionScorecard,
  useGetCustomerSummaryForInspection,
  useListAnalysisResults,
  getGetInspectionQueryKey,
  getListAnalysisResultsQueryKey,
  getGetInspectionScorecardQueryKey,
  getGetCustomerSummaryForInspectionQueryKey,
} from '@workspace/api-client-react';
import type { PhotoMeta } from '@/lib/photo-meta';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'wouter';
import { Loader2, ArrowLeft, Bug, MapPin, Calendar, User, ShieldAlert, PenLine, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import {
  useIntegrationConfig,
  useSyncHistory,
  useSyncInspection,
  SYSTEM_LABELS,
} from '@/hooks/use-integrations';
import { Button } from '@/components/ui/button';
import { PhotoLightbox } from '@/components/PhotoLightbox';
import { apiUrl, mediaUrl } from '@/config';
import { formatMediaTileTimestamp, getMediaTimestamp } from '@/lib/media-time';

function formatDateTime(value: string | null | undefined, pattern: string, fallback = 'Not recorded'): string {
  const date = new Date(value ?? '');
  return Number.isNaN(date.getTime()) ? fallback : format(date, pattern);
}

// Concrete inspection shape — includes all fields the API returns plus the
// new columns that are not yet in the generated client types.
interface InspectionWithSignatures {
  id: number;
  siteAddress: string;
  clientName?: string | null;
  technicianName: string;
  status: string;
  pestTypes?: string[] | null;
  findingsCount?: number | null;
  mediaCount?: number | null;
  severity?: string | null;
  createdAt: string;
  completedAt?: string | null;
  technicianSignature?: string | null;
  ownerSignature?: string | null;
  ownerNotAvailable?: boolean;
  signedAt?: string | null;
  /** Unit / apartment number for multi-family properties. */
  unitNumber?: string | null;
  media?: Array<{
    id: number;
    mediaType: string;
    url: string;
    caption?: string | null;
    captureMetadata?: Record<string, unknown> | null;
    unitNumber?: string | null;
    createdAt: string;
    capturedAt?: string | null;
  }>;
}

function SignatureBlock({
  label,
  svg,
  notAvailable,
}: {
  label: string;
  svg?: string | null;
  notAvailable?: boolean;
}) {
  return (
    <div className="p-5 flex flex-col gap-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</p>
      {svg ? (
        <img
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
          alt={`${label} signature`}
          className="h-20 w-full object-contain border border-border rounded-lg bg-white"
        />
      ) : notAvailable ? (
        <div className="h-20 flex items-center justify-center rounded-lg bg-muted">
          <span className="text-xs text-muted-foreground">Not available — technician signed on behalf</span>
        </div>
      ) : (
        <div className="h-20 flex items-center justify-center rounded-lg border border-dashed border-border">
          <span className="text-xs text-muted-foreground">No signature captured</span>
        </div>
      )}
    </div>
  );
}

/**
 * Owner-only "Sync Now" card — pushes the finalized inspection to the
 * configured field-service system and shows last-synced status.
 */
function IntegrationSyncCard({ inspectionId, inspectionStatus }: { inspectionId: number; inspectionStatus: string }) {
  const { toast } = useToast();
  const { data: configRes } = useIntegrationConfig();
  const { data: historyRes } = useSyncHistory(inspectionId);
  const syncInspection = useSyncInspection();

  const integration = configRes?.integration;
  if (!integration || !integration.enabled) return null;

  const systemName = SYSTEM_LABELS[integration.systemType] ?? integration.systemType;
  const lastSync = historyRes?.logs?.[0];
  const isFinalized = inspectionStatus === 'complete' || inspectionStatus === 'completed';

  const handleSync = async () => {
    try {
      await syncInspection.mutateAsync(inspectionId);
      toast({ title: 'Sync complete', description: `Inspection synced to ${systemName}.` });
    } catch (err) {
      toast({
        title: 'Sync failed',
        description: err instanceof Error ? err.message : undefined,
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {systemName} Integration
        </p>
        {lastSync ? (
          <div className="mt-1.5 flex items-center gap-2 flex-wrap">
            {lastSync.success ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-500">
                <CheckCircle2 className="w-3 h-3" /> Synced
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-destructive/10 text-destructive">
                <XCircle className="w-3 h-3" /> Last sync failed
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {formatDateTime(lastSync.syncedAt, "MMM d, yyyy 'at' h:mm a")}
            </span>
            {!lastSync.success && lastSync.errorMessage && (
              <p className="w-full text-xs text-muted-foreground truncate">{lastSync.errorMessage}</p>
            )}
          </div>
        ) : (
          <p className="mt-1.5 text-xs text-muted-foreground">Not synced yet.</p>
        )}
      </div>
      <Button
        onClick={handleSync}
        disabled={syncInspection.isPending || !isFinalized}
        title={!isFinalized ? 'Inspection must be finalized before syncing' : undefined}
        className="shrink-0"
      >
        {syncInspection.isPending ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <RefreshCw className="w-4 h-4 mr-2" />
        )}
        Sync to {systemName}
      </Button>
    </div>
  );
}

export function InspectionDetail() {
  const { me } = useAuth();
  const params = useParams();
  const rawId = params.id ?? '';
  const id = /^\d+$/.test(rawId) ? Number(rawId) : 0;
  const hasValidId = Number.isSafeInteger(id) && id > 0;

  const { data: _inspection, isLoading: isLoadingInsp } = useGetInspection(id, {
    query: { queryKey: getGetInspectionQueryKey(id), enabled: hasValidId },
  });
  const { data: freshInspection } = useQuery<InspectionWithSignatures>({
    queryKey: ['inspection-gallery-media', id],
    enabled: hasValidId,
    queryFn: async () => {
      const response = await fetch(apiUrl(`/inspections/${id}`), { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to load inspection media');
      return response.json() as Promise<InspectionWithSignatures>;
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inspection = (freshInspection ?? _inspection) as InspectionWithSignatures | undefined;
  const { data: scorecard, isLoading: isLoadingScore } = useGetInspectionScorecard(id, {
    query: { queryKey: getGetInspectionScorecardQueryKey(id), enabled: hasValidId },
  });
  const { data: summary, isLoading: isLoadingSum } = useGetCustomerSummaryForInspection(id, {
    query: { queryKey: getGetCustomerSummaryForInspectionQueryKey(id), enabled: hasValidId },
  });
  const { data: analyses } = useListAnalysisResults(
    { inspectionId: id },
    { query: { queryKey: getListAnalysisResultsQueryKey({ inspectionId: id }), enabled: hasValidId } },
  );
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const photoMeta = useMemo<PhotoMeta[]>(() => {
    const findings = analyses?.[0]?.findings ?? [];
    return (inspection?.media ?? [])
      .filter((media) => !['video', 'audio', 'voice'].includes(media.mediaType))
      .map((media) => {
        const finding = findings.find((candidate) => candidate.imageUrl === media.url);
        const metadata = media.captureMetadata ?? {};
        const reviewFinding = finding as (typeof finding & {
          reviewStatus?: string | null;
          technicianSpecies?: string | null;
        }) | undefined;
        const correction = reviewFinding?.reviewStatus === 'corrected' ? reviewFinding.technicianSpecies : null;
        const metadataTag = typeof metadata.classification === 'string' ? metadata.classification : null;
        return {
          id: media.id,
          url: media.url,
          classificationTag: correction ?? finding?.species ?? finding?.category ?? metadataTag ?? 'Unclassified',
          confidenceScore: finding?.confidence ?? null,
          technicianCorrectionLabel: correction ?? null,
          structuredDescription: finding?.description ?? media.caption ?? null,
          chemicalLogReference: finding?.treatment ?? null,
          unitNumber: media.unitNumber ?? inspection?.unitNumber ?? null,
          capturedAt: getMediaTimestamp(media.capturedAt, media.createdAt),
        };
      });
  }, [analyses, inspection]);
  const mediaTimestamps = useMemo(() => photoMeta.map((photo) => photo.capturedAt), [photoMeta]);

  // Evidence must remain reviewable even when optional scorecard or customer
  // summary jobs are still pending (or unavailable for a legacy inspection).
  // Only the inspection record itself gates the page shell.
  const isLoading = isLoadingInsp;

  if (!hasValidId) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <p>Inspection link is invalid or incomplete.</p>
        <Link href="/inspections" className="mt-3 inline-flex text-sm text-primary hover:underline">
          Back to Inspections
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-12 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!inspection) {
    return <div className="p-8 text-center text-muted-foreground">Inspection not found.</div>;
  }
  const inspectionStatus = inspection.status || 'in_progress';

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto space-y-8">
      <div>
        <Link href="/inspections" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Inspections
        </Link>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{inspection.siteAddress}</h1>
            {inspection.unitNumber && (
              <p className="text-sm font-semibold text-primary/80 mt-0.5">Unit {inspection.unitNumber}</p>
            )}
            {inspection.clientName && <p className="text-lg text-muted-foreground mt-1">{inspection.clientName}</p>}
          </div>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium capitalize ${
            inspectionStatus === 'completed' ? 'bg-green-500/10 text-green-500' :
            inspectionStatus === 'in_progress' ? 'bg-blue-500/10 text-blue-500' :
            'bg-muted text-muted-foreground'
          }`}>
            {inspectionStatus.replace('_', ' ')}
          </span>
        </div>
      </div>

      {me?.effectiveRole === 'owner' && (
        <IntegrationSyncCard inspectionId={inspection.id} inspectionStatus={inspectionStatus} />
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="p-2 bg-primary/10 text-primary rounded-lg"><User className="w-5 h-5" /></div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Technician</p>
            <p className="font-semibold mt-0.5 text-sm">{inspection.technicianName}</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="p-2 bg-primary/10 text-primary rounded-lg"><Calendar className="w-5 h-5" /></div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Date</p>
            <p className="font-semibold mt-0.5 text-sm">{formatDateTime(inspection.createdAt, "MMM d, yyyy 'at' h:mm a")}</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="p-2 bg-primary/10 text-primary rounded-lg"><Bug className="w-5 h-5" /></div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Findings</p>
            <p className="font-semibold mt-0.5 text-sm">{inspection.findingsCount ?? 0}</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3 shadow-sm">
          <div className="p-2 bg-primary/10 text-primary rounded-lg"><MapPin className="w-5 h-5" /></div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Pests</p>
            <p className="font-semibold mt-0.5 text-sm capitalize">{(inspection.pestTypes ?? []).join(', ') || 'None'}</p>
          </div>
        </div>
      </div>

      {/* Signatures */}
      {(inspection.technicianSignature || inspection.ownerSignature || inspection.ownerNotAvailable) && (
        <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center gap-2">
            <PenLine className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-base font-semibold">Signatures</h2>
            {inspection.signedAt && (
              <span className="ml-auto text-xs text-muted-foreground">
                Signed {formatDateTime(inspection.signedAt, "MMM d, yyyy 'at' h:mm a")}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-border">
            <SignatureBlock
              label="Owner / Tenant"
              svg={inspection.ownerSignature}
              notAvailable={inspection.ownerNotAvailable}
            />
            <SignatureBlock
              label="Technician"
              svg={inspection.technicianSignature}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <section>
            <h2 className="text-xl font-bold mb-4">Customer Summary</h2>
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
              {summary ? (
                <div className="space-y-4">
                  <span className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium uppercase tracking-wider ${
                    summary.status === 'approved' ? 'bg-green-500/10 text-green-500' :
                    'bg-muted text-muted-foreground'
                  }`}>
                    {summary.status}
                  </span>
                  <div className="prose dark:prose-invert max-w-none">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{summary.body}</p>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No summary drafted yet. Complete the inspection to generate one.</p>
              )}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-4">Media ({photoMeta.length})</h2>
            <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
              {photoMeta.length ? (
                <div className="grid grid-cols-3 gap-3 xl:grid-cols-4">
                  {photoMeta.map((photo, index) => (
                    <button
                      type="button"
                      key={photo.id}
                      onClick={() => setLightboxIndex(index)}
                      className="group relative aspect-square overflow-hidden rounded-lg bg-muted text-left focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      aria-label={`Open ${photo.classificationTag} photo`}
                    >
                      <img src={mediaUrl(photo.url)} alt="" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105" />
                      <span className="absolute left-2 top-2 max-w-[calc(100%-1rem)] truncate rounded-full bg-black/70 px-2 py-1 text-[10px] font-semibold text-white">
                        {photo.classificationTag}
                      </span>
                      <span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-1 text-[10px] text-white">
                        {formatMediaTileTimestamp(photo.capturedAt, mediaTimestamps)}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No media captured for this inspection.</p>
              )}
            </div>
            <PhotoLightbox
              photos={photoMeta}
              index={lightboxIndex}
              onOpenChange={(open) => { if (!open) setLightboxIndex(null); }}
              onNavigate={setLightboxIndex}
            />
          </section>
        </div>

        <div className="space-y-8">
          <section>
            <h2 className="text-xl font-bold mb-4">Quality Scorecard</h2>
            <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
              {scorecard ? (
                <div>
                  <div className="p-6 border-b border-border bg-muted/20 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Overall Score</p>
                      <div className="flex items-end gap-1 mt-1">
                        <span className="text-4xl font-bold">{scorecard.qualityScore}</span>
                        <span className="text-muted-foreground mb-1">/ 100</span>
                      </div>
                    </div>
                    <div className={`px-3 py-1.5 rounded-full text-sm font-semibold capitalize ${
                      scorecard.riskLevel === 'critical' ? 'bg-destructive/10 text-destructive' :
                      scorecard.riskLevel === 'high' ? 'bg-orange-500/10 text-orange-500' :
                      scorecard.riskLevel === 'medium' ? 'bg-yellow-500/10 text-yellow-500' :
                      'bg-green-500/10 text-green-500'
                    }`}>
                      {scorecard.riskLevel} risk
                    </div>
                  </div>

                  <div className="p-4 space-y-3 border-b border-border">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Components</p>
                    {(Object.entries(scorecard.components ?? {}) as [string, number][]).map(([key, val]) => (
                      <div key={key}>
                        <div className="flex justify-between items-center mb-1">
                          <p className="text-xs font-medium capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</p>
                          <span className="text-xs font-semibold">{Math.round(val)}%</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${Math.min(100, Math.max(0, val))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  {(scorecard.missedOpportunities ?? []).length > 0 && (
                    <div className="p-4">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                          Missed Opportunities ({scorecard.missedOpportunities?.length ?? 0})
                      </p>
                      <ul className="space-y-2">
                        {(scorecard.missedOpportunities ?? []).map((opp, i) => (
                          <li key={i} className="flex gap-2 text-sm">
                            <ShieldAlert className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
                            <span className="text-muted-foreground">
                              <span className="font-medium text-foreground capitalize">{opp.serviceType}</span>
                              {' — '}{opp.description}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-6 text-center text-muted-foreground text-sm">
                  Scorecard not available. Inspection must be completed and analyzed.
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
