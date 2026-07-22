import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import { ActivityIndicator, Animated, Easing, Pressable } from "react-native";
import { useColors } from "@/hooks/useColors";

interface VoiceMicButtonProps {
  isDictating: boolean;
  isTranscribing: boolean;
  onPress: () => void;
  /** Button diameter in pixels. Defaults to 32. */
  size?: number;
  accessibilityLabel?: string;
}

/**
 * Compact animated mic button for inline use with text fields.
 *
 * States:
 *  idle        — grey mic-outline icon
 *  recording   — red mic icon with a pulsing scale animation
 *  transcribing — spinner while Whisper processes the audio
 */
export function VoiceMicButton({
  isDictating,
  isTranscribing,
  onPress,
  size = 32,
  accessibilityLabel = "Toggle dictation",
}: VoiceMicButtonProps) {
  const colors = useColors();
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!isDictating) {
      pulse.setValue(1);
      return;
    }
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.3,
          duration: 550,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 550,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [isDictating, pulse]);

  const bgColor = isDictating ? "#ef444418" : colors.card;
  const borderColor = isDictating ? "#ef4444" : colors.border;
  const iconColor = isDictating ? "#ef4444" : colors.mutedForeground;
  const iconSize = Math.round(size * 0.48);

  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bgColor,
        borderWidth: 1,
        borderColor,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Animated.View style={{ transform: [{ scale: isDictating ? pulse : 1 }] }}>
        {isTranscribing ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Ionicons
            name={isDictating ? "mic" : "mic-outline"}
            size={iconSize}
            color={iconColor}
          />
        )}
      </Animated.View>
    </Pressable>
  );
}
