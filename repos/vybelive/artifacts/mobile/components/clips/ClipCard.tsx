import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { Image } from "expo-image";

import { useColors } from "@/hooks/useColors";
import type { Clip } from "@workspace/api-client-react";

interface ClipCardProps {
  clip: Clip;
  onPress: () => void;
  variant?: "grid" | "list";
}

function formatDuration(seconds: number): string {
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatViews(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

function getStatusColor(status: Clip["status"], colors: ReturnType<typeof useColors>): string {
  switch (status) {
    case "ready": return colors.neonGreen;
    case "published": return colors.cyan;
    case "processing": return colors.gold;
    case "failed": return colors.destructive;
    default: return colors.mutedForeground;
  }
}

export function ClipCard({ clip, onPress, variant = "grid" }: ClipCardProps) {
  const colors = useColors();
  const { width: screenW } = useWindowDimensions();
  const cardW = (screenW - 48) / 2;

  if (variant === "list") {
    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.85}
        style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <View style={[styles.listThumb, { backgroundColor: colors.muted }]}>
          {clip.thumbnailUrl ? (
            <Image source={{ uri: clip.thumbnailUrl }} style={styles.listThumbImg} contentFit="cover" />
          ) : (
            <Feather name="video" size={22} color={colors.mutedForeground} />
          )}
          {(clip.durationSeconds ?? 0) > 0 && (
            <View style={[styles.durationBadge, { backgroundColor: colors.overlay }]}>
              <Text style={styles.durationText}>{formatDuration(clip.durationSeconds ?? 0)}</Text>
            </View>
          )}
        </View>
        <View style={styles.listInfo}>
          <Text style={[styles.listTitle, { color: colors.foreground }]} numberOfLines={2}>
            {clip.title}
          </Text>
          <View style={styles.listMeta}>
            {clip.aiGenerated && (
              <View style={[styles.aiBadge, { backgroundColor: colors.purpleGlow }]}>
                <Feather name="zap" size={9} color={colors.primary} />
                <Text style={[styles.aiText, { color: colors.primary }]}>AI</Text>
              </View>
            )}
            <View style={[styles.statusDot, { backgroundColor: getStatusColor(clip.status, colors) }]} />
            <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
              {clip.status}
            </Text>
          </View>
          <Text style={[styles.listViews, { color: colors.mutedForeground }]}>
            {formatViews(clip.views ?? 0)} views
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.gridCard, { width: cardW, backgroundColor: colors.card }]}
    >
      <View style={[styles.thumb, { backgroundColor: colors.muted }]}>
        {clip.thumbnailUrl ? (
          <Image source={{ uri: clip.thumbnailUrl }} style={styles.thumbImg} contentFit="cover" />
        ) : (
          <View style={styles.thumbPlaceholder}>
            <Feather name="video" size={26} color={colors.mutedForeground} />
          </View>
        )}
        <LinearGradient
          colors={["transparent", "rgba(9,9,15,0.9)"]}
          style={StyleSheet.absoluteFill}
        />
        {(clip.durationSeconds ?? 0) > 0 && (
          <View style={[styles.durationBadge, { backgroundColor: colors.overlay }]}>
            <Text style={styles.durationText}>{formatDuration(clip.durationSeconds ?? 0)}</Text>
          </View>
        )}
        {clip.aiGenerated && (
          <View style={[styles.aiBadgeGrid, { backgroundColor: colors.purpleGlow, borderColor: colors.primary }]}>
            <Feather name="zap" size={9} color={colors.primary} />
          </View>
        )}
        <View style={styles.playOverlay}>
          <View style={[styles.playCircle, { backgroundColor: colors.overlayLight }]}>
            <Feather name="play" size={14} color="#FFF" />
          </View>
        </View>
      </View>
      <View style={styles.cardInfo}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={2}>
          {clip.title}
        </Text>
        <View style={styles.cardMeta}>
          <View style={[styles.statusDot, { backgroundColor: getStatusColor(clip.status, colors) }]} />
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
            {formatViews(clip.views ?? 0)} views
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  gridCard: {
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 12,
  },
  thumb: {
    width: "100%",
    aspectRatio: 9 / 16,
    borderRadius: 12,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbImg: {
    ...StyleSheet.absoluteFillObject,
  },
  thumbPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  durationBadge: {
    position: "absolute",
    bottom: 6,
    left: 6,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  durationText: {
    color: "#FFF",
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
  aiBadgeGrid: {
    position: "absolute",
    top: 6,
    right: 6,
    borderRadius: 6,
    padding: 4,
    borderWidth: 1,
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  playCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  cardInfo: {
    padding: 8,
    gap: 4,
  },
  cardTitle: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    lineHeight: 17,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  metaText: {
    fontSize: 10,
    fontFamily: "Inter_400Regular",
  },
  aiBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  aiText: {
    fontSize: 9,
    fontFamily: "Inter_700Bold",
  },
  // List variant
  listCard: {
    flexDirection: "row",
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 10,
    borderWidth: 1,
  },
  listThumb: {
    width: 90,
    aspectRatio: 9 / 16,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  listThumbImg: {
    ...StyleSheet.absoluteFillObject,
  },
  listInfo: {
    flex: 1,
    padding: 12,
    gap: 6,
    justifyContent: "center",
  },
  listTitle: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    lineHeight: 20,
  },
  listMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusText: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textTransform: "capitalize",
  },
  listViews: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
});
