import { Ionicons } from "@expo/vector-icons";
import { getListInspectionsQueryOptions } from "@workspace/api-client-react";
import type { Inspection } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { type Href, useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FullScreenLoader } from "@/components/ui/Loader";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
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
  const [filter, setFilter] = useState<string>("all");

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

  const renderItem = ({ item }: { item: Inspection }) => (
    <Card onPress={() => router.push(`/inspection/${item.id}` as Href)} style={{ gap: 10 }}>
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

  return (
    <Screen>
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

      <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 12 }}>
        {FILTERS.map((f) => {
          const active = filter === f.value;
          return (
            <Pressable
              key={f.value}
              onPress={() => setFilter(f.value)}
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
          data={items}
          keyExtractor={(i) => String(i.id)}
          renderItem={renderItem}
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
    </Screen>
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
