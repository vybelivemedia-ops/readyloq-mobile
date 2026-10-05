import { useLocalSearchParams } from "expo-router";
import React from "react";
import { Text, View } from "react-native";

import { InspectionDetail } from "@/components/InspectionDetail";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";

export default function InspectionDetailScreen() {
  const colors = useColors();
  const { id: idParam } = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  const inspectionId = id ? Number(id) : NaN;

  if (!id || !Number.isInteger(inspectionId) || inspectionId <= 0) {
    return (
      <Screen edges={["top", "bottom"]}>
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingHorizontal: 24,
          }}
        >
          <Text style={{ color: colors.mutedForeground }}>
            Loading inspection record...
          </Text>
        </View>
      </Screen>
    );
  }

  return <InspectionDetail id={inspectionId} />;
}
