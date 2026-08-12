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
  Alert,
  RefreshControl,
  ScrollView,
  Share,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@clerk/expo";
import Svg, { G, Rect, Line, Text as SvgText } from "react-native-svg";
import * as MailComposer from "expo-mail-composer";
import {
  fetchExecutiveMetrics,
  fetchExecutiveQualityTrend,
  fetchDailyBriefing,
  fetchExecutiveEmailPreview,
  fetchExecutiveTextPreview,
  type ExecutiveMetrics,
  type ExecutiveTechnician,
  type ExecutiveQualityWeek,
  type DailyBriefing,
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
  onPress,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  accent?: string;
  sublabel?: string;
  onPress?: () => void;
}) {
  const inner = (
    <>
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
        {onPress ? (
          <Ionicons name="chevron-forward" size={12} color={C.muted} />
        ) : null}
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
    </>
  );

  const containerStyle = {
    flex: 1,
    minWidth: "47%" as const,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 14,
    padding: 16,
    gap: 6,
  };

  if (onPress) {
    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.75}
        style={containerStyle}
      >
        {inner}
      </TouchableOpacity>
    );
  }

  return <View style={containerStyle}>{inner}</View>;
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

function RiskBar({
  distribution,
  onPressSegment,
}: {
  distribution: ExecutiveMetrics["riskDistribution"];
  onPressSegment: (level: keyof ExecutiveMetrics["riskDistribution"]) => void;
}) {
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
      {/* Stacked bar — each segment is tappable */}
      <View style={{ flexDirection: "row", height: 10, borderRadius: 6, overflow: "hidden" }}>
        {segments.map(({ key }) => {
          const pct = (distribution[key] / total) * 100;
          if (pct === 0) return null;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => onPressSegment(key)}
              activeOpacity={0.7}
              style={{ flex: pct, backgroundColor: RISK_COLOR[key] }}
            />
          );
        })}
      </View>

      {/* Legend — each item is tappable */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {segments.map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            onPress={() => onPressSegment(key)}
            activeOpacity={0.7}
            style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
          >
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
          </TouchableOpacity>
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
  onPressThisMonth,
  onPressLastMonth,
}: {
  thisMonth: number;
  lastMonth: number;
  onPressThisMonth?: () => void;
  onPressLastMonth?: () => void;
}) {
  const delta = thisMonth - lastMonth;
  const up = delta >= 0;
  const pct =
    lastMonth === 0
      ? thisMonth > 0 ? 100 : 0
      : Math.round(Math.abs(delta / lastMonth) * 100);

  return (
    <View style={{ gap: 10 }}>
      {/* This Month card */}
      <TouchableOpacity
        onPress={onPressThisMonth}
        activeOpacity={onPressThisMonth ? 0.7 : 1}
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
            Tap to see completed inspections
          </Text>
        </View>
        {onPressThisMonth ? (
          <Ionicons name="chevron-forward" size={16} color={C.muted} />
        ) : null}
      </TouchableOpacity>

      {/* Last Month card */}
      <TouchableOpacity
        onPress={onPressLastMonth}
        activeOpacity={onPressLastMonth ? 0.7 : 1}
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
            backgroundColor: "#ffffff0A",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="calendar-outline" size={20} color={C.muted} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontFamily: "Inter_700Bold", fontSize: 20 }}>
            {lastMonth}
            <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 13 }}>
              {" "}last month
            </Text>
          </Text>
          <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 }}>
            {lastMonth > 0 || thisMonth > 0 ? (
              <>
                <Text style={{ color: up ? C.success : C.danger, fontFamily: "Inter_600SemiBold" }}>
                  {up ? "▲" : "▼"} {pct}%
                </Text>
                {" "}vs prior period · tap to review
              </>
            ) : (
              "Tap to review prior completions"
            )}
          </Text>
        </View>
        {onPressLastMonth ? (
          <Ionicons name="chevron-forward" size={16} color={C.muted} />
        ) : null}
      </TouchableOpacity>
    </View>
  );
}

// ─── Quality Trend Chart ──────────────────────────────────────────────────────

function QualityTrendChart({
  weeks,
  onPressWeek,
}: {
  weeks: ExecutiveQualityWeek[];
  onPressWeek?: (week: ExecutiveQualityWeek) => void;
}) {
  const CHART_W = 320;
  const CHART_H = 100;
  const BAR_GAP = 12;
  const n = weeks.length;
  const barW = (CHART_W - BAR_GAP * (n + 1)) / n;
  const maxScore = 100;
  const LABEL_H = 20;
  const BAR_AREA_H = CHART_H - LABEL_H;

  const allZero = weeks.every((w) => w.avgQuality === 0);

  if (allZero) {
    return (
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
        <Ionicons name="bar-chart-outline" size={28} color={C.muted} />
        <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 13, textAlign: "center" }}>
          No scored inspections in the past 4 weeks.
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        backgroundColor: C.surface,
        borderWidth: 1,
        borderColor: C.border,
        borderRadius: 14,
        padding: 16,
        gap: 8,
      }}
    >
      {/* Legend row */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: C.primary }} />
        <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 11 }}>
          Avg quality score — weekly
        </Text>
      </View>

      {/* SVG chart */}
      <View style={{ alignItems: "center" }}>
        <Svg width={CHART_W} height={CHART_H}>
          {/* Baseline */}
          <Line
            x1={0}
            y1={BAR_AREA_H}
            x2={CHART_W}
            y2={BAR_AREA_H}
            stroke={C.border}
            strokeWidth={1}
          />
          {weeks.map((w, i) => {
            const x = BAR_GAP + i * (barW + BAR_GAP);
            const barH = w.avgQuality === 0 ? 0 : Math.max(4, (w.avgQuality / maxScore) * (BAR_AREA_H - 4));
            const y = BAR_AREA_H - barH;
            const barColor =
              w.avgQuality === 0
                ? C.border
                : w.avgQuality >= 80
                  ? C.success
                  : w.avgQuality >= 60
                    ? C.warning
                    : C.danger;
            const isTappable = w.avgQuality > 0 && !!onPressWeek;

            return (
              <G
                key={w.weekStart}
                onPress={isTappable ? () => onPressWeek?.(w) : undefined}
              >
                {/* Transparent hit-area covering entire column */}
                <Rect
                  x={x}
                  y={0}
                  width={barW}
                  height={CHART_H}
                  fill="transparent"
                />
                {/* Bar */}
                <Rect
                  x={x}
                  y={y}
                  width={barW}
                  height={barH}
                  rx={4}
                  fill={barColor}
                  opacity={0.85}
                />
                {/* Score label above bar */}
                {w.avgQuality > 0 && (
                  <SvgText
                    x={x + barW / 2}
                    y={y - 4}
                    textAnchor="middle"
                    fill={barColor}
                    fontSize={10}
                    fontWeight="bold"
                  >
                    {w.avgQuality}
                  </SvgText>
                )}
                {/* Tap hint chevron for non-zero bars */}
                {isTappable && (
                  <SvgText
                    x={x + barW / 2}
                    y={BAR_AREA_H - 2}
                    textAnchor="middle"
                    fill={barColor}
                    fontSize={7}
                    opacity={0.6}
                  >
                    ▲
                  </SvgText>
                )}
                {/* Week label below baseline */}
                <SvgText
                  x={x + barW / 2}
                  y={CHART_H - 4}
                  textAnchor="middle"
                  fill={C.muted}
                  fontSize={9}
                >
                  {w.label}
                </SvgText>
              </G>
            );
          })}
        </Svg>
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
  const [qualityWeeks, setQualityWeeks] = useState<ExecutiveQualityWeek[] | null>(null);
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const [metricsRes, trendRes, briefingRes] = await Promise.all([
        fetchExecutiveMetrics(token),
        fetchExecutiveQualityTrend(token),
        fetchDailyBriefing(token).catch(() => null),
      ]);
      setMetrics(metricsRes.metrics);
      setQualityWeeks(trendRes.weeks);
      if (briefingRes) setBriefing(briefingRes.briefing);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load metrics");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getToken]);

  const handleShare = useCallback(async () => {
    setSharing(true);
    try {
      const token = await getToken();
      const available = await MailComposer.isAvailableAsync();

      if (available) {
        // Primary path: compose a rich HTML email
        const { html, subject } = await fetchExecutiveEmailPreview(token);
        await MailComposer.composeAsync({
          subject,
          body: html,
          isHtml: true,
        });
      } else {
        // Fallback path: open the native share sheet with plain text
        const { text, subject } = await fetchExecutiveTextPreview(token);
        await Share.share({ message: text, title: subject });
      }
    } catch (e) {
      Alert.alert(
        "Export Failed",
        e instanceof Error ? e.message : "Could not generate dashboard snapshot.",
      );
    } finally {
      setSharing(false);
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
        <TouchableOpacity
          onPress={() => void handleShare()}
          disabled={sharing || loading}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: sharing ? C.primary + "22" : "#ffffff08",
            borderWidth: sharing ? 1 : 0,
            borderColor: C.primary + "55",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {sharing ? (
            <ActivityIndicator size="small" color={C.primary} />
          ) : (
            <Ionicons name="share-outline" size={18} color={loading ? C.muted : C.primary} />
          )}
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
          {/* ── Yesterday's Briefing ──────────────────────────────────── */}
          {briefing && (
            <View
              style={{
                backgroundColor: C.surface,
                borderWidth: 1,
                borderColor: briefing.criticalRiskCount > 0 ? C.danger + "55" : C.border,
                borderRadius: 14,
                padding: 16,
                gap: 10,
              }}
            >
              {/* Header row */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    backgroundColor:
                      briefing.criticalRiskCount > 0 ? C.danger + "22" : C.primary + "22",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons
                    name={briefing.criticalRiskCount > 0 ? "warning-outline" : "sunny-outline"}
                    size={16}
                    color={briefing.criticalRiskCount > 0 ? C.danger : C.primary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: C.text,
                      fontFamily: "Inter_700Bold",
                      fontSize: 13,
                    }}
                  >
                    Yesterday's Briefing
                  </Text>
                  <Text
                    style={{
                      color: C.muted,
                      fontFamily: "Inter_400Regular",
                      fontSize: 11,
                      marginTop: 1,
                    }}
                  >
                    {briefing.date}
                  </Text>
                </View>
              </View>

              {/* Summary */}
              <Text
                style={{
                  color: "#C9D1D9",
                  fontFamily: "Inter_400Regular",
                  fontSize: 13,
                  lineHeight: 20,
                }}
              >
                {briefing.summary}
              </Text>

              {/* Stat pills */}
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {[
                  {
                    icon: "checkmark-circle-outline" as const,
                    label: `${briefing.inspectionsCount} completed`,
                    color: C.success,
                  },
                  {
                    icon: "warning-outline" as const,
                    label: `${briefing.criticalRiskCount} critical`,
                    color: briefing.criticalRiskCount > 0 ? C.danger : C.muted,
                  },
                  {
                    icon: "trending-up-outline" as const,
                    label: `$${briefing.pipelineAdded.toLocaleString()} pipeline`,
                    color: C.primary,
                  },
                ].map((pill) => (
                  <View
                    key={pill.label}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                      backgroundColor: pill.color + "18",
                      borderRadius: 20,
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                    }}
                  >
                    <Ionicons name={pill.icon} size={12} color={pill.color} />
                    <Text
                      style={{
                        color: pill.color,
                        fontFamily: "Inter_600SemiBold",
                        fontSize: 11,
                      }}
                    >
                      {pill.label}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Recommendation */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: 8,
                  paddingTop: 4,
                  borderTopWidth: 1,
                  borderTopColor: C.border,
                }}
              >
                <Ionicons
                  name="bulb-outline"
                  size={14}
                  color={C.warning}
                  style={{ marginTop: 2 }}
                />
                <Text
                  style={{
                    color: C.muted,
                    fontFamily: "Inter_400Regular",
                    fontSize: 12,
                    flex: 1,
                    lineHeight: 18,
                  }}
                >
                  {briefing.recommendation}
                </Text>
              </View>
            </View>
          )}

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
                onPress={() => router.push("/reports-detail?filter=pipeline" as never)}
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
                onPress={() => router.push("/reports-detail?filter=critical" as never)}
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
                onPress={() => router.push("/reports-detail?filter=critical" as never)}
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
              onPressThisMonth={() =>
                router.push({
                  pathname: "/executive-velocity-inspections",
                  params: { month: "current" },
                } as never)
              }
              onPressLastMonth={() =>
                router.push({
                  pathname: "/executive-velocity-inspections",
                  params: { month: "last" },
                } as never)
              }
            />
          </View>

          {/* ── Quality Trend ─────────────────────────────────────────── */}
          <View style={{ gap: 8 }}>
            <SectionTitle title="Quality Score — 4-Week Trend" />
            {qualityWeeks ? (
              <QualityTrendChart
                weeks={qualityWeeks}
                onPressWeek={(week) =>
                  router.push({
                    pathname: "/executive-week-inspections",
                    params: { weekStart: week.weekStart, weekLabel: week.label },
                  } as never)
                }
              />
            ) : (
              <View
                style={{
                  backgroundColor: C.surface,
                  borderWidth: 1,
                  borderColor: C.border,
                  borderRadius: 14,
                  padding: 20,
                  alignItems: "center",
                }}
              >
                <ActivityIndicator size="small" color={C.primary} />
              </View>
            )}
          </View>

          {/* ── Risk Distribution ─────────────────────────────────────── */}
          <View style={{ gap: 8 }}>
            <SectionTitle title="Risk Distribution" />
            <RiskBar
              distribution={metrics?.riskDistribution ?? { critical: 0, high: 0, medium: 0, low: 0 }}
              onPressSegment={(level) =>
                router.push({ pathname: "/executive-risk-inspections", params: { riskLevel: level } } as never)
              }
            />
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
