/**
 * Executive Intelligence Dashboard
 *
 * Macro-level analytics for owners and enterprise decision-makers:
 * financial pipeline velocity, inspection quality scores, risk distribution,
 * and technician performance — all scoped to the owner's company.
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@clerk/expo";
import {
  fetchExecutiveMetrics,
  type ExecutiveMetrics,
  type ExecutiveTechnician,
} from "@/lib/api";

// ─── Palette (dark command-centre tone) ───────────────────────────────────────

const C = {
  bg: "#0D1117",
  surface: "#161B22",
  border: "#30363D",
  text: "#E6EDF3",
  muted: "#8B949E",
  primary: "#17C4D3",
  success: "#3FB950",
  warning: "#D29922",
  danger: "#F85149",
  purple: "#A371F7",
};

const RISK_COLOR: Record<string, string> = {
  critical: C.danger,
  high: "#E3882A",
  medium: C.warning,
  low: C.success,
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon,
  accent,
  sublabel,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  accent?: string;
  sublabel?: string;
}) {
  return (
    <View
      style={{
        flex: 1,
        minWidth: "47%",
        backgroundColor: C.surface,
        borderWidth: 1,
        borderColor: C.border,
        borderRadius: 14,
        padding: 16,
        gap: 6,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Ionicons name={icon} size={14} color={accent ?? C.primary} />
        <Text
          style={{
            color: C.muted,
            fontFamily: "Inter_700Bold",
            fontSize: 10,
            letterSpacing: 0.8,
            textTransform: "uppercase",
            flex: 1,
          }}
        >
          {label}
        </Text>
      </View>
      <Text
        style={{
          color: accent ?? C.text,
          fontFamily: "Inter_800ExtraBold",
          fontSize: 26,
          lineHeight: 30,
        }}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      {sublabel ? (
        <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 11 }}>
          {sublabel}
        </Text>
      ) : null}
    </View>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <Text
      style={{
        color: C.muted,
        fontFamily: "Inter_700Bold",
        fontSize: 11,
        letterSpacing: 0.9,
        textTransform: "uppercase",
        marginBottom: 2,
      }}
    >
      {title}
    </Text>
  );
}

function RiskBar({ distribution }: { distribution: ExecutiveMetrics["riskDistribution"] }) {
  const total =
    distribution.critical + distribution.high + distribution.medium + distribution.low;
  if (total === 0) {
    return (
      <View
        style={{
          backgroundColor: C.surface,
          borderWidth: 1,
          borderColor: C.border,
          borderRadius: 14,
          padding: 16,
          alignItems: "center",
        }}
      >
        <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 13 }}>
          No scored inspections yet
        </Text>
      </View>
    );
  }

  const segments: { key: keyof typeof distribution; label: string }[] = [
    { key: "critical", label: "Critical" },
    { key: "high",     label: "High" },
    { key: "medium",   label: "Medium" },
    { key: "low",      label: "Low" },
  ];

  return (
    <View
      style={{
        backgroundColor: C.surface,
        borderWidth: 1,
        borderColor: C.border,
        borderRadius: 14,
        padding: 16,
        gap: 12,
      }}
    >
      {/* Stacked bar */}
      <View style={{ flexDirection: "row", height: 10, borderRadius: 6, overflow: "hidden" }}>
        {segments.map(({ key }) => {
          const pct = (distribution[key] / total) * 100;
          if (pct === 0) return null;
          return (
            <View
              key={key}
              style={{ flex: pct, backgroundColor: RISK_COLOR[key] }}
            />
          );
        })}
      </View>

      {/* Legend */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {segments.map(({ key, label }) => (
          <View key={key} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: RISK_COLOR[key],
              }}
            />
            <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 12 }}>
              {label}
              <Text style={{ color: C.text, fontFamily: "Inter_600SemiBold" }}>
                {" "}{distribution[key]}
              </Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function TechnicianRow({
  tech,
  rank,
  isLast,
}: {
  tech: ExecutiveTechnician;
  rank: number;
  isLast: boolean;
}) {
  const medalColor = rank === 1 ? "#FFD700" : rank === 2 ? "#C0C0C0" : rank === 3 ? "#CD7F32" : C.muted;
  const qualityColor =
    tech.avgQuality >= 80 ? C.success : tech.avgQuality >= 60 ? C.warning : C.danger;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: C.border,
        gap: 12,
      }}
    >
      {/* Rank */}
      <Text
        style={{
          color: medalColor,
          fontFamily: "Inter_700Bold",
          fontSize: 13,
          width: 20,
          textAlign: "center",
        }}
      >
        {rank}
      </Text>

      {/* Avatar initials */}
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          backgroundColor: C.primary + "22",
          borderWidth: 1,
          borderColor: C.primary + "44",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: C.primary, fontFamily: "Inter_700Bold", fontSize: 13 }}>
          {tech.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
        </Text>
      </View>

      {/* Name + count */}
      <View style={{ flex: 1 }}>
        <Text
          style={{ color: C.text, fontFamily: "Inter_600SemiBold", fontSize: 14 }}
          numberOfLines={1}
        >
          {tech.name}
        </Text>
        <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 12 }}>
          {tech.inspectionCount} inspection{tech.inspectionCount !== 1 ? "s" : ""}
        </Text>
      </View>

      {/* Quality badge */}
      <View
        style={{
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 20,
          backgroundColor: qualityColor + "22",
          borderWidth: 1,
          borderColor: qualityColor + "55",
        }}
      >
        <Text style={{ color: qualityColor, fontFamily: "Inter_700Bold", fontSize: 13 }}>
          {tech.avgQuality}
        </Text>
      </View>
    </View>
  );
}

function VelocityTrend({
  thisMonth,
  lastMonth,
}: {
  thisMonth: number;
  lastMonth: number;
}) {
  const delta = thisMonth - lastMonth;
  const up = delta >= 0;
  const pct =
    lastMonth === 0
      ? thisMonth > 0 ? 100 : 0
      : Math.round(Math.abs(delta / lastMonth) * 100);

  return (
    <View
      style={{
        backgroundColor: C.surface,
        borderWidth: 1,
        borderColor: C.border,
        borderRadius: 14,
        padding: 16,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
      }}
    >
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 21,
          backgroundColor: C.primary + "18",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="trending-up" size={22} color={C.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.text, fontFamily: "Inter_700Bold", fontSize: 20 }}>
          {thisMonth}
          <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 13 }}>
            {" "}this month
          </Text>
        </Text>
        <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 }}>
          vs {lastMonth} last month
          {lastMonth > 0 || thisMonth > 0 ? (
            <Text style={{ color: up ? C.success : C.danger, fontFamily: "Inter_600SemiBold" }}>
              {" "}{up ? "▲" : "▼"} {pct}%
            </Text>
          ) : null}
        </Text>
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ExecutiveDashboardScreen() {
  const { getToken } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [metrics, setMetrics] = useState<ExecutiveMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetchExecutiveMetrics(token);
      setMetrics(res.metrics);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load metrics");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getToken]);

  // Load on mount
  React.useEffect(() => { void load(); }, [load]);

  const pipelineFormatted = metrics
    ? metrics.pipelineValue >= 1_000_000
      ? `$${(metrics.pipelineValue / 1_000_000).toFixed(1)}M`
      : metrics.pipelineValue >= 1_000
        ? `$${(metrics.pipelineValue / 1_000).toFixed(0)}K`
        : `$${metrics.pipelineValue.toLocaleString()}`
    : "—";

  const velocityDelta =
    metrics && metrics.inspectionsLastMonth > 0
      ? Math.round(
          ((metrics.inspectionsThisMonth - metrics.inspectionsLastMonth) /
            metrics.inspectionsLastMonth) *
            100,
        )
      : null;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 16,
          paddingBottom: 14,
          borderBottomWidth: 1,
          borderBottomColor: C.border,
          backgroundColor: C.surface,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
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
            Executive Intelligence
          </Text>
          <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 1 }}>
            Enterprise Performance Overview
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => void load(true)}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: "#ffffff08",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="refresh" size={18} color={C.muted} />
        </TouchableOpacity>
      </View>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 14 }}>
            Aggregating enterprise data…
          </Text>
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 }}>
          <Ionicons name="cloud-offline-outline" size={40} color={C.muted} />
          <Text style={{ color: C.muted, fontFamily: "Inter_600SemiBold", fontSize: 15, textAlign: "center" }}>
            {error}
          </Text>
          <TouchableOpacity
            onPress={() => void load()}
            style={{
              paddingHorizontal: 20,
              paddingVertical: 10,
              borderRadius: 10,
              backgroundColor: C.primary + "22",
              borderWidth: 1,
              borderColor: C.primary + "55",
            }}
          >
            <Text style={{ color: C.primary, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
              Retry
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: 16,
            gap: 20,
            paddingBottom: insets.bottom + 32,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load(true)}
              tintColor={C.primary}
            />
          }
        >
          {/* ── KPI Grid ──────────────────────────────────────────────── */}
          <View>
            <SectionTitle title="Pipeline & Financials" />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 8 }}>
              <KpiCard
                label="Open Pipeline"
                value={pipelineFormatted}
                icon="cash-outline"
                accent={C.success}
                sublabel={
                  metrics
                    ? `${metrics.openOpportunities} open · ${metrics.wonOpportunities} won`
                    : undefined
                }
              />
              <KpiCard
                label="Avg Quality Score"
                value={metrics ? `${metrics.avgQualityScore}` : "—"}
                icon="ribbon-outline"
                accent={
                  !metrics
                    ? C.muted
                    : metrics.avgQualityScore >= 80
                      ? C.success
                      : metrics.avgQualityScore >= 60
                        ? C.warning
                        : C.danger
                }
                sublabel={`${metrics?.totalScorecards ?? 0} scored inspections`}
              />
              <KpiCard
                label="Critical Risk Sites"
                value={metrics ? `${metrics.riskDistribution.critical}` : "—"}
                icon="warning-outline"
                accent={metrics && metrics.riskDistribution.critical > 0 ? C.danger : C.success}
                sublabel={
                  metrics
                    ? `${metrics.riskDistribution.high} high · ${metrics.riskDistribution.medium} medium`
                    : undefined
                }
              />
              <KpiCard
                label="This Month"
                value={metrics ? `${metrics.inspectionsThisMonth}` : "—"}
                icon="calendar-outline"
                accent={
                  velocityDelta == null
                    ? C.primary
                    : velocityDelta >= 0
                      ? C.success
                      : C.danger
                }
                sublabel={
                  velocityDelta != null
                    ? `${velocityDelta >= 0 ? "▲" : "▼"} ${Math.abs(velocityDelta)}% vs last month`
                    : "No prior month data"
                }
              />
            </View>
          </View>

          {/* ── Inspection Velocity ───────────────────────────────────── */}
          <View style={{ gap: 8 }}>
            <SectionTitle title="Inspection Velocity" />
            <VelocityTrend
              thisMonth={metrics?.inspectionsThisMonth ?? 0}
              lastMonth={metrics?.inspectionsLastMonth ?? 0}
            />
          </View>

          {/* ── Risk Distribution ─────────────────────────────────────── */}
          <View style={{ gap: 8 }}>
            <SectionTitle title="Risk Distribution" />
            <RiskBar distribution={metrics?.riskDistribution ?? { critical: 0, high: 0, medium: 0, low: 0 }} />
          </View>

          {/* ── Technician Leaderboard ────────────────────────────────── */}
          <View style={{ gap: 8 }}>
            <SectionTitle title="Top Technicians by Quality" />
            {metrics && metrics.topTechnicians.length > 0 ? (
              <View
                style={{
                  backgroundColor: C.surface,
                  borderWidth: 1,
                  borderColor: C.border,
                  borderRadius: 14,
                  overflow: "hidden",
                }}
              >
                {/* Column headers */}
                <View
                  style={{
                    flexDirection: "row",
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderBottomWidth: 1,
                    borderBottomColor: C.border,
                    backgroundColor: "#ffffff06",
                  }}
                >
                  <Text style={{ color: C.muted, fontFamily: "Inter_600SemiBold", fontSize: 10, letterSpacing: 0.6, flex: 1, marginLeft: 54 }}>
                    TECHNICIAN
                  </Text>
                  <Text style={{ color: C.muted, fontFamily: "Inter_600SemiBold", fontSize: 10, letterSpacing: 0.6 }}>
                    SCORE
                  </Text>
                </View>
                {metrics.topTechnicians.map((t, i) => (
                  <TechnicianRow
                    key={t.name}
                    tech={t}
                    rank={i + 1}
                    isLast={i === metrics.topTechnicians.length - 1}
                  />
                ))}
              </View>
            ) : (
              <View
                style={{
                  backgroundColor: C.surface,
                  borderWidth: 1,
                  borderColor: C.border,
                  borderRadius: 14,
                  padding: 20,
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Ionicons name="people-outline" size={28} color={C.muted} />
                <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 13, textAlign: "center" }}>
                  Leaderboard appears once technicians have 2+ scored inspections.
                </Text>
              </View>
            )}
          </View>

          {/* ── Compliance & Safeguards ───────────────────────────────── */}
          <View style={{ gap: 8 }}>
            <SectionTitle title="Compliance & Safeguards" />
            <View
              style={{
                backgroundColor: C.surface,
                borderWidth: 1,
                borderColor: C.border,
                borderRadius: 14,
                padding: 16,
                gap: 12,
              }}
            >
              {[
                {
                  icon: "shield-checkmark-outline" as const,
                  text: "Anti-fabrication safeguards active across all mobile nodes.",
                },
                {
                  icon: "time-outline" as const,
                  text: "Property memory cross-referencing active for recurring routes.",
                },
                {
                  icon: "book-outline" as const,
                  text: "Company Playbooks enforce SOPs and chemical restrictions per inspection.",
                },
              ].map((item, i) => (
                <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                  <Ionicons name={item.icon} size={18} color={C.primary} style={{ marginTop: 1 }} />
                  <Text
                    style={{
                      color: "#C9D1D9",
                      fontFamily: "Inter_400Regular",
                      fontSize: 13,
                      flex: 1,
                      lineHeight: 19,
                    }}
                  >
                    {item.text}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}
