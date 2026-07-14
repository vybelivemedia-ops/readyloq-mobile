import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useForgotPassword } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const colors = useColors();
  const [email, setEmail] = useState("");

  const forgotPassword = useForgotPassword();

  const handleSubmit = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      Alert.alert("Email required", "Please enter your email address.");
      return;
    }

    try {
      await forgotPassword.mutateAsync({ data: { email: trimmed } });

      // The API never returns a token — it is delivered via email only.
      // Show a confirmation and let the user navigate to the reset screen
      // where they can paste their emailed code.
      Alert.alert(
        "Check your email",
        "If that address is registered, a reset code has been sent. Enter it on the next screen.",
        [
          { text: "Enter code", onPress: () => router.push("/(auth)/reset-password") },
          { text: "Back to login", style: "cancel", onPress: () => router.replace("/(auth)/login") },
        ]
      );
    } catch {
      Alert.alert("Error", "Something went wrong. Please try again.");
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.container}>
          {/* Back */}
          <TouchableOpacity onPress={() => router.back()} style={styles.back}>
            <Ionicons name="arrow-back" size={24} color={colors.foreground} />
          </TouchableOpacity>

          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground }]}>Forgot password?</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Enter your email and we'll send you a reset code.
            </Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.input }]}>
              <Ionicons name="mail-outline" size={20} color={colors.mutedForeground} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                placeholder="Email address"
                placeholderTextColor={colors.mutedForeground}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                returnKeyType="send"
                onSubmitEditing={handleSubmit}
              />
            </View>

            <Pressable
              style={[styles.btn, { backgroundColor: colors.primary }, forgotPassword.isPending && styles.btnDisabled]}
              onPress={handleSubmit}
              disabled={forgotPassword.isPending}
            >
              {forgotPassword.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>Send reset code</Text>
              )}
            </Pressable>
          </View>

          {/* Footer */}
          <TouchableOpacity onPress={() => router.replace("/(auth)/login")} style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
              Remember your password?{" "}
              <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold" }}>Sign in</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  container: { flex: 1, paddingHorizontal: 24, paddingTop: 8 },
  back: { width: 40, height: 40, justifyContent: "center", marginBottom: 8 },
  header: { marginBottom: 36 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", marginBottom: 8 },
  subtitle: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 22 },
  form: { gap: 16 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 52,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  btn: {
    height: 52,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontSize: 16, fontFamily: "Inter_600SemiBold" },
  footer: { marginTop: "auto", paddingBottom: 24, alignItems: "center" },
  footerText: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
