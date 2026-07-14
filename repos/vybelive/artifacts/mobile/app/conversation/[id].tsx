import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { pickMedia, uploadPickedMedia, type PickedMedia } from "@/lib/uploadMedia";
import {
  useGetConversationMessages,
  getGetConversationMessagesQueryKey,
  useMarkConversationRead,
  useSendDirectMessage,
  useSendMessageAttachment,
  useAddMessageReaction,
  useRemoveMessageReaction,
  useGetConversationReadState,
  getGetConversationReadStateQueryKey,
  useGetTypingState,
  getGetTypingStateQueryKey,
  useSetTypingSignal,
  type DirectMessageItem,
  type MessageAttachmentPreview,
} from "@workspace/api-client-react";

const API_BASE = process.env["EXPO_PUBLIC_DOMAIN"] ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}` : "https://getvybe.live";
const REACTION_EMOJI = ["❤️", "😂", "🔥", "👍", "😮", "😢"];
const TYPING_POLL_MS = 3000;
// Poll for newly received messages so incoming chat arrives near-instantly
// without a manual refresh, matching the read-state/typing polling cadence.
const MESSAGE_POLL_MS = 3000;

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

// ─── Attachment renderers ──────────────────────────────────────────────────────

function MediaImage({ url, token }: { url: string; token: string | null }) {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  return (
    <Image
      source={{ uri: `${API_BASE}${url}`, headers }}
      style={styles.mediaImage}
      contentFit="cover"
      transition={150}
    />
  );
}

function MediaVideo({ url, token }: { url: string; token: string | null }) {
  const source = useMemo(
    () => ({ uri: `${API_BASE}${url}`, headers: token ? { Authorization: `Bearer ${token}` } : undefined }),
    [url, token]
  );
  const player = useVideoPlayer(source, (p) => {
    p.loop = true;
  });
  return <VideoView style={styles.mediaImage} player={player} contentFit="cover" nativeControls />;
}

function SharedCard({
  attachment,
  onPress,
  textColor,
  subColor,
  cardBg,
  borderColor,
}: {
  attachment: MessageAttachmentPreview;
  onPress: () => void;
  textColor: string;
  subColor: string;
  cardBg: string;
  borderColor: string;
}) {
  const isProfile = attachment.kind === "profile";
  const thumb = isProfile ? attachment.avatarUrl : attachment.thumbnailUrl;
  const title = isProfile ? attachment.displayName : attachment.title;
  const sub =
    attachment.kind === "clip"
      ? "Clip"
      : attachment.kind === "stream"
        ? `Livestream${attachment.status ? ` · ${attachment.status}` : ""}`
        : attachment.username
          ? `@${attachment.username}`
          : "Profile";
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.sharedCard, { backgroundColor: cardBg, borderColor }]}
    >
      {thumb ? (
        <Image source={{ uri: thumb }} style={[styles.sharedThumb, isProfile && styles.sharedThumbRound]} contentFit="cover" />
      ) : (
        <View style={[styles.sharedThumb, isProfile && styles.sharedThumbRound, { backgroundColor: borderColor, alignItems: "center", justifyContent: "center" }]}>
          <Feather
            name={attachment.kind === "clip" ? "film" : attachment.kind === "stream" ? "radio" : "user"}
            size={20}
            color={subColor}
          />
        </View>
      )}
      <View style={styles.sharedMeta}>
        <Text style={[styles.sharedTitle, { color: textColor }]} numberOfLines={1}>
          {title ?? "Untitled"}
        </Text>
        <Text style={[styles.sharedSub, { color: subColor }]} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={subColor} />
    </TouchableOpacity>
  );
}

function AttachmentView({
  attachment,
  token,
}: {
  attachment: MessageAttachmentPreview;
  token: string | null;
}) {
  const colors = useColors();

  if (attachment.kind === "image" && attachment.url) {
    return <MediaImage url={attachment.url} token={token} />;
  }
  if (attachment.kind === "video" && attachment.url) {
    return <MediaVideo url={attachment.url} token={token} />;
  }
  if (attachment.kind === "clip") {
    return (
      <SharedCard
        attachment={attachment}
        onPress={() => router.push("/(tabs)/clips" as never)}
        textColor={colors.foreground}
        subColor={colors.mutedForeground}
        cardBg={colors.background}
        borderColor={colors.border}
      />
    );
  }
  if (attachment.kind === "stream") {
    return (
      <SharedCard
        attachment={attachment}
        onPress={() => router.push("/analytics" as never)}
        textColor={colors.foreground}
        subColor={colors.mutedForeground}
        cardBg={colors.background}
        borderColor={colors.border}
      />
    );
  }
  if (attachment.kind === "profile") {
    return (
      <SharedCard
        attachment={attachment}
        onPress={() => attachment.profileUserId && router.push(`/creator/${attachment.profileUserId}` as never)}
        textColor={colors.foreground}
        subColor={colors.mutedForeground}
        cardBg={colors.background}
        borderColor={colors.border}
      />
    );
  }
  return null;
}

// ─── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  isMine,
  token,
  showSeen,
  onLongPress,
  onToggleReaction,
}: {
  msg: DirectMessageItem;
  isMine: boolean;
  token: string | null;
  showSeen: boolean;
  onLongPress: () => void;
  onToggleReaction: (emoji: string) => void;
}) {
  const colors = useColors();
  const hasMedia = msg.attachment?.kind === "image" || msg.attachment?.kind === "video";
  const hasContent = Boolean(msg.content && msg.content.trim());

  return (
    <View style={[styles.bubbleRow, isMine && styles.bubbleRowMine]}>
      <View style={{ maxWidth: "82%", alignItems: isMine ? "flex-end" : "flex-start" }}>
        <Pressable onLongPress={onLongPress} delayLongPress={250}>
          <View
            style={[
              styles.bubble,
              hasMedia && styles.bubbleMedia,
              isMine
                ? { backgroundColor: hasMedia ? "transparent" : colors.primary }
                : { backgroundColor: hasMedia ? "transparent" : colors.card, borderColor: colors.border, borderWidth: hasMedia ? 0 : 1 },
            ]}
          >
            {!isMine && !hasMedia && (
              <Text style={[styles.bubbleSender, { color: colors.primary }]}>
                {msg.senderName ?? "User"}
              </Text>
            )}

            {msg.attachment && <AttachmentView attachment={msg.attachment} token={token} />}

            {hasContent && (
              <Text
                style={[
                  styles.bubbleText,
                  hasMedia && { marginTop: 6 },
                  { color: isMine && !hasMedia ? "#FFF" : colors.foreground },
                ]}
              >
                {msg.content}
              </Text>
            )}

            {!hasMedia && (
              <Text
                style={[
                  styles.bubbleTime,
                  { color: isMine ? "rgba(255,255,255,0.6)" : colors.mutedForeground },
                ]}
              >
                {relativeTime(msg.createdAt)}
              </Text>
            )}
          </View>
        </Pressable>

        {/* Reactions */}
        {msg.reactions.length > 0 && (
          <View style={[styles.reactionRow, isMine && { justifyContent: "flex-end" }]}>
            {msg.reactions.map((r) => (
              <TouchableOpacity
                key={r.emoji}
                onPress={() => onToggleReaction(r.emoji)}
                style={[
                  styles.reactionChip,
                  {
                    backgroundColor: r.reactedByMe ? colors.primary : colors.card,
                    borderColor: r.reactedByMe ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text style={styles.reactionEmoji}>{r.emoji}</Text>
                <Text style={[styles.reactionCount, { color: r.reactedByMe ? "#FFF" : colors.mutedForeground }]}>
                  {r.count}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {showSeen && <Text style={[styles.seenLabel, { color: colors.mutedForeground }]}>Seen</Text>}
      </View>
    </View>
  );
}

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function ConversationScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    id: string;
    shareType?: string;
    shareId?: string;
    shareLabel?: string;
  }>();
  const { user, getValidToken } = useAuth();
  const [draft, setDraft] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [reactionTarget, setReactionTarget] = useState<string | null>(null);
  const [pendingShare, setPendingShare] = useState<{ type: string; id: string; label: string } | null>(null);
  const flatRef = useRef<FlatList>(null);
  const typingSentAt = useRef(0);

  const conversationId = params.id ?? "";

  const { data, isLoading, refetch } = useGetConversationMessages(conversationId, {
    query: {
      queryKey: getGetConversationMessagesQueryKey(conversationId),
      refetchInterval: MESSAGE_POLL_MS,
      enabled: Boolean(conversationId),
    },
  });
  const { data: readState } = useGetConversationReadState(conversationId, {
    query: {
      queryKey: getGetConversationReadStateQueryKey(conversationId),
      refetchInterval: TYPING_POLL_MS,
      enabled: Boolean(conversationId),
    },
  });
  const { data: typingState } = useGetTypingState(conversationId, {
    query: {
      queryKey: getGetTypingStateQueryKey(conversationId),
      refetchInterval: TYPING_POLL_MS,
      enabled: Boolean(conversationId),
    },
  });
  const markRead = useMarkConversationRead();
  const send = useSendDirectMessage();
  const sendAttachment = useSendMessageAttachment();
  const addReaction = useAddMessageReaction();
  const removeReaction = useRemoveMessageReaction();
  const setTyping = useSetTypingSignal();

  const messages: DirectMessageItem[] = data?.items ?? [];

  // Resolve a fresh token for authenticated media fetches.
  useEffect(() => {
    let active = true;
    getValidToken().then((t) => {
      if (active) setToken(t);
    });
    return () => {
      active = false;
    };
  }, [getValidToken]);

  // Capture an incoming share intent from navigation params.
  useEffect(() => {
    if (params.shareType && params.shareId) {
      setPendingShare({
        type: params.shareType,
        id: params.shareId,
        label: params.shareLabel ?? "Shared content",
      });
    }
  }, [params.shareType, params.shareId, params.shareLabel]);

  useEffect(() => {
    if (conversationId) markRead.mutate({ conversationId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, messages.length]);

  // Other participant's last-read timestamp, used for "Seen" receipts.
  const otherLastReadAt = useMemo(() => {
    const others = (readState?.participants ?? []).filter((p) => p.userId !== user?.id);
    let latest: number | null = null;
    for (const p of others) {
      if (p.lastReadAt) {
        const t = new Date(p.lastReadAt).getTime();
        if (latest === null || t > latest) latest = t;
      }
    }
    return latest;
  }, [readState, user?.id]);

  // Index of my latest message that the other participant has seen.
  const lastSeenMineId = useMemo(() => {
    if (otherLastReadAt === null) return null;
    // messages is newest-first (inverted list)
    for (const m of messages) {
      if (m.senderId === user?.id && new Date(m.createdAt).getTime() <= otherLastReadAt) {
        return m.id;
      }
    }
    return null;
  }, [messages, otherLastReadAt, user?.id]);

  const othersTyping = (typingState?.typingUserIds ?? []).filter((uid) => uid !== user?.id);

  const handleTypingChange = useCallback(
    (text: string) => {
      setDraft(text);
      const now = Date.now();
      if (text.length > 0 && now - typingSentAt.current > 2000) {
        typingSentAt.current = now;
        setTyping.mutate({ conversationId, data: { isTyping: true } });
      }
    },
    [conversationId, setTyping]
  );

  const handleSend = useCallback(() => {
    const content = draft.trim();
    if (send.isPending || sendAttachment.isPending) return;

    // Send a pending share (with optional caption) first.
    if (pendingShare) {
      const data: Record<string, unknown> = { content: content || null };
      if (pendingShare.type === "clip") {
        data["type"] = "shared_clip";
        data["clipId"] = pendingShare.id;
      } else if (pendingShare.type === "stream") {
        data["type"] = "shared_stream";
        data["streamId"] = pendingShare.id;
      } else {
        data["type"] = "shared_profile";
        data["profileUserId"] = pendingShare.id;
      }
      setDraft("");
      setPendingShare(null);
      sendAttachment.mutate(
        { conversationId, data: data as never },
        {
          onSuccess: () => {
            refetch();
            setTyping.mutate({ conversationId, data: { isTyping: false } });
          },
          onError: () => Alert.alert("Couldn't share", "That content could not be shared."),
        }
      );
      return;
    }

    if (!content) return;
    setDraft("");
    setTyping.mutate({ conversationId, data: { isTyping: false } });
    send.mutate(
      { conversationId, data: { content } },
      {
        onSuccess: () => {
          refetch();
          setTimeout(() => flatRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
        },
      }
    );
  }, [draft, conversationId, send, sendAttachment, pendingShare, refetch, setTyping]);

  const handleAttach = useCallback(async () => {
    if (uploading || sendAttachment.isPending) return;
    let media: PickedMedia | null;
    try {
      media = await pickMedia();
    } catch (err) {
      Alert.alert("Permission needed", err instanceof Error ? err.message : "Could not open media library.");
      return;
    }
    if (!media) return;

    setUploading(true);
    try {
      const objectPath = await uploadPickedMedia(media);
      const caption = draft.trim();
      setDraft("");
      sendAttachment.mutate(
        {
          conversationId,
          data: {
            type: media.kind,
            objectPath,
            content: caption || null,
            ...(media.width != null ? { width: media.width } : {}),
            ...(media.height != null ? { height: media.height } : {}),
            ...(media.durationSeconds != null ? { durationSeconds: media.durationSeconds } : {}),
          },
        },
        {
          onSuccess: () => {
            refetch();
            setTimeout(() => flatRef.current?.scrollToOffset({ offset: 0, animated: true }), 100);
          },
          onError: () => Alert.alert("Upload failed", "Your media could not be sent."),
        }
      );
    } catch (err) {
      Alert.alert("Upload failed", err instanceof Error ? err.message : "Could not upload media.");
    } finally {
      setUploading(false);
    }
  }, [uploading, sendAttachment, draft, conversationId, refetch]);

  const toggleReaction = useCallback(
    (messageId: string, emoji: string, currentlyReacted: boolean) => {
      const onSettled = () => refetch();
      if (currentlyReacted) {
        removeReaction.mutate({ conversationId, messageId, emoji }, { onSettled });
      } else {
        addReaction.mutate({ conversationId, messageId, data: { emoji } }, { onSettled });
      }
    },
    [conversationId, addReaction, removeReaction, refetch]
  );

  const handlePickReaction = useCallback(
    (emoji: string) => {
      if (!reactionTarget) return;
      const msg = messages.find((m) => m.id === reactionTarget);
      const reacted = msg?.reactions.find((r) => r.emoji === emoji)?.reactedByMe ?? false;
      toggleReaction(reactionTarget, emoji, reacted);
      setReactionTarget(null);
    },
    [reactionTarget, messages, toggleReaction]
  );

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const canSend = (pendingShare ? true : Boolean(draft.trim())) && !send.isPending && !sendAttachment.isPending;

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 8, borderBottomColor: colors.border, backgroundColor: colors.background },
        ]}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
          Direct Message
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Messages list */}
      {isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Feather name="message-circle" size={36} color={colors.mutedForeground} />
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No messages yet. Say hello!</Text>
        </View>
      ) : (
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={(m) => m.id}
          inverted
          contentContainerStyle={styles.listContent}
          renderItem={({ item }: { item: DirectMessageItem }) => (
            <MessageBubble
              msg={item}
              isMine={item.senderId === user?.id}
              token={token}
              showSeen={item.id === lastSeenMineId}
              onLongPress={() => setReactionTarget(item.id)}
              onToggleReaction={(emoji) => {
                const reacted = item.reactions.find((r) => r.emoji === emoji)?.reactedByMe ?? false;
                toggleReaction(item.id, emoji, reacted);
              }}
            />
          )}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Typing indicator */}
      {othersTyping.length > 0 && (
        <View style={styles.typingRow}>
          <Text style={[styles.typingText, { color: colors.mutedForeground }]}>Typing…</Text>
        </View>
      )}

      {/* Pending share preview */}
      {pendingShare && (
        <View style={[styles.shareBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather
            name={pendingShare.type === "clip" ? "film" : pendingShare.type === "stream" ? "radio" : "user"}
            size={16}
            color={colors.primary}
          />
          <Text style={[styles.shareBannerText, { color: colors.foreground }]} numberOfLines={1}>
            Sharing: {pendingShare.label}
          </Text>
          <TouchableOpacity onPress={() => setPendingShare(null)} hitSlop={8}>
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      )}

      {/* Input */}
      <View
        style={[
          styles.inputRow,
          { backgroundColor: colors.background, borderTopColor: colors.border, paddingBottom: insets.bottom + 8 },
        ]}
      >
        <TouchableOpacity
          onPress={handleAttach}
          disabled={uploading}
          style={[styles.attachBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          activeOpacity={0.8}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather name="image" size={18} color={colors.foreground} />
          )}
        </TouchableOpacity>

        <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TextInput
            value={draft}
            onChangeText={handleTypingChange}
            placeholder={pendingShare ? "Add a message…" : "Message…"}
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground }]}
            multiline
            maxLength={4000}
          />
        </View>

        <TouchableOpacity
          onPress={handleSend}
          disabled={!canSend}
          style={[styles.sendBtn, { backgroundColor: canSend ? colors.primary : colors.muted }]}
          activeOpacity={0.8}
        >
          {send.isPending || sendAttachment.isPending ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Feather name="send" size={16} color="#FFF" />
          )}
        </TouchableOpacity>
      </View>

      {/* Reaction picker */}
      <Modal visible={reactionTarget !== null} transparent animationType="fade" onRequestClose={() => setReactionTarget(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setReactionTarget(null)}>
          <View style={[styles.reactionPicker, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {REACTION_EMOJI.map((emoji) => (
              <TouchableOpacity key={emoji} onPress={() => handlePickReaction(emoji)} style={styles.reactionPickerBtn}>
                <Text style={styles.reactionPickerEmoji}>{emoji}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", flex: 1, textAlign: "center" },

  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 32 },
  emptyText: { fontSize: 15, fontFamily: "Inter_400Regular", textAlign: "center" },

  listContent: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },

  bubbleRow: { flexDirection: "row", justifyContent: "flex-start", marginVertical: 3 },
  bubbleRowMine: { justifyContent: "flex-end" },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, gap: 3 },
  bubbleMedia: { padding: 0, overflow: "hidden" },
  bubbleSender: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  bubbleText: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 21 },
  bubbleTime: { fontSize: 10, fontFamily: "Inter_400Regular", alignSelf: "flex-end", marginTop: 2 },

  mediaImage: { width: 220, height: 220, borderRadius: 16, backgroundColor: "#000" },

  sharedCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 8,
    borderRadius: 14,
    borderWidth: 1,
    width: 240,
  },
  sharedThumb: { width: 44, height: 44, borderRadius: 8 },
  sharedThumbRound: { borderRadius: 22 },
  sharedMeta: { flex: 1, gap: 2 },
  sharedTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sharedSub: { fontSize: 12, fontFamily: "Inter_400Regular" },

  reactionRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  reactionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 11,
    borderWidth: 1,
  },
  reactionEmoji: { fontSize: 12 },
  reactionCount: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  seenLabel: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 2, marginRight: 2 },

  typingRow: { paddingHorizontal: 24, paddingBottom: 4 },
  typingText: { fontSize: 12, fontFamily: "Inter_400Regular", fontStyle: "italic" },

  shareBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  shareBannerText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },

  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  attachBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  inputWrap: {
    flex: 1,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === "ios" ? 10 : 8,
    maxHeight: 120,
  },
  input: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 21 },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  reactionPicker: {
    flexDirection: "row",
    gap: 4,
    padding: 10,
    borderRadius: 28,
    borderWidth: 1,
  },
  reactionPickerBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  reactionPickerEmoji: { fontSize: 28 },
});
