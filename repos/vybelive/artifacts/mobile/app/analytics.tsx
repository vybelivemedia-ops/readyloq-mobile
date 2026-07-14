import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MetricCard } from "@/components/analytics/MetricCard";
import { useColors } from "@/hooks/useColors";
import { useGetAnalyticsOverview } from "@workspace/api-client-react";

const PERIODS = ["7d", "30d", "90d"] as const;
type Period = (typeof PERIODS)[number];

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

const PLATFORM_COLORS: Record<string, string> = {
  youtube: "#FF0000",
  twitch: "#9146FF",
  kick: "#53FC18",
  facebook: "#1877F2",
  instagram: "#E1306C",
  tiktok: "#00F2EA",
  custom_rtmp: "#AAAAAA",
};

export default function AnalyticsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [period, setPeriod] = useState<Period>("30d");

  const { data: analytics, isLoading, error } = useGetAnalyticsOverview({ period });

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 16, paddingBottom: bottomPad + 32 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Analytics</Text>
        </View>
        <View style={styles.periodTabs}>
          {PERIODS.map((p) => (
            <TouchableOpacity
              key={p}
              onPress={() => setPeriod(p)}
              style={[
                styles.periodTab,
                {
                  backgroundColor: period === p ? colors.primary : colors.card,
                  borderColor: period === p ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.periodTabText,
                  { color: period === p ? "#FFF" : colors.mutedForeground },
                ]}
              >
                {p}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : error ? (
        <View style={[styles.errorState, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="alert-circle" size={28} color={colors.destructive} />
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>
            Connect your platforms to see analytics
          </Text>
        </View>
      ) : analytics ? (
        <>
          {/* Key metrics */}
          <View style={styles.metricsGrid}>
            <MetricCard
              label="Total Views"
              value={formatNumber(analytics.totalViews)}
              icon="eye"
              trend="up"
              trendValue="+12%"
              accentColor={colors.primary}
              style={styles.metricHalf}
            />
            <MetricCard
              label="Watch Hours"
              value={analytics.totalWatchHours.toFixed(0)}
              icon="clock"
              trend="up"
              trendValue="+8%"
              accentColor={colors.cyan}
              style={styles.metricHalf}
            />
            <MetricCard
              label="Avg Viewers"
              value={analytics.avgViewersPerStream.toFixed(0)}
              icon="users"
              accentColor={colors.neonGreen}
              style={styles.metricHalf}
            />
            <MetricCard
              label="Peak Viewers"
              value={formatNumber(analytics.peakViewers ?? 0)}
              icon="trending-up"
              accentColor={colors.live}
              style={styles.metricHalf}
            />
          </View>

          {/* Secondary metrics */}
          <View style={styles.secondaryMetrics}>
            <MetricCard
              label="Streams This Period"
              value={analytics.totalStreams}
              icon="video"
              trend="neutral"
              style={styles.metricFull}
              accentColor={colors.purple}
            />
            <MetricCard
              label="AI Clips Generated"
              value={analytics.totalClips}
              icon="zap"
              trend="up"
              trendValue={`+${analytics.totalClips} clips`}
              style={styles.metricFull}
              accentColor={colors.cyan}
            />
            <MetricCard
              label="Follower Growth"
              value={`+${formatNumber(analytics.followerGrowth)}`}
              icon="users"
              trend="up"
              style={styles.metricFull}
              accentColor={colors.neonGreen}
            />
          </View>

          {/* Platform breakdown */}
          {(analytics.platformBreakdown?.length ?? 0) > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Platform Breakdown
              </Text>
              {analytics.platformBreakdown?.map((p) => {
                const maxViews = Math.max(...(analytics.platformBreakdown?.map((x) => x.views) ?? [1]));
                const pct = maxViews > 0 ? p.views / maxViews : 0;
                const pColor = PLATFORM_COLORS[p.platform] ?? colors.mutedForeground;
                return (
                  <View
                    key={p.platform}
                    style={[styles.platformRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <View style={[styles.platformDot, { backgroundColor: pColor }]} />
                    <Text style={[styles.platformName, { color: colors.foreground }]}>
                      {p.platform.replace("_", " ").toUpperCase()}
                    </Text>
                    <View style={styles.barContainer}>
                      <View
                        style={[
                          styles.bar,
                          { width: `${Math.max(pct * 100, 4)}%`, backgroundColor: pColor },
                        ]}
                      />
                    </View>
                    <Text style={[styles.platformViews, { color: colors.mutedForeground }]}>
                      {formatNumber(p.views)}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Top streams */}
          {(analytics.topStreams?.length ?? 0) > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                Top Streams
              </Text>
              {analytics.topStreams?.map((stream) => (
                <View
                  key={stream.id}
                  style={[styles.streamCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <Text style={[styles.streamTitle, { color: colors.foreground }]} numberOfLines={1}>
                    {stream.title}
                  </Text>
                  <View style={styles.streamStats}>
                    <View style={styles.streamStat}>
                      <Feather name="eye" size={11} color={colors.mutedForeground} />
                      <Text style={[styles.streamStatText, { color: colors.mutedForeground }]}>
                        {formatNumber(stream.totalViews ?? 0)}
                      </Text>
                    </View>
                    <View style={styles.streamStat}>
                      <Feather name="users" size={11} color={colors.mutedForeground} />
                      <Text style={[styles.streamStatText, { color: colors.mutedForeground }]}>
                        {stream.peakViewers ?? 0} peak
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 20 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", marginLeft: -8 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  periodTabs: { flexDirection: "row", gap: 6 },
  periodTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  periodTabText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  loader: { marginVertical: 60 },
  errorState: {
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    marginTop: 20,
  },
  errorText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  metricHalf: { width: "47.5%" },
  metricFull: { width: "100%" },
  secondaryMetrics: { gap: 10 },
  section: { gap: 10 },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  platformRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
  },
  platformDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  platformName: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    width: 80,
    flexShrink: 0,
  },
  barContainer: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  bar: {
    height: "100%",
    borderRadius: 3,
  },
  platformViews: { fontSize: 12, fontFamily: "Inter_500Medium", width: 40, textAlign: "right" },
  streamCard: {
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    gap: 8,
  },
  streamTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  streamStats: { flexDirection: "row", gap: 14 },
  streamStat: { flexDirection: "row", alignItems: "center", gap: 4 },
  streamStatText: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
