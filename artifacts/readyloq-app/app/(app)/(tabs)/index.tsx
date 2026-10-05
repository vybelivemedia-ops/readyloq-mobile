/**
 * Dashboard (index) — role-differentiated home screen.
 *
 * Role   Primary CTA              Tools shown
 * ──────────────────────────────────────────────────────────────────
 * Tech   Start AI Inspection      Bulk upload · Daily route status
 * Sales  Start Property Scan      View pipeline · Recent scans
 * Mgr    Review Yesterday's Work  Team health · Approval queue
 * Owner  Daily Briefing           KPI strip · Comms quick-dial
 *
 * The lower section is always `<RoleBriefingView>` which renders the
 * server-shaped data (stats + lists) specific to each role.
 */

import { useAuth, useUser } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import {
  getGetAnalyticsDashboardQueryOptions,
  getGetBriefingQueryOptions,
  getListReportsQueryOptions,
} from "@/lib/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Href, useRouter } from "expo-router";
import React, { useCallback } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { dismissPushFailure, type CurrentUser } from "@/lib/api";
import { runDismissPushFailure } from "@/lib/dashboard/push-failure-banner";

import { MissionControlDashboard } from "@/components/MissionControlDashboard";
import { IntegratedRouteCalendar } from "@/components/IntegratedRouteCalendar";
import { RoleBriefingView } from "@/components/briefing/RoleBriefingView";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSignOut } from "@/hooks/useSignOut";
import { useVybeAgents } from "@/hooks/useVybeAgents";
import { getDashboardMetrics } from "@/lib/dashboard";
import { useLicenseStatus } from "@/hooks/useLicenseStatus";
import { useWindowSizeClass } from "@/hooks/useWindowSizeClass";
import { useViewPreference, resolveViewMode } from "@/hooks/useViewPreference";
import { filterIntent } from "@/lib/filterIntent";

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Large hero CTA button. */
function HeroCTA({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: colors.primary,
        borderRadius: colors.radius,
        padding: 20,
        flexDirection: "row",
        alignItems: "center",
        gap: 16,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 14,
          backgroundColor: "rgba(255,255,255,0.18)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={28} color={colors.primaryForeground} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_700Bold", fontSize: 18 }}>
          {title}
        </Text>
        <Text style={{ color: "rgba(255,255,255,0.85)", fontFamily: "Inter_400Regular", fontSize: 13 }}>
          {subtitle}
        </Text>
      </View>
      <Ionicons name="arrow-forward" size={22} color={colors.primaryForeground} />
    </Pressable>
  );
}

/** Small tool tile beneath the hero CTA. */
function ToolTile({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        backgroundColor: colors.card,
        borderRadius: colors.radius,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          backgroundColor: colors.accent,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
          {title}
        </Text>
        <Text
          numberOfLines={1}
          style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}
        >
          {subtitle}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

/** Quick KPI stat card used in the Owner executive strip. */
function KpiCard({
  icon,
  value,
  label,
  tone,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string | number;
  label: string;
  tone: string;
  onPress?: () => void;
}) {
  const colors = useColors();
  const inner = (
    <>
      <Ionicons name={icon} size={20} color={tone} />
      <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 20 }}>
        {value}
      </Text>
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: "Inter_400Regular",
          fontSize: 11,
          textAlign: "center",
        }}
      >
        {label}
      </Text>
      {onPress ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2, marginTop: -2 }}>
          <Text style={{ color: colors.primary, fontFamily: "Inter_500Medium", fontSize: 10 }}>
            View
          </Text>
          <Ionicons name="chevron-forward" size={10} color={colors.primary} />
        </View>
      ) : null}
    </>
  );

  const cardStyle = {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center" as const,
    gap: 6,
  };

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({ ...cardStyle, opacity: pressed ? 0.75 : 1 })}
      >
        {inner}
      </Pressable>
    );
  }
  return <View style={cardStyle}>{inner}</View>;
}

// ─── Shared upload training card (all roles) ─────────────────────────────────

/**
 * Persistent nudge card shown to every role below the hero CTA.
 * Spare-time uploads of pest / condition photos improve AI accuracy —
 * keeping it top-of-mind increases contribution frequency.
 */
function UploadTrainingPhotosCard({
  router,
}: {
  router: ReturnType<typeof useRouter>;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={() => router.push("/dataset/bulk-upload" as Href)}
      accessibilityLabel="Upload training photos and videos"
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        padding: 14,
        backgroundColor: colors.card,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <View
        style={{
          width: 46,
          height: 46,
          borderRadius: 23,
          backgroundColor: colors.primary + "1A",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="images-outline" size={22} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: colors.foreground,
            fontFamily: "Inter_600SemiBold",
            fontSize: 15,
          }}
        >
          Upload Training Photos & Videos
        </Text>
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: "Inter_400Regular",
            fontSize: 13,
            marginTop: 2,
          }}
        >
          Add pest or condition photos & videos in spare time · improves AI accuracy
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

// ─── Role-specific quick-action sections ─────────────────────────────────────

/** Sales tools: view pipeline + proposals. */
function SalesTools({ router }: { router: ReturnType<typeof useRouter> }) {
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <ToolTile
        icon="briefcase-outline"
        title="View Pipeline"
        subtitle="Open opportunities & proposals"
        onPress={() => router.push("/(tabs)/leads" as Href)}
      />
      <ToolTile
        icon="document-text-outline"
        title="Reports"
        subtitle="Customer-ready summaries"
        onPress={() => router.push("/(tabs)/reports" as Href)}
      />
    </View>
  );
}

/** Manager tools: jump straight to review queue and team view. */
function ManagerTools({
  pendingCount,
  router,
}: {
  pendingCount: number;
  router: ReturnType<typeof useRouter>;
}) {
  const colors = useColors();
  return (
    <View style={{ gap: 10 }}>
      {/* Review queue shortcut — highlighted when there are pending items */}
      <Pressable
        onPress={() => router.push("/(tabs)/review" as Href)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          padding: 16,
          borderRadius: 12,
          backgroundColor: pendingCount > 0 ? colors.warning + "18" : colors.card,
          borderWidth: 1,
          borderColor: pendingCount > 0 ? colors.warning + "55" : colors.border,
          gap: 12,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Ionicons
          name="checkmark-done-outline"
          size={22}
          color={pendingCount > 0 ? (colors.warning ?? "#d97706") : colors.primary}
        />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
            {pendingCount > 0
              ? `${pendingCount} inspection${pendingCount === 1 ? "" : "s"} need review`
              : "Review queue"}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
            Approve or flag for callback · target &lt;20 min
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
      </Pressable>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <ToolTile
          icon="people-circle-outline"
          title="Team"
          subtitle="Quality scores · badges"
          onPress={() => router.push("/(tabs)/team" as Href)}
        />
        <ToolTile
          icon="document-text-outline"
          title="All Reports"
          subtitle="Tech + sales output"
          onPress={() => router.push("/(tabs)/reports" as Href)}
        />
      </View>
    </View>
  );
}

/** Owner comms quick-dial strip — multi-operator only. */
function OwnerCommsStrip() {
  const colors = useColors();
  const contacts = [
    { label: "Manager",      icon: "shield-outline"      as const },
    { label: "Sales Lead",   icon: "trending-up-outline" as const },
    { label: "Tech Sup.",    icon: "construct-outline"   as const },
  ];
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
        Quick contacts
      </Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {contacts.map((c) => (
          <View
            key={c.label}
            style={{
              flex: 1,
              padding: 12,
              borderRadius: 12,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: "center",
              gap: 6,
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: colors.primary + "18",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name={c.icon} size={20} color={colors.primary} />
            </View>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 12 }}>
              {c.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Solo-operator personal command tiles. */
function SoloOwnerTools({ router }: { router: ReturnType<typeof useRouter> }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <ToolTile
          icon="camera-outline"
          title="New Inspection"
          subtitle="Capture, AI-analyse, report"
          onPress={() => router.push("/new-inspection" as Href)}
        />
        <ToolTile
          icon="briefcase-outline"
          title="Pipeline"
          subtitle="Open opportunities"
          onPress={() => router.push("/(tabs)/reports" as Href)}
        />
      </View>
      <ToolTile
        icon="document-text-outline"
        title="All Reports"
        subtitle="Customer-ready summaries & share links"
        onPress={() => router.push("/(tabs)/reports" as Href)}
      />
    </View>
  );
}

/** Format a dollar amount compactly: $1.2k, $34k, $1.1M. */
function formatPipelineValue(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `$${Math.round(v / 1_000)}k`;
  return `$${v}`;
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user: clerkUser } = useUser();
  const signOut = useSignOut();
  const { user } = useCurrentUser();
  const { isCompact } = useWindowSizeClass();

  const role = user?.role ?? "technician";
  const isTech    = role === "technician";
  const isSales   = role === "sales";
  const isManager = role === "manager";
  const isOwner   = role === "owner";

  const { viewMode } = useViewPreference();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  // Dismiss the push-failure banner with an optimistic local update so the
  // banner hides immediately on tap — no reload required.
  const handleDismissPushFailure = useCallback(
    () =>
      runDismissPushFailure<CurrentUser>({
        getToken,
        callDismissApi: dismissPushFailure,
        setUserCache: (updater) =>
          queryClient.setQueryData<CurrentUser | null | undefined>(["current-user"], updater),
      }),
    [getToken, queryClient],
  );

  const briefing = useQuery(getGetBriefingQueryOptions());
  const dash     = useQuery(getGetAnalyticsDashboardQueryOptions());

  // Reports list — shares the same React Query cache as the Reports tab so no
  // extra network request is made when that screen has already loaded.
  // Each report now carries `pipelineValue` from the linked sales opportunity
  // (joined server-side), which getDashboardMetrics sums client-side.
  const { data: reportsData } = useQuery({
    ...getListReportsQueryOptions(),
    enabled: isOwner,
  });

  // Derive client-side pipeline metrics from the reports list.
  // Only reports that have a priced opportunity contribute to the total.
  const pipelineMetrics = getDashboardMetrics(
    (reportsData ?? []).map((r) => ({ pipelineValue: r.pipelineValue })),
  );

  // License status — loaded for owners to surface subscription prompts/warnings.
  const { data: license } = useLicenseStatus(isOwner);

  const refreshing = briefing.isRefetching || dash.isRefetching;
  const onRefresh  = () => { briefing.refetch(); dash.refetch(); };

  const firstName = clerkUser?.firstName || role.charAt(0).toUpperCase() + role.slice(1);

  // Manager pending approvals count (from briefing).
  const pendingApprovals = briefing.data?.manager?.pendingApprovals ?? 0;

  // Owner mode flags.
  // The local view-preference hook overrides the server value when the owner
  // has explicitly chosen a layout.  Falls back to the server's isSoloOperator
  // flag (or true = solo when no briefing data yet).
  const serverIsSolo = briefing.data?.owner?.isSoloOperator ?? false;
  const isSoloOperator = isOwner
    ? resolveViewMode(viewMode, serverIsSolo) === "solo"
    : serverIsSolo;

  // Owner KPI strip — different sets for solo vs multi-operator.
  // Every card is a deep-link shortcut to the relevant filtered Reports view.
  const ownerKpis = briefing.data?.owner
    ? isSoloOperator
      ? /* Solo: personal field-execution metrics */
        [
          {
            icon: "today-outline" as const,
            value: briefing.data.owner.kpis.completions7d,
            label: "Done this\nweek",
            tone: colors.success ?? "#16a34a",
            onPress: () => { filterIntent.set("reports", "7d"); router.push("/(tabs)/reports" as Href); },
          },
          {
            icon: "trending-up-outline" as const,
            value: pipelineMetrics.openOpportunitiesCount,
            label: "Open\nopps",
            tone: colors.info ?? "#3b82f6",
            onPress: () => { filterIntent.set("reports", "opportunities"); router.push("/(tabs)/reports" as Href); },
          },
          {
            icon: "cash-outline" as const,
            value: pipelineMetrics.pipelineValueFormatted,
            label: "Pipeline\nvalue",
            tone: colors.primary,
            onPress: () => { filterIntent.set("reports", "opportunities"); router.push("/(tabs)/reports" as Href); },
          },
          {
            icon: "ribbon-outline" as const,
            value: briefing.data.owner.kpis.avgQualityScore30d != null
              ? Math.round(briefing.data.owner.kpis.avgQualityScore30d)
              : "—",
            label: "Avg quality\n(30d)",
            tone: colors.primary,
            onPress: () => { filterIntent.set("reports", "quality"); router.push("/(tabs)/reports" as Href); },
          },
        ]
      : /* Multi-operator: executive summary metrics */
        [
          {
            icon: "checkmark-done-outline" as const,
            value: briefing.data.owner.kpis.completions30d,
            label: "Completions\n(30 days)",
            tone: colors.success ?? "#16a34a",
            onPress: () => { filterIntent.set("reports", "30d"); router.push("/(tabs)/reports" as Href); },
          },
          {
            icon: "ribbon-outline" as const,
            value: briefing.data.owner.kpis.avgQualityScore30d != null
              ? Math.round(briefing.data.owner.kpis.avgQualityScore30d)
              : "—",
            label: "Avg quality\n(30 days)",
            tone: colors.primary,
            onPress: () => { filterIntent.set("reports", "quality"); router.push("/(tabs)/reports" as Href); },
          },
          {
            icon: "trending-up-outline" as const,
            value: pipelineMetrics.openOpportunitiesCount,
            label: "Open\nopportunities",
            tone: colors.info ?? "#3b82f6",
            onPress: () => { filterIntent.set("reports", "opportunities"); router.push("/(tabs)/reports" as Href); },
          },
          {
            icon: "stats-chart-outline" as const,
            value: briefing.data.owner.kpis.approvedSummaries30d,
            label: "Approved\nsummaries",
            tone: colors.primary,
            onPress: () => { filterIntent.set("reports", "approved"); router.push("/(tabs)/reports" as Href); },
          },
        ]
    : [];

  // Role-specific greeting suffix.
  const greetingRole =
    isSales   ? "Sales"
    : isManager ? "Manager"
    : isOwner   ? "Owner"
    : "";

  // Header label for company.
  const companyName = user?.company?.name;

  // ── Owner: route to Mission Control or Streamlined view ──────────────────
  const vybeAgents = useVybeAgents();
  const missionControlActive = isOwner
    ? resolveViewMode(viewMode, briefing.data?.owner?.isSoloOperator ?? false) === "enterprise"
    : false;

  // Quinn Harlow — Chief of Staff — is always first in the VYBE_AGENTS roster.
  const quinnEntry = vybeAgents.agents.find((a) => a.agent.id === "quinn-harlow") ?? vybeAgents.agents[0];

  if (isOwner && missionControlActive) {
    return (
      <MissionControlDashboard
        firstName={firstName}
        companyName={companyName}
        isSoloOperator={isSoloOperator}
        briefing={briefing.data}
        briefingLoading={briefing.isLoading}
        refreshing={briefing.isRefetching || dash.isRefetching}
        pipelineMetrics={pipelineMetrics}
        license={license}
        agents={vybeAgents.agents}
        agentsSyncFailed={vybeAgents.syncFailed}
        pushLastFailedAt={user?.pushLastFailedAt ?? null}
        hasPushToken={user?.hasPushToken ?? true}
        pushNotificationsEnabled={user?.pushNotificationsEnabled ?? false}
        onDismissPushFailure={() => { void handleDismissPushFailure(); }}
        onRefresh={() => { onRefresh(); vybeAgents.refresh(); }}
        onSignOut={() => { void signOut(); }}
      />
    );
  }

  if (isOwner && !missionControlActive) {
    // ── Streamlined / Solo owner view ──────────────────────────────────────
    const MC_BG      = "#08090E";
    const MC_SURFACE = "#10141F";
    const MC_BORDER  = "#1C2235";
    const MC_ACCENT  = "#17c4d3";
    const MC_TEXT    = "#FFFFFF";
    const MC_MUTED   = "rgba(255,255,255,0.45)";
    const MC_SUCCESS = "#22c55e";

    const quinnInitials = quinnEntry?.agent.initials ?? "QH";
    const quinnStatus = quinnEntry?.status ?? "active";
    const statusDotColor = quinnStatus === "active" ? MC_SUCCESS : quinnStatus === "standby" ? MC_ACCENT : MC_MUTED;

    return (
      <View style={{ flex: 1, backgroundColor: MC_BG }}>
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl
              refreshing={briefing.isRefetching}
              onRefresh={() => briefing.refetch()}
              tintColor={MC_ACCENT}
            />
          }
        >
          {/* ── Header ──────────────────────────────────────────────────── */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: MC_TEXT, fontFamily: "Inter_700Bold", fontSize: 22, letterSpacing: -0.5 }}>
                {firstName.toUpperCase()}
              </Text>
              {companyName ? (
                <Text style={{ color: MC_MUTED, fontFamily: "Inter_400Regular", fontSize: 11, letterSpacing: 1.2, marginTop: 1 }}>
                  {companyName.toUpperCase()}
                </Text>
              ) : null}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ backgroundColor: "rgba(23,196,211,0.10)", borderRadius: 6, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: "rgba(23,196,211,0.25)" }}>
                <Text style={{ color: MC_ACCENT, fontFamily: "Inter_700Bold", fontSize: 9, letterSpacing: 1.2 }}>
                  STREAMLINED
                </Text>
              </View>
              <Pressable
                onPress={() => router.push("/settings" as Href)}
                style={({ pressed }) => ({
                  width: 36, height: 36, borderRadius: 9,
                  backgroundColor: MC_SURFACE, borderWidth: 1, borderColor: MC_BORDER,
                  alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1,
                })}
              >
                <Ionicons name="settings-outline" size={17} color={MC_MUTED} />
              </Pressable>
              <Pressable
                onPress={() => { void signOut(); }}
                style={({ pressed }) => ({
                  width: 36, height: 36, borderRadius: 9,
                  backgroundColor: MC_SURFACE, borderWidth: 1, borderColor: MC_BORDER,
                  alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1,
                })}
              >
                <Ionicons name="log-out-outline" size={17} color={MC_MUTED} />
              </Pressable>
            </View>
          </View>

          {/* ── No-push-token banner ─────────────────────────────────────── */}
          {user?.hasPushToken === false && user?.pushNotificationsEnabled === true ? (
            <Pressable
              onPress={() => router.push("/settings" as Href)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "flex-start",
                gap: 10,
                padding: 12,
                backgroundColor: "rgba(239,68,68,0.06)",
                borderRadius: 10,
                borderWidth: 1,
                borderColor: "rgba(239,68,68,0.28)",
                borderLeftWidth: 3,
                borderLeftColor: "#ef4444",
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Ionicons name="warning-outline" size={18} color="#ef4444" style={{ marginTop: 1 }} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: MC_TEXT, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                  Critical alerts not reaching you
                </Text>
                <Text style={{ color: MC_MUTED, fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17 }}>
                  Push notifications are enabled but your device isn't registered. Tap to fix in Settings.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#ef4444" style={{ marginTop: 2 }} />
            </Pressable>
          ) : null}

          {/* ── Push-failure banner ──────────────────────────────────────── */}
          {user?.pushLastFailedAt ? (
            <View style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 10,
              padding: 12,
              backgroundColor: "rgba(245,158,11,0.05)",
              borderRadius: 10,
              borderWidth: 1,
              borderColor: "rgba(245,158,11,0.25)",
              borderLeftWidth: 3,
              borderLeftColor: "#f59e0b",
            }}>
              <Ionicons name="notifications-off-outline" size={18} color="#f59e0b" style={{ marginTop: 1 }} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: MC_TEXT, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                  Alert delivery failed
                </Text>
                <Text style={{ color: MC_MUTED, fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 17 }}>
                  A critical-risk push notification couldn't be delivered. Go to Settings to re-enable alerts.
                </Text>
              </View>
              <View style={{ gap: 6, alignItems: "flex-end" }}>
                <Pressable
                  onPress={() => router.push("/settings" as Href)}
                  style={({ pressed }) => ({
                    backgroundColor: "#f59e0b",
                    borderRadius: 6,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ color: "#000", fontFamily: "Inter_700Bold", fontSize: 11 }}>Fix</Text>
                </Pressable>
                <Pressable
                  onPress={() => { void handleDismissPushFailure(); }}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 2 })}
                >
                  <Text style={{ color: MC_MUTED, fontFamily: "Inter_400Regular", fontSize: 11 }}>Dismiss</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {/* ── Start Inspection hero ────────────────────────────────────── */}
          <Pressable
            onPress={() => router.push("/new-inspection" as Href)}
            style={({ pressed }) => ({
              backgroundColor: MC_ACCENT,
              borderRadius: 14,
              paddingVertical: 18,
              paddingHorizontal: 20,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              opacity: pressed ? 0.88 : 1,
            })}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <Ionicons name="camera" size={26} color="#000" />
              <Text style={{ color: "#000000", fontFamily: "Inter_700Bold", fontSize: 19 }}>
                Start Inspection
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color="#000" />
          </Pressable>

          {/* Solo owners double as field techs — surface the upload nudge here too.
              Multi-operator owners run the business, not the camera, so they don't
              see this. */}
          {isSoloOperator ? <UploadTrainingPhotosCard router={router} /> : null}

          {/* ── Quick actions ─────────────────────────────────────────────── */}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              onPress={() => router.push("/(tabs)/reports" as Href)}
              style={({ pressed }) => ({
                flex: 1, backgroundColor: MC_SURFACE, borderWidth: 1, borderColor: MC_BORDER,
                borderRadius: 10, paddingVertical: 13,
                flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name="document-text-outline" size={18} color={MC_ACCENT} />
              <Text style={{ color: MC_TEXT, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>Reports</Text>
            </Pressable>
            <Pressable
              onPress={() => router.push("/(tabs)/leads" as Href)}
              style={({ pressed }) => ({
                flex: 1, backgroundColor: MC_SURFACE, borderWidth: 1, borderColor: MC_BORDER,
                borderRadius: 10, paddingVertical: 13,
                flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Ionicons name="trending-up-outline" size={18} color={MC_ACCENT} />
              <Text style={{ color: MC_TEXT, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>Pipeline</Text>
            </Pressable>
          </View>

          {/* ── Live pipeline stats ───────────────────────────────────────── */}
          {(() => {
            const kpis = briefing.data?.owner?.kpis;
            const isLoading = briefing.isLoading;

            const stats: Array<{
              icon: keyof typeof Ionicons.glyphMap;
              value: string;
              label: string;
              onPress: () => void;
            }> = [
              {
                icon: "cash-outline",
                value: isLoading ? "—" : formatPipelineValue(kpis?.pipelineValue ?? 0),
                label: "Pipeline",
                onPress: () => { filterIntent.set("reports", "opportunities"); router.push("/(tabs)/reports" as Href); },
              },
              {
                icon: "briefcase-outline",
                value: isLoading ? "—" : String(kpis?.openOpportunities ?? 0),
                label: "Open opps",
                onPress: () => { filterIntent.set("reports", "opportunities"); router.push("/(tabs)/reports" as Href); },
              },
              {
                icon: "checkmark-done-outline",
                value: isLoading ? "—" : String(kpis?.completions7d ?? 0),
                label: "Done this week",
                onPress: () => { filterIntent.set("reports", "7d"); router.push("/(tabs)/reports" as Href); },
              },
            ];

            return (
              <View style={{ flexDirection: "row", gap: 8 }}>
                {stats.map((s) => (
                  <Pressable
                    key={s.label}
                    onPress={s.onPress}
                    style={({ pressed }) => ({
                      flex: 1,
                      backgroundColor: MC_SURFACE,
                      borderWidth: 1,
                      borderColor: MC_BORDER,
                      borderRadius: 10,
                      paddingVertical: 12,
                      paddingHorizontal: 8,
                      alignItems: "center",
                      gap: 4,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Ionicons name={s.icon} size={15} color={MC_ACCENT} />
                    {isLoading ? (
                      <View
                        style={{
                          width: 36,
                          height: 16,
                          borderRadius: 4,
                          backgroundColor: "rgba(255,255,255,0.08)",
                        }}
                      />
                    ) : (
                      <Text
                        style={{
                          color: MC_TEXT,
                          fontFamily: "Inter_700Bold",
                          fontSize: 16,
                          letterSpacing: -0.3,
                        }}
                      >
                        {s.value}
                      </Text>
                    )}
                    <Text
                      style={{
                        color: MC_MUTED,
                        fontFamily: "Inter_400Regular",
                        fontSize: 10,
                        letterSpacing: 0.2,
                        textAlign: "center",
                      }}
                    >
                      {s.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            );
          })()}

          {/* ── AI Assistant — Quinn Harlow ──────────────────────────────── */}
          <View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <View style={{ width: 3, height: 13, backgroundColor: MC_ACCENT, borderRadius: 2 }} />
              <Text style={{ color: MC_ACCENT, fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 1.6 }}>
                AI ASSISTANT
              </Text>
            </View>
            <View style={{
              backgroundColor: MC_SURFACE,
              borderWidth: 1, borderColor: MC_BORDER,
              borderRadius: 12, padding: 14,
              flexDirection: "row", alignItems: "center", justifyContent: "space-between",
            }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <View style={{
                  width: 42, height: 42, borderRadius: 11,
                  backgroundColor: "rgba(23,196,211,0.12)",
                  borderWidth: 1, borderColor: "rgba(23,196,211,0.25)",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Text style={{ color: MC_ACCENT, fontFamily: "Inter_700Bold", fontSize: 12, letterSpacing: 0.5 }}>
                    {quinnInitials}
                  </Text>
                </View>
                <View>
                  <Text style={{ color: MC_TEXT, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
                    {quinnEntry?.agent.name ?? "Quinn Harlow"}
                  </Text>
                  <Text style={{ color: MC_MUTED, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 1 }}>
                    {quinnEntry?.agent.role ?? "Chief of Staff"} · Active Voice Copilot
                  </Text>
                </View>
              </View>
              <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: statusDotColor }} />
            </View>
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          gap: 18,
          paddingBottom: 32,
          width: "100%",
          maxWidth: 900,
          alignSelf: "center",
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14 }}>
              Welcome back{greetingRole ? `, ${greetingRole}` : ""},
            </Text>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 24 }}>
              {firstName}
            </Text>
            {companyName ? (
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                {companyName}
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={() => router.push("/settings" as Href)}
            style={{
              width: 42, height: 42, borderRadius: 21,
              backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
              alignItems: "center", justifyContent: "center", marginRight: 8,
            }}
          >
            <Ionicons name="settings-outline" size={20} color={colors.mutedForeground} />
          </Pressable>
          <Pressable
            onPress={() => { void signOut(); }}
            style={{
              width: 42, height: 42, borderRadius: 21,
              backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
              alignItems: "center", justifyContent: "center",
            }}
          >
            <Ionicons name="log-out-outline" size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {/* ── No-push-token banner (owner only) ──────────────────────────── */}
        {isOwner && user?.hasPushToken === false && user?.pushNotificationsEnabled === true ? (
          <Pressable
            onPress={() => router.push("/settings" as Href)}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              padding: 14,
              borderRadius: 12,
              backgroundColor: "#ef444414",
              borderWidth: 1,
              borderColor: "#ef444440",
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Ionicons name="warning-outline" size={20} color="#ef4444" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                Critical alerts not reaching you
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                Push is enabled but your device isn't registered — tap to fix in Settings
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#ef4444" />
          </Pressable>
        ) : null}

        {/* ── Role-specific hero CTA ──────────────────────────────────────── */}
        {isTech ? (
          <HeroCTA
            icon="camera"
            title="Start AI Inspection"
            subtitle="Capture evidence and get instant analysis"
            onPress={() => router.push("/new-inspection" as Href)}
          />
        ) : isSales ? (
          <HeroCTA
            icon="scan"
            title="Start Property Scan"
            subtitle="AI identifies vulnerabilities and recommends services"
            onPress={() => router.push("/new-inspection" as Href)}
          />
        ) : isManager ? (
          <HeroCTA
            icon="checkmark-done-circle-outline"
            title="Review Yesterday's Work"
            subtitle={
              pendingApprovals > 0
                ? `${pendingApprovals} inspection${pendingApprovals === 1 ? "" : "s"} waiting · target <20 min`
                : "All caught up — no pending reviews"
            }
            onPress={() => router.push("/(tabs)/review" as Href)}
          />
        ) : isSoloOperator ? (
          /* Owner — solo operator: field-execution first */
          <HeroCTA
            icon="camera"
            title="Start Today's Work"
            subtitle="Run an AI inspection · your business grows one job at a time"
            onPress={() => router.push("/new-inspection" as Href)}
          />
        ) : (
          /* Owner — multi-operator: executive summary */
          <HeroCTA
            icon="stats-chart-outline"
            title="Daily Executive Briefing"
            subtitle="Company-wide performance summary · ~30 min"
            onPress={() => router.push("/(tabs)/reports" as Href)}
          />
        )}

        {/* ── Upload Training Photos — visible to all roles ───────────────── */}
        <UploadTrainingPhotosCard router={router} />

        {/* ── Integrated Route Calendar — technician / sales / manager ────── */}
        {isTech || isSales || isManager ? (
          <IntegratedRouteCalendar router={router} showTechnicianNames={isManager} />
        ) : null}

        {/* ── Owner KPI strip ─────────────────────────────────────────────── */}
        {isOwner && ownerKpis.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {ownerKpis.map((kpi) => (
              <KpiCard
                key={kpi.label}
                icon={kpi.icon}
                value={kpi.value}
                label={kpi.label}
                tone={kpi.tone}
                onPress={kpi.onPress}
              />
            ))}
          </View>
        ) : null}

        {/* ── Subscription status card (Owner only) ───────────────────────── */}
        {isOwner ? (
          license && !license.isActive ? (
            /* No active subscription — prompt to subscribe */
            <Pressable
              onPress={() => router.push("/billing" as Href)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                padding: 14,
                borderRadius: 12,
                backgroundColor: colors.warning + "14",
                borderWidth: 1,
                borderColor: colors.warning + "44",
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Ionicons name="card-outline" size={20} color={colors.warning ?? "#d97706"} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                  No active subscription
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                  Tap to choose a plan and unlock full access
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : license?.seatOverage != null && license.seatOverage > 0 ? (
            /* Seat overage warning for Growth Team */
            <Pressable
              onPress={() => router.push("/billing" as Href)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                padding: 14,
                borderRadius: 12,
                backgroundColor: colors.warning + "14",
                borderWidth: 1,
                borderColor: colors.warning + "44",
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Ionicons name="people-outline" size={20} color={colors.warning ?? "#d97706"} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                  {license.seatOverage} unbilled seat{license.seatOverage === 1 ? "" : "s"}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                  Tap to update your seat count
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
            </Pressable>
          ) : license?.isActive ? (
            /* Active subscription — manage link */
            <Pressable
              onPress={() => router.push("/billing" as Href)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                padding: 12,
                borderRadius: 10,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.border,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Ionicons name="card-outline" size={16} color={colors.primary} />
              <Text style={{ color: colors.primary, fontFamily: "Inter_500Medium", fontSize: 13, flex: 1 }}>
                {license.tier === "solo" ? "Solo Operator plan active" : "Growth Team plan active"}
                {license.tier === "growth"
                  ? ` · ${license.billedSeats} additional seat${license.billedSeats === 1 ? "" : "s"}`
                  : ""}
              </Text>
              <Ionicons name="chevron-forward" size={14} color={colors.mutedForeground} />
            </Pressable>
          ) : null
        ) : null}

        {/* ── Owner comms strip (multi-operator only) ─────────────────────── */}
        {isOwner && !isSoloOperator ? <OwnerCommsStrip /> : null}

        {/* ── Role-specific quick tools ───────────────────────────────────── */}
        {isSales   ? <SalesTools router={router} /> : null}
        {isManager ? <ManagerTools pendingCount={pendingApprovals} router={router} /> : null}
        {isOwner && isSoloOperator ? <SoloOwnerTools router={router} /> : null}

        {/* ── Role-adaptive briefing (server-shaped stats + lists) ─────────── */}
        {briefing.data ? (
          <RoleBriefingView briefing={briefing.data} />
        ) : briefing.isLoading ? null : (
          /* Briefing unavailable fallback — generic dashboard metrics */
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {[
              { label: "Total", value: dash.data?.totalInspections ?? 0, icon: "albums-outline" as const, tone: colors.primary },
              { label: "Completed", value: dash.data?.completedInspections ?? 0, icon: "checkmark-done-outline" as const, tone: colors.success ?? "#16a34a" },
              { label: "Open", value: dash.data?.openInspections ?? 0, icon: "time-outline" as const, tone: colors.warning ?? "#d97706" },
            ].map((s) => (
              <Card key={s.label} style={{ width: isCompact ? "47.5%" : "30%", gap: 8 }}>
                <Ionicons name={s.icon} size={22} color={s.tone} />
                <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 26 }}>
                  {s.value}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                  {s.label}
                </Text>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
