import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/ui/Avatar";
import { GlowButton } from "@/components/ui/GlowButton";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useUpdateMe } from "@workspace/api-client-react";

const CATEGORIES = [
  "automotive",
  "fitness",
  "business",
  "real_estate",
  "podcast",
  "gaming",
  "music",
  "lifestyle",
  "travel",
  "food",
  "education",
  "tech",
  "sports",
  "other",
] as const;

type Category = (typeof CATEGORIES)[number];

function categoryLabel(c: string): string {
  return c
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, updateUser } = useAuth();
  const updateMe = useUpdateMe();

  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [category, setCategory] = useState<Category | null>(
    (user?.category as Category | null | undefined) ?? null,
  );
  const [locationCity, setLocationCity] = useState(user?.locationCity ?? "");
  const [locationRegion, setLocationRegion] = useState(user?.locationRegion ?? "");
  const [locationCountry, setLocationCountry] = useState(user?.locationCountry ?? "");
  const [socialLinks, setSocialLinks] = useState<{ platform: string; url: string }[]>(
    user?.socialLinks ?? [],
  );
  const [interests, setInterests] = useState<string[]>(user?.collaborationInterests ?? []);
  const [interestDraft, setInterestDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const addSocialLink = () => setSocialLinks((prev) => [...prev, { platform: "", url: "" }]);
  const updateSocialLink = (index: number, key: "platform" | "url", value: string) =>
    setSocialLinks((prev) => prev.map((l, i) => (i === index ? { ...l, [key]: value } : l)));
  const removeSocialLink = (index: number) =>
    setSocialLinks((prev) => prev.filter((_, i) => i !== index));

  const addInterest = () => {
    const v = interestDraft.trim();
    if (!v || interests.includes(v)) {
      setInterestDraft("");
      return;
    }
    setInterests((prev) => [...prev, v]);
    setInterestDraft("");
  };
  const removeInterest = (value: string) =>
    setInterests((prev) => prev.filter((i) => i !== value));

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const cleanLinks = socialLinks
        .map((l) => ({ platform: l.platform.trim(), url: l.url.trim() }))
        .filter((l) => l.platform && l.url);
      const updated = await updateMe.mutateAsync({
        data: {
          displayName: displayName.trim(),
          bio: bio.trim(),
          category,
          locationCity: locationCity.trim() || null,
          locationRegion: locationRegion.trim() || null,
          locationCountry: locationCountry.trim() || null,
          socialLinks: cleanLinks,
          collaborationInterests: interests,
        },
      });
      await updateUser(updated);
      Alert.alert("Saved", "Your profile has been updated.");
    } catch {
      Alert.alert("Error", "Failed to save changes. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: topPad + 16, paddingBottom: 40 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Settings</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Avatar */}
        <View style={styles.avatarSection}>
          <Avatar uri={user?.avatarUrl} name={user?.displayName ?? ""} size={80} showRing />
          <TouchableOpacity style={[styles.changePhotoBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="camera" size={14} color={colors.primary} />
            <Text style={[styles.changePhotoText, { color: colors.primary }]}>Change Photo</Text>
          </TouchableOpacity>
        </View>

        {/* Profile form */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>PROFILE</Text>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Display Name</Text>
            <TextInput
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.input }]}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Your name"
              placeholderTextColor={colors.mutedForeground}
            />
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Bio</Text>
            <TextInput
              style={[styles.input, styles.bioInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.input }]}
              value={bio}
              onChangeText={setBio}
              placeholder="Tell your audience about yourself..."
              placeholderTextColor={colors.mutedForeground}
              multiline
              maxLength={200}
            />
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.readonlyField}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Username</Text>
            <Text style={[styles.readonlyValue, { color: colors.foreground }]}>@{user?.username}</Text>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.readonlyField}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Email</Text>
            <Text style={[styles.readonlyValue, { color: colors.foreground }]}>{user?.email}</Text>
          </View>
        </View>

        {/* Creator details */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>CREATOR DETAILS</Text>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Category</Text>
            <View style={styles.chipsWrap}>
              {CATEGORIES.map((c) => {
                const active = category === c;
                return (
                  <TouchableOpacity
                    key={c}
                    onPress={() => setCategory(active ? null : c)}
                    style={[
                      styles.choiceChip,
                      {
                        backgroundColor: active ? colors.primary + "22" : colors.input,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.choiceChipText,
                        { color: active ? colors.primary : colors.mutedForeground },
                      ]}
                    >
                      {categoryLabel(c)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Location</Text>
            <TextInput
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.input }]}
              value={locationCity}
              onChangeText={setLocationCity}
              placeholder="City"
              placeholderTextColor={colors.mutedForeground}
            />
            <TextInput
              style={[styles.input, styles.stackedInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.input }]}
              value={locationRegion}
              onChangeText={setLocationRegion}
              placeholder="State / Region"
              placeholderTextColor={colors.mutedForeground}
            />
            <TextInput
              style={[styles.input, styles.stackedInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.input }]}
              value={locationCountry}
              onChangeText={setLocationCountry}
              placeholder="Country"
              placeholderTextColor={colors.mutedForeground}
            />
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Social Links</Text>
            {socialLinks.map((link, i) => (
              <View key={i} style={styles.linkRow}>
                <TextInput
                  style={[styles.input, styles.linkPlatformInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.input }]}
                  value={link.platform}
                  onChangeText={(v) => updateSocialLink(i, "platform", v)}
                  placeholder="Platform"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                />
                <TextInput
                  style={[styles.input, styles.linkUrlInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.input }]}
                  value={link.url}
                  onChangeText={(v) => updateSocialLink(i, "url", v)}
                  placeholder="https://..."
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                  keyboardType="url"
                />
                <TouchableOpacity onPress={() => removeSocialLink(i)} style={styles.removeBtn}>
                  <Feather name="x" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity
              onPress={addSocialLink}
              style={[styles.addRowBtn, { borderColor: colors.border }]}
            >
              <Feather name="plus" size={15} color={colors.primary} />
              <Text style={[styles.addRowText, { color: colors.primary }]}>Add Link</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Collaboration Interests</Text>
            {interests.length > 0 ? (
              <View style={styles.chipsWrap}>
                {interests.map((interest) => (
                  <TouchableOpacity
                    key={interest}
                    onPress={() => removeInterest(interest)}
                    style={[styles.choiceChip, { backgroundColor: colors.primary + "22", borderColor: colors.primary }]}
                  >
                    <Text style={[styles.choiceChipText, { color: colors.primary }]}>{interest}</Text>
                    <Feather name="x" size={12} color={colors.primary} />
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            <View style={styles.linkRow}>
              <TextInput
                style={[styles.input, { flex: 1, color: colors.foreground, borderColor: colors.border, backgroundColor: colors.input }]}
                value={interestDraft}
                onChangeText={setInterestDraft}
                placeholder="e.g. Brand deals, Co-streams"
                placeholderTextColor={colors.mutedForeground}
                onSubmitEditing={addInterest}
                returnKeyType="done"
              />
              <TouchableOpacity onPress={addInterest} style={styles.removeBtn}>
                <Feather name="plus" size={18} color={colors.primary} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <GlowButton
          title="Save Changes"
          onPress={handleSave}
          variant="primary"
          size="md"
          fullWidth
          loading={isSaving}
        />

        {/* More options */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>STREAMING</Text>
          {[
            { label: "Connected Accounts", icon: "link" as const, path: "/settings/connected-accounts" },
            { label: "Streaming Platforms", icon: "link-2" as const, path: "/settings/platforms" },
            { label: "Meta Glasses", icon: "eye" as const, path: "/settings/meta-glasses" },
            { label: "Voice & Gestures", icon: "mic" as const, path: "/settings/recognition" },
            { label: "Subscription & Billing", icon: "credit-card" as const, path: "/settings/subscription" },
          ].map((item, i, arr) => (
            <React.Fragment key={item.label}>
              <TouchableOpacity
                onPress={() => router.push(item.path as never)}
                style={styles.menuRow}
              >
                <Feather name={item.icon} size={18} color={colors.primary} />
                <Text style={[styles.menuLabel, { color: colors.foreground }]}>{item.label}</Text>
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
              {i < arr.length - 1 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
            </React.Fragment>
          ))}
        </View>

        {/* Account */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>ACCOUNT</Text>
          <TouchableOpacity
            onPress={() => router.push("/settings/delete-account" as never)}
            style={styles.menuRow}
          >
            <Feather name="trash-2" size={18} color="#ef4444" />
            <Text style={[styles.menuLabel, { color: "#ef4444" }]}>Delete Account</Text>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* Legal */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>LEGAL</Text>
          {[
            { label: "Terms of Service", path: "/legal/terms" },
            { label: "Privacy Policy", path: "/legal/privacy" },
          ].map((item, i) => (
            <React.Fragment key={item.label}>
              <TouchableOpacity
                onPress={() => router.push(item.path as never)}
                style={styles.menuRow}
              >
                <Feather name="file-text" size={18} color={colors.mutedForeground} />
                <Text style={[styles.menuLabel, { color: colors.foreground }]}>{item.label}</Text>
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
              </TouchableOpacity>
              {i === 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
            </React.Fragment>
          ))}
        </View>

        {/* App */}
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>APP</Text>
          <TouchableOpacity
            onPress={() => router.push("/settings/about" as never)}
            style={styles.menuRow}
          >
            <Feather name="info" size={18} color={colors.mutedForeground} />
            <Text style={[styles.menuLabel, { color: colors.foreground }]}>About VYBE LIVE</Text>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 16 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  avatarSection: {
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  changePhotoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  changePhotoText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  section: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 1.2,
  },
  field: { gap: 8 },
  label: { fontSize: 12, fontFamily: "Inter_500Medium" },
  input: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  bioInput: { minHeight: 80, textAlignVertical: "top" },
  stackedInput: { marginTop: 8 },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choiceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  choiceChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  linkPlatformInput: { flex: 1 },
  linkUrlInput: { flex: 1.6 },
  removeBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  addRowBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    marginTop: 8,
  },
  addRowText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  readonlyField: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  readonlyValue: { fontSize: 15, fontFamily: "Inter_400Regular" },
  divider: { height: StyleSheet.hairlineWidth },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 4,
  },
  menuLabel: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
});
