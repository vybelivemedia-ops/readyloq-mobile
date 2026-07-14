import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/ui/Avatar";
import { useColors } from "@/hooks/useColors";
import { useBrowseCreators } from "@workspace/api-client-react";
import type { ContentCategory } from "@workspace/api-client-react";

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

export default function BrowseScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const params = useLocalSearchParams<{ category?: string }>();

  const initialCategory = CATEGORIES.some((c) => c.value === params.category)
    ? (params.category as ContentCategory)
    : undefined;

  const [search, setSearch] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [category, setCategory] = React.useState<ContentCategory | undefined>(initialCategory);

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useBrowseCreators({
    ...(category ? { category } : {}),
    ...(debounced ? { q: debounced } : {}),
    limit: 50,
  });
  const items = data?.items ?? [];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 12, borderColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Browse creators</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="search" size={18} color={colors.mutedForeground} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or username"
          placeholderTextColor={colors.mutedForeground}
          style={[styles.searchInput, { color: colors.foreground }]}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")}>
            <Feather name="x" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.chipWrap}>
        <FlatList
          horizontal
          data={CATEGORIES}
          keyExtractor={(c) => c.value}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          renderItem={({ item }) => {
            const active = category === item.value;
            return (
              <TouchableOpacity
                onPress={() => setCategory(active ? undefined : item.value)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? colors.primary : colors.card,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: active ? colors.background : colors.foreground },
                  ]}
                >
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <Feather name="search" size={28} color={colors.mutedForeground} />
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            No creators found
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => router.push(`/creator/${item.id}` as never)}
              style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Avatar uri={item.avatarUrl} name={item.displayName} size={48} />
              <View style={styles.rowInfo}>
                <Text style={[styles.rowName, { color: colors.foreground }]} numberOfLines={1}>
                  {item.displayName}
                </Text>
                <Text style={[styles.rowMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {item.category ? `${CATEGORY_LABELS[item.category] ?? item.category} • ` : ""}
                  {formatNumber(item.followersCount)} followers
                </Text>
              </View>
              {item.isFollowing && (
                <View style={[styles.followingPill, { borderColor: colors.border }]}>
                  <Text style={[styles.followingText, { color: colors.mutedForeground }]}>
                    Following
                  </Text>
                </View>
              )}
              <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        />
      )}
    </View>
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
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginLeft: -8 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 12 : 6,
    marginHorizontal: 16,
    marginTop: 12,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular" },
  chipWrap: { marginTop: 12 },
  chipRow: { gap: 8, paddingHorizontal: 16 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  empty: { fontSize: 15, fontFamily: "Inter_500Medium" },
  list: { padding: 16, gap: 10 },
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
  followingPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  followingText: { fontSize: 11, fontFamily: "Inter_500Medium" },
});
