import { Ionicons } from "@expo/vector-icons";
import { getListReportsQueryOptions } from "@/lib/api-client";
import type { Report } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";

import { ReportDetail } from "@/components/ReportDetail";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FullScreenLoader } from "@/components/ui/Loader";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import { useWindowSizeClass } from "@/hooks/useWindowSizeClass";
import { formatDate, formatStatus, severityTone, statusTone } from "@/constants/inspection";
import { filterIntent } from "@/lib/filterIntent";

// ─── Filter helpers ────────────────────────────────────────────────────────────

type ReportFilter =
  | "all"
  | "7d"
  | "30d"
  | "high_risk"
  | "quality"
  | "low_quality"
  | "pending_approvals"
  | "approved"
  | "opportunities"
  | "proposal_sent"
  | "stale";

const FILTER_LABELS: Record<ReportFilter, string> = {
  all:               "All reports",
  "7d":              "Completed — last 7 days",
  "30d":             "Completed — last 30 days",
  high_risk:         "High & critical risk",
  quality:           "Quality review",
  low_quality:       "Low quality (below 60)",
  pending_approvals: "Pending approval",
  approved:          "Approved",
  opportunities:     "Open opportunities",
  proposal_sent:     "Proposals sent",
  stale:             "Stale pipeline",
};

const MS_7D  = 7  * 24 * 60 * 60 * 1000;
const MS_30D = 30 * 24 * 60 * 60 * 1000;

function applyFilter(reports: Report[], filter: ReportFilter): Report[] {
  const now = Date.now();
  switch (filter) {
    case "7d":
      return reports.filter((r) => now - new Date(r.createdAt).getTime() <= MS_7D);
    case "30d":
      return reports.filter((r) => now - new Date(r.createdAt).getTime() <= MS_30D);
    case "high_risk":
      return reports.filter((r) => r.severity === "high" || r.severity === "critical");
    case "low_quality":
      return reports.filter((r) => r.severity === "critical" || r.severity === "high");
    case "pending_approvals":
      return reports.filter((r) => r.status === "pending" || r.status === "draft");
    case "approved":
      return reports.filter((r) => r.status === "approved" || r.status === "complete");
    case "proposal_sent":
      return reports.filter((r) => r.status === "sent" || r.status === "proposal_sent");
    // Informational — show all with a context banner
    case "quality":
    case "opportunities":
    case "stale":
    default:
      return reports;
  }
}

const INFORMATIONAL_FILTERS: ReportFilter[] = ["quality", "opportunities", "stale"];

const INFORMATIONAL_MESSAGES: Partial<Record<ReportFilter, string>> = {
  quality:       "Showing all reports — detailed quality scores appear in inspection scorecards.",
  opportunities: "Showing all reports — open opportunities are linked to their source inspection.",
  stale:         "Showing all reports — stale pipeline items appear in the Leads tab.",
};

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ReportsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { sizeClass, isExpanded } = useWindowSizeClass();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState<ReportFilter>("all");

  /**
   * useFocusEffect fires every time this tab comes into view — whether it was
   * already mounted or freshly created. We consume the pending intent here so
   * every dashboard deep-link lands on its mapped filter, including when the
   * user has previously visited the Reports tab.
   */
  useFocusEffect(
    useCallback(() => {
      const f = filterIntent.consume("reports");
      if (f) setActiveFilter(f as ReportFilter);
    }, []),
  );

  const { data, isLoading, isRefetching, refetch } = useQuery(getListReportsQueryOptions());

  const numColumns = sizeClass === "medium" ? 2 : 1;

  const openItem = (item: Report) => {
    if (isExpanded) setSelectedId(item.id);
    else router.push(`/report/${item.id}` as Href);
  };

  const filtered = data ? applyFilter(data, activeFilter) : [];
  const isFiltered = activeFilter !== "all";
  const isInformational = INFORMATIONAL_FILTERS.includes(activeFilter);

  const renderItem = ({ item }: { item: Report }) => (
    <Card
      onPress={() => openItem(item)}
      style={[
        { gap: 10 },
        numColumns > 1 && { flex: 1 },
        isExpanded && selectedId === item.id && { borderColor: colors.primary },
      ]}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Text
          numberOfLines={2}
          style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 16, flex: 1 }}
        >
          {item.title}
        </Text>
        <Badge label={formatStatus(item.status)} tone={statusTone(item.status)} />
      </View>
      {item.siteAddress ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="location-outline" size={14} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
            {item.siteAddress}
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {item.aiNarrative ? <Badge label="AI narrative" tone="primary" /> : null}
        {item.severity ? (
          <Badge label={formatStatus(item.severity)} tone={severityTone(item.severity)} />
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="calendar-outline" size={14} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
            {formatDate(item.createdAt)}
          </Text>
        </View>
      </View>
    </Card>
  );

  const listPane = (
    <View style={{ flex: 1 }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 }}>
        <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 24 }}>
          Reports
        </Text>
      </View>

      {/* Active filter banner — shows what filter is live and lets the user dismiss it */}
      {isFiltered ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginHorizontal: 16,
            marginBottom: 10,
            paddingHorizontal: 12,
            paddingVertical: 9,
            borderRadius: 10,
            backgroundColor: isInformational
              ? (colors.warning ?? "#d97706") + "18"
              : colors.primary + "18",
            borderWidth: 1,
            borderColor: isInformational
              ? (colors.warning ?? "#d97706") + "40"
              : colors.primary + "40",
            gap: 8,
          }}
        >
          <Ionicons
            name={isInformational ? "information-circle-outline" : "filter-outline"}
            size={15}
            color={isInformational ? (colors.warning ?? "#d97706") : colors.primary}
          />
          <Text style={{ flex: 1, color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
            {isInformational && INFORMATIONAL_MESSAGES[activeFilter]
              ? INFORMATIONAL_MESSAGES[activeFilter]
              : `Filtering: ${FILTER_LABELS[activeFilter] ?? activeFilter}`}
          </Text>
          <Pressable onPress={() => setActiveFilter("all")} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
          </Pressable>
        </View>
      ) : null}

      {isLoading ? (
        <FullScreenLoader />
      ) : (
        <FlatList
          key={`cols-${numColumns}-${activeFilter}`}
          data={filtered}
          keyExtractor={(i) => String(i.id)}
          renderItem={renderItem}
          numColumns={numColumns}
          columnWrapperStyle={numColumns > 1 ? { gap: 12 } : undefined}
          contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 12, flexGrow: 1 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="document-text-outline"
              title={isFiltered ? "No matching reports" : "No reports yet"}
              subtitle={
                isFiltered
                  ? `No reports match "${FILTER_LABELS[activeFilter] ?? activeFilter}". Tap × above to clear.`
                  : "Complete an inspection and generate a report to see it here."
              }
            />
          }
        />
      )}
    </View>
  );

  if (isExpanded) {
    return (
      <Screen>
        <View style={{ flex: 1, flexDirection: "row" }}>
          <View style={{ width: 400, borderRightWidth: 1, borderRightColor: colors.border }}>
            {listPane}
          </View>
          <View style={{ flex: 1 }}>
            {selectedId != null ? (
              <ReportDetail key={selectedId} id={selectedId} embedded />
            ) : (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }}>
                <Ionicons name="document-text-outline" size={40} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 15 }}>
                  Select a report to view details
                </Text>
              </View>
            )}
          </View>
        </View>
      </Screen>
    );
  }

  return <Screen>{listPane}</Screen>;
}
