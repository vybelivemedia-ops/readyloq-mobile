/**
 * GlassesStreamView
 *
 * Renders the live video feed coming from Meta Wearables glasses via the
 * Device Access Toolkit's native `EMWDATStreamView`. The native view pulls
 * decoded frames straight from the SDK on the native side, so there is no
 * session-id prop — it simply renders whatever stream the active DAT session
 * is producing (gated by `isActive`).
 *
 * Loading strategy (same guard pattern as react-native-agora):
 *   A static import of `expo-meta-wearables-dat` crashes Expo Go at module-load
 *   time because the native module is not present. We therefore check
 *   `Constants.appOwnership` and only `require()` the package outside Expo Go.
 *
 * Fallbacks when the native view is unavailable (Expo Go / web):
 *   - Native (real device or Mock Device Kit): EMWDATStreamView
 *   - Expo Go on a phone: the phone camera (expo-camera) as a visual stand-in
 *   - Web: a static placeholder
 */

import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import { CameraView } from "expo-camera";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

type ResizeMode = "contain" | "cover" | "stretch";

const IS_EXPO_GO = Constants.appOwnership === "expo";

let NativeStreamView:
  | React.ComponentType<{ isActive?: boolean; resizeMode?: ResizeMode; style?: StyleProp<ViewStyle> }>
  | null = null;

if (!IS_EXPO_GO) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-meta-wearables-dat") as {
      EMWDATStreamView?: React.ComponentType<{
        isActive?: boolean;
        resizeMode?: ResizeMode;
        style?: StyleProp<ViewStyle>;
      }>;
    };
    NativeStreamView = mod.EMWDATStreamView ?? null;
  } catch {
    // Native module unavailable in this build — fall back to the camera stand-in.
  }
}

/** True when the real native DAT stream view is loadable (dev build with SDK). */
export const glassesStreamViewAvailable = NativeStreamView !== null;

interface GlassesStreamViewProps {
  /** Whether the DAT stream is live; controls the native view's rendering. */
  isActive?: boolean;
  /** Phone camera facing used only for the Expo Go stand-in. */
  facing?: "front" | "back";
  resizeMode?: ResizeMode;
  style?: StyleProp<ViewStyle>;
}

export function GlassesStreamView({
  isActive = true,
  facing = "back",
  resizeMode = "cover",
  style,
}: GlassesStreamViewProps) {
  // Real native DAT view (dev build, real glasses or Mock Device Kit)
  if (NativeStreamView) {
    return <NativeStreamView isActive={isActive} resizeMode={resizeMode} style={style} />;
  }

  // Expo Go / no native module — phone camera as a visual stand-in
  if (Platform.OS !== "web") {
    return <CameraView style={style} facing={facing} />;
  }

  // Web — static placeholder
  return (
    <View style={[style, styles.webPlaceholder]}>
      <Feather name="eye" size={48} color="rgba(255,255,255,0.10)" />
      <Text style={styles.webPlaceholderText}>Glasses preview</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  webPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#09090F",
  },
  webPlaceholderText: {
    color: "rgba(255,255,255,0.20)",
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
});
