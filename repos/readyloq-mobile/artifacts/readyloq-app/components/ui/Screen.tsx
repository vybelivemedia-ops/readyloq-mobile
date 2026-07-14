import React from "react";
import { StyleProp, View, ViewStyle } from "react-native";
import { Edge, SafeAreaView } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

interface ScreenProps {
  children?: React.ReactNode;
  edges?: Edge[];
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Full-bleed dark screen container with safe-area handling. Use as the
 * outermost element of every route.
 */
export function Screen({
  children,
  edges = ["top"],
  padded = false,
  style,
}: ScreenProps) {
  const colors = useColors();
  return (
    <SafeAreaView
      edges={edges}
      style={[
        { flex: 1, backgroundColor: colors.background },
        padded && { paddingHorizontal: 16 },
        style,
      ]}
    >
      {children}
    </SafeAreaView>
  );
}

export function Divider() {
  const colors = useColors();
  return <View style={{ height: 1, backgroundColor: colors.border }} />;
}
