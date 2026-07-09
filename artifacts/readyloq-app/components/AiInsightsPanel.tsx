import { Ionicons } from "@expo/vector-icons";
import type { AnalysisResult, Finding } from "@/lib/api-client";
import React from "react";
import { ScrollView, Text, View } from "react-native";

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

export function AiInsightsPanel({
  siteAddress,
  propertyType,
  pestTypes,
  photosCount,
  pendingCount,
  analysis,
  analyzing,
  error,
  onRunAnalysis,
  onReview,
}: AiInsightsPanelProps) {
  const colors = useColors();
  const findings = analysis?.findings ?? [];
  const grouped = groupFindings(findings);

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
              Submit the inspection, then generate the report from its detail page.
            </Text>
          </View>
          <Badge label="Not generated" tone="warning" />
        </Card>

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
