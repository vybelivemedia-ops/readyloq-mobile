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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRootNavigationState, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
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
import {
  filterReports,
  emptyStateMessage,
  applyTabChange,
  applyFilterParamChange,
  normalizeFilterParam as _normalizeFilterParam,
  type AuditScreenState,
} from "@/lib/reports/audit-search";

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

// ─── Params hydration skeleton ────────────────────────────────────────────────

/**
 * Shown for one JS tick while expo-router hydrates the navigation params on
 * cold start.  Prevents a one-frame flash where the tab would momentarily
 * render as "All" before snapping to the deep-linked filter value (e.g.
 * `readyloq://reports-detail?filter=critical`).
 */
function AuditSkeleton({ top }: { top: number }) {
  return (
    <View style={{ flex: 1 }}>
      {/* Tab row placeholders */}
      <View
        style={{
          flexDirection: "row",
          gap: 8,
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: 12,
        }}
      >
        {([0, 1, 2, 3] as const).map((i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 52,
              borderRadius: 10,
              backgroundColor: C.surface,
              borderWidth: 1,
              borderColor: C.border,
              opacity: 0.6,
            }}
          />
        ))}
      </View>

      {/* Search bar placeholder */}
      <View
        style={{
          height: 40,
          marginHorizontal: 16,
          marginBottom: 10,
          borderRadius: 10,
          backgroundColor: C.surface,
          borderWidth: 1,
          borderColor: C.border,
          opacity: 0.6,
        }}
      />

      {/* Filter banner placeholder */}
      <View
        style={{
          height: 36,
          marginHorizontal: 16,
          marginBottom: 12,
          borderRadius: 8,
          backgroundColor: C.surface,
          borderWidth: 1,
          borderColor: C.border,
          opacity: 0.6,
        }}
      />

      {/* Report card placeholders */}
      <View style={{ paddingHorizontal: 16, gap: 10 }}>
        {([0, 1, 2, 3] as const).map((i) => (
          <View
            key={i}
            style={{
              height: 72,
              borderRadius: 10,
              backgroundColor: C.surface,
              borderWidth: 1,
              borderColor: C.border,
              opacity: 0.6 - i * 0.1,
            }}
          />
        ))}
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

// Re-export the normalise helper under the local name so usages below are unchanged.
const normalizeFilterParam = _normalizeFilterParam;

/** AsyncStorage key for the last-selected audit tab preference. */
const AUDIT_TAB_STORAGE_KEY = "@readyloq/audit_last_tab";

export default function ReportsDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Typed as string so expo-router doesn't infer the narrower AuditFilter union
  // before we have a chance to validate — normalizeFilterParam handles that.
  const { filter: filterParam, q: qParam } = useLocalSearchParams<{ filter?: string; q?: string }>();

  // ── Cold-start deep-link guard ─────────────────────────────────────────────
  // When the app is cold-started via a push-notification deep link such as
  //   readyloq://reports-detail?filter=critical
  // expo-router may deliver `filterParam` as `undefined` on the very first
  // render cycle before the navigation stack is fully hydrated.  A naive
  // `useState(normalizeFilterParam(filterParam))` would therefore initialise
  // `activeTab` to "all", and the screen would flash to "All" before snapping
  // to the deep-linked tab — even if we correct it in a `useEffect`.
  //
  // Root cause: `useEffect` always runs AFTER the first committed paint, so a
  // `paramsReady` flag set inside an effect is too late — the wrong tab has
  // already been displayed by the time the effect fires.
  //
  // Correct fix: use `useRootNavigationState()` from expo-router.  Its `.key`
  // property is populated ONLY once the navigation container has resolved the
  // initial URL and mounted the navigation stack.  On cold start its value is
  // undefined until that resolution completes, giving us a synchronous signal
  // we can read inside the lazy `useState` initialiser.
  //
  //   • Normal in-app navigation  → navigationReady is already true on first
  //     render → paramsReady starts true → no skeleton ever shown.
  //   • Cold-start deep link      → navigationReady is false on first render
  //     → paramsReady starts false → skeleton shown → navigation hydrates →
  //     param effect fires with the real filterParam ("critical") → correct
  //     tab is set + paramsReady = true → skeleton replaced with the right UI.
  const navigationState = useRootNavigationState();
  const navigationReady = !!navigationState?.key;

  // Lazy initialiser captures navigationReady at first render.  If the nav
  // stack is already hydrated (normal navigation) this is true and no skeleton
  // will ever be shown.  If not (cold start) this is false and we defer.
  const [paramsReady, setParamsReady] = useState(() => navigationReady);

  const [activeTab, setActiveTab] = useState<AuditFilter>(
    normalizeFilterParam(filterParam),
  );
  // Seed the search input from the `q` URL param on first mount.
  const [searchQuery, setSearchQuery] = useState(
    Array.isArray(qParam) ? (qParam[0] ?? "") : (qParam ?? ""),
  );

  // Restore the last-used tab from storage on first mount — but only when the
  // caller did NOT supply an explicit `filter=` deep-link param (which always
  // takes precedence over the stored preference).
  //
  // We guard on `navigationReady` so that on cold start the storage read does
  // not race with param hydration: if navigation isn't ready yet we return
  // early and the effect re-fires (via the `navigationReady` dependency) once
  // the nav stack is hydrated and filterParam is stable.
  useEffect(() => {
    if (!navigationReady) return; // wait for the nav stack to resolve the URL
    if (filterParam) return;      // deep-link overrides stored preference
    AsyncStorage.getItem(AUDIT_TAB_STORAGE_KEY)
      .then((stored) => {
        const tab = normalizeFilterParam(stored ?? undefined);
        // normalizeFilterParam returns "all" for null/undefined/invalid values,
        // so this is always safe to apply unconditionally.
        setActiveTab(tab);
      })
      .catch(() => {
        // Storage errors are non-fatal; silently keep the default tab.
      });
  // navigationReady intentionally included: the effect must re-run once the
  // nav stack hydrates so the storage read sees the correct filterParam.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationReady]);

  // Keep the active tab (and search query) in sync with the URL params.
  // useState's initializer only runs at first mount; if expo-router reuses
  // the mounted screen instance (e.g. the route is already in the stack and
  // a second push arrives with different params), filterParam/qParam change
  // but the local state would be stale without this effect.
  //
  // navigationReady is included in the dep array so this effect re-fires once
  // the nav stack hydrates.  Until it does we return early, keeping the
  // skeleton visible so the user never sees the wrong ("all") tab.
  useEffect(() => {
    if (!navigationReady) return; // params are not yet stable — keep skeleton
    const next = applyFilterParamChange({ activeTab, searchQuery }, filterParam, qParam);
    setActiveTab(next.activeTab);
    setSearchQuery(next.searchQuery);
    // Mark params as hydrated so the skeleton is replaced with the real UI.
    // setParamsReady is a no-op when already true (normal navigation).
    setParamsReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterParam, qParam, navigationReady]);

  // Clear search whenever the user manually switches tabs, and persist the
  // selection so the next visit starts on the same tab.
  const handleTabChange = (tab: AuditFilter) => {
    const next = applyTabChange({ activeTab, searchQuery }, tab);
    setActiveTab(next.activeTab);
    setSearchQuery(next.searchQuery);
    // Persist asynchronously; errors are non-fatal.
    AsyncStorage.setItem(AUDIT_TAB_STORAGE_KEY, tab).catch(() => {});
  };

  const queryParams = useMemo(() => tabToParams(activeTab), [activeTab]);

  const { data, isLoading, isRefetching, refetch } = useQuery(
    fetchReportsQueryOptions(queryParams),
  );

  // Client-side text search on top of the server-filtered tab data
  const trimmedQuery = searchQuery.trim().toLowerCase();
  const reports = useMemo(
    () => filterReports(data ?? [], searchQuery),
    [data, searchQuery],
  );

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
            {!paramsReady || isLoading ? "Loading…" : `${reports.length} report${reports.length === 1 ? "" : "s"}`}
          </Text>
        </View>
      </View>

      {/* ── Cold-start skeleton — shown for one JS tick while expo-router ────
           hydrates the navigation params.  Prevents the "All" → target-tab
           flash when the app is cold-started via a push-notification deep
           link (e.g. readyloq://reports-detail?filter=critical).         ── */}
      {!paramsReady ? (
        <AuditSkeleton top={insets.top} />
      ) : (
        <>

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
              onPress={() => handleTabChange(filter)}
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

      {/* ── Search bar ─────────────────────────────────────────────────────── */}
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
          borderColor: trimmedQuery ? C.primary + "55" : C.border,
          backgroundColor: C.surface,
          gap: 8,
        }}
      >
        <Ionicons name="search-outline" size={16} color={trimmedQuery ? C.primary : C.muted} />
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search by address or client…"
          placeholderTextColor={C.muted}
          style={{
            flex: 1,
            fontFamily: "Inter_400Regular",
            fontSize: 14,
            color: C.text,
            padding: 0,
          }}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
        {searchQuery.length > 0 ? (
          <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={C.muted} />
          </Pressable>
        ) : null}
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
            onPress={() => handleTabChange("all")}
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
                {emptyStateMessage(
                  searchQuery,
                  activeTab,
                  TABS.find(t => t.filter === activeTab)?.label ?? activeTab,
                )}
              </Text>
              {trimmedQuery ? (
                <TouchableOpacity
                  onPress={() => setSearchQuery("")}
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
                    Clear search
                  </Text>
                </TouchableOpacity>
              ) : activeTab !== "all" ? (
                <TouchableOpacity
                  onPress={() => handleTabChange("all")}
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
        </>
      )}
    </View>
  );
}
