import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";

import { LiveBadge } from "@/components/ui/LiveBadge";
import { useColors } from "@/hooks/useColors";
import { useStream, type DeviceType } from "@/contexts/StreamContext";
import {
  useGetActiveStream,
  useGetAgoraToken,
  useEndStream,
  useStopStreamPush,
  getListStreamsQueryKey,
  getGetActiveStreamQueryKey,
  getListStreamRecordingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

function formatElapsed(startedAt: string | null | undefined): string {
  if (!startedAt) return "—";
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(start)) return "—";
  const secs = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export default function RecoverScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const stream = useStream();

  const { data: activeStream, isLoading, isError } = useGetActiveStream();
  const getAgoraToken = useGetAgoraToken();
  const endStream = useEndStream();
  const stopPush = useStopStreamPush();
  const qc = useQueryClient();

  const [action, setAction] = useState<"none" | "rejoin" | "end">("none");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // No active stream (e.g. 404) — nothing to recover. Return to the app.
  useEffect(() => {
    if (!isLoading && (isError || !activeStream)) {
      router.replace("/(tabs)");
    }
  }, [isLoading, isError, activeStream]);

  const handleRejoin = async () => {
    if (!activeStream || action !== "none") return;
    setAction("rejoin");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    // Fetch a fresh Agora token for the existing channel. Failure is non-fatal:
    // the POV screen falls back to simulation mode when Agora is unavailable.
    let agoraToken = null;
    try {
      agoraToken = await getAgoraToken.mutateAsync({ streamId: activeStream.id });
    } catch {
      // Agora not configured / token unavailable — continue without it.
    }

    // Rehydrate the in-memory session from the persisted backend record. The
    // existing stream id and startedAt are reused so the timer and analytics
    // continue uninterrupted; publishing only begins once the POV screen joins.
    stream.setDeviceType((activeStream.deviceType as DeviceType) ?? "phone");
    stream.setActiveStream(activeStream);
    stream.setAgoraCredentials(agoraToken);
    stream.setStreamTitle(activeStream.title ?? "");
    const platforms = activeStream.platforms ?? [];
    stream.setSelectedPlatforms(platforms);

    // Seed each destination as "reconnecting" (checking) rather than a false
    // "live"; the first push/status poll replaces these with the real state.
    const ph: Record<string, "live" | "reconnecting" | "failed"> = {};
    platforms.forEach((p) => { ph[p] = "reconnecting"; });
    stream.setPlatformHealth(ph);

    stream.setIsLive(true);
    router.replace("/stream/pov");
  };

  const handleEnd = async () => {
    if (!activeStream || action !== "none") return;
    setAction("end");
    setErrorMsg(null);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

    // Stop every multistream destination first. Best-effort: a failure here
    // (e.g. an already-dead Agora task) must not block ending the stream, but
    // ending the backend session is the gating step below.
    try {
      await stopPush.mutateAsync({ streamId: activeStream.id });
    } catch {
      // Destinations drop once the channel empties; proceed to end the session.
    }

    // Ending the backend session is the contract for "End Live Stream". If this
    // fails we must NOT clear local state or navigate away — otherwise the user
    // sees a successful end while the stream stays live on the backend. Keep
    // them on this screen with a retryable error instead.
    try {
      await endStream.mutateAsync({ streamId: activeStream.id });
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErrorMsg("Couldn't end the stream. Check your connection and try again.");
      setAction("none");
      return;
    }

    // Refresh caches so home/live lists, active-stream recovery, and the
    // recordings archive no longer show this stream as live.
    void qc.invalidateQueries({ queryKey: getListStreamsQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetActiveStreamQueryKey() });
    void qc.invalidateQueries({ queryKey: getListStreamRecordingsQueryKey() });
    stream.clearStream();
    router.replace("/(tabs)");
  };

  if (isLoading || !activeStream) {
    return (
      <View style={[styles.loadingWrap, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const busy = action !== "none";
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const platforms = activeStream.platforms ?? [];

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: colors.background, paddingTop: topPad + 24, paddingBottom: bottomPad + 24 },
      ]}
    >
      <View style={styles.body}>
        <View style={[styles.iconRing, { backgroundColor: colors.live + "1A", borderColor: colors.live + "55" }]}>
          <Feather name="radio" size={34} color={colors.live} />
        </View>

        <View style={styles.headerRow}>
          <LiveBadge size="sm" pulse />
          <Text style={[styles.kicker, { color: colors.live }]}>STREAM STILL LIVE</Text>
        </View>

        <Text style={[styles.title, { color: colors.foreground }]}>
          You have a stream in progress
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Your app closed while you were broadcasting. The stream is still live on
          the backend. Rejoin to continue, or end it on all platforms.
        </Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.streamTitle, { color: colors.foreground }]} numberOfLines={2}>
            {activeStream.title || "Untitled stream"}
          </Text>
          <View style={styles.metaRow}>
            <Feather name="clock" size={14} color={colors.mutedForeground} />
            <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
              Live for {formatElapsed(activeStream.startedAt)}
            </Text>
          </View>
          {platforms.length > 0 && (
            <View style={styles.metaRow}>
              <Feather name="share-2" size={14} color={colors.mutedForeground} />
              <Text style={[styles.metaText, { color: colors.mutedForeground }]} numberOfLines={1}>
                {platforms.join(" • ")}
              </Text>
            </View>
          )}
        </View>
      </View>

      <View style={styles.actions}>
        {errorMsg && (
          <View style={[styles.errorBanner, { backgroundColor: colors.live + "1A", borderColor: colors.live + "55" }]}>
            <Feather name="alert-triangle" size={15} color={colors.live} />
            <Text style={[styles.errorText, { color: colors.foreground }]}>{errorMsg}</Text>
          </View>
        )}
        <TouchableOpacity
          onPress={handleRejoin}
          disabled={busy}
          activeOpacity={0.85}
          style={[styles.primaryBtn, { backgroundColor: colors.live, opacity: busy && action !== "rejoin" ? 0.5 : 1 }]}
        >
          {action === "rejoin" ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <>
              <Feather name="play" size={18} color="#FFF" />
              <Text style={styles.primaryBtnText}>Rejoin Live Stream</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleEnd}
          disabled={busy}
          activeOpacity={0.85}
          style={[styles.secondaryBtn, { borderColor: colors.border, opacity: busy && action !== "end" ? 0.5 : 1 }]}
        >
          {action === "end" ? (
            <ActivityIndicator color={colors.foreground} />
          ) : (
            <>
              <Feather name="square" size={16} color={colors.mutedForeground} />
              <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>End Live Stream</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 24, justifyContent: "space-between" },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, justifyContent: "center", gap: 14 },
  iconRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    marginBottom: 6,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  kicker: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", letterSpacing: -0.4, lineHeight: 32 },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  card: {
    marginTop: 8,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  streamTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  metaText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  actions: { gap: 12 },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  errorText: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1, lineHeight: 18 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 54,
    borderRadius: 16,
  },
  primaryBtnText: { color: "#FFF", fontSize: 16, fontFamily: "Inter_700Bold" },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 54,
    borderRadius: 16,
    borderWidth: 1,
  },
  secondaryBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
