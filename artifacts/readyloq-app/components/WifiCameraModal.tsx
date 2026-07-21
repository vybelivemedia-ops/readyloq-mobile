import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  configureWifiCamera,
  probeWifiCamera,
  getWifiCameraConfig,
  clearWifiCameraConfig,
} from "@/lib/vision/wifi-camera-provider";

interface Props {
  visible: boolean;
  onClose: () => void;
  onConnected: () => void;
}

const PRESETS = [
  { label: "GoPro", url: "http://10.5.5.9", icon: "camera" },
  { label: "Custom", url: "", icon: "wifi" },
];

export function WifiCameraModal({ visible, onClose, onConnected }: Props) {
  const existing = getWifiCameraConfig();
  const [url, setUrl] = useState(existing?.baseUrl ?? "http://");
  const [label, setLabel] = useState(existing?.label ?? "Wi-Fi camera");
  const [probing, setProbing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    if (!url.trim()) return;
    setProbing(true);
    setError(null);
    configureWifiCamera({ baseUrl: url.trim(), label: label.trim() || "Wi-Fi camera" });
    const result = await probeWifiCamera();
    setProbing(false);
    if (result.available) {
      onConnected();
      onClose();
    } else {
      setError(result.reason ?? "Could not reach camera.");
      clearWifiCameraConfig();
    }
  }

  function applyPreset(preset: (typeof PRESETS)[0]) {
    if (preset.url) setUrl(preset.url);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Connect Wi-Fi Camera</Text>
          <Text style={styles.subtitle}>
            Connect to a GoPro, IP camera, or any device serving JPEG stills over your local Wi-Fi.
          </Text>

          <View style={styles.presets}>
            {PRESETS.map((p) => (
              <Pressable key={p.label} onPress={() => applyPreset(p)} style={styles.presetChip}>
                <Ionicons name={p.icon as any} size={14} color="#17c4d3" />
                <Text style={styles.presetLabel}>{p.label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Camera URL or IP</Text>
          <TextInput
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            placeholder="http://10.5.5.9"
            placeholderTextColor="#6b7280"
            autoCapitalize="none"
            keyboardType="url"
            autoCorrect={false}
          />

          <Text style={styles.fieldLabel}>Label (optional)</Text>
          <TextInput
            style={styles.input}
            value={label}
            onChangeText={setLabel}
            placeholder="GoPro Hero 13"
            placeholderTextColor="#6b7280"
          />

          {error ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={16} color="#ef4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={handleConnect}
            disabled={probing || !url.trim()}
            style={[styles.connectBtn, (probing || !url.trim()) && { opacity: 0.5 }]}
          >
            {probing ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons name="wifi" size={18} color="#fff" />
            )}
            <Text style={styles.connectText}>
              {probing ? "Connecting…" : "Test & Connect"}
            </Text>
          </Pressable>

          <Text style={styles.hint}>
            Make sure your phone is connected to the same Wi-Fi network as the camera.
          </Text>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#1c1c1e", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 12, paddingBottom: 40 },
  handle: { width: 36, height: 4, backgroundColor: "#3f3f3f", borderRadius: 2, alignSelf: "center", marginBottom: 8 },
  title: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 20 },
  subtitle: { color: "#9ca3af", fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 },
  presets: { flexDirection: "row", gap: 8, marginVertical: 4 },
  presetChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(23,196,211,0.12)", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: "#17c4d3" },
  presetLabel: { color: "#17c4d3", fontFamily: "Inter_600SemiBold", fontSize: 13 },
  fieldLabel: { color: "#9ca3af", fontFamily: "Inter_600SemiBold", fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase" },
  input: { backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: "#fff", fontFamily: "Inter_400Regular", fontSize: 15 },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(239,68,68,0.1)", padding: 12, borderRadius: 10 },
  errorText: { color: "#ef4444", fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 },
  connectBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: "#17c4d3", borderRadius: 12, paddingVertical: 14, marginTop: 4 },
  connectText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 16 },
  hint: { color: "#6b7280", fontFamily: "Inter_400Regular", fontSize: 12, textAlign: "center", lineHeight: 16 },
});
