/**
 * Team tab — Manager role only.
 *
 * Per-technician performance scorecards with period selector and badge system.
 * Gives managers full visibility into individual and team-level output without
 * requiring them to open each inspection individually.
 */

import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";

import { useRouter } from "expo-router";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import { useLicenseStatus } from "@/hooks/useLicenseStatus";
import { customFetch } from "@/lib/api-client/custom-fetch";

// ─── Types ────────────────────────────────────────────────────────────────────

type Period = "7d" | "30d" | "90d";

interface TechPerformance {
  technicianId: string;
  technicianName: string;
  inspections: number;
  completedInspections: number;
  avgQualityScore: number | null;
  avgFindingsPerInspection: number;
  highRiskCount: number;
  photoCount: number;
  badge: "Expert" | "Senior" | "Developing" | null;
}

interface TeamResponse {
  period: Period;
  technicians: TechPerformance[];
  teamAvgQuality: number | null;
  teamTotalInspections: number;
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchTeam(period: Period): Promise<TeamResponse> {
  return customFetch<TeamResponse>(`/api/analytics/technicians?period=${period}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function qualityColor(score: number | null, colors: ReturnType<typeof useColors>): string {
  if (score == null) return colors.mutedForeground;
  if (score >= 80)   return colors.success ?? "#16a34a";
  if (score >= 60)   return colors.warning ?? "#d97706";
  return colors.destructive ?? "#dc2626";
}

const BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  Expert:     { bg: "rgba(23,196,211,0.15)", text: "#17c4d3" },
  Senior:     { bg: "rgba(99,102,241,0.15)", text: "#6366f1" },
  Developing: { bg: "rgba(234,179,8,0.15)",  text: "#ca8a04" },
};

const PERIOD_LABELS: Record<Period, string> = {
  "7d":  "7 days",
  "30d": "30 days",
  "90d": "90 days",
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function TeamScreen() {
  const colors  = useColors();
  const router  = useRouter();
  const license = useLicenseStatus();
  const [period, setPeriod] = useState<Period>("30d");

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ["team-performance", period],
    queryFn: () => fetchTeam(period),
    staleTime: 120_000,
  });

  const techs = data?.technicians ?? [];

  // #81 — block team features when subscription is not active
  const subLapsed =
    !license.isLoading && license.data != null && !license.data.isActive;

  if (subLapsed) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
          <Ionicons name="lock-closed-outline" size={48} color={colors.mutedForeground} />
          <Text style={{
            color: colors.foreground, fontFamily: "Inter_700Bold",
            fontSize: 20, marginTop: 16, textAlign: "center",
          }}>
            Subscription required
          </Text>
          <Text style={{
            color: colors.mutedForeground, fontFamily: "Inter_400Regular",
            fontSize: 14, marginTop: 8, textAlign: "center", lineHeight: 20,
          }}>
            Team performance is a Growth plan feature.
            {license.data?.status === "past_due"
              ? " Your payment is overdue — update billing to restore access."
              : " Renew or upgrade your subscription to view team data."}
          </Text>
          <Pressable
            onPress={() => router.push("/(app)/billing" as unknown as Parameters<typeof router.push>[0])}
            style={({ pressed }) => ({
              marginTop: 24, backgroundColor: colors.primary, borderRadius: colors.radius,
              paddingHorizontal: 24, paddingVertical: 12, opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
              {license.data?.status === "past_due" ? "Update billing" : "View plans"}
            </Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
        }
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {/* Header */}
        <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 24 }}>
            Team Performance
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14, marginTop: 2 }}>
            Inspect output, quality, and risk across the team
          </Text>
        </View>

        {/* Period selector */}
        <View
          style={{
            flexDirection: "row",
            marginHorizontal: 16,
            marginBottom: 16,
            borderRadius: 10,
            backgroundColor: colors.muted,
            padding: 3,
            gap: 3,
          }}
        >
          {(["7d", "30d", "90d"] as Period[]).map((p) => (
            <Pressable
              key={p}
              onPress={() => setPeriod(p)}
              style={{
                flex: 1,
                paddingVertical: 8,
                borderRadius: 8,
                alignItems: "center",
                backgroundColor: period === p ? colors.card : "transparent",
              }}
            >
              <Text
                style={{
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 13,
                  color: period === p ? colors.foreground : colors.mutedForeground,
                }}
              >
                {PERIOD_LABELS[p]}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Team summary strip */}
        {data ? (
          <View
            style={{
              flexDirection: "row",
              marginHorizontal: 16,
              marginBottom: 16,
              padding: 14,
              borderRadius: 12,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              gap: 0,
            }}
          >
            {[
              { label: "Team inspections", value: String(data.teamTotalInspections), icon: "albums-outline" as const },
              { label: "Team avg quality", value: data.teamAvgQuality != null ? String(Math.round(data.teamAvgQuality)) : "—", icon: "ribbon-outline" as const },
              { label: "Active techs", value: String(techs.length), icon: "people-outline" as const },
            ].map((stat, i) => (
              <View
                key={stat.label}
                style={{
                  flex: 1,
                  alignItems: "center",
                  gap: 4,
                  borderLeftWidth: i > 0 ? 1 : 0,
                  borderLeftColor: colors.border,
                  paddingHorizontal: 8,
                }}
              >
                <Ionicons name={stat.icon} size={18} color={colors.primary} />
                <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 18 }}>
                  {stat.value}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11, textAlign: "center" }}>
                  {stat.label}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Tech cards */}
        {isLoading ? (
          <View style={{ padding: 40, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : techs.length === 0 ? (
          <EmptyState
            icon="people-outline"
            title="No activity yet"
            subtitle={`No inspections recorded in the last ${PERIOD_LABELS[period]}.`}
          />
        ) : (
          <View style={{ paddingHorizontal: 16, gap: 12 }}>
            {techs.map((tech) => {
              const badge = tech.badge ? BADGE_COLORS[tech.badge] : null;
              const completionRate =
                tech.inspections > 0
                  ? Math.round((tech.completedInspections / tech.inspections) * 100)
                  : 0;

              return (
                <Card key={tech.technicianId} style={{ gap: 14 }}>
                  {/* Name + badge */}
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <View
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 20,
                          backgroundColor: colors.primary + "22",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Text style={{ color: colors.primary, fontFamily: "Inter_700Bold", fontSize: 16 }}>
                          {tech.technicianName.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View>
                        <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 16 }}>
                          {tech.technicianName}
                        </Text>
                        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                          {completionRate}% completion rate
                        </Text>
                      </View>
                    </View>
                    {badge && tech.badge ? (
                      <View
                        style={{
                          paddingHorizontal: 10,
                          paddingVertical: 4,
                          borderRadius: 999,
                          backgroundColor: badge.bg,
                        }}
                      >
                        <Text style={{ color: badge.text, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
                          {tech.badge}
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Stats row */}
                  <View style={{ flexDirection: "row", gap: 0 }}>
                    {[
                      {
                        label: "Inspections",
                        value: String(tech.completedInspections),
                        color: colors.foreground,
                      },
                      {
                        label: "Avg quality",
                        value: tech.avgQualityScore != null ? String(Math.round(tech.avgQualityScore)) : "—",
                        color: qualityColor(tech.avgQualityScore, colors),
                      },
                      {
                        label: "High risk",
                        value: String(tech.highRiskCount),
                        color: tech.highRiskCount > 0 ? (colors.destructive ?? "#dc2626") : colors.mutedForeground,
                      },
                      {
                        label: "Avg findings",
                        value: String(Math.round(tech.avgFindingsPerInspection * 10) / 10),
                        color: colors.foreground,
                      },
                    ].map((stat, i) => (
                      <View
                        key={stat.label}
                        style={{
                          flex: 1,
                          alignItems: "center",
                          gap: 2,
                          borderLeftWidth: i > 0 ? 1 : 0,
                          borderLeftColor: colors.border,
                        }}
                      >
                        <Text style={{ color: stat.color, fontFamily: "Inter_700Bold", fontSize: 20 }}>
                          {stat.value}
                        </Text>
                        <Text
                          style={{
                            color: colors.mutedForeground,
                            fontFamily: "Inter_400Regular",
                            fontSize: 10,
                            textAlign: "center",
                          }}
                        >
                          {stat.label}
                        </Text>
                      </View>
                    ))}
                  </View>

                  {/* Quality bar */}
                  {tech.avgQualityScore != null ? (
                    <View style={{ gap: 4 }}>
                      <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: "hidden" }}>
                        <View
                          style={{
                            height: "100%",
                            borderRadius: 2,
                            backgroundColor: qualityColor(tech.avgQualityScore, colors),
                            width: `${tech.avgQualityScore}%`,
                          }}
                        />
                      </View>
                    </View>
                  ) : null}
                </Card>
              );
            })}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
