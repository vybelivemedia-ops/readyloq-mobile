import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlassesStreamView } from "@/components/stream/GlassesStreamView";
import { deviceTypeLabel, useMetaWearablesContext } from "@/contexts/MetaWearablesContext";
import { useColors } from "@/hooks/useColors";

const GREEN = "#39FF14";

export default function MetaGlassesSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    isRealSDK,
    isExpoGo,
    registrationState,
    permissionStatus,
    connectedDevice,
    batteryLevel,
    mockKitEnabled,
    sessionId,
    streamState,
    startRegistration,
    unregister,
    enableMockKit,
    disableMockKit,
    startGlassesStream,
    stopGlassesStream,
  } = useMetaWearablesContext();

  const [kitBusy, setKitBusy] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [regBusy, setRegBusy] = useState(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleToggleKit = async (val: boolean) => {
    if (kitBusy) return;
    setKitBusy(true);
    try {
      if (val) await enableMockKit();
      else await disableMockKit();
    } catch (err) {
      Alert.alert(
        "Mock Device Kit",
        (err as Error)?.message ??
          "Could not change the Mock Device Kit. It is only available in a development build.",
      );
    } finally {
      setKitBusy(false);
    }
  };

  const handleRegister = async () => {
    if (regBusy || registrationState === "registering") return;
    setRegBusy(true);
    try {
      await startRegistration();
    } catch (err) {
      Alert.alert(
        "Registration Failed",
        (err as Error)?.message ?? "Could not open the Meta AI app. Make sure it is installed.",
      );
    } finally {
      setRegBusy(false);
    }
  };

  const handleUnregister = async () => {
    try {
      await unregister();
    } catch {
      /* ignore */
    }
  };

  const handleToggleTest = async () => {
    if (testBusy) return;
    setTestBusy(true);
    try {
      if (sessionId) await stopGlassesStream();
      else await startGlassesStream();
    } catch (err) {
      Alert.alert("Test Stream", (err as Error)?.message ?? "Could not start the test stream.");
    } finally {
      setTestBusy(false);
    }
  };

  const handleOpenDocs = () => {
    void Linking.openURL("https://developers.meta.com/wearables/docs/develop/");
  };

  // ── Derived UI state ─────────────────────────────────────────────────────────
  const isRegistered = registrationState === "registered";
  const canStream = mockKitEnabled || (isRegistered && !!connectedDevice);
  const isTestActive =
    !!sessionId ||
    streamState === "streaming" ||
    streamState === "starting" ||
    streamState === "waitingForDevice" ||
    streamState === "paused";
  const isStreamLive = streamState === "streaming" || streamState === "paused";

  const regColor = isRegistered
    ? GREEN
    : registrationState === "registering"
    ? colors.primary
    : registrationState === "available"
    ? colors.primary
    : colors.mutedForeground;

  const regLabel = isRegistered
    ? "Registered"
    : registrationState === "registering"
    ? "Registering…"
    : registrationState === "available"
    ? "Ready to connect"
    : "Unavailable";

  const streamLabel =
    streamState === "streaming"
      ? "Streaming live from glasses"
      : streamState === "starting"
      ? "Starting…"
      : streamState === "waitingForDevice"
      ? "Waiting for glasses…"
      : streamState === "paused"
      ? "Paused"
      : streamState === "stopping"
      ? "Stopping…"
      : "Idle";

  const linkLabel =
    connectedDevice?.linkState === "connected"
      ? "Connected"
      : connectedDevice?.linkState === "connecting"
      ? "Connecting…"
      : "Disconnected";

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { paddingTop: topPad + 16, paddingBottom: 48 }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Meta Glasses</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* SDK badge */}
      <View style={[styles.sdkBadge, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="eye" size={18} color={colors.primary} />
        <View style={styles.sdkBadgeText}>
          <Text style={[styles.sdkTitle, { color: colors.foreground }]}>Device Access Toolkit</Text>
          <Text style={[styles.sdkSub, { color: colors.mutedForeground }]}>
            {isRealSDK ? "Native SDK loaded" : "Simulation mode (dev build required)"}
            {" · Developer Preview"}
          </Text>
        </View>
        <View style={[styles.previewBadge, { backgroundColor: colors.primary + "20" }]}>
          <Text style={[styles.previewBadgeText, { color: colors.primary }]}>PREVIEW</Text>
        </View>
      </View>

      {/* Mock Device Kit toggle */}
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.kitHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.kitTitle, { color: colors.foreground }]}>Mock Device Kit</Text>
            <Text style={[styles.kitSub, { color: colors.mutedForeground }]}>
              Test the full streaming flow with your phone camera standing in for glasses — no
              hardware needed.
            </Text>
          </View>
          {kitBusy ? (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 8 }} />
          ) : (
            <Switch
              value={mockKitEnabled}
              onValueChange={(v) => void handleToggleKit(v)}
              trackColor={{ false: colors.border, true: colors.primary }}
              thumbColor="#fff"
              ios_backgroundColor={colors.border}
            />
          )}
        </View>
        <View style={[styles.kitNote, { backgroundColor: "rgba(255,255,255,0.04)" }]}>
          <Feather name="info" size={12} color={colors.mutedForeground} />
          <Text style={[styles.kitNoteText, { color: colors.mutedForeground }]}>
            {isExpoGo
              ? "Running in Expo Go — Mock Device Kit is simulated in JS. Use a development build for the real SDK mock and live glasses."
              : "The Mock Device Kit runs in development/debug builds only. Toggle it off to connect real glasses via the Meta AI app."}
          </Text>
        </View>
      </View>

      {/* Registration */}
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>REGISTRATION</Text>

        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: regColor }]} />
          <Text style={[styles.statusText, { color: colors.foreground }]}>{regLabel}</Text>
          {(registrationState === "registering" || regBusy) && (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: 6 }} />
          )}
          {mockKitEnabled && (
            <View style={[styles.tag, { backgroundColor: colors.primary + "22" }]}>
              <Text style={[styles.tagText, { color: colors.primary }]}>MOCK</Text>
            </View>
          )}
        </View>

        {mockKitEnabled ? (
          <View style={styles.regSuccess}>
            <Feather name="check-circle" size={14} color={GREEN} />
            <Text style={[styles.regSuccessText, { color: colors.foreground }]}>
              Mock Device Kit is providing a simulated registration.
            </Text>
          </View>
        ) : isRegistered ? (
          <>
            <View style={styles.regSuccess}>
              <Feather name="check-circle" size={14} color={GREEN} />
              <Text style={[styles.regSuccessText, { color: colors.foreground }]}>
                VYBE LIVE is registered with the Meta AI app.
              </Text>
            </View>
            <TouchableOpacity onPress={() => void handleUnregister()} style={styles.unregisterBtn}>
              <Text style={[styles.unregisterText, { color: colors.mutedForeground }]}>
                Unregister
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={[styles.description, { color: colors.mutedForeground }]}>
              Register VYBE LIVE with the{" "}
              <Text style={{ color: colors.foreground }}>Meta AI app</Text> to allow your glasses to
              stream directly to this app. The Meta AI app bridges your glasses and VYBE LIVE.
            </Text>
            <TouchableOpacity
              onPress={() => void handleRegister()}
              disabled={registrationState === "registering" || regBusy}
              style={[
                styles.primaryBtn,
                {
                  backgroundColor:
                    registrationState === "registering" || regBusy
                      ? colors.primary + "60"
                      : colors.primary,
                },
              ]}
            >
              {registrationState === "registering" || regBusy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Feather name="link" size={16} color="#fff" />
              )}
              <Text style={styles.primaryBtnText}>
                {registrationState === "registering" || regBusy
                  ? "Opening Meta AI App…"
                  : "Connect via Meta AI App"}
              </Text>
            </TouchableOpacity>
            {!isRealSDK && (
              <View style={[styles.kitNote, { backgroundColor: "rgba(255,255,255,0.04)" }]}>
                <Feather name="info" size={12} color={colors.mutedForeground} />
                <Text style={[styles.kitNoteText, { color: colors.mutedForeground }]}>
                  Simulation mode — registration is simulated. Use an EAS dev build with META_APP_ID
                  configured for real glasses pairing.
                </Text>
              </View>
            )}
          </>
        )}
      </View>

      {/* Device status */}
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>DEVICE STATUS</Text>

        {connectedDevice ? (
          <View style={styles.deviceRow}>
            <View style={[styles.deviceIcon, { backgroundColor: colors.primary + "20" }]}>
              <Feather name="eye" size={18} color={colors.primary} />
            </View>
            <View style={styles.deviceInfo}>
              <Text style={[styles.deviceName, { color: colors.foreground }]}>
                {connectedDevice.name}
              </Text>
              <View style={styles.deviceMeta}>
                <View
                  style={[
                    styles.miniDot,
                    {
                      backgroundColor:
                        connectedDevice.linkState === "connected" ? GREEN : colors.mutedForeground,
                    },
                  ]}
                />
                <Text style={[styles.deviceMetaText, { color: colors.mutedForeground }]}>
                  {linkLabel}
                </Text>
                <Text style={[styles.deviceMetaText, { color: colors.mutedForeground }]}>
                  {" · "}
                  {deviceTypeLabel(connectedDevice.deviceType)}
                </Text>
                {batteryLevel !== null && (
                  <View style={styles.batteryWrap}>
                    <Feather name="battery" size={12} color={colors.mutedForeground} />
                    <Text style={[styles.deviceMetaText, { color: colors.mutedForeground }]}>
                      {batteryLevel}%
                    </Text>
                  </View>
                )}
              </View>
            </View>
            {connectedDevice.isConnected && (
              <View style={[styles.tag, { backgroundColor: GREEN + "22" }]}>
                <Text style={[styles.tagText, { color: GREEN }]}>READY</Text>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.empty}>
            <Feather name="bluetooth" size={22} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              No glasses detected.{"\n"}
              {mockKitEnabled
                ? "Re-toggle the Mock Device Kit to pair a simulated device."
                : "Enable the Mock Device Kit above, or pair your glasses in the Meta AI app."}
            </Text>
          </View>
        )}
      </View>

      {/* Test stream */}
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>TEST STREAM</Text>

        {/* Preview box */}
        <View style={styles.previewBox}>
          {isStreamLive ? (
            <GlassesStreamView isActive style={StyleSheet.absoluteFill} />
          ) : streamState === "starting" || streamState === "waitingForDevice" ? (
            <View style={styles.previewCenter}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.previewHint, { color: colors.mutedForeground }]}>
                {streamLabel}
              </Text>
            </View>
          ) : (
            <View style={styles.previewCenter}>
              <Feather name="play-circle" size={32} color="rgba(255,255,255,0.25)" />
              <Text style={[styles.previewHint, { color: colors.mutedForeground }]}>
                {canStream
                  ? "Run a test to preview the glasses feed"
                  : "Connect glasses or enable the Mock Device Kit"}
              </Text>
            </View>
          )}
          {isStreamLive && (
            <View style={styles.liveTag}>
              <View style={styles.liveTagDot} />
              <Text style={styles.liveTagText}>LIVE</Text>
            </View>
          )}
        </View>

        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isStreamLive ? GREEN : isTestActive ? colors.primary : colors.mutedForeground },
            ]}
          />
          <Text style={[styles.statusSubText, { color: colors.mutedForeground }]}>{streamLabel}</Text>
        </View>

        <TouchableOpacity
          onPress={() => void handleToggleTest()}
          disabled={(!canStream && !isTestActive) || testBusy}
          style={[
            styles.primaryBtn,
            {
              backgroundColor: isTestActive
                ? "#FF3B6C"
                : !canStream || testBusy
                ? colors.primary + "60"
                : colors.primary,
            },
          ]}
        >
          {testBusy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Feather name={isTestActive ? "square" : "play"} size={16} color="#fff" />
          )}
          <Text style={styles.primaryBtnText}>
            {isTestActive ? "Stop Test Stream" : "Test Stream"}
          </Text>
        </TouchableOpacity>

        {permissionStatus === "denied" && (
          <View style={[styles.kitNote, { backgroundColor: "rgba(255,59,108,0.10)" }]}>
            <Feather name="alert-triangle" size={12} color="#FF3B6C" />
            <Text style={[styles.kitNoteText, { color: "#FF3B6C" }]}>
              Camera permission denied. Grant camera access to preview the glasses feed.
            </Text>
          </View>
        )}
      </View>

      {/* Stream quality */}
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>STREAM QUALITY</Text>
        {[
          { label: "Max resolution", value: "720p (1280 × 720)" },
          { label: "Max frame rate", value: "30fps" },
          { label: "Connection", value: "Bluetooth (BLE)" },
          { label: "Audio", value: "Glasses mic via BT profile" },
          { label: "Supported glasses", value: "Ray-Ban Meta, Oakley Meta" },
        ].map((row, i, arr) => (
          <React.Fragment key={row.label}>
            <View style={styles.specRow}>
              <Text style={[styles.specLabel, { color: colors.mutedForeground }]}>{row.label}</Text>
              <Text style={[styles.specValue, { color: colors.foreground }]}>{row.value}</Text>
            </View>
            {i < arr.length - 1 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
          </React.Fragment>
        ))}
        <View style={[styles.kitNote, { backgroundColor: "rgba(255,255,255,0.04)", marginTop: 4 }]}>
          <Feather name="info" size={12} color={colors.mutedForeground} />
          <Text style={[styles.kitNoteText, { color: colors.mutedForeground }]}>
            Bluetooth bandwidth is shared between device control and video. Resolution and frame rate
            are auto-reduced when bandwidth is constrained.
          </Text>
        </View>
      </View>

      {/* How it works */}
      <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>HOW IT WORKS</Text>
        {[
          {
            step: "1",
            title: "Pick a mode",
            body: "Toggle the Mock Device Kit to test with your phone camera, or register with the Meta AI app for real glasses.",
          },
          {
            step: "2",
            title: "Pair your glasses",
            body: "For real hardware, connect your Ray-Ban Meta glasses in the Meta AI app on the same iPhone.",
          },
          {
            step: "3",
            title: "Run a test stream",
            body: "Use Test Stream above to confirm the glasses feed before going live.",
          },
          {
            step: "4",
            title: "Go live",
            body: "In VYBE stream setup, choose Meta Glasses as your video source and stream at up to 720p/30fps.",
          },
        ].map((item, i, arr) => (
          <React.Fragment key={item.step}>
            <View style={styles.howRow}>
              <View
                style={[
                  styles.stepCircle,
                  { backgroundColor: colors.primary + "25", borderColor: colors.primary + "50" },
                ]}
              >
                <Text style={[styles.stepNum, { color: colors.primary }]}>{item.step}</Text>
              </View>
              <View style={styles.stepBody}>
                <Text style={[styles.stepTitle, { color: colors.foreground }]}>{item.title}</Text>
                <Text style={[styles.stepDesc, { color: colors.mutedForeground }]}>{item.body}</Text>
              </View>
            </View>
            {i < arr.length - 1 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
          </React.Fragment>
        ))}
      </View>

      {/* Docs */}
      <TouchableOpacity
        onPress={handleOpenDocs}
        style={[styles.docsRow, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <View>
          <Text style={[styles.docsTitle, { color: colors.foreground }]}>
            Meta Wearables Developer Docs
          </Text>
          <Text style={[styles.docsSub, { color: colors.mutedForeground }]}>
            developers.meta.com/wearables
          </Text>
        </View>
        <Feather name="external-link" size={16} color={colors.mutedForeground} />
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 16 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  sdkBadge: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  sdkBadgeText: { flex: 1 },
  sdkTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  sdkSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  previewBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  previewBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  section: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
    padding: 16,
    gap: 12,
  },
  sectionTitle: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 1.2 },
  kitHeaderRow: { flexDirection: "row", alignItems: "center" },
  kitTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  kitSub: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 3 },
  kitNote: {
    borderRadius: 10,
    padding: 12,
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
  kitNoteText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  statusSubText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginLeft: 4 },
  tagText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  description: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  primaryBtn: {
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#fff" },
  regSuccess: { flexDirection: "row", alignItems: "center", gap: 8 },
  regSuccessText: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1 },
  unregisterBtn: { alignSelf: "flex-start", paddingVertical: 4 },
  unregisterText: { fontSize: 13, fontFamily: "Inter_500Medium", textDecorationLine: "underline" },
  deviceRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  deviceIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  deviceInfo: { flex: 1 },
  deviceName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  deviceMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3, flexWrap: "wrap" },
  miniDot: { width: 6, height: 6, borderRadius: 3 },
  deviceMetaText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  batteryWrap: { flexDirection: "row", alignItems: "center", gap: 3, marginLeft: 4 },
  empty: { alignItems: "center", gap: 10, paddingVertical: 12 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  previewBox: {
    width: "100%",
    aspectRatio: 16 / 9,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#09090F",
    alignItems: "center",
    justifyContent: "center",
  },
  previewCenter: { alignItems: "center", gap: 8, padding: 16 },
  previewHint: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  liveTag: {
    position: "absolute",
    top: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  liveTagDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#FF3B6C" },
  liveTagText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff", letterSpacing: 0.8 },
  specRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  specLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  specValue: { fontSize: 13, fontFamily: "Inter_500Medium" },
  divider: { height: StyleSheet.hairlineWidth },
  howRow: { flexDirection: "row", gap: 14, paddingVertical: 2 },
  stepCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  stepNum: { fontSize: 14, fontFamily: "Inter_700Bold" },
  stepBody: { flex: 1, gap: 2 },
  stepTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  stepDesc: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  docsRow: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  docsTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  docsSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
