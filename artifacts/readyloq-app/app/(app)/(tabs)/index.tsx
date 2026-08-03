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
} from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { type Href, useRouter } from "expo-router";
import React from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { RoleBriefingView } from "@/components/briefing/RoleBriefingView";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useSignOut } from "@/hooks/useSignOut";
import { useLicenseStatus } from "@/hooks/useLicenseStatus";
import { useWindowSizeClass } from "@/hooks/useWindowSizeClass";
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

// ─── Role-specific quick-action sections ─────────────────────────────────────

/** Technician tools: bulk upload + dataset ingestion. */
function TechnicianTools({ router }: { router: ReturnType<typeof useRouter> }) {
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <ToolTile
        icon="cloud-upload-outline"
        title="Upload Training Photos"
        subtitle="Add historical data to dataset"
        onPress={() => router.push("/dataset/bulk-upload" as Href)}
      />
    </View>
  );
}

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

  const briefing = useQuery(getGetBriefingQueryOptions());
  const dash     = useQuery(getGetAnalyticsDashboardQueryOptions());
  // License status — loaded for owners to surface subscription prompts/warnings.
  const { data: license } = useLicenseStatus(isOwner);

  const refreshing = briefing.isRefetching || dash.isRefetching;
  const onRefresh  = () => { briefing.refetch(); dash.refetch(); };

  const firstName = clerkUser?.firstName || role.charAt(0).toUpperCase() + role.slice(1);

  // Manager pending approvals count (from briefing).
  const pendingApprovals = briefing.data?.manager?.pendingApprovals ?? 0;

  // Owner mode flags.
  const isSoloOperator = briefing.data?.owner?.isSoloOperator ?? false;

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
            value: briefing.data.owner.kpis.openOpportunities,
            label: "Open\nopps",
            tone: colors.info ?? "#3b82f6",
            onPress: () => { filterIntent.set("reports", "opportunities"); router.push("/(tabs)/reports" as Href); },
          },
          {
            icon: "cash-outline" as const,
            value: formatPipelineValue(briefing.data.owner.kpis.pipelineValue),
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
            value: briefing.data.owner.kpis.openOpportunities,
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
            onPress={() => router.push("/about" as Href)}
            style={{
              width: 42, height: 42, borderRadius: 21,
              backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
              alignItems: "center", justifyContent: "center", marginRight: 8,
            }}
          >
            <Ionicons name="information-circle-outline" size={20} color={colors.mutedForeground} />
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
        {isTech    ? <TechnicianTools router={router} /> : null}
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
