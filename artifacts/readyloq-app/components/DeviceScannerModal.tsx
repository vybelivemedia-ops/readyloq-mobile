/**
 * DeviceScannerModal — generic BLE sensor scan / connect sheet.
 *
 * Opens a bottom sheet, starts a BLE scan for devices matching the caller's
 * service UUIDs and name patterns, lists discovered devices, and lets the
 * technician tap one to connect.
 *
 * The modal is provider-agnostic: callers supply serviceUUIDs, namePatterns,
 * and an onConnect callback that receives the selected device ID and name.
 * The concrete provider (moisture, laser, etc.) calls setPairedDevice + connect
 * in the onConnect handler.
 *
 * Usage:
 *   <DeviceScannerModal
 *     visible={showMoistureScanner}
 *     title="Connect Moisture Meter"
 *     description="Place your Protimeter near the phone before scanning."
 *     serviceUUIDs={[PROTIMETER_SERVICE_UUID, ESS_SERVICE_UUID]}
 *     namePatterns={["Protimeter", "PTM"]}
 *     onConnect={async (device) => { provider.setPairedDevice(device.id, device.name); await provider.connect(); }}
 *     onClose={() => setShowMoistureScanner(false)}
 *   />
 */

import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { BleSensorAdapter, type DiscoveredSensor } from "@/lib/ble/ble-sensor-adapter";
import { getSensorBleManager } from "@/lib/ble/ble-sensor-manager";

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** BLE service UUIDs to filter scan results by (empty = all devices). */
  serviceUUIDs: string[];
  /** Device name substrings to filter by (empty = accept all). */
  namePatterns: string[];
  /** Called when the user taps a discovered device. Throw to surface an error. */
  onConnect: (device: DiscoveredSensor) => Promise<void>;
}

// ─── RSSI quality helper ──────────────────────────────────────────────────────

function rssiLabel(rssi: number): { label: string; color: string } {
  if (rssi >= -60) return { label: "Excellent", color: "#22c55e" };
  if (rssi >= -75) return { label: "Good",      color: "#86efac" };
  if (rssi >= -85) return { label: "Fair",      color: "#f59e0b" };
  return               { label: "Weak",      color: "#ef4444" };
}

// ─── Discovered device row ────────────────────────────────────────────────────

function DeviceRow({
  device,
  onPress,
  connecting,
}: {
  device: DiscoveredSensor;
  onPress: () => void;
  connecting: boolean;
}) {
  const sig = rssiLabel(device.rssi);
  return (
    <Pressable
      onPress={onPress}
      disabled={connecting}
      style={({ pressed }) => [
        styles.row,
        pressed && { backgroundColor: "rgba(255,255,255,0.05)" },
      ]}
    >
      <View style={styles.rowIcon}>
        <Ionicons name="bluetooth" size={18} color="#6366f1" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName} numberOfLines={1}>
          {device.name}
        </Text>
        <Text style={[styles.rowSignal, { color: sig.color }]}>{sig.label}</Text>
      </View>
      {connecting ? (
        <ActivityIndicator size="small" color="#6366f1" />
      ) : (
        <Ionicons name="chevron-forward" size={16} color="#6b7280" />
      )}
    </Pressable>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export function DeviceScannerModal({
  visible,
  onClose,
  title,
  description,
  serviceUUIDs,
  namePatterns,
  onConnect,
}: Props) {
  const [discovered, setDiscovered] = useState<DiscoveredSensor[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const adapterRef = useRef<BleSensorAdapter | null>(null);
  const stopScanRef = useRef<(() => void) | null>(null);

  // ── Scan lifecycle ──────────────────────────────────────────────────────────

  const startScan = useCallback(() => {
    setDiscovered([]);
    setError(null);
    setScanning(true);

    if (!adapterRef.current) {
      adapterRef.current = new BleSensorAdapter(
        getSensorBleManager(),
        serviceUUIDs,
        namePatterns,
      );
    }

    const stop = adapterRef.current.scan((sensor) => {
      setDiscovered((prev) => {
        if (prev.some((d) => d.id === sensor.id)) return prev;
        return [...prev, sensor].sort((a, b) => b.rssi - a.rssi);
      });
    }, 15_000);

    stopScanRef.current = () => {
      stop();
      setScanning(false);
    };

    // Auto-stop after 15 s (adapter stops internally; just update state)
    setTimeout(() => setScanning(false), 15_100);
  }, [serviceUUIDs, namePatterns]);

  const stopScan = useCallback(() => {
    stopScanRef.current?.();
    stopScanRef.current = null;
    setScanning(false);
  }, []);

  // Start scanning as soon as the modal opens
  useEffect(() => {
    if (visible) {
      startScan();
    } else {
      stopScan();
      setDiscovered([]);
      setConnectingId(null);
      setError(null);
    }
    // Cleanup on unmount
    return () => { stopScan(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // ── Connect ─────────────────────────────────────────────────────────────────

  const handleConnect = useCallback(
    async (device: DiscoveredSensor) => {
      stopScan();
      setConnectingId(device.id);
      setError(null);
      try {
        await onConnect(device);
        onClose();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Connection failed.";
        setError(msg);
        Alert.alert("Connection failed", msg, [{ text: "OK" }]);
      } finally {
        setConnectingId(null);
      }
    },
    [onConnect, onClose, stopScan],
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet}>
          {/* Handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{title}</Text>
              {description && (
                <Text style={styles.description}>{description}</Text>
              )}
            </View>
            <Pressable onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color="#9ca3af" />
            </Pressable>
          </View>

          {/* Scan status */}
          <View style={styles.statusRow}>
            {scanning ? (
              <>
                <ActivityIndicator size="small" color="#6366f1" />
                <Text style={styles.statusText}>Scanning for nearby devices…</Text>
              </>
            ) : (
              <>
                <Ionicons name="search-outline" size={14} color="#6b7280" />
                <Text style={styles.statusText}>
                  {discovered.length > 0
                    ? `${discovered.length} device${discovered.length !== 1 ? "s" : ""} found`
                    : "No devices found"}
                </Text>
                <Pressable onPress={startScan} style={styles.rescanBtn}>
                  <Text style={styles.rescanText}>Scan again</Text>
                </Pressable>
              </>
            )}
          </View>

          {/* Error */}
          {error && (
            <View style={styles.errorBanner}>
              <Ionicons name="warning-outline" size={14} color="#ef4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Device list */}
          <FlatList
            data={discovered}
            keyExtractor={(d) => d.id}
            style={{ maxHeight: 320 }}
            contentContainerStyle={{ gap: 4, paddingBottom: 8 }}
            renderItem={({ item }) => (
              <DeviceRow
                device={item}
                connecting={connectingId === item.id}
                onPress={() => void handleConnect(item)}
              />
            )}
            ListEmptyComponent={
              scanning ? null : (
                <View style={styles.emptyState}>
                  <Ionicons name="bluetooth-outline" size={32} color="#374151" />
                  <Text style={styles.emptyText}>
                    Make sure the device is powered on and within range.
                  </Text>
                </View>
              )
            }
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#111318",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingBottom: 40,
    gap: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#374151",
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  title: {
    color: "#f9fafb",
    fontFamily: "Inter_700Bold",
    fontSize: 18,
  },
  description: {
    color: "#6b7280",
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    marginTop: 3,
    lineHeight: 18,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
  },
  statusText: {
    color: "#6b7280",
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    flex: 1,
  },
  rescanBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: "rgba(99,102,241,0.12)",
  },
  rescanText: {
    color: "#818cf8",
    fontFamily: "Inter_500Medium",
    fontSize: 12,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(239,68,68,0.1)",
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.2)",
  },
  errorText: {
    color: "#ef4444",
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    flex: 1,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(99,102,241,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  rowName: {
    color: "#f3f4f6",
    fontFamily: "Inter_500Medium",
    fontSize: 14,
  },
  rowSignal: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    marginTop: 1,
  },
  emptyState: {
    alignItems: "center",
    gap: 10,
    paddingVertical: 32,
  },
  emptyText: {
    color: "#6b7280",
    fontFamily: "Inter_400Regular",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
});
