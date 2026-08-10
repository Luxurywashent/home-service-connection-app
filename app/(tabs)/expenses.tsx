import React, { useState } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Alert,
  ActivityIndicator, Modal, Image, StyleSheet, Platform,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";
import * as Haptics from "expo-haptics";

const CATEGORIES = [
  { key: "fuel", label: "Fuel", emoji: "⛽" },
  { key: "supplies", label: "Supplies", emoji: "🧴" },
  { key: "equipment", label: "Equipment", emoji: "🔧" },
  { key: "car_wash", label: "Car Wash", emoji: "🚿" },
  { key: "food", label: "Food", emoji: "🍔" },
  { key: "other", label: "Other", emoji: "📦" },
] as const;

type Category = typeof CATEGORIES[number]["key"];

const STATUS_COLORS: Record<string, string> = {
  pending: "#F59E0B",
  approved: "#22C55E",
  rejected: "#EF4444",
};

export default function ExpensesScreen() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<Category>("fuel");
  const [note, setNote] = useState("");
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [receiptBase64, setReceiptBase64] = useState<string | null>(null);
  const [receiptMime, setReceiptMime] = useState<string>("image/jpeg");
  const [submitting, setSubmitting] = useState(false);

  const myExpensesQ = trpc.finance.getMyExpenses.useQuery(
    { employeeId: employee?.employeeId ?? "" },
    { enabled: !!employee?.employeeId, staleTime: 30_000 }
  );

  // Resolve the finance cityId from the employee's city name so expenses are linked correctly
  const citiesQ = trpc.finance.getCities.useQuery(undefined, { staleTime: 60_000 });
  const resolvedCityId = (() => {
    const empCity = employee?.city;
    if (!empCity || !citiesQ.data) return undefined;
    const slug = empCity.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const bySlug = (citiesQ.data as any[]).find((c: any) => c.slug === slug);
    if (bySlug) return bySlug.cityId as string;
    const byName = (citiesQ.data as any[]).find((c: any) => c.name.toLowerCase() === empCity.toLowerCase());
    return byName?.cityId as string | undefined;
  })();

  const submitMutation = trpc.finance.submitExpense.useMutation();
  const utils = trpc.useUtils();

  const pickReceipt = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission Required", "Please allow photo library access to attach receipts.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        allowsEditing: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setReceiptUri(asset.uri);
      const ext = (asset.uri.split(".").pop() || "jpeg").toLowerCase();
      const mime = ext === "png" ? "image/png" : "image/jpeg";
      setReceiptMime(mime);
      const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      setReceiptBase64(b64);
    } catch {
      Alert.alert("Error", "Could not load the image. Please try again.");
    }
  };

  const takePhoto = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission Required", "Please allow camera access to take a receipt photo.");
        return;
      }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: true });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setReceiptUri(asset.uri);
      setReceiptMime("image/jpeg");
      const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      setReceiptBase64(b64);
    } catch {
      Alert.alert("Error", "Could not take photo. Please try again.");
    }
  };

  const handleSubmit = async () => {
    if (!employee) return;
    const amountNum = parseFloat(amount);
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      Alert.alert("Invalid Amount", "Please enter a valid dollar amount.");
      return;
    }
    setSubmitting(true);
    try {
      await submitMutation.mutateAsync({
        employeeId: employee.employeeId,
        fullName: employee.fullName,
        amount: amountNum,
        category,
        note: note.trim() || undefined,
        receiptBase64: receiptBase64 ?? undefined,
        receiptMimeType: receiptMime,
        cityId: resolvedCityId,
      });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await utils.finance.getMyExpenses.invalidate();
      setShowForm(false);
      setAmount("");
      setCategory("fuel");
      setNote("");
      setReceiptUri(null);
      setReceiptBase64(null);
      Alert.alert("Submitted!", "Your expense has been submitted for review.");
    } catch {
      Alert.alert("Error", "Could not submit expense. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const expenses = myExpensesQ.data ?? [];

  return (
    <ScreenContainer edges={["left", "right"]}>
      <View style={[s.header, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <Text style={[s.headerTitle, { color: colors.foreground }]}>My Expenses</Text>
        <TouchableOpacity
          style={[s.newBtn, { backgroundColor: "#8B5CF6" }]}
          onPress={() => setShowForm(true)}
          activeOpacity={0.8}
        >
          <Text style={s.newBtnText}>+ Submit</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {myExpensesQ.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : expenses.length === 0 ? (
          <View style={s.empty}>
            <Text style={{ fontSize: 40 }}>🧾</Text>
            <Text style={[s.emptyTitle, { color: colors.foreground }]}>No Expenses Yet</Text>
            <Text style={[s.emptySubtitle, { color: colors.muted }]}>Tap "+ Submit" to submit a receipt for reimbursement.</Text>
          </View>
        ) : (
          expenses.map((exp: any) => (
            <View key={exp.expenseId} style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={s.cardRow}>
                <View style={s.cardLeft}>
                  <Text style={{ fontSize: 24 }}>
                    {CATEGORIES.find(c => c.key === exp.category)?.emoji ?? "📦"}
                  </Text>
                  <View style={{ marginLeft: 12, flex: 1 }}>
                    <Text style={[s.cardCategory, { color: colors.foreground }]}>
                      {CATEGORIES.find(c => c.key === exp.category)?.label ?? exp.category}
                    </Text>
                    <Text style={[s.cardDate, { color: colors.muted }]}>
                      {new Date(exp.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </Text>
                    {exp.note ? <Text style={[s.cardNote, { color: colors.muted }]} numberOfLines={2}>{exp.note}</Text> : null}
                  </View>
                </View>
                <View style={s.cardRight}>
                  <Text style={[s.cardAmount, { color: colors.foreground }]}>${parseFloat(exp.amount).toFixed(2)}</Text>
                  <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[exp.status] + "22" }]}>
                    <Text style={[s.statusText, { color: STATUS_COLORS[exp.status] }]}>
                      {exp.status.charAt(0).toUpperCase() + exp.status.slice(1)}
                    </Text>
                  </View>
                </View>
              </View>
              {exp.receiptUrl ? (
                <Image source={{ uri: exp.receiptUrl }} style={s.receiptThumb} resizeMode="cover" />
              ) : null}
              {exp.adminNote ? (
                <View style={[s.adminNoteBox, { backgroundColor: colors.border + "44" }]}>
                  <Text style={[s.adminNoteLabel, { color: colors.muted }]}>Admin note:</Text>
                  <Text style={[s.adminNoteText, { color: colors.foreground }]}>{exp.adminNote}</Text>
                </View>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>

      {/* Submit Expense Modal */}
      <Modal visible={showForm} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowForm(false)}>
        <View style={[s.modal, { backgroundColor: colors.background }]}>
          <View style={[s.modalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setShowForm(false)}>
              <Text style={[s.cancelBtn, { color: colors.muted }]}>Cancel</Text>
            </TouchableOpacity>
            <Text style={[s.modalTitle, { color: colors.foreground }]}>Submit Expense</Text>
            <TouchableOpacity onPress={handleSubmit} disabled={submitting}>
              {submitting ? <ActivityIndicator size="small" color="#8B5CF6" /> : (
                <Text style={[s.saveBtn, { color: "#8B5CF6" }]}>Submit</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
            {/* Amount */}
            <Text style={[s.label, { color: colors.muted }]}>AMOUNT *</Text>
            <View style={[s.amountRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[s.dollarSign, { color: colors.foreground }]}>$</Text>
              <TextInput
                style={[s.amountInput, { color: colors.foreground }]}
                placeholder="0.00"
                placeholderTextColor={colors.muted}
                keyboardType="decimal-pad"
                value={amount}
                onChangeText={setAmount}
              />
            </View>

            {/* Category */}
            <Text style={[s.label, { color: colors.muted, marginTop: 20 }]}>CATEGORY *</Text>
            <View style={s.categoryGrid}>
              {CATEGORIES.map(cat => (
                <TouchableOpacity
                  key={cat.key}
                  style={[
                    s.categoryChip,
                    { backgroundColor: colors.surface, borderColor: category === cat.key ? "#8B5CF6" : colors.border },
                    category === cat.key && { backgroundColor: "#8B5CF618" },
                  ]}
                  onPress={() => setCategory(cat.key)}
                  activeOpacity={0.75}
                >
                  <Text style={{ fontSize: 20 }}>{cat.emoji}</Text>
                  <Text style={[s.categoryLabel, { color: category === cat.key ? "#8B5CF6" : colors.foreground }]}>{cat.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Note */}
            <Text style={[s.label, { color: colors.muted, marginTop: 20 }]}>NOTE (optional)</Text>
            <TextInput
              style={[s.noteInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              placeholder="What was this expense for?"
              placeholderTextColor={colors.muted}
              multiline
              numberOfLines={3}
              value={note}
              onChangeText={setNote}
            />

            {/* Receipt */}
            <Text style={[s.label, { color: colors.muted, marginTop: 20 }]}>RECEIPT PHOTO (optional)</Text>
            {receiptUri ? (
              <View style={s.receiptPreviewBox}>
                <Image source={{ uri: receiptUri }} style={s.receiptPreview} resizeMode="contain" />
                <TouchableOpacity style={s.removeReceipt} onPress={() => { setReceiptUri(null); setReceiptBase64(null); }}>
                  <Text style={{ color: "#EF4444", fontWeight: "700" }}>✕ Remove</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={s.receiptBtns}>
                {Platform.OS !== "web" && (
                  <TouchableOpacity style={[s.receiptBtn, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={takePhoto} activeOpacity={0.8}>
                    <Text style={{ fontSize: 22 }}>📷</Text>
                    <Text style={[s.receiptBtnLabel, { color: colors.foreground }]}>Take Photo</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={[s.receiptBtn, { backgroundColor: colors.surface, borderColor: colors.border }]} onPress={pickReceipt} activeOpacity={0.8}>
                  <Text style={{ fontSize: 22 }}>🖼️</Text>
                  <Text style={[s.receiptBtnLabel, { color: colors.foreground }]}>Upload Photo</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5 },
  headerTitle: { fontSize: 20, fontWeight: "700" },
  newBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  newBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  empty: { alignItems: "center", marginTop: 80, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "700" },
  emptySubtitle: { fontSize: 14, textAlign: "center", maxWidth: 260 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  cardRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  cardLeft: { flexDirection: "row", flex: 1 },
  cardRight: { alignItems: "flex-end", gap: 6 },
  cardCategory: { fontSize: 15, fontWeight: "700" },
  cardDate: { fontSize: 12, marginTop: 2 },
  cardNote: { fontSize: 13, marginTop: 4 },
  cardAmount: { fontSize: 18, fontWeight: "700" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 11, fontWeight: "700" },
  receiptThumb: { width: "100%", height: 140, borderRadius: 10, marginTop: 10 },
  adminNoteBox: { marginTop: 10, borderRadius: 8, padding: 10 },
  adminNoteLabel: { fontSize: 11, fontWeight: "600", marginBottom: 2 },
  adminNoteText: { fontSize: 13 },
  modal: { flex: 1 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5 },
  modalTitle: { fontSize: 17, fontWeight: "700" },
  cancelBtn: { fontSize: 16 },
  saveBtn: { fontSize: 16, fontWeight: "700" },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginBottom: 8 },
  amountRow: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12 },
  dollarSign: { fontSize: 22, fontWeight: "700", marginRight: 4 },
  amountInput: { fontSize: 28, fontWeight: "700", flex: 1 },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  categoryChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, minWidth: "30%" },
  categoryLabel: { fontSize: 13, fontWeight: "600" },
  noteInput: { borderRadius: 12, borderWidth: 1, padding: 12, fontSize: 15, minHeight: 80, textAlignVertical: "top" },
  receiptPreviewBox: { alignItems: "center", gap: 10 },
  receiptPreview: { width: "100%", height: 200, borderRadius: 12 },
  removeReceipt: { paddingVertical: 6 },
  receiptBtns: { flexDirection: "row", gap: 12 },
  receiptBtn: { flex: 1, alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 12, borderWidth: 1, paddingVertical: 16 },
  receiptBtnLabel: { fontSize: 13, fontWeight: "600" },
});
