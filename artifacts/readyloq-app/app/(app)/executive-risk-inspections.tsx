/**
 * Executive Risk Drill-Down
 *
 * Lists all inspections at a given risk level for the owner's company.
 * Supports filtering by technician name and date range.
 * Reached by tapping a risk segment in the Executive Intelligence Dashboard.
 *
 * Fetch correctness: fetchData is a stable callback (depends only on getToken
 * and riskLevel, never on filter state). It takes explicit (tech, days) params
 * and uses a reqIdRef counter so stale in-flight responses are silently dropped.
 * applyTech / applyDays update filter state AND call fetchData directly — there
 * is no secondary useEffect that watches filter state, so there is no double-fetch.
 */
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@clerk/expo";
import {
  fetchExecutiveInspections,
  type ExecutiveRiskInspection,
  type ExecutiveRiskLevel,
} from "@/lib/api";

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

const RISK_COLOR: Record<ExecutiveRiskLevel, string> = {
  critical: C.danger,
  high: "#E3882A",
  medium: C.warning,
  low: C.success,
};

const RISK_LABEL: Record<ExecutiveRiskLevel, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const RISK_ICON: Record<ExecutiveRiskLevel, keyof typeof Ionicons.glyphMap> = {
  critical: "warning",
  high: "alert-circle",
  medium: "alert",
  low: "checkmark-circle",
};

// ─── Date-range presets ───────────────────────────────────────────────────────

interface DatePreset {
  label: string;
  days: number | null; // null = "All time"
}

const DATE_PRESETS: DatePreset[] = [
  { label: "All", days: null },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

function sinceFromDays(days: number | null): string | undefined {
  if (days === null) return undefined;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

// ─── Row component ────────────────────────────────────────────────────────────

function InspectionRow({
  item,
  isLast,
  onPress,
}: {
  item: ExecutiveRiskInspection;
  isLast: boolean;
  onPress: () => void;
}) {
  const color = RISK_COLOR[item.riskLevel];
  const qualityColor =
    item.qualityScore >= 80 ? C.success : item.qualityScore >= 60 ? C.warning : C.danger;

  const scoredDate = new Date(item.scoredAt);
  const dateLabel = scoredDate.toLocaleDateString(undefined, {
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
      {/* Risk icon dot */}
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          backgroundColor: color + "18",
          borderWidth: 1,
          borderColor: color + "44",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <Ionicons name={RISK_ICON[item.riskLevel]} size={18} color={color} />
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

      {/* Quality score badge */}
      <View
        style={{
          paddingHorizontal: 10,
          paddingVertical: 5,
          borderRadius: 20,
          backgroundColor: qualityColor + "22",
          borderWidth: 1,
          borderColor: qualityColor + "55",
          alignItems: "center",
          minWidth: 44,
          flexShrink: 0,
        }}
      >
        <Text style={{ color: qualityColor, fontFamily: "Inter_700Bold", fontSize: 13 }}>
          {item.qualityScore}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={16} color={C.muted} />
    </TouchableOpacity>
  );
}

// ─── Technician picker modal ──────────────────────────────────────────────────

function TechnicianPickerModal({
  visible,
  technicians,
  selected,
  onSelect,
  onClose,
}: {
  visible: boolean;
  technicians: string[];
  selected: string | null;
  onSelect: (name: string | null) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const options = ["All technicians", ...technicians];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: "#00000088", justifyContent: "flex-end" }}
        onPress={onClose}
      >
        <Pressable
          style={{
            backgroundColor: C.surface,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            borderWidth: 1,
            borderColor: C.border,
            paddingBottom: insets.bottom + 16,
            maxHeight: 440,
          }}
          onPress={() => {
            /* absorb taps so pressing inside doesn't close */
          }}
        >
          {/* Handle */}
          <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 8 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: C.border }} />
          </View>

          <Text
            style={{
              color: C.muted,
              fontFamily: "Inter_600SemiBold",
              fontSize: 11,
              letterSpacing: 0.7,
              textTransform: "uppercase",
              paddingHorizontal: 20,
              paddingBottom: 10,
            }}
          >
            Filter by technician
          </Text>

          <FlatList
            data={options}
            keyExtractor={(item) => item}
            renderItem={({ item }) => {
              const isActive =
                item === "All technicians" ? selected === null : selected === item;
              return (
                <TouchableOpacity
                  onPress={() => {
                    onSelect(item === "All technicians" ? null : item);
                    onClose();
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 14,
                    paddingHorizontal: 20,
                    borderBottomWidth: 1,
                    borderBottomColor: C.border + "66",
                    gap: 12,
                  }}
                >
                  <View
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      borderWidth: 2,
                      borderColor: isActive ? C.primary : C.border,
                      backgroundColor: isActive ? C.primary + "33" : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {isActive && (
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: C.primary,
                        }}
                      />
                    )}
                  </View>
                  <Text
                    style={{
                      color: isActive ? C.text : C.muted,
                      fontFamily: isActive ? "Inter_600SemiBold" : "Inter_400Regular",
                      fontSize: 14,
                    }}
                  >
                    {item}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ExecutiveRiskInspectionsScreen() {
  const params = useLocalSearchParams<{ riskLevel: string }>();
  const riskLevel = (params.riskLevel ?? "critical") as ExecutiveRiskLevel;

  const { getToken } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // ── Data state ────────────────────────────────────────────────────────────
  const [items, setItems] = useState<ExecutiveRiskInspection[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track loaded count so onEndReached knows the next offset to request.
  const loadedCountRef = useRef(0);

  // ── Filter state — cleared on unmount (not persisted across navigation) ──
  const [filterTech, setFilterTech] = useState<string | null>(null);
  const [filterDays, setFilterDays] = useState<number | null>(null);
  const [showTechPicker, setShowTechPicker] = useState(false);

  // Technician options populated from the first unfiltered fetch so the picker
  // always shows all possible names even when a filter is active.
  const [allTechnicians, setAllTechnicians] = useState<string[]>([]);

  // Monotonically increasing counter — stale responses are silently dropped.
  const reqIdRef = useRef(0);

  // ── Stable fetch function — does NOT depend on filter state ──────────────
  // Takes explicit (tech, days, offset, append) params so callers control exactly
  // what is fetched. When append=true the new page is merged onto the existing
  // list; when false (initial / refresh / filter change) the list is replaced.
  const fetchData = useCallback(
    async (
      tech: string | null,
      days: number | null,
      isRefresh = false,
      offset = 0,
      append = false,
    ) => {
      const myReqId = ++reqIdRef.current;

      if (append) setLoadingMore(true);
      else if (isRefresh) setRefreshing(true);
      else setLoading(true);
      if (!append) setError(null);

      try {
        const token = await getToken();
        const since = sinceFromDays(days);
        const filters = {
          ...(tech ? { technicianName: tech } : {}),
          ...(since ? { since } : {}),
          ...(offset > 0 ? { offset } : {}),
        };
        const res = await fetchExecutiveInspections(token, riskLevel, filters);

        // Drop this response if a newer fetch has already been issued.
        if (myReqId !== reqIdRef.current) return;

        if (append) {
          setItems((prev) => {
            const merged = [...prev, ...res.inspections];
            loadedCountRef.current = merged.length;
            return merged;
          });
        } else {
          setItems(res.inspections);
          loadedCountRef.current = res.inspections.length;
        }
        setHasMore(res.hasMore);
        setTotal(res.total ?? null);

        // Populate the technician picker from the initial unfiltered load only,
        // so the options list never shrinks when a filter is applied.
        if (!tech && !since && offset === 0) {
          const unique = Array.from(
            new Set(res.inspections.map((i) => i.technicianName).filter(Boolean)),
          ).sort();
          setAllTechnicians(unique);
        }
      } catch (e) {
        if (myReqId !== reqIdRef.current) return;
        if (!append) setError(e instanceof Error ? e.message : "Failed to load inspections");
      } finally {
        if (myReqId === reqIdRef.current) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    // Intentionally excludes filter state — filters are passed explicitly.
    [getToken, riskLevel],
  );

  // Initial load — runs once when the screen mounts (or riskLevel changes).
  useEffect(() => {
    void fetchData(null, null);
  }, [fetchData]);

  // ── Load-more — called by FlatList onEndReached ───────────────────────────
  // Reads filter state from refs to avoid stale closures.
  const filterTechRef = useRef<string | null>(null);
  const filterDaysRef = useRef<number | null>(null);
  filterTechRef.current = filterTech;
  filterDaysRef.current = filterDays;

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    void fetchData(
      filterTechRef.current,
      filterDaysRef.current,
      false,
      loadedCountRef.current,
      true,
    );
  }, [loadingMore, hasMore, fetchData]);

  // ── Filter handlers — update state and issue one fetch, no double-effect ──
  const applyTech = useCallback(
    (tech: string | null) => {
      setFilterTech(tech);
      // Read filterDays from a ref-like closure: we use a functional form to
      // access the latest value without creating a new callback on each render.
      setFilterDays((currentDays) => {
        void fetchData(tech, currentDays);
        return currentDays; // leave days unchanged
      });
    },
    [fetchData],
  );

  const applyDays = useCallback(
    (days: number | null) => {
      setFilterDays(days);
      setFilterTech((currentTech) => {
        void fetchData(currentTech, days);
        return currentTech; // leave tech unchanged
      });
    },
    [fetchData],
  );

  const clearFilters = useCallback(() => {
    setFilterTech(null);
    setFilterDays(null);
    void fetchData(null, null);
  }, [fetchData]);

  // ── Derived values ────────────────────────────────────────────────────────
  const accentColor = RISK_COLOR[riskLevel];
  const levelLabel = RISK_LABEL[riskLevel];
  const isFiltered = filterTech !== null || filterDays !== null;

  const summaryText = useMemo(() => {
    const parts: string[] = [];
    if (filterTech) parts.push(filterTech);
    const preset = DATE_PRESETS.find((p) => p.days === filterDays);
    if (filterDays !== null && preset) parts.push(`last ${preset.label}`);
    return parts.length > 0 ? `filtered by ${parts.join(", ")}` : "sorted by risk score";
  }, [filterTech, filterDays]);

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

        {/* Risk badge */}
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 20,
            backgroundColor: accentColor + "22",
            borderWidth: 1,
            borderColor: accentColor + "55",
          }}
        >
          <Text style={{ color: accentColor, fontFamily: "Inter_700Bold", fontSize: 12 }}>
            {levelLabel} Risk
          </Text>
        </View>

        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontFamily: "Inter_800ExtraBold", fontSize: 17 }}>
            At-Risk Inspections
          </Text>
          <Text
            style={{
              color: C.muted,
              fontFamily: "Inter_400Regular",
              fontSize: 12,
              marginTop: 1,
            }}
          >
            Tap a row to open the inspection
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => {
            void fetchData(filterTech, filterDays, true);
          }}
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

      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <View
        style={{
          backgroundColor: C.surface,
          borderBottomWidth: 1,
          borderBottomColor: C.border,
          paddingHorizontal: 16,
          paddingVertical: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        {/* Technician picker chip */}
        <TouchableOpacity
          onPress={() => setShowTechPicker(true)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderRadius: 20,
            backgroundColor: filterTech ? C.primary + "22" : "#ffffff0a",
            borderWidth: 1,
            borderColor: filterTech ? C.primary + "66" : C.border,
          }}
        >
          <Ionicons
            name="person-outline"
            size={13}
            color={filterTech ? C.primary : C.muted}
          />
          <Text
            style={{
              color: filterTech ? C.primary : C.muted,
              fontFamily: filterTech ? "Inter_600SemiBold" : "Inter_400Regular",
              fontSize: 12,
            }}
            numberOfLines={1}
          >
            {filterTech ?? "All techs"}
          </Text>
          <Ionicons name="chevron-down" size={11} color={filterTech ? C.primary : C.muted} />
        </TouchableOpacity>

        {/* Date range chips */}
        {DATE_PRESETS.map((preset) => {
          const isActive = filterDays === preset.days;
          return (
            <TouchableOpacity
              key={preset.label}
              onPress={() => applyDays(preset.days)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 20,
                backgroundColor: isActive ? C.primary + "22" : "#ffffff0a",
                borderWidth: 1,
                borderColor: isActive ? C.primary + "66" : C.border,
              }}
            >
              <Text
                style={{
                  color: isActive ? C.primary : C.muted,
                  fontFamily: isActive ? "Inter_600SemiBold" : "Inter_400Regular",
                  fontSize: 12,
                }}
              >
                {preset.label}
              </Text>
            </TouchableOpacity>
          );
        })}

        {/* Clear button — only shown when a filter is active */}
        {isFiltered && (
          <TouchableOpacity
            onPress={clearFilters}
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              backgroundColor: "#ffffff14",
              alignItems: "center",
              justifyContent: "center",
              marginLeft: "auto",
            }}
          >
            <Ionicons name="close" size={14} color={C.muted} />
          </TouchableOpacity>
        )}
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
            onPress={() => void fetchData(filterTech, filterDays)}
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
      ) : items.length === 0 ? (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: 32,
          }}
        >
          <Ionicons name="checkmark-circle-outline" size={44} color={C.success} />
          <Text
            style={{
              color: C.text,
              fontFamily: "Inter_700Bold",
              fontSize: 16,
              textAlign: "center",
            }}
          >
            {isFiltered ? "No matches" : `No ${levelLabel.toLowerCase()} risk inspections`}
          </Text>
          <Text
            style={{
              color: C.muted,
              fontFamily: "Inter_400Regular",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            {isFiltered
              ? "Try adjusting or clearing the filters."
              : "All inspections at this level have been addressed, or none have been scored yet."}
          </Text>
          {isFiltered && (
            <TouchableOpacity
              onPress={clearFilters}
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
                Clear filters
              </Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.inspectionId)}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void fetchData(filterTech, filterDays, true)}
              tintColor={C.primary}
            />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
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
                <Ionicons name={RISK_ICON[riskLevel]} size={16} color={accentColor} />
                <Text
                  style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 }}
                >
                  {total !== null && total > items.length ? (
                    <>
                      <Text style={{ color: accentColor, fontFamily: "Inter_700Bold" }}>
                        {items.length}
                      </Text>
                      <Text> of </Text>
                      <Text style={{ color: accentColor, fontFamily: "Inter_700Bold" }}>
                        {total}
                      </Text>
                    </>
                  ) : (
                    <Text style={{ color: accentColor, fontFamily: "Inter_700Bold" }}>
                      {total ?? items.length}
                    </Text>
                  )}{" "}
                  {levelLabel.toLowerCase()} risk inspection{(total ?? items.length) !== 1 ? "s" : ""}{" · "}
                  {summaryText}
                </Text>
              </View>

              {/* Card top: column header */}
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
                    SITE / TECHNICIAN
                  </Text>
                  <Text
                    style={{
                      color: C.muted,
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 10,
                      letterSpacing: 0.6,
                    }}
                  >
                    SCORE
                  </Text>
                </View>
              </View>
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
                isLast={index === items.length - 1 && !hasMore}
                onPress={() => router.push(`/inspection/${item.inspectionId}` as never)}
              />
            </View>
          )}
          ListFooterComponent={
            <View
              style={{
                marginHorizontal: 16,
                backgroundColor: C.surface,
                borderLeftWidth: 1,
                borderRightWidth: 1,
                borderBottomWidth: 1,
                borderColor: C.border,
                borderBottomLeftRadius: 14,
                borderBottomRightRadius: 14,
                overflow: "hidden",
              }}
            >
              {loadingMore && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    paddingVertical: 16,
                    borderTopWidth: 1,
                    borderTopColor: C.border,
                  }}
                >
                  <ActivityIndicator size="small" color={C.primary} />
                  <Text style={{ color: C.muted, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                    Loading more…
                  </Text>
                </View>
              )}
            </View>
          }
        />
      )}

      {/* ── Technician picker modal ──────────────────────────────────────── */}
      <TechnicianPickerModal
        visible={showTechPicker}
        technicians={allTechnicians}
        selected={filterTech}
        onSelect={applyTech}
        onClose={() => setShowTechPicker(false)}
      />
    </View>
  );
}
