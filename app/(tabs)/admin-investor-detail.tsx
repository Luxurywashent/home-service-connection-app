import React, { useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  Alert, Modal, KeyboardAvoidingView, Platform, StyleSheet,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { router, useLocalSearchParams } from "expo-router";

type ActiveTab = "overview" | "investments" | "payments" | "documents";

// ─── Add Investment Modal ────────────────────────────────────────────────────
function AddInvestmentModal({ visible, investorId, onClose, onSaved }: any) {
  const colors = useColors();
  const [form, setForm] = useState({
    investmentAmount: "", investmentDate: new Date().toISOString().split("T")[0],
    totalRepaymentAmount: "", totalPaymentsExpected: "", loanTermMonths: "",
    repaymentType: "monthly", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const createMutation = trpc.investor.adminCreateInvestment.useMutation();

  const handleSave = async () => {
    if (!form.investmentAmount || !form.investmentDate) {
      Alert.alert("Required", "Investment amount and date are required.");
      return;
    }
    setSaving(true);
    try {
      await createMutation.mutateAsync({
        investorId, adminName: "Admin",
        investmentAmount: form.investmentAmount,
        investmentDate: form.investmentDate,
        totalRepaymentAmount: form.totalRepaymentAmount || undefined,
        totalPaymentsExpected: form.totalPaymentsExpected ? parseInt(form.totalPaymentsExpected) : undefined,
        loanTermMonths: form.loanTermMonths ? parseInt(form.loanTermMonths) : undefined,
        repaymentType: form.repaymentType,
        notes: form.notes || undefined,
        status: "active",
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
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add Investment</Text>
            <TouchableOpacity onPress={onClose}><Text style={[styles.cancelText, { color: colors.muted }]}>Cancel</Text></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            {[
              { key: "investmentAmount", label: "INVESTMENT AMOUNT ($)", placeholder: "10000" },
              { key: "investmentDate", label: "INVESTMENT DATE (YYYY-MM-DD)", placeholder: "2025-01-15" },
              { key: "totalRepaymentAmount", label: "TOTAL REPAYMENT AMOUNT ($)", placeholder: "12000" },
              { key: "totalPaymentsExpected", label: "TOTAL PAYMENTS EXPECTED", placeholder: "12" },
              { key: "loanTermMonths", label: "LOAN TERM (MONTHS)", placeholder: "12" },
              { key: "repaymentType", label: "REPAYMENT TYPE", placeholder: "monthly" },
              { key: "notes", label: "NOTES (optional)", placeholder: "Any additional details..." },
            ].map((f) => (
              <View key={f.key}>
                <Text style={[styles.label, { color: colors.muted }]}>{f.label}</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                  placeholder={f.placeholder}
                  placeholderTextColor={colors.muted}
                  value={(form as any)[f.key]}
                  onChangeText={(v) => setForm(prev => ({ ...prev, [f.key]: v }))}
                  keyboardType={["investmentAmount","totalRepaymentAmount","totalPaymentsExpected","loanTermMonths"].includes(f.key) ? "numeric" : "default"}
                />
              </View>
            ))}
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: colors.primary }, saving && { opacity: 0.7 }]}
              onPress={handleSave} disabled={saving}
            >
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Investment</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Record Payment Modal ────────────────────────────────────────────────────
function RecordPaymentModal({ visible, investmentId, onClose, onSaved }: any) {
  const colors = useColors();
  const [form, setForm] = useState({
    amountDue: "", amountPaid: "", dueDate: "", paidDate: new Date().toISOString().split("T")[0],
    status: "completed", paymentMethod: "", referenceNumber: "", adminNotes: "",
  });
  const [saving, setSaving] = useState(false);
  const createMutation = trpc.investor.adminRecordPayment.useMutation();

  const handleSave = async () => {
    if (!form.amountDue) { Alert.alert("Required", "Amount due is required."); return; }
    setSaving(true);
    try {
      await createMutation.mutateAsync({
        investmentId, adminName: "Admin",
        amountDue: form.amountDue,
        amountPaid: form.amountPaid || undefined,
        dueDate: form.dueDate || undefined,
        paidDate: form.paidDate || undefined,
        status: form.status as any,
        paymentMethod: form.paymentMethod || undefined,
        referenceNumber: form.referenceNumber || undefined,
        adminNotes: form.adminNotes || undefined,
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
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Record Payment</Text>
            <TouchableOpacity onPress={onClose}><Text style={[styles.cancelText, { color: colors.muted }]}>Cancel</Text></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            {[
              { key: "amountDue", label: "AMOUNT DUE ($)", placeholder: "1000" },
              { key: "amountPaid", label: "AMOUNT PAID ($)", placeholder: "1000" },
              { key: "dueDate", label: "DUE DATE (YYYY-MM-DD)", placeholder: "2025-02-01" },
              { key: "paidDate", label: "PAID DATE (YYYY-MM-DD)", placeholder: "2025-02-01" },
              { key: "status", label: "STATUS", placeholder: "completed / scheduled / missed / delayed" },
              { key: "paymentMethod", label: "PAYMENT METHOD", placeholder: "ACH / Check / Zelle" },
              { key: "referenceNumber", label: "REFERENCE NUMBER", placeholder: "Optional" },
              { key: "adminNotes", label: "NOTES", placeholder: "Optional" },
            ].map((f) => (
              <View key={f.key}>
                <Text style={[styles.label, { color: colors.muted }]}>{f.label}</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                  placeholder={f.placeholder}
                  placeholderTextColor={colors.muted}
                  value={(form as any)[f.key]}
                  onChangeText={(v) => setForm(prev => ({ ...prev, [f.key]: v }))}
                  keyboardType={["amountDue","amountPaid"].includes(f.key) ? "numeric" : "default"}
                />
              </View>
            ))}
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: colors.primary }, saving && { opacity: 0.7 }]}
              onPress={handleSave} disabled={saving}
            >
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Record Payment</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function AdminInvestorDetailScreen() {
  const colors = useColors();
  const { investorId } = useLocalSearchParams<{ investorId: string }>();
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [showAddInvestment, setShowAddInvestment] = useState(false);
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [selectedInvestmentId, setSelectedInvestmentId] = useState<string | null>(null);

  const detail = trpc.investor.adminGetInvestorDetail.useQuery(
    { investorId: investorId ?? "" },
    { enabled: !!investorId }
  );
  const utils = trpc.useUtils();
  const refresh = () => utils.investor.adminGetInvestorDetail.invalidate({ investorId: investorId ?? "" });

  const updateStatusMutation = trpc.investor.adminUpdateInvestor.useMutation();

  const handleStatusChange = (status: "active" | "pending" | "suspended" | "closed") => {
    Alert.alert("Update Status", `Set account to "${status}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", onPress: async () => {
        try {
          await updateStatusMutation.mutateAsync({ investorId: investorId ?? "", accountStatus: status, adminName: "Admin" });
          refresh();
        } catch (e: any) { Alert.alert("Error", e?.message); }
      }},
    ]);
  };

  if (detail.isLoading) {
    return <ScreenContainer edges={["left", "right"]}><View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View></ScreenContainer>;
  }

  const { investor, investments, documents, supportRequests } = detail.data ?? {};

  const tabs: { id: ActiveTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "investments", label: "Investments" },
    { id: "payments", label: "Payments" },
    { id: "documents", label: "Docs" },
  ];

  return (
    <ScreenContainer edges={["left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity onPress={() => router.back()} style={styles.back}>
          <Text style={[styles.backText, { color: colors.primary }]}>← Investors</Text>
        </TouchableOpacity>

        {investor && (
          <View style={[styles.profileCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.profileName, { color: colors.foreground }]}>
              {investor.firstName} {investor.lastName}
            </Text>
            <Text style={[styles.profileEmail, { color: colors.muted }]}>{investor.email}</Text>
            {investor.phone ? <Text style={[styles.profilePhone, { color: colors.muted }]}>{investor.phone}</Text> : null}
            <View style={styles.statusRow}>
              {(["active","pending","suspended","closed"] as const).map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[styles.statusBtn, investor.accountStatus === s && { backgroundColor: colors.primary }]}
                  onPress={() => handleStatusChange(s)}
                >
                  <Text style={[styles.statusBtnText, { color: investor.accountStatus === s ? "#fff" : colors.muted }]}>{s}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Tab bar */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar}>
          {tabs.map((t) => (
            <TouchableOpacity
              key={t.id}
              style={[styles.tabBtn, activeTab === t.id && { borderBottomColor: colors.primary, borderBottomWidth: 2 }]}
              onPress={() => setActiveTab(t.id)}
            >
              <Text style={[styles.tabText, { color: activeTab === t.id ? colors.primary : colors.muted }]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Overview */}
        {activeTab === "overview" && (
          <View>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Summary</Text>
            <View style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[styles.summaryRow, { color: colors.muted }]}>
                Total Investments: <Text style={{ color: colors.foreground, fontWeight: "700" }}>{investments?.length ?? 0}</Text>
              </Text>
              <Text style={[styles.summaryRow, { color: colors.muted }]}>
                Open Support Requests: <Text style={{ color: colors.foreground, fontWeight: "700" }}>
                  {supportRequests?.filter((r: any) => r.status !== "resolved").length ?? 0}
                </Text>
              </Text>
              <Text style={[styles.summaryRow, { color: colors.muted }]}>
                Documents: <Text style={{ color: colors.foreground, fontWeight: "700" }}>{documents?.length ?? 0}</Text>
              </Text>
            </View>
          </View>
        )}

        {/* Investments */}
        {activeTab === "investments" && (
          <View>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Investments</Text>
              <TouchableOpacity style={[styles.addSmallBtn, { backgroundColor: colors.primary }]} onPress={() => setShowAddInvestment(true)}>
                <Text style={styles.addSmallBtnText}>+ Add</Text>
              </TouchableOpacity>
            </View>
            {!investments?.length ? (
              <Text style={[styles.emptyText, { color: colors.muted }]}>No investments yet.</Text>
            ) : investments.map((inv: any) => (
              <View key={inv.investmentId} style={[styles.invCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <View style={styles.invCardRow}>
                  <Text style={[styles.invAmount, { color: colors.foreground }]}>${parseFloat(inv.investmentAmount).toLocaleString()}</Text>
                  <Text style={[styles.invStatus, { color: colors.primary }]}>{inv.status}</Text>
                </View>
                <Text style={[styles.invDate, { color: colors.muted }]}>
                  {new Date(inv.investmentDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </Text>
                {inv.totalRepaymentAmount && (
                  <Text style={[styles.invRepay, { color: colors.muted }]}>
                    Total repayment: ${parseFloat(inv.totalRepaymentAmount).toLocaleString()}
                  </Text>
                )}
                <Text style={[styles.invPaid, { color: colors.success }]}>
                  Paid: ${(inv.amountPaid ?? 0).toLocaleString()} ({inv.completedCount ?? 0} payments)
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Payments */}
        {activeTab === "payments" && (
          <View>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Record Payment</Text>
            </View>
            {!investments?.length ? (
              <Text style={[styles.emptyText, { color: colors.muted }]}>Add an investment first.</Text>
            ) : (
              <>
                <Text style={[styles.label, { color: colors.muted }]}>SELECT INVESTMENT</Text>
                {investments.map((inv: any) => (
                  <TouchableOpacity
                    key={inv.investmentId}
                    style={[styles.invSelectBtn, { backgroundColor: selectedInvestmentId === inv.investmentId ? colors.primary : colors.surface, borderColor: colors.border }]}
                    onPress={() => setSelectedInvestmentId(inv.investmentId)}
                  >
                    <Text style={{ color: selectedInvestmentId === inv.investmentId ? "#fff" : colors.foreground, fontWeight: "600" }}>
                      ${parseFloat(inv.investmentAmount).toLocaleString()} · {new Date(inv.investmentDate).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                    </Text>
                  </TouchableOpacity>
                ))}
                {selectedInvestmentId && (
                  <TouchableOpacity
                    style={[styles.saveBtn, { backgroundColor: colors.primary }]}
                    onPress={() => setShowRecordPayment(true)}
                  >
                    <Text style={styles.saveBtnText}>Record Payment for Selected</Text>
                  </TouchableOpacity>
                )}
                {/* Show all payments */}
                {investments.map((inv: any) =>
                  inv.payments?.map((p: any) => (
                    <View key={p.paymentId} style={[styles.payRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                      <Text style={[styles.payAmt, { color: colors.foreground }]}>${parseFloat(p.amountDue).toLocaleString()}</Text>
                      <Text style={[styles.payDate, { color: colors.muted }]}>
                        {p.paidDate ? new Date(p.paidDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Scheduled"}
                      </Text>
                      <Text style={[styles.payStatus, { color: p.status === "completed" ? "#22C55E" : colors.warning }]}>{p.status}</Text>
                    </View>
                  ))
                )}
              </>
            )}
          </View>
        )}

        {/* Documents */}
        {activeTab === "documents" && (
          <View>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Documents</Text>
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: colors.primary }]}
              onPress={() => router.push({ pathname: "/(tabs)/admin-investor-upload-doc" as any, params: { investorId } })}
            >
              <Text style={styles.saveBtnText}>+ Upload Document</Text>
            </TouchableOpacity>
            {!documents?.length ? (
              <Text style={[styles.emptyText, { color: colors.muted }]}>No documents uploaded yet.</Text>
            ) : documents.map((doc: any) => (
              <View key={doc.documentId} style={[styles.docRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.docTitle, { color: colors.foreground }]}>{doc.documentTitle}</Text>
                <Text style={[styles.docType, { color: colors.muted }]}>{doc.documentType} · {doc.visibilityStatus}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <AddInvestmentModal
        visible={showAddInvestment}
        investorId={investorId}
        onClose={() => setShowAddInvestment(false)}
        onSaved={refresh}
      />
      <RecordPaymentModal
        visible={showRecordPayment}
        investmentId={selectedInvestmentId}
        onClose={() => setShowRecordPayment(false)}
        onSaved={refresh}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  back: { marginBottom: 16 },
  backText: { fontSize: 15, fontWeight: "600" },
  profileCard: { borderRadius: 16, borderWidth: 1, padding: 18, marginBottom: 20 },
  profileName: { fontSize: 22, fontWeight: "700", marginBottom: 4 },
  profileEmail: { fontSize: 14, marginBottom: 2 },
  profilePhone: { fontSize: 14, marginBottom: 12 },
  statusRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  statusBtn: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "#33333340" },
  statusBtnText: { fontSize: 12, fontWeight: "600", textTransform: "capitalize" },
  tabBar: { marginBottom: 20 },
  tabBtn: { paddingHorizontal: 16, paddingVertical: 10, marginRight: 4 },
  tabText: { fontSize: 14, fontWeight: "600" },
  sectionTitle: { fontSize: 18, fontWeight: "700", marginBottom: 12 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  addSmallBtn: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  addSmallBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  summaryCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 16 },
  summaryRow: { fontSize: 14, marginBottom: 6 },
  invCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  invCardRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  invAmount: { fontSize: 18, fontWeight: "700" },
  invStatus: { fontSize: 13, fontWeight: "600", textTransform: "capitalize" },
  invDate: { fontSize: 12, marginBottom: 2 },
  invRepay: { fontSize: 12, marginBottom: 2 },
  invPaid: { fontSize: 13, fontWeight: "600" },
  invSelectBtn: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8 },
  payRow: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  payAmt: { fontSize: 15, fontWeight: "700" },
  payDate: { fontSize: 12 },
  payStatus: { fontSize: 12, fontWeight: "600", textTransform: "capitalize" },
  docRow: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 8 },
  docTitle: { fontSize: 15, fontWeight: "600", marginBottom: 2 },
  docType: { fontSize: 12 },
  emptyText: { fontSize: 14, textAlign: "center", marginTop: 20 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginBottom: 6, marginTop: 12 },
  // Modal
  modalContainer: { flex: 1, paddingTop: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 0.5, borderBottomColor: "#333" },
  modalTitle: { fontSize: 20, fontWeight: "700" },
  cancelText: { fontSize: 15 },
  modalScroll: { padding: 20, paddingBottom: 40 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 4 },
  saveBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 16 },
  saveBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
