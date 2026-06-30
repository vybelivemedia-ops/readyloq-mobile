import { Ionicons } from "@expo/vector-icons";
import {
  getGetInspectionQueryOptions,
  getListAnalysisResultsQueryOptions,
  useAnalyzeInspection,
  useGenerateReport,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { AuthedImage } from "@/components/AuthedImage";
import { FindingCard } from "@/components/FindingCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { FullScreenLoader } from "@/components/ui/Loader";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import {
  confidencePct,
  formatDate,
  formatStatus,
  severityTone,
  statusTone,
} from "@/constants/inspection";
import { ApiError } from "@/lib/api";

export default function InspectionDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id: string }>();
  const id = Number(params.id);

  const inspectionQ = useQuery(getGetInspectionQueryOptions(id));
  const analysisQ = useQuery(getListAnalysisResultsQueryOptions({ inspectionId: id }));

  const analyze = useAnalyzeInspection();
  const genReport = useGenerateReport();
  const [error, setError] = useState<string | null>(null);

  const inspection = inspectionQ.data;
  const analysis = analysisQ.data?.[0];
  const photos = (inspection?.media ?? []).filter((m) => m.mediaType === "photo");

  const runAnalysis = async () => {
    setError(null);
    try {
      await analyze.mutateAsync({
        data: {
          inspectionId: id,
          images: photos.map((m) => ({ imageUrl: m.url })),
        },
      });
      await queryClient.invalidateQueries();
      analysisQ.refetch();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    }
  };

  const createReport = async () => {
    setError(null);
    try {
      const report = await genReport.mutateAsync({
        data: {
          inspectionId: id,
          title: `Inspection Report — ${inspection?.siteAddress ?? id}`,
          includePhotos: true,
          includeAiFindings: true,
        },
      });
      await queryClient.invalidateQueries();
      router.push(`/report/${report.id}` as Href);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    }
  };

  if (inspectionQ.isLoading) return <FullScreenLoader />;
  if (inspectionQ.error || !inspection) {
    return (
      <Screen edges={["top", "bottom"]} padded>
        <TopBar onBack={() => router.back()} colors={colors} />
        <ErrorState
          title="Couldn't load inspection"
          message="Please try again."
          onRetry={() => inspectionQ.refetch()}
        />
      </Screen>
    );
  }

  return (
    <Screen edges={["top"]} padded>
      <TopBar onBack={() => router.back()} colors={colors} />
      <ScrollView contentContainerStyle={{ gap: 18, paddingVertical: 8, paddingBottom: 40 }}>
        {/* Heading */}
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 22, flex: 1 }}>
              {inspection.siteAddress}
            </Text>
            <Badge label={formatStatus(inspection.status)} tone={statusTone(inspection.status)} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {inspection.clientName ? (
              <Meta icon="business-outline" text={inspection.clientName} colors={colors} />
            ) : null}
            <Meta icon="person-outline" text={inspection.technicianName} colors={colors} />
            <Meta icon="calendar-outline" text={formatDate(inspection.createdAt)} colors={colors} />
          </View>
          {inspection.pestTypes?.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
              {inspection.pestTypes.map((p) => (
                <Badge key={p} label={p} tone="default" />
              ))}
            </View>
          ) : null}
        </View>

        {inspection.notes ? (
          <Card>
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 }}>
              {inspection.notes}
            </Text>
          </Card>
        ) : null}

        {/* Evidence */}
        {photos.length ? (
          <View style={{ gap: 10 }}>
            <SectionTitle title={`Evidence (${photos.length})`} colors={colors} />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {photos.map((m) => (
                <AuthedImage
                  key={m.id}
                  path={m.url}
                  style={{ width: 104, height: 104, borderRadius: 10 }}
                />
              ))}
            </View>
          </View>
        ) : null}

        {error ? (
          <Text style={{ color: colors.destructive, fontSize: 14, textAlign: "center" }}>{error}</Text>
        ) : null}

        {/* AI Analysis */}
        <View style={{ gap: 12 }}>
          <SectionTitle title="AI analysis" colors={colors} />
          {analysisQ.isLoading ? (
            <Card>
              <Text style={{ color: colors.mutedForeground, textAlign: "center" }}>Loading analysis…</Text>
            </Card>
          ) : analysis ? (
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

              {analysis.findings?.map((f) => <FindingCard key={f.id} finding={f} />)}

              {analysis.recommendations?.length ? (
                <Card style={{ gap: 8 }}>
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
                    Recommendations
                  </Text>
                  {analysis.recommendations.map((r, i) => (
                    <BulletRow key={i} text={r} colors={colors} />
                  ))}
                </Card>
              ) : null}
            </>
          ) : (
            <Card style={{ gap: 12 }}>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14, textAlign: "center" }}>
                {photos.length
                  ? "No AI analysis yet. Run it to detect pest activity and conducive conditions."
                  : "Add photos to this inspection to run AI analysis."}
              </Text>
              {photos.length ? (
                <Button title="Run AI analysis" icon="sparkles" loading={analyze.isPending} onPress={runAnalysis} />
              ) : null}
            </Card>
          )}
        </View>

        {/* Generate report */}
        <Button
          title="Generate report"
          variant={analysis ? "primary" : "outline"}
          icon="document-text-outline"
          loading={genReport.isPending}
          onPress={createReport}
        />
      </ScrollView>
    </Screen>
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

function SectionTitle({ title, colors }: { title: string; colors: ReturnType<typeof useColors> }) {
  return (
    <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 17 }}>{title}</Text>
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
      <Text style={{ color: colors.primary, fontSize: 14, lineHeight: 20 }}>•</Text>
      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20, flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}
