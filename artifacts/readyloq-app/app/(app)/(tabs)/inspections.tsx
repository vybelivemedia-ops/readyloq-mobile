import { Ionicons } from "@expo/vector-icons";
import { getListInspectionsQueryOptions } from "@/lib/api-client";
import type { Inspection } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { type Href, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";

import { InspectionDetail } from "@/components/InspectionDetail";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FullScreenLoader } from "@/components/ui/Loader";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import { useWindowSizeClass } from "@/hooks/useWindowSizeClass";
import {
  formatDate,
  formatStatus,
  severityTone,
  statusTone,
} from "@/constants/inspection";

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

  const { data, isLoading, isRefetching, refetch } = useQuery(
    getListInspectionsQueryOptions(),
  );

  const items = useMemo(() => {
    const list = data ?? [];
    if (filter === "all") return list;
    return list.filter((i) => {
      const s = (i.status || "").toLowerCase().replace(/-/g, "_");
      if (filter === "open") return ["open", "draft", "pending"].includes(s);
      if (filter === "completed") return ["completed", "complete"].includes(s);
      return s === filter;
    });
  }, [data, filter]);

  // Expanded uses a narrow list pane beside the detail → keep 1 column there.
  const numColumns = sizeClass === "medium" ? 2 : 1;

  const openItem = (item: Inspection) => {
    if (isExpanded) setSelectedId(item.id);
    else router.push(`/inspection/${item.id}` as Href);
  };

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
        <Meta icon="calendar-outline" text={formatDate(item.createdAt)} />
        {item.severity ? (
          <Badge label={formatStatus(item.severity)} tone={severityTone(item.severity)} />
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
      </Screen>
    );
  }

  return <Screen>{listPane}</Screen>;
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
