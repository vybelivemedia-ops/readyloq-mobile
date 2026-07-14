/**
 * Executive Approvals screen — founder-facing approval queue for high-impact
 * recommendations raised by the AI executive team (Mission Control).
 *
 * Lists pending approvals with title, detail, impact, and originating executive,
 * and lets the founder Approve / Reject / Later. Decisions hit the shared
 * `POST /api/mission-control/approvals/:id/decision` endpoint, which finalizes the
 * owning objective server-side exactly as the Mission Control web app does — no
 * backend changes. A "Recently decided" section keeps short-term history visible.
 */

import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useFocusEffect } from "expo-router/build/useFocusEffect";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import { useColors } from "@/hooks/useColors";
import {
  useListApprovals,
  useDecideApproval,
  getListApprovalsQueryKey,
} from "@workspace/api-client-react";
import type { AgentApproval } from "@workspace/api-client-react";

type Decision = "approve" | "reject" | "later";

const STATUS_META: Record<
  string,
  { label: string; color: string }
> = {
  pending: { label: "Pending", color: "#7B61FF" },
  approved: { label: "Approved", color: "#39FF14" },
  rejected: { label: "Rejected", color: "#FF453A" },
  deferred: { label: "Deferred", color: "#FFD700" },
};

function impactColor(impact: string): string {
  const v = impact.toLowerCase();
  if (v.includes("high") || v.includes("critical")) return "#FF453A";
  if (v.includes("med")) return "#FFD700";
  if (v.includes("low")) return "#39FF14";
  return "#5C5C7A";
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return "just now";
  const min = Math.round(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function getErrorMessage(err: unknown): string {
  const data = (err as { response?: { data?: { error?: string } } })?.response?.data;
  if (data?.error) return data.error;
  return err instanceof Error ? err.message : "Something went wrong";
}

// ─── Approval card ─────────────────────────────────────────────────────────────

interface ApprovalCardProps {
  approval: AgentApproval;
  busyDecision: Decision | null;
  onDecide: (approval: AgentApproval, decision: Decision) => void;
}

function ApprovalCard({ approval, busyDecision, onDecide }: ApprovalCardProps) {
  const colors = useColors();
  const isPending = approval.status === "pending";
  const status = STATUS_META[approval.status] ?? STATUS_META.pending;
  const busy = busyDecision !== null;

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleWrap}>
          <Feather name="shield" size={15} color={colors.primary} />
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>{approval.title}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: status.color + "22" }]}>
          <Text style={[styles.statusBadgeText, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>

      <Text style={[styles.cardDetail, { color: colors.secondaryForeground }]}>
        {approval.detail}
      </Text>

      <View style={styles.metaRow}>
        <Feather name="user" size={12} color={colors.mutedForeground} />
        <Text style={[styles.metaText, { color: colors.mutedForeground }]} numberOfLines={1}>
          {approval.executiveName}
        </Text>
        <View style={[styles.impactPill, { backgroundColor: impactColor(approval.impact) + "22" }]}>
          <Text style={[styles.impactText, { color: impactColor(approval.impact) }]}>
            {approval.impact}
          </Text>
        </View>
      </View>

      {isPending ? (
        <View style={styles.actions}>
          <TouchableOpacity
            onPress={() => onDecide(approval, "approve")}
            disabled={busy}
            style={[
              styles.primaryAction,
              { backgroundColor: colors.neonGreen, opacity: busy && busyDecision !== "approve" ? 0.4 : 1 },
            ]}
          >
            {busyDecision === "approve" ? (
              <ActivityIndicator size="small" color="#06210A" />
            ) : (
              <>
                <Feather name="check" size={15} color="#06210A" />
                <Text style={[styles.primaryActionText, { color: "#06210A" }]}>Approve</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => onDecide(approval, "reject")}
            disabled={busy}
            style={[
              styles.secondaryAction,
              {
                backgroundColor: colors.destructive + "1A",
                borderColor: colors.destructive + "55",
                opacity: busy && busyDecision !== "reject" ? 0.4 : 1,
              },
            ]}
          >
            {busyDecision === "reject" ? (
              <ActivityIndicator size="small" color={colors.destructive} />
            ) : (
              <>
                <Feather name="x" size={15} color={colors.destructive} />
                <Text style={[styles.secondaryActionText, { color: colors.destructive }]}>Reject</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => onDecide(approval, "later")}
            disabled={busy}
            style={[
              styles.ghostAction,
              { borderColor: colors.border, opacity: busy && busyDecision !== "later" ? 0.4 : 1 },
            ]}
          >
            {busyDecision === "later" ? (
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            ) : (
              <>
                <Feather name="clock" size={15} color={colors.mutedForeground} />
                <Text style={[styles.ghostActionText, { color: colors.mutedForeground }]}>Later</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : approval.decidedAt ? (
        <Text style={[styles.decidedText, { color: colors.mutedForeground }]}>
          Decided {formatRelative(approval.decidedAt)}
        </Text>
      ) : null}
    </View>
  );
}

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function ApprovalsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const {
    data: pendingData,
    isLoading,
    refetch: refetchPending,
  } = useListApprovals(
    { status: "pending" },
    { query: { queryKey: getListApprovalsQueryKey({ status: "pending" }), refetchInterval: 8000 } },
  );
  const { data: decidedData, refetch: refetchDecided } = useListApprovals(
    { status: "approved" },
    { query: { queryKey: getListApprovalsQueryKey({ status: "approved" }) } },
  );

  const decide = useDecideApproval();

  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<{ id: string; decision: Decision } | null>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const refetchAll = useCallback(async () => {
    await Promise.all([refetchPending(), refetchDecided()]);
  }, [refetchPending, refetchDecided]);

  useFocusEffect(
    useCallback(() => {
      refetchAll();
    }, [refetchAll]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetchAll();
    setRefreshing(false);
  }, [refetchAll]);

  const handleDecide = useCallback(
    (approval: AgentApproval, decision: Decision) => {
      setBusy({ id: approval.id, decision });
      decide.mutate(
        { approvalId: approval.id, data: { decision } },
        {
          onSuccess: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            queryClient.invalidateQueries({ queryKey: ["/api/mission-control/approvals"] });
          },
          onError: (err) => {
            Alert.alert("Could not save decision", getErrorMessage(err));
          },
          onSettled: () => {
            setBusy(null);
          },
        },
      );
    },
    [decide, queryClient],
  );

  const pending = pendingData ?? [];
  const decided = (decidedData ?? []).slice(0, 10);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 12, paddingBottom: bottomPad + 32 },
      ]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground }]}>Approvals</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            High-impact calls from your executive team
          </Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : pending.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.neonGreen + "1A" }]}>
            <Feather name="check-circle" size={26} color={colors.neonGreen} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>All caught up</Text>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            No recommendations are waiting on your approval right now.
          </Text>
        </View>
      ) : (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            AWAITING YOUR APPROVAL ({pending.length})
          </Text>
          {pending.map((a) => (
            <ApprovalCard
              key={a.id}
              approval={a}
              busyDecision={busy?.id === a.id ? busy.decision : null}
              onDecide={handleDecide}
            />
          ))}
        </View>
      )}

      {decided.length > 0 && (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            RECENTLY DECIDED
          </Text>
          {decided.map((a) => (
            <ApprovalCard
              key={a.id}
              approval={a}
              busyDecision={null}
              onDecide={handleDecide}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 20 },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -8,
  },
  title: { fontSize: 24, fontFamily: "Inter_700Bold", letterSpacing: -0.3 },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 1 },
  loadingWrap: { paddingVertical: 48, alignItems: "center" },
  section: { gap: 12 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  cardTitleWrap: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_700Bold", flex: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  cardDetail: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 21 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontSize: 12, fontFamily: "Inter_500Medium", flexShrink: 1 },
  impactPill: { marginLeft: "auto", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  impactText: { fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.5 },
  actions: { flexDirection: "row", gap: 8, marginTop: 2 },
  primaryAction: {
    flex: 1.4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 11,
    borderRadius: 12,
  },
  primaryActionText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  secondaryAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
  },
  secondaryActionText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  ghostAction: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  ghostActionText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  decidedText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  emptyCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
    gap: 10,
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 19 },
});
