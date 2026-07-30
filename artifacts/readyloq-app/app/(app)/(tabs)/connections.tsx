/**
 * Connections tab — ReadyLoq
 *
 * Live BLE pairing screen for Meta Ray-Ban smart glasses and future hardware.
 * Uses smartGlassesBle (react-native-ble-plx) for scanning, pairing, and
 * connection lifecycle. Other device slots remain "coming soon".
 */

import { Ionicons } from "@expo/vector-icons";
import { useRouter, type Href } from "expo-router";
import React, { useEffect, useState, useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { State as BleHwState } from "react-native-ble-plx";

import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import {
  APP_VERSION,
  ANDROID_VERSION_CODE,
  CODENAME,
} from "@/constants/version";
import {
  smartGlassesBle,
  type SmartGlassesBleState,
  type DiscoveredGlasses,
} from "@/lib/ble";

// ─── Static device catalogue (Coming Soon entries) ───────────────────────────

interface ComingSoonDevice {
  id: string;
  name: string;
  description: string;
  icon: string;
  transport: string;
}

const COMING_SOON_DEVICES: ComingSoonDevice[] = [
  {
    id: "wifi-camera",
    name: "Wi-Fi IP Camera",
    description:
      "Action cam or IP camera over the local network. Tap to configure the camera URL and capture stills on demand.",
    icon: "wifi-outline",
    transport: "Wi-Fi",
  },
  {
    id: "usb-camera",
    name: "USB Scope / Borescope",
    description:
      "UVC borescope or endoscope over USB-OTG. Live feed with still capture — ideal for wall cavities and crawl spaces.",
    icon: "hardware-chip-outline",
    transport: "USB",
  },
  {
    id: "wearable-camera",
    name: "Wearable Body Camera",
    description:
      "Body-cam or sport wearable. Frames push in as they're recorded and are automatically ingested as evidence.",
    icon: "watch-outline",
    transport: "BLE",
  },
];

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function ConnectionsScreen() {
  const colors = useColors();
  const router = useRouter();

  const [ble, setBle] = useState<SmartGlassesBleState>(() =>
    smartGlassesBle.getState(),
  );

  // Subscribe to BLE state changes
  useEffect(() => {
    const unsub = smartGlassesBle.subscribe(setBle);
    return unsub;
  }, []);

  // Clean up scan on unmount (don't leave an active scan running)
  useEffect(() => {
    return () => {
      if (smartGlassesBle.getState().connectionState === "scanning") {
        smartGlassesBle.stopScan();
      }
    };
  }, []);

  const isScanning = ble.connectionState === "scanning";
  const isConnecting = ble.connectionState === "connecting";
  const isConnected = ble.connectionState === "connected";
  const isDisconnecting = ble.connectionState === "disconnecting";
  const btOff = ble.hwState !== BleHwState.PoweredOn;
  const busy = isConnecting || isDisconnecting;

  const handleScan = useCallback(() => {
    if (btOff) {
      Alert.alert(
        "Bluetooth is off",
        "Enable Bluetooth in device settings to scan for glasses.",
        [{ text: "OK" }],
      );
      return;
    }
    if (isScanning) {
      smartGlassesBle.stopScan();
    } else {
      smartGlassesBle.startScan();
    }
  }, [btOff, isScanning]);

  const handleConnect = useCallback(
    async (device: DiscoveredGlasses) => {
      try {
        await smartGlassesBle.connect(device.id, device.name);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Connection failed.";
        Alert.alert("Connection failed", msg, [{ text: "OK" }]);
      }
    },
    [],
  );

  const handleReconnect = useCallback(async () => {
    const { pairedDeviceId, pairedDeviceName } = ble;
    if (!pairedDeviceId || !pairedDeviceName) return;
    try {
      await smartGlassesBle.connect(pairedDeviceId, pairedDeviceName);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Reconnection failed.";
      Alert.alert("Reconnection failed", msg, [{ text: "OK" }]);
    }
  }, [ble]);

  const handleDisconnect = useCallback(async () => {
    Alert.alert(
      "Disconnect glasses?",
      "The glasses will stop streaming frames and audio until reconnected.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: () => void smartGlassesBle.disconnect(),
        },
      ],
    );
  }, []);

  const handleForget = useCallback(() => {
    Alert.alert(
      "Forget glasses?",
      "The saved pairing will be cleared. You'll need to scan and connect again.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Forget",
          style: "destructive",
          onPress: () => void smartGlassesBle.forgetPairedDevice(),
        },
      ],
    );
  }, []);

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

        {/* Bluetooth off warning */}
        {btOff && (
          <Card
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              backgroundColor: `${colors.destructive}18`,
              borderColor: `${colors.destructive}40`,
              borderWidth: 1,
            }}
          >
            <Ionicons
              name="bluetooth-outline"
              size={18}
              color={colors.destructive}
            />
            <Text
              style={{
                color: colors.destructive,
                fontFamily: "Inter_500Medium",
                fontSize: 13,
                flex: 1,
              }}
            >
              Bluetooth is{" "}
              {ble.hwState === BleHwState.Unauthorized
                ? "not authorized"
                : "off"}{" "}
              — enable it to scan for glasses.
            </Text>
          </Card>
        )}

        {/* Scan / Stop button */}
        {!isConnected && !busy && (
          <Pressable
            onPress={handleScan}
            disabled={busy}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              backgroundColor: isScanning ? colors.muted : colors.primary,
              borderRadius: colors.radius,
              paddingVertical: 14,
              opacity: pressed ? 0.88 : 1,
            })}
          >
            {isScanning ? (
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            ) : (
              <Ionicons
                name="bluetooth-outline"
                size={18}
                color={colors.primaryForeground}
              />
            )}
            <Text
              style={{
                color: isScanning
                  ? colors.mutedForeground
                  : colors.primaryForeground,
                fontFamily: "Inter_600SemiBold",
                fontSize: 15,
              }}
            >
              {isScanning ? "Scanning… (tap to stop)" : "Scan for nearby devices"}
            </Text>
          </Pressable>
        )}

        {/* Last BLE error */}
        {ble.error && ble.connectionState !== "connected" && (
          <Card
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              backgroundColor: `${colors.destructive}12`,
            }}
          >
            <Ionicons
              name="warning-outline"
              size={16}
              color={colors.destructive}
            />
            <Text
              style={{
                color: colors.destructive,
                fontFamily: "Inter_400Regular",
                fontSize: 13,
                flex: 1,
              }}
            >
              {ble.error}
            </Text>
          </Card>
        )}

        {/* ── Connected device ── */}
        <Section title="Connected" icon="radio-outline">
          {isConnected && ble.connectedDeviceId ? (
            <ConnectedGlassesCard
              deviceId={ble.connectedDeviceId}
              deviceName={ble.connectedDeviceName ?? "Meta Ray-Ban Glasses"}
              colors={colors}
              onDisconnect={handleDisconnect}
            />
          ) : busy ? (
            <Card>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
              >
                <ActivityIndicator size="small" color={colors.primary} />
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontFamily: "Inter_400Regular",
                    fontSize: 14,
                  }}
                >
                  {isConnecting ? "Connecting…" : "Disconnecting…"}
                </Text>
              </View>
            </Card>
          ) : (
            <Card>
              <View
                style={{ alignItems: "center", gap: 8, paddingVertical: 12 }}
              >
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
          )}
        </Section>

        {/* ── Discovered devices (scan results) ── */}
        {ble.discovered.length > 0 && (
          <Section title="Discovered nearby" icon="search-outline">
            {ble.discovered.map((device) => (
              <DiscoveredCard
                key={device.id}
                device={device}
                colors={colors}
                onConnect={(): void => { void handleConnect(device); }}
                disabled={busy || isConnected}
              />
            ))}
          </Section>
        )}

        {/* ── Available devices (known, not yet connected) ── */}
        <Section title="Available" icon="checkmark-circle-outline">
          {/* Meta Ray-Ban — always shown as available unless connected */}
          {!isConnected && (
            <GlassesAvailableCard
              colors={colors}
              pairedDeviceId={ble.pairedDeviceId}
              pairedDeviceName={ble.pairedDeviceName}
              btOff={btOff}
              onScan={handleScan}
              onReconnect={handleReconnect}
              onForget={handleForget}
              isConnecting={isConnecting}
            />
          )}
        </Section>

        {/* ── Coming soon ── */}
        <Section title="Coming soon" icon="time-outline">
          {COMING_SOON_DEVICES.map((d) => (
            <ComingSoonCard key={d.id} device={d} colors={colors} />
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

// ─── Section wrapper ──────────────────────────────────────────────────────────

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

// ─── Connected glasses card ───────────────────────────────────────────────────

function ConnectedGlassesCard({
  deviceName,
  colors,
  onDisconnect,
}: {
  deviceId: string;
  deviceName: string;
  colors: ReturnType<typeof useColors>;
  onDisconnect: () => void;
}) {
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            backgroundColor: `${colors.success}22`,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="glasses-outline" size={24} color={colors.success} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text
            style={{
              color: colors.foreground,
              fontFamily: "Inter_600SemiBold",
              fontSize: 15,
            }}
          >
            {deviceName}
          </Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Badge label="BLE" colors={colors} />
            <Badge
              label="Connected"
              colors={colors}
              color={colors.success}
              bg={`${colors.success}22`}
            />
          </View>
        </View>
        {/* Live indicator */}
        <View style={{ alignItems: "center", gap: 3 }}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: colors.success,
            }}
          />
          <Text
            style={{
              color: colors.success,
              fontFamily: "Inter_500Medium",
              fontSize: 10,
            }}
          >
            LIVE
          </Text>
        </View>
      </View>

      {/* Pipeline bindings */}
      <PipelineBindings colors={colors} />

      {/* Disconnect button */}
      <Pressable
        onPress={onDisconnect}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          backgroundColor: colors.muted,
          borderRadius: colors.radius,
          paddingVertical: 10,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <Ionicons
          name="unlink-outline"
          size={16}
          color={colors.mutedForeground}
        />
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: "Inter_600SemiBold",
            fontSize: 14,
          }}
        >
          Disconnect
        </Text>
      </Pressable>
    </Card>
  );
}

// ─── Discovered device card ───────────────────────────────────────────────────

function DiscoveredCard({
  device,
  colors,
  onConnect,
  disabled,
}: {
  device: DiscoveredGlasses;
  colors: ReturnType<typeof useColors>;
  onConnect: () => void;
  disabled: boolean;
}) {
  const rssiPercent = Math.max(0, Math.min(100, ((device.rssi + 100) / 60) * 100));

  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            backgroundColor: colors.accent,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="glasses-outline" size={22} color={colors.primary} />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text
            style={{
              color: colors.foreground,
              fontFamily: "Inter_600SemiBold",
              fontSize: 14,
            }}
          >
            {device.name}
          </Text>
          {/* RSSI bar */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View
              style={{
                flex: 1,
                height: 4,
                backgroundColor: colors.muted,
                borderRadius: 2,
              }}
            >
              <View
                style={{
                  width: `${rssiPercent}%`,
                  height: 4,
                  backgroundColor:
                    rssiPercent > 60
                      ? colors.success
                      : rssiPercent > 30
                      ? colors.primary
                      : colors.destructive,
                  borderRadius: 2,
                }}
              />
            </View>
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: "Inter_400Regular",
                fontSize: 11,
              }}
            >
              {device.rssi} dBm
            </Text>
          </View>
        </View>
        <Pressable
          onPress={onConnect}
          disabled={disabled}
          style={({ pressed }) => ({
            backgroundColor: colors.primary,
            borderRadius: colors.radius,
            paddingHorizontal: 14,
            paddingVertical: 8,
            opacity: pressed || disabled ? 0.6 : 1,
          })}
        >
          <Text
            style={{
              color: colors.primaryForeground,
              fontFamily: "Inter_600SemiBold",
              fontSize: 13,
            }}
          >
            Connect
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}

// ─── Available glasses card (not yet connected) ───────────────────────────────

function GlassesAvailableCard({
  colors,
  pairedDeviceId,
  pairedDeviceName,
  btOff,
  onScan,
  onReconnect,
  onForget,
  isConnecting,
}: {
  colors: ReturnType<typeof useColors>;
  pairedDeviceId: string | null;
  pairedDeviceName: string | null;
  btOff: boolean;
  onScan: () => void;
  onReconnect: () => void;
  onForget: () => void;
  isConnecting: boolean;
}) {
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            backgroundColor: colors.accent,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="glasses-outline" size={24} color={colors.primary} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text
            style={{
              color: colors.foreground,
              fontFamily: "Inter_600SemiBold",
              fontSize: 15,
            }}
          >
            Meta Ray-Ban Glasses
          </Text>
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            <Badge label="BLE" colors={colors} />
            <Badge
              label="Ready to pair"
              colors={colors}
              color={colors.primary}
              bg={`${colors.primary}18`}
            />
          </View>
        </View>
      </View>

      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: "Inter_400Regular",
          fontSize: 13,
          lineHeight: 19,
        }}
      >
        Hands-free evidence capture. Frames arrive via BLE and route through
        the auto-snapshot pipeline. Audio streams to the FAIE voice pipeline.
      </Text>

      <PipelineBindings colors={colors} />

      {/* Previously paired device — quick reconnect */}
      {pairedDeviceId && pairedDeviceName && (
        <View
          style={{
            backgroundColor: `${colors.primary}0C`,
            borderRadius: 8,
            padding: 10,
            gap: 6,
          }}
        >
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 12,
            }}
          >
            Last paired:
          </Text>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "Inter_600SemiBold",
                fontSize: 13,
              }}
            >
              {pairedDeviceName}
            </Text>
            <Pressable onPress={onForget}>
              <Text
                style={{
                  color: colors.destructive,
                  fontFamily: "Inter_500Medium",
                  fontSize: 12,
                }}
              >
                Forget
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Action buttons */}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {pairedDeviceId && (
          <Pressable
            onPress={onReconnect}
            disabled={isConnecting || btOff}
            style={({ pressed }) => ({
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
              backgroundColor: colors.primary,
              borderRadius: colors.radius,
              paddingVertical: 10,
              opacity: pressed || isConnecting || btOff ? 0.6 : 1,
            })}
          >
            {isConnecting ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Ionicons
                name="bluetooth-outline"
                size={15}
                color={colors.primaryForeground}
              />
            )}
            <Text
              style={{
                color: colors.primaryForeground,
                fontFamily: "Inter_600SemiBold",
                fontSize: 14,
              }}
            >
              Reconnect
            </Text>
          </Pressable>
        )}
        <Pressable
          onPress={onScan}
          disabled={btOff}
          style={({ pressed }) => ({
            flex: pairedDeviceId ? 0 : 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            backgroundColor: pairedDeviceId ? colors.muted : colors.primary,
            borderRadius: colors.radius,
            paddingVertical: 10,
            paddingHorizontal: pairedDeviceId ? 16 : undefined,
            opacity: pressed || btOff ? 0.6 : 1,
          })}
        >
          <Ionicons
            name="search-outline"
            size={15}
            color={
              pairedDeviceId ? colors.mutedForeground : colors.primaryForeground
            }
          />
          <Text
            style={{
              color: pairedDeviceId
                ? colors.mutedForeground
                : colors.primaryForeground,
              fontFamily: "Inter_600SemiBold",
              fontSize: 14,
            }}
          >
            Scan
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}

// ─── Coming soon card ─────────────────────────────────────────────────────────

function ComingSoonCard({
  device,
  colors,
}: {
  device: ComingSoonDevice;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Card style={{ gap: 10, opacity: 0.7 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            backgroundColor: colors.muted,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name={device.icon as keyof typeof Ionicons.glyphMap}
            size={24}
            color={colors.mutedForeground}
          />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_600SemiBold",
              fontSize: 15,
            }}
          >
            {device.name}
          </Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Badge label={device.transport} colors={colors} />
            <Badge label="Coming soon" colors={colors} />
          </View>
        </View>
      </View>
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
    </Card>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function Badge({
  label,
  colors,
  color,
  bg,
}: {
  label: string;
  colors: ReturnType<typeof useColors>;
  color?: string;
  bg?: string;
}) {
  return (
    <View
      style={{
        backgroundColor: bg ?? colors.muted,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
    >
      <Text
        style={{
          color: color ?? colors.mutedForeground,
          fontFamily: color ? "Inter_600SemiBold" : "Inter_500Medium",
          fontSize: 11,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

function PipelineBindings({
  colors,
}: {
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={{
        backgroundColor: `${colors.primary}10`,
        borderRadius: 8,
        padding: 10,
        gap: 5,
      }}
    >
      <PipelineRow
        icon="mic-outline"
        label="Audio stream"
        value="FAIE voice pipeline"
        colors={colors}
      />
      <PipelineRow
        icon="camera-outline"
        label="Camera frames"
        value="Auto-snapshot routine"
        colors={colors}
      />
    </View>
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
