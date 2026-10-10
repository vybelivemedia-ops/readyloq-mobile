import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCustomerSummaryForInspection,
  getGetCustomerSummaryForInspectionQueryKey,
  useGenerateCustomerSummary,
  useUpdateCustomerSummary,
  useApproveCustomerSummary,
  useRevokeCustomerSummaryShare,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { FileText, Sparkles, Link2, Copy, ShieldCheck, XCircle } from "lucide-react";

/**
 * Customer Summary workflow card (manager+ only, rendered on inspection detail).
 *
 * The AI only REPHRASES verified findings into plain language — a fidelity
 * gate on the server rejects any draft that adds facts, pricing, or claims
 * not present in the analysis. Nothing reaches a customer until a manager
 * reads it and explicitly approves, which freezes the text and mints an
 * expiring, revocable share link.
 */

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const EXPIRY_OPTIONS = [7, 30, 90] as const;

export function CustomerSummaryCard({ inspectionId }: { inspectionId: number }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editDraft, setEditDraft] = useState<string | null>(null);
  const [expiresInDays, setExpiresInDays] = useState<number>(30);

  const queryKey = getGetCustomerSummaryForInspectionQueryKey(inspectionId);
  const { data: summary, isLoading, error } = useGetCustomerSummaryForInspection(
    inspectionId,
    { query: { queryKey, retry: false } },
  );
  const notFound = Boolean(error && (error as { status?: number }).status === 404);

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const generate = useGenerateCustomerSummary({
    mutation: {
      onSuccess: () => {
        invalidate();
        setEditDraft(null);
        toast({ title: "Draft generated", description: "Review it before approving." });
      },
      onError: (err) => {
        toast({
          title: "Could not generate summary",
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        });
      },
    },
  });
  const update = useUpdateCustomerSummary({
    mutation: {
      onSuccess: () => {
        invalidate();
        setEditDraft(null);
        toast({ title: "Draft saved" });
      },
      onError: (err) => {
        toast({
          title: "Save failed",
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        });
      },
    },
  });
  const approve = useApproveCustomerSummary({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Summary approved", description: "Share link is ready to copy." });
      },
      onError: (err) => {
        toast({
          title: "Approval failed",
          description: err instanceof Error ? err.message : undefined,
          variant: "destructive",
        });
      },
    },
  });
  const revoke = useRevokeCustomerSummaryShare({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Share link revoked" });
      },
      onError: () => toast({ title: "Revoke failed", variant: "destructive" }),
    },
  });

  const shareUrl =
    summary?.shareToken != null
      ? `${window.location.origin}${basePath}/share/summary/${summary.shareToken}`
      : null;
  const shareExpired =
    summary?.shareExpiresAt != null &&
    new Date(summary.shareExpiresAt).getTime() < Date.now();

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Copy failed", description: shareUrl, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          Customer Summary
          {summary && (
            <Badge
              variant="secondary"
              className={
                summary.status === "approved"
                  ? "bg-emerald-500/15 text-emerald-500 ml-auto"
                  : "bg-amber-500/15 text-amber-500 ml-auto"
              }
            >
              {summary.status}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : notFound || !summary ? (
          <>
            <p className="text-sm text-muted-foreground">
              Turn this inspection's verified findings into a plain-language summary for
              the customer. The AI only rephrases — it cannot add findings, pricing, or
              claims — and nothing is shared until you approve it.
            </p>
            <Button
              size="sm"
              disabled={generate.isPending}
              onClick={() => generate.mutate({ inspectionId })}
            >
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              {generate.isPending ? "Generating…" : "Generate draft"}
            </Button>
          </>
        ) : summary.status === "draft" ? (
          <>
            {editDraft === null ? (
              <>
                <p className="text-sm whitespace-pre-wrap rounded-md bg-muted/40 p-3">
                  {summary.body}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditDraft(summary.body)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={generate.isPending}
                    onClick={() => generate.mutate({ inspectionId })}
                  >
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                    Regenerate
                  </Button>
                </div>
                <div className="border-t pt-3">
                  <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                    Approve &amp; create share link
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {EXPIRY_OPTIONS.map((days) => (
                      <Button
                        key={days}
                        size="sm"
                        variant={expiresInDays === days ? "default" : "outline"}
                        onClick={() => setExpiresInDays(days)}
                      >
                        {days} days
                      </Button>
                    ))}
                    <Button
                      size="sm"
                      className="ml-auto"
                      disabled={approve.isPending}
                      onClick={() =>
                        approve.mutate({ id: summary.id, data: { expiresInDays } })
                      }
                    >
                      <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
                      Approve
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    Approving freezes the text and creates a private link that expires after
                    the selected period. You can revoke it at any time.
                  </p>
                </div>
              </>
            ) : (
              <>
                <Textarea
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  rows={8}
                  className="text-sm"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={update.isPending || editDraft.trim().length < 40}
                    onClick={() =>
                      update.mutate({ id: summary.id, data: { body: editDraft.trim() } })
                    }
                  >
                    Save draft
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditDraft(null)}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <p className="text-sm whitespace-pre-wrap rounded-md bg-muted/40 p-3">
              {summary.body}
            </p>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
              Approved{summary.approvedAt ? ` ${new Date(summary.approvedAt).toLocaleDateString()}` : ""} — text is frozen
            </p>
            {shareUrl && !shareExpired ? (
              <div className="rounded-md border p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                  <Link2 className="h-3.5 w-3.5" /> Share link
                  {summary.shareExpiresAt && (
                    <span className="font-normal">
                      · expires {new Date(summary.shareExpiresAt).toLocaleDateString()}
                    </span>
                  )}
                </p>
                <p className="text-xs break-all text-muted-foreground">{shareUrl}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={copyLink}>
                    <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy link
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-400 hover:text-red-400"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate({ id: summary.id })}
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1.5" /> Revoke
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {shareExpired
                  ? "The share link has expired."
                  : "The share link has been revoked."}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
