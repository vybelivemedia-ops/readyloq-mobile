import { useAuth } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import {
  getGetInspectionQueryOptions,
  getListAnalysisResultsQueryOptions,
  useAnalyzeInspection,
  useGenerateReport,
  type Finding,
} from "@/lib/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Href, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { AuthedImage } from "@/components/AuthedImage";
import { FindingCard } from "@/components/FindingCard";
import { MeasurementDevicePanel } from "@/components/MeasurementDevicePanel";
import { TreatmentLogWizard } from "@/components/TreatmentLogWizard";
import { listTreatmentLogs, type TreatmentLog } from "@/lib/api-client/products";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { FullScreenLoader } from "@/components/ui/Loader";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  confidencePct,
  formatDate,
  formatStatus,
  severityTone,
  statusTone,
} from "@/constants/inspection";
import { API_BASE, ApiError, reopenInspection } from "@/lib/api";
import { describeCaptureSource, isLowQuality } from "@/lib/vision";

type ReviewAction = "accept" | "correct" | "dismiss";

interface InspectionDetailProps {
  id: number;
  /** Rendered inside a split-view pane: no Screen wrapper, no back button. */
  embedded?: boolean;
}

export function InspectionDetail({ id, embedded = false }: InspectionDetailProps) {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { getToken } = useAuth();
  const { user } = useCurrentUser();

  const inspectionQ = useQuery(getGetInspectionQueryOptions(id));
  const analysisQ = useQuery(getListAnalysisResultsQueryOptions({ inspectionId: id }));

  // ── Treatment logs ─────────────────────────────────────────────────────────
  const [showTreatmentWizard, setShowTreatmentWizard] = useState(false);
  const treatmentLogsQ = useQuery({
    queryKey: ["treatment-logs", id],
    queryFn: () => listTreatmentLogs(id),
    staleTime: 30_000,
    enabled: id > 0,
  });
  const handleTreatmentLogged = useCallback(() => {
    void treatmentLogsQ.refetch();
    setShowTreatmentWizard(false);
  }, [treatmentLogsQ]);

  const analyze = useAnalyzeInspection();
  const genReport = useGenerateReport();
  const [error, setError] = useState<string | null>(null);
  const [reopening, setReopening] = useState(false);

  // ── Inline finding correction state ───────────────────────────────────────
  // `reviewResults` maps findingId → action so FindingCard can highlight the
  // chosen action immediately without waiting for a refetch.
  const [reviewResults, setReviewResults] = useState<Record<number, ReviewAction>>({});
  const [correctingFinding, setCorrectingFinding] = useState<Finding | null>(null);
  const [customSpecies, setCustomSpecies] = useState("");
  const [reviewSaving, setReviewSaving] = useState(false);

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

  // A manager/owner can reopen any inspection; a technician can only reopen
  // their own (matched via the clerkUserId stored in technicianId at creation).
  const canReopen =
    inspection?.status === "completed" &&
    !!user &&
    (["manager", "owner"].includes(user.role) ||
      (user.role === "technician" && inspection.technicianId === user.clerkUserId));

  const handleReopen = () => {
    Alert.alert(
      "Reopen inspection?",
      "The inspection will return to in-progress so you can add photos or make corrections. Previous AI analysis and reports are kept.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reopen",
          style: "destructive",
          onPress: async () => {
            setReopening(true);
            setError(null);
            try {
              const token = await getToken();
              await reopenInspection(token, id);
              await queryClient.invalidateQueries();
            } catch (e) {
              setError(e instanceof ApiError ? e.message : "Failed to reopen inspection");
            } finally {
              setReopening(false);
            }
          },
        },
      ],
    );
  };

  // ── Finding correction handlers ────────────────────────────────────────────

  /**
   * Called from FindingCard when the technician taps Accept / Correct / Dismiss.
   * For "correct" we open a modal to capture the species; the other two actions
   * post immediately.
   */
  const handleFindingAction = (finding: Finding, action: ReviewAction) => {
    if (action === "correct") {
      setCorrectingFinding(finding);
      setCustomSpecies(finding.species?.replace(/^Possible:\s*/i, "") ?? "");
      return;
    }
    void submitReview(finding.id, action);
  };

  const submitReview = async (
    findingId: number,
    action: ReviewAction,
    species?: string,
  ) => {
    const analysisId = analysis?.id;
    if (!analysisId) return;
    setReviewSaving(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/analysis/${analysisId}/findings/correct`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ findingId, action, technicianSpecies: species }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Failed to save review");
      }
      setReviewResults((prev) => ({ ...prev, [findingId]: action }));
      await queryClient.invalidateQueries();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save review");
    } finally {
      setReviewSaving(false);
    }
  };

  const handleSaveCorrection = () => {
    if (!correctingFinding) return;
    const species = customSpecies.trim();
    if (!species) return;
    const finding = correctingFinding;
    setCorrectingFinding(null);
    setCustomSpecies("");
    void submitReview(finding.id, "correct", species);
  };

  let body: React.ReactNode;
  if (inspectionQ.isLoading) {
    body = <FullScreenLoader />;
  } else if (inspectionQ.error || !inspection) {
    body = (
      <ErrorState
        title="Couldn't load inspection"
        message="Please try again."
        onRetry={() => inspectionQ.refetch()}
      />
    );
  } else {
    body = (
      <ScrollView
        contentContainerStyle={{
          gap: 18,
          paddingVertical: 8,
          paddingBottom: 40,
          width: "100%",
          maxWidth: 760,
          alignSelf: "center",
        }}
      >
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
              {photos.map((m) => {
                const sourceInfo = describeCaptureSource(m.captureSource);
                const lowQ = isLowQuality(m.qualityScore);
                return (
                  <View key={m.id}>
                    <AuthedImage
                      path={m.url}
                      style={{
                        width: 104,
                        height: 104,
                        borderRadius: 10,
                        borderWidth: lowQ ? 2 : 0,
                        borderColor: lowQ ? colors.warning : "transparent",
                      }}
                    />
                    {!sourceInfo.isDefault ? (
                      <View
                        style={{
                          position: "absolute",
                          top: 4,
                          right: 4,
                          backgroundColor: "rgba(0,0,0,0.6)",
                          borderRadius: 6,
                          padding: 3,
                        }}
                      >
                        <Ionicons
                          name={sourceInfo.icon as keyof typeof Ionicons.glyphMap}
                          size={12}
                          color="#fff"
                        />
                      </View>
                    ) : null}
                    {lowQ ? (
                      <View
                        style={{
                          position: "absolute",
                          bottom: 4,
                          left: 4,
                          backgroundColor: colors.warning,
                          borderRadius: 999,
                          padding: 2,
                        }}
                      >
                        <Ionicons name="warning" size={11} color="#fff" />
                      </View>
                    ) : null}
                  </View>
                );
              })}
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

              {analysis.findings?.map((f) => (
                <FindingCard
                  key={f.id}
                  finding={f}
                  onReview={(action) => handleFindingAction(f, action)}
                  savedAction={reviewResults[f.id] ?? null}
                />
              ))}

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

        {/* Measurement devices */}
        <MeasurementDevicePanel />

        {/* Treatments Applied */}
        <TreatmentsAppliedSection
          logs={treatmentLogsQ.data ?? []}
          loading={treatmentLogsQ.isLoading}
          colors={colors}
        />

        {/* Log Treatment — only for active inspections */}
        {(inspection as unknown as Record<string, unknown>).status !== "completed" ? (
          <Button
            title="Log Treatment"
            variant="outline"
            icon="flask-outline"
            onPress={() => setShowTreatmentWizard(true)}
          />
        ) : null}

        {/* Generate report */}
        <Button
          title="Generate report"
          variant={analysis ? "primary" : "outline"}
          icon="document-text-outline"
          loading={genReport.isPending}
          onPress={createReport}
        />

        {/* Reopen inspection — visible only when completed and caller has permission */}
        {canReopen ? (
          <Button
            title="Reopen inspection"
            variant="outline"
            icon="lock-open-outline"
            loading={reopening}
            onPress={handleReopen}
          />
        ) : null}
      </ScrollView>
    );
  }

  return (
    <>
      {embedded ? (
        <View style={{ flex: 1, paddingHorizontal: 16 }}>{body}</View>
      ) : (
        <Screen edges={["top"]} padded>
          <TopBar onBack={() => router.back()} colors={colors} />
          {body}
        </Screen>
      )}

      {/* Treatment log compliance wizard */}
      <TreatmentLogWizard
        visible={showTreatmentWizard}
        onClose={() => setShowTreatmentWizard(false)}
        inspectionId={id}
        pestTypes={
          Array.isArray((inspection as unknown as Record<string, unknown>)?.pestTypes)
            ? ((inspection as unknown as Record<string, unknown>).pestTypes as string[])
            : []
        }
        onLogged={handleTreatmentLogged}
      />

      {/* ── Species correction modal ─────────────────────────────────────────
          Slides up from the bottom when the technician taps "Correct" on a
          finding. Shows AI candidates (tappable) + free-text fallback so
          the technician can always enter the right label even when all
          candidates are wrong.
      */}
      <Modal
        visible={correctingFinding !== null}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setCorrectingFinding(null);
          setCustomSpecies("");
        }}
      >
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}>
          <View
            style={{
              backgroundColor: colors.background,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: 20,
              gap: 14,
            }}
          >
            <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 18 }}>
              Correct Species ID
            </Text>

            {(correctingFinding?.candidates ?? []).length > 0 ? (
              <View style={{ gap: 8 }}>
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 12,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  AI Candidates
                </Text>
                {(correctingFinding?.candidates ?? []).map((c, i) => (
                  <Pressable
                    key={i}
                    onPress={() => setCustomSpecies(c.species)}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: customSpecies === c.species ? colors.primary : colors.border,
                      backgroundColor: customSpecies === c.species ? colors.primary + "11" : colors.card,
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 15 }}>
                      {c.species}
                    </Text>
                    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14 }}>
                      {Math.round(c.confidence * 100)}%
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View style={{ gap: 6 }}>
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Enter correct species
              </Text>
              <TextInput
                value={customSpecies}
                onChangeText={setCustomSpecies}
                placeholder="e.g. German Cockroach"
                placeholderTextColor={colors.mutedForeground}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                  padding: 12,
                  color: colors.foreground,
                  fontFamily: "Inter_400Regular",
                  fontSize: 15,
                  backgroundColor: colors.card,
                }}
                autoCapitalize="words"
                returnKeyType="done"
                onSubmitEditing={handleSaveCorrection}
              />
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <Pressable
                onPress={() => {
                  setCorrectingFinding(null);
                  setCustomSpecies("");
                }}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 10,
                  alignItems: "center",
                  backgroundColor: colors.muted,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={handleSaveCorrection}
                disabled={!customSpecies.trim() || reviewSaving}
                style={{
                  flex: 2,
                  paddingVertical: 12,
                  borderRadius: 10,
                  alignItems: "center",
                  backgroundColor:
                    !customSpecies.trim() || reviewSaving
                      ? colors.primary + "66"
                      : colors.primary,
                }}
              >
                <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
                  {reviewSaving ? "Saving…" : "Save Correction"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
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

/** Convert a site-classification slug to a readable label. */
function siteLabel(slug: string): string {
  const map: Record<string, string> = {
    residential_interior: "Residential — Interior",
    residential_exterior: "Residential — Exterior",
    commercial_interior: "Commercial — Interior",
    commercial_exterior: "Commercial — Exterior",
    food_handling_area: "Food Handling Area",
    structural_void: "Structural Void",
    ornamental: "Ornamental Plants",
    turf_lawn: "Turf / Lawn",
    perimeter: "Building Perimeter",
  };
  return map[slug] ?? slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function TreatmentsAppliedSection({
  logs,
  loading,
  colors,
}: {
  logs: TreatmentLog[];
  loading: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  const [expanded, setExpanded] = useState(true);

  if (loading) {
    return (
      <View style={{ gap: 8 }}>
        <SectionTitle title="Treatments applied" colors={colors} />
        <Card>
          <Text style={{ color: colors.mutedForeground, textAlign: "center", fontFamily: "Inter_400Regular", fontSize: 14 }}>
            Loading…
          </Text>
        </Card>
      </View>
    );
  }

  if (logs.length === 0) return null;

  return (
    <View style={{ gap: 10 }}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
      >
        <SectionTitle title={`Treatments applied (${logs.length})`} colors={colors} />
        <Ionicons
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.mutedForeground}
        />
      </Pressable>

      {expanded &&
        logs.map((log) => {
          const checkedCount = log.checklistItems.filter((i) => i.checked).length;
          const totalCount = log.checklistItems.length;
          const allChecked = totalCount > 0 && checkedCount === totalCount;
          return (
            <Card key={log.id} style={{ gap: 10 }}>
              {/* Product name + pest */}
              <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
                    {log.product?.name ?? `Product #${log.productId}`}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                    {log.targetPest} · {siteLabel(log.siteClassification)}
                  </Text>
                </View>
                <View
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                    borderRadius: 8,
                    backgroundColor: allChecked
                      ? "rgba(63,185,80,0.15)"
                      : "rgba(210,153,34,0.15)",
                    borderWidth: 1,
                    borderColor: allChecked ? "#3fb950" : "#d29922",
                  }}
                >
                  <Text
                    style={{
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 11,
                      color: allChecked ? "#3fb950" : "#d29922",
                    }}
                  >
                    {allChecked ? "✓ Checklist done" : `${checkedCount}/${totalCount} checked`}
                  </Text>
                </View>
              </View>

              {/* Rate + area */}
              {(log.totalProductOz != null || log.areaSqft != null || log.linearFt != null) ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
                  {log.totalProductOz != null ? (
                    <View>
                      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 11 }}>
                        PRODUCT USED
                      </Text>
                      <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                        {log.totalProductOz} fl oz
                      </Text>
                    </View>
                  ) : null}
                  {log.areaSqft != null ? (
                    <View>
                      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 11 }}>
                        AREA COVERED
                      </Text>
                      <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                        {log.areaSqft.toLocaleString()} sq ft
                      </Text>
                    </View>
                  ) : null}
                  {log.linearFt != null ? (
                    <View>
                      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 11 }}>
                        LINEAR FT
                      </Text>
                      <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                        {log.linearFt} ft
                      </Text>
                    </View>
                  ) : null}
                  {log.totalProductOz != null && log.areaSqft != null && log.areaSqft > 0 ? (
                    <View>
                      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 11 }}>
                        RATE
                      </Text>
                      <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                        {((log.totalProductOz / log.areaSqft) * 1000).toFixed(2)} oz/1k sqft
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Notes */}
              {log.notes ? (
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, fontStyle: "italic" }}>
                  {log.notes}
                </Text>
              ) : null}

              {/* Timestamp */}
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                Applied {new Date(log.appliedAt).toLocaleString()}
              </Text>
            </Card>
          );
        })}
    </View>
  );
}
