import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlowButton } from "@/components/ui/GlowButton";
import { useColors } from "@/hooks/useColors";
import {
  useGetRecognitionSettings,
  useUpdateRecognitionSettings,
  type RecognitionSensitivity,
} from "@workspace/api-client-react";

const ALL_GESTURES: { value: string; label: string; icon: keyof typeof Feather.glyphMap }[] = [
  { value: "thumbs_up", label: "Thumbs Up", icon: "thumbs-up" },
  { value: "peace", label: "Peace Sign", icon: "scissors" },
  { value: "pointing", label: "Pointing", icon: "navigation" },
  { value: "open_palm", label: "Open Palm", icon: "stop-circle" },
];

const SENSITIVITIES: { value: RecognitionSensitivity; label: string; hint: string }[] = [
  { value: "high", label: "High", hint: "Triggers easily" },
  { value: "medium", label: "Medium", hint: "Balanced" },
  { value: "low", label: "Low", hint: "Strict match" },
];

const CONTEXT_OPTIONS = [15, 30, 45, 60];

export default function RecognitionSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data, isLoading } = useGetRecognitionSettings();
  const updateSettings = useUpdateRecognitionSettings();

  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [gestureEnabled, setGestureEnabled] = useState(false);
  const [triggerPhrases, setTriggerPhrases] = useState<string[]>([]);
  const [enabledGestures, setEnabledGestures] = useState<string[]>([]);
  const [sensitivity, setSensitivity] = useState<RecognitionSensitivity>("medium");
  const [contextWindowSeconds, setContextWindowSeconds] = useState(30);
  const [phraseDraft, setPhraseDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate local form state once the server settings arrive.
  useEffect(() => {
    if (!data || hydrated) return;
    setVoiceEnabled(data.voiceEnabled);
    setGestureEnabled(data.gestureEnabled);
    setTriggerPhrases(data.triggerPhrases);
    setEnabledGestures(data.enabledGestures);
    setSensitivity(data.sensitivity);
    setContextWindowSeconds(data.contextWindowSeconds);
    setHydrated(true);
  }, [data, hydrated]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const addPhrase = () => {
    const v = phraseDraft.trim();
    if (!v || triggerPhrases.some((p) => p.toLowerCase() === v.toLowerCase())) {
      setPhraseDraft("");
      return;
    }
    if (triggerPhrases.length >= 20) {
      Alert.alert("Limit reached", "You can have up to 20 trigger phrases.");
      return;
    }
    setTriggerPhrases((prev) => [...prev, v]);
    setPhraseDraft("");
  };
  const removePhrase = (phrase: string) =>
    setTriggerPhrases((prev) => prev.filter((p) => p !== phrase));

  const toggleGesture = (value: string) =>
    setEnabledGestures((prev) =>
      prev.includes(value) ? prev.filter((g) => g !== value) : [...prev, value],
    );

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updated = await updateSettings.mutateAsync({
        data: {
          voiceEnabled,
          gestureEnabled,
          triggerPhrases,
          enabledGestures,
          sensitivity,
          contextWindowSeconds,
        },
      });
      setTriggerPhrases(updated.triggerPhrases);
      Alert.alert("Saved", "Recognition settings updated.");
    } catch {
      Alert.alert("Error", "Failed to save settings. Please try again.");
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
        contentContainerStyle={[styles.content, { paddingTop: topPad + 16, paddingBottom: 40 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Voice & Gestures</Text>
          <View style={{ width: 40 }} />
        </View>

        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          Mark highlight moments hands-free while you stream. Recognition runs
          on-device and only on a native build — it stays off in Expo Go.
        </Text>

        {isLoading ? (
          <View style={styles.loader}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            {/* Voice */}
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.rowBetween}>
                <View style={styles.rowLeft}>
                  <Feather name="mic" size={18} color={colors.primary} />
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>Voice Triggers</Text>
                </View>
                <Switch
                  value={voiceEnabled}
                  onValueChange={setVoiceEnabled}
                  trackColor={{ false: colors.input, true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>

              {voiceEnabled && (
                <>
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <Text style={[styles.label, { color: colors.mutedForeground }]}>
                    Trigger Phrases ({triggerPhrases.length}/20)
                  </Text>
                  {triggerPhrases.length > 0 && (
                    <View style={styles.chipsWrap}>
                      {triggerPhrases.map((phrase) => (
                        <TouchableOpacity
                          key={phrase}
                          onPress={() => removePhrase(phrase)}
                          style={[
                            styles.choiceChip,
                            { backgroundColor: colors.primary + "22", borderColor: colors.primary },
                          ]}
                        >
                          <Text style={[styles.choiceChipText, { color: colors.primary }]}>{phrase}</Text>
                          <Feather name="x" size={12} color={colors.primary} />
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                  <View style={styles.linkRow}>
                    <TextInput
                      style={[styles.input, { flex: 1, color: colors.foreground, borderColor: colors.border, backgroundColor: colors.input }]}
                      value={phraseDraft}
                      onChangeText={setPhraseDraft}
                      placeholder='e.g. "Clip that"'
                      placeholderTextColor={colors.mutedForeground}
                      onSubmitEditing={addPhrase}
                      returnKeyType="done"
                    />
                    <TouchableOpacity onPress={addPhrase} style={styles.removeBtn}>
                      <Feather name="plus" size={18} color={colors.primary} />
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>

            {/* Gesture */}
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.rowBetween}>
                <View style={styles.rowLeft}>
                  <Feather name="zap" size={18} color={colors.primary} />
                  <Text style={[styles.rowTitle, { color: colors.foreground }]}>Hand Gestures</Text>
                </View>
                <Switch
                  value={gestureEnabled}
                  onValueChange={setGestureEnabled}
                  trackColor={{ false: colors.input, true: colors.primary }}
                  thumbColor="#fff"
                />
              </View>

              {gestureEnabled && (
                <>
                  <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  <Text style={[styles.label, { color: colors.mutedForeground }]}>Enabled Gestures</Text>
                  <View style={styles.chipsWrap}>
                    {ALL_GESTURES.map((g) => {
                      const active = enabledGestures.includes(g.value);
                      return (
                        <TouchableOpacity
                          key={g.value}
                          onPress={() => toggleGesture(g.value)}
                          style={[
                            styles.choiceChip,
                            {
                              backgroundColor: active ? colors.primary + "22" : colors.input,
                              borderColor: active ? colors.primary : colors.border,
                            },
                          ]}
                        >
                          <Feather name={g.icon} size={13} color={active ? colors.primary : colors.mutedForeground} />
                          <Text style={[styles.choiceChipText, { color: active ? colors.primary : colors.mutedForeground }]}>
                            {g.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <View style={[styles.note, { backgroundColor: colors.input }]}>
                    <Feather name="info" size={13} color={colors.mutedForeground} />
                    <Text style={[styles.noteText, { color: colors.mutedForeground }]}>
                      On-device hand detection activates in an upcoming native
                      build. Your preferences are saved now.
                    </Text>
                  </View>
                </>
              )}
            </View>

            {/* Sensitivity */}
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>SENSITIVITY</Text>
              <View style={styles.chipsWrap}>
                {SENSITIVITIES.map((s) => {
                  const active = sensitivity === s.value;
                  return (
                    <TouchableOpacity
                      key={s.value}
                      onPress={() => setSensitivity(s.value)}
                      style={[
                        styles.segChip,
                        {
                          backgroundColor: active ? colors.primary + "22" : colors.input,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text style={[styles.choiceChipText, { color: active ? colors.primary : colors.foreground }]}>
                        {s.label}
                      </Text>
                      <Text style={[styles.segHint, { color: colors.mutedForeground }]}>{s.hint}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Context window */}
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>CLIP CONTEXT WINDOW</Text>
              <Text style={[styles.intro, { color: colors.mutedForeground, marginBottom: 4 }]}>
                Seconds of footage kept around each marked moment.
              </Text>
              <View style={styles.chipsWrap}>
                {CONTEXT_OPTIONS.map((sec) => {
                  const active = contextWindowSeconds === sec;
                  return (
                    <TouchableOpacity
                      key={sec}
                      onPress={() => setContextWindowSeconds(sec)}
                      style={[
                        styles.choiceChip,
                        {
                          backgroundColor: active ? colors.primary + "22" : colors.input,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text style={[styles.choiceChipText, { color: active ? colors.primary : colors.foreground }]}>
                        {sec}s
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <GlowButton
              title="Save Settings"
              onPress={handleSave}
              variant="primary"
              size="md"
              fullWidth
              loading={isSaving}
            />
          </>
        )}
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
    marginBottom: 4,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  intro: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  loader: { paddingVertical: 40, alignItems: "center" },
  section: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
    padding: 16,
    gap: 12,
  },
  sectionTitle: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 1.2 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  rowLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  rowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  label: { fontSize: 12, fontFamily: "Inter_500Medium" },
  input: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
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
  segChip: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  segHint: { fontSize: 10, fontFamily: "Inter_400Regular" },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  removeBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  divider: { height: StyleSheet.hairlineWidth },
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 10,
    borderRadius: 10,
  },
  noteText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
});
