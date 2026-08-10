/**
 * Management Report Audit — filtered view of company reports.
 *
 * Provides four focused tab filters for owners and managers:
 *   All        → every report (no server filter)
 *   Pipeline   → reports in an actionable delivery state (sent / proposal_sent)
 *   Critical   → high or critical severity inspections
 *   Pending    → awaiting approval (pending / draft)
 *
 * Accepts an optional `filter` URL param so callers can deep-link into a
 * specific tab (e.g. router.push("/reports-detail?filter=critical")).
 *
 * Data: fetchReportsQueryOptions from @/lib/api-client/reports (server-filtered,
 * React Query cache). The pasted `fetchReportRecords()` / `apiGet` helpers do
 * not exist in this codebase — all report fetching goes through customFetch.
 */
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  fetchReportsQueryOptions,
  type ReportQueryParams,
} from "@/lib/api-client/reports";
import type { Report } from "@/lib/api-client/generated/api.schemas";
import { formatDate, formatStatus, severityTone, statusTone } from "@/constants/inspection";

// ─── Palette (dark command-centre, matching executive screens) ────────────────

const C = {
  bg:      "#0D1117",
  surface: "#161B22",
  border:  "#30363D",
  text:    "#E6EDF3",
  muted:   "#8B949E",
  primary: "#17C4D3",
  success: "#3FB950",
  warning: "#D29922",
  danger:  "#F85149",
} as const;

// ─── Filter definitions ───────────────────────────────────────────────────────

type AuditFilter = "all" | "pipeline" | "critical" | "pending";

const TABS: { filter: AuditFilter; label: string; icon: "apps-outline" | "trending-up-outline" | "warning-outline" | "time-outline" }[] = [
  { filter: "all",      label: "All",           icon: "apps-outline" },
  { filter: "pipeline", label: "Pipeline",      icon: "trending-up-outline" },
  { filter: "critical", label: "Critical Risks", icon: "warning-outline" },
  { filter: "pending",  label: "Pending",       icon: "time-outline" },
];

function tabToParams(filter: AuditFilter): ReportQueryParams {
  switch (filter) {
    case "pipeline":
      // Reports in a delivery/proposal state — most likely to have pipeline value.
      return { status: ["sent", "proposal_sent"] };
    case "critical":
      return { severity: ["high", "critical"] };
    case "pending":
      return { status: ["pending", "draft"] };
    default:
      return {};
  }
}

const TAB_ACCENT: Record<AuditFilter, string> = {
  all:      C.primary,
  pipeline: C.success,
  critical: C.danger,
  pending:  C.warning,
};

const FILTER_DESCRIPTIONS: Record<AuditFilter, string> = {
  all:      "Showing all records — no active filter",
  pipeline: "Filtered by: Pipeline Value & Contributions",
  critical: "Filtered by: High & Critical Risk Inspections",
  pending:  "Filtered by: Summaries Awaiting Approval",
};

// ─── Shared card shell ────────────────────────────────────────────────────────

function CardShell({
  item,
  accent,
  onPress,
  children,
}: {
  item: Report;
  accent: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      style={{
        backgroundColor: C.surface,
        borderWidth: 1,
        borderColor: C.border,
        borderLeftWidth: 3,
        borderLeftColor: accent,
        borderRadius: 10,
        padding: 13,
        gap: 6,
      }}
    >
      {/* Title */}
      <Text
        numberOfLines={2}
        style={{ color: C.text, fontFamily: "Inter_600SemiBold", fontSize: 14, lineHeight: 20 }}
      >
        {item.title || item.siteAddress || "Untitled report"}
      </Text>
      {/* Address — always shown if different from title */}
      {item.siteAddress && item.siteAddress !== item.title ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <Ionicons name="location-outline" size={12} color={C.muted} />
          <Text numberOfLines={1} style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 12, flex: 1 }}>
            {item.siteAddress}
          </Text>
        </View>
      ) : null}
      {/* Filter-specific body */}
      {children}
    </TouchableOpacity>
  );
}

// ─── Filter-aware card ────────────────────────────────────────────────────────

function ReportCard({
  item,
  filter,
  onPress,
}: {
  item: Report;
  filter: AuditFilter;
  onPress: () => void;
}) {
  const accent = TAB_ACCENT[filter];

  // Days since creation — used for pending age
  const daysOld = Math.floor(
    (Date.now() - new Date(item.createdAt).getTime()) / 86_400_000,
  );

  const severityColor =
    item.severity === "critical" ? C.danger
    : item.severity === "high"   ? "#E3882A"
    : item.severity === "medium" ? C.warning
    : C.success;

  // ── Pipeline: what matters is delivery status + date ─────────────────────
  if (filter === "pipeline") {
    return (
      <CardShell item={item} accent={accent} onPress={onPress}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="paper-plane-outline" size={13} color={accent} />
            <Text style={{ color: accent, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
              {formatStatus(item.status)}
            </Text>
          </View>
          <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 11 }}>
            {formatDate(item.createdAt)}
          </Text>
        </View>
      </CardShell>
    );
  }

  // ── Critical: severity is the hero ───────────────────────────────────────
  if (filter === "critical") {
    return (
      <CardShell item={item} accent={accent} onPress={onPress}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
          {/* Large severity badge */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 20,
              backgroundColor: severityColor + "18",
              borderWidth: 1,
              borderColor: severityColor + "44",
            }}
          >
            <Ionicons name="warning-outline" size={13} color={severityColor} />
            <Text style={{ color: severityColor, fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 0.5 }}>
              {item.severity ? item.severity.toUpperCase() : "UNKNOWN"} RISK
            </Text>
          </View>
          <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 11 }}>
            {formatDate(item.createdAt)}
          </Text>
        </View>
      </CardShell>
    );
  }

  // ── Pending: age waiting is what matters ─────────────────────────────────
  if (filter === "pending") {
    const ageColor = daysOld >= 7 ? C.danger : daysOld >= 3 ? C.warning : C.muted;
    return (
      <CardShell item={item} accent={accent} onPress={onPress}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Ionicons name="time-outline" size={13} color={ageColor} />
            <Text style={{ color: ageColor, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
              Waiting {daysOld} day{daysOld === 1 ? "" : "s"}
            </Text>
          </View>
          <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 11 }}>
            Submitted {formatDate(item.createdAt)}
          </Text>
        </View>
      </CardShell>
    );
  }

  // ── All: show everything ─────────────────────────────────────────────────
  return (
    <CardShell item={item} accent={accent} onPress={onPress}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 2 }}>
        {/* Status */}
        <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border }}>
          <Text style={{ color: C.muted, fontFamily: "Inter_600SemiBold", fontSize: 10, letterSpacing: 0.4 }}>
            {formatStatus(item.status)}
          </Text>
        </View>
        {/* Severity */}
        {item.severity ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20, backgroundColor: severityColor + "18", borderWidth: 1, borderColor: severityColor + "40" }}>
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: severityColor }} />
            <Text style={{ color: severityColor, fontFamily: "Inter_600SemiBold", fontSize: 10, letterSpacing: 0.4 }}>
              {item.severity.toUpperCase()}
            </Text>
          </View>
        ) : null}
        {/* AI narrative indicator */}
        {item.aiNarrative ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Ionicons name="sparkles-outline" size={12} color={C.primary} />
            <Text style={{ color: C.primary, fontFamily: "Inter_500Medium", fontSize: 11 }}>AI</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginLeft: "auto" as const }}>
          <Ionicons name="calendar-outline" size={12} color={C.muted} />
          <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 11 }}>
            {formatDate(item.createdAt)}
          </Text>
        </View>
      </View>
    </CardShell>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ReportsDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { filter: filterParam } = useLocalSearchParams<{ filter?: AuditFilter }>();

  const [activeTab, setActiveTab] = useState<AuditFilter>(
    (filterParam as AuditFilter | undefined) ?? "all",
  );

  const queryParams = useMemo(() => tabToParams(activeTab), [activeTab]);

  const { data, isLoading, isRefetching, refetch } = useQuery(
    fetchReportsQueryOptions(queryParams),
  );

  const reports = data ?? [];
  const accent  = TAB_ACCENT[activeTab];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 16,
          paddingBottom: 14,
          borderBottomWidth: 1,
          borderBottomColor: C.border,
          backgroundColor: "#10141F",
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          activeOpacity={0.7}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: "#ffffff12",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="chevron-back" size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontFamily: "Inter_800ExtraBold", fontSize: 17 }}>
            Management Report Audit
          </Text>
          <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 1 }}>
            {isLoading ? "Loading…" : `${reports.length} report${reports.length === 1 ? "" : "s"}`}
          </Text>
        </View>
      </View>

      {/* ── Filter tab row ──────────────────────────────────────────────────── */}
      <View
        style={{
          flexDirection: "row",
          gap: 8,
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: 12,
        }}
      >
        {TABS.map(({ filter, label, icon }) => {
          const isActive   = activeTab === filter;
          const tabAccent  = TAB_ACCENT[filter];
          return (
            <TouchableOpacity
              key={filter}
              onPress={() => setActiveTab(filter)}
              activeOpacity={0.75}
              style={{
                flex: 1,
                alignItems: "center",
                paddingVertical: 9,
                borderRadius: 10,
                borderWidth: 1,
                backgroundColor: isActive ? tabAccent + "18" : C.surface,
                borderColor:     isActive ? tabAccent + "55" : C.border,
                gap: 3,
              }}
            >
              <Ionicons
                name={icon}
                size={14}
                color={isActive ? tabAccent : C.muted}
              />
              <Text
                style={{
                  color:      isActive ? tabAccent : C.muted,
                  fontFamily: isActive ? "Inter_700Bold" : "Inter_400Regular",
                  fontSize:   10,
                  letterSpacing: 0.4,
                  textAlign:  "center",
                }}
                numberOfLines={1}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Active filter banner ────────────────────────────────────────────── */}
      <View
        style={{
          flexDirection:   "row",
          alignItems:      "center",
          gap:             8,
          marginHorizontal: 16,
          marginBottom:    12,
          paddingHorizontal: 12,
          paddingVertical:  8,
          borderRadius:    8,
          borderWidth:     1,
          backgroundColor: activeTab === "all" ? C.surface : TAB_ACCENT[activeTab] + "12",
          borderColor:     activeTab === "all" ? C.border   : TAB_ACCENT[activeTab] + "44",
        }}
      >
        <Ionicons
          name="funnel"
          size={13}
          color={activeTab === "all" ? C.muted : TAB_ACCENT[activeTab]}
        />
        <Text
          style={{
            flex:       1,
            color:      activeTab === "all" ? C.muted : TAB_ACCENT[activeTab],
            fontFamily: "Inter_600SemiBold",
            fontSize:   12,
          }}
          numberOfLines={1}
        >
          {FILTER_DESCRIPTIONS[activeTab]}
        </Text>
        {activeTab !== "all" ? (
          <TouchableOpacity
            onPress={() => setActiveTab("all")}
            activeOpacity={0.7}
            hitSlop={8}
          >
            <Text
              style={{
                color:               C.muted,
                fontFamily:          "Inter_700Bold",
                fontSize:            11,
                textDecorationLine:  "underline",
              }}
            >
              Reset
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* ── List ────────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 14 }}>
            Loading reports…
          </Text>
        </View>
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{
            padding: 16,
            paddingTop: 4,
            gap: 10,
            paddingBottom: insets.bottom + 32,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={accent}
            />
          }
          renderItem={({ item }) => (
            <ReportCard
              item={item}
              filter={activeTab}
              onPress={() => router.push(`/report/${item.id}` as never)}
            />
          )}
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 60 }}>
              <Ionicons name="document-text-outline" size={40} color={C.muted} />
              <Text style={{ color: C.muted, fontFamily: "Inter_600SemiBold", fontSize: 15, textAlign: "center" }}>
                No reports
              </Text>
              <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 13, textAlign: "center", maxWidth: 240 }}>
                {activeTab === "all"
                  ? "Complete an inspection to generate a report."
                  : `No reports match the "${TABS.find(t => t.filter === activeTab)?.label}" filter.`}
              </Text>
              {activeTab !== "all" ? (
                <TouchableOpacity
                  onPress={() => setActiveTab("all")}
                  activeOpacity={0.75}
                  style={{
                    paddingHorizontal: 18,
                    paddingVertical: 9,
                    borderRadius: 10,
                    backgroundColor: C.primary + "22",
                    borderWidth: 1,
                    borderColor: C.primary + "55",
                    marginTop: 4,
                  }}
                >
                  <Text style={{ color: C.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                    Show all reports
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          }
        />
      )}
    </View>
  );
}
