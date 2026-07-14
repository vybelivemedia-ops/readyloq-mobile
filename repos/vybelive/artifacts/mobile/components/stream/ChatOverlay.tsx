import { Feather } from "@expo/vector-icons";
import React, { useCallback } from "react";
import {
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import type { ChatMessage } from "@/contexts/StreamContext";

const PLATFORM_META: Record<string, { label: string; bg: string; text: string }> = {
  youtube:    { label: "YT",  bg: "#FF0000", text: "#FFF" },
  twitch:     { label: "TW",  bg: "#9146FF", text: "#FFF" },
  kick:       { label: "K",   bg: "#53FC18", text: "#000" },
  facebook:   { label: "FB",  bg: "#1877F2", text: "#FFF" },
  instagram:  { label: "IG",  bg: "#E1306C", text: "#FFF" },
  tiktok:     { label: "TK",  bg: "#00F2EA", text: "#000" },
  custom_rtmp:{ label: "RTMP",bg: "#888888", text: "#FFF" },
};

interface ChatOverlayProps {
  messages: ChatMessage[];
  pinnedMessage?: ChatMessage | null;
  onPinMessage?: (id: string) => void;
  onUnpin?: () => void;
  outdoorMode?: boolean;
}

function PlatformBadge({ platform }: { platform: string }) {
  const meta = PLATFORM_META[platform] ?? { label: platform.slice(0, 2).toUpperCase(), bg: "#555", text: "#FFF" };
  return (
    <View style={[styles.badge, { backgroundColor: meta.bg }]}>
      <Text style={[styles.badgeText, { color: meta.text }]}>{meta.label}</Text>
    </View>
  );
}

function ChatItem({
  msg,
  onLongPress,
  outdoorMode,
}: {
  msg: ChatMessage;
  onLongPress?: () => void;
  outdoorMode?: boolean;
}) {
  const fontSize = outdoorMode ? 14 : 12;
  const bgOpacity = outdoorMode ? "rgba(0,0,0,0.82)" : "rgba(0,0,0,0.55)";

  return (
    <TouchableOpacity
      onLongPress={onLongPress}
      activeOpacity={0.85}
      style={[styles.messageRow, { backgroundColor: bgOpacity }]}
    >
      <PlatformBadge platform={msg.platform} />
      <Text
        style={[styles.username, { color: msg.color ?? "#A78BFA", fontSize }]}
        numberOfLines={1}
      >
        {msg.username}
      </Text>
      <Text
        style={[styles.message, { color: "#FFFFFF", fontSize }]}
        numberOfLines={2}
      >
        {"  "}{msg.message}
      </Text>
    </TouchableOpacity>
  );
}

export function ChatOverlay({
  messages,
  pinnedMessage,
  onPinMessage,
  onUnpin,
  outdoorMode = false,
}: ChatOverlayProps) {
  const colors = useColors();

  const renderItem = useCallback(
    ({ item }: { item: ChatMessage }) => (
      <ChatItem
        msg={item}
        outdoorMode={outdoorMode}
        onLongPress={onPinMessage ? () => onPinMessage(item.id) : undefined}
      />
    ),
    [onPinMessage, outdoorMode]
  );

  return (
    <View style={styles.container}>
      {/* Pinned message */}
      {pinnedMessage && (
        <View style={styles.pinnedWrap}>
          <View style={[styles.pinnedCard, { backgroundColor: "rgba(123,97,255,0.25)", borderColor: "rgba(123,97,255,0.5)" }]}>
            <Feather name="bookmark" size={10} color="#A78BFA" style={{ marginTop: 1 }} />
            <View style={styles.pinnedContent}>
              <Text style={styles.pinnedLabel}>Pinned</Text>
              <Text style={styles.pinnedText} numberOfLines={2}>
                <Text style={{ color: "#A78BFA", fontFamily: "Inter_700Bold" }}>
                  {pinnedMessage.username}
                </Text>
                {"  "}{pinnedMessage.message}
              </Text>
            </View>
            {onUnpin && (
              <TouchableOpacity onPress={onUnpin} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <Feather name="x" size={12} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* Chat messages */}
      {messages.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Chat will appear here…</Text>
        </View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          inverted
          scrollEnabled={messages.length > 5}
          showsVerticalScrollIndicator={false}
          style={styles.list}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 6 },
  pinnedWrap: { paddingHorizontal: 0 },
  pinnedCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  pinnedContent: { flex: 1, gap: 1 },
  pinnedLabel: {
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    color: "#A78BFA",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  pinnedText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "#FFF",
    lineHeight: 17,
  },
  list: { maxHeight: 200 },
  listContent: { paddingVertical: 2, gap: 3 },
  messageRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    flexWrap: "wrap",
  },
  badge: {
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    flexShrink: 0,
    alignSelf: "center",
  },
  badgeText: {
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.3,
  },
  username: {
    fontFamily: "Inter_700Bold",
    flexShrink: 0,
  },
  message: {
    fontFamily: "Inter_400Regular",
    flex: 1,
    lineHeight: 17,
  },
  empty: { paddingVertical: 4 },
  emptyText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: "rgba(255,255,255,0.35)",
    fontStyle: "italic",
  },
});
