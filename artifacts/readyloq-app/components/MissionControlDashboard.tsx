/**
 * MissionControlDashboard — Owner-only command-center home screen.
 *
 * Replaces the standard owner home view with a dark tactical HUD styled after
 * the operator's mission-control reference. All data flows from the existing
 * /api/briefing endpoint (OwnerBriefing shape) — no new API work required.
 *
 * Layout:
 *  1. Header     — "MISSION CONTROL" badge, company name, settings/sign-out
 *  2. Status bar — live pulse, generated-at timestamp, team size
 *  3. KPI tiles  — 6 stat cards from OwnerBriefingKpis (2-col compact / 3-col wide)
 *  4. Alert rail — BriefingAlerts sorted critical → warning → info
 *  5. Quick actions — Start Inspection, Reports, Pipeline
 *  6. Briefing body — daily summary from kpis + subscription status
 */

import { Ionicons } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
import { formatMoney } from "@/lib/utils/money";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Screen } from "@/components/ui/Screen";
import { useWindowSizeClass } from "@/hooks/useWindowSizeClass";
import { type LicenseStatus } from "@/hooks/useLicenseStatus";
import { filterIntent } from "@/lib/filterIntent";
import type {
  BriefingAlert,
  OwnerBriefingKpis,
  RoleBriefing,
} from "@/lib/api-client";
import type { AgentRegistryEntry } from "@platform/agent-registry";
import { ExecutiveBriefingCard } from "@/components/briefing/ExecutiveBriefingCard";

// ─── Palette ─────────────────────────────────────────────────────────────────

const MC = {
  bg:         "#08090E",
  surface:    "#10141F",
  border:     "#1C2235",
  accent:     "#17c4d3",
  accentDim:  "rgba(23,196,211,0.12)",
  text:       "#FFFFFF",
  muted:      "rgba(255,255,255,0.45)",
  dimmer:     "rgba(255,255,255,0.22)",
  critical:   "#ef4444",
  warning:    "#f59e0b",
  info:       "#60a5fa",
  success:    "#22c55e",
  grid:       "rgba(255,255,255,0.025)",
} as const;

// ─── Live pulse ───────────────────────────────────────────────────────────────

function LivePulse() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.25, duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        Animated.timing(opacity, { toValue: 1,    duration: 800, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);
  return (
    <Animated.View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: MC.success, opacity }} />
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

function alertColor(severity: BriefingAlert["severity"]): string {
  return severity === "critical" ? MC.critical : severity === "warning" ? MC.warning : MC.info;
}

const ALERT_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  approvals_aging:      "hourglass-outline",
  quality_low:          "trending-down-outline",
  high_risk:            "warning-outline",
  stale_pipeline:       "snow-outline",
  share_links_expiring: "link-outline",
};

const ALERT_FILTER: Record<string, string> = {
  approvals_aging: "pending_approvals",
  high_risk:       "high_risk",
  quality_low:     "low_quality",
  stale_pipeline:  "opportunities",
};

/**
 * Alert types that should deep-link into the Management Report Audit screen
 * instead of the standard reports tab. The value is the AuditFilter param to
 * pass (matches the `filter` URL param accepted by reports-detail.tsx).
 */
const AUDIT_DEEP_LINK: Record<string, string> = {
  approvals_aging: "pending",
  high_risk:       "critical",
};

// ─── KPI Tile ─────────────────────────────────────────────────────────────────

interface KpiTileProps {
  label:   string;
  value:   string | number;
  icon:    keyof typeof Ionicons.glyphMap;
  accent?: string;
  onPress?: () => void;
  flex?:   number;
}

function KpiTile({ label, value, icon, accent = MC.accent, onPress, flex = 1 }: KpiTileProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.kpiTile,
        { flex, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <View style={[styles.kpiIconWrap, { backgroundColor: `${accent}18` }]}>
        <Ionicons name={icon} size={15} color={accent} />
      </View>
      <Text style={[styles.kpiValue, { color: MC.text }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.kpiLabel} numberOfLines={2}>{label}</Text>
    </Pressable>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ children, right }: { children: string; right?: React.ReactNode }) {
  return (
    <View style={styles.sectionLabelRow}>
      <View style={styles.sectionLabelLine} />
      <Text style={styles.sectionLabelText}>{children}</Text>
      {right ? <View style={{ marginLeft: "auto" }}>{right}</View> : null}
    </View>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface MissionControlDashboardProps {
  firstName:        string;
  companyName:      string | undefined;
  isSoloOperator:   boolean;
  briefing:         RoleBriefing | undefined;
  briefingLoading:  boolean;
  refreshing:       boolean;
  pipelineMetrics:  { pipelineValueFormatted: string; openOpportunitiesCount: number };
  license:          LicenseStatus | null | undefined;
  /** Live agent roster from @platform/agent-registry + VYBE_HQ sync. */
  agents?:          AgentRegistryEntry[];
  /** True when the last remote agent-status sync failed (agents still render from cache). */
  agentsSyncFailed?: boolean;
  /**
   * ISO timestamp of the most recent push delivery failure for this owner, or
   * null/undefined when no failure is recorded. When non-null a dismissible
   * banner is shown prompting the owner to re-enable alerts.
   */
  pushLastFailedAt?: string | null;
  /** Called when the owner taps "Dismiss" on the push-failure banner. */
  onDismissPushFailure?: () => void;
  onRefresh:        () => void;
  onSignOut:        () => void;
}

// ─── Main component ───────────────────────────────────────────────────────────

// ─── Agent status helpers ─────────────────────────────────────────────────────

function agentStatusColor(status: AgentRegistryEntry["status"]): string {
  switch (status) {
    case "active":  return MC.success;
    case "busy":    return MC.info;
    case "standby": return MC.warning;
    case "offline": return MC.dimmer;
  }
}

function agentStatusLabel(status: AgentRegistryEntry["status"]): string {
  switch (status) {
    case "active":  return "ACTIVE";
    case "busy":    return "BUSY";
    case "standby": return "STANDBY";
    case "offline": return "OFFLINE";
  }
}

// ─── Agent row ────────────────────────────────────────────────────────────────

function AgentRow({ entry }: { entry: AgentRegistryEntry }) {
  const { agent, status } = entry;
  const color = agentStatusColor(status);
  return (
    <View style={styles.agentRow}>
      {/* Avatar */}
      <View style={[styles.agentAvatar, { backgroundColor: `${agent.accentColor}20`, borderColor: `${agent.accentColor}40` }]}>
        <Text style={[styles.agentInitials, { color: agent.accentColor }]}>{agent.initials}</Text>
      </View>

      {/* Identity */}
      <View style={{ flex: 1, gap: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={styles.agentName}>{agent.name}</Text>
          {agent.isExecutionEngine ? (
            <View style={[styles.agentEngineBadge, { backgroundColor: `${MC.accent}18`, borderColor: `${MC.accent}33` }]}>
              <Text style={[styles.agentEngineBadgeText, { color: MC.accent }]}>ENGINE</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.agentRole}>{agent.role}</Text>
      </View>

      {/* Status dot + label */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
        <Text style={[styles.agentStatus, { color: color }]}>{agentStatusLabel(status)}</Text>
      </View>
    </View>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MissionControlDashboard({
  firstName,
  companyName,
  isSoloOperator,
  briefing,
  briefingLoading,
  refreshing,
  pipelineMetrics,
  license,
  agents,
  agentsSyncFailed,
  pushLastFailedAt,
  onDismissPushFailure,
  onRefresh,
  onSignOut,
}: MissionControlDashboardProps) {
  const router       = useRouter();
  const { isCompact } = useWindowSizeClass();

  const ownerData  = briefing?.owner;
  const kpis       = ownerData?.kpis;
  const alerts     = ownerData?.alerts ?? [];
  const teamSize   = ownerData?.teamSize ?? 0;
  const generatedAt = briefing?.generatedAt ?? "";

  // Sort alerts: critical first, then warning, then info.
  const sortedAlerts = [...alerts].sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
  });

  const toReports = (filter: string) => () => {
    filterIntent.set("reports", filter);
    router.push("/(tabs)/reports" as Href);
  };

  const tileColumns = isCompact ? 2 : 3;
  const tileGap     = 8;

  return (
    <Screen style={{ backgroundColor: MC.bg }}>
      <ScrollView
        style={{ backgroundColor: MC.bg }}
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={MC.accent}
            colors={[MC.accent]}
          />
        }
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={styles.headerBadgeRow}>
              <View style={styles.headerBadge}>
                <Text style={styles.headerBadgeText}>MISSION CONTROL</Text>
              </View>
              {isSoloOperator ? null : (
                <View style={[styles.headerBadge, { backgroundColor: "rgba(79,127,255,0.12)", borderColor: "rgba(79,127,255,0.25)" }]}>
                  <Text style={[styles.headerBadgeText, { color: "#4F7FFF" }]}>MULTI-OPERATOR</Text>
                </View>
              )}
            </View>
            <Text style={styles.headerName}>{firstName}</Text>
            {companyName ? (
              <Text style={styles.headerCompany}>{companyName.toUpperCase()}</Text>
            ) : null}
          </View>

          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable
              onPress={() => router.push("/settings" as Href)}
              style={styles.headerBtn}
            >
              <Ionicons name="settings-outline" size={18} color={MC.muted} />
            </Pressable>
            <Pressable onPress={onSignOut} style={styles.headerBtn}>
              <Ionicons name="log-out-outline" size={18} color={MC.muted} />
            </Pressable>
          </View>
        </View>

        {/* ── Status bar ──────────────────────────────────────────────────── */}
        <View style={styles.statusBar}>
          <LivePulse />
          <Text style={styles.statusText}>LIVE</Text>
          <View style={styles.statusDivider} />
          {generatedAt ? (
            <Text style={styles.statusText}>Updated {formatTime(generatedAt)}</Text>
          ) : null}
          <View style={styles.statusDivider} />
          {teamSize > 0 ? (
            <Text style={styles.statusText}>{teamSize} technician{teamSize === 1 ? "" : "s"}</Text>
          ) : (
            <Text style={styles.statusText}>Solo operator</Text>
          )}
        </View>

        {/* ── Push-failure banner ──────────────────────────────────────────── */}
        {pushLastFailedAt ? (
          <View style={styles.pushFailBanner}>
            <Ionicons name="notifications-off-outline" size={18} color={MC.warning} style={{ marginTop: 1 }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.pushFailTitle}>Alert delivery failed</Text>
              <Text style={styles.pushFailSub}>
                A critical-risk push notification couldn't be delivered. Go to Settings to
                re-enable alerts and re-register your device.
              </Text>
            </View>
            <View style={{ gap: 6, alignItems: "flex-end" }}>
              <Pressable
                onPress={() => router.push("/settings" as Href)}
                style={({ pressed }) => [styles.pushFailBtn, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={styles.pushFailBtnText}>Fix</Text>
              </Pressable>
              <Pressable
                onPress={onDismissPushFailure}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 2 })}
              >
                <Text style={styles.pushFailDismiss}>Dismiss</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* ── KPI tiles ───────────────────────────────────────────────────── */}
        <SectionLabel>PERFORMANCE</SectionLabel>
        {kpis ? (
          <View style={[styles.tileGrid, { gap: tileGap }]}>
            {/* Row 1 */}
            <View style={[styles.tileRow, { gap: tileGap }]}>
              <KpiTile
                label={"COMPLETIONS\n7 DAYS"}
                value={kpis.completions7d}
                icon="checkmark-done-outline"
                accent={MC.success}
                onPress={toReports("7d")}
              />
              <KpiTile
                label={"COMPLETIONS\n30 DAYS"}
                value={kpis.completions30d}
                icon="calendar-outline"
                accent={MC.accent}
                onPress={toReports("30d")}
              />
              {!isCompact ? (
                <KpiTile
                  label={"OPEN\nOPPORTUNITIES"}
                  value={kpis.openOpportunities}
                  icon="briefcase-outline"
                  accent={MC.info}
                  onPress={toReports("opportunities")}
                />
              ) : null}
            </View>
            {/* Row 2 */}
            <View style={[styles.tileRow, { gap: tileGap }]}>
              {isCompact ? (
                <KpiTile
                  label={"OPEN\nOPPORTUNITIES"}
                  value={kpis.openOpportunities}
                  icon="briefcase-outline"
                  accent={MC.info}
                  onPress={toReports("opportunities")}
                />
              ) : null}
              <KpiTile
                label={"PIPELINE\nVALUE"}
                value={formatMoney(kpis.pipelineValue)}
                icon="trending-up-outline"
                accent={MC.success}
                onPress={toReports("opportunities")}
              />
              <KpiTile
                label={"AVG QUALITY\n30 DAYS"}
                value={kpis.avgQualityScore30d != null ? `${kpis.avgQualityScore30d}%` : "—"}
                icon="ribbon-outline"
                accent={MC.accent}
                onPress={toReports("quality")}
              />
              {!isCompact ? (
                <KpiTile
                  label={"APPROVED\nSUMMARIES"}
                  value={kpis.approvedSummaries30d}
                  icon="shield-checkmark-outline"
                  accent={MC.success}
                  onPress={toReports("approved")}
                />
              ) : null}
            </View>
            {/* Compact only: row 3 */}
            {isCompact ? (
              <View style={[styles.tileRow, { gap: tileGap }]}>
                <KpiTile
                  label={"APPROVED\nSUMMARIES"}
                  value={kpis.approvedSummaries30d}
                  icon="shield-checkmark-outline"
                  accent={MC.success}
                  onPress={toReports("approved")}
                />
                <KpiTile
                  label={"ACTIVE\nALERTS"}
                  value={sortedAlerts.length}
                  icon="alert-circle-outline"
                  accent={sortedAlerts.some(a => a.severity === "critical") ? MC.critical : sortedAlerts.length > 0 ? MC.warning : MC.success}
                />
              </View>
            ) : (
              /* Wide: put alert count in its own tile in row 1 */
              null
            )}
          </View>
        ) : briefingLoading ? (
          <View style={[styles.skeleton, { height: 160 }]} />
        ) : null}

        {/* ── Alert rail ──────────────────────────────────────────────────── */}
        {sortedAlerts.length > 0 ? (
          <>
            <SectionLabel>
              {`ALERTS · ${sortedAlerts.length}`}
            </SectionLabel>
            <View style={{ gap: 6 }}>
              {sortedAlerts.map((alert, i) => {
                const color     = alertColor(alert.severity);
                const icon      = ALERT_ICONS[alert.type] ?? "alert-circle-outline";
                const filterKey = ALERT_FILTER[alert.type];
                return (
                  <Pressable
                    key={`${alert.type}-${i}`}
                    onPress={() => {
                      const auditFilter = AUDIT_DEEP_LINK[alert.type];
                      if (auditFilter) {
                        router.push(`/reports-detail?filter=${auditFilter}` as Href);
                      } else {
                        if (filterKey) filterIntent.set("reports", filterKey);
                        router.push("/(tabs)/reports" as Href);
                      }
                    }}
                    style={({ pressed }) => [
                      styles.alertRow,
                      { borderLeftColor: color, opacity: pressed ? 0.75 : 1 },
                    ]}
                  >
                    <Ionicons name={icon} size={15} color={color} style={{ marginTop: 1 }} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[styles.alertMessage, { color: MC.text }]}>{alert.message}</Text>
                      <Text style={[styles.alertMeta, { color: color }]}>
                        {alert.severity.toUpperCase()} · Tap to review
                      </Text>
                    </View>
                    {alert.count > 1 ? (
                      <View style={[styles.alertBadge, { backgroundColor: `${color}20`, borderColor: `${color}40` }]}>
                        <Text style={[styles.alertBadgeText, { color }]}>{alert.count}</Text>
                      </View>
                    ) : null}
                    <Ionicons name="chevron-forward" size={14} color={MC.dimmer} />
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : kpis ? (
          /* All-clear rail */
          <View style={styles.allClearRow}>
            <Ionicons name="checkmark-circle-outline" size={15} color={MC.success} />
            <Text style={[styles.statusText, { color: MC.success }]}>ALL CLEAR</Text>
            <Text style={styles.statusText}>No items need your attention</Text>
          </View>
        ) : null}

        {/* ── Quick actions ────────────────────────────────────────────────── */}
        <SectionLabel>QUICK ACTIONS</SectionLabel>
        <View style={styles.actionsRow}>
          <Pressable
            onPress={() => router.push("/new-inspection" as Href)}
            style={({ pressed }) => [styles.actionBtn, styles.actionBtnPrimary, { opacity: pressed ? 0.8 : 1 }]}
          >
            <Ionicons name="camera-outline" size={16} color={MC.bg} />
            <Text style={[styles.actionBtnText, { color: MC.bg }]}>Start Inspection</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/(tabs)/reports" as Href)}
            style={({ pressed }) => [styles.actionBtn, styles.actionBtnOutline, { opacity: pressed ? 0.8 : 1 }]}
          >
            <Ionicons name="document-text-outline" size={16} color={MC.accent} />
            <Text style={[styles.actionBtnText, { color: MC.accent }]}>Reports</Text>
          </Pressable>

          <Pressable
            onPress={toReports("opportunities")}
            style={({ pressed }) => [styles.actionBtn, styles.actionBtnOutline, { opacity: pressed ? 0.8 : 1 }]}
          >
            <Ionicons name="trending-up-outline" size={16} color={MC.accent} />
            <Text style={[styles.actionBtnText, { color: MC.accent }]}>Pipeline</Text>
          </Pressable>

          <Pressable
            onPress={() => router.push("/reports-detail?filter=pending" as Href)}
            style={({ pressed }) => [styles.actionBtn, styles.actionBtnOutline, { opacity: pressed ? 0.8 : 1 }]}
          >
            <Ionicons name="clipboard-outline" size={16} color={MC.accent} />
            <Text style={[styles.actionBtnText, { color: MC.accent }]}>Report Audit</Text>
          </Pressable>
        </View>

        {/* ── VYBE Agents ─────────────────────────────────────────────────── */}
        {agents && agents.length > 0 ? (
          <>
            <SectionLabel
              right={
                agentsSyncFailed ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Ionicons name="cloud-offline-outline" size={11} color={MC.dimmer} />
                    <Text style={[styles.statusText, { color: MC.dimmer, fontSize: 10 }]}>CACHED</Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: MC.success }} />
                    <Text style={[styles.statusText, { color: MC.success, fontSize: 10 }]}>LIVE</Text>
                  </View>
                )
              }
            >
              AGENTS
            </SectionLabel>
            <View style={styles.agentList}>
              {agents.map(entry => (
                <AgentRow key={entry.agent.id} entry={entry} />
              ))}
            </View>
          </>
        ) : null}

        {/* ── Daily briefing body ──────────────────────────────────────────── */}
        <SectionLabel>DAILY BRIEFING</SectionLabel>

        {/* Yesterday's aggregate executive digest — owners only, self-fetching */}
        <ExecutiveBriefingCard />

        {isSoloOperator ? (
          /* Solo: field-execution summary */
          <View style={styles.briefingCard}>
            <View style={styles.briefingRow}>
              <Ionicons name="person-outline" size={15} color={MC.accent} />
              <Text style={styles.briefingRowText}>Solo operator mode · all jobs run by you</Text>
            </View>
            {kpis ? (
              <>
                <View style={styles.briefingDivider} />
                <View style={styles.briefingRow}>
                  <Ionicons name="pulse-outline" size={15} color={MC.success} />
                  <Text style={styles.briefingRowText}>
                    {kpis.completions7d} completed this week · {kpis.openOpportunities} open {kpis.openOpportunities === 1 ? "opportunity" : "opportunities"}
                  </Text>
                </View>
                {kpis.avgQualityScore30d != null ? (
                  <>
                    <View style={styles.briefingDivider} />
                    <View style={styles.briefingRow}>
                      <Ionicons name="ribbon-outline" size={15} color={MC.accent} />
                      <Text style={styles.briefingRowText}>
                        {kpis.avgQualityScore30d}% avg quality score over 30 days
                      </Text>
                    </View>
                  </>
                ) : null}
                {kpis.pipelineValue > 0 ? (
                  <>
                    <View style={styles.briefingDivider} />
                    <View style={styles.briefingRow}>
                      <Ionicons name="cash-outline" size={15} color={MC.success} />
                      <Text style={styles.briefingRowText}>
                        {formatMoney(kpis.pipelineValue)} in exclusion pipeline · {kpis.openOpportunities} open
                      </Text>
                    </View>
                  </>
                ) : null}
              </>
            ) : null}
          </View>
        ) : (
          /* Multi-op: team summary */
          <View style={styles.briefingCard}>
            <View style={styles.briefingRow}>
              <Ionicons name="people-outline" size={15} color={MC.accent} />
              <Text style={styles.briefingRowText}>
                {teamSize} technician{teamSize === 1 ? "" : "s"} on your team
              </Text>
            </View>
            {kpis ? (
              <>
                <View style={styles.briefingDivider} />
                <View style={styles.briefingRow}>
                  <Ionicons name="checkmark-done-outline" size={15} color={MC.success} />
                  <Text style={styles.briefingRowText}>
                    {kpis.completions7d} inspections completed in the last 7 days
                  </Text>
                </View>
                {kpis.approvedSummaries30d > 0 ? (
                  <>
                    <View style={styles.briefingDivider} />
                    <View style={styles.briefingRow}>
                      <Ionicons name="shield-checkmark-outline" size={15} color={MC.success} />
                      <Text style={styles.briefingRowText}>
                        {kpis.approvedSummaries30d} client summaries approved this month
                      </Text>
                    </View>
                  </>
                ) : null}
                {kpis.pipelineValue > 0 ? (
                  <>
                    <View style={styles.briefingDivider} />
                    <View style={styles.briefingRow}>
                      <Ionicons name="trending-up-outline" size={15} color={MC.success} />
                      <Text style={styles.briefingRowText}>
                        {formatMoney(kpis.pipelineValue)} exclusion pipeline across {kpis.openOpportunities} open {kpis.openOpportunities === 1 ? "opportunity" : "opportunities"}
                      </Text>
                    </View>
                  </>
                ) : null}
                {kpis.avgQualityScore30d != null ? (
                  <>
                    <View style={styles.briefingDivider} />
                    <View style={styles.briefingRow}>
                      <Ionicons name="ribbon-outline" size={15} color={MC.accent} />
                      <Text style={styles.briefingRowText}>
                        Company avg quality {kpis.avgQualityScore30d}% over the last 30 days
                      </Text>
                    </View>
                  </>
                ) : null}
              </>
            ) : null}
          </View>
        )}

        {/* ── Subscription status ──────────────────────────────────────────── */}
        {license && !license.isActive ? (
          <Pressable
            onPress={() => router.push("/billing" as Href)}
            style={({ pressed }) => [styles.licenseRow, styles.licenseWarning, { opacity: pressed ? 0.8 : 1 }]}
          >
            <Ionicons name="card-outline" size={16} color={MC.warning} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.licenseTitle, { color: MC.text }]}>No active subscription</Text>
              <Text style={[styles.licenseSub, { color: MC.muted }]}>Tap to choose a plan</Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={MC.muted} />
          </Pressable>
        ) : license?.seatOverage != null && license.seatOverage > 0 ? (
          <Pressable
            onPress={() => router.push("/billing" as Href)}
            style={({ pressed }) => [styles.licenseRow, styles.licenseWarning, { opacity: pressed ? 0.8 : 1 }]}
          >
            <Ionicons name="people-outline" size={16} color={MC.warning} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.licenseTitle, { color: MC.text }]}>
                {license.seatOverage} unbilled seat{license.seatOverage === 1 ? "" : "s"}
              </Text>
              <Text style={[styles.licenseSub, { color: MC.muted }]}>Tap to update your seat count</Text>
            </View>
            <Ionicons name="chevron-forward" size={14} color={MC.muted} />
          </Pressable>
        ) : license?.isActive ? (
          <Pressable
            onPress={() => router.push("/billing" as Href)}
            style={({ pressed }) => [styles.licenseRow, { opacity: pressed ? 0.8 : 1 }]}
          >
            <View style={[styles.licenseActiveDot, { backgroundColor: MC.success }]} />
            <Text style={[styles.licenseTitle, { color: MC.muted, flex: 1 }]}>
              {license.tier === "solo" ? "Solo Operator plan" : "Growth Team plan"}
              {license.tier === "growth" && license.billedSeats ? ` · ${license.billedSeats} seat${license.billedSeats === 1 ? "" : "s"}` : ""}
            </Text>
            <Ionicons name="chevron-forward" size={12} color={MC.dimmer} />
          </Pressable>
        ) : null}

      </ScrollView>
    </Screen>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scroll: {
    padding: 16,
    paddingBottom: 40,
    gap: 14,
  },

  // Header
  header:         { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headerBadgeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  headerBadge:    {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: "rgba(23,196,211,0.12)",
    borderWidth: 1,
    borderColor: "rgba(23,196,211,0.3)",
  },
  headerBadgeText: {
    color: MC.accent,
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    letterSpacing: 1.2,
  },
  headerName:    { color: MC.text,  fontFamily: "Inter_700Bold",    fontSize: 22, letterSpacing: -0.5 },
  headerCompany: { color: MC.muted, fontFamily: "Inter_400Regular", fontSize: 11, letterSpacing: 1.2, marginTop: 1 },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: MC.surface,
    borderWidth: 1,
    borderColor: MC.border,
    alignItems: "center",
    justifyContent: "center",
  },

  // Status bar
  statusBar:    { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: MC.surface, borderRadius: 8, borderWidth: 1, borderColor: MC.border },
  statusText:   { color: MC.muted, fontFamily: "Inter_400Regular", fontSize: 11, letterSpacing: 0.5 },
  statusDivider: { width: 1, height: 10, backgroundColor: MC.border },

  // Section labels
  sectionLabelRow:  { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionLabelLine: { width: 3, height: 14, backgroundColor: MC.accent, borderRadius: 2 },
  sectionLabelText: { color: MC.accent, fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 1.6 },

  // KPI tiles
  tileGrid: { gap: 8 },
  tileRow:  { flexDirection: "row" },
  kpiTile:  {
    flex: 1,
    backgroundColor: MC.surface,
    borderWidth: 1,
    borderColor: MC.border,
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  kpiIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  kpiValue: { fontFamily: "Inter_700Bold", fontSize: 22, letterSpacing: -0.5 },
  kpiLabel: { color: MC.muted, fontFamily: "Inter_400Regular", fontSize: 9, letterSpacing: 0.8, lineHeight: 13 },

  // All-clear
  allClearRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: "rgba(34,197,94,0.06)", borderRadius: 8, borderWidth: 1, borderColor: "rgba(34,197,94,0.15)" },

  // Alerts
  alertRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    backgroundColor: MC.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: MC.border,
    borderLeftWidth: 3,
  },
  alertMessage:  { color: MC.text,  fontFamily: "Inter_500Medium",   fontSize: 13, lineHeight: 18 },
  alertMeta:     { fontFamily: "Inter_700Bold", fontSize: 9, letterSpacing: 0.8 },
  alertBadge:    { borderRadius: 6, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, alignSelf: "center" },
  alertBadgeText: { fontFamily: "Inter_700Bold", fontSize: 11 },

  // Quick actions
  actionsRow:       { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  actionBtn:        { width: "47%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, paddingHorizontal: 8, borderRadius: 10 },
  actionBtnPrimary: { backgroundColor: MC.accent },
  actionBtnOutline: { backgroundColor: MC.surface, borderWidth: 1, borderColor: MC.accent + "55" },
  actionBtnText:    { fontFamily: "Inter_600SemiBold", fontSize: 12 },

  // Briefing body
  briefingCard:    { backgroundColor: MC.surface, borderWidth: 1, borderColor: MC.border, borderRadius: 10, overflow: "hidden" },
  briefingRow:     { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12 },
  briefingRowText: { color: MC.muted, fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19, flex: 1 },
  briefingDivider: { height: 1, backgroundColor: MC.border, marginHorizontal: 12 },

  // License
  licenseRow:     { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: MC.surface, borderRadius: 10, borderWidth: 1, borderColor: MC.border },
  licenseWarning: { borderColor: `${MC.warning}33`, backgroundColor: `${MC.warning}08` },
  licenseActiveDot: { width: 7, height: 7, borderRadius: 4 },
  licenseTitle:   { fontFamily: "Inter_600SemiBold", fontSize: 13 },
  licenseSub:     { fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 1 },

  // Push-failure banner
  pushFailBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    backgroundColor: `${MC.warning}0D`,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: `${MC.warning}40`,
    borderLeftWidth: 3,
    borderLeftColor: MC.warning,
  },
  pushFailTitle:   { color: MC.text,    fontFamily: "Inter_600SemiBold", fontSize: 13 },
  pushFailSub:     { color: MC.muted,   fontFamily: "Inter_400Regular",  fontSize: 12, lineHeight: 17 },
  pushFailBtn: {
    backgroundColor: MC.warning,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pushFailBtnText:  { color: "#000", fontFamily: "Inter_700Bold", fontSize: 11 },
  pushFailDismiss:  { color: MC.muted, fontFamily: "Inter_400Regular", fontSize: 11 },

  // Skeleton
  skeleton: { backgroundColor: MC.surface, borderRadius: 10, borderWidth: 1, borderColor: MC.border },

  // Agents
  agentList: { gap: 1, backgroundColor: MC.surface, borderRadius: 10, borderWidth: 1, borderColor: MC.border, overflow: "hidden" },
  agentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: MC.border,
  },
  agentAvatar: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  agentInitials: { fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 0.5 },
  agentName:     { color: MC.text, fontFamily: "Inter_600SemiBold", fontSize: 13 },
  agentRole:     { color: MC.muted, fontFamily: "Inter_400Regular", fontSize: 11 },
  agentStatus:   { fontFamily: "Inter_700Bold", fontSize: 9, letterSpacing: 0.8 },
  agentEngineBadge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
    borderWidth: 1,
  },
  agentEngineBadgeText: { fontFamily: "Inter_700Bold", fontSize: 8, letterSpacing: 1 },
});
