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

export default function PrivacyScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Feather name="x" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>Privacy Policy</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={[styles.lastUpdated, { color: colors.mutedForeground }]}>Last updated: May 27, 2026</Text>
        {PRIVACY_SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{section.title}</Text>
            <Text style={[styles.sectionBody, { color: colors.secondaryForeground }]}>{section.body}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const PRIVACY_SECTIONS = [
  {
    title: "1. Information We Collect",
    body: "We collect information you provide directly, including your name, email address, username, and profile details. We also collect stream data, clip metadata, analytics data, and device information. When using wearable POV devices, we process video streams temporarily for multistreaming; recordings are stored only if you enable cloud recording.",
  },
  {
    title: "2. How We Use Your Information",
    body: "We use your information to provide and improve VYBE LIVE services, process payments, send you updates and notifications, generate AI clips from your streams, provide analytics dashboards, and ensure platform safety and compliance. We do not sell your personal information to third parties.",
  },
  {
    title: "3. Streaming Data",
    body: "Video and audio content you stream is transmitted through our infrastructure to your selected platforms. We process this data in real-time and do not store stream content unless you enable cloud recording. AI clip generation processes your stream content temporarily and stores only the resulting clip files.",
  },
  {
    title: "4. Third-Party Platforms",
    body: "When you connect to platforms like YouTube, Twitch, or TikTok, we transmit your stream to those services subject to their privacy policies. We store RTMP credentials and stream keys encrypted. We do not access your platform accounts beyond what is necessary for streaming.",
  },
  {
    title: "5. Analytics & Cookies",
    body: "We collect aggregated analytics data including viewer counts, watch time, and engagement metrics to power your dashboard. We use this data only to provide you with insights about your streams. We do not use cookies for advertising purposes.",
  },
  {
    title: "6. Data Security",
    body: "We implement industry-standard security measures including encryption at rest and in transit, secure token storage, and regular security audits. Stream keys and credentials are encrypted. However, no method of transmission over the internet is 100% secure.",
  },
  {
    title: "7. Data Retention",
    body: "Account data is retained while your account is active. Stream recordings are retained per your subscription plan. AI clips are retained until you delete them. Analytics data is retained for 12 months. Upon account deletion, we delete your personal data within 30 days.",
  },
  {
    title: "8. Your Rights",
    body: "You have the right to access, correct, or delete your personal data at any time. You can export your data, opt out of non-essential communications, and request account deletion through Settings. EU/California residents have additional rights under GDPR/CCPA.",
  },
  {
    title: "9. Children's Privacy",
    body: "VYBE LIVE is not intended for users under 13 years of age. We do not knowingly collect information from children under 13. If you believe a child has provided us with personal information, please contact us immediately.",
  },
  {
    title: "10. Contact Us",
    body: "For privacy-related inquiries, data deletion requests, or to exercise your rights, contact us at privacy@vybelive.com. For DMCA notices, use legal@vybelive.com. We will respond within 30 days.",
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
