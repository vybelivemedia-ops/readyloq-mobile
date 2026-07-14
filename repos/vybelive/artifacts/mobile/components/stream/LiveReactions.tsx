import React, { useCallback, useRef, useState } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const REACTIONS = ["🔥", "❤️", "💯", "👏", "🚀", "⚡"];

interface FloatingEmoji {
  id: string;
  emoji: string;
  x: number;
  anim: Animated.Value;
  opacity: Animated.Value;
}

interface LiveReactionsProps {
  onReact?: (emoji: string) => void;
}

export function LiveReactions({ onReact }: LiveReactionsProps) {
  const [floating, setFloating] = useState<FloatingEmoji[]>([]);
  const idRef = useRef(0);

  const triggerReaction = useCallback((emoji: string) => {
    const id = `${++idRef.current}`;
    const anim = new Animated.Value(0);
    const opacity = new Animated.Value(1);
    const x = Math.random() * 60 - 30;

    const item: FloatingEmoji = { id, emoji, x, anim, opacity };
    setFloating((prev) => [...prev, item]);

    Animated.parallel([
      Animated.timing(anim, {
        toValue: -200,
        duration: 1800,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(900),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 900,
          useNativeDriver: true,
        }),
      ]),
    ]).start(() => {
      setFloating((prev) => prev.filter((f) => f.id !== id));
    });

    onReact?.(emoji);
  }, [onReact]);

  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* Floating emojis */}
      {floating.map((f) => (
        <Animated.Text
          key={f.id}
          style={[
            styles.floatingEmoji,
            {
              transform: [{ translateX: f.x }, { translateY: f.anim }],
              opacity: f.opacity,
            },
          ]}
        >
          {f.emoji}
        </Animated.Text>
      ))}

      {/* Reaction buttons */}
      <View style={styles.buttons}>
        {REACTIONS.map((emoji) => (
          <TouchableOpacity
            key={emoji}
            onPress={() => triggerReaction(emoji)}
            activeOpacity={0.7}
            style={styles.reactionBtn}
          >
            <Text style={styles.reactionEmoji}>{emoji}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
  },
  floatingEmoji: {
    position: "absolute",
    bottom: 60,
    fontSize: 26,
    zIndex: 50,
  },
  buttons: {
    flexDirection: "column",
    gap: 8,
    alignItems: "center",
  },
  reactionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  reactionEmoji: {
    fontSize: 20,
  },
});
