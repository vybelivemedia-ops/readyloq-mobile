/**
 * Scan tab — Sales role only.
 *
 * Surfaces the camera and AI capture pipeline framed for sales:
 *  - "Property scan" language (not "inspection")
 *  - Findings displayed as protection opportunities, not technical evidence
 *  - Each completed scan shows estimated value tier and recommended services
 *  - Reports generated from scans use the customer-friendly narrative format
 */

import { Ionicons } from "@expo/vector-icons";
import { getListReportsQueryOptions } from "@/lib/api-client";
import type { Report } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { type Href, useRouter } from "expo-router";
import React from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FullScreenLoader } from "@/components/ui/Loader";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";

const RISK_LABELS: Record<string, string> = {
  critical: "Urgent protection needed",
  high:     "Significant vulnerability",
  medium:   "Moderate risk",
  low:      "Minor concern",
};

const VALUE_TIER_LABELS: Record<string, { label: string; color: string }> = {
  high:   { label: "High-value opportunity", color: "#16a34a" },
  medium: { label: "Moderate opportunity",   color: "#d97706" },
  low:    { label: "Follow-up candidate",     color: "#6b7280" },
};

export default function ScanScreen() {
  const colors = useColors();
  const router = useRouter();

  const { data, isLoading, isRefetching, refetch } = useQuery(getListReportsQueryOptions());

  const renderItem = ({ item }: { item: Report }) => {
    const riskLabel = item.severity ? RISK_LABELS[item.severity] ?? item.severity : null;

    return (
      <Card onPress={() => router.push(`/report/${item.id}` as Href)} style={{ gap: 10 }}>
        {/* Address */}
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
          <Ionicons name="home-outline" size={16} color={colors.primary} style={{ marginTop: 2 }} />
          <Text
            style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15, flex: 1 }}
            numberOfLines={2}
          >
            {item.siteAddress ?? item.title}
          </Text>
        </View>

        {/* Risk + value */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {riskLabel ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 999,
                backgroundColor:
                  item.severity === "critical" || item.severity === "high"
                    ? "rgba(220,38,38,0.1)"
                    : "rgba(234,179,8,0.1)",
              }}
            >
              <Ionicons
                name="alert-circle-outline"
                size={12}
                color={item.severity === "critical" || item.severity === "high" ? "#dc2626" : "#ca8a04"}
              />
              <Text
                style={{
                  color: item.severity === "critical" || item.severity === "high" ? "#dc2626" : "#ca8a04",
                  fontFamily: "Inter_500Medium",
                  fontSize: 12,
                }}
              >
                {riskLabel}
              </Text>
            </View>
          ) : null}
          {item.aiNarrative ? <Badge label="AI summary ready" tone="primary" /> : null}
        </View>

        {/* Footer */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
            {new Date(item.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={{ color: colors.primary, fontFamily: "Inter_500Medium", fontSize: 12 }}>
              View summary
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.primary} />
          </View>
        </View>
      </Card>
    );
  };

  return (
    <Screen>
      <View style={{ flex: 1 }}>
        {/* Header */}
        <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 24 }}>
            Property Scan
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14, marginTop: 2 }}>
            Identify protection opportunities at every property
          </Text>
        </View>

        {/* Primary CTA */}
        <Pressable
          onPress={() => router.push("/new-inspection" as Href)}
          style={({ pressed }) => ({
            backgroundColor: colors.primary,
            borderRadius: colors.radius,
            margin: 16,
            marginBottom: 8,
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
            <Ionicons name="scan" size={28} color={colors.primaryForeground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_700Bold", fontSize: 18 }}>
              Start Property Scan
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.85)", fontFamily: "Inter_400Regular", fontSize: 13 }}>
              AI identifies vulnerabilities and recommends services
            </Text>
          </View>
          <Ionicons name="arrow-forward" size={22} color={colors.primaryForeground} />
        </Pressable>

        {/* What AI looks for */}
        <View style={{ marginHorizontal: 16, marginBottom: 12 }}>
          <View
            style={{
              flexDirection: "row",
              gap: 12,
              padding: 14,
              borderRadius: 12,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            {[
              { icon: "bug-outline" as const,        label: "Pest entry points" },
              { icon: "water-outline" as const,       label: "Moisture issues" },
              { icon: "warning-outline" as const,     label: "Structural risks" },
            ].map(({ icon, label }) => (
              <View key={label} style={{ flex: 1, alignItems: "center", gap: 4 }}>
                <Ionicons name={icon} size={20} color={colors.primary} />
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11, textAlign: "center" }}>
                  {label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Recent scans list */}
        <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 16 }}>
            Recent scans
          </Text>
        </View>

        {isLoading ? (
          <FullScreenLoader />
        ) : (
          <FlatList
            data={data ?? []}
            keyExtractor={(i) => String(i.id)}
            renderItem={renderItem}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 10 }}
            refreshControl={
              <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
            }
            ListEmptyComponent={
              <EmptyState
                icon="scan-outline"
                title="No property scans yet"
                subtitle="Start a scan to identify protection opportunities and build your pipeline."
              />
            }
          />
        )}
      </View>
    </Screen>
  );
}
