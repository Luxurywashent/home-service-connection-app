import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";

import { ScreenContainer } from "@/components/screen-container";
import { useEmployeeAuth } from "@/lib/auth-context";
import { getNativeEmployeeSession, useJobSyncAuth } from "@/lib/jobsync-auth-context";

export default function LoginScreen() {
  const router = useRouter();
  const { loginCompany } = useJobSyncAuth();
  const { login: establishNativeRole, logout: logoutLegacyEmployee } = useEmployeeAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (password.length < 8) {
      setError("Enter the same password you use on the web app. Passwords are at least 8 characters.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const session = await loginCompany({ email: email.trim(), password });

      await logoutLegacyEmployee();
      const nativeEmployee = getNativeEmployeeSession(session);
      if (!nativeEmployee) throw new Error("This Company role is not supported in the native app.");
      await establishNativeRole(nativeEmployee, true);
      if (nativeEmployee.role === "detailer") {
        router.replace("/(tabs)");
      } else if (nativeEmployee.role === "operations_manager") {
        router.replace("/(tabs)/ops-dashboard");
      } else {
        router.replace("/(tabs)/admin-dashboard");
      }
    } catch (loginError: any) {
      setError(loginError?.message || "We could not verify those Company credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer edges={["bottom", "left", "right"]} containerClassName="bg-background">
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <View style={styles.container}>
            <View style={styles.logoSection}>
              <View style={styles.logoBox}><Image source={require("../assets/images/icon.png")} style={styles.logoImage} resizeMode="contain" /></View>
              <Text style={styles.appName}>Home Service Connection</Text>
            </View>

            <View style={styles.formCard}>
              <Text style={styles.formTitle}>Sign In</Text>
              <Text style={styles.formDescription}>Sign in to your Home Service Connection Company workspace.</Text>
              <View><Text style={styles.fieldLabel}>Email</Text><TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="you@company.com" placeholderTextColor="#71829B" style={styles.input} /></View>
              <View><Text style={styles.fieldLabel}>Password</Text><View><TextInput value={password} onChangeText={setPassword} secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} onSubmitEditing={handleLogin} placeholder="Enter your password" placeholderTextColor="#71829B" returnKeyType="done" style={[styles.input, styles.passwordInput]} /><Pressable accessibilityRole="button" accessibilityLabel={showPassword ? "Hide password" : "Show password"} onPress={() => setShowPassword((current) => !current)} style={styles.eyeButton}><MaterialIcons color="#94A3B8" name={showPassword ? "visibility-off" : "visibility"} size={20} /></Pressable></View></View>
              {error ? <View style={styles.errorBox}><MaterialIcons color="#F87171" name="error-outline" size={18} /><Text style={styles.errorText}>{error}</Text></View> : null}
              <Pressable accessibilityRole="button" disabled={loading} onPress={handleLogin} style={({ pressed }) => [styles.signInButton, (pressed || loading) && styles.signInButtonPressed]}>{loading ? <Text style={styles.signInText}>Verifying securely…</Text> : <><Text style={styles.signInText}>Sign in to the app</Text><MaterialIcons color="#FFFFFF" name="arrow-forward" size={19} /></>}</Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: { flexGrow: 1, justifyContent: "flex-start", paddingBottom: 40, paddingTop: 112 },
  container: { alignSelf: "center", flex: 1, maxWidth: 480, paddingHorizontal: 24, width: "100%" },
  logoSection: { alignItems: "center", marginBottom: 30 }, logoBox: { alignItems: "center", backgroundColor: "#102038", borderColor: "#243754", borderRadius: 42, borderWidth: 1, height: 152, justifyContent: "center", marginBottom: 18, width: 152 }, logoImage: { height: 136, width: 136 }, appName: { color: "#F6F8FC", fontSize: 27, fontWeight: "800", textAlign: "center" },
  formCard: { backgroundColor: "#102038", borderColor: "#243754", borderRadius: 18, borderWidth: 1, gap: 15, padding: 20 }, formTitle: { color: "#F6F8FC", fontSize: 20, fontWeight: "800" }, formDescription: { color: "#A9B8CC", fontSize: 13, lineHeight: 19, marginBottom: 2 }, fieldLabel: { color: "#C9D5E8", fontSize: 12, fontWeight: "800", letterSpacing: 0.5, marginBottom: 7, textTransform: "uppercase" }, input: { backgroundColor: "#0B1730", borderColor: "#243754", borderRadius: 12, borderWidth: 1, color: "#F6F8FC", fontSize: 16, paddingHorizontal: 14, paddingVertical: 14 }, passwordInput: { paddingRight: 50 }, eyeButton: { bottom: 0, justifyContent: "center", paddingHorizontal: 13, position: "absolute", right: 0, top: 0 },
  errorBox: { alignItems: "center", backgroundColor: "#3B2029", borderColor: "#6D3341", borderRadius: 10, borderWidth: 1, flexDirection: "row", padding: 11 }, errorText: { color: "#FFD7DD", flex: 1, fontSize: 13, lineHeight: 18, marginLeft: 8 }, signInButton: { alignItems: "center", backgroundColor: "#4D8DFF", borderRadius: 14, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 3, paddingVertical: 16 }, signInButtonPressed: { opacity: 0.78, transform: [{ scale: 0.985 }] }, signInText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
});
