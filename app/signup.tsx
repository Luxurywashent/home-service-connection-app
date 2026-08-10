import { useState, useRef } from "react";
import {
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput as TextInputType,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useCustomerAuth } from "@/lib/customer-context";
import { MaterialIcons } from "@expo/vector-icons";
import { trpc } from "@/lib/trpc";

export default function SignUpScreen() {
  const colors = useColors();
  const router = useRouter();
  const { loginCustomer } = useCustomerAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const lastNameRef = useRef<TextInputType>(null);
  const emailRef = useRef<TextInputType>(null);
  const phoneRef = useRef<TextInputType>(null);
  const passwordRef = useRef<TextInputType>(null);
  const confirmRef = useRef<TextInputType>(null);

  const signupMutation = trpc.customer.signup.useMutation();

  const validate = () => {
    if (!firstName.trim()) return "Please enter your first name";
    if (!lastName.trim()) return "Please enter your last name";
    if (!email.trim() || !email.includes("@")) return "Please enter a valid email";
    if (!phone.trim() || phone.replace(/\D/g, "").length < 10) return "Please enter a valid phone number";
    if (password.length < 6) return "Password must be at least 6 characters";
    if (password !== confirmPassword) return "Passwords do not match";
    return null;
  };

  const handleSignUp = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setLoading(true);
    try {
      const result = await signupMutation.mutateAsync({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        password,
      });
      if (result.success && result.token && result.customer) {
        await loginCustomer(result.token, result.customer);
        router.replace("/(customer)/home" as any);
      } else {
        setError(result.message ?? "Sign up failed. Please try again.");
      }
    } catch (e: any) {
      if (e?.message?.includes("already exists") || e?.message?.includes("duplicate")) {
        setError("An account with this email already exists. Please sign in.");
      } else {
        setError("Connection error. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.foreground,
  };

  const labelStyle = {
    fontSize: 13,
    fontWeight: "600" as const,
    color: colors.muted,
    marginBottom: 6,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  };

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]}>
      {/* Fixed header — always visible above keyboard/scroll */}
      <View style={[styles.header, { borderBottomWidth: 0.5, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.replace("/")} style={styles.backBtn} activeOpacity={0.7}>
          <MaterialIcons name="arrow-back" size={24} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Create Account</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          <View style={styles.container}>
            <View style={styles.form}>
              <Text style={[styles.welcomeText, { color: colors.foreground }]}>
                Welcome to{"\n"}Luxury Wash On Wheels
              </Text>
              <Text style={[styles.subText, { color: colors.muted }]}>
                Create an account to book your detail and track your appointments.
              </Text>

              {/* Name Row */}
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={labelStyle}>First Name</Text>
                  <TextInput
                    value={firstName}
                    onChangeText={setFirstName}
                    placeholder="First"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="words"
                    returnKeyType="next"
                    onSubmitEditing={() => lastNameRef.current?.focus()}
                    style={inputStyle}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={labelStyle}>Last Name</Text>
                  <TextInput
                    ref={lastNameRef}
                    value={lastName}
                    onChangeText={setLastName}
                    placeholder="Last"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="words"
                    returnKeyType="next"
                    onSubmitEditing={() => emailRef.current?.focus()}
                    style={inputStyle}
                  />
                </View>
              </View>

              {/* Email */}
              <View>
                <Text style={labelStyle}>Email</Text>
                <TextInput
                  ref={emailRef}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  returnKeyType="next"
                  onSubmitEditing={() => phoneRef.current?.focus()}
                  style={inputStyle}
                />
              </View>

              {/* Phone */}
              <View>
                <Text style={labelStyle}>Phone</Text>
                <TextInput
                  ref={phoneRef}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="(850) 000-0000"
                  placeholderTextColor={colors.muted}
                  keyboardType="phone-pad"
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  style={inputStyle}
                />
              </View>

              {/* Password */}
              <View>
                <Text style={labelStyle}>Password</Text>
                <View style={{ position: "relative" }}>
                  <TextInput
                    ref={passwordRef}
                    value={password}
                    onChangeText={setPassword}
                    placeholder="At least 6 characters"
                    placeholderTextColor={colors.muted}
                    secureTextEntry={!showPassword}
                    returnKeyType="next"
                    onSubmitEditing={() => confirmRef.current?.focus()}
                    style={[inputStyle, { paddingRight: 48 }]}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                    style={styles.eyeBtn}
                    activeOpacity={0.7}
                  >
                    <MaterialIcons
                      name={showPassword ? "visibility-off" : "visibility"}
                      size={20}
                      color={colors.muted}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Confirm Password */}
              <View>
                <Text style={labelStyle}>Confirm Password</Text>
                <TextInput
                  ref={confirmRef}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Re-enter password"
                  placeholderTextColor={colors.muted}
                  secureTextEntry={!showPassword}
                  returnKeyType="done"
                  onSubmitEditing={handleSignUp}
                  style={inputStyle}
                />
              </View>

              {/* Error */}
              {error ? (
                <View style={[styles.errorBox, { backgroundColor: "#FEF2F2" }]}>
                  <MaterialIcons name="error-outline" size={16} color={colors.error} />
                  <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
                </View>
              ) : null}

              {/* Sign Up Button */}
              <TouchableOpacity
                onPress={handleSignUp}
                disabled={loading}
                activeOpacity={0.85}
                style={[styles.signupBtn, { backgroundColor: "#0A0A0A", opacity: loading ? 0.7 : 1 }]}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.signupBtnText}>Create Account</Text>
                )}
              </TouchableOpacity>

              {/* Already have account */}
              <View style={styles.loginRow}>
                <Text style={[styles.loginRowText, { color: colors.muted }]}>Already have an account?</Text>
                <TouchableOpacity onPress={() => router.push("/login" as any)} activeOpacity={0.7}>
                  <Text style={[styles.loginLink, { color: colors.primary }]}>Sign In</Text>
                </TouchableOpacity>
              </View>

              <Text style={[styles.terms, { color: colors.muted }]}>
                By creating an account, you agree to our Terms of Service and Privacy Policy.
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
  },
  form: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 40,
    gap: 16,
  },
  welcomeText: {
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -0.5,
    lineHeight: 34,
  },
  subText: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: -8,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  eyeBtn: {
    position: "absolute",
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    padding: 12,
  },
  errorText: {
    fontSize: 14,
    flex: 1,
  },
  signupBtn: {
    borderRadius: 100,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 4,
  },
  signupBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  loginRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 4,
  },
  loginRowText: {
    fontSize: 14,
  },
  loginLink: {
    fontSize: 14,
    fontWeight: "700",
  },
  terms: {
    fontSize: 11,
    textAlign: "center",
    lineHeight: 16,
  },
});
