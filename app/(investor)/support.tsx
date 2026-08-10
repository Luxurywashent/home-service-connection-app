import React, { useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  KeyboardAvoidingView, Platform, Alert, StyleSheet,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { router, useLocalSearchParams } from "expo-router";

export default function InvestorSupportScreen() {
  const colors = useColors();
  const { token } = useLocalSearchParams<{ token: string }>();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const requests = trpc.investor.getSupportRequests.useQuery(
    { token: token ?? "" },
    { enabled: !!token }
  );
  const submitMutation = trpc.investor.submitSupportRequest.useMutation();
  const utils = trpc.useUtils();

  const handleSubmit = async () => {
    if (!subject.trim() || !message.trim()) {
      Alert.alert("Required", "Please enter a subject and message.");
      return;
    }
    setSubmitting(true);
    try {
      await submitMutation.mutateAsync({ token: token ?? "", subject: subject.trim(), messageBody: message.trim() });
      setSubject("");
      setMessage("");
      setShowForm(false);
      utils.investor.getSupportRequests.invalidate();
      Alert.alert("Submitted", "Your request has been sent. We'll respond shortly.");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const statusColors: Record<string, string> = {
    open: "#F59E0B", in_review: "#3B82F6", resolved: "#22C55E",
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.replace("/(investor)/dashboard" as any)} style={styles.back}>
            <Text style={[styles.backText, { color: colors.primary }]}>← Back</Text>
          </TouchableOpacity>

          <Text style={[styles.title, { color: colors.foreground }]}>🆘 Support</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Have a question or concern? Submit a request and we'll respond promptly.
          </Text>

          {/* New Request Button */}
          <TouchableOpacity
            style={[styles.newBtn, { backgroundColor: colors.primary }]}
            onPress={() => setShowForm(!showForm)}
          >
            <Text style={styles.newBtnText}>{showForm ? "Cancel" : "+ New Request"}</Text>
          </TouchableOpacity>

          {/* Form */}
          {showForm && (
            <View style={[styles.formCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.formTitle, { color: colors.foreground }]}>New Support Request</Text>

              <Text style={[styles.label, { color: colors.muted }]}>SUBJECT</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                placeholder="e.g. Question about my repayment schedule"
                placeholderTextColor={colors.muted}
                value={subject}
                onChangeText={setSubject}
                returnKeyType="next"
              />

              <Text style={[styles.label, { color: colors.muted }]}>MESSAGE</Text>
              <TextInput
                style={[styles.textarea, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                placeholder="Describe your question or concern..."
                placeholderTextColor={colors.muted}
                value={message}
                onChangeText={setMessage}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
              />

              <TouchableOpacity
                style={[styles.submitBtn, { backgroundColor: colors.primary }, submitting && { opacity: 0.7 }]}
                onPress={handleSubmit}
                disabled={submitting}
              >
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Submit Request</Text>}
              </TouchableOpacity>
            </View>
          )}

          {/* Past Requests */}
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Your Requests</Text>
          {requests.isLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : !requests.data?.length ? (
            <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.emptyText, { color: colors.muted }]}>No support requests yet.</Text>
            </View>
          ) : (
            requests.data.map((r: any) => {
              const sc = statusColors[r.status] ?? colors.muted;
              return (
                <View key={r.requestId} style={[styles.reqCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <View style={styles.reqHeader}>
                    <Text style={[styles.reqSubject, { color: colors.foreground }]}>{r.subject}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: sc + "20", borderColor: sc }]}>
                      <Text style={[styles.statusText, { color: sc }]}>{r.status.replace("_", " ")}</Text>
                    </View>
                  </View>
                  <Text style={[styles.reqDate, { color: colors.muted }]}>
                    {new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </Text>
                  <Text style={[styles.reqBody, { color: colors.muted }]} numberOfLines={2}>{r.messageBody}</Text>
                  {r.adminResponse ? (
                    <View style={[styles.responseBox, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30" }]}>
                      <Text style={[styles.responseLabel, { color: colors.primary }]}>Response:</Text>
                      <Text style={[styles.responseText, { color: colors.foreground }]}>{r.adminResponse}</Text>
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40 },
  back: { marginBottom: 16 },
  backText: { fontSize: 15, fontWeight: "600" },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 4 },
  subtitle: { fontSize: 14, marginBottom: 20 },
  newBtn: { borderRadius: 12, paddingVertical: 13, alignItems: "center", marginBottom: 20 },
  newBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  formCard: { borderRadius: 14, borderWidth: 1, padding: 18, marginBottom: 24 },
  formTitle: { fontSize: 17, fontWeight: "700", marginBottom: 16 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginBottom: 6, marginTop: 8 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 4 },
  textarea: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, minHeight: 100, marginBottom: 4 },
  submitBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 16 },
  submitBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  sectionTitle: { fontSize: 18, fontWeight: "700", marginBottom: 12 },
  empty: { borderRadius: 12, borderWidth: 1, padding: 24, alignItems: "center" },
  emptyText: { fontSize: 14 },
  reqCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 12 },
  reqHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  reqSubject: { fontSize: 15, fontWeight: "700", flex: 1, marginRight: 8 },
  statusBadge: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
  reqDate: { fontSize: 12, marginBottom: 6 },
  reqBody: { fontSize: 13, lineHeight: 18, marginBottom: 8 },
  responseBox: { borderRadius: 8, borderWidth: 1, padding: 10 },
  responseLabel: { fontSize: 12, fontWeight: "700", marginBottom: 4 },
  responseText: { fontSize: 13, lineHeight: 18 },
});
