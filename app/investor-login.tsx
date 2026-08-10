import React, { useState, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useInvestorAuth } from "@/lib/investor-auth";
import { useColors } from "@/hooks/use-colors";
import { router } from "expo-router";

export default function InvestorLoginScreen() {
  const colors = useColors();
  const { login, investor, isLoading } = useInvestorAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // If already logged in, redirect to correct screen
  useEffect(() => {
    if (!isLoading && investor) {
      if (investor.role === "investor_admin") {
        router.replace("/(investor)/admin-home" as any);
      } else {
        router.replace("/(investor)/dashboard" as any);
      }
    }
  }, [isLoading, investor]);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError("Please enter your email and password.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await login(email.trim().toLowerCase(), password);
      // Navigation handled by useEffect above once investor state updates
    } catch (e: any) {
      setError(e?.message ?? "Login failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      {/* Back button pinned at top of safe area — outside the centered scroll so it's always reachable */}
      <TouchableOpacity style={styles.backBtn} onPress={() => router.replace("/investor-pitch" as any)}>
        <Text style={[styles.backText, { color: colors.muted }]}>← Back</Text>
      </TouchableOpacity>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* Header */}
          <View style={styles.header}>
            <View style={[styles.logoCircle, { backgroundColor: "#7C3AED" }]}>
              <Text style={styles.logoText}>💼</Text>
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>Investor Portal</Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              Luxury Wash On Wheels
            </Text>
          </View>

          {/* Card */}
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Sign In</Text>

            {error ? (
              <View style={[styles.errorBox, { backgroundColor: colors.error + "20", borderColor: colors.error }]}>
                <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
              </View>
            ) : null}

            <Text style={[styles.label, { color: colors.muted }]}>EMAIL ADDRESS</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
              placeholder="investor@email.com"
              placeholderTextColor={colors.muted}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              returnKeyType="next"
            />

            <Text style={[styles.label, { color: colors.muted }]}>PASSWORD</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
              placeholder="••••••••"
              placeholderTextColor={colors.muted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              returnKeyType="done"
              onSubmitEditing={handleLogin}
            />

            <TouchableOpacity
              style={[styles.loginBtn, { backgroundColor: "#7C3AED" }, loading && { opacity: 0.7 }]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.loginBtnText}>Sign In</Text>
              )}
            </TouchableOpacity>
          </View>

          <Text style={[styles.footer, { color: colors.muted }]}>
            Need access? Contact your account manager.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: "center", padding: 24 },
  backBtn: { paddingHorizontal: 20, paddingVertical: 14, alignSelf: "flex-start" },
  backText: { fontSize: 14 },
  header: { alignItems: "center", marginBottom: 32 },
  logoCircle: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  logoText: { fontSize: 32 },
  title: { fontSize: 26, fontWeight: "700", marginBottom: 4 },
  subtitle: { fontSize: 14 },
  card: { borderRadius: 16, padding: 24, borderWidth: 1, marginBottom: 24 },
  cardTitle: { fontSize: 20, fontWeight: "700", marginBottom: 20 },
  errorBox: { borderRadius: 8, borderWidth: 1, padding: 12, marginBottom: 16 },
  errorText: { fontSize: 14, fontWeight: "500" },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginBottom: 6, marginTop: 12 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, marginBottom: 4 },
  loginBtn: { borderRadius: 12, paddingVertical: 15, alignItems: "center", marginTop: 20 },
  loginBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  footer: { textAlign: "center", fontSize: 13 },
});
