import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React from "react";
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

export default function TermsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Feather name="x" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Terms of Service</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.lastUpdated, { color: colors.mutedForeground }]}>Last updated: May 27, 2026</Text>
        {TERMS_SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{section.title}</Text>
            <Text style={[styles.sectionBody, { color: colors.secondaryForeground }]}>{section.body}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const TERMS_SECTIONS = [
  {
    title: "1. Acceptance of Terms",
    body: "By accessing or using VYBE LIVE, you agree to be bound by these Terms of Service and all applicable laws and regulations. If you do not agree with any of these terms, you are prohibited from using this service.",
  },
  {
    title: "2. Creator Content Policy",
    body: "You retain ownership of all content you stream or upload. By using VYBE LIVE, you grant us a limited, non-exclusive license to distribute your content through our multistreaming infrastructure. You are responsible for ensuring your content complies with all applicable platform policies including YouTube, Twitch, Kick, TikTok, Instagram, and Facebook community guidelines.",
  },
  {
    title: "3. DMCA & Copyright",
    body: "VYBE LIVE respects intellectual property rights and complies with the Digital Millennium Copyright Act (DMCA). If you believe your copyrighted work has been infringed, please submit a DMCA notice to legal@vybelive.com. We will respond promptly and take appropriate action.",
  },
  {
    title: "4. Prohibited Content",
    body: "You may not stream or share content that is illegal, harmful, threatening, abusive, harassing, defamatory, obscene, or otherwise objectionable. This includes but is not limited to: nudity or sexual content, violence, hate speech, content depicting minors in any harmful way, or content that infringes on any third-party rights.",
  },
  {
    title: "5. Wearable Devices & Privacy",
    body: "When streaming with wearable POV devices such as smart glasses, you are responsible for informing individuals who may be recorded. You must comply with all applicable privacy laws in your jurisdiction. VYBE LIVE is not responsible for any privacy violations resulting from your use of wearable recording devices.",
  },
  {
    title: "6. Subscription & Billing",
    body: "Paid subscriptions are billed on a recurring basis (monthly or annually) through Stripe. You may cancel at any time; access continues through the end of your billing period. No refunds are issued for partial periods. Prices may change with 30 days notice.",
  },
  {
    title: "7. AI Features",
    body: "AI-generated clips and captions are provided 'as-is' without warranty. AI features may occasionally produce inaccurate transcriptions or unintended clips. You are responsible for reviewing AI-generated content before publishing to any platform.",
  },
  {
    title: "8. Platform Compliance",
    body: "You are solely responsible for ensuring your streams comply with the Terms of Service of any third-party platforms you stream to via VYBE LIVE, including YouTube, Twitch, Kick, Facebook, Instagram, and TikTok. Violations of third-party platform policies may result in account termination on those platforms.",
  },
  {
    title: "9. Limitation of Liability",
    body: "VYBE LIVE shall not be liable for any indirect, incidental, special, consequential, or punitive damages resulting from your use of the service. Our total liability is limited to the amount paid by you in the 12 months preceding the claim.",
  },
  {
    title: "10. Changes to Terms",
    body: "We reserve the right to modify these terms at any time. We will notify users of material changes via email or in-app notification. Continued use of the service after changes constitutes acceptance of the new terms.",
  },
];

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  closeBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  content: { paddingHorizontal: 20, paddingBottom: 60, gap: 20 },
  lastUpdated: { fontSize: 12, fontFamily: "Inter_400Regular" },
  section: { gap: 8 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  sectionBody: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 22 },
});
