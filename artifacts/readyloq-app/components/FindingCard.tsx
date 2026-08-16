import { Ionicons } from "@expo/vector-icons";
import type { Finding } from "@/lib/api-client";
import React, { useState } from "react";
import { Image, Modal, Pressable, Text, TouchableOpacity, View } from "react-native";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { useColors } from "@/hooks/useColors";
import { confidencePct, formatStatus, severityTone } from "@/constants/inspection";

type ReviewAction = "accept" | "correct" | "dismiss";

/**
 * Attribution source for a finding.
 *
 * - "ai"       → Discovered by FAIE (AI vision, no tech review yet)
 * - "tech"     → Found by Tech (manually flagged, no AI involvement)
 * - "verified" → Verified by Tech & AI (tech accepted or corrected an AI finding)
 *
 * Commission recognition rule: "tech" and "verified" both assign primary
 * recognition credit to the technician.
 */
export type FindingAttribution = "ai" | "tech" | "verified";

/** Derive attribution from reviewStatus. All current findings originate from AI;
 *  tech involvement is represented by accept/correct. */
export function findingAttribution(reviewStatus?: string | null): FindingAttribution {
  if (reviewStatus === "accepted" || reviewStatus === "corrected") return "verified";
  return "ai";
}

/**
 * Shape of the `laserMeasurement` sub-object stored inside captureMetadata.
 * Burst measurements carry full dimensions in `metadata`; laser-only readings
 * carry just `value` (width).
 */
interface LaserMeasurement {
  kind?: string;
  value?: number;
  unit?: string;
  signalQuality?: number;
  metadata?: {
    method?: string;
    heightInches?: number;
    areaSqInches?: number;
    confidence?: number;
    warnings?: string[];
  };
}

interface FindingCardProps {
  finding: Finding;
  /**
   * When provided, renders inline Accept / Correct / Dismiss buttons so the
   * technician can review a finding directly on the inspection detail screen.
   * The parent is responsible for showing a species-entry modal when the
   * callback is called with action = "correct".
   */
  onReview?: (action: ReviewAction) => void;
  /** Persisted action for this finding (shows a status badge). */
  savedAction?: ReviewAction | null;
  /**
   * Name of the technician who ran the inspection. Shown on the attribution
   * chip when the finding has been accepted or corrected (tech gets primary
   * recognition credit per commission rules).
   */
  technicianName?: string;
  /**
   * Raw captureMetadata from the InspectionMedia record whose URL matches
   * this finding's imageUrl. When present and contains a laserMeasurement,
   * the card renders the stamped dimensions below the confidence row.
   */
  captureMetadata?: Record<string, unknown> | null;
}

export function FindingCard({ finding, onReview, savedAction, technicianName, captureMetadata }: FindingCardProps) {
  const colors = useColors();
  const [zoomVisible, setZoomVisible] = useState(false);

  const attribution = findingAttribution(finding.reviewStatus);

  // Commission recognition: tech gets primary credit for accepted/corrected findings.
  const techCredit =
    (attribution === "verified" || attribution === "tech") && technicianName
      ? technicianName
      : null;

  const persistedStatus: ReviewAction | null =
    savedAction ??
    (finding.reviewStatus === "accepted"
      ? "accept"
      : finding.reviewStatus === "corrected"
        ? "correct"
        : finding.reviewStatus === "dismissed"
          ? "dismiss"
          : null);

  const reviewLabel =
    persistedStatus === "accept"
      ? "Accepted"
      : persistedStatus === "correct"
        ? finding.technicianSpecies
          ? `Corrected: ${finding.technicianSpecies}`
          : "Corrected"
        : persistedStatus === "dismiss"
          ? "Dismissed"
          : null;

  return (
    <Card style={{ gap: 10 }}>
      {/* Tappable evidence thumbnail — shown only when the finding has an image */}
      {finding.imageUrl ? (
        <TouchableOpacity onPress={() => setZoomVisible(true)} activeOpacity={0.8}>
          <Image
            source={{ uri: finding.imageUrl }}
            style={{ width: "100%", height: 160, borderRadius: 8, backgroundColor: colors.muted }}
            resizeMode="cover"
          />
        </TouchableOpacity>
      ) : null}

      {/* Full-screen zoom modal */}
      <Modal visible={zoomVisible} transparent animationType="fade" onRequestClose={() => setZoomVisible(false)}>
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.92)", justifyContent: "center", alignItems: "center" }}
          onPress={() => setZoomVisible(false)}
        >
          <Image
            source={{ uri: finding.imageUrl ?? "" }}
            style={{ width: "92%", height: "75%", borderRadius: 10 }}
            resizeMode="contain"
          />
          <Text style={{ color: "rgba(255,255,255,0.5)", fontSize: 13, marginTop: 14 }}>
            Tap anywhere to close
          </Text>
        </Pressable>
      </Modal>

      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Text
          style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15, flex: 1 }}
        >
          {finding.category}
        </Text>
        <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
          {reviewLabel ? (
            <Badge
              label={reviewLabel}
              tone={
                persistedStatus === "dismiss"
                  ? "default"
                  : persistedStatus === "correct"
                    ? "info"
                    : "success"
              }
            />
          ) : null}
          {finding.severity ? (
            <Badge label={formatStatus(finding.severity)} tone={severityTone(finding.severity)} />
          ) : null}
        </View>
      </View>

      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20 }}>
        {finding.description}
      </Text>

      {/* Attribution chip — source tag + commission credit */}
      {attribution !== "ai" || !techCredit ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {attribution === "ai" ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                backgroundColor: "rgba(124,58,237,0.10)",
                borderRadius: 999,
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderWidth: 1,
                borderColor: "rgba(124,58,237,0.25)",
              }}
            >
              <Ionicons name="sparkles" size={11} color="#7c3aed" />
              <Text style={{ color: "#7c3aed", fontFamily: "Inter_600SemiBold", fontSize: 11 }}>
                Discovered by FAIE
              </Text>
            </View>
          ) : attribution === "tech" ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                backgroundColor: (colors.success ?? "#16a34a") + "18",
                borderRadius: 999,
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderWidth: 1,
                borderColor: (colors.success ?? "#16a34a") + "40",
              }}
            >
              <Ionicons name="person" size={11} color={colors.success ?? "#16a34a"} />
              <Text style={{ color: colors.success ?? "#16a34a", fontFamily: "Inter_600SemiBold", fontSize: 11 }}>
                Found by Tech
              </Text>
            </View>
          ) : (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                backgroundColor: (colors.info ?? "#0ea5e9") + "15",
                borderRadius: 999,
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderWidth: 1,
                borderColor: (colors.info ?? "#0ea5e9") + "35",
              }}
            >
              <Ionicons name="shield-checkmark" size={11} color={colors.info ?? "#0ea5e9"} />
              <Text style={{ color: colors.info ?? "#0ea5e9", fontFamily: "Inter_600SemiBold", fontSize: 11 }}>
                Verified by Tech & AI
              </Text>
            </View>
          )}
          {/* Commission credit — tech name shown when tech is involved; amounts always hidden on field view */}
          {techCredit ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
              <Ionicons name="ribbon-outline" size={11} color={colors.mutedForeground} />
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 11 }}>
                {techCredit}
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        // AI-only finding with no tech name — show minimal FAIE chip
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            alignSelf: "flex-start",
            backgroundColor: "rgba(124,58,237,0.10)",
            borderRadius: 999,
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderWidth: 1,
            borderColor: "rgba(124,58,237,0.25)",
          }}
        >
          <Ionicons name="sparkles" size={11} color="#7c3aed" />
          <Text style={{ color: "#7c3aed", fontFamily: "Inter_600SemiBold", fontSize: 11 }}>
            Discovered by FAIE
          </Text>
        </View>
      )}

      <View style={{ flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Ionicons name="analytics-outline" size={14} color={colors.info} />
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12 }}>
            {confidencePct(finding.confidence)} confidence
          </Text>
        </View>
        {finding.location ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Ionicons name="location-outline" size={14} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
              {finding.location}
            </Text>
          </View>
        ) : null}
      </View>

      {/* ── Stamped measurement block ───────────────────────────────────────── */}
      {(() => {
        const laser = captureMetadata?.laserMeasurement as LaserMeasurement | undefined;
        if (!laser) return null;

        const isBurst = laser.metadata?.method === "burst_reference";
        const widthIn = laser.value;
        const heightIn = laser.metadata?.heightInches;
        const areaSqIn = laser.metadata?.areaSqInches;
        // Prefer the inner confidence (burst pipeline score) over signalQuality
        const conf = laser.metadata?.confidence ?? laser.signalQuality;
        const isLowConf = conf != null && conf < 0.5;
        const warnings = laser.metadata?.warnings ?? [];

        const accentColor = isLowConf ? (colors.warning ?? "#f59e0b") : (colors.info ?? "#0ea5e9");

        return (
          <View
            style={{
              backgroundColor: isLowConf
                ? (colors.warning ?? "#f59e0b") + "14"
                : (colors.info ?? "#0ea5e9") + "12",
              borderRadius: 8,
              padding: 10,
              gap: 6,
              borderWidth: 1,
              borderColor: isLowConf
                ? (colors.warning ?? "#f59e0b") + "40"
                : (colors.info ?? "#0ea5e9") + "30",
            }}
          >
            {/* Header row */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons
                name={isLowConf ? "warning-outline" : "resize-outline"}
                size={13}
                color={accentColor}
              />
              <Text
                style={{
                  color: accentColor,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 11,
                  flex: 1,
                }}
              >
                {isBurst ? "On-screen measurement" : "Laser measurement"}
                {isLowConf ? " — low confidence" : ""}
              </Text>
              {conf != null ? (
                <Text
                  style={{ color: accentColor, fontFamily: "Inter_500Medium", fontSize: 11 }}
                >
                  {Math.round(conf * 100)}%
                </Text>
              ) : null}
            </View>

            {/* Dimension row */}
            <View style={{ flexDirection: "row", gap: 14, flexWrap: "wrap" }}>
              {widthIn != null ? (
                <DimItem
                  label={isBurst && heightIn != null ? "W" : "Width"}
                  value={`${widthIn.toFixed(2)} in`}
                  colors={colors}
                />
              ) : null}
              {isBurst && heightIn != null ? (
                <DimItem label="H" value={`${heightIn.toFixed(2)} in`} colors={colors} />
              ) : null}
              {isBurst && areaSqIn != null ? (
                <DimItem label="Area" value={`${areaSqIn.toFixed(2)} in²`} colors={colors} />
              ) : null}
            </View>

            {/* Warnings */}
            {warnings.length > 0 ? (
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: "Inter_400Regular",
                  fontSize: 11,
                  lineHeight: 16,
                }}
                numberOfLines={2}
              >
                {warnings.join(" · ")}
              </Text>
            ) : null}
          </View>
        );
      })()}

      {finding.treatment ? (
        <View
          style={{
            backgroundColor: colors.muted,
            borderRadius: colors.radius - 4,
            padding: 12,
            gap: 4,
          }}
        >
          <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
            Recommended treatment
          </Text>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 }}>
            {finding.treatment}
          </Text>
        </View>
      ) : null}

      {/* Inline review actions — only shown when correction is enabled */}
      {onReview ? (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 2 }}>
          {(["accept", "correct", "dismiss"] as ReviewAction[]).map((action) => {
            const isActive = savedAction === action;
            const label =
              action === "accept" ? "Accept" : action === "correct" ? "Correct" : "Dismiss";
            const activeColor =
              action === "accept"
                ? (colors.success ?? "#22c55e")
                : action === "correct"
                  ? colors.primary
                  : colors.destructive;
            return (
              <Pressable
                key={action}
                onPress={() => onReview(action)}
                style={{
                  flex: 1,
                  paddingVertical: 7,
                  borderRadius: 8,
                  alignItems: "center",
                  backgroundColor: isActive ? activeColor + "22" : colors.muted,
                  borderWidth: 1,
                  borderColor: isActive ? activeColor : colors.border,
                }}
              >
                <Text
                  style={{
                    color: isActive ? activeColor : colors.mutedForeground,
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 13,
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </Card>
  );
}

// ── Small helper: one labelled dimension value ────────────────────────────────
function DimItem({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  return (
    <View style={{ gap: 1 }}>
      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 10 }}>
        {label}
      </Text>
      <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 13 }}>
        {value}
      </Text>
    </View>
  );
}
