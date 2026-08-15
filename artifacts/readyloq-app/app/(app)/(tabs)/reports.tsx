import { Ionicons } from "@expo/vector-icons";
import type { Report } from "@/lib/api-client";
import { fetchReportsQueryOptions } from "@/lib/api-client/reports";
import type { ReportQueryParams } from "@/lib/api-client/reports";
import { useQuery } from "@tanstack/react-query";
import { type Href, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";

import { FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";

import { ReportDetail } from "@/components/ReportDetail";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FullScreenLoader } from "@/components/ui/Loader";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import { useLocalInspections } from "@/hooks/useLocalInspections";
import { useWindowSizeClass } from "@/hooks/useWindowSizeClass";
import { formatDate, formatStatus, severityTone, statusTone } from "@/constants/inspection";
import { filterIntent } from "@/lib/filterIntent";
import type { LocalInspection } from "@/lib/local/inspection-store";

// ─── Filter helpers ────────────────────────────────────────────────────────────

type ReportFilter =
  | "all"
  | "7d"
  | "30d"
  | "high_risk"
  | "critical_risk"
  | "quality"
  | "low_quality"
  | "pending_approvals"
  | "approved"
  | "opportunities"
  | "proposal_sent"
  | "stale";

type ReportTimeframe = "all" | "7d" | "30d";

const FILTER_LABELS: Record<ReportFilter, string> = {
  all:               "All reports",
  "7d":              "Completed — last 7 days",
  "30d":             "Completed — last 30 days",
  high_risk:         "High & critical risk",
  critical_risk:     "Critical risk",
  quality:           "Quality review",
  low_quality:       "Low quality (below 60)",
  pending_approvals: "Pending approval",
  approved:          "Approved",
  opportunities:     "Open opportunities",
  proposal_sent:     "Proposals sent",
  stale:             "Stale pipeline",
};

/**
 * Translate UI filter state → server query params.
 * The API applies these in the DB query so we never over-fetch.
 * Informational filters ("quality", "opportunities", "stale") intentionally
 * return {} so the server sends everything and we just show a context banner.
 */
function filterToParams(filter: ReportFilter, timeframe: ReportTimeframe): ReportQueryParams {
  const params: ReportQueryParams = {};

  // Timeframe overlay (applies on top of any filter)
  if (timeframe === "7d")  params.sinceDays = 7;
  if (timeframe === "30d") params.sinceDays = 30;

  switch (filter) {
    case "7d":             params.sinceDays = 7;                              break;
    case "30d":            params.sinceDays = 30;                             break;
    case "high_risk":      params.severity  = ["high", "critical"];           break;
    case "critical_risk":  params.severity  = ["critical"];                   break;
    case "low_quality":    params.severity  = ["critical", "high"];           break;
    case "pending_approvals": params.status = ["pending", "draft"];           break;
    case "approved":       params.status    = ["approved", "complete"];       break;
    case "proposal_sent":  params.status    = ["sent", "proposal_sent"];      break;
    case "opportunities": params.opportunities = true;                        break;
    // Informational — fetch all, show banner only
    default: break;
  }

  return params;
}

const INFORMATIONAL_FILTERS: ReportFilter[] = ["quality", "opportunities", "stale"];

// Chips shown in the scrollable filter row — informational-only filters are
// intentionally excluded because they don't actually narrow the list.
const FILTER_CHIPS: { filter: ReportFilter; label: string }[] = [
  { filter: "all",               label: "All" },
  { filter: "pending_approvals", label: "Pending approval" },
  { filter: "critical_risk",     label: "Critical risk" },
  { filter: "high_risk",         label: "High risk" },
  { filter: "approved",          label: "Approved" },
  { filter: "7d",                label: "Last 7 days" },
  { filter: "30d",               label: "Last 30 days" },
];

const INFORMATIONAL_MESSAGES: Partial<Record<ReportFilter, string>> = {
  quality:       "Showing all reports — detailed quality scores appear in inspection scorecards.",
  opportunities: "Showing all reports — open opportunities are linked to their source inspection.",
  stale:         "Showing all reports — stale pipeline items appear in the Leads tab.",
};

// ─── Saved Reports section ────────────────────────────────────────────────────

/**
 * Lists completed local inspections so technicians and managers can generate
 * and deliver a PDF report at any time — not just immediately after finishing.
 * Tapping "Deliver report" opens the inspection-summary screen which has the
 * full suite of delivery options (print, share, email).
 */
function SavedReportsSection() {
  const colors = useColors();
  const router = useRouter();
  const { records } = useLocalInspections();

  const completed = useMemo(
    () =>
      records
        .filter((r) => r.completed && r.completedAt)
        .sort(
          (a, b) =>
            new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime(),
        ),
    [records],
  );

  if (completed.length === 0) return null;

  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 8, gap: 10 }}>
      {/* Section label */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
        <Ionicons name="phone-portrait-outline" size={15} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
          Saved on this device
        </Text>
      </View>

      {completed.map((rec) => (
        <SavedReportCard
          key={rec.localId}
          record={rec}
          onDeliver={() => router.push(`/inspection-summary/${rec.localId}` as Href)}
        />
      ))}

      {/* Divider before server reports */}
      <View style={{ height: 1, backgroundColor: colors.border, marginTop: 4 }} />
      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
        All reports
      </Text>
    </View>
  );
}

function SavedReportCard({
  record,
  onDeliver,
}: {
  record: LocalInspection;
  onDeliver: () => void;
}) {
  const colors = useColors();

  const date = record.completedAt
    ? new Date(record.completedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const syncedLabel = record.serverCompleted ? "Synced" : record.serverId ? "Syncing" : "On device";
  const syncedTone: "success" | "warning" | "default" = record.serverCompleted
    ? "success"
    : record.serverId
    ? "warning"
    : "default";

  const deliveredLabel = record.lastDeliveredAt
    ? `Sent ${new Date(record.lastDeliveredAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })}`
    : null;

  return (
    <Card style={{ gap: 8 }}>
      {/* Address + sync badge */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <Text
          numberOfLines={1}
          style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15, flex: 1 }}
        >
          {record.siteAddress || "Untitled inspection"}
        </Text>
        <Badge label={syncedLabel} tone={syncedTone} />
      </View>

      {/* Meta row */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        {record.clientName ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Ionicons name="person-outline" size={13} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
              {record.clientName}
            </Text>
          </View>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="camera-outline" size={13} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
            {record.photos.length} photo{record.photos.length !== 1 ? "s" : ""}
          </Text>
        </View>
        {date ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Ionicons name="calendar-outline" size={13} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
              {date}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Last delivered badge */}
      {deliveredLabel ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="checkmark-circle" size={13} color={colors.success ?? "#22c55e"} />
          <Text style={{ color: colors.success ?? "#22c55e", fontFamily: "Inter_500Medium", fontSize: 12 }}>
            {deliveredLabel}
          </Text>
        </View>
      ) : null}

      {/* Deliver button */}
      <Pressable
        onPress={onDeliver}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          paddingVertical: 9,
          borderRadius: 8,
          backgroundColor: pressed ? colors.primary + "cc" : colors.primary,
        })}
      >
        <Ionicons name="paper-plane-outline" size={15} color={colors.primaryForeground} />
        <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
          Deliver report
        </Text>
      </Pressable>
    </Card>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ReportsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { sizeClass, isExpanded } = useWindowSizeClass();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeFilter, setActiveFilter] = useState<ReportFilter>("all");
  const [activeTimeframe, setActiveTimeframe] = useState<ReportTimeframe>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // ── Primary: URL params set by dashboard cards/alerts ──────────────────────
  // useLocalSearchParams updates on every router.push(), even to an already-
  // mounted tab — so this fires reliably regardless of focus state.
  const { filter: filterParam, timeframe: timeframeParam } =
    useLocalSearchParams<{ filter?: string; timeframe?: string }>();

  useEffect(() => {
    if (filterParam) {
      setActiveFilter(filterParam as ReportFilter);
      setActiveTimeframe((timeframeParam as ReportTimeframe) ?? "all");
    }
  }, [filterParam, timeframeParam]);

  // ── Fallback: module-level intent store (backward compat) ───────────────────
  useFocusEffect(
    useCallback(() => {
      const f = filterIntent.consume("reports");
      const p = filterIntent.consumeParams("reports");
      if (f) setActiveFilter(f as ReportFilter);
      if (p?.timeframe) setActiveTimeframe(p.timeframe as ReportTimeframe);
      else if (f) setActiveTimeframe("all");
    }, []),
  );

  // Recompute server params whenever filter/timeframe changes.
  // React Query re-fetches automatically when the query key changes.
  const queryParams = useMemo(
    () => filterToParams(activeFilter, activeTimeframe),
    [activeFilter, activeTimeframe],
  );
  const { data, isLoading, isRefetching, refetch } = useQuery(
    fetchReportsQueryOptions(queryParams),
  );

  const numColumns = sizeClass === "medium" ? 2 : 1;

  const openItem = (item: Report) => {
    if (isExpanded) setSelectedId(item.id);
    else router.push(`/report/${item.id}` as Href);
  };

  // Server already applied filter + timeframe. Apply client-side text search on top.
  const trimmedQuery = searchQuery.trim().toLowerCase();
  const filtered = useMemo(() => {
    const base = data ?? [];
    if (!trimmedQuery) return base;
    return base.filter((r) => {
      const haystack = [
        r.title,
        r.siteAddress,
        (r as Report & { clientName?: string | null }).clientName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(trimmedQuery);
    });
  }, [data, trimmedQuery]);

  const isFiltered = activeFilter !== "all" || activeTimeframe !== "all";
  const isSearching = trimmedQuery.length > 0;
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
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 24 }}>
          Reports
        </Text>
        <Pressable
          onPress={() => router.push("/reports-detail" as Href)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderRadius: 8,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: pressed ? colors.muted : (colors.card ?? colors.background),
          })}
        >
          <Ionicons name="clipboard-outline" size={14} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
            Audit
          </Text>
        </Pressable>
      </View>

      {/* Search bar */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          marginHorizontal: 16,
          marginBottom: 10,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card ?? colors.background,
          gap: 8,
        }}
      >
        <Ionicons name="search-outline" size={16} color={colors.mutedForeground} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search by address or client…"
          placeholderTextColor={colors.mutedForeground}
          style={{
            flex: 1,
            fontFamily: "Inter_400Regular",
            fontSize: 14,
            color: colors.foreground,
            padding: 0,
          }}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
        {searchQuery.length > 0 ? (
          <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

      {/* Scrollable filter chip row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 10, gap: 8 }}
        style={{ flexGrow: 0 }}
      >
        {FILTER_CHIPS.map(({ filter, label }) => {
          const isActive = activeFilter === filter;
          return (
            <Pressable
              key={filter}
              onPress={() => {
                setActiveFilter(filter);
                // Time chips stand alone — clear any separate timeframe state
                if (filter === "7d" || filter === "30d" || filter === "all") {
                  setActiveTimeframe("all");
                }
              }}
              style={({ pressed }) => ({
                paddingHorizontal: 14,
                paddingVertical: 7,
                borderRadius: 20,
                borderWidth: 1,
                borderColor: isActive ? colors.primary : colors.border,
                backgroundColor: isActive
                  ? colors.primary
                  : pressed
                  ? colors.muted
                  : colors.card ?? colors.background,
              })}
            >
              <Text
                style={{
                  fontFamily: isActive ? "Inter_600SemiBold" : "Inter_400Regular",
                  fontSize: 13,
                  color: isActive ? colors.primaryForeground : colors.foreground,
                }}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

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
          key={`cols-${numColumns}-${activeFilter}-${trimmedQuery}`}
          data={filtered}
          keyExtractor={(i) => String(i.id)}
          renderItem={renderItem}
          numColumns={numColumns}
          columnWrapperStyle={numColumns > 1 ? { gap: 12 } : undefined}
          contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 12, flexGrow: 1 }}
          ListHeaderComponent={<SavedReportsSection />}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="document-text-outline"
              title={isSearching ? "No results" : isFiltered ? "No matching reports" : "No reports yet"}
              subtitle={
                isSearching
                  ? `No reports match "${searchQuery}". Try a different address or client name.`
                  : isFiltered
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
