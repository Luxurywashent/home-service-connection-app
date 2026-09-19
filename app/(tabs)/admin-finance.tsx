import { useState, useMemo, useCallback, useEffect } from "react";
import React from "react";
import { CompanyFinancePanel } from "@/components/company-finance-panel";
import { CompanyFinancialGate } from "@/components/company-financial-gate";
import { TTPSettingsPanel } from "@/components/ttp-settings-panel";
import { useEmployeeAuth as useAuth } from "@/lib/auth-context";
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, Modal,
  Alert, ActivityIndicator, Image, Platform, Pressable, FlatList,
} from "react-native";
import Svg, { Rect, Circle, Text as SvgText, G, Path } from "react-native-svg";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { useLocation } from "@/lib/location-context";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as DocumentPicker from "expo-document-picker";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
}
// Use local date (not UTC) to avoid timezone-off-by-one issues in CDT/CST
function localDateStr(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function today() {
  return localDateStr();
}
function monthRange(offset = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  const y = d.getFullYear(), m = d.getMonth();
  const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const last = new Date(y, m + 1, 0).getDate();
  const to = `${y}-${String(m + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { from, to };
}
function weekRange() {
  const d = new Date();
  const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  // Start of week = Sunday (day 0) — use local dates to avoid UTC offset
  const sun = new Date(d); sun.setDate(d.getDate() - day);
  const sat = new Date(sun); sat.setDate(sun.getDate() + 6);
  return { from: localDateStr(sun), to: localDateStr(sat) };
}
function dayRange() {
  const t = today();
  return { from: t, to: t };
}
function relativeDate(dateStr: string) {
  // Parse YYYY-MM-DD as local date (not UTC) to avoid off-by-one on date display
  const [y, mo, da] = dateStr.split("-").map(Number);
  const d = new Date(y, mo - 1, da);
  const todayLocal = new Date(); todayLocal.setHours(0, 0, 0, 0);
  const diff = Math.round((todayLocal.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return `${diff} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Payment method options
const PAYMENT_METHODS = ["Cash", "Credit Card", "Debit Card", "Check", "Bank Transfer", "Zelle", "Venmo", "Other"];

// Category icons mapping
const CAT_ICONS: Record<string, string> = {
  "fuel": "⛽", "gas": "⛽", "vehicle": "🚗", "supplies": "🧴", "chemicals": "🧪",
  "equipment": "🔧", "tools": "🛠️", "payroll": "👥", "wages": "👥", "salary": "👥",
  "marketing": "📢", "advertising": "📢", "insurance": "🛡️", "rent": "🏢",
  "utilities": "💡", "phone": "📱", "internet": "🌐", "software": "💻",
  "meals": "🍽️", "travel": "✈️", "office": "📋", "cleaning": "🧹",
  "service": "💼", "revenue": "💰", "income": "💰", "tips": "💵",
};
function catIcon(name: string) {
  const lower = name.toLowerCase();
  for (const [key, icon] of Object.entries(CAT_ICONS)) {
    if (lower.includes(key)) return icon;
  }
  return "📌";
}

// ─── Add / Edit Transaction Sheet ─────────────────────────────────────────────
function AddTransactionSheet({
  visible, onClose, onSaved, categories, adminId, editTx, vendors, cities, defaultCityId,
}: {
  visible: boolean; onClose: () => void; onSaved: () => void;
  categories: any[]; adminId: string; editTx?: any; vendors?: any[];
  cities?: any[]; defaultCityId?: string | null;
}) {
  const [type, setType] = useState<"income" | "expense">(editTx?.type ?? "expense");
  const [amount, setAmount] = useState(editTx?.amount ?? "");
  const [paymentMethod, setPaymentMethod] = useState(editTx?.paymentMethod ?? "");
  const [payee, setPayee] = useState(editTx?.payee ?? "");
  const [categoryId, setCategoryId] = useState(editTx?.categoryId ?? "");
  const [date, setDate] = useState(editTx?.date ?? today());
  const [location, setLocation] = useState(editTx?.location ?? "");
  const [cityId, setCityId] = useState<string | null>(editTx?.cityId ?? defaultCityId ?? null);
  const [showCityPickerInner, setShowCityPickerInner] = useState(false);
  const [notes, setNotes] = useState(editTx?.notes ?? "");
  const [receiptUri, setReceiptUri] = useState<string | null>(editTx?.receiptUrl ?? null);
  const [receiptBase64, setReceiptBase64] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [catSearch, setCatSearch] = useState("");
  const [showCatPicker, setShowCatPicker] = useState(false);
  const [showPaymentPicker, setShowPaymentPicker] = useState(false);
  const [showVendorPicker, setShowVendorPicker] = useState(false);
  const [vendorSearch, setVendorSearch] = useState("");
  const [isCreatingVendor, setIsCreatingVendor] = useState(false);
  const filteredVendors = (vendors ?? []).filter((v) => vendorSearch === "" || v.name.toLowerCase().includes(vendorSearch.toLowerCase()));
  const createVendorMut = trpc.finance.createVendor.useMutation();
  const utils = trpc.useUtils();

  const filteredCats = categories.filter(
    (c) => c.type === type && (catSearch === "" || c.name.toLowerCase().includes(catSearch.toLowerCase()))
  );
  const selectedCat = categories.find((c) => c.categoryId === categoryId);

  const uploadReceiptMut = trpc.finance.uploadReceipt.useMutation();
  const createTx = trpc.finance.createTransaction.useMutation();

  const handleAddNewVendor = async () => {
    const name = vendorSearch.trim();
    if (!name) return;
    setIsCreatingVendor(true);
    try {
      await createVendorMut.mutateAsync({ name });
      await utils.finance.getVendors.invalidate();
      setPayee(name);
      setShowVendorPicker(false);
      setVendorSearch("");
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "Could not create vendor.");
    } finally {
      setIsCreatingVendor(false);
    }
  };

  const reset = () => {
    setType("expense"); setAmount(""); setPaymentMethod(""); setPayee("");
    setCategoryId(""); setDate(today()); setLocation(""); setNotes("");
    setCityId(defaultCityId ?? null);
    setReceiptUri(null); setReceiptBase64(null); setCatSearch("");
  };

  const pickReceipt = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7, base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      setReceiptUri(result.assets[0].uri);
      setReceiptBase64(result.assets[0].base64 ?? null);
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert("Camera permission required"); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true });
    if (!result.canceled && result.assets[0]) {
      setReceiptUri(result.assets[0].uri);
      setReceiptBase64(result.assets[0].base64 ?? null);
    }
  };

  const handleSave = async () => {
    if (!amount || isNaN(parseFloat(amount))) {
      Alert.alert("Required", "Please enter a valid amount."); return;
    }
    if (!categoryId) {
      Alert.alert("Required", "Please select a category."); return;
    }
    if (!cityId) {
      Alert.alert("Required", "Please select a location."); return;
    }
    setUploading(true);
    try {
      let receiptUrl: string | undefined;
      if (receiptBase64) {
        const res = await uploadReceiptMut.mutateAsync({
          base64: receiptBase64, mimeType: "image/jpeg", performedBy: adminId,
        });
        receiptUrl = typeof res === "string" ? res : (res as any).url;
      } else if (receiptUri && receiptUri.startsWith("http")) {
        receiptUrl = receiptUri;
      }
      await createTx.mutateAsync({
        type, categoryId, categoryName: selectedCat?.name ?? "",
        amount, date, location,
        cityId: cityId ?? undefined,
        notes: [payee ? `Payee: ${payee}` : "", paymentMethod ? `Payment: ${paymentMethod}` : "", notes].filter(Boolean).join(" | ") || undefined,
        receiptUrl, performedBy: adminId,
      });
      onSaved();
      onClose();
      reset();
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "Failed to save");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { onClose(); reset(); }}>
      <View style={{ flex: 1, backgroundColor: "#151718" }}>
        {/* Header */}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5, borderBottomColor: "#334155" }}>
          <TouchableOpacity onPress={() => { onClose(); reset(); }}>
            <Text style={{ color: "#9BA1A6", fontSize: 16 }}>Cancel</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: "700", color: "#ECEDEE" }}>New Transaction</Text>
          <TouchableOpacity onPress={handleSave} disabled={uploading}>
            {uploading
              ? <ActivityIndicator color="#0a7ea4" size="small" />
              : <Text style={{ color: "#0a7ea4", fontSize: 16, fontWeight: "700" }}>Save</Text>
            }
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
          {/* Income / Expense toggle */}
          <View style={{ flexDirection: "row", margin: 16, backgroundColor: "#1e2022", borderRadius: 12, padding: 4 }}>
            {(["expense", "income"] as const).map((t) => (
              <TouchableOpacity key={t} onPress={() => { setType(t); setCategoryId(""); }}
                style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: type === t ? (t === "expense" ? "#EF4444" : "#22C55E") : "transparent", alignItems: "center" }}>
                <Text style={{ color: type === t ? "#fff" : "#9BA1A6", fontWeight: "700", fontSize: 14, textTransform: "capitalize" }}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Amount — hero field */}
          <View style={{ alignItems: "center", paddingVertical: 24, paddingHorizontal: 20, borderBottomWidth: 0.5, borderBottomColor: "#1e2022" }}>
            <Text style={{ color: "#9BA1A6", fontSize: 13, marginBottom: 8 }}>AMOUNT</Text>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ fontSize: 36, fontWeight: "300", color: "#687076", marginRight: 4 }}>$</Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor="#334155"
                style={{ fontSize: 48, fontWeight: "700", color: type === "expense" ? "#EF4444" : "#22C55E", minWidth: 120, textAlign: "center" }}
                returnKeyType="done"
              />
            </View>
          </View>

          {/* Form rows — QuickBooks-style list */}
          <View style={{ marginTop: 8 }}>
            {/* How did you pay */}
            <TouchableOpacity onPress={() => setShowPaymentPicker(true)}
              style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5, borderBottomColor: "#1e2022" }}>
              <Text style={{ color: "#9BA1A6", fontSize: 15 }}>How did you pay?</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={{ color: paymentMethod ? "#ECEDEE" : "#334155", fontSize: 15 }}>{paymentMethod || "Select"}</Text>
                <Text style={{ color: "#334155", fontSize: 16 }}>›</Text>
              </View>
            </TouchableOpacity>

            {/* Who you paid / received from */}
            {(vendors ?? []).length > 0 ? (
              <TouchableOpacity onPress={() => setShowVendorPicker(true)}
                style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5, borderBottomColor: "#1e2022" }}>
                <Text style={{ color: "#9BA1A6", fontSize: 15, minWidth: 120 }}>{type === "expense" ? "Who you paid" : "Received from"}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ color: payee ? "#ECEDEE" : "#334155", fontSize: 15 }}>{payee || "Select vendor"}</Text>
                  <Text style={{ color: "#334155", fontSize: 16 }}>›</Text>
                </View>
              </TouchableOpacity>
            ) : (
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: "#1e2022" }}>
                <Text style={{ color: "#9BA1A6", fontSize: 15, minWidth: 120 }}>{type === "expense" ? "Who you paid" : "Received from"}</Text>
                <TextInput value={payee} onChangeText={setPayee} placeholder="Enter name or vendor" placeholderTextColor="#334155"
                  style={{ flex: 1, color: "#ECEDEE", fontSize: 15, textAlign: "right", paddingVertical: 12 }} returnKeyType="done" />
              </View>
            )}

            {/* Vendor Picker Modal */}
            <Modal visible={showVendorPicker} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowVendorPicker(false)}>
              <View style={{ flex: 1, backgroundColor: "#151718" }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 0.5, borderBottomColor: "#334155" }}>
                  <Text style={{ fontSize: 17, fontWeight: "700", color: "#ECEDEE" }}>Select Vendor</Text>
                  <TouchableOpacity onPress={() => setShowVendorPicker(false)}><Text style={{ color: "#0a7ea4", fontSize: 16 }}>Done</Text></TouchableOpacity>
                </View>
                <View style={{ padding: 12 }}>
                  <TextInput value={vendorSearch} onChangeText={setVendorSearch} placeholder="Search vendors..." placeholderTextColor="#687076"
                    style={{ backgroundColor: "#1e2022", color: "#ECEDEE", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#334155", fontSize: 15 }} />
                </View>
                <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
                  data={filteredVendors}
                  keyExtractor={(v) => v.vendorId}
                  ListHeaderComponent={
                    vendorSearch.trim().length > 0 && filteredVendors.length > 0 ? (
                      <TouchableOpacity
                        onPress={handleAddNewVendor}
                        disabled={isCreatingVendor}
                        style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: "#1e2022", backgroundColor: "#0a7ea410" }}
                      >
                        {isCreatingVendor
                          ? <ActivityIndicator size="small" color="#0a7ea4" />
                          : <Text style={{ color: "#0a7ea4", fontSize: 22, fontWeight: "700", width: 28, textAlign: "center" }}>+</Text>
                        }
                        <Text style={{ color: "#0a7ea4", fontSize: 15, fontWeight: "600" }}>Add "{vendorSearch.trim()}" as new vendor</Text>
                      </TouchableOpacity>
                    ) : null
                  }
                  renderItem={({ item: v }) => (
                    <TouchableOpacity onPress={() => { setPayee(v.name); setShowVendorPicker(false); setVendorSearch(""); }}
                      style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5, borderBottomColor: "#1e2022" }}>
                      <View>
                        <Text style={{ color: "#ECEDEE", fontSize: 15, fontWeight: "600" }}>{v.name}</Text>
                        {v.category ? <Text style={{ color: "#687076", fontSize: 12, marginTop: 2 }}>{v.category}</Text> : null}
                      </View>
                      {payee === v.name && <Text style={{ color: "#0a7ea4", fontSize: 18 }}>✓</Text>}
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={
                    <View style={{ alignItems: "center", paddingVertical: 20, paddingHorizontal: 16 }}>
                      <Text style={{ color: "#9BA1A6", marginBottom: 16, textAlign: "center" }}>No vendors found</Text>
                      {vendorSearch.trim().length > 0 && (
                        <TouchableOpacity
                          onPress={handleAddNewVendor}
                          disabled={isCreatingVendor}
                          style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#0a7ea420", borderWidth: 1, borderColor: "#0a7ea4", borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12 }}
                        >
                          {isCreatingVendor
                            ? <ActivityIndicator size="small" color="#0a7ea4" />
                            : <Text style={{ color: "#0a7ea4", fontSize: 20, fontWeight: "700" }}>+</Text>
                          }
                          <Text style={{ color: "#0a7ea4", fontSize: 15, fontWeight: "600" }}>Add "{vendorSearch.trim()}" as new vendor</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  }
                />
                <TouchableOpacity onPress={() => { setPayee(""); setShowVendorPicker(false); setVendorSearch(""); }}
                  style={{ margin: 16, padding: 14, backgroundColor: "#1e2022", borderRadius: 12, alignItems: "center" }}>
                  <Text style={{ color: "#9BA1A6", fontSize: 15 }}>Clear selection</Text>
                </TouchableOpacity>
              </View>
            </Modal>

            {/* Category */}
            <TouchableOpacity onPress={() => setShowCatPicker(true)}
              style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5, borderBottomColor: "#1e2022" }}>
              <Text style={{ color: "#9BA1A6", fontSize: 15 }}>Type of {type}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                {selectedCat && <Text style={{ fontSize: 16 }}>{catIcon(selectedCat.name)}</Text>}
                <Text style={{ color: selectedCat ? "#ECEDEE" : "#334155", fontSize: 15 }}>{selectedCat?.name ?? "Select category"}</Text>
                <Text style={{ color: "#334155", fontSize: 16 }}>›</Text>
              </View>
            </TouchableOpacity>

            {/* Location */}
            {(cities ?? []).length > 0 && (
              <TouchableOpacity onPress={() => setShowCityPickerInner(true)}
                style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: "#1e2022" }}>
                <Text style={{ color: "#9BA1A6", fontSize: 15, minWidth: 80 }}>Location <Text style={{ color: "#EF4444" }}>*</Text></Text>
                <Text style={{ color: cityId ? "#0a7ea4" : "#EF4444", fontSize: 15 }}>
                  {cityId ? ((cities ?? []).find((c: any) => c.cityId === cityId)?.name ?? "Select location") : "Select location"} ›
                </Text>
              </TouchableOpacity>
            )}
            {/* Location picker inner modal */}
            <Modal visible={showCityPickerInner} transparent animationType="fade" onRequestClose={() => setShowCityPickerInner(false)}>
              <Pressable style={{ flex: 1, backgroundColor: "#00000088" }} onPress={() => setShowCityPickerInner(false)}>
                <View style={{ margin: 24, marginTop: 160, backgroundColor: "#1e2022", borderRadius: 20, overflow: "hidden" }} onStartShouldSetResponder={() => true}>
                  <View style={{ padding: 16, borderBottomWidth: 0.5, borderBottomColor: "#334155" }}>
                    <Text style={{ color: "#ECEDEE", fontSize: 17, fontWeight: "700" }}>Select Location</Text>
                  </View>
                  <TouchableOpacity onPress={() => { setCityId(null); setShowCityPickerInner(false); }}
                    style={{ padding: 16, borderBottomWidth: 0.5, borderBottomColor: "#334155", backgroundColor: !cityId ? "#0a7ea415" : "transparent" }}>
                    <Text style={{ color: !cityId ? "#0a7ea4" : "#9BA1A6", fontSize: 15 }}>None (no location)</Text>
                  </TouchableOpacity>
                  {(cities ?? []).map((c: any) => (
                    <TouchableOpacity key={c.cityId} onPress={() => { setCityId(c.cityId); setShowCityPickerInner(false); }}
                      style={{ padding: 16, borderBottomWidth: 0.5, borderBottomColor: "#334155", backgroundColor: cityId === c.cityId ? "#0a7ea415" : "transparent" }}>
                      <Text style={{ color: cityId === c.cityId ? "#0a7ea4" : "#ECEDEE", fontSize: 15, fontWeight: cityId === c.cityId ? "700" : "400" }}>{c.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </Pressable>
            </Modal>

            {/* Date */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: "#1e2022" }}>
              <Text style={{ color: "#9BA1A6", fontSize: 15, minWidth: 60 }}>Date</Text>
              <TextInput
                value={date}
                onChangeText={setDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#334155"
                style={{ flex: 1, color: "#ECEDEE", fontSize: 15, textAlign: "right", paddingVertical: 12 }}
                returnKeyType="done"
              />
            </View>

            {/* Description */}
            <View style={{ paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: "#1e2022" }}>
              <Text style={{ color: "#9BA1A6", fontSize: 15, marginBottom: 8 }}>Description</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Add a note..."
                placeholderTextColor="#334155"
                multiline
                numberOfLines={3}
                style={{ color: "#ECEDEE", fontSize: 15, minHeight: 60, textAlignVertical: "top" }}
              />
            </View>

            {/* Receipt */}
            <View style={{ paddingHorizontal: 20, paddingVertical: 16 }}>
              <Text style={{ color: "#9BA1A6", fontSize: 13, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
                Receipt {type === "expense" ? "(recommended)" : "(optional)"}
              </Text>
              {receiptUri && !receiptUri.startsWith("http") ? (
                <View>
                  <Image source={{ uri: receiptUri }} style={{ width: "100%", height: 200, borderRadius: 12, resizeMode: "cover", backgroundColor: "#1e2022" }} />
                  <TouchableOpacity onPress={() => { setReceiptUri(null); setReceiptBase64(null); }} style={{ marginTop: 8, alignSelf: "flex-start" }}>
                    <Text style={{ color: "#EF4444", fontSize: 14 }}>Remove receipt</Text>
                  </TouchableOpacity>
                </View>
              ) : receiptUri?.startsWith("http") ? (
                <View>
                  <Image source={{ uri: receiptUri }} style={{ width: "100%", height: 200, borderRadius: 12, resizeMode: "cover", backgroundColor: "#1e2022" }} />
                  <Text style={{ color: "#22C55E", fontSize: 13, marginTop: 6 }}>✅ Receipt already attached</Text>
                </View>
              ) : (
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <TouchableOpacity onPress={takePhoto}
                    style={{ flex: 1, backgroundColor: "#1e2022", borderRadius: 14, paddingVertical: 20, alignItems: "center", borderWidth: 1.5, borderColor: "#334155", borderStyle: "dashed", gap: 6 }}>
                    <Text style={{ fontSize: 28 }}>📷</Text>
                    <Text style={{ color: "#0a7ea4", fontSize: 14, fontWeight: "600" }}>Camera</Text>
                    <Text style={{ color: "#687076", fontSize: 11 }}>Snap receipt</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={pickReceipt}
                    style={{ flex: 1, backgroundColor: "#1e2022", borderRadius: 14, paddingVertical: 20, alignItems: "center", borderWidth: 1.5, borderColor: "#334155", borderStyle: "dashed", gap: 6 }}>
                    <Text style={{ fontSize: 28 }}>🗂️</Text>
                    <Text style={{ color: "#0a7ea4", fontSize: 14, fontWeight: "600" }}>Gallery</Text>
                    <Text style={{ color: "#687076", fontSize: 11 }}>Upload file</Text>
                  </TouchableOpacity>
                </View>
              )}
              {type === "expense" && !receiptUri && (
                <View style={{ backgroundColor: "#F59E0B15", borderRadius: 10, padding: 10, marginTop: 12, borderWidth: 1, borderColor: "#F59E0B33", flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontSize: 16 }}>⚠️</Text>
                  <Text style={{ color: "#F59E0B", fontSize: 13, flex: 1 }}>No receipt — this expense will be flagged for review</Text>
                </View>
              )}
            </View>
          </View>
        </ScrollView>
      </View>

      {/* Category Picker Sheet */}
      <Modal visible={showCatPicker} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowCatPicker(false)}>
        <View style={{ flex: 1, backgroundColor: "#151718" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 0.5, borderBottomColor: "#334155" }}>
            <Text style={{ fontSize: 17, fontWeight: "700", color: "#ECEDEE" }}>Type of {type}</Text>
            <TouchableOpacity onPress={() => setShowCatPicker(false)}><Text style={{ color: "#0a7ea4", fontSize: 16 }}>Done</Text></TouchableOpacity>
          </View>
          <View style={{ padding: 12, borderBottomWidth: 0.5, borderBottomColor: "#334155" }}>
            <View style={{ backgroundColor: "#1e2022", borderRadius: 10, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, gap: 8 }}>
              <Text style={{ color: "#687076" }}>🔍</Text>
              <TextInput
                value={catSearch}
                onChangeText={setCatSearch}
                placeholder="Search categories..."
                placeholderTextColor="#687076"
                style={{ flex: 1, color: "#ECEDEE", fontSize: 15, paddingVertical: 10 }}
              />
            </View>
          </View>
          <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
            data={filteredCats}
            keyExtractor={(c) => c.categoryId}
            renderItem={({ item: c }) => (
              <TouchableOpacity onPress={() => { setCategoryId(c.categoryId); setShowCatPicker(false); setCatSearch(""); }}
                style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5, borderBottomColor: "#1e2022", backgroundColor: categoryId === c.categoryId ? "#0a7ea422" : "transparent" }}>
                <Text style={{ fontSize: 22, marginRight: 14 }}>{catIcon(c.name)}</Text>
                <Text style={{ color: "#ECEDEE", fontSize: 16, flex: 1 }}>{c.name}</Text>
                {categoryId === c.categoryId && <Text style={{ color: "#0a7ea4", fontSize: 18 }}>✓</Text>}
              </TouchableOpacity>
            )}
            ListEmptyComponent={<Text style={{ color: "#9BA1A6", textAlign: "center", paddingVertical: 32 }}>No categories found</Text>}
          />
        </View>
      </Modal>

      {/* Payment Method Picker */}
      <Modal visible={showPaymentPicker} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowPaymentPicker(false)}>
        <View style={{ flex: 1, backgroundColor: "#151718" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 0.5, borderBottomColor: "#334155" }}>
            <Text style={{ fontSize: 17, fontWeight: "700", color: "#ECEDEE" }}>How did you pay?</Text>
            <TouchableOpacity onPress={() => setShowPaymentPicker(false)}><Text style={{ color: "#0a7ea4", fontSize: 16 }}>Done</Text></TouchableOpacity>
          </View>
          {PAYMENT_METHODS.map((m) => (
            <TouchableOpacity key={m} onPress={() => { setPaymentMethod(m); setShowPaymentPicker(false); }}
              style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5, borderBottomColor: "#1e2022" }}>
              <Text style={{ color: "#ECEDEE", fontSize: 16 }}>{m}</Text>
              {paymentMethod === m && <Text style={{ color: "#0a7ea4", fontSize: 18 }}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>
      </Modal>
    </Modal>
  );
}

// ─── Transaction Row (QuickBooks style) ───────────────────────────────────────
function TxRow({ tx, onPress }: { tx: any; onPress: () => void }) {
  const isIncome = tx.type === "income";
  const missingReceipt = tx.type === "expense" && tx.hasReceipt === "no";
  // Parse payee from notes if stored there
  const payee = (() => {
    if (!tx.notes) return null;
    const match = tx.notes.match(/Payee: ([^|]+)/);
    return match ? match[1].trim() : null;
  })();
  const paymentMethod = (() => {
    if (!tx.notes) return null;
    const match = tx.notes.match(/Payment: ([^|]+)/);
    return match ? match[1].trim() : null;
  })();

  return (
    <TouchableOpacity onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: "#1e2022", backgroundColor: missingReceipt ? "#F59E0B08" : "transparent" }}>
      {/* Icon circle */}
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: isIncome ? "#22C55E22" : "#EF444422", justifyContent: "center", alignItems: "center", marginRight: 14 }}>
        <Text style={{ fontSize: 20 }}>{catIcon(tx.categoryName)}</Text>
      </View>
      {/* Info */}
      <View style={{ flex: 1 }}>
        <Text style={{ color: "#ECEDEE", fontWeight: "600", fontSize: 15 }} numberOfLines={1}>
          {payee ?? tx.categoryName}
        </Text>
        <Text style={{ color: "#9BA1A6", fontSize: 12, marginTop: 2 }}>
          {tx.categoryName}
          {paymentMethod ? ` · ${paymentMethod}` : ""}
          {tx.cityName ? ` · 📍 ${tx.cityName}` : ""}
          {" · "}{relativeDate(tx.date)}
        </Text>
        {missingReceipt && (
          <Text style={{ color: "#F59E0B", fontSize: 11, marginTop: 2 }}>⚠️ Receipt missing</Text>
        )}
      </View>
      {/* Amount */}
      <View style={{ alignItems: "flex-end" }}>
        <Text style={{ color: isIncome ? "#22C55E" : "#EF4444", fontWeight: "700", fontSize: 16 }}>
          {isIncome ? "+" : "-"}{fmt(parseFloat(tx.amount))}
        </Text>
        {tx.hasReceipt === "yes" && <Text style={{ color: "#22C55E", fontSize: 10, marginTop: 2 }}>📎</Text>}
      </View>
    </TouchableOpacity>
  );
}

// ─── Transaction Detail Sheet ─────────────────────────────────────────────────
function TxDetailSheet({ tx, onClose, onDeleted, adminId }: { tx: any; onClose: () => void; onDeleted: () => void; adminId: string }) {
  const deleteTxMut = trpc.finance.deleteTransaction.useMutation({ onSuccess: () => { onDeleted(); onClose(); } });
  const [receiptLoading, setReceiptLoading] = useState(true);
  const [receiptError, setReceiptError] = useState(false);
  const [showFullReceipt, setShowFullReceipt] = useState(false);
  const isIncome = tx.type === "income";
  const payee = (() => {
    if (!tx.notes) return null;
    const match = tx.notes.match(/Payee: ([^|]+)/);
    return match ? match[1].trim() : null;
  })();
  const paymentMethod = (() => {
    if (!tx.notes) return null;
    const match = tx.notes.match(/Payment: ([^|]+)/);
    return match ? match[1].trim() : null;
  })();
  const description = (() => {
    if (!tx.notes) return null;
    // Strip Payee: and Payment: prefixes
    return tx.notes.replace(/Payee: [^|]+ \| ?/, "").replace(/Payment: [^|]+ \| ?/, "").trim() || null;
  })();

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#151718" }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5, borderBottomColor: "#334155" }}>
          <TouchableOpacity onPress={onClose}><Text style={{ color: "#0a7ea4", fontSize: 16 }}>‹ Back</Text></TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: "700", color: "#ECEDEE" }}>Transaction</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
          {/* Hero amount */}
          <View style={{ alignItems: "center", paddingVertical: 32, borderBottomWidth: 0.5, borderBottomColor: "#1e2022" }}>
            <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: isIncome ? "#22C55E22" : "#EF444422", justifyContent: "center", alignItems: "center", marginBottom: 12 }}>
              <Text style={{ fontSize: 30 }}>{catIcon(tx.categoryName)}</Text>
            </View>
            <Text style={{ color: isIncome ? "#22C55E" : "#EF4444", fontSize: 40, fontWeight: "800" }}>
              {isIncome ? "+" : "-"}{fmt(parseFloat(tx.amount))}
            </Text>
            <Text style={{ color: "#9BA1A6", fontSize: 14, marginTop: 4 }}>{tx.categoryName}</Text>
            {tx.hasReceipt === "no" && tx.type === "expense" && (
              <View style={{ backgroundColor: "#F59E0B22", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 4, marginTop: 8 }}>
                <Text style={{ color: "#F59E0B", fontSize: 13 }}>⚠️ Receipt missing</Text>
              </View>
            )}
          </View>

          {/* Detail rows */}
          <View style={{ marginTop: 8 }}>
            {[
              payee ? { label: tx.type === "expense" ? "Paid to" : "Received from", value: payee } : null,
              paymentMethod ? { label: "Payment method", value: paymentMethod } : null,
              { label: "Date", value: (() => { const [y,mo,da] = tx.date.split("-").map(Number); return new Date(y, mo-1, da).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }); })() },
              { label: "Location", value: tx.location },
              tx.van ? { label: "Van", value: tx.van } : null,
              description ? { label: "Description", value: description } : null,
              { label: "Receipt", value: tx.hasReceipt === "yes" ? "✅ Attached" : "⚠️ Not attached" },
              { label: "Logged by", value: tx.performedBy },
            ].filter(Boolean).map((row: any) => (
              <View key={row.label} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: "#1e2022" }}>
                <Text style={{ color: "#9BA1A6", fontSize: 15 }}>{row.label}</Text>
                <Text style={{ color: "#ECEDEE", fontSize: 15, fontWeight: "500", maxWidth: "55%", textAlign: "right" }}>{row.value}</Text>
              </View>
            ))}
          </View>

          {/* Receipt image */}
          {tx.receiptUrl && (
            <View style={{ margin: 20 }}>
              <Text style={{ color: "#9BA1A6", fontSize: 12, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Receipt</Text>
              <TouchableOpacity onPress={() => setShowFullReceipt(true)} activeOpacity={0.85}>
                <View style={{ width: "100%", height: 280, borderRadius: 14, backgroundColor: "#1e2022", overflow: "hidden", justifyContent: "center", alignItems: "center" }}>
                  <Image
                    source={{ uri: tx.receiptUrl }}
                    style={{ width: "100%", height: "100%", borderRadius: 14 }}
                    resizeMode="contain"
                    onLoadStart={() => { setReceiptLoading(true); setReceiptError(false); }}
                    onLoad={() => setReceiptLoading(false)}
                    onError={() => { setReceiptLoading(false); setReceiptError(true); }}
                  />
                  {receiptLoading && !receiptError && (
                    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center", alignItems: "center" }}>
                      <ActivityIndicator color="#0a7ea4" />
                      <Text style={{ color: "#9BA1A6", fontSize: 12, marginTop: 8 }}>Loading receipt...</Text>
                    </View>
                  )}
                  {receiptError && (
                    <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center", alignItems: "center" }}>
                      <Text style={{ fontSize: 32 }}>🧾</Text>
                      <Text style={{ color: "#9BA1A6", fontSize: 13, marginTop: 8 }}>Could not load image</Text>
                      <Text style={{ color: "#0a7ea4", fontSize: 12, marginTop: 4 }}>Tap to try opening in browser</Text>
                    </View>
                  )}
                </View>
                {!receiptLoading && !receiptError && (
                  <Text style={{ color: "#0a7ea4", fontSize: 12, marginTop: 6, textAlign: "center" }}>Tap to view full size</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Full-screen receipt viewer */}
          <Modal visible={showFullReceipt} animationType="fade" presentationStyle="fullScreen" onRequestClose={() => setShowFullReceipt(false)}>
            <View style={{ flex: 1, backgroundColor: "#000" }}>
              <View style={{ flexDirection: "row", justifyContent: "flex-end", padding: 16, paddingTop: 56 }}>
                <TouchableOpacity onPress={() => setShowFullReceipt(false)} style={{ backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 }}>
                  <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>Close</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ flex: 1, justifyContent: "center", alignItems: "center" }}
                maximumZoomScale={4}
                minimumZoomScale={1}
                showsVerticalScrollIndicator={false}
                showsHorizontalScrollIndicator={false}
              >
                <Image
                  source={{ uri: tx.receiptUrl }}
                  style={{ width: "100%", height: undefined, aspectRatio: 3 / 4 }}
                  resizeMode="contain"
                />
              </ScrollView>
            </View>
          </Modal>

          {/* Delete */}
          <TouchableOpacity
            onPress={() => Alert.alert("Delete Transaction", "This cannot be undone. Are you sure?", [
              { text: "Cancel", style: "cancel" },
              { text: "Delete", style: "destructive", onPress: () => deleteTxMut.mutate({ txId: tx.txId }) },
            ])}
            style={{ marginHorizontal: 20, marginTop: 24, backgroundColor: "#EF444415", borderRadius: 14, padding: 16, alignItems: "center", borderWidth: 1, borderColor: "#EF444430" }}>
            <Text style={{ color: "#EF4444", fontWeight: "600", fontSize: 16 }}>Delete Transaction</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Dashboard Feed Card ───────────────────────────────────────────────────────
function FeedCard({ emoji, title, subtitle, value, valueColor, onPress }: {
  emoji: string; title: string; subtitle: string; value?: string; valueColor?: string; onPress?: () => void;
}) {
  return (
    <TouchableOpacity onPress={onPress} disabled={!onPress}
      style={{ backgroundColor: "#1e2022", borderRadius: 16, padding: 16, marginBottom: 12, flexDirection: "row", alignItems: "center", gap: 14 }}>
      <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: "#151718", justifyContent: "center", alignItems: "center" }}>
        <Text style={{ fontSize: 24 }}>{emoji}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: "#ECEDEE", fontWeight: "600", fontSize: 15 }}>{title}</Text>
        <Text style={{ color: "#9BA1A6", fontSize: 13, marginTop: 2 }}>{subtitle}</Text>
      </View>
      {value && <Text style={{ color: valueColor ?? "#ECEDEE", fontWeight: "700", fontSize: 16 }}>{value}</Text>}
      {onPress && <Text style={{ color: "#334155", fontSize: 18 }}>›</Text>}
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminFinanceScreen() {
  return (
    <CompanyFinancialGate
      loadingMessage="Confirming Company identity before Finance…"
      company={(token) => <CompanyFinancePanel token={token} />}
      legacy={() => <LegacyAdminFinanceScreen />}
    />
  );
}

function LegacyAdminFinanceScreen() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "transactions" | "reports" | "balance" | "vendors" | "settings" | "statements" | "reconcile" | "expenses">("dashboard");
  const [period, setPeriod] = useState<"day" | "week" | "month">("month");
  const [txFilter, setTxFilter] = useState<"all" | "income" | "expense" | "missing">("all");
  const [showAddTx, setShowAddTx] = useState(false);
  const [selectedTx, setSelectedTx] = useState<any>(null);
  const { selectedLocationId: selectedCityId, setSelectedLocationId: setSelectedCityId } = useLocation();
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showAddLocation, setShowAddLocation] = useState(false);
  const [newLocationName, setNewLocationName] = useState("");
  const colors = useColors();
  const adminId = "admin";

  const dateRange = useMemo(() => {
    if (period === "day") return dayRange();
    if (period === "week") return weekRange();
    return monthRange(0);
  }, [period]);

  const utils = trpc.useUtils();
  const categoriesQ = trpc.finance.getCategories.useQuery();
  const citiesQ = trpc.finance.getCities.useQuery();
  const summaryQ = trpc.finance.getSummary.useQuery({ dateFrom: dateRange.from, dateTo: dateRange.to, cityId: selectedCityId ?? undefined });
  const txQ = trpc.finance.getTransactions.useQuery({
    type: txFilter === "income" ? "income" : txFilter === "expense" ? "expense" : undefined,
    cityId: selectedCityId ?? undefined,
    missingReceiptOnly: txFilter === "missing" ? true : undefined,
    limit: 100,
  });
  const byLocationQ = trpc.finance.getByLocation.useQuery({ dateFrom: dateRange.from, dateTo: dateRange.to });
  const byCategoryQ = trpc.finance.getByCategory.useQuery({ dateFrom: dateRange.from, dateTo: dateRange.to, cityId: selectedCityId ?? undefined });
  const missingQ = trpc.finance.getMissingReceipts.useQuery({ cityId: selectedCityId ?? undefined });
  const balanceQ = trpc.finance.getBalanceSheet.useQuery();
  const pendingExpenseQ = trpc.finance.getPendingExpenseSummary.useQuery({ cityId: selectedCityId ?? undefined }, { staleTime: 30_000 });

  const createCityM = trpc.finance.createCity.useMutation({
    onSuccess: () => {
      utils.finance.getCities.invalidate();
      setNewLocationName("");
      setShowAddLocation(false);
    },
  });
  const deleteCityM = trpc.finance.deleteCity.useMutation({
    onSuccess: () => utils.finance.getCities.invalidate(),
  });

  const refetchAll = useCallback(() => {
    utils.finance.getTransactions.invalidate();
    utils.finance.getSummary.invalidate();
    utils.finance.getByLocation.invalidate();
    utils.finance.getByCategory.invalidate();
    utils.finance.getMissingReceipts.invalidate();
    utils.finance.getBalanceSheet.invalidate();
    utils.finance.getCities.invalidate();
    utils.finance.getPendingExpenseSummary.invalidate();
    utils.finance.getAllExpenses.invalidate();
  }, [utils]);

  const summary = summaryQ.data ?? { totalIncome: 0, totalExpenses: 0, netProfit: 0, profitMargin: 0 };
  const transactions = txQ.data ?? [];
  const categories = categoriesQ.data ?? [];
  const missing = missingQ.data ?? [];
  const cities = citiesQ.data ?? [];
  const PERIOD_LABELS = { day: "Today", week: "This Week", month: "This Month" };

  const vendorsQ = trpc.finance.getVendors.useQuery();
  const vendors = vendorsQ.data ?? [];

  const tabs = [
    { id: "dashboard", label: "Dashboard" },
    { id: "transactions", label: "Transactions" },
    { id: "reports", label: "Reports" },
    { id: "balance", label: "Balance Sheet" },
    { id: "vendors", label: "Vendors" },
    { id: "settings", label: "Settings" },
    { id: "statements", label: "Bank Statements" },
    { id: "reconcile", label: "Reconcile" },
    { id: "expenses", label: "Team Expenses" },
  ] as const;

  return (
    <ScreenContainer edges={["left", "right"]}>
      {/* Compact header row */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 }}>
        <Text style={{ fontSize: 20, fontWeight: "800", color: "#ECEDEE" }}>Finance</Text>
        <TouchableOpacity onPress={() => setShowAddTx(true)}
          style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#0a7ea4", justifyContent: "center", alignItems: "center" }}>
          <Text style={{ color: "#fff", fontSize: 24, lineHeight: 28, fontWeight: "300" }}>+</Text>
        </TouchableOpacity>
      </View>

      {/* Location selector bar */}
      <TouchableOpacity onPress={() => setShowLocationPicker(true)}
        style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#1e2022", marginHorizontal: 16, marginBottom: 8, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, gap: 8 }}>
        <Text style={{ fontSize: 14 }}>📍</Text>
        <Text style={{ flex: 1, fontSize: 14, fontWeight: selectedCityId ? "700" : "400", color: selectedCityId ? "#0a7ea4" : "#9BA1A6" }}>
          {cities.find((c: any) => c.cityId === selectedCityId)?.name ?? "All Locations"}
        </Text>
        <Text style={{ color: "#9BA1A6", fontSize: 12 }}>▼</Text>
      </TouchableOpacity>

      {/* Location Picker Modal */}
      <Modal visible={showLocationPicker} transparent animationType="fade" onRequestClose={() => setShowLocationPicker(false)}>
        <Pressable style={{ flex: 1, backgroundColor: "#00000088" }} onPress={() => setShowLocationPicker(false)}>
          <View style={{ margin: 24, marginTop: 140, backgroundColor: "#1e2022", borderRadius: 20, overflow: "hidden" }} onStartShouldSetResponder={() => true}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 0.5, borderBottomColor: "#334155" }}>
              <Text style={{ color: "#ECEDEE", fontSize: 17, fontWeight: "700" }}>Select Location</Text>
              <TouchableOpacity onPress={() => setShowLocationPicker(false)}>
                <Text style={{ color: "#9BA1A6", fontSize: 20 }}>✕</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => { setSelectedCityId(null); setShowLocationPicker(false); }}
              style={{ flexDirection: "row", alignItems: "center", padding: 16, borderBottomWidth: 0.5, borderBottomColor: "#334155", backgroundColor: !selectedCityId ? "#0a7ea415" : "transparent" }}>
              <Text style={{ flex: 1, color: !selectedCityId ? "#0a7ea4" : "#ECEDEE", fontSize: 16, fontWeight: !selectedCityId ? "700" : "400" }}>🌐 All Locations</Text>
              {!selectedCityId && <Text style={{ color: "#0a7ea4", fontSize: 18 }}>✓</Text>}
            </TouchableOpacity>
            {cities.map((city: any) => (
              <View key={city.cityId} style={{ flexDirection: "row", alignItems: "center", borderBottomWidth: 0.5, borderBottomColor: "#334155" }}>
                <TouchableOpacity onPress={() => { setSelectedCityId(city.cityId); setShowLocationPicker(false); }}
                  style={{ flex: 1, flexDirection: "row", alignItems: "center", padding: 16, backgroundColor: selectedCityId === city.cityId ? "#0a7ea415" : "transparent" }}>
                  <Text style={{ flex: 1, color: selectedCityId === city.cityId ? "#0a7ea4" : "#ECEDEE", fontSize: 16, fontWeight: selectedCityId === city.cityId ? "700" : "400" }}>📍 {city.name}</Text>
                  {selectedCityId === city.cityId && <Text style={{ color: "#0a7ea4", fontSize: 18 }}>✓</Text>}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => Alert.alert("Delete Location", `Remove "${city.name}"?`, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete", style: "destructive", onPress: () => { deleteCityM.mutate({ cityId: city.cityId }); if (selectedCityId === city.cityId) setSelectedCityId(null); } },
                ])} style={{ paddingHorizontal: 16, paddingVertical: 16 }}>
                  <Text style={{ color: "#EF4444", fontSize: 16 }}>🗑</Text>
                </TouchableOpacity>
              </View>
            ))}
            {showAddLocation ? (
              <View style={{ padding: 16, gap: 10 }}>
                <TextInput
                  value={newLocationName}
                  onChangeText={setNewLocationName}
                  placeholder="Location name (e.g. Pensacola)"
                  placeholderTextColor="#687076"
                  style={{ backgroundColor: "#151718", borderRadius: 10, padding: 12, color: "#ECEDEE", fontSize: 15, borderWidth: 1, borderColor: "#334155" }}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={() => { if (newLocationName.trim()) createCityM.mutate({ name: newLocationName.trim() }); }}
                />
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TouchableOpacity onPress={() => setShowAddLocation(false)} style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: "#334155", alignItems: "center" }}>
                    <Text style={{ color: "#9BA1A6", fontWeight: "600" }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => { if (newLocationName.trim()) createCityM.mutate({ name: newLocationName.trim() }); }} style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: "#0a7ea4", alignItems: "center" }}>
                    <Text style={{ color: "#fff", fontWeight: "700" }}>Add Location</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity onPress={() => setShowAddLocation(true)}
                style={{ flexDirection: "row", alignItems: "center", padding: 16, gap: 10 }}>
                <Text style={{ color: "#0a7ea4", fontSize: 22, fontWeight: "300", lineHeight: 26 }}>+</Text>
                <Text style={{ color: "#0a7ea4", fontSize: 15, fontWeight: "600" }}>Add New Location</Text>
              </TouchableOpacity>
            )}
          </View>
        </Pressable>
      </Modal>

      {missing.length > 0 && (
        <TouchableOpacity onPress={() => { setActiveTab("transactions"); setTxFilter("missing"); }}
          style={{ backgroundColor: "#F59E0B15", marginHorizontal: 16, borderRadius: 10, padding: 10, marginBottom: 4, borderWidth: 1, borderColor: "#F59E0B33", flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ fontSize: 14 }}>⚠️</Text>
          <Text style={{ color: "#F59E0B", fontSize: 13, flex: 1 }}>{missing.length} expense{missing.length > 1 ? "s" : ""} missing receipts</Text>
          <Text style={{ color: "#F59E0B", fontSize: 13, fontWeight: "600" }}>Review ›</Text>
        </TouchableOpacity>
      )}

      {/* Tab bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={{ borderBottomWidth: 0.5, borderBottomColor: "#1e2022", flexGrow: 0, flexShrink: 0 }}
        contentContainerStyle={{ paddingHorizontal: 16, alignItems: "center" }}>
        {tabs.map((t) => (
          <TouchableOpacity key={t.id} onPress={() => setActiveTab(t.id)}
            style={{ paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 2.5, borderBottomColor: activeTab === t.id ? "#0a7ea4" : "transparent", marginRight: 2 }}>
            <Text style={{ color: activeTab === t.id ? "#0a7ea4" : "#687076", fontWeight: activeTab === t.id ? "700" : "400", fontSize: 14 }}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Content */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }}>

        {/* ── DASHBOARD ── */}
        {activeTab === "dashboard" && (
          <View>
            {/* Period selector */}
            <View style={{ flexDirection: "row", marginHorizontal: 16, marginTop: 10, marginBottom: 10, backgroundColor: "#1e2022", borderRadius: 12, padding: 4 }}>
              {(["day", "week", "month"] as const).map((p) => (
                <TouchableOpacity key={p} onPress={() => setPeriod(p)}
                  style={{ flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: period === p ? "#0a7ea4" : "transparent", alignItems: "center" }}>
                  <Text style={{ color: period === p ? "#fff" : "#9BA1A6", fontWeight: "600", fontSize: 13 }}>{PERIOD_LABELS[p]}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {summaryQ.isLoading ? <ActivityIndicator color="#0a7ea4" style={{ marginTop: 16 }} /> : (
              <View style={{ paddingHorizontal: 16 }}>
                {/* Profitability card */}
                <View style={{ backgroundColor: summary.netProfit >= 0 ? "#22C55E18" : "#EF444418", borderRadius: 18, padding: 20, marginBottom: 12, borderWidth: 1, borderColor: summary.netProfit >= 0 ? "#22C55E33" : "#EF444433" }}>
                  <Text style={{ color: "#9BA1A6", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>Profitability · {PERIOD_LABELS[period]}</Text>
                  <Text style={{ color: summary.netProfit >= 0 ? "#22C55E" : "#EF4444", fontSize: 38, fontWeight: "800", marginTop: 6 }}>{fmt(summary.netProfit)}</Text>
                  <Text style={{ color: "#9BA1A6", fontSize: 13, marginTop: 4 }}>
                    {summary.profitMargin.toFixed(1)}% margin · {fmt(summary.totalIncome)} revenue
                  </Text>
                </View>

                {/* Invoices-style cards */}
                <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
                  <View style={{ flex: 1, backgroundColor: "#22C55E15", borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#22C55E25" }}>
                    <Text style={{ color: "#9BA1A6", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Revenue</Text>
                    <Text style={{ color: "#22C55E", fontSize: 22, fontWeight: "800", marginTop: 4 }}>{fmt(summary.totalIncome)}</Text>
                    <View style={{ height: 4, backgroundColor: "#22C55E33", borderRadius: 2, marginTop: 8 }}>
                      <View style={{ height: 4, width: summary.totalIncome > 0 ? "100%" : "0%", backgroundColor: "#22C55E", borderRadius: 2 }} />
                    </View>
                  </View>
                  <View style={{ flex: 1, backgroundColor: "#EF444415", borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#EF444425" }}>
                    <Text style={{ color: "#9BA1A6", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Expenses</Text>
                    <Text style={{ color: "#EF4444", fontSize: 22, fontWeight: "800", marginTop: 4 }}>{fmt(summary.totalExpenses)}</Text>
                    <View style={{ height: 4, backgroundColor: "#EF444433", borderRadius: 2, marginTop: 8 }}>
                      <View style={{ height: 4, width: summary.totalExpenses > 0 && summary.totalIncome > 0 ? `${Math.min((summary.totalExpenses / summary.totalIncome) * 100, 100)}%` : "0%", backgroundColor: "#EF4444", borderRadius: 2 }} />
                    </View>
                  </View>
                </View>

                {/* Business feed */}
                {(pendingExpenseQ.data?.pendingCount ?? 0) > 0 && (
                  <FeedCard emoji="🧾" title="Pending Team Expenses"
                    subtitle={`${pendingExpenseQ.data!.pendingCount} expense${pendingExpenseQ.data!.pendingCount > 1 ? "s" : ""} awaiting approval`}
                    value={fmt(pendingExpenseQ.data!.totalPending)} valueColor="#F59E0B"
                    onPress={() => setActiveTab("expenses")} />
                )}
                {missing.length > 0 && (
                  <FeedCard emoji="⚠️" title="Missing receipts" subtitle={`${missing.length} expense${missing.length > 1 ? "s" : ""} need receipts`}
                    value={fmt(missing.reduce((s: number, t: any) => s + parseFloat(t.amount), 0))} valueColor="#F59E0B"
                    onPress={() => { setActiveTab("transactions"); setTxFilter("missing"); }} />
                )}
                {(byCategoryQ.data ?? []).filter((r: any) => r.type === "expense").slice(0, 1).map((r: any) => (
                  <FeedCard key={r.categoryName} emoji="📊" title={`Top expense: ${r.categoryName}`}
                    subtitle={`${r.count} transactions this ${period}`}
                    value={fmt(parseFloat(r.total))} valueColor="#EF4444" />
                ))}
              </View>
            )}

            {/* Recent transactions */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, marginTop: 8, marginBottom: 4 }}>
              <Text style={{ color: "#9BA1A6", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: "700" }}>Recent Transactions</Text>
              <TouchableOpacity onPress={() => setActiveTab("transactions")}>
                <Text style={{ color: "#0a7ea4", fontSize: 13, fontWeight: "600" }}>See all</Text>
              </TouchableOpacity>
            </View>
            {txQ.isLoading ? <ActivityIndicator color="#0a7ea4" style={{ marginTop: 20 }} /> : (
              transactions.length === 0 ? (
                <View style={{ alignItems: "center", paddingVertical: 40 }}>
                  <Text style={{ fontSize: 40, marginBottom: 12 }}>💵</Text>
                  <Text style={{ color: "#9BA1A6", fontSize: 15, fontWeight: "600" }}>No transactions yet</Text>
                  <Text style={{ color: "#687076", fontSize: 13, marginTop: 4 }}>Tap + to add your first transaction</Text>
                </View>
              ) : (
                <View style={{ backgroundColor: "#1e2022", marginHorizontal: 16, borderRadius: 16, overflow: "hidden", marginBottom: 16 }}>
                  {transactions.slice(0, 8).map((tx: any) => (
                    <TxRow key={tx.txId} tx={tx} onPress={() => setSelectedTx(tx)} />
                  ))}
                </View>
              )
            )}
          </View>
        )}

        {/* ── TRANSACTIONS ── */}
        {activeTab === "transactions" && (
          <View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 16, marginBottom: 12 }}>
              <Text style={{ fontSize: 20, fontWeight: "700", color: "#ECEDEE" }}>Transactions</Text>
              <TouchableOpacity onPress={() => setShowAddTx(true)}
                style={{ backgroundColor: "#0a7ea4", borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 }}>
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>+ Add</Text>
              </TouchableOpacity>
            </View>

            {/* Filter chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, paddingBottom: 12 }}>
              {([
                { id: "all", label: "All" },
                { id: "income", label: "💚 Income" },
                { id: "expense", label: "🔴 Expenses" },
                { id: "missing", label: "⚠️ Missing Receipt" },
              ] as const).map((f) => (
                <TouchableOpacity key={f.id} onPress={() => setTxFilter(f.id)}
                  style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: txFilter === f.id ? "#0a7ea4" : "#1e2022", borderWidth: 1, borderColor: txFilter === f.id ? "#0a7ea4" : "#334155" }}>
                  <Text style={{ color: txFilter === f.id ? "#fff" : "#9BA1A6", fontSize: 14, fontWeight: txFilter === f.id ? "700" : "400" }}>{f.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {txQ.isLoading ? <ActivityIndicator color="#0a7ea4" style={{ marginTop: 40 }} /> : (
              transactions.length === 0 ? (
                <View style={{ alignItems: "center", paddingVertical: 60 }}>
                  <Text style={{ color: "#9BA1A6", fontSize: 15 }}>No transactions found</Text>
                </View>
              ) : (
                <View style={{ backgroundColor: "#1e2022", marginHorizontal: 16, borderRadius: 16, overflow: "hidden" }}>
                  {transactions.map((tx: any) => (
                    <TxRow key={tx.txId} tx={tx} onPress={() => setSelectedTx(tx)} />
                  ))}
                </View>
              )
            )}
          </View>
        )}

        {/* ── REPORTS ── */}
        {activeTab === "reports" && (
          <View style={{ padding: 16 }}>
            <Text style={{ fontSize: 20, fontWeight: "700", color: "#ECEDEE", marginBottom: 12 }}>Reports</Text>

            {/* Period selector */}
            <View style={{ flexDirection: "row", backgroundColor: "#1e2022", borderRadius: 12, padding: 4, marginBottom: 16 }}>
              {(["day", "week", "month"] as const).map((p) => (
                <TouchableOpacity key={p} onPress={() => setPeriod(p)}
                  style={{ flex: 1, paddingVertical: 9, borderRadius: 10, backgroundColor: period === p ? "#0a7ea4" : "transparent", alignItems: "center" }}>
                  <Text style={{ color: period === p ? "#fff" : "#9BA1A6", fontWeight: "600", fontSize: 13 }}>{PERIOD_LABELS[p]}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* ── Revenue vs Expenses Bar Chart ── */}
            <Text style={{ color: "#9BA1A6", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Revenue vs Expenses</Text>
            {summaryQ.isLoading ? <ActivityIndicator color="#0a7ea4" style={{ marginBottom: 20 }} /> : (
              <View style={{ backgroundColor: "#1e2022", borderRadius: 16, padding: 16, marginBottom: 20 }}>
                {(() => {
                  const income = summary.totalIncome;
                  const expense = summary.totalExpenses;
                  const hasData = income > 0 || expense > 0;
                  if (!hasData) {
                    // QuickBooks-style empty state with ghost bars
                    return (
                      <View>
                        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14 }}>
                          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#22C55E", marginRight: 6 }} />
                          <Text style={{ color: "#9BA1A6", fontSize: 12, marginRight: 16 }}>Revenue</Text>
                          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#EF4444", marginRight: 6 }} />
                          <Text style={{ color: "#9BA1A6", fontSize: 12 }}>Expenses</Text>
                        </View>
                        <Svg width="100%" height={90} viewBox="0 0 300 90">
                          {/* Ghost revenue bar */}
                          <Rect x={0} y={4} width={200} height={28} rx={6} fill="#22C55E" opacity={0.12} />
                          <Rect x={0} y={4} width={200} height={28} rx={6} fill="none" stroke="#22C55E" strokeWidth={1} opacity={0.3} />
                          <SvgText x={206} y={22} fill="#687076" fontSize={12}>$0.00</SvgText>
                          {/* Ghost expense bar */}
                          <Rect x={0} y={50} width={140} height={28} rx={6} fill="#EF4444" opacity={0.12} />
                          <Rect x={0} y={50} width={140} height={28} rx={6} fill="none" stroke="#EF4444" strokeWidth={1} opacity={0.3} />
                          <SvgText x={146} y={68} fill="#687076" fontSize={12}>$0.00</SvgText>
                        </Svg>
                        <View style={{ alignItems: "center", marginTop: 8 }}>
                          <Text style={{ color: "#687076", fontSize: 13 }}>Add transactions to see your chart</Text>
                        </View>
                      </View>
                    );
                  }
                  const maxVal = Math.max(income, expense, 1);
                  const chartW = 280;
                  const barH = 28;
                  const incW = (income / maxVal) * chartW;
                  const expW = (expense / maxVal) * chartW;
                  return (
                    <View>
                      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14 }}>
                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#22C55E", marginRight: 6 }} />
                        <Text style={{ color: "#9BA1A6", fontSize: 12, marginRight: 16 }}>Revenue</Text>
                        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#EF4444", marginRight: 6 }} />
                        <Text style={{ color: "#9BA1A6", fontSize: 12 }}>Expenses</Text>
                      </View>
                      <Svg width="100%" height={90} viewBox={`0 0 ${chartW + 20} 90`}>
                        <Rect x={0} y={4} width={Math.max(incW, 4)} height={barH} rx={6} fill="#22C55E" opacity={0.9} />
                        <SvgText x={Math.max(incW, 4) + 6} y={22} fill="#22C55E" fontSize={12} fontWeight="700">{fmt(income)}</SvgText>
                        <Rect x={0} y={50} width={Math.max(expW, 4)} height={barH} rx={6} fill="#EF4444" opacity={0.9} />
                        <SvgText x={Math.max(expW, 4) + 6} y={68} fill="#EF4444" fontSize={12} fontWeight="700">{fmt(expense)}</SvgText>
                      </Svg>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                        <Text style={{ color: summary.netProfit >= 0 ? "#22C55E" : "#EF4444", fontWeight: "700", fontSize: 15 }}>Net: {fmt(summary.netProfit)}</Text>
                        <Text style={{ color: "#0a7ea4", fontSize: 14 }}>{summary.profitMargin.toFixed(1)}% margin</Text>
                      </View>
                    </View>
                  );
                })()}
              </View>
            )}

            {/* ── Expense Category Donut Chart ── */}
            {!byCategoryQ.isLoading && (() => {
              const rows = (byCategoryQ.data ?? []).filter((r: any) => r.type === "expense");
              if (rows.length === 0) return null;
              const total = rows.reduce((s: number, r: any) => s + parseFloat(r.total ?? "0"), 0);
              const COLORS = ["#EF4444", "#F59E0B", "#0a7ea4", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316", "#6366F1"];
              // Build donut segments
              const cx = 80, cy = 80, r = 60, innerR = 36;
              let angle = -Math.PI / 2;
              const segments = rows.slice(0, 8).map((row: any, i: number) => {
                const pct = parseFloat(row.total) / total;
                const sweep = pct * 2 * Math.PI;
                const x1 = cx + r * Math.cos(angle);
                const y1 = cy + r * Math.sin(angle);
                const x2 = cx + r * Math.cos(angle + sweep);
                const y2 = cy + r * Math.sin(angle + sweep);
                const ix1 = cx + innerR * Math.cos(angle);
                const iy1 = cy + innerR * Math.sin(angle);
                const ix2 = cx + innerR * Math.cos(angle + sweep);
                const iy2 = cy + innerR * Math.sin(angle + sweep);
                const largeArc = sweep > Math.PI ? 1 : 0;
                const d = `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix1} ${iy1} Z`;
                const seg = { d, color: COLORS[i % COLORS.length], pct, name: row.categoryName, total: row.total };
                angle += sweep;
                return seg;
              });
              return (
                <View style={{ marginBottom: 20 }}>
                  <Text style={{ color: "#9BA1A6", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Expense Breakdown</Text>
                  <View style={{ backgroundColor: "#1e2022", borderRadius: 16, padding: 16 }}>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <Svg width={160} height={160} viewBox="0 0 160 160">
                        {segments.map((seg, i) => (
                          <Path key={i} d={seg.d} fill={seg.color} />
                        ))}
                        <SvgText x={cx} y={cy - 6} textAnchor="middle" fill="#ECEDEE" fontSize={11} fontWeight="700">Total</SvgText>
                        <SvgText x={cx} y={cy + 10} textAnchor="middle" fill="#ECEDEE" fontSize={10}>{fmt(total)}</SvgText>
                      </Svg>
                      <View style={{ flex: 1, paddingLeft: 12 }}>
                        {segments.map((seg, i) => (
                          <View key={i} style={{ flexDirection: "row", alignItems: "center", marginBottom: 7 }}>
                            <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: seg.color, marginRight: 8 }} />
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: "#ECEDEE", fontSize: 12 }} numberOfLines={1}>{seg.name}</Text>
                              <Text style={{ color: "#687076", fontSize: 10 }}>{(seg.pct * 100).toFixed(1)}%</Text>
                            </View>
                          </View>
                        ))}
                      </View>
                    </View>
                  </View>
                </View>
              );
            })()}

            {/* P&L */}
            <Text style={{ color: "#9BA1A6", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Profit & Loss Summary</Text>
            {summaryQ.isLoading ? <ActivityIndicator color="#0a7ea4" /> : (
              <View style={{ backgroundColor: "#1e2022", borderRadius: 16, overflow: "hidden", marginBottom: 20 }}>
                {[
                  { label: "Total Revenue", value: fmt(summary.totalIncome), color: "#22C55E" },
                  { label: "Total Expenses", value: fmt(summary.totalExpenses), color: "#EF4444" },
                  { label: "Net Profit", value: fmt(summary.netProfit), color: summary.netProfit >= 0 ? "#22C55E" : "#EF4444", bold: true },
                  { label: "Profit Margin", value: `${summary.profitMargin.toFixed(1)}%`, color: "#0a7ea4" },
                ].map((row, i, arr) => (
                  <View key={row.label} style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: i < arr.length - 1 ? 0.5 : 0, borderBottomColor: "#151718" }}>
                    <Text style={{ color: "#9BA1A6", fontSize: 15 }}>{row.label}</Text>
                    <Text style={{ color: row.color, fontSize: 15, fontWeight: row.bold ? "800" : "600" }}>{row.value}</Text>
                  </View>
                ))}
                {(pendingExpenseQ.data?.pendingCount ?? 0) > 0 && (
                  <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderTopWidth: 0.5, borderTopColor: "#151718", backgroundColor: "#F59E0B08" }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ color: "#F59E0B", fontSize: 15 }}>Pending Expenses</Text>
                      <View style={{ backgroundColor: "#F59E0B22", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ color: "#F59E0B", fontSize: 11, fontWeight: "700" }}>{pendingExpenseQ.data!.pendingCount} pending</Text>
                      </View>
                    </View>
                    <Text style={{ color: "#F59E0B", fontSize: 15, fontWeight: "600" }}>-{fmt(pendingExpenseQ.data!.totalPending)}</Text>
                  </View>
                )}
              </View>
            )}

            {/* By Location */}
            <Text style={{ color: "#9BA1A6", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>By Location</Text>
            {byLocationQ.isLoading ? <ActivityIndicator color="#0a7ea4" /> : (
              <View style={{ backgroundColor: "#1e2022", borderRadius: 16, overflow: "hidden", marginBottom: 4 }}>
                {(() => {
                  const rows = byLocationQ.data ?? [];
                  const locs: Record<string, { income: number; expense: number }> = {};
                  for (const r of rows) {
                    if (!locs[r.location]) locs[r.location] = { income: 0, expense: 0 };
                    if (r.type === "income") locs[r.location].income = parseFloat(r.total ?? "0");
                    else locs[r.location].expense = parseFloat(r.total ?? "0");
                  }
                  const entries = Object.entries(locs);
                  if (entries.length === 0) return <Text style={{ color: "#9BA1A6", textAlign: "center", padding: 20 }}>No data yet</Text>;
                  return entries.map(([loc, d], i) => (
                    <View key={loc} style={{ paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: i < entries.length - 1 ? 0.5 : 0, borderBottomColor: "#151718" }}>
                      <Text style={{ color: "#ECEDEE", fontWeight: "600", fontSize: 15, marginBottom: 6 }}>{loc}</Text>
                      <View style={{ flexDirection: "row", gap: 16 }}>
                        <Text style={{ color: "#22C55E", fontSize: 13 }}>↑ {fmt(d.income)}</Text>
                        <Text style={{ color: "#EF4444", fontSize: 13 }}>↓ {fmt(d.expense)}</Text>
                        <Text style={{ color: d.income - d.expense >= 0 ? "#22C55E" : "#EF4444", fontSize: 13, fontWeight: "700" }}>= {fmt(d.income - d.expense)}</Text>
                      </View>
                    </View>
                  ));
                })()}
              </View>
            )}
            {/* Pending Team Expenses by Location */}
            {(pendingExpenseQ.data?.byCity ?? []).length > 0 && (
              <View style={{ backgroundColor: "#F59E0B08", borderRadius: 16, overflow: "hidden", marginBottom: 20, borderWidth: 1, borderColor: "#F59E0B22" }}>
                <View style={{ paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: "#F59E0B22", flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ fontSize: 13 }}>🧾</Text>
                  <Text style={{ color: "#F59E0B", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>Pending Team Expenses</Text>
                  <TouchableOpacity onPress={() => setActiveTab("expenses")} style={{ marginLeft: "auto" }}>
                    <Text style={{ color: "#F59E0B", fontSize: 12, fontWeight: "600" }}>Review ›</Text>
                  </TouchableOpacity>
                </View>
                {(pendingExpenseQ.data?.byCity ?? []).map((c: any, i: number, arr: any[]) => (
                  <View key={c.cityName} style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: i < arr.length - 1 ? 0.5 : 0, borderBottomColor: "#F59E0B15", flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <View>
                      <Text style={{ color: "#ECEDEE", fontSize: 14, fontWeight: "600" }}>{c.cityName}</Text>
                      <Text style={{ color: "#9BA1A6", fontSize: 12 }}>{c.count} expense{c.count > 1 ? "s" : ""} pending</Text>
                    </View>
                    <Text style={{ color: "#F59E0B", fontSize: 15, fontWeight: "700" }}>-{fmt(c.total)}</Text>
                  </View>
                ))}
                <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 0.5, borderTopColor: "#F59E0B22", flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ color: "#9BA1A6", fontSize: 13, fontWeight: "700" }}>Total Pending</Text>
                  <Text style={{ color: "#F59E0B", fontSize: 14, fontWeight: "800" }}>-{fmt(pendingExpenseQ.data?.totalPending ?? 0)}</Text>
                </View>
              </View>
            )}

            {/* By Category */}
            <Text style={{ color: "#9BA1A6", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Expenses by Category</Text>
            {byCategoryQ.isLoading ? <ActivityIndicator color="#0a7ea4" /> : (
              <View style={{ backgroundColor: "#1e2022", borderRadius: 16, overflow: "hidden", marginBottom: 20 }}>
                {(() => {
                  const rows = (byCategoryQ.data ?? []).filter((r: any) => r.type === "expense");
                  if (rows.length === 0) return <Text style={{ color: "#9BA1A6", textAlign: "center", padding: 20 }}>No expense data yet</Text>;
                  const total = rows.reduce((s: number, r: any) => s + parseFloat(r.total ?? "0"), 0);
                  return rows.map((r: any, i: number) => {
                    const pct = total > 0 ? (parseFloat(r.total) / total) * 100 : 0;
                    return (
                      <View key={r.categoryName} style={{ paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: i < rows.length - 1 ? 0.5 : 0, borderBottomColor: "#151718" }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <Text style={{ fontSize: 18 }}>{catIcon(r.categoryName)}</Text>
                            <Text style={{ color: "#ECEDEE", fontSize: 14 }}>{r.categoryName}</Text>
                          </View>
                          <Text style={{ color: "#EF4444", fontSize: 14, fontWeight: "700" }}>{fmt(parseFloat(r.total))}</Text>
                        </View>
                        <View style={{ height: 5, backgroundColor: "#334155", borderRadius: 3 }}>
                          <View style={{ height: 5, width: `${pct}%`, backgroundColor: "#EF4444", borderRadius: 3 }} />
                        </View>
                        <Text style={{ color: "#687076", fontSize: 11, marginTop: 4 }}>{pct.toFixed(1)}% of total · {r.count} transactions</Text>
                      </View>
                    );
                  });
                })()}
              </View>
            )}

            {/* Missing receipts */}
            {missing.length > 0 && (
              <>
                <Text style={{ color: "#F59E0B", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>⚠️ Missing Receipts ({missing.length})</Text>
                <View style={{ backgroundColor: "#F59E0B10", borderRadius: 16, overflow: "hidden", marginBottom: 20, borderWidth: 1, borderColor: "#F59E0B25" }}>
                  {missing.slice(0, 6).map((tx: any, i: number) => (
                    <View key={tx.txId} style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: i < Math.min(missing.length, 6) - 1 ? 0.5 : 0, borderBottomColor: "#F59E0B20" }}>
                      <Text style={{ color: "#ECEDEE", fontSize: 14, flex: 1 }}>{tx.categoryName} · {tx.location}</Text>
                      <Text style={{ color: "#EF4444", fontSize: 14, fontWeight: "700" }}>{fmt(parseFloat(tx.amount))}</Text>
                    </View>
                  ))}
                  {missing.length > 6 && <Text style={{ color: "#9BA1A6", fontSize: 13, padding: 12, textAlign: "center" }}>+{missing.length - 6} more</Text>}
                </View>
              </>
            )}
          </View>
        )}

        {/* ── BALANCE SHEET ── */}
        {activeTab === "balance" && <BalanceSheetTab balanceQ={balanceQ} adminId={adminId} onRefresh={refetchAll} />}

        {/* ── VENDORS ── */}
        {activeTab === "vendors" && <VendorsTab vendors={vendors} adminId={adminId} onRefresh={() => vendorsQ.refetch()} />}

        {/* ── SETTINGS ── */}
        {activeTab === "settings" && <SettingsTab categories={categories} adminId={adminId} onRefresh={() => utils.finance.getCategories.invalidate()} />}

        {/* ── BANK STATEMENTS ── */}
        {activeTab === "statements" && <BankStatementsTab cityId={selectedCityId ?? undefined} adminId={adminId} />}

        {/* ── RECONCILE ── */}
        {activeTab === "reconcile" && <ReconcileTab cityId={selectedCityId ?? undefined} adminId={adminId} />}
        {/* ── TEAM EXPENSES ── */}
        {activeTab === "expenses" && <TeamExpensesTab adminId={adminId} selectedCityId={selectedCityId} cities={cities} />}
      </ScrollView>

      {/* Add Transaction Sheet */}
      <AddTransactionSheet
        visible={showAddTx} onClose={() => setShowAddTx(false)}
        onSaved={refetchAll} categories={categories} adminId={adminId} vendors={vendors}
        cities={cities} defaultCityId={selectedCityId}
      />

      {/* Transaction Detail Sheet */}
      {selectedTx && (
        <TxDetailSheet
          tx={selectedTx}
          onClose={() => setSelectedTx(null)}
          onDeleted={refetchAll}
          adminId={adminId}
        />
      )}
    </ScreenContainer>
  );
}

// ─── Balance Sheet Tab ────────────────────────────────────────────────────────
function BalanceSheetTab({ balanceQ, adminId, onRefresh }: { balanceQ: any; adminId: string; onRefresh: () => void }) {
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [showAddLiability, setShowAddLiability] = useState(false);
  const [showAddEquity, setShowAddEquity] = useState(false);

  const createAsset = trpc.finance.createAsset.useMutation({ onSuccess: onRefresh });
  const deleteAsset = trpc.finance.deleteAsset.useMutation({ onSuccess: onRefresh });
  const createLiability = trpc.finance.createLiability.useMutation({ onSuccess: onRefresh });
  const deleteLiability = trpc.finance.deleteLiability.useMutation({ onSuccess: onRefresh });
  const createEquity = trpc.finance.createEquity.useMutation({ onSuccess: onRefresh });
  const deleteEquity = trpc.finance.deleteEquity.useMutation({ onSuccess: onRefresh });

  const bs = balanceQ.data;
  if (balanceQ.isLoading) return <ActivityIndicator color="#0a7ea4" style={{ marginTop: 40 }} />;

  return (
    <View style={{ padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: "700", color: "#ECEDEE", marginBottom: 4 }}>Balance Sheet</Text>
      <Text style={{ color: "#9BA1A6", fontSize: 13, marginBottom: 16 }}>Assets = Liabilities + Equity</Text>

      {bs && !bs.isBalanced && (
        <View style={{ backgroundColor: "#EF444415", borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: "#EF444430" }}>
          <Text style={{ color: "#EF4444", fontWeight: "700", fontSize: 15 }}>⚠️ Balance Sheet Mismatch</Text>
          <Text style={{ color: "#EF4444", fontSize: 13, marginTop: 4 }}>Difference: {fmt(Math.abs(bs.difference ?? 0))}</Text>
        </View>
      )}
      {bs?.isBalanced && (
        <View style={{ backgroundColor: "#22C55E15", borderRadius: 12, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: "#22C55E30" }}>
          <Text style={{ color: "#22C55E", fontWeight: "600" }}>✅ Balance Sheet is balanced</Text>
        </View>
      )}

      <BSSection title="Assets" total={bs?.totalAssets ?? 0} color="#22C55E" onAdd={() => setShowAddAsset(true)}>
        {(bs?.assets ?? []).map((a: any) => (
          <BSRow key={a.assetId} label={a.name} sub={`${a.assetType}${a.location ? ` · ${a.location}` : ""}`} value={parseFloat(a.value)}
            onDelete={() => Alert.alert("Delete Asset", `Remove "${a.name}"?`, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => deleteAsset.mutate({ assetId: a.assetId }) }])} />
        ))}
      </BSSection>

      <BSSection title="Liabilities" total={bs?.totalLiabilities ?? 0} color="#EF4444" onAdd={() => setShowAddLiability(true)}>
        {(bs?.liabilities ?? []).map((l: any) => (
          <BSRow key={l.liabilityId} label={l.name} sub={`${l.liabilityType.replace("_", " ")}${l.dueDate ? ` · Due ${l.dueDate}` : ""}`} value={parseFloat(l.balance)}
            onDelete={() => Alert.alert("Delete Liability", `Remove "${l.name}"?`, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => deleteLiability.mutate({ liabilityId: l.liabilityId }) }])} />
        ))}
      </BSSection>

      <BSSection title="Equity" total={bs?.totalEquity ?? 0} color="#0a7ea4" onAdd={() => setShowAddEquity(true)}>
        <BSRow label="Owner Contributions" value={bs?.totalOwnerContributions ?? 0} />
        <BSRow label="Retained Earnings" sub="Revenue − Expenses" value={bs?.retainedEarnings ?? 0} />
        {(bs?.equityContributions ?? []).map((e: any) => (
          <BSRow key={e.equityId} label={e.description} sub={e.date} value={parseFloat(e.amount)}
            onDelete={() => Alert.alert("Delete Contribution", `Remove "${e.description}"?`, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => deleteEquity.mutate({ equityId: e.equityId }) }])} />
        ))}
      </BSSection>

      <QuickAddModal visible={showAddAsset} title="Add Asset" onClose={() => setShowAddAsset(false)}
        fields={[
          { key: "name", label: "Name", placeholder: "e.g. Van #1" },
          { key: "value", label: "Value ($)", placeholder: "0.00", keyboardType: "decimal-pad" },
          { key: "location", label: "Location (optional)", placeholder: "e.g. Tampa" },
          { key: "dateAdded", label: "Date Added", placeholder: today() },
        ]}
        onSave={(vals) => createAsset.mutate({ assetType: "fixed", name: vals.name, value: vals.value, location: vals.location || undefined, dateAdded: vals.dateAdded || today(), performedBy: adminId } as any)}
      />
      <QuickAddModal visible={showAddLiability} title="Add Liability" onClose={() => setShowAddLiability(false)}
        fields={[
          { key: "name", label: "Name", placeholder: "e.g. Equipment Loan" },
          { key: "balance", label: "Balance ($)", placeholder: "0.00", keyboardType: "decimal-pad" },
          { key: "monthlyPayment", label: "Monthly Payment ($)", placeholder: "0.00", keyboardType: "decimal-pad" },
          { key: "dueDate", label: "Due Date (optional)", placeholder: "YYYY-MM-DD" },
        ]}
        onSave={(vals) => createLiability.mutate({ liabilityType: "loan", name: vals.name, balance: vals.balance, monthlyPayment: vals.monthlyPayment || undefined, dueDate: vals.dueDate || undefined } as any)}
      />
      <QuickAddModal visible={showAddEquity} title="Add Owner Contribution" onClose={() => setShowAddEquity(false)}
        fields={[
          { key: "description", label: "Description", placeholder: "e.g. Initial investment" },
          { key: "amount", label: "Amount ($)", placeholder: "0.00", keyboardType: "decimal-pad" },
          { key: "date", label: "Date", placeholder: today() },
        ]}
        onSave={(vals) => createEquity.mutate({ description: vals.description, amount: vals.amount, date: vals.date || today(), performedBy: adminId })}
      />
    </View>
  );
}

function BSSection({ title, total, color, onAdd, children }: { title: string; total: number; color: string; onAdd: () => void; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 20 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: "700", color: "#9BA1A6", textTransform: "uppercase", letterSpacing: 0.6 }}>{title}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Text style={{ color, fontWeight: "800", fontSize: 16 }}>{fmt(total)}</Text>
          <TouchableOpacity onPress={onAdd} style={{ backgroundColor: "#0a7ea422", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 5, borderWidth: 1, borderColor: "#0a7ea444" }}>
            <Text style={{ color: "#0a7ea4", fontSize: 13, fontWeight: "700" }}>+ Add</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={{ backgroundColor: "#1e2022", borderRadius: 14, overflow: "hidden" }}>{children}</View>
    </View>
  );
}

function BSRow({ label, value, sub, onDelete }: { label: string; value: number; sub?: string; onDelete?: () => void }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: "#151718" }}>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text style={{ color: "#ECEDEE", fontSize: 14 }}>{label}</Text>
        {sub && <Text style={{ color: "#687076", fontSize: 12, marginTop: 2 }}>{sub}</Text>}
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Text style={{ color: "#ECEDEE", fontWeight: "700", fontSize: 15 }}>{fmt(value)}</Text>
        {onDelete && (
          <TouchableOpacity onPress={onDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ color: "#EF4444", fontSize: 18, fontWeight: "300" }}>×</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Quick Add Modal ──────────────────────────────────────────────────────────
function QuickAddModal({ visible, title, onClose, fields, onSave }: {
  visible: boolean; title: string; onClose: () => void;
  fields: { key: string; label: string; placeholder: string; keyboardType?: any }[];
  onSave: (vals: Record<string, string>) => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>({});
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#151718" }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 0.5, borderBottomColor: "#334155" }}>
          <TouchableOpacity onPress={onClose}><Text style={{ color: "#9BA1A6", fontSize: 16 }}>Cancel</Text></TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: "700", color: "#ECEDEE" }}>{title}</Text>
          <TouchableOpacity onPress={() => { onSave(vals); setVals({}); onClose(); }}>
            <Text style={{ color: "#0a7ea4", fontSize: 16, fontWeight: "700" }}>Save</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          {fields.map((f) => (
            <View key={f.key} style={{ marginBottom: 20 }}>
              <Text style={{ color: "#9BA1A6", fontSize: 12, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>{f.label}</Text>
              <TextInput value={vals[f.key] ?? ""} onChangeText={(v) => setVals((p) => ({ ...p, [f.key]: v }))}
                placeholder={f.placeholder} placeholderTextColor="#334155" keyboardType={f.keyboardType ?? "default"}
                style={{ backgroundColor: "#1e2022", color: "#ECEDEE", borderRadius: 12, padding: 14, borderWidth: 1, borderColor: "#334155", fontSize: 15 }} />
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────
function SettingsTab({ categories, adminId, onRefresh }: { categories: any[]; adminId: string; onRefresh: () => void }) {
  const [newCatName, setNewCatName] = useState("");
  const [newCatType, setNewCatType] = useState<"income" | "expense">("expense");
  const createCat = trpc.finance.createCategory.useMutation({ onSuccess: onRefresh });
  const deleteCat = trpc.finance.deleteCategory.useMutation({ onSuccess: onRefresh });

  const expenseCats = categories.filter((c) => c.type === "expense");
  const incomeCats = categories.filter((c) => c.type === "income");

  const { employee: user } = useAuth();
  const isAdmin = (user as any)?.role === "admin" || (user as any)?.role === "manager";
  return (
    <View style={{ padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: "700", color: "#ECEDEE", marginBottom: 16 }}>Settings</Text>

      {/* Tap to Pay Settings */}
      <TTPSettingsPanel isAdmin={isAdmin} />

      <Text style={{ color: "#9BA1A6", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Manage Categories</Text>
      <View style={{ backgroundColor: "#1e2022", borderRadius: 16, padding: 16, marginBottom: 20 }}>
        <View style={{ flexDirection: "row", backgroundColor: "#151718", borderRadius: 10, padding: 3, marginBottom: 14 }}>
          {(["expense", "income"] as const).map((t) => (
            <TouchableOpacity key={t} onPress={() => setNewCatType(t)}
              style={{ flex: 1, paddingVertical: 8, borderRadius: 8, backgroundColor: newCatType === t ? (t === "expense" ? "#EF4444" : "#22C55E") : "transparent", alignItems: "center" }}>
              <Text style={{ color: newCatType === t ? "#fff" : "#9BA1A6", fontWeight: "700", textTransform: "capitalize", fontSize: 14 }}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <TextInput value={newCatName} onChangeText={setNewCatName} placeholder="New category name"
            placeholderTextColor="#687076"
            style={{ flex: 1, backgroundColor: "#151718", color: "#ECEDEE", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#334155", fontSize: 15 }} />
          <TouchableOpacity onPress={() => { if (newCatName.trim()) { createCat.mutate({ type: newCatType, name: newCatName.trim() }); setNewCatName(""); } }}
            style={{ backgroundColor: "#0a7ea4", borderRadius: 10, paddingHorizontal: 18, justifyContent: "center" }}>
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={{ color: "#EF4444", fontSize: 12, fontWeight: "700", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Expense Categories</Text>
      <View style={{ backgroundColor: "#1e2022", borderRadius: 14, overflow: "hidden", marginBottom: 20 }}>
        {expenseCats.map((c, i) => (
          <View key={c.categoryId} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: i < expenseCats.length - 1 ? 0.5 : 0, borderBottomColor: "#151718" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Text style={{ fontSize: 18 }}>{catIcon(c.name)}</Text>
              <Text style={{ color: "#ECEDEE", fontSize: 15 }}>{c.name}</Text>
            </View>
            <TouchableOpacity onPress={() => Alert.alert("Delete Category", `Delete "${c.name}"?`, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => deleteCat.mutate({ categoryId: c.categoryId }) }])}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ color: "#EF4444", fontSize: 20, fontWeight: "300" }}>×</Text>
            </TouchableOpacity>
          </View>
        ))}
        {expenseCats.length === 0 && <Text style={{ color: "#9BA1A6", padding: 16, textAlign: "center" }}>No expense categories</Text>}
      </View>

      <Text style={{ color: "#22C55E", fontSize: 12, fontWeight: "700", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Income Categories</Text>
      <View style={{ backgroundColor: "#1e2022", borderRadius: 14, overflow: "hidden" }}>
        {incomeCats.map((c, i) => (
          <View key={c.categoryId} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: i < incomeCats.length - 1 ? 0.5 : 0, borderBottomColor: "#151718" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Text style={{ fontSize: 18 }}>{catIcon(c.name)}</Text>
              <Text style={{ color: "#ECEDEE", fontSize: 15 }}>{c.name}</Text>
            </View>
            <TouchableOpacity onPress={() => Alert.alert("Delete Category", `Delete "${c.name}"?`, [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: () => deleteCat.mutate({ categoryId: c.categoryId }) }])}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={{ color: "#EF4444", fontSize: 20, fontWeight: "300" }}>×</Text>
            </TouchableOpacity>
          </View>
        ))}
        {incomeCats.length === 0 && <Text style={{ color: "#9BA1A6", padding: 16, textAlign: "center" }}>No income categories</Text>}
      </View>
    </View>
  );
}

// ─── Vendors Tab ──────────────────────────────────────────────────────────────
function VendorsTab({ vendors, adminId, onRefresh }: { vendors: any[]; adminId: string; onRefresh: () => void }) {
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});
  const createVendor = trpc.finance.createVendor.useMutation({ onSuccess: () => { setShowAdd(false); onRefresh(); } });
  const updateVendor = trpc.finance.updateVendor.useMutation({ onSuccess: () => { setEditing(null); onRefresh(); } });
  const deleteVendor = trpc.finance.deleteVendor.useMutation({ onSuccess: onRefresh });

  const togglePw = (id: string) => setShowPassword((p) => ({ ...p, [id]: !p[id] }));

  return (
    <View style={{ padding: 16 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <Text style={{ fontSize: 20, fontWeight: "700", color: "#ECEDEE" }}>Vendors</Text>
        <TouchableOpacity onPress={() => setShowAdd(true)}
          style={{ backgroundColor: "#0a7ea4", borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 }}>
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>+ Add Vendor</Text>
        </TouchableOpacity>
      </View>

      {vendors.length === 0 && (
        <View style={{ backgroundColor: "#1e2022", borderRadius: 16, padding: 32, alignItems: "center" }}>
          <Text style={{ fontSize: 32, marginBottom: 8 }}>🏪</Text>
          <Text style={{ color: "#9BA1A6", fontSize: 15, textAlign: "center" }}>No vendors yet. Add your suppliers to quickly select them when logging expenses.</Text>
        </View>
      )}

      {vendors.map((v) => (
        <View key={v.vendorId} style={{ backgroundColor: "#1e2022", borderRadius: 16, padding: 16, marginBottom: 12 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: "#ECEDEE" }}>{v.name}</Text>
              {v.category ? <Text style={{ color: "#0a7ea4", fontSize: 12, marginTop: 2 }}>{v.category}</Text> : null}
            </View>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <TouchableOpacity onPress={() => setEditing(v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ color: "#0a7ea4", fontSize: 14, fontWeight: "600" }}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => Alert.alert("Delete Vendor", `Delete "${v.name}"?`, [
                { text: "Cancel", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: () => deleteVendor.mutate({ vendorId: v.vendorId }) }
              ])} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={{ color: "#EF4444", fontSize: 14, fontWeight: "600" }}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>

          {v.phone ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Text style={{ fontSize: 14 }}>📞</Text>
              <Text style={{ color: "#9BA1A6", fontSize: 14 }}>{v.phone}</Text>
            </View>
          ) : null}
          {v.email ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Text style={{ fontSize: 14 }}>✉️</Text>
              <Text style={{ color: "#9BA1A6", fontSize: 14 }}>{v.email}</Text>
            </View>
          ) : null}
          {v.website ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Text style={{ fontSize: 14 }}>🌐</Text>
              <Text style={{ color: "#9BA1A6", fontSize: 14 }}>{v.website}</Text>
            </View>
          ) : null}
          {v.loginEmail ? (
            <View style={{ backgroundColor: "#151718", borderRadius: 10, padding: 10, marginTop: 8 }}>
              <Text style={{ color: "#687076", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Login Info</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <Text style={{ color: "#9BA1A6", fontSize: 13, flex: 1 }}>📧 {v.loginEmail}</Text>
              </View>
              {v.loginPassword ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ color: "#9BA1A6", fontSize: 13, flex: 1 }}>
                    🔑 {showPassword[v.vendorId] ? v.loginPassword : "••••••••••"}
                  </Text>
                  <TouchableOpacity onPress={() => togglePw(v.vendorId)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <Text style={{ color: "#0a7ea4", fontSize: 12, fontWeight: "600" }}>{showPassword[v.vendorId] ? "Hide" : "Show"}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          ) : null}
          {v.notes ? (
            <Text style={{ color: "#687076", fontSize: 13, marginTop: 8, fontStyle: "italic" }}>{v.notes}</Text>
          ) : null}
        </View>
      ))}

      {/* Add / Edit Modal */}
      <VendorFormModal
        visible={showAdd || !!editing}
        initial={editing}
        onClose={() => { setShowAdd(false); setEditing(null); }}
        onSave={(data: any) => {
          if (editing) {
            updateVendor.mutate({ vendorId: editing.vendorId, ...data });
          } else {
            createVendor.mutate(data);
          }
        }}
        saving={createVendor.isPending || updateVendor.isPending}
      />
    </View>
  );
}

// ─── Vendor Form Modal ────────────────────────────────────────────────────────
function VendorFormModal({ visible, initial, onClose, onSave, saving }: {
  visible: boolean; initial: any; onClose: () => void;
  onSave: (data: any) => void; saving: boolean;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (initial) {
      setName(initial.name ?? "");
      setCategory(initial.category ?? "");
      setPhone(initial.phone ?? "");
      setEmail(initial.email ?? "");
      setWebsite(initial.website ?? "");
      setLoginEmail(initial.loginEmail ?? "");
      setLoginPassword(initial.loginPassword ?? "");
      setNotes(initial.notes ?? "");
    } else {
      setName(""); setCategory(""); setPhone(""); setEmail("");
      setWebsite(""); setLoginEmail(""); setLoginPassword(""); setNotes("");
    }
  }, [initial, visible]);

  const field = (label: string, value: string, onChange: (v: string) => void, opts?: { placeholder?: string; secureTextEntry?: boolean }) => (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ color: "#9BA1A6", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{label}</Text>
      <TextInput value={value} onChangeText={onChange}
        placeholder={opts?.placeholder ?? label}
        placeholderTextColor="#687076"
        secureTextEntry={opts?.secureTextEntry}
        style={{ backgroundColor: "#1e2022", color: "#ECEDEE", borderRadius: 10, padding: 12, borderWidth: 1, borderColor: "#334155", fontSize: 15 }} />
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#151718" }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 0.5, borderBottomColor: "#334155" }}>
          <Text style={{ fontSize: 18, fontWeight: "700", color: "#ECEDEE" }}>{initial ? "Edit Vendor" : "Add Vendor"}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ color: "#9BA1A6", fontSize: 16 }}>Cancel</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
          {field("Vendor Name *", name, setName, { placeholder: "e.g. Amazon, Zach Chemical Guy" })}
          {field("Category", category, setCategory, { placeholder: "e.g. Chemicals, Equipment" })}
          {field("Phone", phone, setPhone, { placeholder: "e.g. 813-647-4850" })}
          {field("Email", email, setEmail, { placeholder: "contact@vendor.com" })}
          {field("Website", website, setWebsite, { placeholder: "https://vendor.com" })}

          <Text style={{ color: "#687076", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10, marginTop: 4 }}>Login Credentials</Text>
          {field("Login Email", loginEmail, setLoginEmail, { placeholder: "login@email.com" })}
          {field("Password", loginPassword, setLoginPassword, { placeholder: "Password", secureTextEntry: false })}
          {field("Notes", notes, setNotes, { placeholder: "Any additional notes..." })}

          <TouchableOpacity
            onPress={() => { if (name.trim()) onSave({ name: name.trim(), category: category || undefined, phone: phone || undefined, email: email || undefined, website: website || undefined, loginEmail: loginEmail || undefined, loginPassword: loginPassword || undefined, notes: notes || undefined }); }}
            style={{ backgroundColor: name.trim() ? "#0a7ea4" : "#334155", borderRadius: 14, padding: 16, alignItems: "center", marginTop: 8 }}>
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>{saving ? "Saving..." : initial ? "Save Changes" : "Add Vendor"}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Bank Statements Tab ──────────────────────────────────────────────────────
function BankStatementsTab({ cityId, adminId }: { cityId?: string; adminId: string }) {
  const utils = trpc.useUtils();
  const statementsQ = trpc.finance.getStatements.useQuery({ cityId });
  const statements = statementsQ.data ?? [];
  const [uploading, setUploading] = React.useState(false);
  const [selectedStatement, setSelectedStatement] = React.useState<any>(null);
  const [importing, setImporting] = React.useState<string | null>(null);

  const uploadM = trpc.finance.uploadStatement.useMutation({
    onSuccess: () => { utils.finance.getStatements.invalidate(); setUploading(false); },
    onError: (e) => { Alert.alert("Upload Failed", e.message); setUploading(false); },
  });
  const bulkImportM = trpc.finance.bulkImportStatement.useMutation({
    onSuccess: (res: any) => {
      Alert.alert("Import Complete", `${res.imported} transactions imported to Finance.`);
      utils.finance.getTransactions.invalidate();
      utils.finance.getSummary.invalidate();
      setImporting(null);
    },
    onError: (e) => { Alert.alert("Import Failed", e.message); setImporting(null); },
  });
  const deleteM = trpc.finance.deleteStatement.useMutation({
    onSuccess: () => utils.finance.getStatements.invalidate(),
  });

  async function pickAndUpload() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "text/csv", "text/plain"],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setUploading(true);
      const base64Data = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      uploadM.mutate({
        base64Data,
        fileName: asset.name,
        mimeType: asset.mimeType ?? "application/pdf",
        cityId,
        uploadedBy: adminId,
      });
    } catch (e: any) {
      Alert.alert("Error", e.message);
      setUploading(false);
    }
  }

  if (selectedStatement) {
    return <StatementDetailView statement={selectedStatement} adminId={adminId} cityId={cityId} onBack={() => setSelectedStatement(null)} />;
  }

  return (
    <View style={{ padding: 16 }}>
      <TouchableOpacity
        onPress={pickAndUpload}
        disabled={uploading}
        style={{ backgroundColor: "#0a7ea4", borderRadius: 14, padding: 16, alignItems: "center", marginBottom: 20, flexDirection: "row", justifyContent: "center", gap: 8 }}>
        <Text style={{ fontSize: 18 }}>📄</Text>
        <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>{uploading ? "Uploading & Parsing..." : "Upload Bank Statement"}</Text>
      </TouchableOpacity>
      <Text style={{ color: "#687076", fontSize: 12, textAlign: "center", marginBottom: 20 }}>
        Supports PDF and CSV bank statements. AI will extract and categorize all transactions automatically.
      </Text>

      {statementsQ.isLoading ? <ActivityIndicator color="#0a7ea4" /> : statements.length === 0 ? (
        <View style={{ alignItems: "center", paddingTop: 40 }}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>🏦</Text>
          <Text style={{ color: "#ECEDEE", fontSize: 16, fontWeight: "700" }}>No statements uploaded yet</Text>
          <Text style={{ color: "#687076", fontSize: 14, marginTop: 6, textAlign: "center" }}>Upload a bank statement to auto-import transactions</Text>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {statements.map((s: any) => (
            <View key={s.statementId} style={{ backgroundColor: "#1e2022", borderRadius: 14, padding: 16 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: "#ECEDEE", fontSize: 15, fontWeight: "700" }}>{s.fileName}</Text>
                  <Text style={{ color: "#687076", fontSize: 12, marginTop: 2 }}>
                    {s.txCount} transactions · {s.status === "parsed" ? "✅ Parsed" : s.status === "parsing" ? "⏳ Parsing..." : s.status === "error" ? "❌ Error" : s.status}
                  </Text>
                  {s.statementDate && <Text style={{ color: "#687076", fontSize: 12 }}>Period: {s.statementDate}</Text>}
                </View>
                <TouchableOpacity onPress={() => Alert.alert("Delete Statement", "Remove this statement and all its bank transactions?", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete", style: "destructive", onPress: () => deleteM.mutate({ statementId: s.statementId }) },
                ])}>
                  <Text style={{ fontSize: 18 }}>🗑️</Text>
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                <TouchableOpacity
                  onPress={() => setSelectedStatement(s)}
                  style={{ flex: 1, backgroundColor: "#0a7ea420", borderRadius: 10, padding: 10, alignItems: "center" }}>
                  <Text style={{ color: "#0a7ea4", fontWeight: "600", fontSize: 13 }}>View Transactions</Text>
                </TouchableOpacity>
                {s.status === "parsed" && (
                  <TouchableOpacity
                    onPress={() => {
                      setImporting(s.statementId);
                      bulkImportM.mutate({ statementId: s.statementId, cityId, performedBy: adminId });
                    }}
                    disabled={importing === s.statementId}
                    style={{ flex: 1, backgroundColor: "#22C55E20", borderRadius: 10, padding: 10, alignItems: "center" }}>
                    <Text style={{ color: "#22C55E", fontWeight: "600", fontSize: 13 }}>
                      {importing === s.statementId ? "Importing..." : "Import All to Finance"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Statement Detail View ────────────────────────────────────────────────────
function StatementDetailView({ statement, adminId, cityId, onBack }: { statement: any; adminId: string; cityId?: string; onBack: () => void }) {
  const utils = trpc.useUtils();
  const txQ = trpc.finance.getBankTransactions.useQuery({ statementId: statement.statementId });
  const bankTxs = txQ.data ?? [];
  const importM = trpc.finance.importBankTx.useMutation({
    onSuccess: () => { utils.finance.getBankTransactions.invalidate(); utils.finance.getTransactions.invalidate(); },
    onError: (e) => Alert.alert("Import Failed", e.message),
  });
  const ignoreM = trpc.finance.ignoreBankTx.useMutation({
    onSuccess: () => utils.finance.getBankTransactions.invalidate(),
  });

  const pending = bankTxs.filter((t: any) => t.status === "pending");
  const matched = bankTxs.filter((t: any) => t.status === "matched");
  const ignored = bankTxs.filter((t: any) => t.status === "ignored");

  return (
    <View style={{ padding: 16 }}>
      <TouchableOpacity onPress={onBack} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 16 }}>
        <Text style={{ color: "#0a7ea4", fontSize: 15 }}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={{ color: "#ECEDEE", fontSize: 17, fontWeight: "800", marginBottom: 4 }}>{statement.fileName}</Text>
      <Text style={{ color: "#687076", fontSize: 13, marginBottom: 16 }}>
        {pending.length} pending · {matched.length} imported · {ignored.length} ignored
      </Text>

      {txQ.isLoading ? <ActivityIndicator color="#0a7ea4" /> : (
        <View style={{ gap: 8 }}>
          {bankTxs.map((t: any) => (
            <View key={t.bankTxId} style={{
              backgroundColor: t.status === "matched" ? "#22C55E10" : t.status === "ignored" ? "#33415510" : "#1e2022",
              borderRadius: 12, padding: 14,
              borderWidth: 1,
              borderColor: t.status === "matched" ? "#22C55E30" : t.status === "ignored" ? "#33415530" : "#2d3748",
            }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={{ color: "#ECEDEE", fontSize: 14, fontWeight: "600" }}>{t.description}</Text>
                  <Text style={{ color: "#687076", fontSize: 12, marginTop: 2 }}>{t.date} · {t.category ?? "Uncategorized"}</Text>
                </View>
                <Text style={{ color: t.type === "credit" ? "#22C55E" : "#EF4444", fontSize: 16, fontWeight: "700" }}>
                  {t.type === "credit" ? "+" : "-"}{fmt(Math.abs(parseFloat(t.amount)))}
                </Text>
              </View>
              {t.status === "pending" && (
                <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                  <TouchableOpacity
                    onPress={() => importM.mutate({ bankTxId: t.bankTxId, cityId, performedBy: adminId })}
                    style={{ flex: 1, backgroundColor: "#0a7ea420", borderRadius: 8, padding: 8, alignItems: "center" }}>
                    <Text style={{ color: "#0a7ea4", fontWeight: "600", fontSize: 12 }}>Add to Finance</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => ignoreM.mutate({ bankTxId: t.bankTxId })}
                    style={{ flex: 1, backgroundColor: "#33415520", borderRadius: 8, padding: 8, alignItems: "center" }}>
                    <Text style={{ color: "#687076", fontWeight: "600", fontSize: 12 }}>Ignore</Text>
                  </TouchableOpacity>
                </View>
              )}
              {t.status === "matched" && (
                <Text style={{ color: "#22C55E", fontSize: 12, marginTop: 6 }}>✅ Imported to Finance</Text>
              )}
              {t.status === "ignored" && (
                <Text style={{ color: "#687076", fontSize: 12, marginTop: 6 }}>— Ignored</Text>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Reconcile Tab ────────────────────────────────────────────────────────────
function ReconcileTab({ cityId, adminId }: { cityId?: string; adminId: string }) {
  const utils = trpc.useUtils();
  const statementsQ = trpc.finance.getStatements.useQuery({ cityId });
  const statements = statementsQ.data ?? [];
  const [selectedStatementId, setSelectedStatementId] = React.useState<string | null>(null);

  const bankTxQ = trpc.finance.getBankTransactions.useQuery(
    { statementId: selectedStatementId! },
    { enabled: !!selectedStatementId }
  );
  const financeTxQ = trpc.finance.getTransactions.useQuery(
    { cityId, limit: 200 },
    { enabled: !!selectedStatementId }
  );

  const bankTxs = bankTxQ.data ?? [];
  const financeTxs = financeTxQ.data ?? [];

  const matchM = trpc.finance.matchBankTx.useMutation({
    onSuccess: () => { utils.finance.getBankTransactions.invalidate(); },
    onError: (e) => Alert.alert("Match Failed", e.message),
  });
  const unmatchM = trpc.finance.unmatchBankTx.useMutation({
    onSuccess: () => utils.finance.getBankTransactions.invalidate(),
  });

  const [matchingBankTxId, setMatchingBankTxId] = React.useState<string | null>(null);

  // Summary stats
  const clearedAmount = bankTxs
    .filter((t: any) => t.status === "matched")
    .reduce((sum: number, t: any) => sum + (t.type === "credit" ? parseFloat(t.amount) : -parseFloat(t.amount)), 0);
  const unclearedAmount = bankTxs
    .filter((t: any) => t.status === "pending")
    .reduce((sum: number, t: any) => sum + (t.type === "credit" ? parseFloat(t.amount) : -parseFloat(t.amount)), 0);

  if (!selectedStatementId) {
    return (
      <View style={{ padding: 16 }}>
        <Text style={{ color: "#ECEDEE", fontSize: 16, fontWeight: "700", marginBottom: 4 }}>Reconciliation</Text>
        <Text style={{ color: "#687076", fontSize: 13, marginBottom: 20 }}>
          Select a bank statement to reconcile against your Finance records.
        </Text>
        {statements.length === 0 ? (
          <View style={{ alignItems: "center", paddingTop: 40 }}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🏦</Text>
            <Text style={{ color: "#ECEDEE", fontSize: 16, fontWeight: "700" }}>No statements available</Text>
            <Text style={{ color: "#687076", fontSize: 14, marginTop: 6, textAlign: "center" }}>Upload a bank statement in the Bank Statements tab first</Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            {statements.map((s: any) => (
              <TouchableOpacity key={s.statementId} onPress={() => setSelectedStatementId(s.statementId)}
                style={{ backgroundColor: "#1e2022", borderRadius: 14, padding: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View>
                  <Text style={{ color: "#ECEDEE", fontSize: 15, fontWeight: "700" }}>{s.fileName}</Text>
                  <Text style={{ color: "#687076", fontSize: 12, marginTop: 2 }}>{s.txCount} transactions</Text>
                </View>
                <Text style={{ color: "#0a7ea4", fontSize: 20 }}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    );
  }

  const selectedStatement = statements.find((s: any) => s.statementId === selectedStatementId);

  return (
    <View style={{ padding: 16 }}>
      {/* Header */}
      <TouchableOpacity onPress={() => setSelectedStatementId(null)} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 }}>
        <Text style={{ color: "#0a7ea4", fontSize: 15 }}>‹ Back</Text>
      </TouchableOpacity>
      <Text style={{ color: "#ECEDEE", fontSize: 16, fontWeight: "800", marginBottom: 4 }}>{selectedStatement?.fileName}</Text>

      {/* Summary bar */}
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
        <View style={{ flex: 1, backgroundColor: "#22C55E15", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#22C55E25" }}>
          <Text style={{ color: "#9BA1A6", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Cleared</Text>
          <Text style={{ color: "#22C55E", fontSize: 18, fontWeight: "800", marginTop: 2 }}>{fmt(clearedAmount)}</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: "#F59E0B15", borderRadius: 12, padding: 12, borderWidth: 1, borderColor: "#F59E0B25" }}>
          <Text style={{ color: "#9BA1A6", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>Uncleared</Text>
          <Text style={{ color: "#F59E0B", fontSize: 18, fontWeight: "800", marginTop: 2 }}>{fmt(Math.abs(unclearedAmount))}</Text>
        </View>
      </View>

      {/* Side-by-side columns header */}
      <View style={{ flexDirection: "row", marginBottom: 8 }}>
        <View style={{ flex: 1, marginRight: 4 }}>
          <Text style={{ color: "#687076", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>Bank Statement</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 4 }}>
          <Text style={{ color: "#687076", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>Finance Records</Text>
        </View>
      </View>

      {bankTxQ.isLoading || financeTxQ.isLoading ? <ActivityIndicator color="#0a7ea4" /> : (
        <View style={{ gap: 8 }}>
          {bankTxs.map((btx: any) => {
            const matched = financeTxs.find((f: any) => f.txId === btx.matchedTxId);
            return (
              <View key={btx.bankTxId} style={{
                flexDirection: "row",
                backgroundColor: btx.status === "matched" ? "#22C55E08" : "#1e2022",
                borderRadius: 12, padding: 10,
                borderWidth: 1,
                borderColor: btx.status === "matched" ? "#22C55E30" : "#2d3748",
                gap: 8,
              }}>
                {/* Bank side */}
                <View style={{ flex: 1, borderRightWidth: 0.5, borderRightColor: "#334155", paddingRight: 8 }}>
                  <Text style={{ color: "#ECEDEE", fontSize: 12, fontWeight: "600" }} numberOfLines={2}>{btx.description}</Text>
                  <Text style={{ color: "#687076", fontSize: 11, marginTop: 2 }}>{btx.date}</Text>
                  <Text style={{ color: btx.type === "credit" ? "#22C55E" : "#EF4444", fontSize: 13, fontWeight: "700", marginTop: 2 }}>
                    {btx.type === "credit" ? "+" : "-"}{fmt(Math.abs(parseFloat(btx.amount)))}
                  </Text>
                </View>

                {/* Finance side */}
                <View style={{ flex: 1 }}>
                  {matched ? (
                    <View>
                      <Text style={{ color: "#ECEDEE", fontSize: 12, fontWeight: "600" }} numberOfLines={2}>{matched.categoryName}</Text>
                      <Text style={{ color: "#687076", fontSize: 11, marginTop: 2 }}>{matched.date}</Text>
                      <Text style={{ color: matched.type === "income" ? "#22C55E" : "#EF4444", fontSize: 13, fontWeight: "700", marginTop: 2 }}>
                        {matched.type === "income" ? "+" : "-"}{fmt(Math.abs(parseFloat(matched.amount)))}
                      </Text>
                      <TouchableOpacity onPress={() => unmatchM.mutate({ bankTxId: btx.bankTxId })}
                        style={{ marginTop: 6 }}>
                        <Text style={{ color: "#687076", fontSize: 11 }}>✕ Unmatch</Text>
                      </TouchableOpacity>
                    </View>
                  ) : btx.status === "ignored" ? (
                    <Text style={{ color: "#687076", fontSize: 12, fontStyle: "italic", marginTop: 4 }}>Ignored</Text>
                  ) : (
                    <View>
                      <Text style={{ color: "#687076", fontSize: 12, fontStyle: "italic", marginBottom: 6 }}>No match</Text>
                      {matchingBankTxId === btx.bankTxId ? (
                        <View>
                          <Text style={{ color: "#9BA1A6", fontSize: 11, marginBottom: 4 }}>Select Finance record:</Text>
                          <ScrollView style={{ maxHeight: 120 }}>
                            {financeTxs.slice(0, 20).map((f: any) => (
                              <TouchableOpacity key={f.txId} onPress={() => {
                                matchM.mutate({ bankTxId: btx.bankTxId, financeTxId: f.txId });
                                setMatchingBankTxId(null);
                              }}
                                style={{ paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: "#334155" }}>
                                <Text style={{ color: "#ECEDEE", fontSize: 11 }} numberOfLines={1}>{f.categoryName} · {f.date}</Text>
                                <Text style={{ color: f.type === "income" ? "#22C55E" : "#EF4444", fontSize: 11 }}>
                                  {fmt(Math.abs(parseFloat(f.amount)))}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                          <TouchableOpacity onPress={() => setMatchingBankTxId(null)} style={{ marginTop: 4 }}>
                            <Text style={{ color: "#687076", fontSize: 11 }}>Cancel</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity onPress={() => setMatchingBankTxId(btx.bankTxId)}
                          style={{ backgroundColor: "#0a7ea420", borderRadius: 8, padding: 6, alignItems: "center" }}>
                          <Text style={{ color: "#0a7ea4", fontSize: 11, fontWeight: "600" }}>Match Record</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

// ─── Team Expenses Tab ────────────────────────────────────────────────────────
const EXP_CATEGORIES: Record<string, { label: string; emoji: string }> = {
  fuel: { label: "Fuel", emoji: "⛽" },
  supplies: { label: "Supplies", emoji: "🧴" },
  equipment: { label: "Equipment", emoji: "🔧" },
  car_wash: { label: "Car Wash", emoji: "🚿" },
  food: { label: "Food", emoji: "🍔" },
  other: { label: "Other", emoji: "📦" },
};
const EXP_STATUS_COLORS: Record<string, string> = { pending: "#F59E0B", approved: "#22C55E", rejected: "#EF4444" };

function TeamExpensesTab({ adminId, selectedCityId, cities }: { adminId: string; selectedCityId: string | null; cities: any[] }) {
  const colors = useColors();
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | undefined>(undefined);
  const [selected, setSelected] = useState<any | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [viewReceipt, setViewReceipt] = useState<string | null>(null);

  // Resolve city name from the selected city ID for server-side filtering
  const selectedCityName = selectedCityId ? (cities.find((c: any) => c.cityId === selectedCityId)?.name ?? undefined) : undefined;
  const expensesQ = trpc.finance.getAllExpenses.useQuery({ status: filter, cityName: selectedCityName }, { staleTime: 20_000 });
  const reviewMutation = trpc.finance.reviewExpense.useMutation();
  const utils = trpc.useUtils();

  const handleReview = async (status: "approved" | "rejected") => {
    if (!selected) return;
    setReviewing(true);
    try {
      await reviewMutation.mutateAsync({ expenseId: selected.expenseId, status, adminNote: reviewNote.trim() || undefined, reviewedBy: adminId });
      // Invalidate all finance-related queries so dashboard, P&L, and location totals refresh
      await Promise.all([
        utils.finance.getAllExpenses.invalidate(),
        utils.finance.getPendingExpenseSummary.invalidate(),
        utils.finance.getSummary.invalidate(),
        utils.finance.getByLocation.invalidate(),
        utils.finance.getByCategory.invalidate(),
        utils.finance.getTransactions.invalidate(),
      ]);
      setSelected(null);
      setReviewNote("");
    } catch {
      Alert.alert("Error", "Could not update expense status.");
    } finally {
      setReviewing(false);
    }
  };

  const expenses = expensesQ.data ?? [];
  const pendingCount = (expensesQ.data ?? []).filter((e: any) => e.status === "pending").length;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 12, gap: 8 }}>
        {([undefined, "pending", "approved", "rejected"] as const).map((f) => (
          <TouchableOpacity key={String(f)} onPress={() => setFilter(f)}
            style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: filter === f ? "#8B5CF6" : "#1e2022", borderWidth: 1, borderColor: filter === f ? "#8B5CF6" : "#334155" }}>
            <Text style={{ color: filter === f ? "#fff" : "#ECEDEE", fontWeight: "600", fontSize: 13 }}>
              {f === undefined ? `All (${expenses.length})` : f === "pending" ? `Pending${pendingCount > 0 ? ` (${pendingCount})` : ""}` : f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {expensesQ.isLoading ? (
        <ActivityIndicator color="#0a7ea4" style={{ marginTop: 40 }} />
      ) : expenses.length === 0 ? (
        <View style={{ alignItems: "center", marginTop: 60, gap: 10 }}>
          <Text style={{ fontSize: 36 }}>🧾</Text>
          <Text style={{ color: "#ECEDEE", fontSize: 17, fontWeight: "700" }}>No Expenses</Text>
          <Text style={{ color: "#9BA1A6", fontSize: 14 }}>No expense submissions match this filter.</Text>
        </View>
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={expenses}
          keyExtractor={(item: any) => item.expenseId}
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
          renderItem={({ item }: { item: any }) => {
            const cat = EXP_CATEGORIES[item.category] ?? { label: item.category, emoji: "📦" };
            return (
              <TouchableOpacity onPress={() => { setSelected(item); setReviewNote(item.adminNote ?? ""); }}
                style={{ backgroundColor: "#1e2022", borderRadius: 14, borderWidth: 1, borderColor: "#334155", padding: 14, marginBottom: 10 }} activeOpacity={0.8}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
                  <View style={{ flexDirection: "row", flex: 1 }}>
                    <Text style={{ fontSize: 24 }}>{cat.emoji}</Text>
                    <View style={{ marginLeft: 12, flex: 1 }}>
                      <Text style={{ color: "#ECEDEE", fontWeight: "700", fontSize: 15 }}>{item.fullName}</Text>
                      <Text style={{ color: "#9BA1A6", fontSize: 13 }}>{cat.label} · {new Date(item.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</Text>
                      {item.note ? <Text style={{ color: "#9BA1A6", fontSize: 13, marginTop: 2 }} numberOfLines={1}>{item.note}</Text> : null}
                    </View>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={{ color: "#ECEDEE", fontWeight: "700", fontSize: 17 }}>${parseFloat(item.amount).toFixed(2)}</Text>
                    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: EXP_STATUS_COLORS[item.status] + "22" }}>
                      <Text style={{ color: EXP_STATUS_COLORS[item.status], fontSize: 11, fontWeight: "700" }}>{item.status.charAt(0).toUpperCase() + item.status.slice(1)}</Text>
                    </View>
                  </View>
                </View>
                {item.receiptUrl ? (
                  <TouchableOpacity onPress={() => setViewReceipt(item.receiptUrl)} style={{ marginTop: 8 }}>
                    <Image source={{ uri: item.receiptUrl }} style={{ width: "100%", height: 120, borderRadius: 10 }} resizeMode="cover" />
                    <Text style={{ color: "#8B5CF6", fontSize: 12, marginTop: 4, fontWeight: "600" }}>Tap to view full receipt</Text>
                  </TouchableOpacity>
                ) : null}
              </TouchableOpacity>
            );
          }}
        />
      )}
      <Modal visible={!!selected} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelected(null)}>
        {selected && (
          <View style={{ flex: 1, backgroundColor: "#151718" }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: "#334155" }}>
              <TouchableOpacity onPress={() => setSelected(null)}><Text style={{ color: "#9BA1A6", fontSize: 16 }}>Close</Text></TouchableOpacity>
              <Text style={{ color: "#ECEDEE", fontSize: 17, fontWeight: "700" }}>Review Expense</Text>
              <View style={{ width: 50 }} />
            </View>
            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
              <View style={{ backgroundColor: "#1e2022", borderRadius: 14, borderWidth: 1, borderColor: "#334155", padding: 16, marginBottom: 16 }}>
                <Text style={{ color: "#ECEDEE", fontWeight: "700", fontSize: 18 }}>{selected.fullName}</Text>
                <Text style={{ color: "#9BA1A6", fontSize: 14, marginTop: 2 }}>
                  {EXP_CATEGORIES[selected.category]?.emoji} {EXP_CATEGORIES[selected.category]?.label} · {new Date(selected.submittedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </Text>
                <Text style={{ color: "#ECEDEE", fontSize: 28, fontWeight: "800", marginTop: 10 }}>${parseFloat(selected.amount).toFixed(2)}</Text>
                {selected.note ? <Text style={{ color: "#9BA1A6", fontSize: 14, marginTop: 8 }}>{selected.note}</Text> : null}
              </View>
              {selected.receiptUrl ? (
                <TouchableOpacity onPress={() => setViewReceipt(selected.receiptUrl)} style={{ marginBottom: 16 }}>
                  <Image source={{ uri: selected.receiptUrl }} style={{ width: "100%", height: 220, borderRadius: 14 }} resizeMode="contain" />
                  <Text style={{ color: "#8B5CF6", fontSize: 12, marginTop: 4, fontWeight: "600", textAlign: "center" }}>Tap to view full size</Text>
                </TouchableOpacity>
              ) : (
                <View style={{ backgroundColor: "#1e2022", borderRadius: 14, borderWidth: 1, borderColor: "#334155", padding: 20, alignItems: "center", marginBottom: 16 }}>
                  <Text style={{ color: "#9BA1A6", fontSize: 14 }}>No receipt attached</Text>
                </View>
              )}
              <Text style={{ color: "#9BA1A6", fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginBottom: 8 }}>ADMIN NOTE (optional)</Text>
              <TextInput
                style={{ backgroundColor: "#1e2022", borderRadius: 12, borderWidth: 1, borderColor: "#334155", padding: 12, color: "#ECEDEE", fontSize: 15, minHeight: 80, textAlignVertical: "top", marginBottom: 20 }}
                placeholder="Add a note for the team member..." placeholderTextColor="#687076"
                multiline value={reviewNote} onChangeText={setReviewNote}
              />
              {selected.status === "pending" ? (
                <View style={{ flexDirection: "row", gap: 12 }}>
                  <TouchableOpacity onPress={() => handleReview("rejected")} disabled={reviewing}
                    style={{ flex: 1, backgroundColor: "#EF444422", borderRadius: 14, paddingVertical: 16, alignItems: "center", borderWidth: 1.5, borderColor: "#EF4444" }} activeOpacity={0.8}>
                    {reviewing ? <ActivityIndicator color="#EF4444" /> : <Text style={{ color: "#EF4444", fontWeight: "700", fontSize: 16 }}>✕ Reject</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleReview("approved")} disabled={reviewing}
                    style={{ flex: 1, backgroundColor: "#22C55E22", borderRadius: 14, paddingVertical: 16, alignItems: "center", borderWidth: 1.5, borderColor: "#22C55E" }} activeOpacity={0.8}>
                    {reviewing ? <ActivityIndicator color="#22C55E" /> : <Text style={{ color: "#22C55E", fontWeight: "700", fontSize: 16 }}>✓ Approve</Text>}
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={{ flexDirection: "row", gap: 12 }}>
                  {selected.status === "approved" && (
                    <TouchableOpacity onPress={() => handleReview("rejected")} disabled={reviewing}
                      style={{ flex: 1, backgroundColor: "#EF444422", borderRadius: 14, paddingVertical: 14, alignItems: "center", borderWidth: 1.5, borderColor: "#EF4444" }} activeOpacity={0.8}>
                      <Text style={{ color: "#EF4444", fontWeight: "700" }}>Change to Rejected</Text>
                    </TouchableOpacity>
                  )}
                  {selected.status === "rejected" && (
                    <TouchableOpacity onPress={() => handleReview("approved")} disabled={reviewing}
                      style={{ flex: 1, backgroundColor: "#22C55E22", borderRadius: 14, paddingVertical: 14, alignItems: "center", borderWidth: 1.5, borderColor: "#22C55E" }} activeOpacity={0.8}>
                      <Text style={{ color: "#22C55E", fontWeight: "700" }}>Change to Approved</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        )}
      </Modal>
      <Modal visible={!!viewReceipt} animationType="fade" onRequestClose={() => setViewReceipt(null)}>
        <View style={{ flex: 1, backgroundColor: "#000", justifyContent: "center", alignItems: "center" }}>
          <TouchableOpacity onPress={() => setViewReceipt(null)} style={{ position: "absolute", top: 60, right: 20, zIndex: 10, backgroundColor: "#ffffff22", borderRadius: 20, padding: 10 }}>
            <Text style={{ color: "#fff", fontSize: 18, fontWeight: "700" }}>✕</Text>
          </TouchableOpacity>
          {viewReceipt && <Image source={{ uri: viewReceipt }} style={{ width: "100%", height: "80%" }} resizeMode="contain" />}
        </View>
      </Modal>
    </View>
  );
}
