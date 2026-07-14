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

import { GlowButton } from "@/components/ui/GlowButton";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useRequestAccountDeletion } from "@workspace/api-client-react";

const TOTAL_STEPS = 4;

const LOSE_ITEMS = [
  { icon: "user" as const, label: "Your profile, username, and bio" },
  { icon: "video" as const, label: "All streams and stream history" },
  { icon: "scissors" as const, label: "Every AI clip you've generated" },
  { icon: "bar-chart-2" as const, label: "Analytics and watch-time data" },
  { icon: "link" as const, label: "Connected platform credentials" },
];

export default function DeleteAccountScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const requestDeletion = useRequestAccountDeletion();

  const [step, setStep] = useState(1);
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [scheduledDate, setScheduledDate] = useState<string | null>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const goBack = () => {
    if (step === 1) {
      router.back();
    } else {
      setStep((s) => s - 1);
    }
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const result = await requestDeletion.mutateAsync({
        data: { password, reason: reason.trim() || undefined },
      });
      setScheduledDate(result.scheduledDeletionDate ?? null);
      setSubmitted(true);
    } catch {
      setIsSubmitting(false);
      Alert.alert(
        "Could Not Delete Account",
        "We couldn't process your request. Please check your password and try again.",
      );
    }
  };

  const handleDone = async () => {
    await logout();
    router.replace("/");
  };

  const canContinue =
    (step === 1 && acknowledged) ||
    step === 2 ||
    (step === 3 && password.length > 0) ||
    (step === 4 && confirmText.trim().toUpperCase() === "DELETE");

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
          <TouchableOpacity onPress={goBack} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Delete Account
          </Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Progress dots */}
        {!submitted && (
          <View style={styles.progress}>
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.progressDot,
                  {
                    backgroundColor: i < step ? colors.primary : colors.border,
                    width: i === step - 1 ? 24 : 8,
                  },
                ]}
              />
            ))}
          </View>
        )}

        {submitted && (
          <View style={styles.stepWrap}>
            <View style={[styles.iconCircle, { backgroundColor: "rgba(34,197,94,0.12)" }]}>
              <Feather name="check-circle" size={28} color="#22c55e" />
            </View>
            <Text style={[styles.stepTitle, { color: colors.foreground }]}>
              Deletion scheduled
            </Text>
            <Text style={[styles.stepSubtitle, { color: colors.mutedForeground }]}>
              {scheduledDate
                ? `Your account is scheduled for permanent deletion on ${scheduledDate}.`
                : "Your account deletion has been scheduled."}{" "}
              Sign back in any time before then to cancel and restore your account.
            </Text>
          </View>
        )}

        {!submitted && step === 1 && (
          <View style={styles.stepWrap}>
            <View style={[styles.iconCircle, { backgroundColor: "rgba(239,68,68,0.12)" }]}>
              <Feather name="alert-triangle" size={28} color="#ef4444" />
            </View>
            <Text style={[styles.stepTitle, { color: colors.foreground }]}>
              This will delete everything
            </Text>
            <Text style={[styles.stepSubtitle, { color: colors.mutedForeground }]}>
              Deleting your account is permanent. Here's what you'll lose:
            </Text>
            <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {LOSE_ITEMS.map((item, i) => (
                <React.Fragment key={item.label}>
                  <View style={styles.loseRow}>
                    <Feather name={item.icon} size={18} color="#ef4444" />
                    <Text style={[styles.loseLabel, { color: colors.foreground }]}>
                      {item.label}
                    </Text>
                  </View>
                  {i < LOSE_ITEMS.length - 1 && (
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                  )}
                </React.Fragment>
              ))}
            </View>
            <TouchableOpacity
              style={[
                styles.checkboxRow,
                { backgroundColor: colors.card, borderColor: acknowledged ? "#ef4444" : colors.border },
              ]}
              onPress={() => setAcknowledged((v) => !v)}
              activeOpacity={0.8}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    backgroundColor: acknowledged ? "#ef4444" : "transparent",
                    borderColor: acknowledged ? "#ef4444" : colors.border,
                  },
                ]}
              >
                {acknowledged && <Feather name="check" size={14} color="#fff" />}
              </View>
              <Text style={[styles.checkboxLabel, { color: colors.foreground }]}>
                I understand this will permanently delete my account and all of my
                data.
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 2 && (
          <View style={styles.stepWrap}>
            <View style={[styles.iconCircle, { backgroundColor: colors.input }]}>
              <Feather name="message-circle" size={28} color={colors.primary} />
            </View>
            <Text style={[styles.stepTitle, { color: colors.foreground }]}>
              Help us improve
            </Text>
            <Text style={[styles.stepSubtitle, { color: colors.mutedForeground }]}>
              Why are you leaving? This is optional, but it helps us get better.
            </Text>
            <TextInput
              style={[
                styles.reasonInput,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.input,
                },
              ]}
              value={reason}
              onChangeText={setReason}
              placeholder="Tell us what went wrong (optional)..."
              placeholderTextColor={colors.mutedForeground}
              multiline
              maxLength={500}
            />
          </View>
        )}

        {step === 3 && (
          <View style={styles.stepWrap}>
            <View style={[styles.iconCircle, { backgroundColor: colors.input }]}>
              <Feather name="lock" size={28} color={colors.primary} />
            </View>
            <Text style={[styles.stepTitle, { color: colors.foreground }]}>
              Confirm it's you
            </Text>
            <Text style={[styles.stepSubtitle, { color: colors.mutedForeground }]}>
              Enter your password to confirm you want to delete{" "}
              <Text style={{ color: colors.foreground }}>{user?.email}</Text>.
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.input,
                },
              ]}
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>
        )}

        {step === 4 && (
          <View style={styles.stepWrap}>
            <View style={[styles.iconCircle, { backgroundColor: "rgba(239,68,68,0.12)" }]}>
              <Feather name="trash-2" size={28} color="#ef4444" />
            </View>
            <Text style={[styles.stepTitle, { color: colors.foreground }]}>
              Final confirmation
            </Text>
            <Text style={[styles.stepSubtitle, { color: colors.mutedForeground }]}>
              Your account enters a 30-day grace period, then it's permanently
              deleted. Sign back in before then to cancel. Type{" "}
              <Text style={{ color: "#ef4444", fontFamily: "Inter_700Bold" }}>DELETE</Text>{" "}
              to confirm.
            </Text>
            <TextInput
              style={[
                styles.input,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.input,
                },
              ]}
              value={confirmText}
              onChangeText={setConfirmText}
              placeholder="Type DELETE"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          </View>
        )}

        {submitted ? (
          <View style={styles.actions}>
            <GlowButton
              title="Done"
              onPress={handleDone}
              variant="primary"
              size="md"
              fullWidth
            />
          </View>
        ) : (
          <View style={styles.actions}>
            {step < TOTAL_STEPS ? (
              <GlowButton
                title="Continue"
                onPress={() => setStep((s) => s + 1)}
                variant="primary"
                size="md"
                fullWidth
                disabled={!canContinue}
              />
            ) : (
              <GlowButton
                title="Delete My Account"
                onPress={handleSubmit}
                variant="danger"
                size="md"
                fullWidth
                loading={isSubmitting}
                disabled={!canContinue}
              />
            )}
            <TouchableOpacity onPress={goBack} style={styles.cancelBtn}>
              <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>
                {step === 1 ? "Cancel" : "Back"}
              </Text>
            </TouchableOpacity>
          </View>
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
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  progress: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 8,
  },
  progressDot: {
    height: 8,
    borderRadius: 4,
  },
  stepWrap: { alignItems: "center", gap: 12 },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  stepTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  stepSubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 8,
  },
  section: {
    width: "100%",
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
    padding: 16,
    gap: 12,
    marginTop: 8,
  },
  loseRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  loseLabel: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  divider: { height: StyleSheet.hairlineWidth },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    width: "100%",
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginTop: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    lineHeight: 19,
  },
  input: {
    width: "100%",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    marginTop: 8,
  },
  reasonInput: {
    width: "100%",
    minHeight: 120,
    textAlignVertical: "top",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    marginTop: 8,
  },
  actions: { gap: 8, marginTop: 8 },
  cancelBtn: {
    alignItems: "center",
    paddingVertical: 12,
  },
  cancelText: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
