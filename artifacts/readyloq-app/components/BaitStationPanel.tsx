import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  TextInput,
  Modal,
  ScrollView,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

export interface BaitStation {
  id: string;
  label: string;
  locationType?: string;
  status: "active" | "missing" | "damaged" | "removed";
  notes?: string;
  lastCheckedAt?: string;
}

const STATUS_COLORS: Record<BaitStation["status"], string> = {
  active: "#22c55e",
  missing: "#ef4444",
  damaged: "#f59e0b",
  removed: "#6b7280",
};

const STATUS_ICONS: Record<BaitStation["status"], keyof typeof Ionicons.glyphMap> = {
  active: "checkmark-circle",
  missing: "alert-circle",
  damaged: "warning",
  removed: "remove-circle",
};

interface Props {
  stations: BaitStation[];
  onAdd: (station: Omit<BaitStation, "id">) => void;
  onUpdate: (id: string, update: Partial<BaitStation>) => void;
  onRemove: (id: string) => void;
}

export function BaitStationPanel({ stations, onAdd, onUpdate, onRemove }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newLocation, setNewLocation] = useState("");

  function handleAdd() {
    if (!newLabel.trim()) return;
    onAdd({
      label: newLabel.trim(),
      locationType: newLocation.trim() || undefined,
      status: "active",
      lastCheckedAt: new Date().toISOString(),
    });
    setNewLabel("");
    setNewLocation("");
    setShowAdd(false);
  }

  function cycleStatus(station: BaitStation) {
    const cycle: BaitStation["status"][] = ["active", "missing", "damaged", "removed"];
    const next = cycle[(cycle.indexOf(station.status) + 1) % cycle.length];
    onUpdate(station.id, { status: next, lastCheckedAt: new Date().toISOString() });
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Bait Stations</Text>
        <Pressable onPress={() => setShowAdd(true)} style={styles.addBtn}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.addBtnText}>Add</Text>
        </Pressable>
      </View>

      {stations.length === 0 ? (
        <Text style={styles.empty}>No bait stations logged yet</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.list}>
          {stations.map((s) => (
            <Pressable key={s.id} onPress={() => cycleStatus(s)} style={styles.stationCard}>
              <Ionicons
                name={STATUS_ICONS[s.status]}
                size={20}
                color={STATUS_COLORS[s.status]}
              />
              <Text style={styles.stationLabel}>{s.label}</Text>
              {s.locationType ? (
                <Text style={styles.stationLocation}>{s.locationType}</Text>
              ) : null}
              <Text style={[styles.stationStatus, { color: STATUS_COLORS[s.status] }]}>
                {s.status.toUpperCase()}
              </Text>
              <Pressable
                onPress={() => onRemove(s.id)}
                style={styles.removeBtn}
                hitSlop={8}
              >
                <Ionicons name="close" size={12} color="#6b7280" />
              </Pressable>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShowAdd(false)}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Add Bait Station</Text>
            <TextInput
              style={styles.input}
              placeholder="Label (e.g. Station A, North Wall)"
              placeholderTextColor="#9ca3af"
              value={newLabel}
              onChangeText={setNewLabel}
              autoFocus
            />
            <TextInput
              style={styles.input}
              placeholder="Location (e.g. exterior, kitchen)"
              placeholderTextColor="#9ca3af"
              value={newLocation}
              onChangeText={setNewLocation}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setShowAdd(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={handleAdd}
                style={[styles.confirmBtn, !newLabel.trim() && { opacity: 0.4 }]}
                disabled={!newLabel.trim()}
              >
                <Text style={styles.confirmText}>Add Station</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingVertical: 8 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, marginBottom: 8 },
  title: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#17c4d3", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  addBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 12 },
  empty: { color: "#6b7280", fontFamily: "Inter_400Regular", fontSize: 13, paddingHorizontal: 16 },
  list: { paddingHorizontal: 16 },
  stationCard: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 10, padding: 10, marginRight: 8, minWidth: 90, alignItems: "center", gap: 4, position: "relative" },
  stationLabel: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 12, textAlign: "center" },
  stationLocation: { color: "#9ca3af", fontFamily: "Inter_400Regular", fontSize: 10, textAlign: "center" },
  stationStatus: { fontFamily: "Inter_700Bold", fontSize: 9, letterSpacing: 0.5 },
  removeBtn: { position: "absolute", top: 4, right: 4 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modal: { backgroundColor: "#1c1c1e", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 12 },
  modalTitle: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 17, marginBottom: 4 },
  input: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, color: "#fff", fontFamily: "Inter_400Regular", fontSize: 15 },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 4 },
  cancelBtn: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: 10, backgroundColor: "rgba(255,255,255,0.06)" },
  cancelText: { color: "#9ca3af", fontFamily: "Inter_600SemiBold", fontSize: 15 },
  confirmBtn: { flex: 2, paddingVertical: 12, alignItems: "center", borderRadius: 10, backgroundColor: "#17c4d3" },
  confirmText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 15 },
});
