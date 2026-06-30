import { Ionicons } from "@expo/vector-icons";
import { getListReportsQueryOptions } from "@/lib/api-client";
import type { Report } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { type Href, useRouter } from "expo-router";
import React from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FullScreenLoader } from "@/components/ui/Loader";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import { formatDate, formatStatus, severityTone, statusTone } from "@/constants/inspection";

export default function ReportsScreen() {
  const colors = useColors();
  const router = useRouter();

  const { data, isLoading, isRefetching, refetch } = useQuery(getListReportsQueryOptions());

  const renderItem = ({ item }: { item: Report }) => (
    <Card onPress={() => router.push(`/report/${item.id}` as Href)} style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Text
          numberOfLines={2}
          style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 16, flex: 1 }}
        >
          {item.title}
        </Text>
        <Badge label={formatStatus(item.status)} tone={statusTone(item.status)} />
      </View>
      {item.siteAddress ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="location-outline" size={14} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
            {item.siteAddress}
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {item.aiNarrative ? <Badge label="AI narrative" tone="primary" /> : null}
        {item.severity ? (
          <Badge label={formatStatus(item.severity)} tone={severityTone(item.severity)} />
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="calendar-outline" size={14} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
            {formatDate(item.createdAt)}
          </Text>
        </View>
      </View>
    </Card>
  );

  return (
    <Screen>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 24 }}>
          Reports
        </Text>
      </View>

      {isLoading ? (
        <FullScreenLoader />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(i) => String(i.id)}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 12, flexGrow: 1 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="document-text-outline"
              title="No reports yet"
              subtitle="Complete an inspection and generate a report to see it here."
            />
          }
        />
      )}
    </Screen>
  );
}
