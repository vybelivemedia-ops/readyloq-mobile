import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import {
  APP_VERSION,
  ANDROID_VERSION_CODE,
  CODENAME,
} from "@/constants/version";

// ─── Device catalogue ────────────────────────────────────────────────────────
//
// Source of truth: @platform/meta-wearables FUTURE_WEARABLE_PROVIDERS.
// smart-glasses availability was flipped to true in meta-wearables;
// the remaining entries stay "coming_soon" until their BLE/USB/WiFi drivers
// are implemented in future-source-providers.ts.

type DeviceStatus = "available" | "coming_soon" | "connected";

interface DeviceEntry {
  id: string;
  name: string;
  description: string;
  /** Ionicons glyph */
  icon: string;
  transport: string;
  status: DeviceStatus;
  /** audioPipeline binding, if applicable */
  audioPipeline?: string;
  /** snapshotRoutine binding, if applicable */
  snapshotRoutine?: string;
}

const DEVICES: DeviceEntry[] = [
  {
    id: "smart-glasses",
    name: "Meta Ray-Ban Glasses",
    description:
      "Hands-free evidence capture. Frames arrive over the companion app via BLE. Audio routes to the AI voice pipeline.",
    icon: "glasses-outline",
    transport: "BLE",
    status: "available",
    audioPipeline: "faie",
    snapshotRoutine: "auto_snapshot",
  },
  {
    id: "wifi-camera",
    name: "Wi-Fi IP Camera",
    description:
      "Action cam or IP camera over the local network. Tap to configure the camera URL and capture stills on demand.",
    icon: "wifi-outline",
    transport: "Wi-Fi",
    status: "coming_soon",
  },
  {
    id: "usb-camera",
    name: "USB Scope / Borescope",
    description:
      "UVC borescope or endoscope over USB-OTG. Live feed with still capture — ideal for wall cavities and crawl spaces.",
    icon: "hardware-chip-outline",
    transport: "USB",
    status: "coming_soon",
  },
  {
    id: "wearable-camera",
    name: "Wearable Body Camera",
    description:
      "Body-cam or sport wearable. Frames push in as they're recorded and are automatically ingested as evidence.",
    icon: "watch-outline",
    transport: "BLE",
    status: "coming_soon",
  },
];

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function ConnectionsScreen() {
  const colors = useColors();
  const router = useRouter();
  const [scanning, setScanning] = useState(false);

  const connected = DEVICES.filter((d) => d.status === "connected");
  const available = DEVICES.filter((d) => d.status === "available");
  const comingSoon = DEVICES.filter((d) => d.status === "coming_soon");

  const handleConnect = (device: DeviceEntry) => {
    if (device.id === "smart-glasses") {
      Alert.alert(
        "Meta Ray-Ban Glasses",
        "BLE pairing will be available in the next build once the react-native-ble-plx driver is wired. The device is registered and its pipelines are configured.",
        [{ text: "Got it" }],
      );
      return;
    }
    Alert.alert("Coming soon", `${device.name} support is in development.`, [
      { text: "OK" },
    ]);
  };

  const handleScan = () => {
    setScanning(true);
    setTimeout(() => setScanning(false), 2000);
    Alert.alert(
      "Scanning for devices",
      "BLE scanning will be active once hardware drivers are installed.",
      [{ text: "OK", onPress: () => setScanning(false) }],
    );
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          gap: 20,
          paddingBottom: 48,
          width: "100%",
          maxWidth: 700,
          alignSelf: "center",
        }}
      >
        {/* Header */}
        <View style={{ gap: 2 }}>
          <Text
            style={{
              color: colors.foreground,
              fontFamily: "Inter_700Bold",
              fontSize: 26,
            }}
          >
            Connections
          </Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 14,
            }}
          >
            Pair external capture devices with ReadyLoq
          </Text>
        </View>

        {/* Scan button */}
        <Pressable
          onPress={handleScan}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            backgroundColor: scanning ? colors.muted : colors.primary,
            borderRadius: colors.radius,
            paddingVertical: 14,
            opacity: pressed ? 0.88 : 1,
          })}
        >
          <Ionicons
            name={scanning ? "radio-outline" : "bluetooth-outline"}
            size={18}
            color={colors.primaryForeground}
          />
          <Text
            style={{
              color: colors.primaryForeground,
              fontFamily: "Inter_600SemiBold",
              fontSize: 15,
            }}
          >
            {scanning ? "Scanning for devices…" : "Scan for nearby devices"}
          </Text>
        </Pressable>

        {/* Connected devices — empty state */}
        <Section title="Connected" icon="radio-outline">
          {connected.length === 0 ? (
            <Card>
              <View style={{ alignItems: "center", gap: 8, paddingVertical: 12 }}>
                <Ionicons
                  name="bluetooth-outline"
                  size={32}
                  color={colors.mutedForeground}
                />
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontFamily: "Inter_400Regular",
                    fontSize: 14,
                    textAlign: "center",
                  }}
                >
                  No devices connected.{"\n"}Scan above or pair a device below.
                </Text>
              </View>
            </Card>
          ) : (
            connected.map((d) => (
              <DeviceCard
                key={d.id}
                device={d}
                colors={colors}
                onPress={() => handleConnect(d)}
              />
            ))
          )}
        </Section>

        {/* Available to connect */}
        <Section title="Available" icon="checkmark-circle-outline">
          {available.map((d) => (
            <DeviceCard
              key={d.id}
              device={d}
              colors={colors}
              onPress={() => handleConnect(d)}
            />
          ))}
        </Section>

        {/* Coming soon */}
        <Section title="Coming soon" icon="time-outline">
          {comingSoon.map((d) => (
            <DeviceCard
              key={d.id}
              device={d}
              colors={colors}
              onPress={() => handleConnect(d)}
            />
          ))}
        </Section>

        {/* About footer */}
        <Pressable onPress={() => router.push("/about" as Href)}>
          <Card
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingVertical: 12,
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: colors.accent,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons
                name="information-circle-outline"
                size={22}
                color={colors.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: colors.foreground,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 14,
                }}
              >
                About ReadyLoq
              </Text>
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: "Inter_400Regular",
                  fontSize: 12,
                }}
              >
                v{APP_VERSION} (build {ANDROID_VERSION_CODE}) · "{CODENAME}"
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.mutedForeground}
            />
          </Card>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
        <Ionicons name={icon} size={16} color={colors.primary} />
        <Text
          style={{
            color: colors.foreground,
            fontFamily: "Inter_600SemiBold",
            fontSize: 15,
          }}
        >
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

function DeviceCard({
  device,
  colors,
  onPress,
}: {
  device: DeviceEntry;
  colors: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  const isAvailable = device.status === "available";
  const isConnected = device.status === "connected";
  const isComingSoon = device.status === "coming_soon";

  const statusLabel = isConnected
    ? "Connected"
    : isAvailable
    ? "Ready to pair"
    : "Coming soon";

  const statusColor = isConnected
    ? colors.success
    : isAvailable
    ? colors.primary
    : colors.mutedForeground;

  const statusBg = isConnected
    ? `${colors.success}22`
    : isAvailable
    ? `${colors.primary}18`
    : `${colors.mutedForeground}14`;

  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        {/* Device icon */}
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            backgroundColor: isComingSoon ? colors.muted : colors.accent,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name={device.icon as keyof typeof Ionicons.glyphMap}
            size={24}
            color={isComingSoon ? colors.mutedForeground : colors.primary}
          />
        </View>

        {/* Name + badges */}
        <View style={{ flex: 1, gap: 4 }}>
          <Text
            style={{
              color: isComingSoon ? colors.mutedForeground : colors.foreground,
              fontFamily: "Inter_600SemiBold",
              fontSize: 15,
            }}
          >
            {device.name}
          </Text>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            {/* Transport badge */}
            <View
              style={{
                backgroundColor: colors.muted,
                borderRadius: 999,
                paddingHorizontal: 8,
                paddingVertical: 2,
              }}
            >
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: "Inter_500Medium",
                  fontSize: 11,
                }}
              >
                {device.transport}
              </Text>
            </View>
            {/* Status badge */}
            <View
              style={{
                backgroundColor: statusBg,
                borderRadius: 999,
                paddingHorizontal: 8,
                paddingVertical: 2,
              }}
            >
              <Text
                style={{
                  color: statusColor,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 11,
                }}
              >
                {statusLabel}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* Description */}
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: "Inter_400Regular",
          fontSize: 13,
          lineHeight: 19,
        }}
      >
        {device.description}
      </Text>

      {/* Pipeline bindings — shown only for smart glasses */}
      {(device.audioPipeline || device.snapshotRoutine) ? (
        <View
          style={{
            backgroundColor: `${colors.primary}10`,
            borderRadius: 8,
            padding: 10,
            gap: 5,
          }}
        >
          {device.audioPipeline ? (
            <PipelineRow
              icon="mic-outline"
              label="Audio stream"
              value="FAIE voice pipeline"
              colors={colors}
            />
          ) : null}
          {device.snapshotRoutine ? (
            <PipelineRow
              icon="camera-outline"
              label="Camera frames"
              value="Auto-snapshot routine"
              colors={colors}
            />
          ) : null}
        </View>
      ) : null}

      {/* Action button */}
      {!isComingSoon ? (
        <Pressable
          onPress={onPress}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            backgroundColor: isConnected ? colors.muted : colors.primary,
            borderRadius: colors.radius,
            paddingVertical: 10,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Ionicons
            name={isConnected ? "unlink-outline" : "bluetooth-outline"}
            size={16}
            color={isConnected ? colors.mutedForeground : colors.primaryForeground}
          />
          <Text
            style={{
              color: isConnected
                ? colors.mutedForeground
                : colors.primaryForeground,
              fontFamily: "Inter_600SemiBold",
              fontSize: 14,
            }}
          >
            {isConnected ? "Disconnect" : "Connect"}
          </Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

function PipelineRow({
  icon,
  label,
  value,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
      <Ionicons name={icon} size={13} color={colors.primary} />
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: "Inter_400Regular",
          fontSize: 12,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: colors.primary,
          fontFamily: "Inter_600SemiBold",
          fontSize: 12,
          marginLeft: "auto",
        }}
      >
        {value}
      </Text>
    </View>
  );
}
