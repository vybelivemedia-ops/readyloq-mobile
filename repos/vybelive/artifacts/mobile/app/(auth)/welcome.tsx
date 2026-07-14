import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { router } from "expo-router";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlowButton } from "@/components/ui/GlowButton";
import { useColors } from "@/hooks/useColors";

const PLATFORMS = ["YouTube", "Twitch", "Kick", "TikTok", "Instagram", "Facebook"];

export default function WelcomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const scrollAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 60, friction: 10 }),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 2000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
      ])
    ).start();

    Animated.loop(
      Animated.timing(scrollAnim, {
        toValue: -1,
        duration: 12000,
        useNativeDriver: true,
      })
    ).start();
  }, []);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Background hero */}
      <Image
        source={require("@/assets/images/pov_hero.png")}
        style={styles.heroImage}
        contentFit="cover"
      />
      <LinearGradient
        colors={[
          "rgba(9,9,15,0.3)",
          "rgba(9,9,15,0.55)",
          "rgba(9,9,15,0.92)",
          colors.background,
        ]}
        locations={[0, 0.3, 0.65, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* Content */}
      <Animated.View
        style={[
          styles.content,
          {
            paddingTop: topPad + 20,
            paddingBottom: insets.bottom + 20,
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
          },
        ]}
      >
        {/* Logo */}
        <View style={styles.logoRow}>
          <Animated.View style={[styles.logoIcon, { transform: [{ scale: pulseAnim }], backgroundColor: colors.live, shadowColor: colors.live }]}>
            <Feather name="radio" size={20} color="#FFF" />
          </Animated.View>
          <Text style={styles.logoText}>VYBE LIVE</Text>
        </View>

        <View style={styles.heroText}>
          <Text style={styles.headline}>
            Stream Everywhere.{"\n"}
            <Text style={{ color: colors.primary }}>All at Once.</Text>
          </Text>
          <Text style={[styles.subline, { color: colors.secondaryForeground }]}>
            POV wearable streaming for creators.{"\n"}Tap once — go live on every platform.
          </Text>
        </View>

        {/* Platform scrolling chips */}
        <View style={styles.platformsContainer}>
          {PLATFORMS.map((p) => (
            <View key={p} style={[styles.platformChip, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <Text style={[styles.platformChipText, { color: colors.foreground }]}>{p}</Text>
            </View>
          ))}
        </View>

        {/* Feature pills */}
        <View style={styles.featureRow}>
          {["POV Mode", "AI Clips", "Multistream"].map((f) => (
            <View key={f} style={[styles.featurePill, { borderColor: colors.primary + "50" }]}>
              <Feather name="check" size={10} color={colors.primary} />
              <Text style={[styles.featurePillText, { color: colors.primaryForeground }]}>{f}</Text>
            </View>
          ))}
        </View>

        <View style={styles.ctas}>
          <GlowButton
            title="Start Streaming Free"
            onPress={() => router.push("/(auth)/register")}
            variant="live"
            size="lg"
            fullWidth
          />
          <TouchableOpacity
            onPress={() => router.push("/(auth)/login")}
            style={styles.loginBtn}
          >
            <Text style={[styles.loginText, { color: colors.foreground }]}>
              Already a creator?{" "}
              <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold" }}>
                Sign in
              </Text>
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.legal, { color: colors.mutedForeground }]}>
          By continuing you agree to our{" "}
          <Text
            style={{ color: colors.primary }}
            onPress={() => router.push("/legal/terms")}
          >
            Terms
          </Text>{" "}
          &{" "}
          <Text
            style={{ color: colors.primary }}
            onPress={() => router.push("/legal/privacy")}
          >
            Privacy Policy
          </Text>
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  heroImage: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.6,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "flex-end",
    gap: 20,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    position: "absolute",
    top: 60,
    left: 24,
  },
  logoIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 6,
  },
  logoText: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    letterSpacing: 2,
  },
  heroText: {
    gap: 12,
  },
  headline: {
    fontSize: 40,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
    lineHeight: 48,
    letterSpacing: -1,
  },
  subline: {
    fontSize: 16,
    fontFamily: "Inter_400Regular",
    lineHeight: 24,
  },
  platformsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  platformChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  platformChipText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  featureRow: {
    flexDirection: "row",
    gap: 8,
  },
  featurePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  featurePillText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  ctas: {
    gap: 14,
  },
  loginBtn: {
    alignItems: "center",
    paddingVertical: 4,
  },
  loginText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  legal: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 17,
  },
});
