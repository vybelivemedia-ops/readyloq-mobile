/**
 * Role-adaptive home dashboard. The server decides the caller's role and
 * returns exactly one populated section (`GET /briefing`); this component just
 * renders whichever section arrived. No client-side role logic — the server's
 * role mapping is the single source of truth.
 */

import { Ionicons } from "@expo/vector-icons";
import { type RoleBriefing } from "@/lib/api-client";
import { type Href, useRouter } from "expo-router";
import React from "react";
import { Text, View } from "react-native";

import { Card } from "@/components/ui/Card";
import { useColors } from "@/hooks/useColors";
import { formatRelative } from "@/constants/inspection";
import { filterIntent } from "@/lib/filterIntent";

import { EmptyCard, formatMoney, ListRow, SectionTitle, StatGrid } from "./BriefingShared";

export function RoleBriefingView({ briefing }: { briefing: RoleBriefing }) {
  if (briefing.role === "sales" && briefing.sales) return <SalesSection data={briefing.sales} />;
  if (briefing.role === "manager" && briefing.manager)
    return <ManagerSection data={briefing.manager} />;
  if (briefing.role === "owner" && briefing.owner) return <OwnerSection data={briefing.owner} />;
  if (briefing.technician) return <TechnicianSection data={briefing.technician} />;
  return null;
}

// ── Technician ────────────────────────────────────────────────────────────────

function TechnicianSection({ data }: { data: NonNullable<RoleBriefing["technician"]> }) {
  const colors = useColors();
  const router = useRouter();
  return (
    <>
      <StatGrid
        stats={[
          { label: "Total", value: data.totalInspections, icon: "albums-outline", tone: colors.primary },
          { label: "Completed", value: data.completedInspections, icon: "checkmark-done-outline", tone: colors.success },
          { label: "Open", value: data.openInspections, icon: "time-outline", tone: colors.warning },
          { label: "This week", value: data.completedThisWeek, icon: "calendar-outline", tone: colors.info },
        ]}
      />
      <View style={{ gap: 12 }}>
        <SectionTitle>My recent inspections</SectionTitle>
        {data.recentInspections.length ? (
          <Card padded={false}>
            {data.recentInspections.map((insp, i) => (
              <Card
                key={insp.id}
                padded={false}
                style={{ borderWidth: 0, borderRadius: 0 }}
                onPress={() => router.push(`/inspection/${insp.id}` as Href)}
              >
                <ListRow
                  first={i === 0}
                  icon={insp.status === "completed" ? "checkmark-circle-outline" : "time-outline"}
                  tone={insp.status === "completed" ? colors.success : colors.warning}
                  title={insp.siteAddress}
                  subtitle={`${insp.status} · ${insp.findingsCount} findings · ${formatRelative(insp.createdAt)}`}
                  right={<Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />}
                />
              </Card>
            ))}
          </Card>
        ) : (
          <EmptyCard text="No inspections yet. Start your first inspection above." />
        )}
      </View>
    </>
  );
}

// ── Sales ─────────────────────────────────────────────────────────────────────

function SalesSection({ data }: { data: NonNullable<RoleBriefing["sales"]> }) {
  const colors = useColors();
  const router = useRouter();
  const toLeads = (filter?: string) => () => {
    if (filter) filterIntent.set("leads", filter);
    router.push("/(tabs)/leads" as Href);
  };
  const toReports = (filter: string) => () => {
    filterIntent.set("reports", filter);
    router.push("/(tabs)/reports" as Href);
  };
  return (
    <>
      <StatGrid
        stats={[
          { label: "Open opportunities", value: data.openCount,                  icon: "briefcase-outline",    tone: colors.primary, onPress: toLeads() },
          { label: "Pipeline value",     value: formatMoney(data.pipelineValue), icon: "trending-up-outline",  tone: colors.success, onPress: toLeads() },
          { label: "Going stale",        value: data.staleCount,                 icon: "hourglass-outline",    tone: colors.warning, onPress: toLeads("stale") },
          { label: "Proposals sent",     value: data.proposals.sent,             icon: "paper-plane-outline",  tone: colors.info,    onPress: toReports("proposal_sent") },
        ]}
      />
      <View style={{ gap: 12 }}>
        <SectionTitle>Top opportunities</SectionTitle>
        {data.topOpportunities.length ? (
          <Card padded={false}>
            {data.topOpportunities.map((opp, i) => (
              <Card
                key={opp.id}
                padded={false}
                style={{ borderWidth: 0, borderRadius: 0 }}
                onPress={() => router.push(`/inspection/${opp.inspectionId}` as Href)}
              >
                <ListRow
                  first={i === 0}
                  icon="flash-outline"
                  tone={opp.riskLevel === "high" ? colors.destructive : colors.primary}
                  title={opp.title}
                  subtitle={`${opp.propertyAddress} · ${opp.estimatedValueTier} · ${opp.status}`}
                  right={<Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />}
                />
              </Card>
            ))}
          </Card>
        ) : (
          <EmptyCard text="No open opportunities right now." />
        )}
      </View>
      <View style={{ gap: 12 }}>
        <SectionTitle>Proposals</SectionTitle>
        <StatGrid
          stats={[
            { label: "Draft", value: data.proposals.draft, icon: "document-outline", tone: colors.mutedForeground },
            { label: "Sent", value: data.proposals.sent, icon: "paper-plane-outline", tone: colors.info },
            { label: "Accepted", value: data.proposals.accepted, icon: "checkmark-circle-outline", tone: colors.success },
            { label: "Declined", value: data.proposals.declined, icon: "close-circle-outline", tone: colors.destructive },
          ]}
        />
      </View>
    </>
  );
}

// ── Manager ───────────────────────────────────────────────────────────────────

function ManagerSection({ data }: { data: NonNullable<RoleBriefing["manager"]> }) {
  const colors = useColors();
  const router = useRouter();
  return (
    <>
      <StatGrid
        stats={[
          { label: "Pending approvals", value: data.pendingApprovals,              icon: "shield-checkmark-outline", tone: data.pendingApprovals > 0 ? colors.warning : colors.success, onPress: () => router.push("/(tabs)/review" as Href) },
          { label: "Avg quality (30d)", value: data.team.avgQualityScore30d ?? "—", icon: "ribbon-outline",           tone: colors.primary,     onPress: () => { filterIntent.set("reports", "quality");   router.push("/(tabs)/reports" as Href); } },
          { label: "High risk (30d)",   value: data.team.highRisk30d,              icon: "warning-outline",           tone: colors.destructive, onPress: () => { filterIntent.set("reports", "high_risk"); router.push("/(tabs)/reports" as Href); } },
          { label: "Missed opps (30d)", value: data.team.missedOpportunities30d,   icon: "eye-off-outline",           tone: colors.info,        onPress: () => router.push("/(tabs)/reports" as Href) },
        ]}
      />
      <View style={{ gap: 12 }}>
        <SectionTitle>Approval queue</SectionTitle>
        {data.approvalsQueue.length ? (
          <Card padded={false}>
            {data.approvalsQueue.map((item, i) => (
              <Card
                key={item.id}
                padded={false}
                style={{ borderWidth: 0, borderRadius: 0 }}
                onPress={() => router.push(`/inspection/${item.inspectionId}` as Href)}
              >
                <ListRow
                  first={i === 0}
                  icon="document-text-outline"
                  tone={item.ageDays >= 3 ? colors.destructive : colors.warning}
                  title={item.siteAddress}
                  subtitle={
                    item.ageDays === 0
                      ? "Submitted today"
                      : `Waiting ${item.ageDays} day${item.ageDays === 1 ? "" : "s"}`
                  }
                  right={<Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />}
                />
              </Card>
            ))}
          </Card>
        ) : (
          <EmptyCard text="No customer summaries waiting for approval." />
        )}
      </View>
      <View style={{ gap: 12 }}>
        <SectionTitle>Team (last 30 days)</SectionTitle>
        {data.team.technicians.length ? (
          <Card padded={false}>
            {data.team.technicians.map((t, i) => (
              <ListRow
                key={t.technicianName}
                first={i === 0}
                icon="person-outline"
                tone={colors.primary}
                title={t.technicianName}
                subtitle={`${t.scorecards} scorecard${t.scorecards === 1 ? "" : "s"} · avg quality ${t.avgQuality}`}
              />
            ))}
          </Card>
        ) : (
          <EmptyCard text="No technician scorecards in the last 30 days." />
        )}
      </View>
      <View style={{ gap: 12 }}>
        <SectionTitle>Recent completions</SectionTitle>
        {data.recentCompletions.length ? (
          <Card padded={false}>
            {data.recentCompletions.map((c, i) => (
              <Card
                key={c.id}
                padded={false}
                style={{ borderWidth: 0, borderRadius: 0 }}
                onPress={() => router.push(`/inspection/${c.id}` as Href)}
              >
                <ListRow
                  first={i === 0}
                  icon="checkmark-done-outline"
                  tone={colors.success}
                  title={c.siteAddress}
                  subtitle={`${c.technicianName} · ${c.findingsCount} findings${c.completedAt ? ` · ${formatRelative(c.completedAt)}` : ""}`}
                  right={<Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />}
                />
              </Card>
            ))}
          </Card>
        ) : (
          <EmptyCard text="No completed inspections yet." />
        )}
      </View>
    </>
  );
}

// ── Owner ─────────────────────────────────────────────────────────────────────

const ALERT_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  approvals_aging: "hourglass-outline",
  quality_low: "trending-down-outline",
  high_risk: "warning-outline",
  stale_pipeline: "snow-outline",
  share_links_expiring: "link-outline",
};

/** Map each alert type to a reports filter param so owners land on relevant data. */
const ALERT_FILTER: Record<string, string> = {
  approvals_aging: "pending_approvals",
  high_risk:       "high_risk",
  quality_low:     "low_quality",
  stale_pipeline:  "opportunities",
};

function OwnerSection({ data }: { data: NonNullable<RoleBriefing["owner"]> }) {
  const colors = useColors();
  const router = useRouter();

  const toReports = (filter: string) => () => {
    filterIntent.set("reports", filter);
    router.push("/(tabs)/reports" as Href);
  };

  const severityTone = (severity: string) =>
    severity === "critical"
      ? colors.destructive
      : severity === "warning"
        ? colors.warning
        : colors.info;

  return (
    <>
      <StatGrid
        stats={[
          { label: "Completed (7d)",     value: data.kpis.completions7d,          icon: "checkmark-done-outline",   tone: colors.success, onPress: toReports("7d") },
          { label: "Completed (30d)",    value: data.kpis.completions30d,          icon: "calendar-outline",         tone: colors.primary, onPress: toReports("30d") },
          { label: "Open opportunities", value: data.kpis.openOpportunities,       icon: "briefcase-outline",        tone: colors.info,    onPress: toReports("opportunities") },
          { label: "Pipeline value",     value: formatMoney(data.kpis.pipelineValue), icon: "trending-up-outline",  tone: colors.success, onPress: toReports("opportunities") },
          { label: "Avg quality (30d)",  value: data.kpis.avgQualityScore30d ?? "—", icon: "ribbon-outline",        tone: colors.primary, onPress: toReports("quality") },
          { label: "Approved summaries", value: data.kpis.approvedSummaries30d,   icon: "shield-checkmark-outline", tone: colors.success, onPress: toReports("approved") },
        ]}
      />
      <View style={{ gap: 12 }}>
        <SectionTitle>Needs attention</SectionTitle>
        {data.alerts.length ? (
          <Card padded={false}>
            {data.alerts.map((alert, i) => {
              const filterKey = ALERT_FILTER[alert.type];
              return (
                <ListRow
                  key={`${alert.type}-${i}`}
                  first={i === 0}
                  icon={ALERT_ICONS[alert.type] ?? "alert-circle-outline"}
                  tone={severityTone(alert.severity)}
                  title={alert.message}
                  subtitle={alert.severity === "critical" ? "Tap to review · Critical" : alert.severity === "warning" ? "Tap to review · Warning" : "Tap to review"}
                  onPress={() => {
                    if (filterKey) filterIntent.set("reports", filterKey);
                    router.push("/(tabs)/reports" as Href);
                  }}
                />
              );
            })}
          </Card>
        ) : (
          <Card>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "center" }}>
              <Ionicons name="checkmark-circle-outline" size={18} color={colors.success} />
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
                All clear — nothing needs your attention.
              </Text>
            </View>
          </Card>
        )}
      </View>
    </>
  );
}
