import { Ionicons } from "@expo/vector-icons";
import {
  getGetReportQueryOptions,
  useGenerateReportNarrative,
} from "@/lib/api-client";
import type { AiReportNarrative } from "@/lib/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useAuth } from "@clerk/expo";

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
      await genNarrative.mutateAsync({ id });
      await queryClient.invalidateQueries();
      reportQ.refetch();
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

          {entries.map((entry) => (
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
          ))}
        </View>
      )}
    </View>
  );
}
