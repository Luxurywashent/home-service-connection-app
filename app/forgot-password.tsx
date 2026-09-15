import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { requestJobSyncCompanyPasswordReset } from "@/lib/jobsync-mobile-api";

const GENERIC_SUCCESS = "If an account matches that email address, we sent a password-reset link. Please check your inbox.";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setError("Enter a valid Company email address."); return; }
    setError(""); setLoading(true);
    try { await requestJobSyncCompanyPasswordReset(email); setSent(true); }
    catch { setError("We couldn’t process that request. Please try again."); }
    finally { setLoading(false); }
  };
  return <ScreenContainer edges={["bottom", "left", "right"]} containerClassName="bg-background"><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}><ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"><View style={styles.container}><Pressable accessibilityRole="button" onPress={() => router.replace("/login")} style={styles.back}><MaterialIcons color="#69C7FF" name="arrow-back" size={18} /><Text style={styles.backText}>Company sign in</Text></Pressable><View style={styles.badge}><MaterialIcons color="#69C7FF" name={sent ? "mark-email-read" : "lock-reset"} size={30} /></View><Text style={styles.title}>{sent ? "Check your inbox" : "Reset your password"}</Text><Text style={styles.copy}>{sent ? GENERIC_SUCCESS : "Enter the Company email used for web and mobile. We’ll email a secure one-time link that opens the web reset page."}</Text>{!sent ? <View style={styles.card}><Text style={styles.label}>Company email</Text><TextInput value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder="you@company.com" placeholderTextColor="#71829B" style={styles.input} /><Text style={styles.hint}>The reset link expires in 60 minutes.</Text>{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}<Pressable accessibilityRole="button" disabled={loading} onPress={submit} style={({ pressed }) => [styles.button, (pressed || loading) && styles.buttonPressed]}><Text style={styles.buttonText}>{loading ? "Sending secure link…" : "Send reset link"}</Text><MaterialIcons color="#fff" name="mail-outline" size={19} /></Pressable></View> : <Pressable accessibilityRole="button" onPress={() => router.replace("/login")} style={styles.button}><Text style={styles.buttonText}>Back to sign in</Text><MaterialIcons color="#fff" name="arrow-forward" size={19} /></Pressable>}</View></ScrollView></KeyboardAvoidingView></ScreenContainer>;
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: "center", paddingVertical: 48 }, container: { alignSelf: "center", maxWidth: 480, paddingHorizontal: 24, width: "100%" }, back: { alignItems: "center", flexDirection: "row", gap: 6, marginBottom: 52 }, backText: { color: "#69C7FF", fontSize: 14, fontWeight: "700" }, badge: { alignItems: "center", backgroundColor: "#102038", borderColor: "#27496A", borderRadius: 18, borderWidth: 1, height: 62, justifyContent: "center", marginBottom: 19, width: 62 }, title: { color: "#F6F8FC", fontSize: 32, fontWeight: "800", letterSpacing: -0.8 }, copy: { color: "#A9B8CC", fontSize: 15, lineHeight: 22, marginTop: 12 }, card: { backgroundColor: "#102038", borderColor: "#243754", borderRadius: 18, borderWidth: 1, gap: 14, marginTop: 28, padding: 20 }, label: { color: "#C9D5E8", fontSize: 12, fontWeight: "800", letterSpacing: .5, textTransform: "uppercase" }, input: { backgroundColor: "#0B1730", borderColor: "#243754", borderRadius: 12, borderWidth: 1, color: "#F6F8FC", fontSize: 16, paddingHorizontal: 14, paddingVertical: 14 }, hint: { color: "#8DA1BB", fontSize: 12, lineHeight: 17 }, error: { color: "#FFD7DD", fontSize: 13, lineHeight: 18 }, button: { alignItems: "center", backgroundColor: "#4D8DFF", borderRadius: 14, flexDirection: "row", gap: 8, justifyContent: "center", marginTop: 22, paddingVertical: 16 }, buttonPressed: { opacity: .78, transform: [{ scale: .985 }] }, buttonText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
