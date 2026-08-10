/**
 * Executive Risk Drill-Down
 *
 * Lists all inspections at a given risk level for the owner's company.
 * Reached by tapping a risk segment in the Executive Intelligence Dashboard.
 */
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
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
  fetchExecutiveInspections,
  type ExecutiveRiskInspection,
  type ExecutiveRiskLevel,
} from "@/lib/api";

// ─── Palette (mirrors executive-dashboard.tsx) ────────────────────────────────

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

const RISK_COLOR: Record<ExecutiveRiskLevel, string> = {
  critical: C.danger,
  high:     "#E3882A",
  medium:   C.warning,
  low:      C.success,
};

const RISK_LABEL: Record<ExecutiveRiskLevel, string> = {
  critical: "Critical",
  high:     "High",
  medium:   "Medium",
  low:      "Low",
};

const RISK_ICON: Record<ExecutiveRiskLevel, keyof typeof Ionicons.glyphMap> = {
  critical: "warning",
  high:     "alert-circle",
  medium:   "alert",
  low:      "checkmark-circle",
};

// ─── Row component ────────────────────────────────────────────────────────────

function InspectionRow({
  item,
  isLast,
  onPress,
}: {
  item: ExecutiveRiskInspection;
  isLast: boolean;
  onPress: () => void;
}) {
  const color = RISK_COLOR[item.riskLevel];
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
      {/* Risk icon dot */}
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: color + "18",
          borderWidth: 1,
          borderColor: color + "44",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Ionicons name={RISK_ICON[item.riskLevel]} size={18} color={color} />
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

export default function ExecutiveRiskInspectionsScreen() {
  const params = useLocalSearchParams<{ riskLevel: string }>();
  const riskLevel = (params.riskLevel ?? "critical") as ExecutiveRiskLevel;

  const { getToken } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<ExecutiveRiskInspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const token = await getToken();
        const res = await fetchExecutiveInspections(token, riskLevel);
        setItems(res.inspections);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load inspections");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [getToken, riskLevel],
  );

  React.useEffect(() => {
    void load();
  }, [load]);

  const accentColor = RISK_COLOR[riskLevel];
  const levelLabel = RISK_LABEL[riskLevel];

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

        {/* Risk badge */}
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 20,
            backgroundColor: accentColor + "22",
            borderWidth: 1,
            borderColor: accentColor + "55",
          }}
        >
          <Text style={{ color: accentColor, fontFamily: "Inter_700Bold", fontSize: 12 }}>
            {levelLabel} Risk
          </Text>
        </View>

        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontFamily: "Inter_800ExtraBold", fontSize: 17 }}>
            At-Risk Inspections
          </Text>
          <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 1 }}>
            Tap a row to open the inspection
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
          <Ionicons name="checkmark-circle-outline" size={44} color={C.success} />
          <Text
            style={{
              color: C.text,
              fontFamily: "Inter_700Bold",
              fontSize: 16,
              textAlign: "center",
            }}
          >
            No {levelLabel.toLowerCase()} risk inspections
          </Text>
          <Text
            style={{
              color: C.muted,
              fontFamily: "Inter_400Regular",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            All inspections at this level have been addressed, or none have been scored yet.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load(true)}
              tintColor={C.primary}
            />
          }
        >
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
            <Ionicons name={RISK_ICON[riskLevel]} size={16} color={accentColor} />
            <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 13 }}>
              <Text style={{ color: accentColor, fontFamily: "Inter_700Bold" }}>
                {items.length}
              </Text>{" "}
              {levelLabel.toLowerCase()} risk inspection{items.length !== 1 ? "s" : ""}
              {" · sorted by risk score"}
            </Text>
          </View>

          {/* List */}
          <View
            style={{
              marginHorizontal: 16,
              marginTop: 16,
              backgroundColor: C.surface,
              borderWidth: 1,
              borderColor: C.border,
              borderRadius: 14,
              overflow: "hidden",
            }}
          >
            {/* Column header */}
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

            {items.map((item, i) => (
              <InspectionRow
                key={item.inspectionId}
                item={item}
                isLast={i === items.length - 1}
                onPress={() =>
                  router.push(`/inspection/${item.inspectionId}` as never)
                }
              />
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
