import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useEmployeeAuth } from "@/lib/auth-context";
import { useColors } from "@/hooks/use-colors";
import * as Haptics from "expo-haptics";

function generateId(): string {
  return `ref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function DetailerReferralScreen() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedRepId, setSelectedRepId] = useState<string>("");
  const [selectedRepName, setSelectedRepName] = useState<string>("");
  const [submitted, setSubmitted] = useState(false);

  const salesRepsQuery = trpc.salesCallback.listSalesReps.useQuery();
  const salesReps = (salesRepsQuery.data ?? []) as Array<{ employeeId: string; fullName: string }>;

  const submitMutation = trpc.salesCallback.submitReferral.useMutation({
    onSuccess: () => {
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setSubmitted(true);
    },
    onError: (err) => {
      Alert.alert("Error", err.message || "Failed to submit referral. Please try again.");
    },
  });

  const handleSubmit = () => {
    if (!firstName.trim()) {
      Alert.alert("Missing Info", "Please enter the prospect's first name.");
      return;
    }
    if (!lastName.trim()) {
      Alert.alert("Missing Info", "Please enter the prospect's last name.");
      return;
    }
    if (!phone.trim() || phone.replace(/\D/g, "").length < 7) {
      Alert.alert("Missing Info", "Please enter a valid phone number.");
      return;
    }
    if (!selectedRepId) {
      Alert.alert("Missing Info", "Please select a sales rep to assign this lead to.");
      return;
    }

    submitMutation.mutate({
      callbackId: generateId(),
      referredBy: employee?.employeeId ?? "",
      referredByName: employee?.fullName ?? "Unknown Team Member",
      assignedTo: selectedRepId,
      assignedToName: selectedRepName,
      prospectFirstName: firstName.trim(),
      prospectLastName: lastName.trim(),
      prospectPhone: phone.trim(),
      notes: notes.trim() || undefined,
      timezone: "America/Chicago",
    });
  };

  const handleReset = () => {
    setFirstName("");
    setLastName("");
    setPhone("");
    setNotes("");
    setSelectedRepId("");
    setSelectedRepName("");
    setSubmitted(false);
  };

  if (submitted) {
    return (
      <ScreenContainer>
        <View style={styles.successContainer}>
          <View style={[styles.successIcon, { backgroundColor: "#22C55E" }]}>
            <Text style={styles.successIconText}>✓</Text>
          </View>
          <Text style={[styles.successTitle, { color: colors.foreground }]}>
            Referral Submitted!
          </Text>
          <Text style={[styles.successSubtitle, { color: colors.muted }]}>
            {firstName} {lastName} has been added to the sales callbacks list.{"\n"}
            {selectedRepName} will be notified to follow up.
          </Text>
          <TouchableOpacity
            style={[styles.newReferralButton, { backgroundColor: "#0a7ea4" }]}
            onPress={handleReset}
          >
            <Text style={styles.newReferralButtonText}>Submit Another Referral</Text>
          </TouchableOpacity>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={80}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>
              Field Referral
            </Text>
            <Text style={[styles.headerSubtitle, { color: colors.muted }]}>
              Collect a lead from the field and send it to the sales team for follow-up.
            </Text>
          </View>

          {/* Prospect Info Card */}
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.muted }]}>PROSPECT INFO</Text>

            <View style={styles.row}>
              <View style={styles.halfField}>
                <Text style={[styles.fieldLabel, { color: colors.foreground }]}>First Name *</Text>
                <TextInput
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                  placeholder="First name"
                  placeholderTextColor={colors.muted}
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                  returnKeyType="next"
                />
              </View>
              <View style={styles.halfField}>
                <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Last Name *</Text>
                <TextInput
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                  placeholder="Last name"
                  placeholderTextColor={colors.muted}
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                  returnKeyType="next"
                />
              </View>
            </View>

            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Phone Number *</Text>
            <TextInput
              style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              placeholder="(555) 555-5555"
              placeholderTextColor={colors.muted}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              returnKeyType="next"
            />

            <Text style={[styles.fieldLabel, { color: colors.foreground, marginTop: 8 }]}>
              Notes (optional)
            </Text>
            <TextInput
              style={[
                styles.input,
                styles.notesInput,
                { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background },
              ]}
              placeholder="What did you talk about? Interest level, vehicle type, any context..."
              placeholderTextColor={colors.muted}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              returnKeyType="done"
            />
          </View>

          {/* Sales Rep Picker */}
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { color: colors.muted }]}>ASSIGN TO SALES REP *</Text>

            {salesRepsQuery.isLoading ? (
              <ActivityIndicator size="small" color={colors.muted} style={{ marginVertical: 12 }} />
            ) : salesReps.length === 0 ? (
              <Text style={[styles.emptyText, { color: colors.muted }]}>No sales reps available</Text>
            ) : (
              <View style={styles.repList}>
                {salesReps.map((rep) => {
                  const isSelected = rep.employeeId === selectedRepId;
                  return (
                    <TouchableOpacity
                      key={rep.employeeId}
                      style={[
                        styles.repItem,
                        {
                          borderColor: isSelected ? "#0a7ea4" : colors.border,
                          backgroundColor: isSelected ? "#0a7ea415" : colors.background,
                        },
                      ]}
                      onPress={() => {
                        setSelectedRepId(rep.employeeId);
                        setSelectedRepName(rep.fullName);
                        if (Platform.OS !== "web") {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        }
                      }}
                      activeOpacity={0.75}
                    >
                      <View style={[styles.repAvatar, { backgroundColor: isSelected ? "#0a7ea4" : colors.muted }]}>
                        <Text style={styles.repAvatarText}>
                          {rep.fullName?.charAt(0)?.toUpperCase() ?? "?"}
                        </Text>
                      </View>
                      <Text style={[styles.repName, { color: colors.foreground }]}>
                        {rep.fullName}
                      </Text>
                      {isSelected && (
                        <View style={styles.checkmark}>
                          <Text style={styles.checkmarkText}>✓</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            style={[
              styles.submitButton,
              {
                backgroundColor: submitMutation.isPending ? colors.muted : "#0a7ea4",
                opacity: submitMutation.isPending ? 0.7 : 1,
              },
            ]}
            onPress={handleSubmit}
            disabled={submitMutation.isPending}
            activeOpacity={0.85}
          >
            {submitMutation.isPending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.submitButtonText}>Submit Referral</Text>
            )}
          </TouchableOpacity>

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 20,
  },
  headerTitle: {
    fontSize: 26,
    fontWeight: "700",
    marginBottom: 6,
  },
  headerSubtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  halfField: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 4,
  },
  notesInput: {
    height: 100,
    paddingTop: 10,
  },
  repList: {
    gap: 8,
  },
  repItem: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: 10,
    padding: 12,
    gap: 12,
  },
  repAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  repAvatarText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  repName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "500",
  },
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#0a7ea4",
    alignItems: "center",
    justifyContent: "center",
  },
  checkmarkText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  emptyText: {
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 12,
  },
  submitButton: {
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  submitButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  successContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  successIconText: {
    color: "#fff",
    fontSize: 36,
    fontWeight: "700",
  },
  successTitle: {
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 12,
    textAlign: "center",
  },
  successSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 32,
  },
  newReferralButton: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignItems: "center",
  },
  newReferralButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});
