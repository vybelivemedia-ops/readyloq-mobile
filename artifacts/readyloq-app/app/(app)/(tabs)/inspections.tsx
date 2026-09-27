import { Ionicons } from "@expo/vector-icons";
import { getListInspectionsQueryOptions } from "@/lib/api-client";
import type { Inspection } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { type Href, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { DailyRouteSetupModal } from "@/components/DailyRouteSetupModal";
import { useDailyRoute } from "@/hooks/useDailyRoute";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";

import { InspectionDetail } from "@/components/InspectionDetail";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FullScreenLoader } from "@/components/ui/Loader";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import { useLocalInspections } from "@/hooks/useLocalInspections";
import { useWindowSizeClass } from "@/hooks/useWindowSizeClass";
import {
  formatDateTime,
  formatStatus,
  severityTone,
  statusTone,
} from "@/constants/inspection";
import { hasPendingWork, type LocalInspection, type LocalSyncPhase } from "@/lib/local/inspection-store";
import { syncNow } from "@/lib/sync/engine";
import { ActivityIndicator } from "react-native";

const FILTERS = [
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "In progress", value: "in_progress" },
  { label: "Completed", value: "completed" },
] as const;

export default function InspectionsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { sizeClass, isExpanded } = useWindowSizeClass();
  const [filter, setFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const {
    isSetupToday,
    assignmentCount,
    assignments,
    saveRoute,
    showSetupModal,
    openSetupModal,
    closeSetupModal,
  } = useDailyRoute();

  const { data, isLoading, isRefetching, refetch } = useQuery(
    getListInspectionsQueryOptions(),
  );

  // Device-local inspections that still have unsynced work (drafts to resume
  // or completed inspections waiting on connectivity). Shown above the server
  // list with live sync badges so nothing ever looks lost.
  const { records: localRecords, phaseOf } = useLocalInspections();
  // Show ALL local records — not just pending ones — so technicians can
  // always reach the inspection-summary screen (which has Share PDF) even
  // after an inspection has fully synced. The pendingServerIds dedup below
  // ensures completed+synced inspections don't appear twice in the list.
  const pendingLocal = useMemo(() => localRecords, [localRecords]);
  const pendingServerIds = useMemo(
    () => new Set(pendingLocal.map((r) => r.serverId).filter((id) => id != null)),
    [pendingLocal],
  );

  const items = useMemo(() => {
    // Hide server rows already represented by a pending local card above.
    const list = (data ?? []).filter((i) => !pendingServerIds.has(i.id));
    if (filter === "all") return list;
    return list.filter((i) => {
      const s = (i.status || "").toLowerCase().replace(/-/g, "_");
      if (filter === "open") return ["open", "draft", "pending"].includes(s);
      if (filter === "completed") return ["completed", "complete"].includes(s);
      return s === filter;
    });
  }, [data, filter, pendingServerIds]);

  // Expanded uses a narrow list pane beside the detail → keep 1 column there.
  const numColumns = sizeClass === "medium" ? 2 : 1;

  const openItem = (item: Inspection) => {
    if (isExpanded) setSelectedId(item.id);
    else router.push(`/inspection/${item.id}` as Href);
  };

  const openLocal = (rec: LocalInspection) => {
    if (!rec.completed) {
      router.push(`/new-inspection?resume=${rec.localId}` as Href);
    } else {
      router.push(`/inspection-summary/${rec.localId}` as Href);
    }
  };

  const localSection =
    pendingLocal.length > 0 ? (
      <View style={{ gap: 12, marginBottom: 12 }}>
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
          On this device
        </Text>
        {pendingLocal.map((rec) => (
          <LocalInspectionCard
            key={rec.localId}
            record={rec}
            phase={phaseOf(rec)}
            onPress={() => openLocal(rec)}
          />
        ))}
        {(data ?? []).length > 0 ? (
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
            All inspections
          </Text>
        ) : null}
      </View>
    ) : null;

  const renderItem = ({ item }: { item: Inspection }) => (
    <Card
      onPress={() => openItem(item)}
      style={[
        { gap: 10 },
        numColumns > 1 && { flex: 1 },
        isExpanded && selectedId === item.id && { borderColor: colors.primary },
      ]}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Text
          numberOfLines={1}
          style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 16, flex: 1 }}
        >
          {item.siteAddress}
        </Text>
        <Badge label={formatStatus(item.status)} tone={statusTone(item.status)} />
      </View>
      {item.clientName ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
          {item.clientName}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <Meta icon="camera-outline" text={`${item.mediaCount ?? 0}`} />
        <Meta icon="search-outline" text={`${item.findingsCount ?? 0} findings`} />
        <Meta icon="calendar-outline" text={formatDateTime(item.createdAt)} />
        {item.severity ? (
          <Badge label={formatStatus(item.severity)} tone={severityTone(item.severity)} />
        ) : null}
        {/* Signature status badge — completed inspections only */}
        {(item.status === "completed" || item.status === "complete") ? (
          item.signedAt
            ? <Badge label="Signed" tone="success" />
            : item.ownerNotAvailable
            ? <Badge label="Declined" tone="warning" />
            : <Badge label="Unsigned" tone="default" />
        ) : null}
      </View>
    </Card>
  );

  const listPane = (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 12,
        }}
      >
        <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 24 }}>
          Inspections
        </Text>
        <Pressable
          onPress={() => router.push("/new-inspection" as Href)}
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            backgroundColor: colors.primary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="add" size={26} color={colors.primaryForeground} />
        </Pressable>
      </View>

      {/* Daily rig banner */}
      {isSetupToday ? (
        <Pressable
          onPress={openSetupModal}
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginHorizontal: 16,
            marginBottom: 10,
            paddingHorizontal: 12,
            paddingVertical: 9,
            borderRadius: 10,
            backgroundColor: "rgba(23,196,211,0.10)",
            borderWidth: 1,
            borderColor: colors.primary + "44",
            gap: 8,
          }}
        >
          <Ionicons name="flask-outline" size={16} color={colors.primary} />
          <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13, flex: 1 }}>
            {assignmentCount} assignment{assignmentCount !== 1 ? "s" : ""} on today's route
          </Text>
          <Text style={{ color: colors.primary, fontFamily: "Inter_400Regular", fontSize: 12 }}>
            Change
          </Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={openSetupModal}
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginHorizontal: 16,
            marginBottom: 10,
            paddingHorizontal: 12,
            paddingVertical: 9,
            borderRadius: 10,
            backgroundColor: "rgba(245,158,11,0.08)",
            borderWidth: 1,
            borderColor: "#f59e0b44",
            gap: 8,
          }}
        >
          <Ionicons name="flask-outline" size={16} color="#f59e0b" />
          <Text style={{ color: "#f59e0b", fontFamily: "Inter_600SemiBold", fontSize: 13, flex: 1 }}>
            Set up today's rig
          </Text>
          <Ionicons name="chevron-forward" size={14} color="#f59e0b" />
        </Pressable>
      )}

      {/* Filter chips */}
      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 12, flexWrap: "wrap" }}>
        {FILTERS.map((f) => {
          const active = filter === f.value;
          return (
            <Pressable
              key={f.value}
              onPress={() => {
                setFilter(f.value);
                setSelectedId(null);
              }}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor: active ? colors.primary : colors.card,
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
              }}
            >
              <Text
                style={{
                  color: active ? colors.primaryForeground : colors.mutedForeground,
                  fontFamily: "Inter_500Medium",
                  fontSize: 13,
                }}
              >
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {isLoading ? (
        <FullScreenLoader />
      ) : (
        <FlatList
          key={`cols-${numColumns}`}
          data={items}
          keyExtractor={(i) => String(i.id)}
          renderItem={renderItem}
          numColumns={numColumns}
          columnWrapperStyle={numColumns > 1 ? { gap: 12 } : undefined}
          contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 12, flexGrow: 1 }}
          ListHeaderComponent={localSection}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="clipboard-outline"
              title="No inspections yet"
              subtitle="Start a new AI inspection to capture evidence and generate findings."
              actionLabel="New inspection"
              onAction={() => router.push("/new-inspection" as Href)}
            />
          }
        />
      )}
    </View>
  );

  // ── Daily route setup modal (accessible from the inspections tab) ─────────
  const rigSetupModal = (
    <DailyRouteSetupModal
      visible={showSetupModal}
      initialAssignments={assignments}
      onClose={closeSetupModal}
      onSave={(newAssignments) => {
        void saveRoute(newAssignments);
        closeSetupModal();
      }}
    />
  );

  if (isExpanded) {
    return (
      <Screen>
        <View style={{ flex: 1, flexDirection: "row" }}>
          <View style={{ width: 400, borderRightWidth: 1, borderRightColor: colors.border }}>
            {listPane}
          </View>
          <View style={{ flex: 1 }}>
            {selectedId != null ? (
              <InspectionDetail key={selectedId} id={selectedId} embedded />
            ) : (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }}>
                <Ionicons name="clipboard-outline" size={40} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 15 }}>
                  Select an inspection to view details
                </Text>
              </View>
            )}
          </View>
        </View>
        {rigSetupModal}
      </Screen>
    );
  }

  return <Screen>{listPane}{rigSetupModal}</Screen>;
}

/**
 * Card for an inspection that lives (at least partly) on this device: an
 * unfinished draft to resume, or a completed inspection still syncing.
 * The badge reflects the live sync engine state.
 */
function LocalInspectionCard({
  record,
  phase,
  onPress,
}: {
  record: LocalInspection;
  phase: LocalSyncPhase;
  onPress: () => void;
}) {
  const colors = useColors();

  const badge = !record.completed
    ? { label: "Draft — tap to resume", color: colors.mutedForeground, spinner: false }
    : phase === "syncing"
      ? { label: "Syncing…", color: colors.primary, spinner: true }
      : phase === "waiting"
        ? { label: "Waiting to sync", color: colors.mutedForeground, spinner: false }
        : phase === "failed"
          ? { label: "Sync failed — will retry", color: colors.destructive, spinner: false }
          : { label: "Synced", color: colors.primary, spinner: false };

  return (
    <Card onPress={onPress} style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Text
          numberOfLines={1}
          style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 16, flex: 1 }}
        >
          {record.siteAddress || "Untitled inspection"}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {badge.spinner ? (
            <ActivityIndicator size="small" color={badge.color} />
          ) : (
            <Ionicons
              name={
                !record.completed
                  ? "create-outline"
                  : phase === "failed"
                    ? "alert-circle-outline"
                    : phase === "synced"
                      ? "cloud-done-outline"
                      : "cloud-offline-outline"
              }
              size={15}
              color={badge.color}
            />
          )}
          <Text style={{ color: badge.color, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
            {badge.label}
          </Text>
        </View>
      </View>
      {phase === "failed" && !!record.syncError && (
        <Text
          numberOfLines={2}
          style={{
            color: colors.destructive,
            fontFamily: "Inter_400Regular",
            fontSize: 11,
            opacity: 0.8,
          }}
        >
          {record.syncError}
        </Text>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <Meta icon="camera-outline" text={`${record.photos.length}`} />
        <Meta icon="calendar-outline" text={formatDateTime(record.createdAt)} />
        {record.completed && phase === "failed" ? (
          <Pressable
            onPress={() => void syncNow(record.localId).catch(() => {})}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 999,
              backgroundColor: colors.primary,
            }}
          >
            <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 11 }}>
              Retry now
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

function Meta({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Ionicons name={icon} size={14} color={colors.mutedForeground} />
      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
        {text}
      </Text>
    </View>
  );
}
