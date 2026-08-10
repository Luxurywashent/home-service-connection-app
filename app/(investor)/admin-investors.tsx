import React, { useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, ActivityIndicator,
  Alert, Modal, KeyboardAvoidingView, Platform, StyleSheet,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { router } from "expo-router";

// ─── Create Investor Modal ───────────────────────────────────────────────────
function CreateInvestorModal({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: () => void }) {
  const colors = useColors();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", password: "" });
  const [saving, setSaving] = useState(false);
  const createMutation = trpc.investor.adminCreateInvestor.useMutation();

  const handleCreate = async () => {
    if (!form.firstName || !form.lastName || !form.email || !form.password) {
      Alert.alert("Required", "First name, last name, email, and password are required.");
      return;
    }
    setSaving(true);
    try {
      await createMutation.mutateAsync({ ...form, adminName: "Admin" });
      setForm({ firstName: "", lastName: "", email: "", phone: "", password: "" });
      onCreated();
      onClose();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to create investor.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Add Investor</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={[styles.cancelText, { color: colors.muted }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
            {[
              { key: "firstName", label: "FIRST NAME", placeholder: "John" },
              { key: "lastName", label: "LAST NAME", placeholder: "Smith" },
              { key: "email", label: "EMAIL", placeholder: "john@email.com", keyboardType: "email-address" as const },
              { key: "phone", label: "PHONE (optional)", placeholder: "850-555-0100" },
              { key: "password", label: "INITIAL PASSWORD", placeholder: "Set a secure password", secure: true },
            ].map((f) => (
              <View key={f.key}>
                <Text style={[styles.label, { color: colors.muted }]}>{f.label}</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
                  placeholder={f.placeholder}
                  placeholderTextColor={colors.muted}
                  value={(form as any)[f.key]}
                  onChangeText={(v) => setForm(prev => ({ ...prev, [f.key]: v }))}
                  autoCapitalize="none"
                  keyboardType={f.keyboardType}
                  secureTextEntry={f.secure}
                />
              </View>
            ))}
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: colors.primary }, saving && { opacity: 0.7 }]}
              onPress={handleCreate}
              disabled={saving}
            >
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Create Investor Account</Text>}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Investor Card ───────────────────────────────────────────────────────────
function InvestorCard({ inv }: { inv: any }) {
  const colors = useColors();
  const statusColors: Record<string, string> = {
    active: "#22C55E", pending: "#F59E0B", suspended: "#EF4444", closed: "#6B7280",
  };
  const sc = statusColors[inv.accountStatus] ?? colors.muted;

  return (
    <TouchableOpacity
      style={[styles.invCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={() => router.push({ pathname: "/(investor)/admin-investor-detail" as any, params: { investorId: inv.investorId } })}
      activeOpacity={0.8}
    >
      <View style={styles.invCardHeader}>
        <Text style={[styles.invName, { color: colors.foreground }]}>
          {inv.firstName} {inv.lastName}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: sc + "20", borderColor: sc }]}>
          <Text style={[styles.statusText, { color: sc }]}>{inv.accountStatus}</Text>
        </View>
      </View>
      <Text style={[styles.invEmail, { color: colors.muted }]}>{inv.email}</Text>
      {inv.phone ? <Text style={[styles.invPhone, { color: colors.muted }]}>{inv.phone}</Text> : null}
      <Text style={[styles.viewDetail, { color: colors.primary }]}>Manage →</Text>
    </TouchableOpacity>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────
export default function AdminInvestorsScreen() {
  const colors = useColors();
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");

  const investors = trpc.investor.adminListInvestors.useQuery();
  const utils = trpc.useUtils();

  const filtered = (investors.data ?? []).filter((inv: any) =>
    `${inv.firstName} ${inv.lastName} ${inv.email}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <ScreenContainer edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Back to Dashboard */}
        <TouchableOpacity onPress={() => router.replace("/(investor)/admin-home" as any)} style={styles.backBtn}>
          <Text style={[styles.backText, { color: colors.primary }]}>← Dashboard</Text>
        </TouchableOpacity>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.title, { color: colors.foreground }]}>💼 Investors</Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>
              {investors.data?.length ?? 0} investor{investors.data?.length !== 1 ? "s" : ""}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: colors.primary }]}
            onPress={() => setShowCreate(true)}
          >
            <Text style={styles.addBtnText}>+ Add</Text>
          </TouchableOpacity>
        </View>

        {/* Search */}
        <TextInput
          style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
          placeholder="Search by name or email..."
          placeholderTextColor={colors.muted}
          value={search}
          onChangeText={setSearch}
        />

        {/* Quick nav */}
        <TouchableOpacity
          style={[styles.navBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => router.push("/(investor)/admin-investor-support" as any)}
        >
          <Text style={[styles.navBtnText, { color: colors.foreground }]}>🆘 Support Requests</Text>
          <Text style={[styles.navBtnArrow, { color: colors.primary }]}>→</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navBtn, { backgroundColor: colors.surface, borderColor: colors.border }]}
          onPress={() => router.push("/(investor)/admin-investor-updates" as any)}
        >
          <Text style={[styles.navBtnText, { color: colors.foreground }]}>📢 Post Investor Update</Text>
          <Text style={[styles.navBtnArrow, { color: colors.primary }]}>→</Text>
        </TouchableOpacity>

        {/* List */}
        {investors.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : !filtered.length ? (
          <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.muted }]}>
              {search ? "No investors match your search." : "No investors yet. Add the first one."}
            </Text>
          </View>
        ) : (
          filtered.map((inv: any) => <InvestorCard key={inv.investorId} inv={inv} />)
        )}
      </ScrollView>

      <CreateInvestorModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => utils.investor.adminListInvestors.invalidate()}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 20, paddingBottom: 40 },
  backBtn: { marginBottom: 12, alignSelf: "flex-start" },
  backText: { fontSize: 15, fontWeight: "600" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 2 },
  addBtn: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  search: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, marginBottom: 16 },
  navBtn: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  navBtnText: { fontSize: 15, fontWeight: "600" },
  navBtnArrow: { fontSize: 16, fontWeight: "700" },
  invCard: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 12 },
  invCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  invName: { fontSize: 17, fontWeight: "700" },
  statusBadge: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: "700", textTransform: "capitalize" },
  invEmail: { fontSize: 13, marginBottom: 2 },
  invPhone: { fontSize: 13, marginBottom: 6 },
  viewDetail: { fontSize: 13, fontWeight: "600" },
  empty: { borderRadius: 12, borderWidth: 1, padding: 24, alignItems: "center" },
  emptyText: { fontSize: 14 },
  // Modal
  modalContainer: { flex: 1, paddingTop: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 0.5, borderBottomColor: "#333" },
  modalTitle: { fontSize: 20, fontWeight: "700" },
  cancelText: { fontSize: 15 },
  modalScroll: { padding: 20, paddingBottom: 40 },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, marginBottom: 6, marginTop: 12 },
  input: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  saveBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 24 },
  saveBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
