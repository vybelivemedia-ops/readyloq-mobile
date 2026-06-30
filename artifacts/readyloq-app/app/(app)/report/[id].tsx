import { Ionicons } from "@expo/vector-icons";
import {
  getGetReportQueryOptions,
  useGenerateReportNarrative,
} from "@/lib/api-client";
import type { AiReportNarrative } from "@/lib/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { FindingCard } from "@/components/FindingCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { FullScreenLoader } from "@/components/ui/Loader";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import { formatDate, formatStatus, severityTone, statusTone } from "@/constants/inspection";
import { ApiError } from "@/lib/api";

export default function ReportDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);

  const reportQ = useQuery(getGetReportQueryOptions(id));
  const genNarrative = useGenerateReportNarrative();
  const [error, setError] = useState<string | null>(null);

  const report = reportQ.data;

  const generate = async () => {
    setError(null);
    try {
      await genNarrative.mutateAsync({ id });
      await queryClient.invalidateQueries();
      reportQ.refetch();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    }
  };

  if (reportQ.isLoading) return <FullScreenLoader />;
  if (reportQ.error || !report) {
    return (
      <Screen edges={["top", "bottom"]} padded>
        <TopBar onBack={() => router.back()} colors={colors} />
        <ErrorState title="Couldn't load report" message="Please try again." onRetry={() => reportQ.refetch()} />
      </Screen>
    );
  }

  const narrative = report.aiNarrative ?? undefined;

  return (
    <Screen edges={["top"]} padded>
      <TopBar onBack={() => router.back()} colors={colors} />
      <ScrollView contentContainerStyle={{ gap: 18, paddingVertical: 8, paddingBottom: 40 }}>
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 22, flex: 1 }}>
              {report.title}
            </Text>
            <Badge label={formatStatus(report.status)} tone={statusTone(report.status)} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {report.siteAddress ? <Meta icon="location-outline" text={report.siteAddress} colors={colors} /> : null}
            {report.technicianName ? <Meta icon="person-outline" text={report.technicianName} colors={colors} /> : null}
            <Meta icon="calendar-outline" text={formatDate(report.createdAt)} colors={colors} />
          </View>
          {report.severity ? (
            <Badge label={formatStatus(report.severity)} tone={severityTone(report.severity)} />
          ) : null}
        </View>

        {error ? (
          <Text style={{ color: colors.destructive, fontSize: 14, textAlign: "center" }}>{error}</Text>
        ) : null}

        {/* AI narrative */}
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="sparkles" size={18} color={colors.primary} />
            <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 17 }}>
              AI narrative
            </Text>
          </View>

          {narrative ? (
            <NarrativeBody narrative={narrative} colors={colors} />
          ) : (
            <Card style={{ gap: 12 }}>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14, textAlign: "center" }}>
                Generate a professional, structured narrative from this report's findings and evidence.
              </Text>
              <Button title="Generate AI narrative" icon="sparkles" loading={genNarrative.isPending} onPress={generate} />
            </Card>
          )}

          {narrative ? (
            <Button
              title="Regenerate narrative"
              variant="ghost"
              loading={genNarrative.isPending}
              onPress={generate}
            />
          ) : null}
        </View>

        {/* Findings */}
        {report.findings?.length ? (
          <View style={{ gap: 12 }}>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 17 }}>
              Findings
            </Text>
            {report.findings.map((f) => (
              <FindingCard key={f.id} finding={f} />
            ))}
          </View>
        ) : null}

        {/* Recommendations */}
        {report.recommendations?.length ? (
          <Card style={{ gap: 8 }}>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
              Recommendations
            </Text>
            {report.recommendations.map((r, i) => (
              <BulletRow key={i} text={r} colors={colors} />
            ))}
          </Card>
        ) : null}

        {report.treatmentNotes ? (
          <Card style={{ gap: 6 }}>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
              Treatment notes
            </Text>
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 }}>
              {report.treatmentNotes}
            </Text>
          </Card>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function NarrativeBody({
  narrative,
  colors,
}: {
  narrative: AiReportNarrative;
  colors: ReturnType<typeof useColors>;
}) {
  const sections: { title: string; body?: string; list?: string[] }[] = [
    { title: "Executive summary", body: narrative.executiveSummary },
    { title: "Inspection findings", body: narrative.inspectionFindings },
    { title: "Evidence observed", body: narrative.evidenceObserved },
    { title: "Pest activity assessment", body: narrative.pestActivityAssessment },
    { title: "Structural deficiencies", body: narrative.structuralDeficiencies },
    { title: "Sanitation concerns", body: narrative.sanitationConcerns },
    { title: "Recommended corrective actions", list: narrative.recommendedCorrectiveActions },
    { title: "Monitoring recommendations", list: narrative.monitoringRecommendations },
    { title: "Follow-up schedule", body: narrative.followUpSchedule },
    { title: "Technician notes", body: narrative.technicianNotes },
  ];

  return (
    <Card style={{ gap: 16 }}>
      {sections
        .filter((s) => s.body || s.list?.length)
        .map((s) => (
          <View key={s.title} style={{ gap: 6 }}>
            <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
              {s.title}
            </Text>
            {s.body ? (
              <Text style={{ color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21 }}>
                {s.body}
              </Text>
            ) : null}
            {s.list?.map((item, i) => (
              <BulletRow key={i} text={item} colors={colors} />
            ))}
          </View>
        ))}
      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>
        Generated by {narrative.model} · {formatDate(narrative.generatedAt)}
      </Text>
    </Card>
  );
}

function TopBar({ onBack, colors }: { onBack: () => void; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ paddingVertical: 10 }}>
      <Pressable
        onPress={onBack}
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="chevron-back" size={22} color={colors.foreground} />
      </Pressable>
    </View>
  );
}

function Meta({
  icon,
  text,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Ionicons name={icon} size={14} color={colors.mutedForeground} />
      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
        {text}
      </Text>
    </View>
  );
}

function BulletRow({ text, colors }: { text: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Text style={{ color: colors.primary, fontSize: 14, lineHeight: 21 }}>•</Text>
      <Text style={{ color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21, flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}
