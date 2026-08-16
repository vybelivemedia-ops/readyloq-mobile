/**
 * Connections tab — ReadyLoq
 *
 * Pairing screen for all ReadyLoq hardware:
 *   • Meta Ray-Ban smart glasses (BLE)
 *   • Wi-Fi IP cameras (GoPro, generic MJPEG/JPEG endpoints)
 *   • BLE measurement sensors (moisture, laser, temperature, CO₂, acoustic)
 *
 * USB scope and wearable body-cam remain coming soon.
 */

import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect, type Href } from "expo-router";
import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { State as BleHwState } from "react-native-ble-plx";

import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { DeviceScannerModal } from "@/components/DeviceScannerModal";
import { WifiCameraModal } from "@/components/WifiCameraModal";
import { GlassesCalibrationModal } from "@/components/GlassesCalibrationModal";
import {
  loadCalibrationProfile,
  clearCalibrationProfile,
} from "@/lib/meta-glasses/calibration";
import type { BasicCalibrationProfile } from "@platform/measurement-core";
import { useColors } from "@/hooks/useColors";
import {
  APP_VERSION,
  ANDROID_VERSION_CODE,
  CODENAME,
} from "@/constants/version";
import {
  smartGlassesBle,
  checkBlePermissions,
  requestBlePermissions,
  type BlePermissionStatus,
  type SmartGlassesBleState,
  type DiscoveredGlasses,
} from "@/lib/ble";
import { useDeviceRegistry } from "@/lib/platform/DeviceRegistryContext";
import type { DiscoveredSensor } from "@/lib/ble/ble-sensor-adapter";
import {
  getWifiCameraConfig,
  clearWifiCameraConfig,
} from "@/lib/vision/wifi-camera-provider";

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

// ─── BLE Sensor catalogue ─────────────────────────────────────────────────────

interface SensorEntry {
  id: string;
  name: string;
  description: string;
  icon: string;
  serviceUUIDs: string[];
  namePatterns: string[];
  scanHint: string;
}

const SENSOR_CATALOGUE: SensorEntry[] = [
  {
    id: "protimeter-ble",
    name: "Moisture Meter",
    description: "Protimeter Surveymaster or compatible. Detects damp in walls, flooring, and structural elements.",
    icon: "water-outline",
    serviceUUIDs: ["59462F12-9543-9999-12C8-58B459A2712D", "0000181A-0000-1000-8000-00805F9B34FB"],
    namePatterns: ["Protimeter", "PTM", "Surveymaster", "ReadyLoq Moisture"],
    scanHint: "Power on your moisture meter and hold it within 1 m of the phone.",
  },
  {
    id: "laser-distance-ble",
    name: "Laser Distance Meter",
    description: "Bosch GLM or compatible. Measures cavity and room dimensions via Bluetooth.",
    icon: "scan-outline",
    serviceUUIDs: ["6E400001-B5A3-F393-E0A9-E50E24DCCA9E"],
    namePatterns: ["GLM", "Bosch", "Laser", "ReadyLoq Laser"],
    scanHint: "Enable Bluetooth on the laser meter and keep it within range.",
  },
  {
    id: "temperature-ble",
    name: "Temp / Humidity Sensor",
    description: "ESS-compatible probe (Govee, Inkbird, Aranet). Flags conditions that favor mold and pest activity.",
    icon: "thermometer-outline",
    serviceUUIDs: ["0000181A-0000-1000-8000-00805F9B34FB"],
    namePatterns: ["Govee", "Inkbird", "SensorTag", "Aranet", "ReadyLoq Temp", "RL-Temp"],
    scanHint: "The sensor should be awake and advertising. Check its LED if unsure.",
  },
  {
    id: "co2-ble",
    name: "CO₂ / Air Quality",
    description: "ReadyLoq CO₂ sensor. Elevated readings can indicate mold, poor ventilation, or pest harborage.",
    icon: "cloud-outline",
    serviceUUIDs: ["0000E001-0000-1000-8000-00805F9B34FB"],
    namePatterns: ["ReadyLoq CO2", "RL-CO2", "Aranet4", "SCD"],
    scanHint: "Ensure the CO₂ sensor is powered and not in sleep mode.",
  },
  {
    id: "acoustic-sensor-ble",
    name: "Acoustic Activity Sensor",
    description: "ReadyLoq acoustic probe. Detects termite feeding and pest movement in structural elements.",
    icon: "ear-outline",
    serviceUUIDs: ["0000F001-0000-1000-8000-00805F9B34FB"],
    namePatterns: ["ReadyLoq Acoustic", "RL-Acoustic", "RL-Vibration"],
    scanHint: "Place the acoustic sensor against the structure, then scan.",
  },
];

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function ConnectionsScreen() {
  const colors = useColors();
  const router = useRouter();

  const [ble, setBle] = useState<SmartGlassesBleState>(() =>
    smartGlassesBle.getState(),
  );

  // ── BLE runtime permission state ───────────────────────────────────────────
  const [blePermStatus, setBlePermStatus] =
    useState<BlePermissionStatus>("checking");

  // Check permissions on mount and whenever the app returns to foreground
  // (covers the case where the user grants/revokes from the Settings app).
  useEffect(() => {
    let mounted = true;
    const check = () => {
      void checkBlePermissions().then((s) => {
        if (mounted) setBlePermStatus(s);
      });
    };
    check();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") check();
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

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

  // ── BLE sensor state ────────────────────────────────────────────────────────
  const { plugin } = useDeviceRegistry();
  /** Which sensor's scanner modal is currently open (null = none). */
  const [activeSensorId, setActiveSensorId] = useState<string | null>(null);
  /** IDs of sensors currently in the process of connecting. */
  const [connectingSensorId, setConnectingSensorId] = useState<string | null>(null);
  /** Track connected sensor IDs so cards re-render after connect/disconnect. */
  const [connectedSensorIds, setConnectedSensorIds] = useState<Set<string>>(new Set());

  // ── Wi-Fi camera state ──────────────────────────────────────────────────────
  const [wifiModalVisible, setWifiModalVisible] = useState(false);
  const [wifiConfig, setWifiConfig] = useState(() => getWifiCameraConfig());

  const handleSensorConnect = useCallback(
    async (sensorId: string, device: DiscoveredSensor) => {
      setConnectingSensorId(sensorId);
      try {
        const provider = plugin.getBleSensorProvider(sensorId);
        if (!provider) throw new Error("Sensor provider not found");
        provider.setPairedDevice(device.id, device.name);
        await provider.connect();
        setConnectedSensorIds((prev) => new Set([...prev, sensorId]));
        setActiveSensorId(null);
      } catch (err) {
        throw err; // let DeviceScannerModal surface the error
      } finally {
        setConnectingSensorId(null);
      }
    },
    [plugin],
  );

  const handleSensorDisconnect = useCallback(
    async (sensorId: string) => {
      const provider = plugin.getBleSensorProvider(sensorId);
      if (!provider) return;
      try {
        await provider.disconnect();
        setConnectedSensorIds((prev) => {
          const next = new Set(prev);
          next.delete(sensorId);
          return next;
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Disconnect failed.";
        Alert.alert("Disconnect failed", msg, [{ text: "OK" }]);
      }
    },
    [plugin],
  );

  // ── #101 — Resync sensor + Wi-Fi camera state on tab focus ─────────────────
  // connectedSensorIds is normally updated only via UI actions; when the user
  // navigates away and back, or a background reconnect fires, we re-read the
  // live provider state so cards reflect reality without a full re-mount.
  // wifiConfig is also re-read here because DevicePlugin.initialize() restores
  // it async at startup — by the time the user opens the tab it will be set.
  useFocusEffect(
    useCallback(() => {
      const live = new Set<string>();
      for (const entry of SENSOR_CATALOGUE) {
        const p = plugin.getBleSensorProvider(entry.id);
        if (p && (p as unknown as { isConnected: boolean }).isConnected) {
          live.add(entry.id);
        }
      }
      setConnectedSensorIds(live);
      setWifiConfig(getWifiCameraConfig());
    }, [plugin]),
  );

  const handleWifiConnected = useCallback(() => {
    const cfg = getWifiCameraConfig();
    setWifiConfig(cfg);
    // Register the newly configured camera with the DeviceRegistry so it's
    // immediately available to the inspection workspace.
    if (cfg) plugin.registerWifiCamera(cfg);
    setWifiModalVisible(false);
  }, [plugin]);

  const handleWifiForget = useCallback(() => {
    Alert.alert(
      "Forget Wi-Fi camera?",
      "The saved URL and label will be cleared. You can reconfigure at any time.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Forget",
          style: "destructive",
          onPress: () => {
            clearWifiCameraConfig();
            plugin.registry.unregister?.("wifi-camera");
            setWifiConfig(null);
          },
        },
      ],
    );
  }, [plugin]);

  // ── #89 — Acoustic bait station slot assignment ──────────────────────────────
  const [acousticSlot, setAcousticSlot] = useState("");
  const [acousticSlotDraft, setAcousticSlotDraft] = useState("");

  useEffect(() => {
    void AsyncStorage.getItem("@readyloq:sensor:acoustic-sensor-ble:slot").then((v) => {
      if (v) { setAcousticSlot(v); setAcousticSlotDraft(v); }
    });
  }, []);

  const saveAcousticSlot = useCallback((value: string) => {
    const trimmed = value.trim();
    setAcousticSlot(trimmed);
    const acousticProvider = plugin.getBleSensorProvider("acoustic-sensor-ble");
    if (acousticProvider && "setStationSlot" in acousticProvider) {
      (acousticProvider as { setStationSlot: (s: string | null) => void })
        .setStationSlot(trimmed || null);
    }
  }, [plugin]);

  const handleScan = useCallback(async () => {
    // ── Step 1: ensure runtime permissions are granted ──────────────────────
    if (blePermStatus !== "granted") {
      const result = await requestBlePermissions();
      setBlePermStatus(result);
      if (result !== "granted") return; // PermissionBanner explains next steps
    }
    // ── Step 2: ensure the radio is on ──────────────────────────────────────
    if (btOff) {
      Alert.alert(
        "Bluetooth is off",
        "Enable Bluetooth in device settings to scan for glasses.",
        [{ text: "OK" }],
      );
      return;
    }
    // ── Step 3: toggle scan ──────────────────────────────────────────────────
    if (isScanning) {
      smartGlassesBle.stopScan();
    } else {
      smartGlassesBle.startScan();
    }
  }, [blePermStatus, btOff, isScanning]);

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

        {/* ── Permission banner — Android runtime permissions not yet granted ── */}
        {blePermStatus !== "checking" && blePermStatus !== "granted" && (
          <BlePermissionBanner
            status={blePermStatus}
            colors={colors}
            onRequest={async () => {
              const result = await requestBlePermissions();
              setBlePermStatus(result);
            }}
          />
        )}

        {/* ── Bluetooth hardware state banner (only once permissions are OK) ── */}
        {blePermStatus === "granted" && btOff && (
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
            <View style={{ flex: 1, gap: 1 }}>
              <Text
                style={{
                  color: colors.destructive,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 13,
                }}
              >
                {ble.hwState === BleHwState.Unauthorized
                  ? "Bluetooth access denied"
                  : "Bluetooth is off"}
              </Text>
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: "Inter_400Regular",
                  fontSize: 12,
                }}
              >
                {ble.hwState === BleHwState.Unauthorized
                  ? "Allow ReadyLoq to use Bluetooth in Settings."
                  : "Enable Bluetooth to scan for glasses."}
              </Text>
            </View>
            {ble.hwState === BleHwState.Unauthorized && (
              <Pressable
                onPress={() => void Linking.openSettings()}
                style={({ pressed }) => ({
                  backgroundColor: colors.primary,
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text
                  style={{
                    color: colors.primaryForeground,
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 12,
                  }}
                >
                  Settings
                </Text>
              </Pressable>
            )}
          </Card>
        )}

        {/* Scan / Stop button */}
        {!isConnected && !busy && (
          <Pressable
            onPress={(): void => { void handleScan(); }}
            disabled={busy || blePermStatus === "checking"}
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

        {/* ── Wi-Fi Camera ─────────────────────────────────────────────────── */}
        <Section title="Wi-Fi Camera" icon="wifi-outline">
          <Card style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{
                width: 40, height: 40, borderRadius: 20,
                backgroundColor: wifiConfig ? "rgba(34,197,94,0.12)" : colors.accent,
                alignItems: "center", justifyContent: "center",
              }}>
                <Ionicons
                  name="wifi-outline"
                  size={20}
                  color={wifiConfig ? "#22c55e" : colors.mutedForeground}
                />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                  {wifiConfig?.label ?? "Wi-Fi IP Camera"}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                  {wifiConfig
                    ? wifiConfig.baseUrl
                    : "GoPro, IP cam, or any JPEG endpoint on your local network"}
                </Text>
              </View>
              {wifiConfig ? (
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <Pressable
                    onPress={() => setWifiModalVisible(true)}
                    style={({ pressed }) => ({
                      paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
                      backgroundColor: colors.accent,
                      borderWidth: 1, borderColor: colors.border,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
                      Edit
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handleWifiForget}
                    style={({ pressed }) => ({
                      paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
                      backgroundColor: "rgba(239,68,68,0.10)",
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ color: "#ef4444", fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
                      Forget
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={() => setWifiModalVisible(true)}
                  style={({ pressed }) => ({
                    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                    backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
                    Configure
                  </Text>
                </Pressable>
              )}
            </View>
            {wifiConfig && (
              <View style={{
                flexDirection: "row", alignItems: "center", gap: 6,
                backgroundColor: "rgba(34,197,94,0.08)",
                borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
              }}>
                <Ionicons name="checkmark-circle" size={14} color="#22c55e" />
                <Text style={{ color: "#22c55e", fontFamily: "Inter_500Medium", fontSize: 12 }}>
                  Ready — available as a capture source in inspections
                </Text>
              </View>
            )}
          </Card>
        </Section>

        {/* ── BLE Sensors ─────────────────────────────────────────────────── */}
        <Section title="Sensors" icon="hardware-chip-outline">
          {SENSOR_CATALOGUE.map((entry) => {
            const isConn = connectedSensorIds.has(entry.id);
            const isConnectingThis = connectingSensorId === entry.id;
            const provider = plugin.getBleSensorProvider(entry.id);
            const pairedName = provider?.pairedDeviceName;
            return (
              <React.Fragment key={entry.id}>
              <Card
                style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 }}
              >
                {/* Icon */}
                <View
                  style={{
                    width: 40, height: 40, borderRadius: 20,
                    backgroundColor: isConn ? "rgba(34,197,94,0.12)" : colors.accent,
                    alignItems: "center", justifyContent: "center",
                  }}
                >
                  <Ionicons
                    name={entry.icon as "water-outline"}
                    size={20}
                    color={isConn ? "#22c55e" : colors.mutedForeground}
                  />
                </View>

                {/* Info */}
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                    {entry.name}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 16 }}>
                    {isConn
                      ? `Connected${pairedName ? ` · ${pairedName}` : ""}`
                      : entry.description}
                  </Text>
                </View>

                {/* Action */}
                {isConnectingThis ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : isConn ? (
                  <Pressable
                    onPress={() => void handleSensorDisconnect(entry.id)}
                    style={({ pressed }) => ({
                      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                      backgroundColor: "rgba(239,68,68,0.1)",
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ color: "#ef4444", fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
                      Disconnect
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={async () => {
                      // #100 — check/request permissions before opening scanner
                      if (btOff) {
                        Alert.alert(
                          "Bluetooth is off",
                          "Enable Bluetooth in device settings to scan for sensors.",
                          [{ text: "OK" }],
                        );
                        return;
                      }
                      if (blePermStatus !== "granted") {
                        const result = await requestBlePermissions();
                        setBlePermStatus(result);
                        if (result === "blocked") {
                          Alert.alert(
                            "Permission required",
                            "Bluetooth permission was permanently denied. Open Settings to allow it.",
                            [
                              { text: "Cancel", style: "cancel" },
                              { text: "Open Settings", onPress: () => void Linking.openSettings() },
                            ],
                          );
                          return;
                        }
                        if (result !== "granted") return;
                      }
                      setActiveSensorId(entry.id);
                    }}
                    style={({ pressed }) => ({
                      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                      backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
                      Connect
                    </Text>
                  </Pressable>
                )}
              </Card>

              {/* ── #89 Station slot assignment (acoustic sensor only) ── */}
              {entry.id === "acoustic-sensor-ble" && isConn && (
                <Card style={{ gap: 6, paddingVertical: 10 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons name="location-outline" size={14} color={colors.mutedForeground} />
                    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12 }}>
                      Assign to bait station slot
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <TextInput
                      value={acousticSlotDraft}
                      onChangeText={setAcousticSlotDraft}
                      onBlur={() => saveAcousticSlot(acousticSlotDraft)}
                      onSubmitEditing={() => saveAcousticSlot(acousticSlotDraft)}
                      placeholder="e.g. Station 3A"
                      placeholderTextColor={colors.mutedForeground}
                      returnKeyType="done"
                      style={{
                        flex: 1,
                        color: colors.foreground,
                        fontFamily: "Inter_400Regular",
                        fontSize: 14,
                        backgroundColor: colors.accent,
                        borderRadius: 8,
                        paddingHorizontal: 12,
                        paddingVertical: 8,
                        borderWidth: 1,
                        borderColor: acousticSlot ? colors.primary : colors.border,
                      }}
                    />
                    {acousticSlot ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Ionicons name="checkmark-circle" size={16} color="#22c55e" />
                        <Text style={{ color: "#22c55e", fontFamily: "Inter_500Medium", fontSize: 11 }}>
                          Assigned
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 15 }}>
                    Activity detected by this sensor will auto-record to the assigned station slot.
                  </Text>
                </Card>
              )}
              </React.Fragment>
            );
          })}
        </Section>

        {/* DeviceScannerModal — opens for the active sensor */}
        {SENSOR_CATALOGUE.map((entry) => (
          <DeviceScannerModal
            key={entry.id}
            visible={activeSensorId === entry.id}
            title={`Connect ${entry.name}`}
            description={entry.scanHint}
            serviceUUIDs={entry.serviceUUIDs}
            namePatterns={entry.namePatterns}
            onConnect={(device) => handleSensorConnect(entry.id, device)}
            onClose={() => setActiveSensorId(null)}
          />
        ))}

        {/* Wi-Fi camera modal */}
        <WifiCameraModal
          visible={wifiModalVisible}
          onClose={() => setWifiModalVisible(false)}
          onConnected={handleWifiConnected}
        />

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
  deviceId,
  deviceName,
  colors,
  onDisconnect,
}: {
  deviceId: string;
  deviceName: string;
  colors: ReturnType<typeof useColors>;
  onDisconnect: () => void;
}) {
  const [calibModalVisible, setCalibModalVisible] = useState(false);
  const [calibProfile, setCalibProfile] = useState<BasicCalibrationProfile | null>(null);
  const [calibLoading, setCalibLoading] = useState(true);

  // Load existing calibration profile on mount and after save.
  const refreshCalib = useCallback(async () => {
    setCalibLoading(true);
    try {
      const profile = await loadCalibrationProfile(deviceId);
      setCalibProfile(profile);
    } finally {
      setCalibLoading(false);
    }
  }, [deviceId]);

  useEffect(() => { void refreshCalib(); }, [refreshCalib]);

  const handleClearCalib = useCallback(() => {
    Alert.alert(
      "Clear calibration?",
      "The glasses camera will revert to the 800 px phone default until you re-calibrate.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            void clearCalibrationProfile(deviceId).then(refreshCalib);
          },
        },
      ],
    );
  }, [deviceId, refreshCalib]);

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

      {/* Camera calibration row */}
      <View
        style={{
          borderRadius: 10,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingVertical: 10,
            paddingHorizontal: 12,
            gap: 10,
          }}
        >
          <Ionicons
            name="aperture-outline"
            size={18}
            color={calibProfile ? "#22c55e" : colors.mutedForeground}
          />
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
              Camera calibration
            </Text>
            {calibLoading ? (
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>
                Loading…
              </Text>
            ) : calibProfile ? (
              <Text style={{ color: "#22c55e", fontFamily: "Inter_400Regular", fontSize: 11 }}>
                {`Calibrated · ${Math.round(calibProfile.focalLengthPx)} px focal length`}
              </Text>
            ) : (
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>
                Not calibrated — using 800 px default
              </Text>
            )}
          </View>
          {calibProfile && (
            <Pressable onPress={handleClearCalib} hitSlop={8}>
              <Ionicons name="trash-outline" size={16} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
        <Pressable
          onPress={() => setCalibModalVisible(true)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            paddingVertical: 9,
            backgroundColor: pressed ? "#17c4d318" : "#17c4d310",
            borderTopWidth: 1,
            borderTopColor: colors.border,
          })}
        >
          <Ionicons name="camera-outline" size={15} color="#17c4d3" />
          <Text style={{ color: "#17c4d3", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
            {calibProfile ? "Re-calibrate glasses camera" : "Calibrate glasses camera"}
          </Text>
        </Pressable>
      </View>

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

      {/* Calibration modal */}
      <GlassesCalibrationModal
        visible={calibModalVisible}
        deviceId={deviceId}
        onClose={() => setCalibModalVisible(false)}
        onSaved={(profile) => {
          setCalibProfile(profile);
          setCalibModalVisible(false);
        }}
      />
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

// ─── BLE permission banner ─────────────────────────────────────────────────────
//
// Shown when Android runtime BLE permissions have been denied or permanently
// blocked.  Offers a "Grant Permissions" button for the denied case and an
// "Open Settings" button for the permanently-blocked case.

function BlePermissionBanner({
  status,
  colors,
  onRequest,
}: {
  status: "denied" | "blocked";
  colors: ReturnType<typeof useColors>;
  onRequest: () => Promise<void>;
}) {
  const [requesting, setRequesting] = React.useState(false);

  const isBlocked = status === "blocked";

  const handlePress = async () => {
    if (isBlocked) {
      await Linking.openSettings();
    } else {
      setRequesting(true);
      try {
        await onRequest();
      } finally {
        setRequesting(false);
      }
    }
  };

  return (
    <Card
      style={{
        gap: 12,
        backgroundColor: `${colors.warning}12`,
        borderColor: `${colors.warning}35`,
        borderWidth: 1,
      }}
    >
      {/* Header row */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <Ionicons
          name="shield-outline"
          size={18}
          color={colors.warning}
          style={{ marginTop: 1 }}
        />
        <View style={{ flex: 1, gap: 3 }}>
          <Text
            style={{
              color: colors.foreground,
              fontFamily: "Inter_600SemiBold",
              fontSize: 13,
            }}
          >
            Bluetooth permission required
          </Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 12,
              lineHeight: 17,
            }}
          >
            {isBlocked
              ? "Permission was permanently denied. Open Settings → Permissions → Nearby devices and allow ReadyLoq."
              : "ReadyLoq needs Bluetooth permission to scan for and connect to nearby glasses."}
          </Text>
        </View>
      </View>

      {/* Action button */}
      <Pressable
        onPress={(): void => { void handlePress(); }}
        disabled={requesting}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          backgroundColor: colors.primary,
          borderRadius: colors.radius,
          paddingVertical: 10,
          opacity: pressed || requesting ? 0.7 : 1,
        })}
      >
        {requesting ? (
          <ActivityIndicator size="small" color={colors.primaryForeground} />
        ) : (
          <Ionicons
            name={isBlocked ? "settings-outline" : "shield-checkmark-outline"}
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
          {isBlocked ? "Open Settings" : "Grant Permissions"}
        </Text>
      </Pressable>
    </Card>
  );
}
