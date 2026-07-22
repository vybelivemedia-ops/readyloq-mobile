import { Ionicons } from "@expo/vector-icons";
import type { Finding } from "@/lib/api-client";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { useColors } from "@/hooks/useColors";
import { confidencePct, formatStatus, severityTone } from "@/constants/inspection";

type ReviewAction = "accept" | "correct" | "dismiss";

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
}

export function FindingCard({ finding, onReview, savedAction }: FindingCardProps) {
  const colors = useColors();

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
