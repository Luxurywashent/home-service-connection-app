import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useState } from "react";
import { useRouter } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";

import { ScreenContainer } from "@/components/screen-container";
import { useEmployeeAuth } from "@/lib/auth-context";
import { getNativeEmployeeSession, useJobSyncAuth, type JobSyncPortalKind } from "@/lib/jobsync-auth-context";

export default function LoginScreen() {
  const router = useRouter();
  const { loginCompany, loginPlatform } = useJobSyncAuth();
  const { login: establishNativeRole, logout: logoutLegacyEmployee } = useEmployeeAuth();
  const [portal, setPortal] = useState<JobSyncPortalKind>("company");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const companyPortal = portal === "company";
  const title = companyPortal ? "Company Sign In" : "Platform Admin";
  const description = companyPortal
    ? "Sign in to your Home Service Connection Company workspace."
    : "Sign in with your separate JobSync platform-admin account.";

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const session = companyPortal
        ? await loginCompany({ email: email.trim(), password })
        : await loginPlatform({ email: email.trim(), password });

      await logoutLegacyEmployee();
      if (session.portal === "platform") {
        router.replace("/platform-dashboard");
        return;
      }
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
      setError(loginError?.message || (companyPortal ? "We could not verify those Company credentials." : "We could not verify those platform-admin credentials."));
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
              <Text style={styles.appSubtitle}>Native mobile access to your JobSync account</Text>
            </View>

            <View style={styles.modeToggle}>
              <Pressable accessibilityRole="button" onPress={() => { setPortal("company"); setError(""); }} style={[styles.modeButton, companyPortal && styles.modeButtonActive]}>
                <MaterialIcons color={companyPortal ? "#FFFFFF" : "#94A3B8"} name="business" size={17} /><Text style={[styles.modeButtonText, companyPortal && styles.modeButtonTextActive]}>Company</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => { setPortal("platform"); setError(""); }} style={[styles.modeButton, !companyPortal && styles.modeButtonActive]}>
                <MaterialIcons color={!companyPortal ? "#FFFFFF" : "#94A3B8"} name="admin-panel-settings" size={17} /><Text style={[styles.modeButtonText, !companyPortal && styles.modeButtonTextActive]}>Platform Admin</Text>
              </Pressable>
            </View>

            <View style={styles.formCard}>
              <Text style={styles.formTitle}>{title}</Text>
              <Text style={styles.formDescription}>{description}</Text>
              <View><Text style={styles.fieldLabel}>Email</Text><TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="you@company.com" placeholderTextColor="#71829B" style={styles.input} /></View>
              <View><Text style={styles.fieldLabel}>Password</Text><View><TextInput value={password} onChangeText={setPassword} secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} onSubmitEditing={handleLogin} placeholder="Enter your password" placeholderTextColor="#71829B" returnKeyType="done" style={[styles.input, styles.passwordInput]} /><Pressable accessibilityRole="button" accessibilityLabel={showPassword ? "Hide password" : "Show password"} onPress={() => setShowPassword((current) => !current)} style={styles.eyeButton}><MaterialIcons color="#94A3B8" name={showPassword ? "visibility-off" : "visibility"} size={20} /></Pressable></View></View>
              {error ? <View style={styles.errorBox}><MaterialIcons color="#F87171" name="error-outline" size={18} /><Text style={styles.errorText}>{error}</Text></View> : null}
              <Pressable accessibilityRole="button" disabled={loading} onPress={handleLogin} style={({ pressed }) => [styles.signInButton, (pressed || loading) && styles.signInButtonPressed]}>{loading ? <Text style={styles.signInText}>Verifying securely…</Text> : <><Text style={styles.signInText}>Sign in to the app</Text><MaterialIcons color="#FFFFFF" name="arrow-forward" size={19} /></>}</Pressable>
            </View>
            <View style={styles.notice}><MaterialIcons color="#52D3B8" name="verified-user" size={19} /><Text style={styles.noticeText}>Your password is verified by JobSync. The app creates its own native session and does not open the website.</Text></View>
            <Text style={styles.helpText}>{companyPortal ? "Company Owner/Admin, Operations Manager, and Detailer access is assigned automatically from your JobSync Company role." : "Platform Admin credentials are separate from Company credentials."}</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: { flexGrow: 1, justifyContent: "center", paddingBottom: 28, paddingTop: 48 },
  container: { alignSelf: "center", flex: 1, maxWidth: 480, paddingHorizontal: 24, width: "100%" },
  logoSection: { alignItems: "center", marginBottom: 24 }, logoBox: { alignItems: "center", backgroundColor: "#102038", borderColor: "#243754", borderRadius: 24, borderWidth: 1, height: 84, justifyContent: "center", marginBottom: 15, width: 84 }, logoImage: { height: 68, width: 68 }, appName: { color: "#F6F8FC", fontSize: 25, fontWeight: "800", textAlign: "center" }, appSubtitle: { color: "#94A3B8", fontSize: 13, marginTop: 6, textAlign: "center" },
  modeToggle: { backgroundColor: "#102038", borderColor: "#243754", borderRadius: 13, borderWidth: 1, flexDirection: "row", marginBottom: 14, padding: 4 }, modeButton: { alignItems: "center", borderRadius: 9, flex: 1, flexDirection: "row", gap: 7, justifyContent: "center", paddingVertical: 10 }, modeButtonActive: { backgroundColor: "#4D8DFF" }, modeButtonText: { color: "#94A3B8", fontSize: 13, fontWeight: "800" }, modeButtonTextActive: { color: "#FFFFFF" },
  formCard: { backgroundColor: "#102038", borderColor: "#243754", borderRadius: 18, borderWidth: 1, gap: 15, padding: 20 }, formTitle: { color: "#F6F8FC", fontSize: 20, fontWeight: "800" }, formDescription: { color: "#A9B8CC", fontSize: 13, lineHeight: 19, marginBottom: 2 }, fieldLabel: { color: "#C9D5E8", fontSize: 12, fontWeight: "800", letterSpacing: 0.5, marginBottom: 7, textTransform: "uppercase" }, input: { backgroundColor: "#0B1730", borderColor: "#243754", borderRadius: 12, borderWidth: 1, color: "#F6F8FC", fontSize: 16, paddingHorizontal: 14, paddingVertical: 14 }, passwordInput: { paddingRight: 50 }, eyeButton: { bottom: 0, justifyContent: "center", paddingHorizontal: 13, position: "absolute", right: 0, top: 0 },
  errorBox: { alignItems: "center", backgroundColor: "#3B2029", borderColor: "#6D3341", borderRadius: 10, borderWidth: 1, flexDirection: "row", padding: 11 }, errorText: { color: "#FFD7DD", flex: 1, fontSize: 13, lineHeight: 18, marginLeft: 8 }, signInButton: { alignItems: "center", backgroundColor: "#4D8DFF", borderRadius: 14, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 3, paddingVertical: 16 }, signInButtonPressed: { opacity: 0.78, transform: [{ scale: 0.985 }] }, signInText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  notice: { alignItems: "flex-start", backgroundColor: "#0E2730", borderColor: "#1F4E55", borderRadius: 14, borderWidth: 1, flexDirection: "row", marginTop: 18, padding: 14 }, noticeText: { color: "#B5D9D0", flex: 1, fontSize: 12.5, lineHeight: 18, marginLeft: 10 }, helpText: { color: "#8FA3C1", fontSize: 12.5, lineHeight: 19, marginHorizontal: 12, marginTop: 18, textAlign: "center" },
});
