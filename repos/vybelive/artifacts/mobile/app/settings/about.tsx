import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import { router } from "expo-router";
import * as Updates from "expo-updates";
import React, { useState } from "react";
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/contexts/AuthContext";
import { APP_VERSION, BUILD_NUMBER, RELEASE_NAME } from "@/constants/version";
import { useColors } from "@/hooks/useColors";

const TAPS_TO_UNLOCK = 5;

function detectEnvironment(): "Production" | "Staging" | "Development" {
  const domain = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
  if (!domain || domain.includes("getvybe.live")) return "Production";
  if (domain.includes(".replit.app")) return "Production";
  if (domain.includes("janeway.replit.dev") || domain.includes("localhost")) return "Development";
  return "Staging";
}

function getApiBaseUrl(): string {
  const domain = process.env["EXPO_PUBLIC_DOMAIN"] ?? "getvybe.live";
  return `https://${domain}/api`;
}

function getUpdateTimestamp(): string {
  try {
    const d = Updates.createdAt;
    if (d instanceof Date) return d.toLocaleString();
  } catch {
    // expo-updates not available in Expo Go
  }
  return "Not available";
}

export default function AboutScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [tapCount, setTapCount] = useState(0);
  const [debugVisible, setDebugVisible] = useState(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const environment = detectEnvironment();
  const apiBaseUrl = getApiBaseUrl();
  const deviceModel = Constants.deviceName ?? Platform.OS;
  const updateTimestamp = getUpdateTimestamp();

  const handleVersionTap = () => {
    const next = tapCount + 1;
    if (next >= TAPS_TO_UNLOCK) {
      setTapCount(0);
      setDebugVisible(true);
    } else {
      setTapCount(next);
    }
  };

  const envColor =
    environment === "Production"
      ? "#22c55e"
      : environment === "Development"
        ? "#f59e0b"
        : "#3b82f6";

  const debugRows = [
    { label: "App Version", value: APP_VERSION },
    { label: "Build Number", value: BUILD_NUMBER },
    { label: "Release", value: RELEASE_NAME },
    { label: "API Base URL", value: apiBaseUrl },
    { label: "User ID", value: user?.id ?? "Not signed in" },
    { label: "Platform", value: Platform.OS },
    { label: "Device Model", value: deviceModel },
    { label: "Environment", value: environment },
    { label: "Last Update", value: updateTimestamp },
  ];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 16, paddingBottom: 40 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>About</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* App identity card — tap version text to unlock debug panel */}
      <View
        style={[
          styles.appCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.appName, { color: colors.foreground }]}>
          VYBE LIVE
        </Text>

        <TouchableOpacity
          onPress={handleVersionTap}
          activeOpacity={0.7}
          style={styles.versionBlock}
        >
          <Text style={[styles.versionLine, { color: colors.foreground }]}>
            Version {APP_VERSION}
          </Text>
          <Text style={[styles.versionLine, { color: colors.mutedForeground }]}>
            Build {BUILD_NUMBER}
          </Text>
          <Text style={[styles.versionLine, { color: colors.mutedForeground }]}>
            Release: {RELEASE_NAME}
          </Text>

          {tapCount > 0 && (
            <Text style={[styles.tapHint, { color: colors.primary }]}>
              {TAPS_TO_UNLOCK - tapCount} more tap
              {TAPS_TO_UNLOCK - tapCount !== 1 ? "s" : ""} to unlock debug panel
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* API Environment */}
      <View
        style={[
          styles.section,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          API ENVIRONMENT
        </Text>

        <View style={styles.infoRow}>
          <Text style={[styles.infoKey, { color: colors.mutedForeground }]}>
            Environment
          </Text>
          <View style={[styles.envBadge, { borderColor: envColor + "60", backgroundColor: envColor + "18" }]}>
            <View style={[styles.envDot, { backgroundColor: envColor }]} />
            <Text style={[styles.envLabel, { color: envColor }]}>{environment}</Text>
          </View>
        </View>

        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        <View style={styles.infoRow}>
          <Text style={[styles.infoKey, { color: colors.mutedForeground }]}>
            API Endpoint
          </Text>
          <Text
            style={[styles.infoValue, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {apiBaseUrl}
          </Text>
        </View>
      </View>

      {/* Debug panel modal */}
      <Modal
        visible={debugVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setDebugVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.debugPanel,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.debugHeader}>
              <Text style={[styles.debugTitle, { color: colors.foreground }]}>
                Debug Panel
              </Text>
              <TouchableOpacity onPress={() => setDebugVisible(false)}>
                <Feather name="x" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            {debugRows.map((row, i) => (
              <React.Fragment key={row.label}>
                <View style={styles.debugRow}>
                  <Text
                    style={[styles.debugKey, { color: colors.mutedForeground }]}
                  >
                    {row.label}
                  </Text>
                  <Text
                    style={[styles.debugValue, { color: colors.foreground }]}
                    numberOfLines={2}
                    selectable
                  >
                    {row.value}
                  </Text>
                </View>
                {i < debugRows.length - 1 && (
                  <View
                    style={[
                      styles.divider,
                      { backgroundColor: colors.border },
                    ]}
                  />
                )}
              </React.Fragment>
            ))}
          </View>
        </View>
      </Modal>
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
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  appCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 16,
  },
  appName: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    letterSpacing: 2,
  },
  versionBlock: { alignItems: "center", gap: 6 },
  versionLine: { fontSize: 15, fontFamily: "Inter_400Regular" },
  tapHint: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 8, opacity: 0.8 },
  section: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  sectionLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.2,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  infoKey: { fontSize: 14, fontFamily: "Inter_500Medium" },
  infoValue: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, textAlign: "right" },
  envBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
  },
  envDot: { width: 6, height: 6, borderRadius: 3 },
  envLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  divider: { height: StyleSheet.hairlineWidth },
  // ── Debug modal ────────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  debugPanel: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    padding: 24,
    gap: 14,
    maxHeight: "85%",
  },
  debugHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  debugTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  debugRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  debugKey: { fontSize: 12, fontFamily: "Inter_500Medium", flex: 0.9, paddingTop: 1 },
  debugValue: { fontSize: 12, fontFamily: "Inter_400Regular", flex: 1.3, textAlign: "right" },
});
