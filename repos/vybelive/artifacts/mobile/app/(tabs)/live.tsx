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
import { GlowButton } from "@/components/ui/GlowButton";
import { LiveBadge } from "@/components/ui/LiveBadge";
import { useColors } from "@/hooks/useColors";
import { useStream } from "@/contexts/StreamContext";
import { useListStreams, useListPlatforms } from "@workspace/api-client-react";
import type { Stream } from "@workspace/api-client-react";

const DEVICE_OPTIONS = [
  { type: "phone" as const, label: "Phone Camera", icon: "smartphone" as const, desc: "Use your phone as a POV cam" },
  { type: "meta_glasses" as const, label: "Meta Glasses", icon: "eye" as const, desc: "Ray-Ban Meta smart glasses" },
  { type: "gopro" as const, label: "GoPro", icon: "camera" as const, desc: "GoPro Hero via RTMP" },
  { type: "external_rtmp" as const, label: "External RTMP", icon: "wifi" as const, desc: "Custom RTMP source" },
];

export default function LiveScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { deviceType, setDeviceType } = useStream();

  const { data: streamsData, isLoading: streamsLoading } = useListStreams({ status: "ended", limit: 5 });
  const { data: platforms, isLoading: platformsLoading } = useListPlatforms();

  const [actionStream, setActionStream] = useState<Stream | null>(null);

  const openActions = (stream: Stream) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActionStream(stream);
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : 0;

  const connectedPlatforms = platforms?.filter((p) => p.isActive) ?? [];

  const handleShareStream = (stream: { id: string; title: string }) => {
    const qs = new URLSearchParams({
      shareType: "stream",
      shareId: stream.id,
      shareLabel: stream.title,
    }).toString();
    router.push(`/(tabs)/messages?${qs}` as never);
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 16, paddingBottom: bottomPad + 90 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.screenTitle, { color: colors.foreground }]}>POV Studio</Text>
      <Text style={[styles.screenSubtitle, { color: colors.mutedForeground }]}>
        Select your device and go live everywhere
      </Text>

      {/* Device selector */}
      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>STREAMING DEVICE</Text>
        <View style={styles.deviceGrid}>
          {DEVICE_OPTIONS.map((d) => {
            const active = deviceType === d.type;
            return (
              <TouchableOpacity
                key={d.type}
                onPress={() => setDeviceType(d.type)}
                activeOpacity={0.8}
                style={[
                  styles.deviceCard,
                  {
                    backgroundColor: active ? colors.primary + "20" : colors.card,
                    borderColor: active ? colors.primary : colors.border,
                    shadowColor: active ? colors.primary : "transparent",
                  },
                ]}
              >
                <View
                  style={[
                    styles.deviceIcon,
                    { backgroundColor: active ? colors.primary + "30" : colors.muted },
                  ]}
                >
                  <Feather name={d.icon} size={20} color={active ? colors.primary : colors.mutedForeground} />
                </View>
                <Text style={[styles.deviceLabel, { color: active ? colors.primary : colors.foreground }]}>
                  {d.label}
                </Text>
                <Text style={[styles.deviceDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
                  {d.desc}
                </Text>
                {active && (
                  <View style={[styles.activeDot, { backgroundColor: colors.primary }]} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Platforms */}
      <View style={styles.section}>
        <View style={styles.sectionRow}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PLATFORMS</Text>
          <TouchableOpacity onPress={() => router.push("/settings/platforms")}>
            <Text style={[styles.manageText, { color: colors.primary }]}>Manage</Text>
          </TouchableOpacity>
        </View>

        {platformsLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : connectedPlatforms.length === 0 ? (
          <TouchableOpacity
            onPress={() => router.push("/settings/platforms")}
            style={[styles.addPlatformCard, { backgroundColor: colors.card, borderColor: colors.primary + "40" }]}
          >
            <Feather name="plus-circle" size={20} color={colors.primary} />
            <Text style={[styles.addPlatformText, { color: colors.primary }]}>Connect streaming platforms</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.platformsList}>
            {connectedPlatforms.map((p) => (
              <View
                key={p.id}
                style={[styles.platformRow, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <View style={[styles.platformDot, getPlatformStyle(p.type)]} />
                <Text style={[styles.platformName, { color: colors.foreground }]}>
                  {p.name || p.type.replace("_", " ")}
                </Text>
                <View
                  style={[
                    styles.connectedBadge,
                    { backgroundColor: colors.neonGreen + "20" },
                  ]}
                >
                  <Text style={[styles.connectedText, { color: colors.neonGreen }]}>Connected</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Go Live */}
      <GlowButton
        title="Go Live"
        onPress={() => router.push("/stream/setup")}
        variant="live"
        size="lg"
        fullWidth
        icon={<Feather name="radio" size={20} color="#FFF" />}
      />

      {/* Stream history */}
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Stream History</Text>
        {streamsLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (streamsData?.items?.length ?? 0) === 0 ? (
          <View style={[styles.emptyState, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="video-off" size={28} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No streams yet</Text>
          </View>
        ) : (
          streamsData?.items?.map((stream) => (
            <TouchableOpacity
              key={stream.id}
              activeOpacity={0.85}
              onLongPress={() => openActions(stream)}
              delayLongPress={400}
              style={[styles.historyCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={styles.historyInfo}>
                <Text style={[styles.historyTitle, { color: colors.foreground }]} numberOfLines={1}>
                  {stream.title}
                </Text>
                <Text style={[styles.historyMeta, { color: colors.mutedForeground }]}>
                  {stream.durationSeconds ? `${Math.floor(stream.durationSeconds / 60)}m` : "—"}
                  {" · "}
                  {stream.totalViews ?? 0} views
                  {" · "}
                  {stream.clipsCount ?? 0} clips
                </Text>
              </View>
              {stream.status === "live" && <LiveBadge size="sm" />}
              <TouchableOpacity
                onPress={() => handleShareStream(stream)}
                style={[styles.shareStreamBtn, { borderColor: colors.border }]}
                hitSlop={6}
              >
                <Feather name="share-2" size={15} color={colors.foreground} />
              </TouchableOpacity>
            </TouchableOpacity>
          ))
        )}
      </View>

      <StreamActionSheet stream={actionStream} onClose={() => setActionStream(null)} />
    </ScrollView>
  );
}

function getPlatformStyle(type: string): { backgroundColor: string } {
  const COLORS: Record<string, string> = {
    youtube: "#FF0000",
    twitch: "#9146FF",
    kick: "#53FC18",
    facebook: "#1877F2",
    instagram: "#E1306C",
    tiktok: "#00F2EA",
    custom_rtmp: "#FFFFFF",
  };
  return { backgroundColor: COLORS[type] ?? "#888" };
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 24 },
  screenTitle: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  screenSubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: -14 },
  section: { gap: 12 },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  manageText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  deviceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  deviceCard: {
    width: "47%",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    gap: 8,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 3,
  },
  deviceIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  deviceLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  deviceDesc: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
  activeDot: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  addPlatformCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  addPlatformText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  platformsList: { gap: 8 },
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
  },
  platformName: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium", textTransform: "capitalize" },
  connectedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  connectedText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  emptyState: {
    borderRadius: 16,
    padding: 28,
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
  },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  historyCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    gap: 12,
  },
  historyInfo: { flex: 1, gap: 4 },
  shareStreamBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  historyTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  historyMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
