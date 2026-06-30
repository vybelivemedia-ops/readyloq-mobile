import { Ionicons } from "@expo/vector-icons";
import type { Finding } from "@workspace/api-client-react";
import React from "react";
import { Text, View } from "react-native";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { useColors } from "@/hooks/useColors";
import { confidencePct, formatStatus, severityTone } from "@/constants/inspection";

export function FindingCard({ finding }: { finding: Finding }) {
  const colors = useColors();
  return (
    <Card style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Text
          style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15, flex: 1 }}
        >
          {finding.category}
        </Text>
        {finding.severity ? (
          <Badge label={formatStatus(finding.severity)} tone={severityTone(finding.severity)} />
        ) : null}
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
    </Card>
  );
}
