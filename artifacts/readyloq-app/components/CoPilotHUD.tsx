import { Ionicons } from "@expo/vector-icons";
import type { AnalysisResult } from "@/lib/api-client";
import * as Speech from "expo-speech";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  FlatList,
  Pressable,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";

// ─── Ghost prompt definitions ────────────────────────────────────────────────

interface ZonePrompt {
  id: string;
  label: string;
  keywords: string[];
  /** expo-camera zoom value (0–1 scale) the Co-Pilot should request for this zone.
   *  0 = 1× wide, 0.25 = 2×, 0.5 = 4×. Defaults to 0 when omitted. */
  suggestedZoom?: number;
}

type PropertyType = string;

const ZONE_PROMPTS: Record<string, ZonePrompt[]> = {
  Restaurant: [
    { id: "fryer",     label: "Under Fryer",      keywords: ["fryer", "frier", "kitchen", "fryer area"],           suggestedZoom: 0.5  },
    { id: "prep",      label: "Prep Stations",     keywords: ["prep", "preparation", "cutting", "worktop", "counter"], suggestedZoom: 0.25 },
    { id: "drains",    label: "Floor Drains",      keywords: ["drain", "floor drain", "drainage"],                  suggestedZoom: 0.5  },
    { id: "receiving", label: "Receiving / Dock",  keywords: ["receiving", "dock", "delivery", "loading"],          suggestedZoom: 0    },
    { id: "storage",   label: "Dry Storage",       keywords: ["storage", "dry goods", "pantry", "stockroom"],       suggestedZoom: 0.25 },
    { id: "grease",    label: "Grease Trap / Hood", keywords: ["grease", "hood", "exhaust", "vent"],                suggestedZoom: 0.5  },
  ],
  Residential: [
    { id: "sink",      label: "Under Sink",        keywords: ["sink", "under sink", "cabinet under", "plumbing"],   suggestedZoom: 0.5  },
    { id: "baseboard", label: "Baseboards",         keywords: ["baseboard", "base", "wall junction", "floor edge"], suggestedZoom: 0.25 },
    { id: "attic",     label: "Attic / Crawlspace", keywords: ["attic", "crawlspace", "crawl space", "roof"],       suggestedZoom: 0    },
    { id: "garage",    label: "Garage / Entry",     keywords: ["garage", "entry", "door sweep", "threshold"],       suggestedZoom: 0    },
    { id: "utility",   label: "Utility / Laundry",  keywords: ["utility", "laundry", "washer", "dryer", "water heater"], suggestedZoom: 0.25 },
  ],
  Commercial: [
    { id: "loading",    label: "Loading / Dock",    keywords: ["dock", "loading", "receiving"],                     suggestedZoom: 0    },
    { id: "mechanical", label: "Mechanical Room",   keywords: ["mechanical", "hvac", "boiler", "utility"],          suggestedZoom: 0.25 },
    { id: "breakroom",  label: "Break Room",        keywords: ["break room", "breakroom", "lunchroom", "kitchen"],  suggestedZoom: 0    },
    { id: "exterior",   label: "Exterior Perimeter", keywords: ["exterior", "perimeter", "outside", "dumpster"],    suggestedZoom: 0    },
    { id: "storage",    label: "Storage Areas",     keywords: ["storage", "warehouse", "storeroom", "stockroom"],   suggestedZoom: 0.25 },
  ],
  Warehouse: [
    { id: "pallets",  label: "Pallet / Racking Areas", keywords: ["pallet", "rack", "racking", "shelving"],         suggestedZoom: 0    },
    { id: "loading",  label: "Loading Docks",           keywords: ["dock", "loading", "bay"],                        suggestedZoom: 0    },
    { id: "corners",  label: "Floor Corners",           keywords: ["corner", "floor edge", "junction"],              suggestedZoom: 0.5  },
    { id: "drains",   label: "Floor Drains",            keywords: ["drain", "drainage", "floor drain"],              suggestedZoom: 0.5  },
    { id: "exterior", label: "Exterior / Perimeter",    keywords: ["exterior", "perimeter", "outside"],              suggestedZoom: 0    },
  ],
  "Multi-Family": [
    { id: "laundry",  label: "Laundry Room",       keywords: ["laundry", "washer", "dryer"],                        suggestedZoom: 0    },
    { id: "trash",    label: "Trash / Compactor",  keywords: ["trash", "garbage", "compactor", "refuse"],           suggestedZoom: 0.25 },
    { id: "basement", label: "Basement / Utility", keywords: ["basement", "utility", "boiler"],                     suggestedZoom: 0    },
    { id: "units",    label: "Unit Interiors",      keywords: ["unit", "apartment", "interior", "room"],             suggestedZoom: 0    },
    { id: "exterior", label: "Exterior Perimeter",  keywords: ["exterior", "perimeter", "outside"],                 suggestedZoom: 0    },
  ],
  School: [
    { id: "cafeteria", label: "Cafeteria / Kitchen", keywords: ["cafeteria", "kitchen", "food service"],            suggestedZoom: 0.25 },
    { id: "bathrooms", label: "Restrooms",            keywords: ["restroom", "bathroom", "toilet"],                 suggestedZoom: 0.25 },
    { id: "locker",    label: "Locker Rooms",         keywords: ["locker", "changing"],                             suggestedZoom: 0    },
    { id: "storage",   label: "Storage / Closets",    keywords: ["storage", "closet", "custodial"],                 suggestedZoom: 0.25 },
    { id: "exterior",  label: "Exterior / Grounds",   keywords: ["exterior", "grounds", "outside"],                 suggestedZoom: 0    },
  ],
};

const DEFAULT_PROMPTS: ZonePrompt[] = [
  { id: "exterior", label: "Exterior Perimeter",  keywords: ["exterior", "perimeter", "outside"],           suggestedZoom: 0    },
  { id: "interior", label: "Interior Zones",       keywords: ["interior", "inside", "room"],                 suggestedZoom: 0    },
  { id: "kitchen",  label: "Kitchen / Food Areas", keywords: ["kitchen", "food", "prep"],                    suggestedZoom: 0.25 },
  { id: "storage",  label: "Storage Areas",        keywords: ["storage", "stockroom"],                       suggestedZoom: 0.25 },
  { id: "moisture", label: "Moisture Areas",        keywords: ["moisture", "water", "leak", "drain"],        suggestedZoom: 0.5  },
];

function getPromptsForPropertyType(propertyType: PropertyType): ZonePrompt[] {
  return ZONE_PROMPTS[propertyType] ?? DEFAULT_PROMPTS;
}

// ─── Zone checklist item types ───────────────────────────────────────────────

type ZoneStatus = "pending" | "completed";

interface ZoneItem {
  id: string;
  label: string;
  status: ZoneStatus;
  keywords: string[];
  suggestedZoom?: number;
}

interface Hotspot {
  id: string;
  label: string;
  discoveredAt: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract every text token from an analysis result that could match a zone or
 * hotspot. Covers: finding descriptions, zone labels, coverage slugs, guidance
 * reasons, and species detections — so all the rich AI output drives the HUD.
 */
function extractAnalysisText(analysis: AnalysisResult): string {
  const parts: string[] = [];

  for (const f of analysis.findings ?? []) {
    if (f.description) parts.push(f.description);
    if (f.zone) parts.push(f.zone);
    if (f.category) parts.push(f.category);
    if (f.harborage) parts.push(f.harborage);
    if (f.conduciveCondition) parts.push(f.conduciveCondition);
    if (f.structuralIssue) parts.push(f.structuralIssue);
    if (f.moisture) parts.push(f.moisture);
    if (f.species) parts.push(f.species);
  }

  const coverage = analysis.coverage;
  if (coverage) {
    for (const z of coverage.coveredRequired ?? []) parts.push(z.label ?? z.slug);
    for (const z of (coverage as { coveredOptional?: { label?: string; slug: string }[] }).coveredOptional ?? []) parts.push(z.label ?? z.slug);
  }

  const guidance = analysis.guidance;
  if (guidance?.next) {
    parts.push(guidance.next.title);
    parts.push(guidance.next.reason ?? "");
  }

  return parts.join(" ").toLowerCase();
}

function matchesKeywords(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw.toLowerCase()));
}

/**
 * Derive new-discovery hotspots from the AI analysis. These are unexpected
 * things the AI found that are NOT in the zone checklist — surfaced in amber.
 * Uses findings with severity high/critical, or unique categories not already
 * represented in the pending zones.
 */
function extractHotspots(
  analysis: AnalysisResult,
  zones: ZoneItem[],
  existingHotspots: Hotspot[],
): Hotspot[] {
  const existingIds = new Set(existingHotspots.map((h) => h.id));
  const newHotspots: Hotspot[] = [];

  for (const f of analysis.findings ?? []) {
    const id = `finding-${f.id}`;
    if (existingIds.has(id)) continue;

    // Only surface high-confidence unexpected finds
    const isHighSeverity =
      f.severity === "critical" || f.severity === "high";
    const hasLocation = !!(f.zone || f.harborage);
    if (!(isHighSeverity || hasLocation)) continue;

    // Check if it matches an existing zone — don't duplicate
    const textCheck = [f.description, f.zone, f.category, f.harborage]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const alreadyCovered = zones.some((z) => matchesKeywords(textCheck, z.keywords));
    if (alreadyCovered) continue;

    const labelParts = [f.species, f.category, f.zone ?? f.harborage].filter(Boolean);
    const label =
      labelParts.length > 0
        ? labelParts.join(" · ")
        : f.description?.slice(0, 60) ?? "Unknown finding";

    newHotspots.push({ id, label: `🔴 ${label}`, discoveredAt: Date.now() });
  }

  return newHotspots;
}

// ─── Pulse animation ─────────────────────────────────────────────────────────

function PulsingDot({ color }: { color: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, { toValue: 1.5, duration: 700, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.3, duration: 700, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1, duration: 700, easing: Easing.in(Easing.ease), useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 700, easing: Easing.in(Easing.ease), useNativeDriver: true }),
        ]),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [scale, opacity]);

  return (
    <Animated.View
      style={{
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: color,
        transform: [{ scale }],
        opacity,
      }}
    />
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface CoPilotHUDProps {
  propertyType: string;
  analysis?: AnalysisResult;
  analyzing: boolean;
  photosCount: number;
  /** Called whenever Co-Pilot wants to change the camera zoom level (0–1). */
  onZoomSuggestion?: (zoom: number) => void;
}

export function CoPilotHUD({
  propertyType,
  analysis,
  analyzing,
  photosCount,
  onZoomSuggestion,
}: CoPilotHUDProps) {
  const colors = useColors();

  // Zone checklist — pre-populated from property type, updated by AI analysis
  const [zones, setZones] = useState<ZoneItem[]>(() =>
    getPromptsForPropertyType(propertyType).map((p) => ({
      ...p,
      status: "pending",
    })),
  );

  // Unexpected high-priority finds not in the checklist
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);

  // Reset checklist if the technician changes property type mid-inspection
  const prevPropertyType = useRef(propertyType);
  useEffect(() => {
    if (prevPropertyType.current === propertyType) return;
    prevPropertyType.current = propertyType;
    setZones(
      getPromptsForPropertyType(propertyType).map((p) => ({
        ...p,
        status: "pending",
      })),
    );
    setHotspots([]);
  }, [propertyType]);

  // ── Voice narration ─────────────────────────────────────────────────────────
  const [muted, setMuted] = useState(false);
  const prevGuidanceTitle = useRef<string | null>(null);
  const prevHotspotCount = useRef(0);
  const isFirstMount = useRef(true);

  // Stop any in-flight speech when the component unmounts.
  useEffect(() => {
    return () => { Speech.stop(); };
  }, []);

  // Narrate the next guidance task whenever it changes.
  useEffect(() => {
    const title = analysis?.guidance?.next?.title ?? null;
    if (isFirstMount.current) {
      // Skip narration on initial mount — only speak reactive changes.
      isFirstMount.current = false;
      prevGuidanceTitle.current = title;
      return;
    }
    if (muted || !title || title === prevGuidanceTitle.current) return;
    prevGuidanceTitle.current = title;
    Speech.stop();
    Speech.speak(title, { language: "en-US", rate: 0.88, pitch: 1.0 });
  }, [analysis?.guidance?.next?.title, muted]);

  // Suggest a zoom level to the parent whenever the active guidance zone changes.
  useEffect(() => {
    if (!onZoomSuggestion) return;
    const title = analysis?.guidance?.next?.title;
    if (!title) return;
    const tl = title.toLowerCase();
    const match = zones.find(
      (z) => tl.includes(z.label.toLowerCase()) || z.label.toLowerCase().includes(tl),
    );
    onZoomSuggestion(match?.suggestedZoom ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis?.guidance?.next?.title]);

  // Narrate new hotspot discoveries.
  useEffect(() => {
    if (muted || isFirstMount.current) return;
    if (hotspots.length <= prevHotspotCount.current) {
      prevHotspotCount.current = hotspots.length;
      return;
    }
    prevHotspotCount.current = hotspots.length;
    const newest = hotspots[0];
    if (!newest) return;
    // Strip the emoji prefix before speaking.
    const label = newest.label.replace(/^[^\w\s]+\s*/, "");
    Speech.stop();
    Speech.speak(`Hotspot detected: ${label}`, { language: "en-US", rate: 0.88 });
  }, [hotspots, muted]);

  // Drive checklist from the AI analysis loop
  useEffect(() => {
    if (!analysis) return;
    const analysisText = extractAnalysisText(analysis);

    setZones((prev) =>
      prev.map((z) =>
        z.status === "completed"
          ? z
          : matchesKeywords(analysisText, z.keywords)
            ? { ...z, status: "completed" }
            : z,
      ),
    );

    setHotspots((prev) => {
      const newOnes = extractHotspots(analysis, zones, prev);
      return newOnes.length > 0 ? [...newOnes, ...prev] : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis]);

  const completedCount = zones.filter((z) => z.status === "completed").length;
  const totalCount = zones.length;
  const allDone = completedCount === totalCount;

  type ListItem =
    | { type: "header_processing" }
    | { type: "header_progress" }
    | { type: "hotspot"; data: Hotspot }
    | { type: "zone"; data: ZoneItem };

  const listData: ListItem[] = [
    { type: "header_processing" } as ListItem,
    { type: "header_progress" } as ListItem,
    ...hotspots.map((h): ListItem => ({ type: "hotspot", data: h })),
    ...zones.map((z): ListItem => ({ type: "zone", data: z })),
  ];

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === "header_processing") {
      return (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
          }}
        >
          {analyzing ? (
            <PulsingDot color={colors.primary} />
          ) : (
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: photosCount > 0 ? colors.success : colors.border,
              }}
            />
          )}
          <Text
            style={{
              color: analyzing ? colors.primary : colors.mutedForeground,
              fontFamily: "Inter_600SemiBold",
              fontSize: 11,
              letterSpacing: 0.8,
            }}
          >
            {analyzing
              ? "ANALYZING…"
              : photosCount === 0
                ? "WAITING FOR PHOTOS"
                : "LIVE · UP TO DATE"}
          </Text>
        </View>
      );
    }

    if (item.type === "header_progress") {
      return (
        <View style={{ marginBottom: 12, gap: 6 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "Inter_700Bold",
                fontSize: 13,
                letterSpacing: 0.4,
              }}
            >
              ZONE CHECKLIST
            </Text>
            <Text
              style={{
                color: allDone ? (colors.success ?? "#3fb950") : colors.primary,
                fontFamily: "Inter_600SemiBold",
                fontSize: 12,
              }}
            >
              {completedCount}/{totalCount}
            </Text>
          </View>
          {/* Progress bar */}
          <View
            style={{
              height: 3,
              borderRadius: 2,
              backgroundColor: colors.border,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: "100%",
                width: totalCount > 0 ? `${(completedCount / totalCount) * 100}%` : "0%",
                borderRadius: 2,
                backgroundColor: allDone ? (colors.success ?? "#3fb950") : colors.primary,
              }}
            />
          </View>
          {hotspots.length > 0 && (
            <Text
              style={{
                color: colors.warning,
                fontFamily: "Inter_600SemiBold",
                fontSize: 11,
                letterSpacing: 0.4,
                marginTop: 4,
              }}
            >
              ▲ {hotspots.length} NEW HOTSPOT{hotspots.length !== 1 ? "S" : ""} DETECTED
            </Text>
          )}
        </View>
      );
    }

    if (item.type === "hotspot") {
      return (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingVertical: 8,
            paddingHorizontal: 10,
            borderRadius: 8,
            backgroundColor: colors.warning + "18",
            borderWidth: 1,
            borderColor: colors.warning + "55",
            marginBottom: 6,
          }}
        >
          <Ionicons name="alert-circle" size={16} color={colors.warning} />
          <Text
            style={{
              flex: 1,
              color: colors.foreground,
              fontFamily: "Inter_500Medium",
              fontSize: 13,
              lineHeight: 17,
            }}
            numberOfLines={2}
          >
            {item.data.label}
          </Text>
        </View>
      );
    }

    if (item.type === "zone") {
      const z = item.data;
      const done = z.status === "completed";
      return (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingVertical: 9,
            paddingHorizontal: 2,
            borderBottomWidth: 1,
            borderBottomColor: colors.border + "66",
          }}
        >
          {done ? (
            <Ionicons name="checkmark-circle" size={18} color={colors.success ?? "#3fb950"} />
          ) : (
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 9,
                borderWidth: 1.5,
                borderColor: colors.mutedForeground + "88",
              }}
            />
          )}
          <Text
            style={{
              flex: 1,
              color: done ? (colors.success ?? "#3fb950") : colors.mutedForeground,
              fontFamily: done ? "Inter_600SemiBold" : "Inter_400Regular",
              fontSize: 14,
            }}
          >
            {z.label}
          </Text>
        </View>
      );
    }

    return null;
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header bar */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: 10,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Ionicons name="navigate-circle" size={18} color={colors.primary} />
        <Text
          style={{
            color: colors.foreground,
            fontFamily: "Inter_700Bold",
            fontSize: 16,
            flex: 1,
          }}
        >
          Co-Pilot
        </Text>
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: "Inter_400Regular",
            fontSize: 12,
          }}
        >
          {propertyType}
        </Text>
        <Pressable
          onPress={() => {
            if (!muted) Speech.stop();
            setMuted((m) => !m);
          }}
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: muted ? colors.card : colors.accent,
            borderWidth: 1,
            borderColor: muted ? colors.border : colors.primary + "66",
            alignItems: "center",
            justifyContent: "center",
          }}
          accessibilityLabel={muted ? "Unmute Co-Pilot voice" : "Mute Co-Pilot voice"}
        >
          <Ionicons
            name={muted ? "volume-mute-outline" : "volume-medium-outline"}
            size={15}
            color={muted ? colors.mutedForeground : colors.primary}
          />
        </Pressable>
      </View>

      <FlatList
        data={listData}
        keyExtractor={(item, index) => {
          if (item.type === "hotspot") return `hotspot-${item.data.id}`;
          if (item.type === "zone") return `zone-${item.data.id}`;
          return `header-${item.type}-${index}`;
        }}
        renderItem={renderItem}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: 32,
        }}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}
