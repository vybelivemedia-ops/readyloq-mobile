import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
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

import { StreamActionSheet } from "@/components/stream/StreamActionSheet";
import { Avatar } from "@/components/ui/Avatar";
import { LiveBadge } from "@/components/ui/LiveBadge";
import { APP_VERSION, BUILD_NUMBER } from "@/constants/version";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useGetMyStats, useListStreams, useListClips } from "@workspace/api-client-react";
import type { Stream } from "@workspace/api-client-react";

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();

  const { data: stats, isLoading: statsLoading } = useGetMyStats();
  const { data: streamsData } = useListStreams({ limit: 3 });
  const { data: clipsData } = useListClips({ limit: 4 });

  const [actionStream, setActionStream] = useState<Stream | null>(null);

  const openActions = (stream: Stream) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActionStream(stream);
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : 0;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 16, paddingBottom: bottomPad + 90 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.push("/settings")}
          style={[styles.settingsBtn, { backgroundColor: colors.card }]}
        >
          <Feather name="settings" size={20} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      {/* Profile section */}
      <View style={styles.profileSection}>
        <Avatar
          uri={user?.avatarUrl}
          name={user?.displayName ?? ""}
          size={88}
          showRing
          ringColor={colors.primary}
        />
        <Text style={[styles.displayName, { color: colors.foreground }]}>
          {user?.displayName ?? "Creator"}
        </Text>
        <Text style={[styles.username, { color: colors.mutedForeground }]}>
          @{user?.username ?? "username"}
        </Text>
        {user?.bio ? (
          <Text style={[styles.bio, { color: colors.secondaryForeground }]}>
            {user.bio}
          </Text>
        ) : null}

        {/* Plan badge */}
        <View
          style={[
            styles.planBadge,
            {
              backgroundColor:
                user?.plan === "pro"
                  ? colors.primary + "25"
                  : user?.plan === "enterprise"
                  ? colors.cyan + "25"
                  : colors.muted,
              borderColor:
                user?.plan === "pro"
                  ? colors.primary + "60"
                  : user?.plan === "enterprise"
                  ? colors.cyan + "60"
                  : colors.border,
            },
          ]}
        >
          <Feather
            name={user?.plan === "free" ? "user" : "star"}
            size={10}
            color={
              user?.plan === "pro"
                ? colors.primary
                : user?.plan === "enterprise"
                ? colors.cyan
                : colors.mutedForeground
            }
          />
          <Text
            style={[
              styles.planText,
              {
                color:
                  user?.plan === "pro"
                    ? colors.primary
                    : user?.plan === "enterprise"
                    ? colors.cyan
                    : colors.mutedForeground,
              },
            ]}
          >
            {(user?.plan ?? "free").toUpperCase()}
          </Text>
        </View>
      </View>

      {/* Stats */}
      {statsLoading ? (
        <ActivityIndicator color={colors.primary} />
      ) : stats ? (
        <View style={[styles.statsRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {[
            {
              label: "Followers",
              value: formatNumber(stats.totalFollowers),
              onPress: user?.id ? () => router.push(`/creator/${user.id}/followers` as never) : undefined,
            },
            {
              label: "Following",
              value: formatNumber(user?.followingCount ?? 0),
              onPress: user?.id ? () => router.push(`/creator/${user.id}/following` as never) : undefined,
            },
            { label: "Streams", value: stats.totalStreams.toString(), onPress: undefined },
            { label: "Clips", value: stats.totalClips.toString(), onPress: undefined },
          ].map((s, i, arr) => (
            <React.Fragment key={s.label}>
              <TouchableOpacity
                style={styles.statItem}
                onPress={s.onPress}
                disabled={!s.onPress}
                activeOpacity={s.onPress ? 0.6 : 1}
              >
                <Text style={[styles.statValue, { color: colors.foreground }]}>{s.value}</Text>
                <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
              </TouchableOpacity>
              {i < arr.length - 1 && (
                <View style={[styles.divider, { backgroundColor: colors.border }]} />
              )}
            </React.Fragment>
          ))}
        </View>
      ) : null}

      {/* Quick actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          onPress={() => router.push("/stream/setup")}
          style={[styles.actionBtn, { backgroundColor: colors.live, flex: 2, shadowColor: colors.live }]}
        >
          <Feather name="radio" size={16} color="#FFF" />
          <Text style={styles.actionBtnText}>Go Live</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.push("/settings")}
          style={[styles.actionBtn, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}
        >
          <Feather name="edit-2" size={16} color={colors.foreground} />
          <Text style={[styles.actionBtnText, { color: colors.foreground }]}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => router.push("/settings/subscription")}
          style={[styles.actionBtn, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}
        >
          <Feather name="star" size={16} color={colors.primary} />
          <Text style={[styles.actionBtnText, { color: colors.primary }]}>Pro</Text>
        </TouchableOpacity>
      </View>

      {/* Recent streams */}
      {(streamsData?.items?.length ?? 0) > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent Streams</Text>
            <TouchableOpacity onPress={() => router.push("/(tabs)/live")}>
              <Text style={[styles.seeAll, { color: colors.primary }]}>See all</Text>
            </TouchableOpacity>
          </View>
          {streamsData?.items?.map((stream) => (
            <TouchableOpacity
              key={stream.id}
              activeOpacity={0.85}
              onLongPress={() => openActions(stream)}
              delayLongPress={400}
              style={[styles.streamCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.streamInfo}>
                <View style={styles.streamTitleRow}>
                  {stream.status === "live" && <LiveBadge size="sm" />}
                  <Text style={[styles.streamTitle, { color: colors.foreground }]} numberOfLines={1}>
                    {stream.title}
                  </Text>
                </View>
                <Text style={[styles.streamMeta, { color: colors.mutedForeground }]}>
                  {stream.totalViews ?? 0} views • {stream.clipsCount ?? 0} clips
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Recent clips */}
      {(clipsData?.items?.length ?? 0) > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent Clips</Text>
            <TouchableOpacity onPress={() => router.push("/(tabs)/clips")}>
              <Text style={[styles.seeAll, { color: colors.primary }]}>See all</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.clipsGrid}>
            {clipsData?.items?.slice(0, 4).map((clip) => (
              <View
                key={clip.id}
                style={[styles.clipThumb, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Feather name="play" size={16} color={colors.mutedForeground} />
                <Text style={[styles.clipTitle, { color: colors.foreground }]} numberOfLines={2}>
                  {clip.title}
                </Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Menu */}
      <View style={[styles.menuSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {[
          { icon: "settings" as const, label: "Settings", path: "/settings" },
          { icon: "bar-chart-2" as const, label: "Analytics", path: "/analytics" },
          { icon: "film" as const, label: "Recordings & Archive", path: "/recordings" },
          { icon: "bell" as const, label: "Notifications", path: "/notifications" },
          { icon: "user-plus" as const, label: "Collaborations", path: "/collaborations" },
          { icon: "shield" as const, label: "Executive Approvals", path: "/approvals" },
          { icon: "link-2" as const, label: "Streaming Platforms", path: "/settings/platforms" },
          { icon: "star" as const, label: "Subscription & Billing", path: "/settings/subscription" },
          { icon: "file-text" as const, label: "Terms of Service", path: "/legal/terms" },
          { icon: "lock" as const, label: "Privacy Policy", path: "/legal/privacy" },
        ].map((item, i, arr) => (
          <React.Fragment key={item.label}>
            <TouchableOpacity
              onPress={() => router.push(item.path as never)}
              style={styles.menuItem}
            >
              <View style={[styles.menuIcon, { backgroundColor: colors.muted }]}>
                <Feather name={item.icon} size={16} color={colors.foreground} />
              </View>
              <Text style={[styles.menuLabel, { color: colors.foreground }]}>{item.label}</Text>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
            {i < arr.length - 1 && (
              <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
            )}
          </React.Fragment>
        ))}
      </View>

      {/* Logout */}
      <TouchableOpacity
        onPress={logout}
        style={[styles.logoutBtn, { borderColor: colors.destructive + "50" }]}
      >
        <Feather name="log-out" size={16} color={colors.destructive} />
        <Text style={[styles.logoutText, { color: colors.destructive }]}>Sign Out</Text>
      </TouchableOpacity>

      <Text style={[styles.versionFooter, { color: colors.mutedForeground }]}>
        v{APP_VERSION} ({BUILD_NUMBER})
      </Text>

      <StreamActionSheet stream={actionStream} onClose={() => setActionStream(null)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 20 },
  header: { alignItems: "flex-end" },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  profileSection: {
    alignItems: "center",
    gap: 8,
    paddingBottom: 4,
  },
  displayName: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.3, marginTop: 4 },
  username: { fontSize: 14, fontFamily: "Inter_400Regular" },
  bio: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21, paddingHorizontal: 20 },
  planBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  planText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  statsRow: {
    flexDirection: "row",
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 16,
  },
  statItem: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular" },
  divider: { width: 1, marginVertical: 4 },
  actionsRow: { flexDirection: "row", gap: 10 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 4,
  },
  actionBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFF" },
  section: { gap: 10 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  seeAll: { fontSize: 13, fontFamily: "Inter_500Medium" },
  streamCard: {
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
  },
  streamInfo: { gap: 4 },
  streamTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  streamTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1 },
  streamMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  clipsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  clipThumb: {
    width: "47%",
    aspectRatio: 4 / 3,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 10,
    gap: 8,
  },
  clipTitle: { fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "center" },
  menuSection: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  menuIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  menuLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  menuDivider: { height: StyleSheet.hairlineWidth, marginLeft: 60 },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 8,
  },
  logoutText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  versionFooter: {
    textAlign: "center",
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    opacity: 0.4,
    marginBottom: 4,
  },
});
