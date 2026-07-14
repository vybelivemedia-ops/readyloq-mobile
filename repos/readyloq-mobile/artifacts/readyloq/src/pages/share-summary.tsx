import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, CalendarDays, MapPin } from "lucide-react";

/**
 * PUBLIC customer summary page — the landing page for share links.
 *
 * No auth: the unguessable token in the URL is the credential. The API
 * returns a uniform 404 for missing/revoked/expired links, so this page
 * only ever shows the approved summary or a generic "invalid link" state.
 */

type SharePayload = {
  companyName: string;
  propertyAddress: string;
  inspectionDate: string;
  approvedAt: string | null;
  summary: string;
};

export default function ShareSummaryPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;

  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "invalid" }
    | { status: "ok"; data: SharePayload }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setState({ status: "invalid" });
      return;
    }
    fetch(`/api/share/summary/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setState({ status: "invalid" });
          return;
        }
        const data = (await res.json()) as SharePayload;
        if (!cancelled) setState({ status: "ok", data });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "invalid" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="min-h-[100dvh] bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl">
        {state.status === "loading" ? (
          <Card>
            <CardContent className="py-8 space-y-4">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-32 w-full" />
            </CardContent>
          </Card>
        ) : state.status === "invalid" ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-lg font-semibold">This link is invalid or has expired</p>
              <p className="text-sm text-muted-foreground mt-2">
                Please contact your pest control provider for an updated link.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-8 space-y-5">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Inspection summary from
                </p>
                <h1 className="text-2xl font-bold mt-0.5">{state.data.companyName}</h1>
              </div>
              <div className="space-y-1.5 text-sm text-muted-foreground">
                <p className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 shrink-0" />
                  {state.data.propertyAddress}
                </p>
                <p className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 shrink-0" />
                  Inspected {new Date(state.data.inspectionDate).toLocaleDateString()}
                </p>
              </div>
              <div className="border-t pt-5">
                <p className="text-base leading-relaxed whitespace-pre-wrap">
                  {state.data.summary}
                </p>
              </div>
              <div className="border-t pt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
                Reviewed and approved by {state.data.companyName}
                {state.data.approvedAt
                  ? ` on ${new Date(state.data.approvedAt).toLocaleDateString()}`
                  : ""}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
