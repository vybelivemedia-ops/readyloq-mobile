import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
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

import { Avatar } from "@/components/ui/Avatar";
import { LiveBadge } from "@/components/ui/LiveBadge";
import { useAuth } from "@/contexts/AuthContext";
import { useStream } from "@/contexts/StreamContext";
import { useColors } from "@/hooks/useColors";
import {
  useGetMyStats,
  useListStreams,
} from "@workspace/api-client-react";

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { isLive } = useStream();

  const { data: stats, isLoading: statsLoading } = useGetMyStats();
  const { data: streamsData, isLoading: streamsLoading } = useListStreams({ limit: 5 });

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : 0;

  const liveStreams = streamsData?.items?.filter((s) => s.status === "live") ?? [];
  const recentStreams = streamsData?.items?.filter((s) => s.status === "ended")?.slice(0, 3) ?? [];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 8, paddingBottom: bottomPad + 80 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={[styles.greeting, { color: colors.mutedForeground }]}>
            Ready to stream?
          </Text>
          <Text style={[styles.username, { color: colors.foreground }]}>
            {user?.displayName ?? "Creator"}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={() => router.push("/discover")}
            style={[styles.iconBtn, { backgroundColor: colors.card }]}
          >
            <Feather name="compass" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => router.push("/notifications")}
            style={[styles.iconBtn, { backgroundColor: colors.card }]}
          >
            <Feather name="bell" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push("/settings")}>
            <Avatar uri={user?.avatarUrl} name={user?.displayName ?? ""} size={40} showRing />
          </TouchableOpacity>
        </View>
      </View>

      {/* Quick stats */}
      {statsLoading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : stats ? (
        <View style={[styles.statsRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {[
            { label: "Followers", value: formatNumber(stats.totalFollowers) },
            { label: "Streams", value: stats.totalStreams.toString() },
            { label: "Watch Hrs", value: stats.totalWatchHours.toFixed(0) },
            { label: "Clips", value: stats.totalClips.toString() },
          ].map((s, i, arr) => (
            <React.Fragment key={s.label}>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: colors.foreground }]}>{s.value}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
              </View>
              {i < arr.length - 1 && (
                <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
              )}
            </React.Fragment>
          ))}
        </View>
      ) : null}

      {/* Go Live CTA */}
      <TouchableOpacity
        onPress={() => router.push("/stream/setup")}
        activeOpacity={0.85}
        style={[
          styles.goLiveCard,
          {
            backgroundColor: colors.live + "18",
            borderColor: colors.live + "60",
            shadowColor: colors.live,
          },
        ]}
      >
        <View style={[styles.goLiveIcon, { backgroundColor: colors.live, shadowColor: colors.live }]}>
          <Feather name="radio" size={24} color="#FFF" />
        </View>
        <View style={styles.goLiveText}>
          <Text style={[styles.goLiveTitle, { color: colors.foreground }]}>Go Live Now</Text>
          <Text style={[styles.goLiveSub, { color: colors.mutedForeground }]}>
            POV mode • Multistream • AI clips
          </Text>
        </View>
        <Feather name="chevron-right" size={20} color={colors.live} />
      </TouchableOpacity>

      {/* Active streams */}
      {liveStreams.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <LiveBadge size="sm" pulse />
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Your Live Streams
            </Text>
          </View>
          {liveStreams.map((stream) => (
            <TouchableOpacity
              key={stream.id}
              onPress={() => router.push(isLive ? "/stream/pov" : "/stream/recover")}
              style={[styles.streamCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.streamInfo}>
                <View style={styles.streamTitleRow}>
                  <LiveBadge size="sm" pulse />
                  <Text style={[styles.streamTitle, { color: colors.foreground }]} numberOfLines={1}>
                    {stream.title}
                  </Text>
                </View>
                <Text style={[styles.streamMeta, { color: colors.mutedForeground }]}>
                  {(stream.platforms ?? []).join(" • ")}
                </Text>
              </View>
              <View style={styles.streamViewers}>
                <Feather name="users" size={13} color={colors.cyan} />
                <Text style={[styles.viewerCount, { color: colors.cyan }]}>
                  {stream.peakViewers ?? 0}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Recent streams */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent Streams</Text>
          <TouchableOpacity onPress={() => router.push("/(tabs)/live")}>
            <Text style={[styles.seeAll, { color: colors.primary }]}>See all</Text>
          </TouchableOpacity>
        </View>

        {streamsLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : recentStreams.length === 0 ? (
          <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="video" size={32} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No streams yet</Text>
            <Text style={[styles.emptySubtitle, { color: colors.mutedForeground }]}>
              Hit the live button to start your first POV stream
            </Text>
          </View>
        ) : (
          recentStreams.map((stream) => (
            <View
              key={stream.id}
              style={[styles.streamCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.streamInfo}>
                <Text style={[styles.streamTitle, { color: colors.foreground }]} numberOfLines={1}>
                  {stream.title}
                </Text>
                <Text style={[styles.streamMeta, { color: colors.mutedForeground }]}>
                  {stream.durationSeconds
                    ? `${Math.floor(stream.durationSeconds / 60)}m`
                    : "—"}{" "}
                  • {stream.totalViews ?? 0} views
                </Text>
              </View>
              <Text style={[styles.streamPlatforms, { color: colors.mutedForeground }]}>
                {stream.platforms?.join(" · ") ?? ""}
              </Text>
            </View>
          ))
        )}
      </View>

      {/* Device quick-connect */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>POV Devices</Text>
        <View style={styles.devicesGrid}>
          {[
            { name: "Phone Camera", icon: "smartphone" as const, available: true },
            { name: "GoPro", icon: "camera" as const, available: true },
            { name: "Meta Glasses", icon: "eye" as const, available: true },
            { name: "External RTMP", icon: "wifi" as const, available: true },
          ].map((device) => (
            <TouchableOpacity
              key={device.name}
              onPress={() => router.push("/stream/setup")}
              style={[
                styles.deviceCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <View
                style={[
                  styles.deviceIcon,
                  { backgroundColor: colors.primary + "20" },
                ]}
              >
                <Feather name={device.icon} size={20} color={colors.primary} />
              </View>
              <Text style={[styles.deviceName, { color: colors.foreground }]} numberOfLines={1}>
                {device.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
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
  },
  headerLeft: { gap: 2 },
  greeting: { fontSize: 13, fontFamily: "Inter_400Regular" },
  username: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  statsRow: {
    flexDirection: "row",
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 16,
  },
  statItem: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  statDivider: { width: 1 },
  loadingBox: { height: 80, alignItems: "center", justifyContent: "center" },
  goLiveCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 4,
  },
  goLiveIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 5,
  },
  goLiveText: { flex: 1, gap: 3 },
  goLiveTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  goLiveSub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  section: { gap: 12 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold", flex: 1 },
  seeAll: { fontSize: 13, fontFamily: "Inter_500Medium" },
  streamCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    gap: 12,
  },
  streamInfo: { flex: 1, gap: 4 },
  streamTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  streamTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1 },
  streamMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  streamPlatforms: { fontSize: 11, fontFamily: "Inter_400Regular", maxWidth: 100 },
  streamViewers: { flexDirection: "row", alignItems: "center", gap: 4 },
  viewerCount: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  emptyState: {
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
  },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptySubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  loader: { marginVertical: 20 },
  devicesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  deviceCard: {
    width: "47%",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    gap: 10,
    alignItems: "center",
  },
  deviceIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  deviceName: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center" },
});
