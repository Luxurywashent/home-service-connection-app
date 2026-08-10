import React, { useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  Alert, Modal, KeyboardAvoidingView, Platform, StyleSheet,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { router } from "expo-router";

function RespondModal({ visible, request, onClose, onSaved }: any) {
  const colors = useColors();
  const [response, setResponse] = useState(request?.adminResponse ?? "");
  const [status, setStatus] = useState(request?.status ?? "in_review");
  const [saving, setSaving] = useState(false);
  const respondMutation = trpc.investor.adminRespondToSupport.useMutation();

  const handleSave = async () => {
    setSaving(true);
    try {
      await respondMutation.mutateAsync({
        requestId: request.requestId,
        adminResponse: response,
        respondedBy: "Admin",
        status: status as any,
      });
      onSaved();
      onClose();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Respond</Text>
            <TouchableOpacity onPress={onClose}><Text style={[styles.cancelText, { color: colors.muted }]}>Cancel</Text></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            {request && (
              <View style={[styles.reqPreview, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.reqSubject, { color: colors.foreground }]}>{request.subject}</Text>
                <Text style={[styles.reqBody, { color: colors.muted }]}>{request.messageBody}</Text>
              </View>
            )}
            <Text style={[styles.label, { color: colors.muted }]}>STATUS</Text>
            <View style={styles.statusRow}>
              {(["open","in_review","resolved"] as const).map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[styles.statusBtn, status === s && { backgroundColor: colors.primary }]}
                  onPress={() => setStatus(s)}
                >
                  <Text style={{ color: status === s ? "#fff" : colors.muted, fontWeight: "600", fontSize: 13 }}>
                    {s.replace("_", " ")}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.label, { color: colors.muted }]}>RESPONSE</Text>
            <TextInput
              style={[styles.textarea, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              placeholder="Type your response to the investor..."
              placeholderTextColor={colors.muted}
              value={response}
              onChangeText={setResponse}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
            />
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: colors.primary }, saving && { opacity: 0.7 }]}
              onPress={handleSave} disabled={saving}
            >
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Send Response</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function AdminInvestorSupportScreen() {
  const colors = useColors();
  const [selectedRequest, setSelectedRequest] = useState<any>(null);

  const requests = trpc.investor.adminListSupportRequests.useQuery();
  const utils = trpc.useUtils();

  const statusColors: Record<string, string> = {
    open: "#F59E0B", in_review: "#3B82F6", resolved: "#22C55E",
  };

  return (
    <ScreenContainer edges={["left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={[styles.backText, { color: colors.primary }]}>← Investors</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.foreground }]}>🆘 Support Requests</Text>

        {requests.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : !requests.data?.length ? (
          <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.muted }]}>No support requests yet.</Text>
          </View>
        ) : (
          requests.data.map((r: any) => {
            const sc = statusColors[r.status] ?? colors.muted;
            return (
              <TouchableOpacity
                key={r.requestId}
                style={[styles.reqCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                onPress={() => setSelectedRequest(r)}
                activeOpacity={0.8}
              >
                <View style={styles.reqHeader}>
                  <Text style={[styles.reqSubject, { color: colors.foreground }]}>{r.subject}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: sc + "20", borderColor: sc }]}>
                    <Text style={[styles.statusText, { color: sc }]}>{r.status.replace("_", " ")}</Text>
                  </View>
                </View>
                <Text style={[styles.reqInvestor, { color: colors.primary }]}>
                  {r.firstName} {r.lastName}
                </Text>
                <Text style={[styles.reqDate, { color: colors.muted }]}>
                  {new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </Text>
                <Text style={[styles.reqBodyPreview, { color: colors.muted }]} numberOfLines={2}>{r.messageBody}</Text>
                <Text style={[styles.respondLink, { color: colors.primary }]}>Tap to respond →</Text>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      <RespondModal
        visible={!!selectedRequest}
        request={selectedRequest}
        onClose={() => setSelectedRequest(null)}
        onSaved={() => utils.investor.adminListSupportRequests.invalidate()}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40 },
  back: { marginBottom: 16 },
  backText: { fontSize: 15, fontWeight: "600" },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 20 },
  empty: { borderRadius: 12, borderWidth: 1, padding: 24, alignItems: "center" },
  emptyText: { fontSize: 14 },
  reqCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 12 },
  reqHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  reqSubject: { fontSize: 15, fontWeight: "700", flex: 1, marginRight: 8 },
  statusBadge: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
  reqInvestor: { fontSize: 13, fontWeight: "600", marginBottom: 2 },
  reqDate: { fontSize: 12, marginBottom: 6 },
  reqBodyPreview: { fontSize: 13, lineHeight: 18, marginBottom: 8 },
  respondLink: { fontSize: 13, fontWeight: "600" },
  // Modal
  modalContainer: { flex: 1, paddingTop: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 0.5, borderBottomColor: "#333" },
  modalTitle: { fontSize: 20, fontWeight: "700" },
  cancelText: { fontSize: 15 },
  modalScroll: { padding: 20, paddingBottom: 40 },
  reqPreview: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 16 },
  reqSubjectPreview: { fontSize: 15, fontWeight: "700", marginBottom: 6 },
  reqBody: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginBottom: 6, marginTop: 12 },
  statusRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  statusBtn: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#33333340" },
  textarea: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, minHeight: 120, marginBottom: 4 },
  saveBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 16 },
  saveBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
