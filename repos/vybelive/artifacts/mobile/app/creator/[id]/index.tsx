import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
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
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import {
  useGetUserProfile,
  useFollowUser,
  useUnfollowUser,
  useStartConversation,
  useCreateCollaborationRequest,
} from "@workspace/api-client-react";

const COLLAB_TYPES: { value: "co_stream" | "joint_podcast" | "event" | "other"; label: string; icon: "radio" | "mic" | "calendar" | "users" }[] = [
  { value: "co_stream", label: "Co-stream", icon: "radio" },
  { value: "joint_podcast", label: "Joint podcast", icon: "mic" },
  { value: "event", label: "Event", icon: "calendar" },
  { value: "other", label: "Other", icon: "users" },
];

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

function categoryLabel(c?: string | null): string | null {
  if (!c) return null;
  return c
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function CreatorProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user: me } = useAuth();

  const { data: profile, isLoading, refetch } = useGetUserProfile(String(id));
  const followMut = useFollowUser();
  const unfollowMut = useUnfollowUser();
  const startConv = useStartConversation();
  const createCollab = useCreateCollaborationRequest();

  const [busy, setBusy] = useState(false);
  const [collabOpen, setCollabOpen] = useState(false);
  const [collabType, setCollabType] = useState<"co_stream" | "joint_podcast" | "event" | "other">("co_stream");
  const [collabMessage, setCollabMessage] = useState("");
  const [collabBusy, setCollabBusy] = useState(false);
  const [collabSent, setCollabSent] = useState(false);
  const isSelf = me?.id === id;

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : 0;

  const handleToggleFollow = async () => {
    if (!profile || busy) return;
    setBusy(true);
    try {
      if (profile.isFollowing) {
        await unfollowMut.mutateAsync({ userId: String(id) });
      } else {
        await followMut.mutateAsync({ userId: String(id) });
      }
      await refetch();
    } catch {
      // best-effort; UI re-syncs on next refetch
    } finally {
      setBusy(false);
    }
  };

  const handleMessage = async () => {
    if (!profile || busy) return;
    setBusy(true);
    try {
      const conv = await startConv.mutateAsync({ data: { otherUserId: String(id) } });
      router.push(`/conversation/${conv.id}` as never);
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  const handleSendCollab = async () => {
    if (!profile || collabBusy) return;
    const msg = collabMessage.trim();
    if (!msg) return;
    setCollabBusy(true);
    try {
      await createCollab.mutateAsync({
        data: { toUserId: String(id), type: collabType, message: msg },
      });
      setCollabSent(true);
      setCollabMessage("");
    } catch {
      // best-effort
    } finally {
      setCollabBusy(false);
    }
  };

  const closeCollab = () => {
    setCollabOpen(false);
    setCollabSent(false);
    setCollabType("co_stream");
    setCollabMessage("");
  };

  const handleShareProfile = () => {
    if (!profile) return;
    const qs = new URLSearchParams({
      shareType: "profile",
      shareId: String(id),
      shareLabel: profile.displayName ?? `@${profile.username}`,
    }).toString();
    router.push(`/(tabs)/messages?${qs}` as never);
  };

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, paddingTop: topPad }]}>
        <Text style={[styles.notFound, { color: colors.mutedForeground }]}>Creator not found</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={[styles.backLink, { color: colors.primary }]}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const cat = categoryLabel(profile.category);
  const locationParts = [profile.locationCity, profile.locationRegion, profile.locationCountry].filter(
    Boolean,
  );

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 8, paddingBottom: bottomPad + 40 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      {/* Identity */}
      <View style={styles.identity}>
        <Avatar uri={profile.avatarUrl} name={profile.displayName} size={88} showRing ringColor={colors.primary} />
        <Text style={[styles.displayName, { color: colors.foreground }]}>{profile.displayName}</Text>
        <Text style={[styles.username, { color: colors.mutedForeground }]}>@{profile.username}</Text>

        {cat ? (
          <View style={[styles.categoryPill, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "50" }]}>
            <Feather name="tag" size={11} color={colors.primary} />
            <Text style={[styles.categoryText, { color: colors.primary }]}>{cat}</Text>
          </View>
        ) : null}

        {locationParts.length > 0 ? (
          <View style={styles.locationRow}>
            <Feather name="map-pin" size={12} color={colors.mutedForeground} />
            <Text style={[styles.locationText, { color: colors.mutedForeground }]}>
              {locationParts.join(", ")}
            </Text>
          </View>
        ) : null}

        {profile.bio ? (
          <Text style={[styles.bio, { color: colors.secondaryForeground }]}>{profile.bio}</Text>
        ) : null}
      </View>

      {/* Stats */}
      <View style={[styles.statsRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <TouchableOpacity
          style={styles.statItem}
          onPress={() => router.push(`/creator/${id}/followers` as never)}
        >
          <Text style={[styles.statValue, { color: colors.foreground }]}>
            {formatNumber(profile.followersCount)}
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Followers</Text>
        </TouchableOpacity>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <TouchableOpacity
          style={styles.statItem}
          onPress={() => router.push(`/creator/${id}/following` as never)}
        >
          <Text style={[styles.statValue, { color: colors.foreground }]}>
            {formatNumber(profile.followingCount)}
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Following</Text>
        </TouchableOpacity>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.foreground }]}>{profile.totalStreams}</Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Streams</Text>
        </View>
      </View>

      {/* Actions */}
      {!isSelf ? (
        <View style={styles.actionsRow}>
          <TouchableOpacity
            onPress={handleToggleFollow}
            disabled={busy}
            style={[
              styles.actionBtn,
              { flex: 2 },
              profile.isFollowing
                ? { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }
                : { backgroundColor: colors.primary, shadowColor: colors.primary },
            ]}
          >
            <Feather
              name={profile.isFollowing ? "check" : "user-plus"}
              size={16}
              color={profile.isFollowing ? colors.foreground : "#FFF"}
            />
            <Text style={[styles.actionBtnText, { color: profile.isFollowing ? colors.foreground : "#FFF" }]}>
              {profile.isFollowing ? "Following" : "Follow"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleMessage}
            disabled={busy}
            style={[styles.actionBtn, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}
          >
            <Feather name="message-circle" size={16} color={colors.foreground} />
            <Text style={[styles.actionBtnText, { color: colors.foreground }]}>Message</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleShareProfile}
            style={[styles.shareIconBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
            hitSlop={6}
          >
            <Feather name="share-2" size={16} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      ) : null}

      {!isSelf ? (
        <TouchableOpacity
          onPress={() => setCollabOpen(true)}
          style={[styles.collabBtn, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "50" }]}
        >
          <Feather name="zap" size={16} color={colors.primary} />
          <Text style={[styles.collabBtnText, { color: colors.primary }]}>Propose collaboration</Text>
        </TouchableOpacity>
      ) : null}

      {/* Social links */}
      {profile.socialLinks && profile.socialLinks.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Links</Text>
          <View style={styles.linksWrap}>
            {profile.socialLinks.map((link, i) => (
              <TouchableOpacity
                key={`${link.platform}-${i}`}
                onPress={() => Linking.openURL(link.url).catch(() => {})}
                style={[styles.linkChip, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Feather name="link" size={12} color={colors.cyan} />
                <Text style={[styles.linkText, { color: colors.foreground }]} numberOfLines={1}>
                  {link.platform}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : null}

      {/* Collaboration interests */}
      {profile.collaborationInterests && profile.collaborationInterests.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Open to collaborate on</Text>
          <View style={styles.linksWrap}>
            {profile.collaborationInterests.map((interest, i) => (
              <View
                key={`${interest}-${i}`}
                style={[styles.interestChip, { backgroundColor: colors.cyan + "18", borderColor: colors.cyan + "40" }]}
              >
                <Text style={[styles.interestText, { color: colors.cyan }]}>{interest}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {/* Recent streams */}
      {profile.recentStreams && profile.recentStreams.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent Streams</Text>
          {profile.recentStreams.map((stream) => (
            <View
              key={stream.id}
              style={[styles.streamCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.streamTitleRow}>
                {stream.status === "live" && <LiveBadge size="sm" />}
                <Text style={[styles.streamTitle, { color: colors.foreground }]} numberOfLines={1}>
                  {stream.title}
                </Text>
              </View>
              <Text style={[styles.streamMeta, { color: colors.mutedForeground }]}>
                {stream.totalViews ?? 0} views
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Recent clips */}
      {profile.recentClips && profile.recentClips.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent Clips</Text>
          <View style={styles.clipsGrid}>
            {profile.recentClips.map((clip) => (
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
      ) : null}

      <Modal visible={collabOpen} transparent animationType="slide" onRequestClose={closeCollab}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.modalRoot}
        >
          <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={closeCollab} />
          <View style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {collabSent ? (
              <View style={styles.collabSentBox}>
                <View style={[styles.collabSentIcon, { backgroundColor: colors.primary + "20" }]}>
                  <Feather name="check" size={28} color={colors.primary} />
                </View>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Request sent</Text>
                <Text style={[styles.modalSubtitle, { color: colors.mutedForeground }]}>
                  {profile.displayName} will be notified. You can track the status in Collaborations.
                </Text>
                <TouchableOpacity
                  onPress={closeCollab}
                  style={[styles.modalPrimaryBtn, { backgroundColor: colors.primary }]}
                >
                  <Text style={styles.modalPrimaryText}>Done</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: colors.foreground }]}>Propose collaboration</Text>
                  <TouchableOpacity onPress={closeCollab} hitSlop={8}>
                    <Feather name="x" size={22} color={colors.mutedForeground} />
                  </TouchableOpacity>
                </View>
                <Text style={[styles.modalSubtitle, { color: colors.mutedForeground }]}>
                  Send {profile.displayName} a collaboration idea.
                </Text>

                <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Type</Text>
                <View style={styles.typeGrid}>
                  {COLLAB_TYPES.map((t) => {
                    const active = collabType === t.value;
                    return (
                      <TouchableOpacity
                        key={t.value}
                        onPress={() => setCollabType(t.value)}
                        style={[
                          styles.typeChip,
                          {
                            backgroundColor: active ? colors.primary + "20" : colors.background,
                            borderColor: active ? colors.primary : colors.border,
                          },
                        ]}
                      >
                        <Feather name={t.icon} size={14} color={active ? colors.primary : colors.mutedForeground} />
                        <Text style={[styles.typeChipText, { color: active ? colors.primary : colors.foreground }]}>
                          {t.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Message</Text>
                <TextInput
                  value={collabMessage}
                  onChangeText={setCollabMessage}
                  placeholder="What do you have in mind?"
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  style={[
                    styles.messageInput,
                    { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground },
                  ]}
                />

                <TouchableOpacity
                  onPress={handleSendCollab}
                  disabled={collabBusy || collabMessage.trim().length === 0}
                  style={[
                    styles.modalPrimaryBtn,
                    {
                      backgroundColor: colors.primary,
                      opacity: collabBusy || collabMessage.trim().length === 0 ? 0.5 : 1,
                    },
                  ]}
                >
                  {collabBusy ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={styles.modalPrimaryText}>Send request</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 18 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  notFound: { fontSize: 15, fontFamily: "Inter_500Medium" },
  backLink: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  topBar: { flexDirection: "row", alignItems: "center" },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginLeft: -8 },
  identity: { alignItems: "center", gap: 8 },
  displayName: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.3, marginTop: 4 },
  username: { fontSize: 14, fontFamily: "Inter_400Regular" },
  categoryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 2,
  },
  categoryText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  locationText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  bio: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 21, paddingHorizontal: 16 },
  statsRow: { flexDirection: "row", borderRadius: 16, borderWidth: 1, paddingVertical: 16 },
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
  actionBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  shareIconBtn: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    borderWidth: 1,
  },
  section: { gap: 10 },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  linksWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  linkChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    maxWidth: "100%",
  },
  linkText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  interestChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1 },
  interestText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  streamCard: { borderRadius: 12, padding: 12, borderWidth: 1, gap: 4 },
  streamTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  streamTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", flex: 1 },
  streamMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  clipsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
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
  collabBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
  },
  collabBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    padding: 20,
    paddingBottom: 32,
    gap: 12,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontSize: 19, fontFamily: "Inter_700Bold", letterSpacing: -0.2 },
  modalSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
  },
  typeChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  messageInput: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    minHeight: 90,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlignVertical: "top",
  },
  modalPrimaryBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 14,
    marginTop: 4,
  },
  modalPrimaryText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFF" },
  collabSentBox: { alignItems: "center", gap: 10, paddingVertical: 12 },
  collabSentIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
});
