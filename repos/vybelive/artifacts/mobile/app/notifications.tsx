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

import { useColors } from "@/hooks/useColors";
import {
  useListNotifications,
  useMarkAllNotificationsRead,
  getListNotificationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const NOTIFICATION_ICONS: Record<string, { icon: "users" | "radio" | "zap" | "star" | "shield" | "bell" | "user-plus"; color: string }> = {
  new_follower: { icon: "users", color: "#7B61FF" },
  stream_live: { icon: "radio", color: "#FF3B6C" },
  clip_ready: { icon: "zap", color: "#00D4FF" },
  subscription: { icon: "star", color: "#FFD700" },
  moderation: { icon: "shield", color: "#FF453A" },
  collaboration: { icon: "user-plus", color: "#00E0A4" },
  system: { icon: "bell", color: "#AAAAAA" },
};

function formatTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return "Just now";
}

export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const markAllRead = useMarkAllNotificationsRead();

  const { data: notifications, isLoading } = useListNotifications({ limit: 50 });

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const handleMarkAllRead = async () => {
    await markAllRead.mutateAsync();
    queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() });
  };

  const unreadCount = notifications?.filter((n) => !n.read).length ?? 0;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Feather name="x" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Notifications</Text>
        {unreadCount > 0 ? (
          <TouchableOpacity onPress={handleMarkAllRead}>
            <Text style={[styles.markAllText, { color: colors.primary }]}>Mark all read</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 80 }} />
        )}
      </View>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : (notifications?.length ?? 0) === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="bell" size={40} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>All caught up</Text>
          <Text style={[styles.emptySubtitle, { color: colors.mutedForeground }]}>
            No notifications yet
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {notifications?.map((notification) => {
            const meta = NOTIFICATION_ICONS[notification.type] ?? NOTIFICATION_ICONS.system;
            return (
              <View
                key={notification.id}
                style={[
                  styles.notifCard,
                  {
                    backgroundColor: notification.read ? colors.card : colors.card,
                    borderColor: notification.read ? colors.border : colors.primary + "30",
                    borderLeftColor: notification.read ? colors.border : meta.color,
                  },
                ]}
              >
                <View
                  style={[
                    styles.notifIcon,
                    { backgroundColor: meta.color + "20" },
                  ]}
                >
                  <Feather name={meta.icon} size={16} color={meta.color} />
                </View>
                <View style={styles.notifContent}>
                  <View style={styles.notifTitleRow}>
                    <Text style={[styles.notifTitle, { color: colors.foreground }]}>
                      {notification.title}
                    </Text>
                    {!notification.read && (
                      <View style={[styles.unreadDot, { backgroundColor: colors.primary }]} />
                    )}
                  </View>
                  <Text style={[styles.notifBody, { color: colors.mutedForeground }]} numberOfLines={2}>
                    {notification.message}
                  </Text>
                  <Text style={[styles.notifTime, { color: colors.mutedForeground }]}>
                    {formatTime(notification.createdAt)}
                  </Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  closeBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  markAllText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  loader: { marginTop: 60 },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingBottom: 60,
  },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  emptySubtitle: { fontSize: 14, fontFamily: "Inter_400Regular" },
  list: { paddingHorizontal: 16, gap: 8, paddingBottom: 40 },
  notifCard: {
    flexDirection: "row",
    gap: 12,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderLeftWidth: 3,
  },
  notifIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  notifContent: { flex: 1, gap: 4 },
  notifTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  notifTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  unreadDot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
  notifBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  notifTime: { fontSize: 11, fontFamily: "Inter_400Regular" },
});
