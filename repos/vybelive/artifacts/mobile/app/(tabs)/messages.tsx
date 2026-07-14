import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState, useCallback } from "react";
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/ui/Avatar";
import { LiveBadge } from "@/components/ui/LiveBadge";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import {
  useListConversations,
  getListConversationsQueryKey,
  useListStreams,
  useSendDirectMessage,
  useMarkConversationRead,
  type Stream,
} from "@workspace/api-client-react";

// Poll the conversation list so unread counts and last-message previews for
// newly received messages surface without leaving and re-entering the tab.
const CONVERSATION_POLL_MS = 5000;

const PLATFORM_COLORS: Record<string, string> = {
  youtube: "#FF0000",
  twitch: "#9146FF",
  kick: "#53FC18",
  facebook: "#1877F2",
  instagram: "#E1306C",
  tiktok: "#00F2EA",
};

type FilterType = "all" | "streams" | "dms";

type FilterTabProps = {
  label: string;
  active: boolean;
  onPress: () => void;
  badge?: number;
};

function FilterTab({ label, active, onPress, badge }: FilterTabProps) {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={[
        styles.filterTab,
        active && { backgroundColor: colors.primary + "22", borderColor: colors.primary + "55" },
        !active && { borderColor: "transparent" },
      ]}
    >
      <Text
        style={[
          styles.filterLabel,
          { color: active ? colors.primary : colors.mutedForeground },
        ]}
      >
        {label}
      </Text>
      {badge != null && badge > 0 && (
        <View style={[styles.filterBadge, { backgroundColor: colors.live }]}>
          <Text style={styles.filterBadgeText}>{badge > 9 ? "9+" : badge}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

function StreamChatCard({ stream }: { stream: Stream }) {
  const colors = useColors();
  const isLive = stream.status === "live";

  function relativeTime(dt?: Date | string | null): string {
    if (!dt) return "";
    const diff = Date.now() - new Date(dt).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return "Yesterday";
    return `${days}d ago`;
  }

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      style={[styles.chatCard, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={styles.chatCardLeft}>
        <View style={[styles.streamIconBox, { backgroundColor: colors.primary + "20" }]}>
          <Feather name="radio" size={18} color={colors.primary} />
          {isLive && (
            <View style={[styles.liveOverlay, { backgroundColor: colors.live }]}>
              <Text style={styles.liveOverlayText}>●</Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.chatCardMid}>
        <View style={styles.chatCardTitleRow}>
          {isLive && <LiveBadge size="sm" pulse />}
          <Text style={[styles.chatCardTitle, { color: colors.foreground }]} numberOfLines={1}>
            {stream.title}
          </Text>
        </View>

        <Text style={[styles.chatCardPreview, { color: colors.mutedForeground }]} numberOfLines={1}>
          {isLive ? "Chat is active" : "Stream ended"}
        </Text>

        <View style={styles.chatCardMeta}>
          <View style={styles.platformDots}>
            {(stream.platforms ?? [] as string[]).map((p) => (
              <View
                key={p}
                style={[styles.platformDot, { backgroundColor: PLATFORM_COLORS[p] ?? colors.muted }]}
              />
            ))}
          </View>
          {(stream.peakViewers ?? 0) > 0 && (
            <>
              <Feather name="users" size={11} color={colors.mutedForeground} />
              <Text style={[styles.chatCardCount, { color: colors.mutedForeground }]}>
                {(stream.peakViewers ?? 0).toLocaleString()} peak
              </Text>
            </>
          )}
        </View>
      </View>

      <View style={styles.chatCardRight}>
        <Text style={[styles.chatCardTime, { color: colors.mutedForeground }]}>
          {isLive ? "Now" : relativeTime(stream.endedAt ?? stream.startedAt ?? null)}
        </Text>
        {isLive && (
          <TouchableOpacity
            onPress={() => router.push("/stream/pov")}
            style={[styles.openBadge, { backgroundColor: colors.live + "22" }]}
          >
            <Text style={[styles.openBadgeText, { color: colors.live }]}>Open</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
}

function DmRow({
  conv,
  currentUserId,
  onOpen,
}: {
  conv: {
    id: string;
    otherUsers: { id: string; displayName: string; username: string; avatarUrl?: string | null }[];
    lastMessage?: { id: string; content: string; senderId: string; createdAt: string } | null;
    unreadCount: number;
    updatedAt: string;
  };
  currentUserId: string;
  onOpen: (convId: string) => void;
}) {
  const colors = useColors();
  const hasUnread = conv.unreadCount > 0;
  const other = conv.otherUsers[0];
  if (!other) return null;

  function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days === 1) return "Yesterday";
    return `${days}d ago`;
  }

  const previewText = conv.lastMessage
    ? conv.lastMessage.senderId === currentUserId
      ? `You: ${conv.lastMessage.content}`
      : conv.lastMessage.content
    : "No messages yet";

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => onOpen(conv.id)}
      style={[styles.dmRow, { borderBottomColor: colors.border }]}
    >
      <View style={styles.dmAvatarWrap}>
        <Avatar name={other.displayName} uri={other.avatarUrl} size={48} />
      </View>

      <View style={styles.dmContent}>
        <View style={styles.dmTitleRow}>
          <View style={styles.dmNameWrap}>
            <Text
              style={[
                styles.dmName,
                { color: colors.foreground },
                hasUnread && { fontFamily: "Inter_700Bold" },
              ]}
              numberOfLines={1}
            >
              {other.displayName}
            </Text>
            <Text style={[styles.dmHandle, { color: colors.mutedForeground }]} numberOfLines={1}>
              @{other.username}
            </Text>
          </View>
          <Text style={[styles.dmTime, { color: hasUnread ? colors.primary : colors.mutedForeground }]}>
            {relativeTime(conv.updatedAt)}
          </Text>
        </View>

        <View style={styles.dmPreviewRow}>
          <Text
            style={[
              styles.dmPreview,
              { color: hasUnread ? colors.foreground : colors.mutedForeground },
              hasUnread && { fontFamily: "Inter_500Medium" },
            ]}
            numberOfLines={1}
          >
            {previewText}
          </Text>
          {hasUnread && (
            <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}>
              <Text style={styles.unreadText}>{conv.unreadCount > 9 ? "9+" : conv.unreadCount}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function MessagesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const shareParams = useLocalSearchParams<{ shareType?: string; shareId?: string; shareLabel?: string }>();
  const shareMode = Boolean(shareParams.shareType && shareParams.shareId);
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : 0;

  const { data: convsData, isLoading: convsLoading, refetch: refetchConvs } = useListConversations(
    { limit: 50 },
    {
      query: {
        queryKey: getListConversationsQueryKey({ limit: 50 }),
        refetchInterval: CONVERSATION_POLL_MS,
      },
    },
  );
  const { data: streamsData, isLoading: streamsLoading, refetch: refetchStreams } = useListStreams({ limit: 10 });

  const markRead = useMarkConversationRead();

  const conversations = convsData?.items ?? [];
  const streams = streamsData?.items ?? [];
  // Only streams that were actually launched (startedAt is set); excludes scheduled/ghost streams
  const startedStreams = streams.filter((s) => s.startedAt != null);
  const liveStreams = startedStreams.filter((s) => s.status === "live");

  const totalUnreadDMs = conversations.reduce((s, c) => s + c.unreadCount, 0);

  const searchLower = search.toLowerCase();

  const filteredStreams = startedStreams.filter(
    (s) =>
      (filter === "all" || filter === "streams") &&
      (search === "" || s.title.toLowerCase().includes(searchLower))
  );

  const filteredConvs = conversations.filter(
    (c) =>
      (filter === "all" || filter === "dms") &&
      (search === "" ||
        c.otherUsers.some(
          (u) =>
            u.displayName.toLowerCase().includes(searchLower) ||
            u.username.toLowerCase().includes(searchLower)
        ))
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchConvs(), refetchStreams()]);
    setRefreshing(false);
  }, [refetchConvs, refetchStreams]);

  const handleOpenConv = useCallback(
    (convId: string) => {
      if (shareMode) {
        const qs = new URLSearchParams({
          shareType: String(shareParams.shareType),
          shareId: String(shareParams.shareId),
          ...(shareParams.shareLabel ? { shareLabel: String(shareParams.shareLabel) } : {}),
        }).toString();
        router.replace(`/conversation/${convId}?${qs}` as never);
        return;
      }
      markRead.mutate({ conversationId: convId });
      router.push(`/conversation/${convId}` as never);
    },
    [markRead, shareMode, shareParams.shareType, shareParams.shareId, shareParams.shareLabel]
  );

  const isLoading = convsLoading || streamsLoading;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        {shareMode && (
          <View style={[styles.shareModeBanner, { backgroundColor: colors.primary + "1A", borderColor: colors.primary + "40" }]}>
            <Feather name="share-2" size={14} color={colors.primary} />
            <Text style={[styles.shareModeText, { color: colors.foreground }]} numberOfLines={1}>
              Select a chat to share{shareParams.shareLabel ? `: ${shareParams.shareLabel}` : ""}
            </Text>
            <TouchableOpacity onPress={() => router.replace("/(tabs)/messages" as never)} hitSlop={8}>
              <Feather name="x" size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Messages</Text>
            {totalUnreadDMs > 0 && (
              <View style={[styles.headerBadge, { backgroundColor: colors.live }]}>
                <Text style={styles.headerBadgeText}>{totalUnreadDMs}</Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            style={[styles.composeBtn, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "40" }]}
            activeOpacity={0.8}
          >
            <Feather name="edit-2" size={16} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View
          style={[
            styles.searchBar,
            {
              backgroundColor: colors.muted,
              borderColor: searchFocused ? colors.primary + "60" : colors.border,
            },
          ]}
        >
          <Feather name="search" size={15} color={colors.mutedForeground} />
          <TextInput
            placeholder="Search messages…"
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            style={[styles.searchInput, { color: colors.foreground }]}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Feather name="x" size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>

        {/* Filter tabs */}
        <View style={styles.filterRow}>
          <FilterTab
            label="All"
            active={filter === "all"}
            onPress={() => setFilter("all")}
            badge={totalUnreadDMs}
          />
          <FilterTab
            label="Streams"
            active={filter === "streams"}
            onPress={() => setFilter("streams")}
            badge={liveStreams.length}
          />
          <FilterTab
            label="Direct"
            active={filter === "dms"}
            onPress={() => setFilter("dms")}
            badge={totalUnreadDMs}
          />
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad + 90 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {isLoading && (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}

        {/* Live now banner */}
        {!isLoading && filter !== "dms" && liveStreams.length > 0 && (
          <View style={[styles.liveBanner, { backgroundColor: colors.live + "14", borderColor: colors.live + "40" }]}>
            <View style={[styles.livePulse, { backgroundColor: colors.live }]} />
            <Text style={[styles.liveBannerText, { color: colors.live }]}>
              You're live now · Chat active across {liveStreams[0]?.platforms?.length ?? 0} platforms
            </Text>
            <TouchableOpacity onPress={() => router.push("/stream/pov")}>
              <Text style={[styles.liveBannerBtn, { color: colors.live }]}>View →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Stream chats */}
        {!isLoading && filteredStreams.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Stream Chats</Text>
              <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>
                {filteredStreams.length}
              </Text>
            </View>
            <View style={styles.streamChatList}>
              {filteredStreams.map((s) => (
                <StreamChatCard key={s.id} stream={s} />
              ))}
            </View>
          </View>
        )}

        {/* DMs */}
        {!isLoading && filteredConvs.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Direct Messages</Text>
              {totalUnreadDMs > 0 && (
                <View style={[styles.sectionBadge, { backgroundColor: colors.primary + "22" }]}>
                  <Text style={[styles.sectionBadgeText, { color: colors.primary }]}>
                    {totalUnreadDMs} unread
                  </Text>
                </View>
              )}
            </View>
            <View style={[styles.dmList, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {filteredConvs.map((c) => (
                <DmRow
                  key={c.id}
                  conv={c}
                  currentUserId={user?.id ?? ""}
                  onOpen={handleOpenConv}
                />
              ))}
            </View>
          </View>
        )}

        {/* Empty state */}
        {!isLoading && filteredStreams.length === 0 && filteredConvs.length === 0 && (
          <View style={styles.emptyState}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="message-square" size={32} color={colors.mutedForeground} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {search ? "No results found" : "No messages yet"}
            </Text>
            <Text style={[styles.emptySubtitle, { color: colors.mutedForeground }]}>
              {search
                ? "Try a different search term"
                : filter === "streams"
                ? "Start a stream to see live chat"
                : "Direct messages from other creators will appear here"}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  headerBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  headerBadgeText: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    color: "#FFF",
  },
  shareModeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  shareModeText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  composeBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },

  filterRow: {
    flexDirection: "row",
    gap: 8,
  },
  filterTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterLabel: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  filterBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  filterBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    color: "#FFF",
  },

  scrollContent: {
    paddingHorizontal: 16,
    gap: 20,
    paddingTop: 4,
  },

  loadingWrap: {
    paddingTop: 40,
    alignItems: "center",
  },

  liveBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  livePulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  liveBannerText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    lineHeight: 18,
  },
  liveBannerBtn: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    flexShrink: 0,
  },

  section: { gap: 10 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    flex: 1,
  },
  sectionCount: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  sectionBadge: {
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  sectionBadgeText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },

  streamChatList: { gap: 10 },

  chatCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  chatCardLeft: { flexShrink: 0 },
  streamIconBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  liveOverlay: {
    position: "absolute",
    bottom: -3,
    right: -3,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  liveOverlayText: {
    fontSize: 6,
    color: "#FFF",
  },
  chatCardMid: { flex: 1, gap: 4 },
  chatCardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  chatCardTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  chatCardPreview: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  chatCardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 2,
  },
  platformDots: { flexDirection: "row", gap: 3 },
  platformDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  chatCardCount: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  chatCardRight: {
    alignItems: "flex-end",
    gap: 6,
    flexShrink: 0,
  },
  chatCardTime: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  openBadge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  openBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },

  dmList: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  dmRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dmAvatarWrap: { position: "relative", flexShrink: 0 },
  dmContent: { flex: 1, gap: 4 },
  dmTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dmNameWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  dmName: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  dmHandle: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  dmTime: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    flexShrink: 0,
  },
  dmPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  dmPreview: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
    flexShrink: 0,
  },
  unreadText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    color: "#FFF",
  },

  emptyState: {
    alignItems: "center",
    paddingTop: 60,
    gap: 12,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingHorizontal: 32,
    lineHeight: 21,
  },
});
