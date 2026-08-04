import { Ionicons } from "@expo/vector-icons";
import type { AnalysisResult, CoverageSnapshot, EvidenceSummary, Finding, GuidanceRecommendation, InspectionMemory, MemoryHighlight, Report } from "@/lib/api-client";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { FindingCard } from "@/components/FindingCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useColors } from "@/hooks/useColors";
import { confidencePct, formatStatus, severityTone } from "@/constants/inspection";

interface AiInsightsPanelProps {
  siteAddress: string;
  propertyType: string;
  pestTypes: string[];
  photosCount: number;
  /** Photos captured since the last analysis run. */
  pendingCount: number;
  analysis?: AnalysisResult;
  analyzing: boolean;
  error: string | null;
  /** Live service report — auto-built after each analysis run. */
  report?: Report | null;
  reportBuilding: boolean;
  reportError: string | null;
  onRunAnalysis: () => void;
  onReview: () => void;
}

const FINDING_GROUPS: { title: string; icon: keyof typeof Ionicons.glyphMap; test: RegExp }[] = [
  {
    title: "Pest species & activity",
    icon: "bug-outline",
    test: /pest|rodent|mouse|mice|rat|roach|termite|ant\b|ants|bed ?bug|flies|fly\b|spider|wildlife|species|activity|dropping|gnaw|infestation/i,
  },
  {
    title: "Conducive conditions",
    icon: "warning-outline",
    test: /conducive|sanitation|food|clutter|debris|vegetation|waste|garbage/i,
  },
  { title: "Harborage", icon: "home-outline", test: /harborage|nest|shelter|void/i },
  { title: "Moisture", icon: "water-outline", test: /moisture|water|leak|damp|humid|condensation/i },
  {
    title: "Structural issues",
    icon: "construct-outline",
    test: /structur|entry point|exclusion|gap|crack|seal|hole|opening|damage/i,
  },
];

function groupFindings(findings: Finding[]) {
  const groups: { title: string; icon: keyof typeof Ionicons.glyphMap; items: Finding[] }[] =
    FINDING_GROUPS.map((g) => ({ title: g.title, icon: g.icon, items: [] }));
  const other: Finding[] = [];
  for (const f of findings) {
    const idx = FINDING_GROUPS.findIndex((g) => g.test.test(f.category ?? ""));
    if (idx >= 0) groups[idx].items.push(f);
    else other.push(f);
  }
  const result = groups.filter((g) => g.items.length > 0);
  if (other.length) result.push({ title: "Other findings", icon: "search-outline", items: other });
  return result;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Case-insensitive dedupe of non-empty detection strings, keeping first casing. */
function dedupeDetections(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    const trimmed = v.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** Unique species with the best (max) confidence the model assigned each one. */
function speciesWithConfidence(findings: Finding[]): { name: string; confidence: number }[] {
  const out: { name: string; confidence: number }[] = [];
  for (const f of findings) {
    const name = (f.species ?? "").trim();
    if (!name) continue;
    const existing = out.find((e) => e.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      existing.confidence = Math.max(existing.confidence, f.confidence ?? 0);
    } else {
      out.push({ name, confidence: f.confidence ?? 0 });
    }
  }
  return out;
}

interface RoomStatus {
  slug: string;
  label: string;
  covered: boolean;
}

/** Full room checklist: every required zone with its ✓ covered / Missing state. */
function roomChecklist(coverage: CoverageSnapshot | null | undefined): RoomStatus[] {
  if (!coverage) return [];
  const covered = new Set(coverage.coveredRequired.map((z) => z.slug));
  return coverage.requiredZones.map((z) => ({
    slug: z.slug,
    label: z.label,
    covered: covered.has(z.slug),
  }));
}

interface EvidenceChip {
  key: string;
  label: string;
  count: number;
}

/**
 * Flatten the evidence summary into count chips for the live board. Pest species
 * and structural defects surface per-label ("5 Rodent", "1 Pipe gap"); moisture
 * and exclusion surface as a single group total ("3 Moisture") since their free
 * text is usually all-unique. Group totals are independent — never summed.
 */
function evidenceChips(evidence: EvidenceSummary | null | undefined): EvidenceChip[] {
  if (!evidence) return [];
  const chips: EvidenceChip[] = [];
  for (const g of evidence.groups) {
    if (g.key === "pests" || g.key === "structural") {
      for (const it of g.items) chips.push({ key: `${g.key}:${it.key}`, label: it.label, count: it.count });
    } else {
      chips.push({ key: g.key, label: g.label, count: g.total });
    }
  }
  return chips;
}

/**
 * Icon per Live Guidance category. The callout only ever shows ONE task, so the
 * icon just cues the kind of next-action (exclusion, moisture, room, etc.).
 */
const GUIDANCE_ICON: Record<
  GuidanceRecommendation["category"],
  React.ComponentProps<typeof Ionicons>["name"]
> = {
  missing_exclusion: "shield-outline",
  missing_moisture: "water-outline",
  conducive: "construct-outline",
  missing_room: "scan-outline",
  bait_stations: "bug-outline",
  missing_evidence: "camera-outline",
  suggested_room: "add-circle-outline",
  // Inspection Memory categories — the next task is driven by a prior-visit gap.
  memory_rodent: "paw-outline",
  memory_bait: "shield-half-outline",
  memory_activity: "time-outline",
};

function guidanceIcon(
  category: GuidanceRecommendation["category"],
): React.ComponentProps<typeof Ionicons>["name"] {
  return GUIDANCE_ICON[category] ?? "compass-outline";
}

/** Icon per Inspection Memory gap highlight type. */
const MEMORY_HIGHLIGHT_ICON: Record<
  MemoryHighlight["type"],
  React.ComponentProps<typeof Ionicons>["name"]
> = {
  rodent_area_not_photographed: "paw-outline",
  bait_station_missing: "shield-half-outline",
  area_not_inspected: "alert-circle-outline",
};

function memoryHighlightIcon(
  type: MemoryHighlight["type"],
): React.ComponentProps<typeof Ionicons>["name"] {
  return MEMORY_HIGHLIGHT_ICON[type] ?? "alert-circle-outline";
}

/** "Mar 3, 2026" for the last-visit line; empty string when the date is absent. */
function formatMemoryDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

/** One remembered SHOW row: a label + verbatim prior-visit values (never faked). */
interface MemoryShowRow {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  values: string[];
}

/**
 * Build the remembered SHOW rows from prior visits. Each value is composed from
 * real prior findings/notes only — species counts, zones, and recency are shown,
 * but nothing (e.g. an enumerated bait-station number) is ever invented.
 */
function memoryShowRows(memory: InspectionMemory): MemoryShowRow[] {
  const zoneSuffix = (zone: string | null) => (zone ? ` · ${prettifyZoneLabel(zone)}` : "");
  const rows: MemoryShowRow[] = [
    {
      key: "pests",
      icon: "bug-outline",
      label: "Previous pest activity",
      values: memory.pestActivity.map((p) => {
        const times = `${p.visits} visit${p.visits === 1 ? "" : "s"}`;
        return `${p.label} · ${times}${p.severity ? ` · ${p.severity}` : ""}${zoneSuffix(p.zone)}`;
      }),
    },
    {
      key: "bait",
      icon: "shield-half-outline",
      label: "Rodent monitoring / bait references",
      values: memory.baitStations.map((b) => `${b.description}${zoneSuffix(b.zone)}`),
    },
    {
      key: "entry",
      icon: "construct-outline",
      label: "Entry points / exclusion",
      values: memory.entryPoints.map((e) => `${e.description}${zoneSuffix(e.zone)}`),
    },
    {
      key: "recs",
      icon: "bulb-outline",
      label: "Previous recommendations",
      values: memory.recommendations.map((r) => r.text),
    },
    {
      key: "treatments",
      icon: "medkit-outline",
      label: "Previous treatments",
      values: memory.treatments.map((t) => t.text),
    },
  ];
  return rows.filter((r) => r.values.length > 0);
}

/** Prettify a zone slug ("attic_roofline" -> "Attic Roofline") for display. */
function prettifyZoneLabel(slug: string): string {
  return slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function AiInsightsPanel({
  siteAddress,
  propertyType,
  pestTypes,
  photosCount,
  pendingCount,
  analysis,
  analyzing,
  error,
  report,
  reportBuilding,
  reportError,
  onRunAnalysis,
  onReview,
}: AiInsightsPanelProps) {
  const colors = useColors();
  const [tab, setTab] = useState<"insights" | "report">("insights");
  const findings = analysis?.findings ?? [];
  const grouped = groupFindings(findings);
  const narrative = report?.aiNarrative ?? null;
  const coverage = analysis?.coverage ?? null;
  const evidence = analysis?.evidence ?? null;
  const guidance = analysis?.guidance ?? null;
  const memory = analysis?.memory ?? null;
  const rooms = roomChecklist(coverage);
  const chips = evidenceChips(evidence);
  // Inspection Memory — prior-visit context for this address, with gap
  // highlights first. Only rendered once there is real history to remember.
  // Suppressed when the AI run had errors: a failed analysis leaves all zones
  // uncovered, which would cause every prior-visit zone to appear as a gap —
  // false urgency that misleads the technician. Once the error clears (next
  // successful analysis run) the highlights return automatically.
  const memoryShows = (memory?.hasPriorVisits && !analysis?.analysisErrors)
    ? memoryShowRows(memory)
    : [];
  // Incremental progress copy — while a run is in flight we show how many of
  // the captured photos it is working through, so the technician sees the
  // batch advancing rather than a bare spinner.
  const analyzingCount = pendingCount > 0 ? pendingCount : photosCount;
  const analyzingLabel =
    analyzing && analyzingCount > 0
      ? `Analyzing ${analyzingCount} of ${photosCount}`
      : "Analyzing";

  // Live AI Inspection Panel — every value is aggregated straight from the
  // model's per-photo detections. Nothing is inferred client-side; a row is
  // empty until a real detection populates it.
  // Memoized: dedupeDetections + speciesWithConfidence run O(n) per call.
  // On large inspections (40+ photos) these were re-running on every render
  // cycle (scroll, timer, state change) — visible as UI thread frame drops.
  const species = useMemo(() => speciesWithConfidence(findings), [findings]);
  const detectionRows: {
    key: string;
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    values: string[];
  }[] = useMemo(() => [
    {
      key: "species",
      icon: "bug-outline",
      label: "Species detected",
      values: species.map((s) => `${s.name} · ${Math.round(s.confidence * 100)}% confidence`),
    },
    {
      key: "lifeStage",
      icon: "git-branch-outline",
      label: "Life stage",
      values: dedupeDetections(findings.map((f) => f.lifeStage)),
    },
    {
      key: "conducive",
      icon: "warning-outline",
      label: "Conducive conditions",
      values: dedupeDetections(findings.map((f) => f.conduciveCondition)),
    },
    {
      key: "harborage",
      icon: "home-outline",
      label: "Harborage",
      values: dedupeDetections(findings.map((f) => f.harborage)),
    },
    {
      key: "moisture",
      icon: "water-outline",
      label: "Moisture",
      values: dedupeDetections(findings.map((f) => f.moisture)),
    },
    {
      key: "structural",
      icon: "construct-outline",
      label: "Structural issues",
      values: dedupeDetections(findings.map((f) => f.structuralIssue)),
    },
    {
      key: "treatment",
      icon: "medkit-outline",
      label: "Recommended treatment",
      values: analysis?.recommendations ?? [],
    },
  ], [species, findings, analysis?.recommendations]);

  // Live report sections — every value comes from the server-generated
  // narrative, which is grounded in real detections and inspection data.
  const reportSections: {
    title: string;
    icon: keyof typeof Ionicons.glyphMap;
    body?: string;
    list?: string[];
  }[] = narrative
    ? [
        { title: "Inspection summary", icon: "reader-outline", body: narrative.executiveSummary },
        { title: "Evidence", icon: "eye-outline", body: narrative.evidenceObserved },
        {
          title: "Conducive conditions",
          icon: "warning-outline",
          body: narrative.conduciveConditions || narrative.sanitationConcerns,
        },
        {
          title: "Treatment recommendations",
          icon: "medkit-outline",
          list: narrative.recommendedCorrectiveActions,
        },
        {
          title: "Customer recommendations",
          icon: "people-outline",
          list: narrative.customerRecommendations ?? [],
        },
      ]
    : [];

  const tabButton = (key: "insights" | "report", label: string) => {
    const active = tab === key;
    return (
      <Pressable
        key={key}
        onPress={() => setTab(key)}
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          paddingVertical: 8,
          borderRadius: 8,
          backgroundColor: active ? colors.card : "transparent",
        }}
      >
        <Text
          style={{
            color: active ? colors.foreground : colors.mutedForeground,
            fontFamily: active ? "Inter_600SemiBold" : "Inter_500Medium",
            fontSize: 13,
          }}
        >
          {label}
        </Text>
        {key === "report" && reportBuilding ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : key === "report" && narrative ? (
          <View
            style={{
              width: 7,
              height: 7,
              borderRadius: 4,
              backgroundColor: colors.primary,
            }}
          />
        ) : null}
      </Pressable>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 32 }}>
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
            <Ionicons name="sparkles" size={18} color={colors.primary} />
            <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 18 }}>
              AI Insights
            </Text>
          </View>
          <Badge
            label={analyzing ? "Analyzing" : analysis ? formatStatus(analysis.status) : "Standby"}
            tone={analyzing ? "info" : analysis ? "success" : "default"}
          />
        </View>

        {/* Insights / Live report tab switch */}
        <View
          style={{
            flexDirection: "row",
            backgroundColor: colors.muted,
            borderRadius: 10,
            padding: 3,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          {tabButton("insights", "Insights")}
          {tabButton("report", "Live report")}
        </View>

        {tab === "insights" ? (
          <>
            {/* Live Guidance Engine — ONE prioritized next inspection task at a
                time, derived server-side from the live AI state (coverage +
                findings + analyzed photos). It refreshes automatically whenever a
                new analysis lands, so the technician always sees the single most
                important thing to do next — no page refresh. */}
            <Card style={{ gap: 12, borderColor: colors.primary, backgroundColor: colors.accent }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="compass" size={16} color={colors.primary} />
                <Text
                  style={{
                    color: colors.primary,
                    fontFamily: "Inter_700Bold",
                    fontSize: 13,
                    letterSpacing: 0.6,
                    flex: 1,
                  }}
                >
                  LIVE GUIDANCE
                </Text>
                {analyzing ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Badge label={analysis ? "Live" : "Standby"} tone={analysis ? "success" : "default"} />
                )}
              </View>

              {guidance?.next ? (
                <>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        backgroundColor: colors.background,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name={guidanceIcon(guidance.next.category)} size={20} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text
                        style={{
                          color: colors.mutedForeground,
                          fontFamily: "Inter_500Medium",
                          fontSize: 11,
                          letterSpacing: 0.5,
                        }}
                      >
                        NEXT INSPECTION TASK
                      </Text>
                      <Text
                        style={{
                          color: colors.foreground,
                          fontFamily: "Inter_700Bold",
                          fontSize: 17,
                          lineHeight: 22,
                        }}
                      >
                        {guidance.next.title}
                      </Text>
                      <Text
                        style={{
                          color: colors.mutedForeground,
                          fontFamily: "Inter_400Regular",
                          fontSize: 12,
                          lineHeight: 16,
                        }}
                      >
                        {guidance.next.reason}
                      </Text>
                    </View>
                  </View>
                  {guidance.remaining > 0 ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Ionicons name="layers-outline" size={13} color={colors.mutedForeground} />
                      <Text
                        style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12 }}
                      >
                        {guidance.remaining} more priorit{guidance.remaining === 1 ? "y" : "ies"} queued
                      </Text>
                    </View>
                  ) : null}
                </>
              ) : analysis ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Ionicons name="checkmark-circle" size={22} color={colors.success ?? colors.primary} />
                  <Text
                    style={{
                      color: colors.foreground,
                      fontFamily: "Inter_500Medium",
                      fontSize: 14,
                      flex: 1,
                      lineHeight: 19,
                    }}
                  >
                    All required areas covered — review findings and finalize.
                  </Text>
                </View>
              ) : (
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontFamily: "Inter_400Regular",
                    fontSize: 13,
                    lineHeight: 18,
                  }}
                >
                  Run AI analysis to get your next inspection step.
                </Text>
              )}
            </Card>

            {/* Inspection Memory — prior-visit context for THIS address (same
                company only). Gap highlights come first (a previously-active area
                not inspected today, a documented monitoring reference not
                re-documented, a rodent area not photographed) and are the same
                signals driving the memory-driven "next task" above. Everything
                below the gaps is remembered verbatim from earlier visits — no
                fabricated station numbers. Renders only when history exists. */}
            {memory?.hasPriorVisits ? (
              <Card style={{ gap: 12, borderColor: colors.warning, backgroundColor: colors.card }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="time" size={16} color={colors.warning} />
                  <Text
                    style={{
                      color: colors.warning,
                      fontFamily: "Inter_700Bold",
                      fontSize: 13,
                      letterSpacing: 0.6,
                      flex: 1,
                    }}
                  >
                    INSPECTION MEMORY
                  </Text>
                  <Badge
                    label={`${memory.priorVisitCount} prior visit${memory.priorVisitCount === 1 ? "" : "s"}`}
                    tone="warning"
                  />
                </View>

                {memory.lastVisitDate ? (
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontFamily: "Inter_400Regular",
                      fontSize: 12,
                    }}
                  >
                    Last visit {formatMemoryDate(memory.lastVisitDate)} · same address
                  </Text>
                ) : null}

                {/* GAPS — the highlights, first and most prominent. */}
                {memory.highlights.length > 0 ? (
                  <View style={{ gap: 8 }}>
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontFamily: "Inter_500Medium",
                        fontSize: 11,
                        letterSpacing: 0.5,
                      }}
                    >
                      GAPS VS. TODAY
                    </Text>
                    {memory.highlights.map((h) => (
                      <View
                        key={h.id}
                        style={{
                          flexDirection: "row",
                          alignItems: "flex-start",
                          gap: 10,
                          backgroundColor: colors.accent,
                          borderRadius: 10,
                          borderLeftWidth: 3,
                          borderLeftColor: colors.warning,
                          padding: 10,
                        }}
                      >
                        <Ionicons
                          name={memoryHighlightIcon(h.type)}
                          size={18}
                          color={colors.warning}
                        />
                        <Text
                          style={{
                            color: colors.foreground,
                            fontFamily: "Inter_500Medium",
                            fontSize: 13,
                            lineHeight: 18,
                            flex: 1,
                          }}
                        >
                          {h.message}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontFamily: "Inter_400Regular",
                        fontSize: 13,
                        lineHeight: 18,
                        flex: 1,
                      }}
                    >
                      Every remembered area has been re-covered today.
                    </Text>
                  </View>
                )}

                {/* SHOW — remembered prior-visit context, verbatim. */}
                {memoryShows.map((row) => (
                  <View
                    key={row.key}
                    style={{ gap: 6, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Ionicons name={row.icon} size={14} color={colors.mutedForeground} />
                      <Text
                        style={{
                          color: colors.mutedForeground,
                          fontFamily: "Inter_500Medium",
                          fontSize: 12,
                        }}
                      >
                        {row.label}
                      </Text>
                    </View>
                    <View style={{ gap: 4, paddingLeft: 20 }}>
                      {row.values.map((v, i) => (
                        <Text
                          key={`${row.key}:${i}`}
                          style={{
                            color: colors.foreground,
                            fontFamily: "Inter_400Regular",
                            fontSize: 13,
                            lineHeight: 18,
                          }}
                        >
                          {v}
                        </Text>
                      ))}
                    </View>
                  </View>
                ))}
              </Card>
            ) : null}

            {/* AI Inspection Engine — the consolidated, real-time state of the
                live inspection. Progress, room classification and the evidence
                tally all update automatically as photos are analyzed; nothing
                here is entered by hand. */}
            <Card style={{ gap: 14 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="pulse" size={16} color={colors.primary} />
                <Text
                  style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 15, flex: 1 }}
                >
                  AI Inspection Engine
                </Text>
                {analyzing ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={{ color: colors.primary, fontFamily: "Inter_500Medium", fontSize: 12 }}>
                      Live
                    </Text>
                  </View>
                ) : (
                  <Badge label={analysis ? "Live" : "Standby"} tone={analysis ? "success" : "default"} />
                )}
              </View>

              {/* Inspection progress */}
              <View style={{ gap: 6 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-end",
                    justifyContent: "space-between",
                  }}
                >
                  <Text
                    style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12 }}
                  >
                    Inspection Progress
                  </Text>
                  <Text
                    style={{
                      color: colors.foreground,
                      fontFamily: "Inter_700Bold",
                      fontSize: 34,
                      lineHeight: 38,
                    }}
                  >
                    {coverage ? `${coverage.completenessPct}%` : "—"}
                  </Text>
                </View>
                <View
                  style={{ height: 8, borderRadius: 4, backgroundColor: colors.muted, overflow: "hidden" }}
                >
                  <View
                    style={{
                      height: 8,
                      borderRadius: 4,
                      width: `${coverage ? Math.max(0, Math.min(100, coverage.completenessPct)) : 0}%`,
                      backgroundColor:
                        coverage && coverage.completenessPct >= 100
                          ? colors.success ?? colors.primary
                          : colors.primary,
                    }}
                  />
                </View>
                {coverage ? (
                  <Text
                    style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}
                  >
                    {coverage.coveredRequired.length} of {coverage.requiredZones.length} required zone
                    {coverage.requiredZones.length === 1 ? "" : "s"} captured
                  </Text>
                ) : (
                  <Text
                    style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}
                  >
                    Run AI analysis to start the live engine.
                  </Text>
                )}
              </View>

              {/* Room classification checklist */}
              {rooms.length > 0 ? (
                <View
                  style={{ gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}
                >
                  <Text
                    style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12 }}
                  >
                    Room classification
                  </Text>
                  <View style={{ gap: 6 }}>
                    {rooms.map((r) => (
                      <View
                        key={r.slug}
                        style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                      >
                        <Ionicons
                          name={r.covered ? "checkmark-circle" : "ellipse-outline"}
                          size={16}
                          color={r.covered ? colors.success ?? colors.primary : colors.mutedForeground}
                        />
                        <Text
                          style={{
                            color: colors.foreground,
                            fontFamily: "Inter_400Regular",
                            fontSize: 13,
                            flex: 1,
                          }}
                        >
                          {r.label}
                        </Text>
                        <Text
                          style={{
                            color: r.covered ? colors.success ?? colors.primary : colors.mutedForeground,
                            fontFamily: "Inter_600SemiBold",
                            fontSize: 12,
                          }}
                        >
                          {r.covered ? "Captured" : "Missing"}
                        </Text>
                      </View>
                    ))}
                  </View>
                  {coverage && coverage.suggested.length > 0 ? (
                    <View style={{ gap: 6 }}>
                      <Text
                        style={{
                          color: colors.mutedForeground,
                          fontFamily: "Inter_500Medium",
                          fontSize: 12,
                        }}
                      >
                        Also suggested
                      </Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                        {coverage.suggested.map((z) => (
                          <Badge key={z.slug} label={z.label} tone="default" />
                        ))}
                      </View>
                    </View>
                  ) : null}
                </View>
              ) : null}

              {/* Evidence tally */}
              <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontFamily: "Inter_500Medium",
                      fontSize: 12,
                      flex: 1,
                    }}
                  >
                    Evidence tally
                  </Text>
                  {evidence ? (
                    <Text
                      style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12 }}
                    >
                      {evidence.totalEvidence} item{evidence.totalEvidence === 1 ? "" : "s"}
                    </Text>
                  ) : null}
                </View>
                {chips.length > 0 ? (
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {chips.map((c) => (
                      <View
                        key={c.key}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 6,
                          backgroundColor: colors.muted,
                          borderRadius: 999,
                          paddingVertical: 5,
                          paddingHorizontal: 10,
                        }}
                      >
                        <Text
                          style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 13 }}
                        >
                          {c.count}
                        </Text>
                        <Text
                          style={{
                            color: colors.mutedForeground,
                            fontFamily: "Inter_500Medium",
                            fontSize: 12,
                          }}
                        >
                          {c.label}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text
                    style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}
                  >
                    {analysis ? "No evidence detected yet." : "—"}
                  </Text>
                )}
              </View>
            </Card>

            {/* AI Inspection Panel — live detection board. The technician's job
                is to verify these, not to manually describe what the camera
                already sees. Every value comes from real model detections. */}
            <Card style={{ gap: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="scan-outline" size={16} color={colors.primary} />
                <Text
                  style={{
                    color: colors.foreground,
                    fontFamily: "Inter_700Bold",
                    fontSize: 15,
                    flex: 1,
                  }}
                >
                  AI Inspection Panel
                </Text>
                {analyzing ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={{ color: colors.primary, fontFamily: "Inter_500Medium", fontSize: 12 }}>
                      {analyzingLabel}
                    </Text>
                  </View>
                ) : (
                  <Badge label={analysis ? "Live" : "Standby"} tone={analysis ? "success" : "default"} />
                )}
              </View>

              {/* Risk level + confidence */}
              <View style={{ flexDirection: "row", gap: 16 }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12 }}>
                    Risk level
                  </Text>
                  {analysis?.riskLevel ? (
                    <Badge label={formatStatus(analysis.riskLevel)} tone={severityTone(analysis.riskLevel)} />
                  ) : (
                    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                      {analysis ? "No risk detected yet" : "—"}
                    </Text>
                  )}
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12 }}>
                    Confidence
                  </Text>
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 17 }}>
                    {analysis ? confidencePct(analysis.overallConfidence) : "—"}
                  </Text>
                </View>
              </View>

              {/* Detection rows */}
              {detectionRows.map((row) => (
                <View
                  key={row.key}
                  style={{
                    gap: 4,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                    paddingTop: 10,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Ionicons name={row.icon} size={14} color={colors.primary} />
                    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12 }}>
                      {row.label}
                    </Text>
                  </View>
                  {row.values.length > 0 ? (
                    row.values.map((v, i) => (
                      <Text
                        key={i}
                        style={{
                          color: colors.foreground,
                          fontFamily: "Inter_400Regular",
                          fontSize: 13,
                          lineHeight: 19,
                        }}
                      >
                        {v}
                      </Text>
                    ))
                  ) : (
                    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                      {analysis ? "None detected" : "—"}
                    </Text>
                  )}
                </View>
              ))}

              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: "Inter_400Regular",
                  fontSize: 11,
                  lineHeight: 16,
                }}
              >
                Detections update automatically as you capture. Your job is to verify — not to
                describe what the camera already sees.
              </Text>
            </Card>

            {/* Inspection context */}
            <Card style={{ gap: 8 }}>
              <Text
                numberOfLines={1}
                style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}
              >
                {siteAddress}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <Badge label={propertyType} tone="default" />
                {pestTypes.map((p) => (
                  <Badge key={p} label={p} tone="default" />
                ))}
              </View>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                {photosCount} photo{photosCount === 1 ? "" : "s"} captured
                {analyzing && analyzingCount > 0
                  ? ` · analyzing ${analyzingCount} of ${photosCount}`
                  : analysis && pendingCount > 0
                    ? ` · ${pendingCount} not yet analyzed`
                    : ""}
              </Text>
            </Card>

            {/* Run / re-run analysis */}
            {!analysis || pendingCount > 0 ? (
              <Card style={{ gap: 12 }}>
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontFamily: "Inter_400Regular",
                    fontSize: 13,
                    lineHeight: 19,
                    textAlign: "center",
                  }}
                >
                  {photosCount === 0
                    ? "Capture evidence photos to run AI analysis."
                    : analysis
                      ? "New photos captured since the last analysis."
                      : "Photos upload securely, then AI detects pest activity and conditions. Keep capturing while it runs."}
                </Text>
                <Button
                  title={
                    analyzing
                      ? "Analyzing…"
                      : analysis
                        ? "Re-run AI analysis"
                        : `Run AI analysis (${photosCount} photo${photosCount === 1 ? "" : "s"})`
                  }
                  icon="sparkles"
                  loading={analyzing}
                  disabled={photosCount === 0 || analyzing}
                  onPress={onRunAnalysis}
                />
              </Card>
            ) : null}

            {error ? (
              <Text style={{ color: colors.destructive, fontSize: 13, textAlign: "center" }}>{error}</Text>
            ) : null}

            {/* Results */}
            {analysis ? (
              <>
                {grouped.length === 0 ? (
                  <Card>
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontFamily: "Inter_400Regular",
                        fontSize: 13,
                        textAlign: "center",
                      }}
                    >
                      No findings detected in the analyzed photos.
                    </Text>
                  </Card>
                ) : (
                  grouped.map((g) => (
                    <View key={g.title} style={{ gap: 10 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Ionicons name={g.icon} size={15} color={colors.primary} />
                        <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                          {g.title}
                        </Text>
                        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12 }}>
                          {g.items.length}
                        </Text>
                      </View>
                      {g.items.map((f) => (
                        <FindingCard key={f.id} finding={f} />
                      ))}
                    </View>
                  ))
                )}

                {analysis.recommendations?.length ? (
                  <Card style={{ gap: 8 }}>
                    <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                      Suggested treatment
                    </Text>
                    {analysis.recommendations.map((r, i) => (
                      <View key={i} style={{ flexDirection: "row", gap: 8 }}>
                        <Text style={{ color: colors.primary, fontSize: 13, lineHeight: 19 }}>•</Text>
                        <Text
                          style={{
                            color: colors.mutedForeground,
                            fontFamily: "Inter_400Regular",
                            fontSize: 13,
                            lineHeight: 19,
                            flex: 1,
                          }}
                        >
                          {r}
                        </Text>
                      </View>
                    ))}
                  </Card>
                ) : null}
              </>
            ) : null}

            {/* Report status */}
            <Card style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Ionicons name="document-text-outline" size={18} color={colors.mutedForeground} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                  Report status
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                  {narrative
                    ? "Building live from verified findings. See the Live report tab."
                    : reportBuilding
                      ? "Writing the service report from verified findings…"
                      : "Builds automatically after each AI analysis run."}
                </Text>
              </View>
              <Badge
                label={reportBuilding ? "Updating" : narrative ? "Live draft" : "Not started"}
                tone={reportBuilding ? "info" : narrative ? "success" : "warning"}
              />
            </Card>
          </>
        ) : (
          <>
            {/* Live report */}
            {reportError ? (
              <Text style={{ color: colors.destructive, fontSize: 13, textAlign: "center" }}>
                {reportError}
              </Text>
            ) : null}

            {!narrative && !reportBuilding ? (
              <Card style={{ gap: 8, alignItems: "center", paddingVertical: 24 }}>
                <Ionicons name="document-text-outline" size={28} color={colors.mutedForeground} />
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontFamily: "Inter_400Regular",
                    fontSize: 13,
                    lineHeight: 19,
                    textAlign: "center",
                  }}
                >
                  The service report writes itself from verified findings after each AI analysis
                  run. Capture photos and run analysis to start it.
                </Text>
              </Card>
            ) : null}

            {!narrative && reportBuilding ? (
              <Card style={{ gap: 10, alignItems: "center", paddingVertical: 24 }}>
                <ActivityIndicator color={colors.primary} />
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontFamily: "Inter_400Regular",
                    fontSize: 13,
                    textAlign: "center",
                  }}
                >
                  Writing the service report from verified findings…
                </Text>
              </Card>
            ) : null}

            {narrative ? (
              <>
                <Card style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Ionicons
                    name={reportBuilding ? "sync-outline" : "checkmark-circle-outline"}
                    size={18}
                    color={reportBuilding ? colors.primary : colors.success ?? colors.primary}
                  />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                      {report?.title ?? "Service report"}
                    </Text>
                    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                      {reportBuilding
                        ? "Updating with the latest findings…"
                        : `Updated ${formatTime(narrative.generatedAt)} · grounded in ${photosCount} photo${photosCount === 1 ? "" : "s"} + AI detections`}
                    </Text>
                  </View>
                  <Badge label="Draft" tone={reportBuilding ? "info" : "default"} />
                </Card>

                {reportSections.map((s) => (
                  <Card key={s.title} style={{ gap: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Ionicons name={s.icon} size={15} color={colors.primary} />
                      <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                        {s.title}
                      </Text>
                    </View>
                    {s.body != null ? (
                      <Text
                        selectable
                        style={{
                          color: colors.mutedForeground,
                          fontFamily: "Inter_400Regular",
                          fontSize: 13,
                          lineHeight: 20,
                        }}
                      >
                        {s.body.trim().length > 0 ? s.body : "No supporting data recorded yet."}
                      </Text>
                    ) : (s.list?.length ?? 0) > 0 ? (
                      s.list!.map((item, i) => (
                        <View key={i} style={{ flexDirection: "row", gap: 8 }}>
                          <Text style={{ color: colors.primary, fontSize: 13, lineHeight: 20 }}>•</Text>
                          <Text
                            style={{
                              color: colors.mutedForeground,
                              fontFamily: "Inter_400Regular",
                              fontSize: 13,
                              lineHeight: 20,
                              flex: 1,
                            }}
                          >
                            {item}
                          </Text>
                        </View>
                      ))
                    ) : (
                      <Text
                        style={{
                          color: colors.mutedForeground,
                          fontFamily: "Inter_400Regular",
                          fontSize: 13,
                        }}
                      >
                        No supporting data recorded yet.
                      </Text>
                    )}
                  </Card>
                ))}
              </>
            ) : null}
          </>
        )}

        <Button
          title="Review & submit"
          size="lg"
          icon="checkmark-circle-outline"
          disabled={photosCount === 0 || analyzing}
          onPress={onReview}
        />
      </ScrollView>
    </View>
  );
}
