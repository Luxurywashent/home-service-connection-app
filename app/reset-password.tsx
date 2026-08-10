import { useState, useEffect } from "react";
import {
  Text, View, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Alert
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useCustomerAuth } from "@/lib/customer-context";
import { trpc } from "@/lib/trpc";
import { MaterialIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function ResetPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { loginCustomer } = useCustomerAuth();

  // Expo Router reads the `token` query param from the deep link
  // e.g. manus20260331174054://reset-password?token=abc123
  const { token } = useLocalSearchParams<{ token: string }>();

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const resetMutation = trpc.customer.resetPassword.useMutation({
    onSuccess: async (data) => {
      if (!data.success) {
        setError(data.message ?? "This link has expired. Please request a new one.");
        return;
      }
      // Log the customer in automatically
      await loginCustomer(data.token!, data.customer!);
      setSuccess(true);
      // Navigate to the customer portal home after a brief pause
      setTimeout(() => {
        router.replace("/(customer)/home" as any);
      }, 1500);
    },
    onError: (e) => {
      setError(e.message ?? "Something went wrong. Please try again.");
    },
  });

  const handleSubmit = () => {
    setError("");
    if (!token) {
      setError("Invalid reset link. Please request a new password reset email.");
      return;
    }
    if (!newPassword.trim()) {
      setError("Please enter a new password.");
      return;
    }
    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    resetMutation.mutate({ token, newPassword });
  };

  // If no token is present in the URL, show an error immediately
  const hasToken = !!token;

  if (success) {
    return (
      <ScreenContainer edges={["bottom", "left", "right"]} containerClassName="bg-white">
        <View style={styles.successContainer}>
          <View style={styles.successIcon}>
            <MaterialIcons name="check-circle" size={56} color="#22C55E" />
          </View>
          <Text style={styles.successTitle}>Password Set!</Text>
          <Text style={styles.successSubtitle}>
            You're now logged in. Taking you to your portal…
          </Text>
          <ActivityIndicator color="#0a7ea4" style={{ marginTop: 24 }} />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["bottom", "left", "right"]} containerClassName="bg-white">
      {/* Back button */}
      <TouchableOpacity
        onPress={() => router.replace("/login" as any)}
        style={[styles.backBtn, { marginTop: insets.top + 8 }]}
        activeOpacity={0.7}
      >
        <MaterialIcons name="arrow-back" size={20} color="#6B7280" />
        <Text style={styles.backText}>Back to Login</Text>
      </TouchableOpacity>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }} keyboardShouldPersistTaps="handled">
          <View style={styles.container}>

            {/* Logo */}
            <View style={styles.logoSection}>
              <View style={styles.logoBox}>
                <Text style={styles.logoText}>LW</Text>
              </View>
              <Text style={styles.appName}>Luxury Wash On Wheels</Text>
              <Text style={styles.appSubtitle}>Set your new password</Text>
            </View>

            {!hasToken ? (
              <View style={styles.errorBox}>
                <MaterialIcons name="error-outline" size={18} color="#EF4444" />
                <Text style={styles.errorText}>
                  This link is invalid or has already been used. Please request a new password reset email from the login screen.
                </Text>
              </View>
            ) : (
              <View style={styles.form}>
                {/* New Password */}
                <View>
                  <Text style={styles.fieldLabel}>New Password</Text>
                  <View style={{ position: "relative" }}>
                    <TextInput
                      value={newPassword}
                      onChangeText={setNewPassword}
                      placeholder="At least 6 characters"
                      placeholderTextColor="#9CA3AF"
                      secureTextEntry={!showNew}
                      returnKeyType="next"
                      style={[styles.input, { paddingRight: 48 }]}
                    />
                    <TouchableOpacity
                      onPress={() => setShowNew(!showNew)}
                      style={styles.eyeBtn}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons
                        name={showNew ? "visibility-off" : "visibility"}
                        size={20}
                        color="#9CA3AF"
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Confirm Password */}
                <View>
                  <Text style={styles.fieldLabel}>Confirm Password</Text>
                  <View style={{ position: "relative" }}>
                    <TextInput
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      placeholder="Re-enter your new password"
                      placeholderTextColor="#9CA3AF"
                      secureTextEntry={!showConfirm}
                      returnKeyType="done"
                      onSubmitEditing={handleSubmit}
                      style={[styles.input, { paddingRight: 48 }]}
                    />
                    <TouchableOpacity
                      onPress={() => setShowConfirm(!showConfirm)}
                      style={styles.eyeBtn}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons
                        name={showConfirm ? "visibility-off" : "visibility"}
                        size={20}
                        color="#9CA3AF"
                      />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Error */}
                {error ? (
                  <View style={styles.errorBox}>
                    <MaterialIcons name="error-outline" size={16} color="#EF4444" />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                {/* Submit */}
                <TouchableOpacity
                  onPress={handleSubmit}
                  disabled={resetMutation.isPending}
                  activeOpacity={0.85}
                  style={[styles.submitBtn, resetMutation.isPending && { opacity: 0.7 }]}
                >
                  {resetMutation.isPending ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.submitBtnText}>Set New Password</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => router.replace("/login" as any)}
                  style={{ alignSelf: "center", marginTop: 8 }}
                  activeOpacity={0.7}
                >
                  <Text style={{ fontSize: 14, color: "#6B7280" }}>Back to Login</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 28 },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14, alignSelf: "flex-start" },
  backText: { fontSize: 14, color: "#6B7280" },
  logoSection: { alignItems: "center", paddingVertical: 32 },
  logoBox: { width: 80, height: 80, borderRadius: 20, backgroundColor: "#1A1A1A", justifyContent: "center", alignItems: "center", marginBottom: 16 },
  logoText: { fontSize: 30, fontWeight: "900", color: "#FFFFFF" },
  appName: { fontSize: 24, fontWeight: "800", color: "#1A1A1A", textAlign: "center" },
  appSubtitle: { fontSize: 14, color: "#9CA3AF", marginTop: 4 },
  form: { gap: 16 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  input: { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: "#1A1A1A" },
  eyeBtn: { position: "absolute", right: 14, top: 0, bottom: 0, justifyContent: "center" },
  errorBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "#FEF2F2", borderRadius: 10, padding: 12 },
  errorText: { fontSize: 14, color: "#EF4444", flex: 1, lineHeight: 20 },
  submitBtn: { backgroundColor: "#1A1A1A", borderRadius: 100, paddingVertical: 16, alignItems: "center", marginTop: 4 },
  submitBtnText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  successContainer: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 32 },
  successIcon: { marginBottom: 20 },
  successTitle: { fontSize: 28, fontWeight: "800", color: "#1A1A1A", marginBottom: 8 },
  successSubtitle: { fontSize: 15, color: "#6B7280", textAlign: "center", lineHeight: 22 },
});
