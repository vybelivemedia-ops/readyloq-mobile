import { Ionicons } from "@expo/vector-icons";
import {
  getGetReportQueryOptions,
  useGenerateReportNarrative,
} from "@/lib/api-client";
import type { AiReportNarrative, Report } from "@/lib/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, TouchableOpacity, View } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useAuth } from "@clerk/expo";

import { AuthedImage } from "@/components/AuthedImage";
import { FindingCard } from "@/components/FindingCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/ErrorState";
import { FullScreenLoader } from "@/components/ui/Loader";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatDate, formatStatus, severityTone, statusTone } from "@/constants/inspection";
import {
  ApiError,
  fetchIntegrationConfig,
  fetchSyncHistory,
  fetchSyncHistoryCsv,
  triggerIntegrationSync,
  type FieldIntegrationSystem,
  type IntegrationConfigResponse,
  type SyncHistoryEntry,
} from "@/lib/api";

interface ReportDetailProps {
  id: number;
  /** Rendered inside a split-view pane: no Screen wrapper, no back button. */
  embedded?: boolean;
}

const FINALIZED_STATUSES = new Set(["complete", "completed"]);

const SYSTEM_LABEL: Record<FieldIntegrationSystem, string> = {
  pestpac: "PestPac",
  fieldroutes: "FieldRoutes",
};

function normalizeReportImagePath(imageUrl: string): string {
  return imageUrl.startsWith("/objects/") ? `/api/storage${imageUrl}` : imageUrl;
}

function splitExclusionOpportunity(opportunity: string) {
  const separator = opportunity.indexOf(":");
  if (separator <= 0) {
    return { type: "Exclusion opportunity", description: opportunity };
  }

  return {
    type: opportunity.slice(0, separator).trim() || "Exclusion opportunity",
    description: opportunity.slice(separator + 1).trim() || opportunity,
  };
}

export function ReportDetail({ id, embedded = false }: ReportDetailProps) {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { getToken } = useAuth();
  const { user } = useCurrentUser();
  const isOwner = user?.effectiveRole === "owner";

  const reportQ = useQuery(getGetReportQueryOptions(id));
  const genNarrative = useGenerateReportNarrative();
  const [error, setError] = useState<string | null>(null);

  // ── Field-service integration sync ─────────────────────────────────────────
  const [integrationConfig, setIntegrationConfig] = useState<IntegrationConfigResponse | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [syncHistory, setSyncHistory] = useState<SyncHistoryEntry[]>([]);

  const report = reportQ.data;
  const isFinalized = report ? FINALIZED_STATUSES.has(report.status) : false;

  const loadSyncHistory = React.useCallback(
    async (token: string | null, inspectionId: number) => {
      try {
        const data = await fetchSyncHistory(token, inspectionId);
        setSyncHistory(data.logs);
      } catch {
        // non-blocking — history simply won't show
      }
    },
    [],
  );

  useEffect(() => {
    if (!isOwner || !isFinalized || !report?.inspectionId) return;
    let cancelled = false;
    getToken().then(async (token: string | null) => {
      if (cancelled) return;
      const [config] = await Promise.all([
        fetchIntegrationConfig(token),
        loadSyncHistory(token, report.inspectionId),
      ]);
      if (!cancelled) setIntegrationConfig(config);
    }).catch(() => { /* non-blocking */ });
    return () => { cancelled = true; };
  }, [isOwner, isFinalized, report?.inspectionId, getToken, loadSyncHistory]);

  const handleExportCsv = async () => {
    if (!report?.inspectionId || isExporting) return;
    setIsExporting(true);
    try {
      const token = await getToken();
      // Server returns the complete, unbounded history as CSV with
      // formula-injection protection applied server-side.
      const csv = await fetchSyncHistoryCsv(token, report.inspectionId);

      if (!csv || csv.trim().split("\n").length <= 1) {
        Alert.alert("No sync history", "There are no sync attempts to export yet.");
        return;
      }

      const filename = `sync-log-inspection-${report.inspectionId}.csv`;
      const fileUri = `${FileSystem.cacheDirectory}${filename}`;

      await FileSystem.writeAsStringAsync(fileUri, csv, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert("Sharing unavailable", "Your device does not support file sharing.");
        return;
      }

      await Sharing.shareAsync(fileUri, {
        mimeType: "text/csv",
        dialogTitle: "Export sync log",
        UTI: "public.comma-separated-values-text",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      Alert.alert("Export failed", `Could not export sync log. ${msg}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleSync = async () => {
    if (!report?.inspectionId || isSyncing) return;
    setIsSyncing(true);
    try {
      const token = await getToken();
      const result = await triggerIntegrationSync(token, report.inspectionId);
      // Refresh history to show the new successful sync timestamp.
      await loadSyncHistory(token, report.inspectionId);
      Alert.alert(
        "Pushed to dispatch",
        result.attachmentsPosted > 0
          ? `Report and ${result.attachmentsPosted} photo${result.attachmentsPosted !== 1 ? "s" : ""} sent successfully.`
          : "Inspection report and conditions were successfully sent.",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      // Refresh history in case the failure was logged server-side.
      getToken()
        .then((token) => loadSyncHistory(token, report.inspectionId))
        .catch(() => {});
      Alert.alert("Sync failed", `Could not push to dispatch software. ${msg}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const generate = async () => {
    setError(null);
    try {
      await genNarrative.mutateAsync({ id, data: { refreshFindings: true } });
      await queryClient.invalidateQueries({ queryKey: getGetReportQueryOptions(id).queryKey });
      await reportQ.refetch();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    }
  };

  let body: React.ReactNode;
  if (reportQ.isLoading) {
    body = <FullScreenLoader />;
  } else if (reportQ.error || !report) {
    body = (
      <ErrorState title="Couldn't load report" message="Please try again." onRetry={() => reportQ.refetch()} />
    );
  } else {
    const narrative = report.aiNarrative ?? undefined;
    const needsEvidenceRedo = report.evidenceRecovery?.needsRegeneration === true;
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

        {/* ── Owner & Management Summary ──────────────────────────────────────
            Shown whenever there is pipeline value or identified exclusion
            opportunities so owners and managers can immediately see the
            financial context of this inspection without reading through all
            findings first. */}
        {((report as Report & { pipelineValue?: number }).pipelineValue ?? 0) > 0 ||
        (report.exclusionOpportunities?.length ?? 0) > 0 ? (
          <OwnerManagementSummary report={report} colors={colors} />
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
                {needsEvidenceRedo
                  ? `${report.evidenceRecovery?.syncedPhotoCount ?? 0} synced photo${report.evidenceRecovery?.syncedPhotoCount === 1 ? "" : "s"} are now ready. Redo the report so FAIE can include the recovered evidence.`
                  : "Generate a professional, structured narrative from this report's findings and evidence."}
              </Text>
              <Button
                title={needsEvidenceRedo ? "Redo report with synced photos" : "Generate AI narrative"}
                icon={needsEvidenceRedo ? "refresh" : "sparkles"}
                loading={genNarrative.isPending}
                onPress={generate}
              />
            </Card>
          )}

          {narrative && needsEvidenceRedo ? (
            <View testID="report-evidence-recovery">
              <Card style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="cloud-done-outline" size={18} color={colors.primary} />
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15, flex: 1 }}>
                    Synced evidence is ready
                  </Text>
                </View>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 }}>
                  Photos or findings finished syncing after this report was generated. Redo it to include the latest evidence.
                </Text>
                <Button
                  title="Redo report with synced photos"
                  icon="refresh"
                  loading={genNarrative.isPending}
                  onPress={generate}
                />
              </Card>
            </View>
          ) : null}

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
            <Text selectable style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 }}>
              {report.treatmentNotes}
            </Text>
          </Card>
        ) : null}

        {/* Field-service integration sync — owner-only, finalized inspections */}
        {isOwner && isFinalized && integrationConfig?.configured ? (
          <Card style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Ionicons name="cloud-upload-outline" size={18} color={colors.primary} />
              <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
                Field-service integration
              </Text>
            </View>
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
              Push this inspection report, findings, and photos to{" "}
              {SYSTEM_LABEL[integrationConfig.integration.systemType]}.
            </Text>

            {/* Last sync status */}
            <SyncHistoryBadge history={syncHistory} colors={colors} />

            <Button
              title={`Sync to ${SYSTEM_LABEL[integrationConfig.integration.systemType]}`}
              icon="cloud-upload-outline"
              loading={isSyncing}
              onPress={handleSync}
            />
            {syncHistory.length > 0 && (
              <Button
                title="Export sync log as CSV"
                variant="ghost"
                icon="download-outline"
                loading={isExporting}
                onPress={handleExportCsv}
              />
            )}
          </Card>
        ) : null}
      </ScrollView>
    );
  }

  if (embedded) {
    return <View style={{ flex: 1, paddingHorizontal: 16 }}>{body}</View>;
  }

  return (
    <Screen edges={["top"]} padded>
      <TopBar onBack={() => router.back()} colors={colors} />
      {body}
    </Screen>
  );
}

// ─── Owner & Management Summary ───────────────────────────────────────────────

/** Format a dollar amount as $950, $4K, or $1.2M. */
function fmtMoney(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toLocaleString()}`;
}

/**
 * Prominent financial + risk summary for owners and management.
 * Rendered above the AI narrative so the key business data is visible
 * without scrolling through the full technical findings.
 */
function OwnerManagementSummary({
  report,
  colors,
}: {
  report: Report & { pipelineValue?: number };
  colors: ReturnType<typeof useColors>;
}) {
  const pipelineValue = report.pipelineValue ?? 0;
  const opportunities = report.exclusionOpportunities ?? [];
  const [selectedImage, setSelectedImage] = useState<{ path: string; label: string } | null>(null);
  const exclusionFindings = (report.findings ?? []).filter(
    (finding) => finding.exclusionOpportunity === true,
  );
  const sevColor =
    report.severity === "critical"
      ? "#F85149"
      : report.severity === "high"
        ? "#E3882A"
        : report.severity === "medium"
          ? "#D29922"
          : report.severity === "low"
            ? "#3FB950"
            : null;

  return (
    <View
      style={{
        backgroundColor: "#0D1117",
        borderWidth: 1,
        borderColor: "#30363D",
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      {/* Header band */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 16,
          paddingVertical: 12,
          backgroundColor: "#161B22",
          borderBottomWidth: 1,
          borderBottomColor: "#30363D",
        }}
      >
        <Ionicons name="briefcase-outline" size={16} color="#17C4D3" />
        <Text style={{ color: "#E6EDF3", fontFamily: "Inter_700Bold", fontSize: 14, flex: 1 }}>
          Owner &amp; Management Summary
        </Text>
        {sevColor ? (
          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 3,
              borderRadius: 999,
              backgroundColor: sevColor + "20",
              borderWidth: 1,
              borderColor: sevColor + "55",
            }}
          >
            <Text style={{ color: sevColor, fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 0.5 }}>
              {report.severity?.toUpperCase()} RISK
            </Text>
          </View>
        ) : null}
      </View>

      {/* KPI row */}
      <View style={{ flexDirection: "row", padding: 16, gap: 12 }}>
        {/* Pipeline value */}
        {pipelineValue > 0 ? (
          <View
            style={{
              flex: 1,
              gap: 4,
              padding: 12,
              borderRadius: 10,
              backgroundColor: "#3FB95014",
              borderWidth: 1,
              borderColor: "#3FB95040",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Ionicons name="trending-up-outline" size={12} color="#3FB950" />
              <Text style={{ color: "#8B949E", fontFamily: "Inter_600SemiBold", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Pipeline value
              </Text>
            </View>
            <Text style={{ color: "#3FB950", fontFamily: "Inter_800ExtraBold", fontSize: 22, lineHeight: 26 }}>
              {fmtMoney(pipelineValue)}
            </Text>
            <Text style={{ color: "#8B949E", fontFamily: "Inter_400Regular", fontSize: 11 }}>
              Est. annual contract
            </Text>
          </View>
        ) : null}

        {/* Exclusion opportunities count */}
        {opportunities.length > 0 ? (
          <View
            style={{
              flex: 1,
              gap: 4,
              padding: 12,
              borderRadius: 10,
              backgroundColor: "#17C4D314",
              borderWidth: 1,
              borderColor: "#17C4D340",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <Ionicons name="lock-closed-outline" size={12} color="#17C4D3" />
              <Text style={{ color: "#8B949E", fontFamily: "Inter_600SemiBold", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Opportunities
              </Text>
            </View>
            <Text style={{ color: "#17C4D3", fontFamily: "Inter_800ExtraBold", fontSize: 22, lineHeight: 26 }}>
              {opportunities.length}
            </Text>
            <Text style={{ color: "#8B949E", fontFamily: "Inter_400Regular", fontSize: 11 }}>
              Exclusion site{opportunities.length === 1 ? "" : "s"} identified
            </Text>
          </View>
        ) : null}
      </View>

      {/* Opportunity list */}
      {opportunities.length > 0 ? (
        <View
          style={{
            paddingHorizontal: 16,
            paddingBottom: 16,
            gap: 8,
          }}
        >
          <Text style={{ color: "#8B949E", fontFamily: "Inter_600SemiBold", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
            Identified exclusion opportunities
          </Text>
          {opportunities.map((opportunity, index) => {
            const opportunityDetails = splitExclusionOpportunity(opportunity);
            const finding =
              exclusionFindings.find(
                (candidate) =>
                  `${candidate.category}: ${candidate.description}` === opportunity,
              ) ?? exclusionFindings[index];
            const type = finding?.category ?? opportunityDetails.type;
            const description = finding?.description ?? opportunityDetails.description;
            const imagePath = finding?.imageUrl
              ? normalizeReportImagePath(finding.imageUrl)
              : null;

            return (
              <View
                key={finding?.id ?? `${opportunity}-${index}`}
                style={{
                  flexDirection: "row",
                  gap: 10,
                  padding: 10,
                  borderRadius: 8,
                  backgroundColor: "#161B22",
                  borderWidth: 1,
                  borderColor: "#30363D",
                }}
              >
                {imagePath ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`View evidence photo for ${type}`}
                    activeOpacity={0.82}
                    onPress={() => setSelectedImage({ path: imagePath, label: type })}
                  >
                    <AuthedImage
                      path={imagePath}
                      style={{ width: 64, height: 64, borderRadius: 6 }}
                      contentFit="cover"
                    />
                  </TouchableOpacity>
                ) : (
                  <View
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 6,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: "#21262D",
                    }}
                  >
                    <Ionicons name="image-outline" size={20} color="#8B949E" />
                  </View>
                )}

                <View style={{ flex: 1, gap: 5 }}>
                  <View
                    style={{
                      alignSelf: "flex-start",
                      paddingHorizontal: 7,
                      paddingVertical: 2,
                      borderRadius: 999,
                      backgroundColor: "#17C4D320",
                    }}
                  >
                    <Text
                      style={{
                        color: "#17C4D3",
                        fontFamily: "Inter_700Bold",
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                      }}
                    >
                      {type}
                    </Text>
                  </View>
                  <Text
                    style={{
                      color: "#E6EDF3",
                      fontFamily: "Inter_400Regular",
                      fontSize: 13,
                      lineHeight: 19,
                    }}
                  >
                    {description}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {/* No-pipeline notice for when the section shows based on opportunities only */}
      {pipelineValue === 0 && opportunities.length > 0 ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <Text style={{ color: "#8B949E", fontFamily: "Inter_400Regular", fontSize: 12 }}>
            Pipeline value will appear once an exclusion opportunity is priced by the system.
          </Text>
        </View>
      ) : null}

      <Modal
        visible={selectedImage !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedImage(null)}
      >
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            backgroundColor: "rgba(0, 0, 0, 0.92)",
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close enlarged evidence photo"
            onPress={() => setSelectedImage(null)}
            style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
          />
          {selectedImage ? (
            <View style={{ width: "100%", height: "82%", alignItems: "center", justifyContent: "center" }}>
              <AuthedImage
                path={selectedImage.path}
                style={{ width: "100%", height: "100%", borderRadius: 10 }}
                contentFit="contain"
              />
              <Text
                style={{
                  color: "#E6EDF3",
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 14,
                  marginTop: 12,
                }}
              >
                {selectedImage.label}
              </Text>
              <Text
                style={{
                  color: "#8B949E",
                  fontFamily: "Inter_400Regular",
                  fontSize: 12,
                  marginTop: 4,
                }}
              >
                Tap outside the image to close
              </Text>
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
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
    { title: "Conducive conditions", body: narrative.conduciveConditions },
    { title: "Sanitation concerns", body: narrative.sanitationConcerns },
    { title: "Recommended corrective actions", list: narrative.recommendedCorrectiveActions },
    { title: "Customer recommendations", list: narrative.customerRecommendations },
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
              <Text selectable style={{ color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21 }}>
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
      <Text selectable style={{ color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21, flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

function SyncHistoryBadge({
  history,
  colors,
}: {
  history: SyncHistoryEntry[];
  colors: ReturnType<typeof useColors>;
}) {
  const [expanded, setExpanded] = useState(false);

  // Always derive status from the newest entry (API returns newest-first).
  const latest = history[0];
  if (!latest) return null;

  // Show all entries returned by the API (up to the server-side limit of 100).
  const entries = history;

  const summaryIcon = latest.success
    ? <Ionicons name="checkmark-circle" size={15} color="#22c55e" />
    : <Ionicons name="alert-circle-outline" size={15} color={colors.destructive} style={{ marginTop: 1 }} />;

  const summaryText = latest.success
    ? `Last synced ${formatDate(latest.syncedAt)}`
    : `Last sync failed · ${formatDate(latest.syncedAt)}`;

  const summaryColor = latest.success ? colors.mutedForeground : colors.destructive;

  const latestNoteRetries = (latest.resultJson?.noteRetries ?? 0) as number;
  const latestAttachRetries = (latest.resultJson?.attachmentRetries ?? 0) as number;
  const latestTotalRetries = latestNoteRetries + latestAttachRetries;

  // Only expandable when there are multiple entries to show.
  const isExpandable = entries.length > 1;

  return (
    <View style={{ gap: 6 }}>
      {/* Summary row — always visible; tappable only when there's more history to reveal */}
      <Pressable
        onPress={isExpandable ? () => setExpanded((v) => !v) : undefined}
        style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
        accessibilityRole={isExpandable ? "button" : "text"}
        accessibilityLabel={
          isExpandable
            ? expanded
              ? "Collapse sync history"
              : "Expand sync history"
            : summaryText
        }
      >
        {summaryIcon}
        <Text style={{ color: summaryColor, fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 }}>
          {summaryText}
        </Text>
        {latestTotalRetries > 0 && (
          <View
            style={{
              backgroundColor: "#fef3c7",
              borderRadius: 10,
              paddingHorizontal: 6,
              paddingVertical: 2,
            }}
          >
            <Text style={{ color: "#92400e", fontFamily: "Inter_600SemiBold", fontSize: 11 }}>
              {latestTotalRetries === 1 ? "1 retry" : `${latestTotalRetries} retries`}
            </Text>
          </View>
        )}
        {isExpandable && (
          <Ionicons
            name={expanded ? "chevron-up" : "chevron-down"}
            size={14}
            color={colors.mutedForeground}
          />
        )}
      </Pressable>

      {/* Always show the error detail for the latest failed entry */}
      {!latest.success && latest.errorMessage ? (
        <Text
          style={{
            color: colors.destructive,
            fontFamily: "Inter_400Regular",
            fontSize: 12,
            lineHeight: 16,
            marginLeft: 21, // align under the text, past the icon + gap
          }}
        >
          {latest.errorMessage}
        </Text>
      ) : null}

      {/* Collapsible history list — only shown when multiple entries exist */}
      {expanded && isExpandable && (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: colors.border,
            paddingTop: 8,
            gap: 6,
          }}
        >
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_600SemiBold",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 2,
            }}
          >
            Sync history ({entries.length} {entries.length === 1 ? "attempt" : "attempts"})
          </Text>

          {entries.map((entry) => {
            const entryNoteRetries = (entry.resultJson?.noteRetries ?? 0) as number;
            const entryAttachRetries = (entry.resultJson?.attachmentRetries ?? 0) as number;
            const entryTotalRetries = entryNoteRetries + entryAttachRetries;
            return (
              <View
                key={entry.id}
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: 8,
                  paddingVertical: 4,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                <Ionicons
                  name={entry.success ? "checkmark-circle" : "close-circle"}
                  size={14}
                  color={entry.success ? "#22c55e" : colors.destructive}
                  style={{ marginTop: 1 }}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontFamily: "Inter_400Regular",
                        fontSize: 12,
                      }}
                    >
                      {formatDate(entry.syncedAt)}
                      {" · "}
                      <Text
                        style={{
                          color: entry.success ? "#22c55e" : colors.destructive,
                          fontFamily: "Inter_600SemiBold",
                        }}
                      >
                        {entry.success ? "Success" : "Failed"}
                      </Text>
                    </Text>
                    {entryTotalRetries > 0 && (
                      <View
                        style={{
                          backgroundColor: "#fef3c7",
                          borderRadius: 8,
                          paddingHorizontal: 5,
                          paddingVertical: 1,
                        }}
                      >
                        <Text style={{ color: "#92400e", fontFamily: "Inter_600SemiBold", fontSize: 10 }}>
                          {entryTotalRetries === 1 ? "1 retry" : `${entryTotalRetries} retries`}
                        </Text>
                      </View>
                    )}
                  </View>
                  {!entry.success && entry.errorMessage ? (
                    <Text
                      style={{
                        color: colors.destructive,
                        fontFamily: "Inter_400Regular",
                        fontSize: 11,
                        lineHeight: 15,
                      }}
                    >
                      {entry.errorMessage}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
