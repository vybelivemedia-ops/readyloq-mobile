import React from "react";
import { Pressable, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Independent of toolbars/status panels so their size cannot hide completion. */
export function CaptureDoneAction({
  onPress, disabled, color, safeAreaHandled = false,
}: {
  onPress: () => void;
  disabled: boolean;
  color: string;
  /** Screen already applies safe areas; wide camera pane has no outer right edge. */
  safeAreaHandled?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Pressable
      testID="capture-done"
      accessibilityRole="button"
      accessibilityLabel="Done"
      accessibilityHint="Review captured inspection evidence"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        position: "absolute",
        right: 16 + (safeAreaHandled ? 0 : insets.right),
        bottom: 12 + (safeAreaHandled ? 0 : insets.bottom),
        zIndex: 1000,
        elevation: 20,
        minWidth: 84,
        minHeight: 48,
        paddingHorizontal: 16,
        paddingVertical: 12,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 12,
        backgroundColor: "rgba(0,0,0,0.92)",
        borderWidth: 1,
        borderColor: color,
      }}
    >
      <Text style={{ color, fontFamily: "Inter_600SemiBold", fontSize: 16, opacity: disabled ? 0.55 : 1 }}>
        Done
      </Text>
    </Pressable>
  );
}
