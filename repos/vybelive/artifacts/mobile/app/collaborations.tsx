import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/ui/Avatar";
import { CalendarPicker } from "@/components/ui/CalendarPicker";
import { useColors } from "@/hooks/useColors";
import {
  useListIncomingCollaborations,
  useListOutgoingCollaborations,
  useListConfirmedCollaborations,
  useUpdateCollaborationStatus,
  getListIncomingCollaborationsQueryKey,
  getListOutgoingCollaborationsQueryKey,
  getListConfirmedCollaborationsQueryKey,
} from "@workspace/api-client-react";
import type {
  CollaborationRequest,
  CollaborationRequestType,
  CollaborationRequestStatus,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

type Tab = "incoming" | "outgoing" | "confirmed";

const TYPE_LABELS: Record<CollaborationRequestType, string> = {
  co_stream: "Co-stream",
  joint_podcast: "Joint podcast",
  event: "Event",
  other: "Collaboration",
};

const STATUS_COLORS: Record<CollaborationRequestStatus, string> = {
  pending: "#FFB020",
  accepted: "#00E0A4",
  declined: "#FF453A",
  scheduled: "#00D4FF",
  cancelled: "#888888",
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function CollaborationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("incoming");

  const incoming = useListIncomingCollaborations();
  const outgoing = useListOutgoingCollaborations();
  const confirmed = useListConfirmedCollaborations();
  const updateMut = useUpdateCollaborationStatus();

  const [actingId, setActingId] = useState<string | null>(null);
  const [scheduleId, setScheduleId] = useState<string | null>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const refreshAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListIncomingCollaborationsQueryKey() }),
      qc.invalidateQueries({ queryKey: getListOutgoingCollaborationsQueryKey() }),
      qc.invalidateQueries({ queryKey: getListConfirmedCollaborationsQueryKey() }),
    ]);
  };

  const act = async (
    id: string,
    action: "accept" | "decline" | "cancel" | "schedule",
    scheduledAt?: string,
  ) => {
    setActingId(id);
    try {
      await updateMut.mutateAsync({
        collaborationId: id,
        data: { action, ...(scheduledAt ? { scheduledAt } : {}) },
      });
      setScheduleId(null);
      await refreshAll();
    } catch {
      // best-effort; lists re-sync on next refetch
    } finally {
      setActingId(null);
    }
  };

  const current =
    tab === "incoming" ? incoming : tab === "outgoing" ? outgoing : confirmed;
  const items: CollaborationRequest[] = current.data?.items ?? [];

  const renderItem = (item: CollaborationRequest) => {
    const other = item.direction === "incoming" ? item.fromUser : item.toUser;
    const busy = actingId === item.id;
    const canRespond = tab === "incoming" && item.status === "pending";
    const canCancel =
      tab === "outgoing" && (item.status === "pending" || item.status === "scheduled");

    return (
      <View
        key={item.id}
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <TouchableOpacity
          style={styles.cardHeader}
          onPress={() => router.push(`/creator/${other.id}` as never)}
          activeOpacity={0.7}
        >
          <Avatar uri={other.avatarUrl} name={other.displayName} size={44} />
          <View style={styles.cardHeaderText}>
            <Text style={[styles.cardName, { color: colors.foreground }]} numberOfLines={1}>
              {other.displayName}
            </Text>
            <Text style={[styles.cardUsername, { color: colors.mutedForeground }]} numberOfLines={1}>
              @{other.username}
            </Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: STATUS_COLORS[item.status] + "22" }]}>
            <Text style={[styles.statusText, { color: STATUS_COLORS[item.status] }]}>
              {item.status}
            </Text>
          </View>
        </TouchableOpacity>

        <View style={styles.typeRow}>
          <View style={[styles.typeChip, { backgroundColor: colors.primary + "18" }]}>
            <Text style={[styles.typeChipText, { color: colors.primary }]}>
              {TYPE_LABELS[item.type]}
            </Text>
          </View>
          {item.scheduledAt ? (
            <View style={styles.scheduledRow}>
              <Feather name="calendar" size={12} color={colors.cyan} />
              <Text style={[styles.scheduledText, { color: colors.cyan }]}>
                {formatDateTime(item.scheduledAt)}
              </Text>
            </View>
          ) : null}
        </View>

        <Text style={[styles.message, { color: colors.secondaryForeground }]}>{item.message}</Text>

        {canRespond ? (
          <View style={styles.actionRow}>
            <TouchableOpacity
              onPress={() => act(item.id, "decline")}
              disabled={busy}
              style={[styles.btn, styles.btnGhost, { borderColor: colors.border }]}
            >
              <Text style={[styles.btnText, { color: colors.foreground }]}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setScheduleId(item.id)}
              disabled={busy}
              style={[styles.btn, styles.btnGhost, { borderColor: colors.cyan }]}
            >
              <Feather name="calendar" size={14} color={colors.cyan} />
              <Text style={[styles.btnText, { color: colors.cyan }]}>Schedule</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => act(item.id, "accept")}
              disabled={busy}
              style={[styles.btn, { backgroundColor: colors.primary }]}
            >
              {busy ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Text style={[styles.btnText, { color: "#FFF" }]}>Accept</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}

        {canCancel ? (
          <View style={styles.actionRow}>
            <TouchableOpacity
              onPress={() => act(item.id, "cancel")}
              disabled={busy}
              style={[styles.btn, styles.btnGhost, { borderColor: colors.border }]}
            >
              {busy ? (
                <ActivityIndicator color={colors.foreground} size="small" />
              ) : (
                <Text style={[styles.btnText, { color: colors.mutedForeground }]}>Cancel request</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Collaborations</Text>
        <View style={styles.backBtn} />
      </View>

      <View style={[styles.tabs, { borderColor: colors.border }]}>
        {(["incoming", "outgoing", "confirmed"] as Tab[]).map((t) => {
          const active = tab === t;
          return (
            <TouchableOpacity
              key={t}
              onPress={() => setTab(t)}
              style={[styles.tab, active ? { borderBottomColor: colors.primary } : { borderBottomColor: "transparent" }]}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: active ? colors.primary : colors.mutedForeground },
                ]}
              >
                {t === "incoming" ? "Incoming" : t === "outgoing" ? "Sent" : "Confirmed"}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: bottomPad + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {current.isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.center}>
            <Feather name="users" size={36} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {tab === "incoming"
                ? "No incoming collaboration requests."
                : tab === "outgoing"
                  ? "You haven't sent any requests yet."
                  : "No confirmed collaborations yet."}
            </Text>
          </View>
        ) : (
          items.map(renderItem)
        )}
      </ScrollView>

      <CalendarPicker
        visible={scheduleId !== null}
        onCancel={() => setScheduleId(null)}
        onConfirm={(date) => {
          const id = scheduleId;
          setScheduleId(null);
          if (id) act(id, "schedule", date.toISOString());
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  tabs: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, alignItems: "center", paddingVertical: 12, borderBottomWidth: 2 },
  tabText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  list: { padding: 16, gap: 12 },
  center: { alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 80 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 32 },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 12 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  cardHeaderText: { flex: 1 },
  cardName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cardUsername: { fontSize: 12, fontFamily: "Inter_400Regular" },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "capitalize" },
  typeRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  typeChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  typeChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  scheduledRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  scheduledText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  message: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  actionRow: { flexDirection: "row", gap: 8 },
  btn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
  },
  btnGhost: { borderWidth: 1 },
  btnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
