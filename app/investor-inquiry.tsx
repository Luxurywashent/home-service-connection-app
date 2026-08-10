import React, { useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ScreenContainer } from "@/components/screen-container";
import { router } from "expo-router";
import { trpc } from "@/lib/trpc";
import Animated, { FadeInDown } from "react-native-reanimated";

const INVESTMENT_OPTIONS = [
  "$5,000 – $10,000",
  "$10,000 – $20,000",
  "$20,000 – $50,000",
  "$50,000+",
  "Not sure yet",
];

export default function InvestorInquiryScreen() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [investmentInterest, setInvestmentInterest] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submitMutation = trpc.investor.submitInquiry.useMutation({
    onSuccess: () => setSubmitted(true),
    onError: (err) => Alert.alert("Error", err.message || "Something went wrong. Please try again."),
  });

  const handleSubmit = () => {
    if (!fullName.trim()) return Alert.alert("Required", "Please enter your full name.");
    if (!email.trim()) return Alert.alert("Required", "Please enter your email address.");
    if (!/\S+@\S+\.\S+/.test(email.trim())) return Alert.alert("Invalid Email", "Please enter a valid email address.");

    submitMutation.mutate({
      fullName: fullName.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      investmentInterest: investmentInterest || undefined,
      message: message.trim() || undefined,
    });
  };

  if (submitted) {
    return (
      <ScreenContainer edges={["top", "bottom", "left", "right"]} containerClassName="bg-background">
        <LinearGradient colors={["#0f0c29", "#302b63", "#24243e"]} style={styles.fullFlex}>
          <Animated.View entering={FadeInDown.duration(600)} style={styles.successContent}>
            <View style={styles.successIcon}>
              <Text style={styles.successIconText}>✓</Text>
            </View>
            <Text style={styles.successTitle}>Thank You!</Text>
            <Text style={styles.successSubtitle}>
              Your inquiry has been submitted. Our team will review your information and reach out shortly.
            </Text>
            <TouchableOpacity style={styles.successButton} onPress={() => router.back()}>
              <Text style={styles.successButtonText}>Back to Overview</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.loginLink} onPress={() => router.replace("/investor-login" as any)}>
              <Text style={styles.loginLinkText}>Already an investor? Sign in here</Text>
            </TouchableOpacity>
          </Animated.View>
        </LinearGradient>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["top", "bottom", "left", "right"]} containerClassName="bg-background">
      <LinearGradient colors={["#0f0c29", "#302b63", "#24243e"]} style={styles.fullFlex}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.fullFlex}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="interactive"
          >
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                <Text style={styles.backText}>← Back</Text>
              </TouchableOpacity>
            </View>

            <Animated.View entering={FadeInDown.duration(600)} style={styles.formContainer}>
              <Text style={styles.formTitle}>Interested in Investing?</Text>
              <Text style={styles.formSubtitle}>
                Tell us about yourself and we'll reach out with more details about our investment opportunities.
              </Text>

              {/* Full Name */}
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Full Name *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="John Smith"
                  placeholderTextColor="#6B7280"
                  value={fullName}
                  onChangeText={setFullName}
                  autoCapitalize="words"
                  returnKeyType="next"
                />
              </View>

              {/* Email */}
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Email Address *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="john@example.com"
                  placeholderTextColor="#6B7280"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                />
              </View>

              {/* Phone */}
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Phone Number</Text>
                <TextInput
                  style={styles.input}
                  placeholder="(555) 123-4567"
                  placeholderTextColor="#6B7280"
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  returnKeyType="next"
                />
              </View>

              {/* Investment Interest */}
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Investment Range</Text>
                <View style={styles.optionsContainer}>
                  {INVESTMENT_OPTIONS.map((option) => (
                    <TouchableOpacity
                      key={option}
                      style={[styles.optionChip, investmentInterest === option && styles.optionChipSelected]}
                      onPress={() => setInvestmentInterest(investmentInterest === option ? "" : option)}
                    >
                      <Text style={[styles.optionChipText, investmentInterest === option && styles.optionChipTextSelected]}>
                        {option}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Message */}
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Message (Optional)</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Tell us about your investment goals or any questions you have..."
                  placeholderTextColor="#6B7280"
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                  returnKeyType="done"
                />
              </View>

              {/* Submit */}
              <TouchableOpacity
                style={[styles.submitButton, submitMutation.isPending && styles.submitButtonDisabled]}
                onPress={handleSubmit}
                disabled={submitMutation.isPending}
              >
                {submitMutation.isPending ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitButtonText}>Submit Inquiry</Text>
                )}
              </TouchableOpacity>

              <Text style={styles.disclaimer}>
                By submitting, you agree to be contacted about investment opportunities.
                Your information is kept confidential and will not be shared.
              </Text>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  fullFlex: { flex: 1 },
  scrollContent: { paddingBottom: 48 },

  header: { paddingHorizontal: 20, paddingTop: 12 },
  backButton: { paddingVertical: 8 },
  backText: { color: "#A78BFA", fontSize: 16, fontWeight: "600" },

  formContainer: { paddingHorizontal: 24, paddingTop: 16 },
  formTitle: { color: "#fff", fontSize: 28, fontWeight: "800", marginBottom: 8 },
  formSubtitle: { color: "#9CA3AF", fontSize: 15, lineHeight: 22, marginBottom: 28 },

  fieldGroup: { marginBottom: 20 },
  label: { color: "#D1D5DB", fontSize: 14, fontWeight: "600", marginBottom: 8 },
  input: {
    backgroundColor: "#1a1a2e",
    borderWidth: 1,
    borderColor: "#2d2d4e",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: "#fff",
    fontSize: 16,
  },
  textArea: { minHeight: 100, paddingTop: 14 },

  optionsContainer: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  optionChip: {
    backgroundColor: "#1a1a2e",
    borderWidth: 1,
    borderColor: "#2d2d4e",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  optionChipSelected: { backgroundColor: "#7C3AED20", borderColor: "#7C3AED" },
  optionChipText: { color: "#9CA3AF", fontSize: 14, fontWeight: "500" },
  optionChipTextSelected: { color: "#A78BFA" },

  submitButton: {
    backgroundColor: "#7C3AED",
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: "center",
    marginTop: 8,
  },
  submitButtonDisabled: { opacity: 0.7 },
  submitButtonText: { color: "#fff", fontSize: 17, fontWeight: "800" },

  disclaimer: { color: "#6B7280", fontSize: 12, textAlign: "center", marginTop: 16, lineHeight: 18 },

  // Success state
  successContent: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  successIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: "#22C55E", alignItems: "center", justifyContent: "center", marginBottom: 24,
  },
  successIconText: { color: "#fff", fontSize: 36, fontWeight: "800" },
  successTitle: { color: "#fff", fontSize: 28, fontWeight: "800", marginBottom: 12 },
  successSubtitle: { color: "#D1D5DB", fontSize: 16, textAlign: "center", lineHeight: 24, marginBottom: 32 },
  successButton: {
    backgroundColor: "#7C3AED",
    paddingVertical: 16, paddingHorizontal: 40,
    borderRadius: 30, marginBottom: 16,
  },
  successButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  loginLink: { paddingVertical: 12 },
  loginLinkText: { color: "#A78BFA", fontSize: 14, textDecorationLine: "underline" },
});
