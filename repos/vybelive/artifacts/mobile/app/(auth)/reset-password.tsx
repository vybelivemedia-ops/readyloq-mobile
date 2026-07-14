import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
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

import { useResetPassword } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function ResetPasswordScreen() {
  const router = useRouter();
  const colors = useColors();
  const { login } = useAuth();
  const params = useLocalSearchParams<{ token?: string; expiresAt?: string }>();

  const [token, setToken] = useState(params.token ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPass, setShowPass] = useState(false);

  const resetPassword = useResetPassword();

  const handleSubmit = async () => {
    if (!token.trim()) {
      Alert.alert("Token required", "Please enter your reset code.");
      return;
    }
    if (password.length < 8) {
      Alert.alert("Weak password", "Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert("Passwords don't match", "Please make sure both passwords are identical.");
      return;
    }

    try {
      const result = await resetPassword.mutateAsync({
        data: { token: token.trim(), password },
      });

      // Auto-login with the fresh session returned by the API
      await login(result.accessToken, result.refreshToken, result.user);

      Alert.alert(
        "Password updated!",
        "You're now signed in with your new password.",
        [{ text: "Continue", onPress: () => router.replace("/(tabs)") }]
      );
    } catch (err: unknown) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Invalid or expired reset code. Please request a new one.";
      Alert.alert("Reset failed", msg);
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
            <Text style={[styles.title, { color: colors.foreground }]}>Set new password</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              Enter the reset code you received and choose a new password.
            </Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            {/* Token field — pre-filled but editable */}
            <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.input }]}>
              <Ionicons name="key-outline" size={20} color={colors.mutedForeground} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                placeholder="Reset code"
                placeholderTextColor={colors.mutedForeground}
                value={token}
                onChangeText={setToken}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>

            {/* New password */}
            <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.input }]}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.mutedForeground} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                placeholder="New password (min 8 chars)"
                placeholderTextColor={colors.mutedForeground}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPass}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
              <TouchableOpacity onPress={() => setShowPass((v) => !v)}>
                <Ionicons
                  name={showPass ? "eye-off-outline" : "eye-outline"}
                  size={20}
                  color={colors.mutedForeground}
                />
              </TouchableOpacity>
            </View>

            {/* Confirm password */}
            <View style={[styles.inputWrap, { borderColor: colors.border, backgroundColor: colors.input }]}>
              <Ionicons name="lock-closed-outline" size={20} color={colors.mutedForeground} style={styles.inputIcon} />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                placeholder="Confirm new password"
                placeholderTextColor={colors.mutedForeground}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showPass}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
              />
            </View>

            <Pressable
              style={[styles.btn, { backgroundColor: colors.primary }, resetPassword.isPending && styles.btnDisabled]}
              onPress={handleSubmit}
              disabled={resetPassword.isPending}
            >
              {resetPassword.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnText}>Reset password</Text>
              )}
            </Pressable>
          </View>

          {/* Footer */}
          <TouchableOpacity
            onPress={() => router.replace("/(auth)/forgot-password")}
            style={styles.footer}
          >
            <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
              Need a new code?{" "}
              <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold" }}>
                Resend
              </Text>
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
