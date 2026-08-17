/**
 * Executive Velocity Drill-Down
 *
 * Lists all inspections completed during a specific calendar month, showing
 * site address, technician, and completion date.
 * Reached by tapping a month card in the Inspection Velocity section of the
 * Executive Intelligence Dashboard.
 *
 * Owners can filter the list by technician via scrollable chips rendered below
 * the summary strip. The technician list is always populated from the full
 * unfiltered month so all options remain visible regardless of the active
 * filter. Filtering re-fetches from the server without a full screen reload.
 */
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@clerk/expo";
import {
  fetchVelocityDetail,
  type VelocityInspection,
  type VelocityMonth,
} from "@/lib/api";

// ─── Palette ──────────────────────────────────────────────────────────────────

const C = {
  bg: "#0D1117",
  surface: "#161B22",
  border: "#30363D",
  text: "#E6EDF3",
  muted: "#8B949E",
  primary: "#17C4D3",
  success: "#3FB950",
  warning: "#D29922",
  danger: "#F85149",
};

// ─── Row component ────────────────────────────────────────────────────────────

function InspectionRow({
  item,
  isLast,
  onPress,
}: {
  item: VelocityInspection;
  isLast: boolean;
  onPress: () => void;
}) {
  const completedDate = new Date(item.completedAt);
  const dateLabel = completedDate.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: C.border,
        gap: 12,
      }}
    >
      {/* Calendar icon */}
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: C.primary + "18",
          borderWidth: 1,
          borderColor: C.primary + "44",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Ionicons name="checkmark-circle" size={18} color={C.primary} />
      </View>

      {/* Address + technician + date */}
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{ color: C.text, fontFamily: "Inter_600SemiBold", fontSize: 14 }}
          numberOfLines={1}
        >
          {item.siteAddress}
        </Text>
        <Text
          style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 12 }}
          numberOfLines={1}
        >
          {item.technicianName} · {dateLabel}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={16} color={C.muted} />
    </TouchableOpacity>
  );
}

// ─── Technician filter chips ───────────────────────────────────────────────────

function TechnicianFilterChips({
  technicians,
  selected,
  onSelect,
}: {
  technicians: string[];
  selected: string | null;
  onSelect: (name: string | null) => void;
}) {
  if (technicians.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        flexDirection: "row",
        paddingHorizontal: 16,
        paddingVertical: 10,
        gap: 8,
      }}
      style={{ borderBottomWidth: 1, borderBottomColor: C.border }}
    >
      {/* "All" chip */}
      <TouchableOpacity
        onPress={() => onSelect(null)}
        activeOpacity={0.7}
        style={{
          paddingHorizontal: 14,
          paddingVertical: 6,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: selected === null ? C.primary : C.border,
          backgroundColor: selected === null ? C.primary + "22" : "#ffffff08",
        }}
      >
        <Text
          style={{
            color: selected === null ? C.primary : C.muted,
            fontFamily: selected === null ? "Inter_700Bold" : "Inter_400Regular",
            fontSize: 13,
          }}
        >
          All
        </Text>
      </TouchableOpacity>

      {technicians.map((name) => {
        const isActive = selected === name;
        return (
          <TouchableOpacity
            key={name}
            onPress={() => onSelect(isActive ? null : name)}
            activeOpacity={0.7}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 6,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: isActive ? C.primary : C.border,
              backgroundColor: isActive ? C.primary + "22" : "#ffffff08",
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
            }}
          >
            {isActive && (
              <Ionicons name="person" size={12} color={C.primary} />
            )}
            <Text
              style={{
                color: isActive ? C.primary : C.muted,
                fontFamily: isActive ? "Inter_700Bold" : "Inter_400Regular",
                fontSize: 13,
              }}
            >
              {name}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ExecutiveVelocityInspectionsScreen() {
  const params = useLocalSearchParams<{ month?: string; label?: string }>();
  const month = (params.month === "last" ? "last" : "current") as VelocityMonth;

  const { getToken } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<VelocityInspection[]>([]);
  const [label, setLabel] = useState<string>(params.label ?? "");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Technician filter state. `technicians` is populated from the first
  // (unfiltered) fetch and never replaced so all chips stay visible.
  const [technicians, setTechnicians] = useState<string[]>([]);
  const [techFilter, setTechFilter] = useState<string | null>(null);

  // Ref that always holds the current filter value so fetchData can read it
  // without being recreated on every filter change. This is critical for
  // refresh/retry calls: they must re-use whatever filter is currently active.
  const techFilterRef = useRef<string | null>(null);

  const reqIdRef = useRef(0);

  const fetchData = useCallback(
    async (isRefresh = false) => {
      // Always read from the ref — guaranteed to be the latest value even
      // when this memoised callback was created before the last filter change.
      const currentFilter = techFilterRef.current;

      const myReqId = ++reqIdRef.current;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const token = await getToken();
        const res = await fetchVelocityDetail(
          token,
          month,
          currentFilter ?? undefined,
        );
        if (myReqId !== reqIdRef.current) return;
        setItems(res.inspections);
        setLabel(res.label);
        // Only update the technician list on unfiltered fetches so the chips
        // always show all available names regardless of the active filter.
        if (!currentFilter && res.technicians.length > 0) {
          setTechnicians(res.technicians);
        }
      } catch (e) {
        if (myReqId !== reqIdRef.current) return;
        setError(e instanceof Error ? e.message : "Failed to load inspections");
      } finally {
        if (myReqId === reqIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [getToken, month],
  );

  // Initial load (unfiltered).
  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Re-fetch when the technician filter changes.
  const handleFilterChange = useCallback(
    (name: string | null) => {
      // Update the ref BEFORE calling fetchData so the callback reads the new
      // value, then update state so the UI re-renders.
      techFilterRef.current = name;
      setTechFilter(name);
      void fetchData();
    },
    [fetchData],
  );

  const titlePrefix = month === "current" ? "This Month" : "Last Month";

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 16,
          paddingBottom: 14,
          borderBottomWidth: 1,
          borderBottomColor: C.border,
          backgroundColor: C.surface,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: "#ffffff12",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="chevron-back" size={20} color={C.text} />
        </TouchableOpacity>

        {/* Month badge */}
        {label ? (
          <View
            style={{
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 20,
              backgroundColor: C.primary + "22",
              borderWidth: 1,
              borderColor: C.primary + "55",
            }}
          >
            <Text style={{ color: C.primary, fontFamily: "Inter_700Bold", fontSize: 12 }}>
              {label}
            </Text>
          </View>
        ) : null}

        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontFamily: "Inter_800ExtraBold", fontSize: 17 }}>
            {titlePrefix} Completions
          </Text>
          <Text
            style={{
              color: C.muted,
              fontFamily: "Inter_400Regular",
              fontSize: 12,
              marginTop: 1,
            }}
          >
            Inspections completed · {label || titlePrefix.toLowerCase()}
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => void fetchData(true)}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: "#ffffff08",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="refresh" size={18} color={C.muted} />
        </TouchableOpacity>
      </View>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
          <ActivityIndicator size="large" color={C.primary} />
          <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 14 }}>
            Loading inspections…
          </Text>
        </View>
      ) : error ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: 32,
          }}
        >
          <Ionicons name="cloud-offline-outline" size={40} color={C.muted} />
          <Text
            style={{
              color: C.muted,
              fontFamily: "Inter_600SemiBold",
              fontSize: 15,
              textAlign: "center",
            }}
          >
            {error}
          </Text>
          <TouchableOpacity
            onPress={() => void fetchData()}
            style={{
              paddingHorizontal: 20,
              paddingVertical: 10,
              borderRadius: 10,
              backgroundColor: C.primary + "22",
              borderWidth: 1,
              borderColor: C.primary + "55",
            }}
          >
            <Text style={{ color: C.primary, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
              Retry
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.inspectionId)}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void fetchData(true)}
              tintColor={C.primary}
            />
          }
          ListHeaderComponent={
            <>
              {/* Summary strip */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  gap: 8,
                  borderBottomWidth: 1,
                  borderBottomColor: C.border,
                }}
              >
                <Ionicons name="trending-up" size={16} color={C.primary} />
                <Text
                  style={{
                    color: C.muted,
                    fontFamily: "Inter_400Regular",
                    fontSize: 13,
                    flex: 1,
                  }}
                >
                  <Text style={{ color: C.primary, fontFamily: "Inter_700Bold" }}>
                    {items.length}
                  </Text>{" "}
                  inspection{items.length !== 1 ? "s" : ""} completed
                  {techFilter ? (
                    <>
                      {" · filtered by "}
                      <Text style={{ color: C.primary, fontFamily: "Inter_600SemiBold" }}>
                        {techFilter}
                      </Text>
                    </>
                  ) : (
                    " · sorted by date (newest first)"
                  )}
                </Text>
              </View>

              {/* Technician filter chips */}
              <TechnicianFilterChips
                technicians={technicians}
                selected={techFilter}
                onSelect={handleFilterChange}
              />

              {/* Empty state when a filter yields no results */}
              {items.length === 0 && (
                <View
                  style={{
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 12,
                    padding: 48,
                  }}
                >
                  <Ionicons name="person-outline" size={44} color={C.muted} />
                  <Text
                    style={{
                      color: C.text,
                      fontFamily: "Inter_700Bold",
                      fontSize: 16,
                      textAlign: "center",
                    }}
                  >
                    No results
                  </Text>
                  <Text
                    style={{
                      color: C.muted,
                      fontFamily: "Inter_400Regular",
                      fontSize: 13,
                      textAlign: "center",
                    }}
                  >
                    {techFilter
                      ? `${techFilter} completed no inspections ${month === "current" ? "this month" : "last month"}.`
                      : `No inspections were completed ${month === "current" ? "this month" : "last month"}.`}
                  </Text>
                  {techFilter && (
                    <TouchableOpacity
                      onPress={() => handleFilterChange(null)}
                      style={{
                        paddingHorizontal: 16,
                        paddingVertical: 8,
                        borderRadius: 10,
                        backgroundColor: C.primary + "22",
                        borderWidth: 1,
                        borderColor: C.primary + "55",
                      }}
                    >
                      <Text style={{ color: C.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                        Clear filter
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Card header — only shown when there are results */}
              {items.length > 0 && (
                <View
                  style={{
                    marginHorizontal: 16,
                    marginTop: 16,
                    backgroundColor: C.surface,
                    borderWidth: 1,
                    borderColor: C.border,
                    borderTopLeftRadius: 14,
                    borderTopRightRadius: 14,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      paddingHorizontal: 16,
                      paddingVertical: 8,
                      borderBottomWidth: 1,
                      borderBottomColor: C.border,
                      backgroundColor: "#ffffff06",
                    }}
                  >
                    <Text
                      style={{
                        color: C.muted,
                        fontFamily: "Inter_600SemiBold",
                        fontSize: 10,
                        letterSpacing: 0.6,
                        flex: 1,
                        marginLeft: 48,
                      }}
                    >
                      SITE / TECHNICIAN / DATE
                    </Text>
                  </View>
                </View>
              )}
            </>
          }
          renderItem={({ item, index }) => (
            <View
              style={{
                marginHorizontal: 16,
                backgroundColor: C.surface,
                borderLeftWidth: 1,
                borderRightWidth: 1,
                borderColor: C.border,
              }}
            >
              <InspectionRow
                item={item}
                isLast={index === items.length - 1}
                onPress={() =>
                  router.push({
                    pathname: "/inspection/[id]",
                    params: { id: String(item.inspectionId) },
                  } as never)
                }
              />
            </View>
          )}
          ListFooterComponent={
            items.length > 0 ? (
              <View
                style={{
                  marginHorizontal: 16,
                  backgroundColor: C.surface,
                  borderWidth: 1,
                  borderTopWidth: 0,
                  borderColor: C.border,
                  borderBottomLeftRadius: 14,
                  borderBottomRightRadius: 14,
                  height: 14,
                }}
              />
            ) : null
          }
        />
      )}
    </View>
  );
}
