import { useState } from "react";
import {
  Text, View, Image, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Alert, Modal
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { useCustomerAuth } from "@/lib/customer-context";
import { trpc } from "@/lib/trpc";
import { MaterialIcons } from "@expo/vector-icons";

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default function LoginScreen() {
  const colors = useColors();
  const router = useRouter();
  const { login: employeeLogin } = useEmployeeAuth();
  const { loginCustomer } = useCustomerAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const customerLoginMutation = trpc.customer.login.useMutation();
  const employeeLoginMutation = trpc.employee.login.useMutation();

  // Forgot Password
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const forgotPasswordMutation = trpc.customer.forgotPassword.useMutation({
    onSuccess: () => { setForgotLoading(false); setForgotSent(true); },
    onError: (e) => { setForgotLoading(false); Alert.alert("Error", e.message); },
  });
  const handleForgotPassword = () => {
    if (!forgotEmail.trim()) { Alert.alert("Required", "Please enter your email address."); return; }
    setForgotLoading(true);
    forgotPasswordMutation.mutate({ email: forgotEmail.trim().toLowerCase() });
  };

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError("Please enter your email and password");
      return;
    }
    setError("");
    setLoading(true);
    try {
      // First try customer login
      const customerResult = await customerLoginMutation.mutateAsync({
        email: email.trim().toLowerCase(),
        password,
      });

      if (customerResult.success && customerResult.token && customerResult.customer) {
        await loginCustomer(customerResult.token, customerResult.customer);
        router.replace("/(customer)/home" as any);
        return;
      }

      // If customer login fails, try employee login
      const employeeResult = await employeeLoginMutation.mutateAsync({
        identifier: email.trim(),
        pin: password,
      });

      if (employeeResult.success && employeeResult.employee) {
        await employeeLogin(employeeResult.employee as any, true);
        const greeting = getGreeting();
        alert(`${greeting}, ${employeeResult.employee.fullName}! Welcome to Home Service Connection.`);
        const role = employeeResult.employee.role;
        if (role === "door_hanger_rep" || role === "sales") {
          router.replace("/(sales)/dashboard");
        } else if (role === "operations_manager") {
          router.replace("/(tabs)/ops-dashboard");
        } else if (role === "admin" || role === "office") {
          router.replace("/(tabs)/admin-dashboard");
        } else {
          router.replace("/(tabs)");
        }
        return;
      }

      setError("Invalid email or password. Please try again.");
    } catch (e: any) {
      // If customer login throws, still try employee login
      try {
        const employeeResult = await employeeLoginMutation.mutateAsync({
          identifier: email.trim(),
          pin: password,
        });
        if (employeeResult.success && employeeResult.employee) {
          await employeeLogin(employeeResult.employee as any, true);
          const greeting = getGreeting();
          alert(`${greeting}, ${employeeResult.employee.fullName}! Welcome to Home Service Connection.`);
          const role = employeeResult.employee.role;
          if (role === "door_hanger_rep" || role === "sales") {
            router.replace("/(sales)/dashboard");
          } else if (role === "operations_manager") {
            router.replace("/(tabs)/ops-dashboard");
          } else if (role === "admin" || role === "office") {
            router.replace("/(tabs)/admin-dashboard");
          } else {
            router.replace("/(tabs)");
          }
          return;
        }
      } catch {
        // both failed
      }
      setError("Invalid email or password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenContainer edges={["bottom", "left", "right"]} containerClassName="bg-background">
      {/* Forgot Password Modal */}
      <Modal visible={showForgotModal} transparent animationType="fade" onRequestClose={() => setShowForgotModal(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 24 }}>
          <View style={{ backgroundColor: "#fff", borderRadius: 16, padding: 24, width: "100%", maxWidth: 380 }}>
            {forgotSent ? (
              <>
                <Text style={{ fontSize: 24, textAlign: "center", marginBottom: 12 }}>📧</Text>
                <Text style={{ fontSize: 18, fontWeight: "700", color: "#111827", textAlign: "center", marginBottom: 8 }}>Check Your Email</Text>
                <Text style={{ fontSize: 14, color: "#6B7280", textAlign: "center", lineHeight: 20, marginBottom: 20 }}>
                  If an account exists for {forgotEmail}, we've sent a link to set your password. Check your inbox (and spam folder).
                </Text>
                <TouchableOpacity onPress={() => setShowForgotModal(false)} style={{ backgroundColor: "#0a7ea4", borderRadius: 10, paddingVertical: 13, alignItems: "center" }} activeOpacity={0.85}>
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Done</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={{ fontSize: 18, fontWeight: "700", color: "#111827", marginBottom: 6 }}>Reset Password</Text>
                <Text style={{ fontSize: 14, color: "#6B7280", marginBottom: 16, lineHeight: 20 }}>Enter your email and we'll send you a link to set a new password.</Text>
                <TextInput
                  value={forgotEmail}
                  onChangeText={setForgotEmail}
                  placeholder="your@email.com"
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="none"
                  keyboardType="email-address"
                  style={{ borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: "#111827", marginBottom: 16 }}
                />
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TouchableOpacity onPress={() => setShowForgotModal(false)} style={{ flex: 1, borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 10, paddingVertical: 13, alignItems: "center" }} activeOpacity={0.75}>
                    <Text style={{ color: "#6B7280", fontWeight: "600", fontSize: 15 }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={handleForgotPassword} disabled={forgotLoading} style={{ flex: 1, backgroundColor: "#0a7ea4", borderRadius: 10, paddingVertical: 13, alignItems: "center", opacity: forgotLoading ? 0.7 : 1 }} activeOpacity={0.85}>
                    {forgotLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Send Link</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }} keyboardShouldPersistTaps="handled">
          <View style={styles.container}>

            {/* Logo */}
            <View style={styles.logoSection}>
              <View style={styles.logoBox}>
                <Image source={require("../assets/images/icon.png")} style={styles.logoImage} resizeMode="contain" />
              </View>
              <Text style={styles.appName}>Home Service Connection</Text>
              <Text style={styles.appSubtitle}>Home service operations</Text>
            </View>

            {/* Form */}
            <View style={styles.form}>
              <View>
                <Text style={styles.fieldLabel}>Email</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Enter your email"
                  placeholderTextColor="#9CA3AF"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  returnKeyType="next"
                  style={styles.input}
                />
              </View>

              <View>
                <Text style={styles.fieldLabel}>Password</Text>
                <View style={{ position: "relative" }}>
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder="Enter your password"
                    placeholderTextColor="#9CA3AF"
                    secureTextEntry={!showPassword}
                    returnKeyType="done"
                    onSubmitEditing={handleLogin}
                    style={[styles.input, { paddingRight: 48 }]}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                    style={styles.eyeBtn}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons
                      name={showPassword ? "visibility-off" : "visibility"}
                      size={20}
                      color="#9CA3AF"
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {error ? (
                <View style={styles.errorBox}>
                  <MaterialIcons name="error-outline" size={16} color="#EF4444" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                onPress={handleLogin}
                disabled={loading}
                activeOpacity={0.85}
                style={[styles.signInBtn, loading && { opacity: 0.7 }]}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.signInBtnText}>Sign In</Text>
                )}
              </TouchableOpacity>

              {/* Forgot password link */}
              <TouchableOpacity
                onPress={() => { setForgotEmail(email); setForgotSent(false); setShowForgotModal(true); }}
                style={{ alignSelf: "flex-end", marginBottom: 4, marginTop: -4 }}
                activeOpacity={0.7}
              >
                <Text style={{ fontSize: 13, color: "#4D8DFF", fontWeight: "600" }}>Forgot Password?</Text>
              </TouchableOpacity>

              {/* New customer link */}
              <View style={styles.signUpRow}>
                <Text style={styles.signUpRowText}>New customer?</Text>
                              <TouchableOpacity
                onPress={() => router.push("/signup" as any)}
                activeOpacity={0.7}
              >
                <Text style={styles.signUpLink}>Create an account</Text>
              </TouchableOpacity>
              </View>
              {/* Investor Portal link — hidden until program is finalized */}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 28 },
  logoSection: { alignItems: "center", paddingVertical: 32 },
  logoBox: { width: 80, height: 80, borderRadius: 22, backgroundColor: "#102038", borderWidth: 1, borderColor: "#243754", justifyContent: "center", alignItems: "center", marginBottom: 16 },
  logoImage: { width: 66, height: 66 },
  appName: { fontSize: 24, fontWeight: "800", color: "#F6F8FC", textAlign: "center" },
  appSubtitle: { fontSize: 14, color: "#94A3B8", marginTop: 4 },
  form: { gap: 16 },
  fieldLabel: { fontSize: 13, fontWeight: "700", color: "#C9D5E8", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  input: { backgroundColor: "#102038", borderWidth: 1, borderColor: "#243754", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: "#F6F8FC" },
  eyeBtn: { position: "absolute", right: 14, top: 0, bottom: 0, justifyContent: "center" },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FEF2F2", borderRadius: 10, padding: 12 },
  errorText: { fontSize: 14, color: "#EF4444", flex: 1 },
  signInBtn: { backgroundColor: "#4D8DFF", borderRadius: 100, paddingVertical: 16, alignItems: "center", marginTop: 4 },
  signInBtnText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  signUpRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 4, paddingTop: 4 },
  signUpRowText: { fontSize: 14, color: "#94A3B8" },
  signUpLink: { fontSize: 14, fontWeight: "700", color: "#52D3B8" },
});
