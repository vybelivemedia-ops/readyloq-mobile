import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
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
import { useColors } from "@/hooks/useColors";
import {
  useListDiscoveryCreators,
  useListSuggestedCreators,
} from "@workspace/api-client-react";
import type {
  ContentCategory,
  CreatorSummary,
  SuggestedCreator,
} from "@workspace/api-client-react";

const CATEGORIES: { value: ContentCategory; label: string }[] = [
  { value: "automotive", label: "Automotive" },
  { value: "fitness", label: "Fitness" },
  { value: "business", label: "Business" },
  { value: "real_estate", label: "Real estate" },
  { value: "podcast", label: "Podcast" },
  { value: "gaming", label: "Gaming" },
  { value: "music", label: "Music" },
  { value: "lifestyle", label: "Lifestyle" },
  { value: "travel", label: "Travel" },
  { value: "food", label: "Food" },
  { value: "education", label: "Education" },
  { value: "tech", label: "Tech" },
  { value: "sports", label: "Sports" },
  { value: "other", label: "Other" },
];

const CATEGORY_LABELS = Object.fromEntries(
  CATEGORIES.map((c) => [c.value, c.label]),
) as Record<string, string>;

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

function goToProfile(id: string) {
  router.push(`/creator/${id}` as never);
}

export default function DiscoverScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const { data: suggested, isLoading: suggestedLoading } = useListSuggestedCreators({
    limit: 12,
  });
  const trending = useListDiscoveryCreators({ section: "trending", limit: 6 });
  const fresh = useListDiscoveryCreators({ section: "new", limit: 6 });
  const growing = useListDiscoveryCreators({ section: "growing", limit: 6 });
  const nearby = useListDiscoveryCreators({ section: "nearby", limit: 6 });

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>Discover</Text>
        <TouchableOpacity onPress={() => router.push("/discover/browse")} style={styles.iconBtn}>
          <Feather name="search" size={20} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Search prompt */}
        <TouchableOpacity
          onPress={() => router.push("/discover/browse")}
          activeOpacity={0.8}
          style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Feather name="search" size={18} color={colors.mutedForeground} />
          <Text style={[styles.searchText, { color: colors.mutedForeground }]}>
            Search creators by name or category
          </Text>
        </TouchableOpacity>

        {/* Categories */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Browse categories</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat.value}
                onPress={() =>
                  router.push(`/discover/browse?category=${cat.value}` as never)
                }
                style={[styles.chip, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Text style={[styles.chipText, { color: colors.foreground }]}>{cat.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Suggested */}
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Suggested for you</Text>
          {suggestedLoading ? (
            <ActivityIndicator color={colors.primary} style={styles.loader} />
          ) : (suggested?.items?.length ?? 0) === 0 ? (
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              No suggestions yet — follow a few creators to get personalized picks.
            </Text>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.rail}
            >
              {suggested!.items.map((c) => (
                <SuggestedCard key={c.id} creator={c} />
              ))}
            </ScrollView>
          )}
        </View>

        <CreatorSection
          title="Trending"
          icon="trending-up"
          items={trending.data?.items}
          isLoading={trending.isLoading}
        />
        <CreatorSection
          title="New creators"
          icon="user-plus"
          items={fresh.data?.items}
          isLoading={fresh.isLoading}
        />
        <CreatorSection
          title="Growing fast"
          icon="bar-chart-2"
          items={growing.data?.items}
          isLoading={growing.isLoading}
        />
        <CreatorSection
          title="Near you"
          icon="map-pin"
          items={nearby.data?.items}
          isLoading={nearby.isLoading}
          hideWhenEmpty
        />
      </ScrollView>
    </View>
  );
}

function SuggestedCard({ creator }: { creator: SuggestedCreator }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={() => goToProfile(creator.id)}
      activeOpacity={0.85}
      style={[styles.suggestedCard, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <Avatar uri={creator.avatarUrl} name={creator.displayName} size={56} showRing />
      <Text style={[styles.suggestedName, { color: colors.foreground }]} numberOfLines={1}>
        {creator.displayName}
      </Text>
      <Text style={[styles.suggestedUser, { color: colors.mutedForeground }]} numberOfLines={1}>
        @{creator.username}
      </Text>
      <View style={[styles.reasonChip, { backgroundColor: colors.primary + "22" }]}>
        <Text style={[styles.reasonText, { color: colors.primary }]} numberOfLines={2}>
          {creator.reason}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

function CreatorSection({
  title,
  icon,
  items,
  isLoading,
  hideWhenEmpty,
}: {
  title: string;
  icon: keyof typeof Feather.glyphMap;
  items: CreatorSummary[] | undefined;
  isLoading: boolean;
  hideWhenEmpty?: boolean;
}) {
  const colors = useColors();
  if (!isLoading && hideWhenEmpty && (items?.length ?? 0) === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeaderRow}>
        <Feather name={icon} size={16} color={colors.primary} />
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
      </View>
      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : (items?.length ?? 0) === 0 ? (
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          No creators to show yet.
        </Text>
      ) : (
        items!.map((c) => <CreatorRow key={c.id} creator={c} />)
      )}
    </View>
  );
}

function CreatorRow({ creator }: { creator: CreatorSummary }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={() => goToProfile(creator.id)}
      style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <Avatar uri={creator.avatarUrl} name={creator.displayName} size={48} />
      <View style={styles.rowInfo}>
        <Text style={[styles.rowName, { color: colors.foreground }]} numberOfLines={1}>
          {creator.displayName}
        </Text>
        <Text style={[styles.rowMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
          {creator.category ? `${CATEGORY_LABELS[creator.category] ?? creator.category} • ` : ""}
          {formatNumber(creator.followersCount)} followers
        </Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginRight: -8 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  content: { padding: 16, gap: 22 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  searchText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  section: { gap: 12 },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  chipRow: { gap: 8, paddingRight: 4 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  rail: { gap: 12, paddingRight: 4 },
  suggestedCard: {
    width: 150,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    alignItems: "center",
    gap: 6,
  },
  suggestedName: { fontSize: 14, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  suggestedUser: { fontSize: 12, fontFamily: "Inter_400Regular" },
  reasonChip: {
    marginTop: 4,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    minHeight: 44,
    justifyContent: "center",
  },
  reasonText: { fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rowMeta: { fontSize: 13, fontFamily: "Inter_400Regular" },
  loader: { marginVertical: 16, alignSelf: "flex-start" },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 20 },
});
