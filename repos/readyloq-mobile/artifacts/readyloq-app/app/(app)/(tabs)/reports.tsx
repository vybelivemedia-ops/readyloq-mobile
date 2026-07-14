import { Ionicons } from "@expo/vector-icons";
import { getListReportsQueryOptions } from "@/lib/api-client";
import type { Report } from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { type Href, useRouter } from "expo-router";
import React, { useState } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";

import { ReportDetail } from "@/components/ReportDetail";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FullScreenLoader } from "@/components/ui/Loader";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import { useWindowSizeClass } from "@/hooks/useWindowSizeClass";
import { formatDate, formatStatus, severityTone, statusTone } from "@/constants/inspection";

export default function ReportsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { sizeClass, isExpanded } = useWindowSizeClass();
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, isLoading, isRefetching, refetch } = useQuery(getListReportsQueryOptions());

  // Expanded uses a narrow list pane beside the detail → keep 1 column there.
  const numColumns = sizeClass === "medium" ? 2 : 1;

  const openItem = (item: Report) => {
    if (isExpanded) setSelectedId(item.id);
    else router.push(`/report/${item.id}` as Href);
  };

  const renderItem = ({ item }: { item: Report }) => (
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

  const listPane = (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 24 }}>
          Reports
        </Text>
      </View>

      {isLoading ? (
        <FullScreenLoader />
      ) : (
        <FlatList
          key={`cols-${numColumns}`}
          data={data ?? []}
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
              icon="document-text-outline"
              title="No reports yet"
              subtitle="Complete an inspection and generate a report to see it here."
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
              <ReportDetail key={selectedId} id={selectedId} embedded />
            ) : (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }}>
                <Ionicons name="document-text-outline" size={40} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 15 }}>
                  Select a report to view details
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
