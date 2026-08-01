/**
 * NativeCameraHealthBadge — compact amber warning strip shown only when the
 * device's built-in camera is in a degraded state.
 *
 * Renders nothing when the camera is healthy or the initial health probe is
 * still in flight, keeping the capture UI uncluttered during normal operation.
 *
 * When camera permission is denied the badge is tappable — pressing it
 * triggers the system permission dialog so the technician can grant access
 * without leaving the inspection screen.
 *
 * This component is separate from DeviceHealthStrip, which covers supplemental
 * hardware (Wi-Fi cameras, BLE sensors). Both can appear simultaneously when
 * a supplemental device is also connected.
 */

import { Ionicons } from "@expo/vector-icons";
import { Camera } from "expo-camera";
import React from "react";
import { Pressable, Text } from "react-native";

import { useCameraHealth } from "@/hooks/useCameraHealth";

const AMBER = "#f59e0b";
const BG    = "rgba(245,158,11,0.10)";
const BORDER = "rgba(245,158,11,0.28)";

export function NativeCameraHealthBadge() {
  const { status, message } = useCameraHealth();

  // Healthy or still probing — nothing to surface.
  if (status === "healthy" || status === "checking") return null;

  const isPermissionIssue = message?.toLowerCase().includes("permission") ?? false;

  const handlePress = async () => {
    if (isPermissionIssue) {
      await Camera.requestCameraPermissionsAsync();
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: BG,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        alignSelf: "stretch",
        borderWidth: 1,
        borderColor: BORDER,
      }}
    >
      <Ionicons name="camera-outline" size={16} color={AMBER} />
      <Text
        style={{
          color: AMBER,
          fontFamily: "Inter_400Regular",
          fontSize: 12,
          flex: 1,
        }}
      >
        {message ?? "Camera degraded"}
        {isPermissionIssue ? " — tap to grant access" : ""}
      </Text>
    </Pressable>
  );
}
