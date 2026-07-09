import { Ionicons } from "@expo/vector-icons";
import type { AnalysisResult, Finding, Report } from "@/lib/api-client";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { FindingCard } from "@/components/FindingCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useColors } from "@/hooks/useColors";
import { confidencePct, formatStatus, severityTone } from "@/constants/inspection";

interface AiInsightsPanelProps {
  siteAddress: string;
  propertyType: string;
  pestTypes: string[];
  photosCount: number;
  /** Photos captured since the last analysis run. */
  pendingCount: number;
  analysis?: AnalysisResult;
  analyzing: boolean;
  error: string | null;
  /** Live service report — auto-built after each analysis run. */
  report?: Report | null;
  reportBuilding: boolean;
  reportError: string | null;
  onRunAnalysis: () => void;
  onReview: () => void;
}

const FINDING_GROUPS: { title: string; icon: keyof typeof Ionicons.glyphMap; test: RegExp }[] = [
  {
    title: "Pest species & activity",
    icon: "bug-outline",
    test: /pest|rodent|mouse|mice|rat|roach|termite|ant\b|ants|bed ?bug|flies|fly\b|spider|wildlife|species|activity|dropping|gnaw|infestation/i,
  },
  {
    title: "Conducive conditions",
    icon: "warning-outline",
    test: /conducive|sanitation|food|clutter|debris|vegetation|waste|garbage/i,
  },
  { title: "Harborage", icon: "home-outline", test: /harborage|nest|shelter|void/i },
  { title: "Moisture", icon: "water-outline", test: /moisture|water|leak|damp|humid|condensation/i },
  {
    title: "Structural issues",
    icon: "construct-outline",
    test: /structur|entry point|exclusion|gap|crack|seal|hole|opening|damage/i,
  },
];

function groupFindings(findings: Finding[]) {
  const groups: { title: string; icon: keyof typeof Ionicons.glyphMap; items: Finding[] }[] =
    FINDING_GROUPS.map((g) => ({ title: g.title, icon: g.icon, items: [] }));
  const other: Finding[] = [];
  for (const f of findings) {
    const idx = FINDING_GROUPS.findIndex((g) => g.test.test(f.category ?? ""));
    if (idx >= 0) groups[idx].items.push(f);
    else other.push(f);
  }
  const result = groups.filter((g) => g.items.length > 0);
  if (other.length) result.push({ title: "Other findings", icon: "search-outline", items: other });
  return result;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function AiInsightsPanel({
  siteAddress,
  propertyType,
  pestTypes,
  photosCount,
  pendingCount,
  analysis,
  analyzing,
  error,
  report,
  reportBuilding,
  reportError,
  onRunAnalysis,
  onReview,
}: AiInsightsPanelProps) {
  const colors = useColors();
  const [tab, setTab] = useState<"insights" | "report">("insights");
  const findings = analysis?.findings ?? [];
  const grouped = groupFindings(findings);
  const narrative = report?.aiNarrative ?? null;

  // Live report sections — every value comes from the server-generated
  // narrative, which is grounded in real detections and inspection data.
  const reportSections: {
    title: string;
    icon: keyof typeof Ionicons.glyphMap;
    body?: string;
    list?: string[];
  }[] = narrative
    ? [
        { title: "Inspection summary", icon: "reader-outline", body: narrative.executiveSummary },
        { title: "Evidence", icon: "eye-outline", body: narrative.evidenceObserved },
        {
          title: "Conducive conditions",
          icon: "warning-outline",
          body: narrative.conduciveConditions || narrative.sanitationConcerns,
        },
        {
          title: "Treatment recommendations",
          icon: "medkit-outline",
          list: narrative.recommendedCorrectiveActions,
        },
        {
          title: "Customer recommendations",
          icon: "people-outline",
          list: narrative.customerRecommendations ?? [],
        },
      ]
    : [];

  const tabButton = (key: "insights" | "report", label: string) => {
    const active = tab === key;
    return (
      <Pressable
        key={key}
        onPress={() => setTab(key)}
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          paddingVertical: 8,
          borderRadius: 8,
          backgroundColor: active ? colors.card : "transparent",
        }}
      >
        <Text
          style={{
            color: active ? colors.foreground : colors.mutedForeground,
            fontFamily: active ? "Inter_600SemiBold" : "Inter_500Medium",
            fontSize: 13,
          }}
        >
          {label}
        </Text>
        {key === "report" && reportBuilding ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : key === "report" && narrative ? (
          <View
            style={{
              width: 7,
              height: 7,
              borderRadius: 4,
              backgroundColor: colors.primary,
            }}
          />
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}>
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
            <Ionicons name="sparkles" size={18} color={colors.primary} />
            <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 18 }}>
              AI Insights
            </Text>
          </View>
          <Badge
            label={analyzing ? "Analyzing" : analysis ? formatStatus(analysis.status) : "Standby"}
            tone={analyzing ? "info" : analysis ? "success" : "default"}
          />
        </View>

        {/* Insights / Live report tab switch */}
        <View
          style={{
            flexDirection: "row",
            backgroundColor: colors.muted,
            borderRadius: 10,
            padding: 3,
          }}
        >
          {tabButton("insights", "Insights")}
          {tabButton("report", "Live report")}
        </View>

        {tab === "insights" ? (
          <>
            {/* Inspection context */}
            <Card style={{ gap: 8 }}>
              <Text
                numberOfLines={1}
                style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}
              >
                {siteAddress}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <Badge label={propertyType} tone="default" />
                {pestTypes.map((p) => (
                  <Badge key={p} label={p} tone="default" />
                ))}
              </View>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                {photosCount} photo{photosCount === 1 ? "" : "s"} captured
                {analysis && pendingCount > 0 ? ` · ${pendingCount} not yet analyzed` : ""}
              </Text>
            </Card>

            {/* Run / re-run analysis */}
            {!analysis || pendingCount > 0 ? (
              <Card style={{ gap: 12 }}>
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontFamily: "Inter_400Regular",
                    fontSize: 13,
                    lineHeight: 19,
                    textAlign: "center",
                  }}
                >
                  {photosCount === 0
                    ? "Capture evidence photos to run AI analysis."
                    : analysis
                      ? "New photos captured since the last analysis."
                      : "Photos upload securely, then AI detects pest activity and conditions. Keep capturing while it runs."}
                </Text>
                <Button
                  title={
                    analyzing
                      ? "Analyzing…"
                      : analysis
                        ? "Re-run AI analysis"
                        : `Run AI analysis (${photosCount} photo${photosCount === 1 ? "" : "s"})`
                  }
                  icon="sparkles"
                  loading={analyzing}
                  disabled={photosCount === 0 || analyzing}
                  onPress={onRunAnalysis}
                />
              </Card>
            ) : null}

            {error ? (
              <Text style={{ color: colors.destructive, fontSize: 13, textAlign: "center" }}>{error}</Text>
            ) : null}

            {/* Results */}
            {analysis ? (
              <>
                <Card style={{ flexDirection: "row", gap: 16 }}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12 }}>
                      Risk level
                    </Text>
                    <Badge
                      label={formatStatus(analysis.riskLevel ?? "—")}
                      tone={severityTone(analysis.riskLevel)}
                    />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12 }}>
                      Overall confidence
                    </Text>
                    <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 18 }}>
                      {confidencePct(analysis.overallConfidence)}
                    </Text>
                  </View>
                </Card>

                {grouped.length === 0 ? (
                  <Card>
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontFamily: "Inter_400Regular",
                        fontSize: 13,
                        textAlign: "center",
                      }}
                    >
                      No findings detected in the analyzed photos.
                    </Text>
                  </Card>
                ) : (
                  grouped.map((g) => (
                    <View key={g.title} style={{ gap: 10 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Ionicons name={g.icon} size={15} color={colors.primary} />
                        <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                          {g.title}
                        </Text>
                        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12 }}>
                          {g.items.length}
                        </Text>
                      </View>
                      {g.items.map((f) => (
                        <FindingCard key={f.id} finding={f} />
                      ))}
                    </View>
                  ))
                )}

                {analysis.recommendations?.length ? (
                  <Card style={{ gap: 8 }}>
                    <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                      Suggested treatment
                    </Text>
                    {analysis.recommendations.map((r, i) => (
                      <View key={i} style={{ flexDirection: "row", gap: 8 }}>
                        <Text style={{ color: colors.primary, fontSize: 13, lineHeight: 19 }}>•</Text>
                        <Text
                          style={{
                            color: colors.mutedForeground,
                            fontFamily: "Inter_400Regular",
                            fontSize: 13,
                            lineHeight: 19,
                            flex: 1,
                          }}
                        >
                          {r}
                        </Text>
                      </View>
                    ))}
                  </Card>
                ) : null}
              </>
            ) : null}

            {/* Report status */}
            <Card style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name="document-text-outline" size={18} color={colors.mutedForeground} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                  Report status
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                  {narrative
                    ? "Building live from verified findings. See the Live report tab."
                    : reportBuilding
                      ? "Writing the service report from verified findings…"
                      : "Builds automatically after each AI analysis run."}
                </Text>
              </View>
              <Badge
                label={reportBuilding ? "Updating" : narrative ? "Live draft" : "Not started"}
                tone={reportBuilding ? "info" : narrative ? "success" : "warning"}
              />
            </Card>
          </>
        ) : (
          <>
            {/* Live report */}
            {reportError ? (
              <Text style={{ color: colors.destructive, fontSize: 13, textAlign: "center" }}>
                {reportError}
              </Text>
            ) : null}

            {!narrative && !reportBuilding ? (
              <Card style={{ gap: 8, alignItems: "center", paddingVertical: 24 }}>
                <Ionicons name="document-text-outline" size={28} color={colors.mutedForeground} />
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontFamily: "Inter_400Regular",
                    fontSize: 13,
                    lineHeight: 19,
                    textAlign: "center",
                  }}
                >
                  The service report writes itself from verified findings after each AI analysis
                  run. Capture photos and run analysis to start it.
                </Text>
              </Card>
            ) : null}

            {!narrative && reportBuilding ? (
              <Card style={{ gap: 10, alignItems: "center", paddingVertical: 24 }}>
                <ActivityIndicator color={colors.primary} />
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontFamily: "Inter_400Regular",
                    fontSize: 13,
                    textAlign: "center",
                  }}
                >
                  Writing the service report from verified findings…
                </Text>
              </Card>
            ) : null}

            {narrative ? (
              <>
                <Card style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Ionicons
                    name={reportBuilding ? "sync-outline" : "checkmark-circle-outline"}
                    size={18}
                    color={reportBuilding ? colors.primary : colors.success ?? colors.primary}
                  />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                      {report?.title ?? "Service report"}
                    </Text>
                    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                      {reportBuilding
                        ? "Updating with the latest findings…"
                        : `Updated ${formatTime(narrative.generatedAt)} · grounded in ${photosCount} photo${photosCount === 1 ? "" : "s"} + AI detections`}
                    </Text>
                  </View>
                  <Badge label="Draft" tone={reportBuilding ? "info" : "default"} />
                </Card>

                {reportSections.map((s) => (
                  <Card key={s.title} style={{ gap: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Ionicons name={s.icon} size={15} color={colors.primary} />
                      <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                        {s.title}
                      </Text>
                    </View>
                    {s.body != null ? (
                      <Text
                        style={{
                          color: colors.mutedForeground,
                          fontFamily: "Inter_400Regular",
                          fontSize: 13,
                          lineHeight: 20,
                        }}
                      >
                        {s.body.trim().length > 0 ? s.body : "No supporting data recorded yet."}
                      </Text>
                    ) : (s.list?.length ?? 0) > 0 ? (
                      s.list!.map((item, i) => (
                        <View key={i} style={{ flexDirection: "row", gap: 8 }}>
                          <Text style={{ color: colors.primary, fontSize: 13, lineHeight: 20 }}>•</Text>
                          <Text
                            style={{
                              color: colors.mutedForeground,
                              fontFamily: "Inter_400Regular",
                              fontSize: 13,
                              lineHeight: 20,
                              flex: 1,
                            }}
                          >
                            {item}
                          </Text>
                        </View>
                      ))
                    ) : (
                      <Text
                        style={{
                          color: colors.mutedForeground,
                          fontFamily: "Inter_400Regular",
                          fontSize: 13,
                        }}
                      >
                        No supporting data recorded yet.
                      </Text>
                    )}
                  </Card>
                ))}
              </>
            ) : null}
          </>
        )}

        <Button
          title="Review & submit"
          size="lg"
          icon="checkmark-circle-outline"
          disabled={photosCount === 0 || analyzing}
          onPress={onReview}
        />
      </ScrollView>
    </View>
  );
}
