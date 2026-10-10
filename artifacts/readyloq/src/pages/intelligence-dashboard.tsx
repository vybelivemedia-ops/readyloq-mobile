import { useState } from "react";
import {
  useGetScorecardSummary,
  getGetScorecardSummaryQueryKey,
  useListScorecards,
  getListScorecardsQueryKey,
  type InspectionScorecardListItem,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  Gauge,
  ClipboardCheck,
  AlertTriangle,
  Users,
  Wrench,
  Leaf,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

/**
 * Management Intelligence — deterministic aggregates over inspection scorecards.
 *
 * Every number on this page is computed by fixed rules from real inspection
 * data (findings, photos, confidence values). Nothing here is AI-generated
 * or estimated — no fabricated benchmarks, no invented dollar figures.
 */

const RISK_STYLES: Record<string, string> = {
  low: "bg-slate-500/15 text-slate-400",
  medium: "bg-amber-500/15 text-amber-400",
  high: "bg-orange-500/15 text-orange-400",
  critical: "bg-red-500/15 text-red-400",
};

function RiskBadge({ riskLevel }: { riskLevel: string }) {
  return (
    <Badge variant="secondary" className={RISK_STYLES[riskLevel] ?? ""}>
      <AlertTriangle className="h-3 w-3 mr-1" />
      {riskLevel}
    </Badge>
  );
}

function qualityColor(score: number) {
  if (score >= 80) return "text-emerald-500";
  if (score >= 60) return "text-amber-500";
  return "text-red-400";
}

function ScorecardRow({ scorecard }: { scorecard: InspectionScorecardListItem }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card
      className="cursor-pointer hover:border-primary/40 transition-colors"
      onClick={() => setExpanded((v) => !v)}
    >
      <CardContent className="py-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold truncate">{scorecard.siteAddress}</p>
            <p className="text-sm text-muted-foreground">
              {scorecard.technicianName} ·{" "}
              {new Date(scorecard.inspectionDate).toLocaleDateString()} · inspection #
              {scorecard.inspectionId}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span className={`text-lg font-bold ${qualityColor(scorecard.qualityScore)}`}>
              {scorecard.qualityScore}
            </span>
            <RiskBadge riskLevel={scorecard.riskLevel} />
            {scorecard.missedOpportunities.length > 0 && (
              <Badge variant="secondary" className="bg-amber-500/15 text-amber-400">
                {scorecard.missedOpportunities.length} missed
              </Badge>
            )}
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </div>
        {expanded && (
          <div className="mt-3 border-t pt-3 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Photo coverage</p>
                <p className="font-semibold">{scorecard.components.photoCoverage}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Evidence quality</p>
                <p className="font-semibold">{scorecard.components.evidenceQuality}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg confidence</p>
                <p className="font-semibold">{scorecard.components.avgConfidence}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Recommendations</p>
                <p className="font-semibold">{scorecard.components.recommendationCoverage}</p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>{scorecard.findingsCount} findings</span>
              <span>{scorecard.photosAnalyzed} photos analyzed</span>
              <span>Risk score {scorecard.riskScore}</span>
            </div>
            {scorecard.missedOpportunities.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1">
                  Missed service opportunities
                </p>
                <div className="space-y-1.5">
                  {scorecard.missedOpportunities.map((missed) => (
                    <div
                      key={missed.findingId}
                      className="flex items-start gap-2 text-sm rounded-md bg-amber-500/5 border border-amber-500/20 px-2.5 py-1.5"
                    >
                      <Wrench className="h-3.5 w-3.5 mt-0.5 text-amber-400 shrink-0" />
                      <div className="min-w-0">
                        <span className="font-medium capitalize">
                          {missed.serviceType.replace(/_/g, " ")}:{" "}
                        </span>
                        <span className="text-muted-foreground">{missed.description}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <Link href={`/inspections/${scorecard.inspectionId}`}>
              <Button variant="outline" size="sm">
                View inspection
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function IntelligenceDashboard() {
  const [technicianFilter, setTechnicianFilter] = useState<string | null>(null);

  const { data: summary, isLoading: summaryLoading } = useGetScorecardSummary({
    query: { queryKey: getGetScorecardSummaryQueryKey() },
  });
  const params = technicianFilter ? { technician: technicianFilter } : undefined;
  const { data: scorecards, isLoading: listLoading } = useListScorecards(params, {
    query: { queryKey: getListScorecardsQueryKey(params) },
  });

  const rows = scorecards ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Gauge className="h-6 w-6 text-primary" /> Performance
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Inspection quality scorecards — every number computed from real field data
        </p>
      </div>

      {summaryLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : !summary || summary.totalScorecards === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <ClipboardCheck className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <p className="font-medium">No scorecards yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Scorecards are generated automatically when inspections are analyzed.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Inspections scored
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-2xl font-bold">{summary.totalScorecards}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Avg quality
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className={`text-2xl font-bold ${qualityColor(summary.avgQuality)}`}>
                  {summary.avgQuality}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Avg risk
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-2xl font-bold">{summary.avgRisk}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  Risk mix
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex flex-wrap gap-1">
                  {Object.entries(summary.riskDistribution).map(([level, count]) => (
                    <Badge
                      key={level}
                      variant="secondary"
                      className={`${RISK_STYLES[level] ?? ""} text-xs`}
                    >
                      {level} {count}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" /> Technicians
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {summary.technicians.map((tech) => (
                    <button
                      key={tech.technicianName}
                      className={`w-full flex items-center justify-between rounded-md border px-3 py-2 text-left transition-colors ${
                        technicianFilter === tech.technicianName
                          ? "border-primary bg-primary/5"
                          : "hover:border-primary/40"
                      }`}
                      onClick={() =>
                        setTechnicianFilter((prev) =>
                          prev === tech.technicianName ? null : tech.technicianName,
                        )
                      }
                    >
                      <div>
                        <p className="text-sm font-medium">{tech.technicianName}</p>
                        <p className="text-xs text-muted-foreground">
                          {tech.inspections} inspection{tech.inspections === 1 ? "" : "s"}
                          {tech.missedOpportunities > 0
                            ? ` · ${tech.missedOpportunities} missed opportunities`
                            : ""}
                        </p>
                      </div>
                      <span className={`text-lg font-bold ${qualityColor(tech.avgQuality)}`}>
                        {tech.avgQuality}
                      </span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="space-y-3">
              {Object.keys(summary.missedByService).length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Wrench className="h-4 w-4 text-amber-400" /> Missed services
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(summary.missedByService).map(([service, count]) => (
                        <Badge key={service} variant="outline" className="capitalize">
                          {service.replace(/_/g, " ")} · {count}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
              {summary.topConduciveConditions.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Leaf className="h-4 w-4 text-emerald-500" /> Top conducive conditions
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-1">
                      {summary.topConduciveConditions.map((item) => (
                        <div
                          key={item.label}
                          className="flex items-center justify-between text-sm"
                        >
                          <span className="truncate">{item.label}</span>
                          <span className="text-muted-foreground shrink-0 ml-2">
                            ×{item.occurrences}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
              {summary.topRecommendedServices.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <ClipboardCheck className="h-4 w-4 text-primary" /> Top recommended services
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-1">
                      {summary.topRecommendedServices.map((item) => (
                        <div
                          key={item.label}
                          className="flex items-center justify-between text-sm"
                        >
                          <span className="truncate">{item.label}</span>
                          <span className="text-muted-foreground shrink-0 ml-2">
                            ×{item.occurrences}
                          </span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Scorecards</h2>
            {technicianFilter && (
              <Button size="sm" variant="outline" onClick={() => setTechnicianFilter(null)}>
                Clear filter: {technicianFilter}
              </Button>
            )}
          </div>

          {listLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No scorecards match this filter.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {rows.map((scorecard) => (
                <ScorecardRow key={scorecard.id} scorecard={scorecard} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
