import { useState } from "react";
import {
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Switch,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";
import * as Haptics from "expo-haptics";

// ─── Preset background colors ─────────────────────────────────────────────────
const BG_COLORS = [
  { label: "Blue",    value: "#0057FF" },
  { label: "Purple",  value: "#7C3AED" },
  { label: "Green",   value: "#059669" },
  { label: "Orange",  value: "#EA580C" },
  { label: "Red",     value: "#DC2626" },
  { label: "Pink",    value: "#DB2777" },
  { label: "Teal",    value: "#0891B2" },
  { label: "Dark",    value: "#1E293B" },
];

const EMOJIS = ["🎉", "🔥", "💥", "⚡", "🌟", "💎", "🚗", "✨", "🎁", "💰"];

type DiscountType = "percent" | "fixed" | "none";

interface PromoForm {
  title: string;
  description: string;
  discountType: DiscountType;
  discountValue: string;
  promoCode: string;
  bgColor: string;
  emoji: string;
  startDate: string;
  endDate: string;
}

const EMPTY_FORM: PromoForm = {
  title: "",
  description: "",
  discountType: "none",
  discountValue: "",
  promoCode: "",
  bgColor: "#0057FF",
  emoji: "🎉",
  startDate: "",
  endDate: "",
};

export default function AdminPromotions() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();

  const [showModal, setShowModal] = useState(false);
  const [editingPromoId, setEditingPromoId] = useState<string | null>(null);
  const [form, setForm] = useState<PromoForm>(EMPTY_FORM);

  const { data: promos = [], isLoading, refetch } = trpc.promotions.list.useQuery();
  const createMutation = trpc.promotions.create.useMutation({ onSuccess: () => { refetch(); closeModal(); } });
  const updateMutation = trpc.promotions.update.useMutation({ onSuccess: () => { refetch(); closeModal(); } });
  const deleteMutation = trpc.promotions.delete.useMutation({ onSuccess: () => refetch() });
  const toggleMutation = trpc.promotions.update.useMutation({ onSuccess: () => refetch() });

  function openCreate() {
    setEditingPromoId(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  }

  function openEdit(promo: any) {
    setEditingPromoId(promo.promoId);
    setForm({
      title: promo.title ?? "",
      description: promo.description ?? "",
      discountType: promo.discountType ?? "none",
      discountValue: promo.discountValue ? String(parseFloat(promo.discountValue)) : "",
      promoCode: promo.promoCode ?? "",
      bgColor: promo.bgColor ?? "#0057FF",
      emoji: promo.emoji ?? "🎉",
      startDate: promo.startDate ?? "",
      endDate: promo.endDate ?? "",
    });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingPromoId(null);
    setForm(EMPTY_FORM);
  }

  function handleSave() {
    if (!form.title.trim()) {
      Alert.alert("Required", "Please enter a title for the promotion.");
      return;
    }
    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || undefined,
      discountType: form.discountType,
      discountValue: form.discountValue ? parseFloat(form.discountValue) : undefined,
      promoCode: form.promoCode.trim() || undefined,
      bgColor: form.bgColor,
      emoji: form.emoji,
      startDate: form.startDate.trim() || undefined,
      endDate: form.endDate.trim() || undefined,
    };
    if (editingPromoId) {
      updateMutation.mutate({ promoId: editingPromoId, ...payload });
    } else {
      createMutation.mutate({ ...payload, createdBy: employee?.employeeId });
    }
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function handleDelete(promoId: string, title: string) {
    Alert.alert("Delete Promotion", `Delete "${title}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: () => {
          deleteMutation.mutate({ promoId });
          if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        },
      },
    ]);
  }

  function handleToggle(promoId: string, currentActive: number) {
    toggleMutation.mutate({ promoId, isActive: currentActive === 0 });
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <ScreenContainer edges={["left", "right"]} className="px-5">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* Header */}
        <View style={{ marginTop: 0, marginBottom: 20, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
          <View>
            <Text style={{ fontSize: 14, color: colors.muted }}>Admin</Text>
            <Text style={{ fontSize: 28, fontWeight: "800", color: colors.foreground }}>Promotions</Text>
          </View>
          <TouchableOpacity
            onPress={openCreate}
            style={{ backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 14, flexDirection: "row", alignItems: "center", gap: 6 }}
          >
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>+ New Promo</Text>
          </TouchableOpacity>
        </View>

        {/* Info banner */}
        <View style={{ backgroundColor: colors.primary + "15", borderRadius: 14, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: colors.primary + "30" }}>
          <Text style={{ fontSize: 13, color: colors.primary, fontWeight: "600", marginBottom: 4 }}>📢 How it works</Text>
          <Text style={{ fontSize: 12, color: colors.foreground, lineHeight: 18 }}>
            Active promotions appear as banners on the customer home screen. Customers can tap to expand and copy the promo code. Toggle any promo on/off at any time.
          </Text>
        </View>

        {/* Promo list */}
        {isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
        ) : (promos as any[]).length === 0 ? (
          <View style={{ alignItems: "center", marginTop: 60 }}>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>🎉</Text>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>No promotions yet</Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 4, textAlign: "center" }}>
              Create your first promotion to advertise specials to customers.
            </Text>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {(promos as any[]).map((promo) => (
              <View key={promo.promoId} style={{ borderRadius: 18, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
                {/* Color preview bar */}
                <View style={{ backgroundColor: promo.bgColor ?? "#0057FF", padding: 16 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Text style={{ fontSize: 28 }}>{promo.emoji ?? "🎉"}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, fontWeight: "800", color: "#fff" }} numberOfLines={1}>{promo.title}</Text>
                      {promo.description ? (
                        <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 2 }} numberOfLines={2}>{promo.description}</Text>
                      ) : null}
                    </View>
                  </View>
                  {promo.discountType !== "none" && (
                    <View style={{ marginTop: 8, flexDirection: "row", gap: 8 }}>
                      <View style={{ backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
                        <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>
                          {promo.discountType === "percent"
                            ? `${parseFloat(promo.discountValue ?? "0")}% OFF`
                            : `$${parseFloat(promo.discountValue ?? "0")} OFF`}
                        </Text>
                      </View>
                      {promo.promoCode ? (
                        <View style={{ backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 }}>
                          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>CODE: {promo.promoCode}</Text>
                        </View>
                      ) : null}
                    </View>
                  )}
                </View>

                {/* Controls */}
                <View style={{ backgroundColor: colors.surface, padding: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
                  {/* Active toggle */}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                    <Switch
                      value={promo.isActive === 1}
                      onValueChange={() => handleToggle(promo.promoId, promo.isActive)}
                      trackColor={{ false: colors.border, true: colors.success + "80" }}
                      thumbColor={promo.isActive === 1 ? colors.success : colors.muted}
                    />
                    <Text style={{ fontSize: 13, fontWeight: "600", color: promo.isActive === 1 ? colors.success : colors.muted }}>
                      {promo.isActive === 1 ? "Active" : "Inactive"}
                    </Text>
                  </View>
                  {/* Date range */}
                  {(promo.startDate || promo.endDate) && (
                    <Text style={{ fontSize: 11, color: colors.muted, flex: 1 }} numberOfLines={1}>
                      {promo.startDate ?? "—"} → {promo.endDate ?? "—"}
                    </Text>
                  )}
                  {/* Edit */}
                  <TouchableOpacity
                    onPress={() => openEdit(promo)}
                    style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.primary + "20", borderRadius: 10 }}
                  >
                    <Text style={{ color: colors.primary, fontWeight: "600", fontSize: 13 }}>Edit</Text>
                  </TouchableOpacity>
                  {/* Delete */}
                  <TouchableOpacity
                    onPress={() => handleDelete(promo.promoId, promo.title)}
                    style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.error + "20", borderRadius: 10 }}
                  >
                    <Text style={{ color: colors.error, fontWeight: "600", fontSize: 13 }}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* ── Create / Edit Modal ── */}
      <Modal visible={showModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeModal}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          {/* Modal header */}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <Text style={{ fontSize: 20, fontWeight: "800", color: colors.foreground }}>
              {editingPromoId ? "Edit Promotion" : "New Promotion"}
            </Text>
            <TouchableOpacity onPress={closeModal}>
              <Text style={{ fontSize: 16, color: colors.muted }}>Cancel</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }} showsVerticalScrollIndicator={false}>

            {/* Live preview */}
            <View style={{ backgroundColor: form.bgColor, borderRadius: 16, padding: 18 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Text style={{ fontSize: 32 }}>{form.emoji || "🎉"}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: "800", color: "#fff" }}>
                    {form.title || "Promotion Title"}
                  </Text>
                  {form.description ? (
                    <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.85)", marginTop: 2 }}>{form.description}</Text>
                  ) : null}
                </View>
              </View>
              {(form.discountType !== "none" && form.discountValue) && (
                <View style={{ marginTop: 10, flexDirection: "row", gap: 8 }}>
                  <View style={{ backgroundColor: "rgba(255,255,255,0.25)", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 }}>
                    <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>
                      {form.discountType === "percent" ? `${form.discountValue}% OFF` : `$${form.discountValue} OFF`}
                    </Text>
                  </View>
                  {form.promoCode ? (
                    <View style={{ backgroundColor: "rgba(255,255,255,0.25)", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 }}>
                      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>CODE: {form.promoCode}</Text>
                    </View>
                  ) : null}
                </View>
              )}
            </View>

            {/* Title */}
            <View>
              <Text style={[styles.label, { color: colors.muted }]}>Title *</Text>
              <TextInput
                value={form.title}
                onChangeText={(v) => setForm(f => ({ ...f, title: v }))}
                placeholder="e.g. Summer Special — 20% Off Full Detail"
                placeholderTextColor={colors.muted}
                style={[styles.input, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]}
              />
            </View>

            {/* Description */}
            <View>
              <Text style={[styles.label, { color: colors.muted }]}>Description (optional)</Text>
              <TextInput
                value={form.description}
                onChangeText={(v) => setForm(f => ({ ...f, description: v }))}
                placeholder="Add more details about the offer…"
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={3}
                style={[styles.input, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border, height: 80, textAlignVertical: "top", paddingTop: 12 }]}
              />
            </View>

            {/* Discount type */}
            <View>
              <Text style={[styles.label, { color: colors.muted }]}>Discount Type</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {(["none", "percent", "fixed"] as DiscountType[]).map((type) => (
                  <TouchableOpacity
                    key={type}
                    onPress={() => setForm(f => ({ ...f, discountType: type }))}
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      borderRadius: 12,
                      alignItems: "center",
                      backgroundColor: form.discountType === type ? colors.primary : colors.surface,
                      borderWidth: 1,
                      borderColor: form.discountType === type ? colors.primary : colors.border,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: "600", color: form.discountType === type ? "#fff" : colors.foreground }}>
                      {type === "none" ? "No Discount" : type === "percent" ? "% Off" : "$ Off"}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Discount value + promo code */}
            {form.discountType !== "none" && (
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: colors.muted }]}>
                    {form.discountType === "percent" ? "Percent Off" : "Dollar Amount Off"}
                  </Text>
                  <TextInput
                    value={form.discountValue}
                    onChangeText={(v) => setForm(f => ({ ...f, discountValue: v }))}
                    placeholder={form.discountType === "percent" ? "20" : "25"}
                    placeholderTextColor={colors.muted}
                    keyboardType="decimal-pad"
                    style={[styles.input, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.label, { color: colors.muted }]}>Promo Code (optional)</Text>
                  <TextInput
                    value={form.promoCode}
                    onChangeText={(v) => setForm(f => ({ ...f, promoCode: v.toUpperCase() }))}
                    placeholder="SUMMER20"
                    placeholderTextColor={colors.muted}
                    autoCapitalize="characters"
                    style={[styles.input, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]}
                  />
                </View>
              </View>
            )}

            {/* Date range */}
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.muted }]}>Start Date (optional)</Text>
                <TextInput
                  value={form.startDate}
                  onChangeText={(v) => setForm(f => ({ ...f, startDate: v }))}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.label, { color: colors.muted }]}>End Date (optional)</Text>
                <TextInput
                  value={form.endDate}
                  onChangeText={(v) => setForm(f => ({ ...f, endDate: v }))}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.muted}
                  style={[styles.input, { backgroundColor: colors.surface, color: colors.foreground, borderColor: colors.border }]}
                />
              </View>
            </View>

            {/* Emoji picker */}
            <View>
              <Text style={[styles.label, { color: colors.muted }]}>Emoji</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {EMOJIS.map((e) => (
                  <TouchableOpacity
                    key={e}
                    onPress={() => setForm(f => ({ ...f, emoji: e }))}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 12,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: form.emoji === e ? colors.primary + "30" : colors.surface,
                      borderWidth: 2,
                      borderColor: form.emoji === e ? colors.primary : colors.border,
                    }}
                  >
                    <Text style={{ fontSize: 22 }}>{e}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Color picker */}
            <View>
              <Text style={[styles.label, { color: colors.muted }]}>Banner Color</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {BG_COLORS.map((c) => (
                  <TouchableOpacity
                    key={c.value}
                    onPress={() => setForm(f => ({ ...f, bgColor: c.value }))}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: c.value,
                      borderWidth: form.bgColor === c.value ? 3 : 1,
                      borderColor: form.bgColor === c.value ? colors.foreground : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {form.bgColor === c.value && <Text style={{ color: "#fff", fontSize: 16 }}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Save button */}
            <TouchableOpacity
              onPress={handleSave}
              disabled={isSaving}
              style={{
                backgroundColor: colors.primary,
                borderRadius: 16,
                paddingVertical: 16,
                alignItems: "center",
                marginTop: 8,
                opacity: isSaving ? 0.7 : 1,
              }}
            >
              {isSaving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>
                  {editingPromoId ? "Save Changes" : "Create Promotion"}
                </Text>
              )}
            </TouchableOpacity>

          </ScrollView>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 12, fontWeight: "600", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
});
