/**
 * Executive Weekly Quality Drill-Down
 *
 * Lists all inspections scored during a specific ISO week, showing site
 * address, technician name, quality score, and risk level.
 * Reached by tapping a week bar in the Quality Trend chart on the
 * Executive Intelligence Dashboard.
 */
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@clerk/expo";
import {
  fetchWeeklyQualityInspections,
  type WeeklyQualityInspection,
} from "@/lib/api";
import { WEEK_EMPTY_HEADING, weekEmptySubtitle } from "@/lib/dashboard/week-bar-guard";

// ─── Palette ──────────────────────────────────────────────────────────────────

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
};

const RISK_COLOR: Record<string, string> = {
  critical: C.danger,
  high: "#E3882A",
  medium: C.warning,
  low: C.success,
};

const RISK_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  critical: "warning",
  high: "alert-circle",
  medium: "alert",
  low: "checkmark-circle",
};

// ─── Summary card ─────────────────────────────────────────────────────────────

interface WeekSummary {
  avgScore: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
}

function deriveWeekSummary(items: WeeklyQualityInspection[]): WeekSummary {
  const n = items.length;
  if (n === 0) return { avgScore: 0, critical: 0, high: 0, medium: 0, low: 0 };
  const total = items.reduce((s, i) => s + i.qualityScore, 0);
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const item of items) {
    const k = item.riskLevel as keyof typeof counts;
    if (k in counts) counts[k]++;
  }
  return { avgScore: Math.round(total / n), ...counts };
}

function WeeklySummaryCard({ summary }: { summary: WeekSummary }) {
  const scoreColor =
    summary.avgScore >= 80 ? C.success : summary.avgScore >= 60 ? C.warning : C.danger;

  type RiskCountKey = keyof Pick<WeekSummary, "critical" | "high" | "medium" | "low">;
  const RISK_CHIPS: Array<{ key: RiskCountKey; label: string }> = [
    { key: "critical", label: "Critical" },
    { key: "high", label: "High" },
    { key: "medium", label: "Medium" },
    { key: "low", label: "Low" },
  ];

  return (
    <View
      style={{
        marginHorizontal: 16,
        marginTop: 16,
        marginBottom: 4,
        backgroundColor: C.surface,
        borderWidth: 1,
        borderColor: C.border,
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      {/* Card header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: C.border,
          backgroundColor: "#ffffff06",
          gap: 8,
        }}
      >
        <Ionicons name="stats-chart" size={15} color={C.primary} />
        <Text
          style={{
            flex: 1,
            color: C.text,
            fontFamily: "Inter_700Bold",
            fontSize: 13,
            letterSpacing: 0.2,
          }}
        >
          Week Summary
        </Text>

        {/* Avg score badge */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 12,
            paddingVertical: 5,
            borderRadius: 20,
            backgroundColor: scoreColor + "22",
            borderWidth: 1,
            borderColor: scoreColor + "55",
          }}
        >
          <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 11 }}>
            Avg
          </Text>
          <Text style={{ color: scoreColor, fontFamily: "Inter_800ExtraBold", fontSize: 18 }}>
            {summary.avgScore}
          </Text>
        </View>
      </View>

      {/* Risk breakdown row */}
      <View
        style={{
          flexDirection: "row",
          paddingHorizontal: 16,
          paddingVertical: 14,
          gap: 8,
        }}
      >
        {RISK_CHIPS.map(({ key, label }) => {
          const color = RISK_COLOR[key];
          const count = summary[key];
          return (
            <View
              key={key}
              style={{
                flex: 1,
                alignItems: "center",
                paddingVertical: 10,
                borderRadius: 10,
                backgroundColor: count > 0 ? color + "18" : "#ffffff08",
                borderWidth: 1,
                borderColor: count > 0 ? color + "44" : C.border,
                gap: 4,
              }}
            >
              <Ionicons
                name={RISK_ICON[key]}
                size={16}
                color={count > 0 ? color : C.muted}
              />
              <Text
                style={{
                  color: count > 0 ? color : C.muted,
                  fontFamily: "Inter_800ExtraBold",
                  fontSize: 18,
                  lineHeight: 22,
                }}
              >
                {count}
              </Text>
              <Text
                style={{
                  color: C.muted,
                  fontFamily: "Inter_400Regular",
                  fontSize: 10,
                  letterSpacing: 0.3,
                }}
              >
                {label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── Row component ────────────────────────────────────────────────────────────

function InspectionRow({
  item,
  isLast,
  onPress,
}: {
  item: WeeklyQualityInspection;
  isLast: boolean;
  onPress: () => void;
}) {
  const riskColor = RISK_COLOR[item.riskLevel] ?? C.muted;
  const riskIcon = (RISK_ICON[item.riskLevel] ?? "ellipse-outline") as keyof typeof Ionicons.glyphMap;
  const qualityColor =
    item.qualityScore >= 80 ? C.success : item.qualityScore >= 60 ? C.warning : C.danger;

  const scoredDate = new Date(item.scoredAt);
  const dateLabel = scoredDate.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: C.border,
        gap: 12,
      }}
    >
      {/* Risk icon */}
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: riskColor + "18",
          borderWidth: 1,
          borderColor: riskColor + "44",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Ionicons name={riskIcon} size={18} color={riskColor} />
      </View>

      {/* Address + technician + date */}
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{ color: C.text, fontFamily: "Inter_600SemiBold", fontSize: 14 }}
          numberOfLines={1}
        >
          {item.siteAddress}
        </Text>
        <Text
          style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 12 }}
          numberOfLines={1}
        >
          {item.technicianName} · {dateLabel}
        </Text>
      </View>

      {/* Quality score badge */}
      <View
        style={{
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: 20,
          backgroundColor: qualityColor + "22",
          borderWidth: 1,
          borderColor: qualityColor + "55",
          alignItems: "center",
          minWidth: 44,
          flexShrink: 0,
        }}
      >
        <Text style={{ color: qualityColor, fontFamily: "Inter_700Bold", fontSize: 13 }}>
          {item.qualityScore}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={16} color={C.muted} />
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ExecutiveWeekInspectionsScreen() {
  const params = useLocalSearchParams<{ weekStart: string; weekLabel?: string }>();
  const weekStart = params.weekStart ?? "";
  const weekLabel = params.weekLabel ?? weekStart;

  const { getToken } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<WeeklyQualityInspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqIdRef = useRef(0);

  const fetchData = useCallback(
    async (isRefresh = false) => {
      const myReqId = ++reqIdRef.current;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const token = await getToken();
        const res = await fetchWeeklyQualityInspections(token, weekStart);
        if (myReqId !== reqIdRef.current) return;
        setItems(res.inspections);
      } catch (e) {
        if (myReqId !== reqIdRef.current) return;
        setError(e instanceof Error ? e.message : "Failed to load inspections");
      } finally {
        if (myReqId === reqIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [getToken, weekStart],
  );

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

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

        {/* Week badge */}
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 20,
            backgroundColor: C.primary + "22",
            borderWidth: 1,
            borderColor: C.primary + "55",
          }}
        >
          <Text style={{ color: C.primary, fontFamily: "Inter_700Bold", fontSize: 12 }}>
            {weekLabel}
          </Text>
        </View>

        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontFamily: "Inter_800ExtraBold", fontSize: 17 }}>
            Week Quality Detail
          </Text>
          <Text
            style={{
              color: C.muted,
              fontFamily: "Inter_400Regular",
              fontSize: 12,
              marginTop: 1,
            }}
          >
            Scored inspections · week of {weekLabel}
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => void fetchData(true)}
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
            Loading inspections…
          </Text>
        </View>
      ) : error ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: 32,
          }}
        >
          <Ionicons name="cloud-offline-outline" size={40} color={C.muted} />
          <Text
            style={{
              color: C.muted,
              fontFamily: "Inter_600SemiBold",
              fontSize: 15,
              textAlign: "center",
            }}
          >
            {error}
          </Text>
          <TouchableOpacity
            onPress={() => void fetchData()}
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
      ) : items.length === 0 ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: 32,
          }}
        >
          <Ionicons name="bar-chart-outline" size={44} color={C.muted} />
          <Text
            style={{
              color: C.text,
              fontFamily: "Inter_700Bold",
              fontSize: 16,
              textAlign: "center",
            }}
          >
            {WEEK_EMPTY_HEADING}
          </Text>
          <Text
            style={{
              color: C.muted,
              fontFamily: "Inter_400Regular",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            {weekEmptySubtitle(weekLabel)}
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.inspectionId)}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void fetchData(true)}
              tintColor={C.primary}
            />
          }
          ListHeaderComponent={
            <>
              {/* ── Week summary card ── */}
              <WeeklySummaryCard summary={deriveWeekSummary(items)} />

              {/* Summary strip */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  gap: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: C.border,
                }}
              >
                <Ionicons name="calendar-outline" size={16} color={C.primary} />
                <Text
                  style={{
                    color: C.muted,
                    fontFamily: "Inter_400Regular",
                    fontSize: 13,
                    flex: 1,
                  }}
                >
                  <Text style={{ color: C.primary, fontFamily: "Inter_700Bold" }}>
                    {items.length}
                  </Text>{" "}
                  inspection{items.length !== 1 ? "s" : ""} · sorted by quality score (lowest first)
                </Text>
              </View>

              {/* Card top: column header */}
              <View
                style={{
                  marginHorizontal: 16,
                  marginTop: 16,
                  backgroundColor: C.surface,
                  borderWidth: 1,
                  borderColor: C.border,
                  borderTopLeftRadius: 14,
                  borderTopRightRadius: 14,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    paddingHorizontal: 16,
                    paddingVertical: 8,
                    borderBottomWidth: 1,
                    borderBottomColor: C.border,
                    backgroundColor: "#ffffff06",
                  }}
                >
                  <Text
                    style={{
                      color: C.muted,
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 10,
                      letterSpacing: 0.6,
                      flex: 1,
                      marginLeft: 48,
                    }}
                  >
                    SITE / TECHNICIAN
                  </Text>
                  <Text
                    style={{
                      color: C.muted,
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 10,
                      letterSpacing: 0.6,
                    }}
                  >
                    SCORE
                  </Text>
                </View>
              </View>
            </>
          }
          renderItem={({ item, index }) => (
            <View
              style={{
                marginHorizontal: 16,
                backgroundColor: C.surface,
                borderLeftWidth: 1,
                borderRightWidth: 1,
                borderColor: C.border,
              }}
            >
              <InspectionRow
                item={item}
                isLast={index === items.length - 1}
                onPress={() =>
                  router.push({
                    pathname: "/inspection/[id]",
                    params: { id: String(item.inspectionId) },
                  } as never)
                }
              />
            </View>
          )}
          ListFooterComponent={
            items.length > 0 ? (
              <View
                style={{
                  marginHorizontal: 16,
                  backgroundColor: C.surface,
                  borderWidth: 1,
                  borderTopWidth: 0,
                  borderColor: C.border,
                  borderBottomLeftRadius: 14,
                  borderBottomRightRadius: 14,
                  height: 14,
                }}
              />
            ) : null
          }
        />
      )}
    </View>
  );
}
