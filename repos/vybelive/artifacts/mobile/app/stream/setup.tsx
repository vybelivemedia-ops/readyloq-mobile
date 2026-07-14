import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/contexts/AuthContext";
import { useStream } from "@/contexts/StreamContext";
import type { DeviceType } from "@/contexts/StreamContext";
import { useColors } from "@/hooks/useColors";
import {
  useCreateStream,
  useGetAgoraToken,
  useListPlatforms,
  useListOauthConnections,
  useStartStream,
} from "@workspace/api-client-react";

const API_BASE = process.env["EXPO_PUBLIC_DOMAIN"]
  ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`
  : "https://getvybe.live/api";

const PLATFORM_META: Record<string, { label: string; color: string; shortLabel: string }> = {
  youtube:     { label: "YouTube",   color: "#FF0000", shortLabel: "YT"  },
  twitch:      { label: "Twitch",    color: "#9146FF", shortLabel: "TW"  },
  kick:        { label: "Kick",      color: "#53FC18", shortLabel: "K"   },
  facebook:    { label: "Facebook",  color: "#1877F2", shortLabel: "FB"  },
  instagram:   { label: "Instagram", color: "#E1306C", shortLabel: "IG"  },
  tiktok:      { label: "TikTok",    color: "#00F2EA", shortLabel: "TK"  },
  custom_rtmp: { label: "Custom RTMP", color: "#888",  shortLabel: "RTMP"},
};

interface POVSource {
  type: DeviceType;
  label: string;
  sublabel: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  status: "available" | "searching" | "not_found" | "connected";
  battery?: number;
  requiresInput?: boolean;
}

const POV_SOURCES: POVSource[] = [
  {
    type: "phone",
    label: "Phone Camera",
    sublabel: "Front or rear · HD 1080p",
    icon: "smartphone",
    status: "available",
    battery: 85,
  },
  {
    type: "meta_glasses",
    label: "Meta Glasses",
    sublabel: "Device Access Toolkit · 720p/30fps",
    icon: "eye",
    status: "available",
    battery: undefined,
  },
  {
    type: "gopro",
    label: "GoPro Hero 8+",
    sublabel: "WiFi Open API · 4K POV",
    icon: "camera",
    status: "available",
    battery: undefined,
  },
  {
    type: "external_rtmp",
    label: "RTMP Source",
    sublabel: "Custom encoder / OBS",
    icon: "wifi",
    status: "available",
    requiresInput: true,
  },
  {
    type: "usb_camera",
    label: "USB Camera",
    sublabel: "Plug-in camera · up to 4K",
    icon: "video",
    status: "not_found",
  },
  {
    type: "webrtc",
    label: "WebRTC",
    sublabel: "Browser-based capture",
    icon: "globe",
    status: "available",
  },
];

const STATUS_CONFIG = {
  available: { label: "Available", color: "#39FF14", icon: "check-circle" as const },
  searching: { label: "Searching…", color: "#FFD700", icon: "loader" as const },
  not_found: { label: "Not found", color: "#5C5C7A", icon: "x-circle" as const },
  connected: { label: "Connected", color: "#39FF14", icon: "wifi" as const },
};

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

const STEP_LABELS = ["Source", "Platforms", "Details", "Launch"];

export default function StreamSetupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, accessToken } = useAuth();
  const stream = useStream();

  const [step, setStep] = useState(1);
  const [selectedSource, setSelectedSource] = useState<DeviceType>("phone");
  const [selectedPlatformIds, setSelectedPlatformIds] = useState<string[]>([]);
  const [title, setTitle] = useState(`${user?.displayName ?? "POV"} Stream`);
  const [tags, setTags] = useState<string[]>(["pov", "live"]);
  const [tagInput, setTagInput] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchProgress, setLaunchProgress] = useState<string[]>([]);
  const [countdownSec, setCountdownSec] = useState(3);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: platforms } = useListPlatforms();
  const { data: oauthConnections } = useListOauthConnections();
  const createStream = useCreateStream();
  const startStream = useStartStream();
  const getAgoraToken = useGetAgoraToken();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;
  const connectedPlatforms = platforms?.filter((p) => p.isConnected) ?? [];

  const oauthDestinations = (oauthConnections ?? [])
    .filter((c) => c.status === "connected")
    .map((c) => ({
      id: c.platform as string,
      type: c.platform as string,
      label: PLATFORM_META[c.platform]?.label ?? c.platform,
      accountName: (c as { accountName?: string | null }).accountName ?? null,
      source: "oauth" as const,
    }));
  const oauthTypes = new Set(oauthDestinations.map((d) => d.type));
  const manualDestinations = connectedPlatforms
    .filter((p) => !oauthTypes.has(p.type))
    .map((p) => ({
      id: p.id,
      type: p.type,
      label: PLATFORM_META[p.type]?.label ?? p.type,
      accountName: (p as { channelName?: string | null }).channelName ?? p.name ?? null,
      source: "manual" as const,
    }));
  const allDestinations = [...oauthDestinations, ...manualDestinations];

  const slideTo = (nextStep: number) => {
    const direction = nextStep > step ? 1 : -1;
    slideAnim.setValue(direction * 30);
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 120,
      friction: 14,
    }).start();
    setStep(nextStep);
  };

  const goNext = () => {
    Haptics.selectionAsync();
    if (step < 4) slideTo(step + 1);
  };

  const goBack = () => {
    Haptics.selectionAsync();
    if (step > 1) slideTo(step - 1);
    else router.back();
  };

  const togglePlatform = (id: string) => {
    Haptics.selectionAsync();
    setSelectedPlatformIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const addTag = () => {
    const t = tagInput.replace(/^#/, "").trim().toLowerCase();
    if (t && !tags.includes(t) && tags.length < 8) {
      setTags((prev) => [...prev, t]);
    }
    setTagInput("");
  };

  const removeTag = (t: string) => setTags((prev) => prev.filter((x) => x !== t));

  const handleLaunch = async () => {
    if (!title.trim()) {
      Alert.alert("Stream title required", "Give your stream a name to continue.");
      return;
    }

    // Quick preflight: warn if no OAuth platforms are connected
    const connectedOAuth = (oauthConnections ?? []).filter(
      (c) => c.status === "connected" && ["youtube", "facebook", "twitch"].includes(c.platform)
    );
    if (connectedOAuth.length === 0 && selectedPlatformIds.length > 0) {
      await new Promise<void>((resolve) => {
        Alert.alert(
          "No platforms connected",
          "Connect at least one platform in Settings → Connected Accounts to multistream. Your stream will still be created on VYBE LIVE.",
          [
            { text: "Go to Settings", onPress: () => { router.push("/settings/connected-accounts" as never); resolve(); return; } },
            { text: "Continue anyway", style: "default", onPress: () => resolve() },
          ]
        );
      });
    }

    setIsLaunching(true);

    const selectedTypes = selectedPlatformIds
      .map((id) => allDestinations.find((d) => d.id === id)?.type)
      .filter(Boolean) as string[];

    const launchSteps = selectedTypes.length > 0
      ? selectedTypes.map((t) => PLATFORM_META[t]?.label ?? t)
      : ["VYBE LIVE"];

    for (let i = 0; i < launchSteps.length; i++) {
      await new Promise((r) => setTimeout(r, 600));
      setLaunchProgress((prev) => [...prev, launchSteps[i]]);
    }

    try {
      const streamData = await createStream.mutateAsync({
        data: {
          title: title.trim(),
          deviceType: selectedSource,
          platforms: selectedTypes,
        },
      });

      // Server-side preflight gate
      try {
        const preflightRes = await fetch(`${API_BASE}/streams/${streamData.id}/preflight`, {
          headers: { Authorization: `Bearer ${accessToken ?? ""}` },
        });
        if (preflightRes.ok) {
          const preflight = await preflightRes.json() as {
            canGoLive: boolean;
            checks: Array<{ id: string; status: string; label: string; detail: string }>;
          };
          if (!preflight.canGoLive) {
            const issues = preflight.checks
              .filter((c) => c.status === "fail")
              .map((c) => `• ${c.label}: ${c.detail}`)
              .join("\n");
            Alert.alert(
              "Cannot go live",
              `${issues}\n\nFix these issues in Settings → Connected Accounts.`,
              [{ text: "OK", onPress: () => { setIsLaunching(false); setLaunchProgress([]); } }]
            );
            return;
          }

          // Non-blocking warning: the selected Facebook Page destination is no
          // longer available (admin access lost / page token revoked). Surface it
          // before going live so the creator can re-select instead of silently
          // failing at push time.
          const fbDestWarn = preflight.checks.find(
            (c) => c.id === "facebook_destination" && c.status === "warn",
          );
          if (fbDestWarn) {
            const proceed = await new Promise<boolean>((resolve) => {
              Alert.alert(
                "Facebook destination unavailable",
                `${fbDestWarn.detail}\n\nRe-select a destination now, or go live without Facebook.`,
                [
                  { text: "Re-select", onPress: () => { router.push("/settings/platforms" as never); resolve(false); } },
                  { text: "Go live anyway", style: "default", onPress: () => resolve(true) },
                ],
                { cancelable: false }
              );
            });
            if (!proceed) {
              setIsLaunching(false);
              setLaunchProgress([]);
              return;
            }
          }
        }
      } catch { /* preflight check optional — proceed if API unreachable */ }

      const liveStream = await startStream.mutateAsync({ streamId: streamData.id });

      let agoraToken = null;
      try {
        agoraToken = await getAgoraToken.mutateAsync({ streamId: streamData.id });
      } catch {
        // Agora not configured — streaming continues in simulation mode
      }

      // Fire-and-forget: start Agora Cloud Push to all connected OAuth platforms.
      // Don't await — push start should never block entering the live screen.
      if (accessToken) {
        fetch(`${API_BASE}/streams/${streamData.id}/push/start`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        }).catch(() => undefined);
      }

      stream.setDeviceType(selectedSource);
      stream.setActiveStream(liveStream);
      stream.setAgoraCredentials(agoraToken);
      stream.setStreamTitle(title.trim());
      stream.setStreamTags(tags);
      stream.setSelectedPlatforms(selectedTypes);

      // Seed platform health as "reconnecting" (visually: connecting/checking) rather
      // than a false "live".  The first real push/status poll (5 s after going live)
      // will replace these with the actual Agora task state from the server.
      const ph: Record<string, "live" | "reconnecting" | "failed"> = {};
      selectedTypes.forEach((t) => { ph[t] = "reconnecting"; });
      stream.setPlatformHealth(ph);
      stream.setIsLive(true);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/stream/pov");
    } catch {
      Alert.alert("Failed to start stream", "Check your connection and try again.");
      setIsLaunching(false);
      setLaunchProgress([]);
    }
  };

  const canGoNext =
    step === 1 ? true :
    step === 2 ? true :
    step === 3 ? title.trim().length > 0 : false;

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <TouchableOpacity onPress={goBack} style={styles.backBtn} hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Feather name="x" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Go Live</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Step progress */}
      <View style={styles.stepRow}>
        {STEP_LABELS.map((label, i) => {
          const idx = i + 1;
          const active = idx === step;
          const done = idx < step;
          return (
            <React.Fragment key={label}>
              <View style={styles.stepItem}>
                <View
                  style={[
                    styles.stepDot,
                    {
                      backgroundColor: done
                        ? colors.primary
                        : active
                        ? colors.primary
                        : colors.border,
                      borderColor: active ? colors.primary : "transparent",
                      borderWidth: active ? 2 : 0,
                      width: active ? 28 : 22,
                      height: active ? 28 : 22,
                      borderRadius: active ? 14 : 11,
                    },
                  ]}
                >
                  {done ? (
                    <Feather name="check" size={11} color="#FFF" />
                  ) : (
                    <Text style={[styles.stepNum, { color: active ? "#FFF" : colors.mutedForeground }]}>
                      {idx}
                    </Text>
                  )}
                </View>
                <Text style={[styles.stepLabel, { color: active ? colors.primary : colors.mutedForeground }]}>
                  {label}
                </Text>
              </View>
              {i < STEP_LABELS.length - 1 && (
                <View style={[styles.stepLine, { backgroundColor: idx < step ? colors.primary : colors.border }]} />
              )}
            </React.Fragment>
          );
        })}
      </View>

      <Animated.ScrollView
        style={{ transform: [{ translateX: slideAnim }] }}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: bottomPad + 100 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ─── STEP 1: POV SOURCE ─────────────────────── */}
        {step === 1 && (
          <View style={styles.stepContent}>
            <Text style={[styles.stepTitle, { color: colors.foreground }]}>
              Select POV Source
            </Text>
            <Text style={[styles.stepSub, { color: colors.mutedForeground }]}>
              Choose the device capturing your point of view
            </Text>

            <View style={styles.sourceList}>
              {POV_SOURCES.map((src) => {
                const active = selectedSource === src.type;
                const status = STATUS_CONFIG[src.status];
                const canSelect = src.status === "available" || src.status === "connected";

                return (
                  <TouchableOpacity
                    key={src.type}
                    onPress={() => {
                      if (!canSelect) return;
                      Haptics.selectionAsync();
                      setSelectedSource(src.type);
                    }}
                    activeOpacity={canSelect ? 0.8 : 1}
                    style={[
                      styles.sourceCard,
                      {
                        backgroundColor: active ? colors.primary + "18" : colors.card,
                        borderColor: active ? colors.primary : colors.border,
                        opacity: canSelect ? 1 : 0.55,
                      },
                    ]}
                  >
                    <View style={[styles.sourceIcon, { backgroundColor: active ? colors.primary + "25" : colors.muted }]}>
                      <Feather name={src.icon} size={22} color={active ? colors.primary : colors.mutedForeground} />
                    </View>

                    <View style={styles.sourceInfo}>
                      <Text style={[styles.sourceLabel, { color: colors.foreground }]}>{src.label}</Text>
                      <Text style={[styles.sourceSub, { color: colors.mutedForeground }]}>{src.sublabel}</Text>
                    </View>

                    <View style={styles.sourceRight}>
                      {src.battery !== undefined && (
                        <View style={styles.batteryRow}>
                          <Feather name="battery" size={11} color={src.battery > 20 ? "#39FF14" : "#FF3B6C"} />
                          <Text style={[styles.batteryText, { color: colors.mutedForeground }]}>{src.battery}%</Text>
                        </View>
                      )}
                      <View style={styles.statusChip}>
                        <View style={[styles.statusDot, { backgroundColor: status.color }]} />
                        <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
                      </View>
                    </View>

                    {active && (
                      <View style={[styles.checkMark, { backgroundColor: colors.primary }]}>
                        <Feather name="check" size={10} color="#FFF" />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {selectedSource === "external_rtmp" && (
              <View style={[styles.rtmpBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.rtmpLabel, { color: colors.mutedForeground }]}>RTMP INGEST URL</Text>
                <Text style={[styles.rtmpValue, { color: colors.cyan }]}>
                  rtmp://ingest.vybe.live/live
                </Text>
                <Text style={[styles.rtmpHint, { color: colors.mutedForeground }]}>
                  Your stream key is generated after going live
                </Text>
              </View>
            )}

            {selectedSource === "gopro" && (
              <View style={[styles.deviceInfoBox, { backgroundColor: colors.card, borderColor: "#FFD700" + "55" }]}>
                <View style={styles.deviceInfoRow}>
                  <Feather name="wifi" size={16} color="#FFD700" />
                  <Text style={[styles.deviceInfoTitle, { color: colors.foreground }]}>
                    GoPro WiFi Setup
                  </Text>
                </View>
                <Text style={[styles.deviceInfoStep, { color: colors.mutedForeground }]}>
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>1. </Text>
                  On your GoPro: <Text style={{ color: colors.foreground }}>Connections → Connect Device → GoPro App</Text>
                </Text>
                <Text style={[styles.deviceInfoStep, { color: colors.mutedForeground }]}>
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>2. </Text>
                  On your phone: <Text style={{ color: colors.foreground }}>Settings → WiFi → select the "GP…" network</Text>
                </Text>
                <Text style={[styles.deviceInfoStep, { color: colors.mutedForeground }]}>
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>3. </Text>
                  Return here and tap <Text style={{ color: colors.foreground }}>Go Live</Text> — VYBE will auto-detect your GoPro and start the stream.
                </Text>
                <View style={[styles.deviceInfoBadge, { backgroundColor: "#FFD700" + "18" }]}>
                  <Feather name="info" size={12} color="#FFD700" />
                  <Text style={[styles.deviceInfoBadgeText, { color: "#FFD700" }]}>
                    Requires GoPro Hero 8 or newer
                  </Text>
                </View>
              </View>
            )}

            {selectedSource === "meta_glasses" && (
              <View style={[styles.deviceInfoBox, { backgroundColor: colors.card, borderColor: colors.primary + "55" }]}>
                <View style={styles.deviceInfoRow}>
                  <Feather name="eye" size={16} color={colors.primary} />
                  <Text style={[styles.deviceInfoTitle, { color: colors.foreground }]}>
                    Device Access Toolkit
                  </Text>
                  <View style={[styles.betaBadge, { backgroundColor: colors.primary + "25" }]}>
                    <Text style={[styles.betaBadgeText, { color: colors.primary }]}>PREVIEW</Text>
                  </View>
                </View>
                <Text style={[styles.deviceInfoStep, { color: colors.mutedForeground }]}>
                  Stream live from your{" "}
                  <Text style={{ color: colors.foreground }}>Ray-Ban Meta glasses camera</Text>{" "}
                  via Meta's Wearables Device Access Toolkit SDK. The glasses camera provides your
                  true hands-free POV at up to{" "}
                  <Text style={{ color: colors.foreground }}>720p / 30fps</Text>.
                </Text>
                <View style={styles.companionFeatures}>
                  {[
                    { icon: "video" as const, label: "Glasses camera → 720p/30fps via Bluetooth" },
                    { icon: "camera" as const, label: "Photo capture during stream" },
                    { icon: "bluetooth" as const, label: "Requires Meta AI app + paired glasses" },
                    { icon: "smartphone" as const, label: "No glasses? Use Mock Device Kit in Settings" },
                  ].map((f) => (
                    <View key={f.label} style={styles.companionFeatureRow}>
                      <Feather name={f.icon} size={13} color={colors.primary} />
                      <Text style={[styles.deviceInfoStep, { color: colors.mutedForeground, marginLeft: 6 }]}>
                        {f.label}
                      </Text>
                    </View>
                  ))}
                </View>
                <View style={[styles.deviceInfoBadge, { backgroundColor: colors.primary + "12" }]}>
                  <Feather name="settings" size={12} color={colors.mutedForeground} />
                  <Text style={[styles.deviceInfoBadgeText, { color: colors.mutedForeground }]}>
                    Register once in Settings → Meta Glasses before streaming
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* ─── STEP 2: PLATFORMS ──────────────────────── */}
        {step === 2 && (
          <View style={styles.stepContent}>
            <Text style={[styles.stepTitle, { color: colors.foreground }]}>
              Choose Platforms
            </Text>
            <Text style={[styles.stepSub, { color: colors.mutedForeground }]}>
              Stream to multiple platforms simultaneously
            </Text>

            {allDestinations.length === 0 ? (
              <View style={styles.noPlatformWrap}>
                <View style={[styles.noPlatformCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="link" size={28} color={colors.mutedForeground} />
                  <Text style={[styles.noPlatformTitle, { color: colors.foreground }]}>No platforms connected</Text>
                  <Text style={[styles.noPlatformSub, { color: colors.mutedForeground }]}>
                    Connect your streaming accounts to multistream
                  </Text>
                  <TouchableOpacity
                    onPress={() => router.push("/settings/platforms")}
                    style={[styles.connectBtn, { backgroundColor: colors.primary }]}
                  >
                    <Text style={styles.connectBtnText}>Connect Platforms</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity onPress={goNext} style={styles.skipBtn}>
                  <Text style={[styles.skipText, { color: colors.mutedForeground }]}>
                    Skip — stream to VYBE only
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.platformGrid}>
                {allDestinations.map((d) => {
                  const meta = PLATFORM_META[d.type] ?? { label: d.type, color: "#888", shortLabel: d.type.slice(0, 2).toUpperCase() };
                  const selected = selectedPlatformIds.includes(d.id);
                  return (
                    <TouchableOpacity
                      key={d.id}
                      onPress={() => togglePlatform(d.id)}
                      activeOpacity={0.8}
                      style={[
                        styles.platformCard,
                        {
                          backgroundColor: selected ? meta.color + "18" : colors.card,
                          borderColor: selected ? meta.color : colors.border,
                        },
                      ]}
                    >
                      <View style={[styles.platformIconBox, { backgroundColor: meta.color + "25" }]}>
                        <Text style={[styles.platformShortLabel, { color: meta.color }]}>
                          {meta.shortLabel}
                        </Text>
                      </View>
                      <View style={styles.platformInfo}>
                        <Text style={[styles.platformName, { color: colors.foreground }]}>
                          {meta.label}
                        </Text>
                        <Text style={[styles.platformChannel, { color: colors.mutedForeground }]} numberOfLines={1}>
                          {d.accountName ?? meta.label}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.platformCheck,
                          {
                            backgroundColor: selected ? meta.color : colors.border,
                            borderColor: selected ? meta.color : colors.border,
                          },
                        ]}
                      >
                        {selected && <Feather name="check" size={12} color="#FFF" />}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {selectedPlatformIds.length > 0 && (
              <View style={[styles.selectionSummary, { backgroundColor: colors.live + "12", borderColor: colors.live + "40" }]}>
                <Feather name="zap" size={13} color={colors.live} />
                <Text style={[styles.summaryText, { color: colors.foreground }]}>
                  Streaming live on{" "}
                  <Text style={{ color: colors.live, fontFamily: "Inter_700Bold" }}>
                    {selectedPlatformIds.length} platform{selectedPlatformIds.length > 1 ? "s" : ""}
                  </Text>
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ─── STEP 3: STREAM DETAILS ─────────────────── */}
        {step === 3 && (
          <View style={styles.stepContent}>
            <Text style={[styles.stepTitle, { color: colors.foreground }]}>
              Stream Details
            </Text>
            <Text style={[styles.stepSub, { color: colors.mutedForeground }]}>
              Give your stream a name viewers will see
            </Text>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>TITLE</Text>
              <View style={[styles.inputBox, { backgroundColor: colors.input, borderColor: colors.border }]}>
                <TextInput
                  style={[styles.input, { color: colors.foreground }]}
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Name your stream…"
                  placeholderTextColor={colors.mutedForeground}
                  maxLength={120}
                  returnKeyType="done"
                  autoFocus
                />
              </View>
              <Text style={[styles.charCount, { color: colors.mutedForeground }]}>
                {title.length}/120
              </Text>
            </View>

            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>TAGS</Text>
              <View style={styles.tagsRow}>
                {tags.map((t) => (
                  <TouchableOpacity
                    key={t}
                    onPress={() => removeTag(t)}
                    style={[styles.tag, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "40" }]}
                  >
                    <Text style={[styles.tagText, { color: colors.primary }]}>#{t}</Text>
                    <Feather name="x" size={11} color={colors.primary} />
                  </TouchableOpacity>
                ))}
              </View>
              <View style={[styles.tagInputRow, { backgroundColor: colors.input, borderColor: colors.border }]}>
                <Text style={[styles.tagPrefix, { color: colors.mutedForeground }]}>#</Text>
                <TextInput
                  style={[styles.tagInput, { color: colors.foreground }]}
                  value={tagInput}
                  onChangeText={setTagInput}
                  placeholder="add tag…"
                  placeholderTextColor={colors.mutedForeground}
                  onSubmitEditing={addTag}
                  returnKeyType="done"
                  maxLength={24}
                />
                <TouchableOpacity onPress={addTag} style={[styles.tagAddBtn, { backgroundColor: colors.primary + "30" }]}>
                  <Feather name="plus" size={14} color={colors.primary} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Advanced settings */}
            <TouchableOpacity
              onPress={() => setShowAdvanced((v) => !v)}
              style={[styles.advancedToggle, { borderColor: colors.border }]}
            >
              <Feather name="sliders" size={14} color={colors.mutedForeground} />
              <Text style={[styles.advancedToggleText, { color: colors.mutedForeground }]}>
                Advanced settings
              </Text>
              <Feather name={showAdvanced ? "chevron-up" : "chevron-down"} size={14} color={colors.mutedForeground} />
            </TouchableOpacity>

            {showAdvanced && (
              <View style={[styles.advancedBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {[
                  { label: "Resolution", value: "1080p 60fps" },
                  { label: "Max Bitrate", value: "6,000 kbps" },
                  { label: "Audio", value: "AAC 160 kbps" },
                  { label: "Reconnect", value: "Auto (3 attempts)" },
                  { label: "Latency", value: "Low (2-4s)" },
                ].map((item) => (
                  <View key={item.label} style={[styles.advancedRow, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.advancedLabel, { color: colors.mutedForeground }]}>{item.label}</Text>
                    <Text style={[styles.advancedValue, { color: colors.foreground }]}>{item.value}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* ─── STEP 4: LAUNCH ────────────────────────── */}
        {step === 4 && (
          <View style={[styles.stepContent, { alignItems: "center" }]}>
            {!isLaunching ? (
              <>
                <View style={[styles.launchSummaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.launchSummaryRow}>
                    <Text style={[styles.launchSummaryLabel, { color: colors.mutedForeground }]}>Title</Text>
                    <Text style={[styles.launchSummaryValue, { color: colors.foreground }]} numberOfLines={1}>{title}</Text>
                  </View>
                  <View style={[styles.launchDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.launchSummaryRow}>
                    <Text style={[styles.launchSummaryLabel, { color: colors.mutedForeground }]}>Source</Text>
                    <Text style={[styles.launchSummaryValue, { color: colors.foreground }]}>
                      {POV_SOURCES.find((s) => s.type === selectedSource)?.label ?? selectedSource}
                    </Text>
                  </View>
                  <View style={[styles.launchDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.launchSummaryRow}>
                    <Text style={[styles.launchSummaryLabel, { color: colors.mutedForeground }]}>Platforms</Text>
                    <Text style={[styles.launchSummaryValue, { color: selectedPlatformIds.length > 0 ? colors.foreground : colors.mutedForeground }]}>
                      {selectedPlatformIds.length > 0
                        ? selectedPlatformIds
                            .map((id) => {
                              const p = connectedPlatforms.find((x) => x.id === id);
                              return p ? PLATFORM_META[p.type]?.label ?? p.type : "";
                            })
                            .join(", ")
                        : "VYBE only"}
                    </Text>
                  </View>
                  {tags.length > 0 && (
                    <>
                      <View style={[styles.launchDivider, { backgroundColor: colors.border }]} />
                      <View style={styles.launchSummaryRow}>
                        <Text style={[styles.launchSummaryLabel, { color: colors.mutedForeground }]}>Tags</Text>
                        <Text style={[styles.launchSummaryValue, { color: colors.primary }]}>
                          {tags.map((t) => `#${t}`).join(" ")}
                        </Text>
                      </View>
                    </>
                  )}
                </View>

                <View style={[styles.aiNote, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
                  <Feather name="zap" size={13} color={colors.primary} />
                  <Text style={[styles.aiNoteText, { color: colors.mutedForeground }]}>
                    AI highlights will be detected automatically during your stream
                  </Text>
                </View>
              </>
            ) : (
              <View style={styles.launchingWrap}>
                <View style={[styles.launchingIcon, { borderColor: colors.live + "60", backgroundColor: colors.live + "15" }]}>
                  <Feather name="radio" size={36} color={colors.live} />
                </View>
                <Text style={[styles.launchingTitle, { color: colors.foreground }]}>Going Live…</Text>
                <View style={styles.launchSteps}>
                  {(selectedPlatformIds.length > 0
                    ? selectedPlatformIds.map((id) => {
                        const p = connectedPlatforms.find((x) => x.id === id);
                        return p ? PLATFORM_META[p.type]?.label ?? p.type : "";
                      })
                    : ["VYBE LIVE"]
                  ).map((label) => {
                    const done = launchProgress.includes(label);
                    return (
                      <View key={label} style={styles.launchStep}>
                        <View
                          style={[
                            styles.launchStepDot,
                            { backgroundColor: done ? "#39FF14" : colors.border },
                          ]}
                        />
                        <Text style={[styles.launchStepText, { color: done ? colors.foreground : colors.mutedForeground }]}>
                          {label}
                        </Text>
                        {done && <Feather name="check" size={13} color="#39FF14" />}
                      </View>
                    );
                  })}
                </View>
              </View>
            )}
          </View>
        )}
      </Animated.ScrollView>

      {/* Bottom CTA */}
      <View style={[styles.bottomBar, { paddingBottom: bottomPad + 12, backgroundColor: colors.background }]}>
        {step < 4 ? (
          <TouchableOpacity
            onPress={goNext}
            disabled={!canGoNext}
            activeOpacity={0.85}
            style={[
              styles.nextBtn,
              { backgroundColor: canGoNext ? colors.primary : colors.border },
            ]}
          >
            <Text style={[styles.nextBtnText, { color: canGoNext ? "#FFF" : colors.mutedForeground }]}>
              {step === 3 ? "Review & Launch" : "Continue"}
            </Text>
            <Feather name="arrow-right" size={18} color={canGoNext ? "#FFF" : colors.mutedForeground} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleLaunch}
            disabled={isLaunching}
            activeOpacity={0.85}
            style={[
              styles.goLiveBtn,
              {
                backgroundColor: isLaunching ? colors.live + "60" : colors.live,
                shadowColor: colors.live,
              },
            ]}
          >
            <Feather name="radio" size={20} color="#FFF" />
            <Text style={styles.goLiveBtnText}>
              {isLaunching ? "Connecting…" : "Go Live Now"}
            </Text>
          </TouchableOpacity>
        )}
      </View>
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
    paddingBottom: 8,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 0,
  },
  stepItem: { alignItems: "center", gap: 4 },
  stepDot: { alignItems: "center", justifyContent: "center" },
  stepNum: { fontSize: 11, fontFamily: "Inter_700Bold" },
  stepLabel: { fontSize: 10, fontFamily: "Inter_500Medium" },
  stepLine: { flex: 1, height: 1, marginBottom: 16, marginHorizontal: 4 },
  content: { paddingHorizontal: 20, paddingTop: 8, gap: 20 },
  stepContent: { gap: 18 },
  stepTitle: { fontSize: 22, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  stepSub: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },

  sourceList: { gap: 10 },
  sourceCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    position: "relative",
  },
  sourceIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  sourceInfo: { flex: 1, gap: 3 },
  sourceLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  sourceSub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  sourceRight: { alignItems: "flex-end", gap: 5, flexShrink: 0 },
  batteryRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  batteryText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  statusChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  checkMark: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  rtmpBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 6,
  },
  rtmpLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  rtmpValue: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  rtmpHint: { fontSize: 11, fontFamily: "Inter_400Regular" },

  deviceInfoBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  deviceInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  deviceInfoTitle: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    flex: 1,
  },
  deviceInfoStep: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
  },
  deviceInfoBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 2,
  },
  deviceInfoBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    flex: 1,
    lineHeight: 16,
  },
  betaBadge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  betaBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
  },
  companionFeatures: { gap: 6 },
  companionFeatureRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  noPlatformWrap: { gap: 14 },
  noPlatformCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
    gap: 10,
  },
  noPlatformTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  noPlatformSub: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  connectBtn: { borderRadius: 12, paddingHorizontal: 20, paddingVertical: 11, marginTop: 4 },
  connectBtnText: { color: "#FFF", fontSize: 14, fontFamily: "Inter_600SemiBold" },
  skipBtn: { alignItems: "center", padding: 8 },
  skipText: { fontSize: 13, fontFamily: "Inter_400Regular" },
  platformGrid: { gap: 10 },
  platformCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  platformIconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  platformShortLabel: { fontSize: 13, fontFamily: "Inter_700Bold" },
  platformInfo: { flex: 1, gap: 3 },
  platformName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  platformChannel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  platformCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    flexShrink: 0,
  },
  selectionSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  summaryText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },

  field: { gap: 8 },
  fieldLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  inputBox: { borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13 },
  input: { fontSize: 16, fontFamily: "Inter_500Medium" },
  charCount: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "right" },
  tagsRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tagText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  tagInputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  tagPrefix: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  tagInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  tagAddBtn: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  advancedToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderTopWidth: 1,
    paddingTop: 14,
  },
  advancedToggleText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  advancedBox: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  advancedRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  advancedLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  advancedValue: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  launchSummaryCard: { width: "100%", borderRadius: 18, borderWidth: 1, overflow: "hidden" },
  launchSummaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 16,
    gap: 12,
  },
  launchDivider: { height: StyleSheet.hairlineWidth },
  launchSummaryLabel: { fontSize: 12, fontFamily: "Inter_500Medium", flexShrink: 0 },
  launchSummaryValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", textAlign: "right", flex: 1 },
  aiNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    width: "100%",
  },
  aiNoteText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  launchingWrap: { alignItems: "center", gap: 20, paddingTop: 20 },
  launchingIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  launchingTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  launchSteps: { gap: 12, width: "100%" },
  launchStep: { flexDirection: "row", alignItems: "center", gap: 10 },
  launchStepDot: { width: 10, height: 10, borderRadius: 5 },
  launchStepText: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },

  bottomBar: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  nextBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 16,
    paddingVertical: 16,
  },
  nextBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  goLiveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 16,
    paddingVertical: 18,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 8,
  },
  goLiveBtnText: { color: "#FFF", fontSize: 18, fontFamily: "Inter_700Bold" },
});
