/**
 * Admin Price Book Screen
 * - Lists all active services with per-vehicle pricing
 * - Add / Edit service sheet: name, emoji, description, features, per-vehicle prices, service photo
 * - Image upload: admin can upload a photo per service which appears on the customer booking form
 * - Delete (soft-delete) with confirmation
 * - Up/Down sort controls to reorder services
 * - Services feed into the job booking wizard dynamically
 */
import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Switch,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { MaterialIcons } from "@expo/vector-icons";

// ─── Types ────────────────────────────────────────────────────────────────────
type VehiclePrices = { sedan: number; suv: number; xl_suv_van: number; truck: number; rv_20_29?: number; rv_30_39?: number; rv_40_plus?: number };

// Detect if a service is RV-based (has non-zero rv prices or serviceId starts with pb_rv)
function isRvService(svc: { serviceId: string; vehiclePrices: VehiclePrices }): boolean {
  return svc.serviceId.startsWith("pb_rv") ||
    ((svc.vehiclePrices.rv_20_29 ?? 0) > 0 || (svc.vehiclePrices.rv_30_39 ?? 0) > 0 || (svc.vehiclePrices.rv_40_plus ?? 0) > 0);
}

interface PBService {
  serviceId: string;
  name: string;
  emoji: string;
  description: string;
  features: string[];
  vehiclePrices: VehiclePrices;
  sortOrder: number;
  isActive?: boolean;
  imageUrl?: string | null;
}

const VEHICLE_LABELS: { key: keyof VehiclePrices; label: string; emoji: string }[] = [
  { key: "sedan",      label: "Sedan",        emoji: "🚗" },
  { key: "suv",        label: "SUV",          emoji: "🚙" },
  { key: "xl_suv_van", label: "XL SUV / Van", emoji: "🚐" },
  { key: "truck",      label: "Truck",        emoji: "🛻" },
];

const RV_LABELS: { key: keyof VehiclePrices; label: string; emoji: string }[] = [
  { key: "rv_20_29",  label: "20ft – 29ft", emoji: "🚐" },
  { key: "rv_30_39",  label: "30ft – 39ft", emoji: "🚌" },
  { key: "rv_40_plus", label: "40ft+",       emoji: "🚎" },
];

function newId() {
  return "pb_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function emptyForm(): Omit<PBService, "sortOrder"> {
  return {
    serviceId: newId(),
    name: "",
    emoji: "🚗",
    description: "",
    features: [],
    vehiclePrices: { sedan: 0, suv: 0, xl_suv_van: 0, truck: 0, rv_20_29: 0, rv_30_39: 0, rv_40_plus: 0 },
    imageUrl: null,
  };
}

// ─── Service Edit Sheet ───────────────────────────────────────────────────────
function ServiceSheet({
  visible,
  initial,
  onClose,
  onSave,
}: {
  visible: boolean;
  initial: Omit<PBService, "sortOrder"> | null;
  onClose: () => void;
  onSave: (data: Omit<PBService, "sortOrder">) => void;
}) {
  const colors = useColors();
  const utils = trpc.useUtils();
  const [form, setForm] = useState<Omit<PBService, "sortOrder">>(initial ?? emptyForm());
  const [featureInput, setFeatureInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const uploadImageMutation = trpc.pricebook.uploadServiceImage.useMutation({
    onSuccess: (data) => {
      setForm((f) => ({ ...f, imageUrl: data.url }));
      setImagePreview(null);
      setUploadingImage(false);
      utils.pricebook.listAll.invalidate();
      utils.pricebook.list.invalidate();
    },
    onError: (err) => {
      setUploadingImage(false);
      Alert.alert("Upload failed", err.message);
    },
  });

  React.useEffect(() => {
    if (visible) {
      setForm(initial ?? emptyForm());
      setImagePreview(null);
    }
  }, [visible, initial]);

  const setPrice = (key: keyof VehiclePrices, val: string) => {
    const n = parseFloat(val.replace(/[^0-9.]/g, "")) || 0;
    setForm((f) => ({ ...f, vehiclePrices: { ...f.vehiclePrices, [key]: n } }));
  };

  const addFeature = () => {
    const t = featureInput.trim();
    if (!t) return;
    setForm((f) => ({ ...f, features: [...f.features, t] }));
    setFeatureInput("");
  };

  const removeFeature = (i: number) => {
    setForm((f) => ({ ...f, features: f.features.filter((_, idx) => idx !== i) }));
  };

  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow access to your photo library in Settings.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.85,
      base64: true,
    });
    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      setImagePreview(asset.uri);
      if (asset.base64) {
        setUploadingImage(true);
        uploadImageMutation.mutate({
          serviceId: form.serviceId,
          base64: asset.base64,
          mimeType: asset.mimeType ?? "image/jpeg",
        });
      }
    }
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      Alert.alert("Required", "Service name is required.");
      return;
    }
    setSaving(true);
    onSave(form);
    setSaving(false);
  };

  const currentImage = imagePreview ?? form.imageUrl ?? null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {/* Header */}
        <View style={[sh.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={sh.headerBtn}>
            <Text style={{ color: colors.muted, fontSize: 16 }}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[sh.headerTitle, { color: colors.foreground }]}>
            {initial?.name ? "Edit Service" : "Add Service"}
          </Text>
          <TouchableOpacity onPress={handleSave} style={sh.headerBtn} disabled={saving}>
            <Text style={{ color: colors.primary, fontSize: 16, fontWeight: "600" }}>
              {saving ? "Saving…" : initial?.name ? "Update" : "Add"}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">

          {/* Service Photo */}
          <View style={[sh.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[sh.label, { color: colors.muted }]}>SERVICE PHOTO</Text>
            <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 10 }}>
              This image appears on the customer booking form
            </Text>
            {currentImage ? (
              <View style={{ position: "relative" }}>
                <Image
                  source={{ uri: currentImage }}
                  style={{ width: "100%", height: 160, borderRadius: 10, backgroundColor: colors.border }}
                  resizeMode="cover"
                />
                {uploadingImage && (
                  <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 10, alignItems: "center", justifyContent: "center" }}>
                    <ActivityIndicator color="#fff" size="large" />
                    <Text style={{ color: "#fff", marginTop: 8, fontSize: 13 }}>Uploading…</Text>
                  </View>
                )}
                <TouchableOpacity
                  onPress={handlePickImage}
                  style={{ position: "absolute", bottom: 8, right: 8, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 4 }}
                >
                  <MaterialIcons name="edit" size={14} color="#fff" />
                  <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>Change</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                onPress={handlePickImage}
                style={{ width: "100%", height: 140, borderRadius: 10, borderWidth: 2, borderColor: colors.border, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 8 }}
              >
                <MaterialIcons name="add-photo-alternate" size={36} color={colors.muted} />
                <Text style={{ color: colors.muted, fontSize: 13, fontWeight: "600" }}>Tap to add service photo</Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>16:9 ratio recommended</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Name + Emoji */}
          <View style={[sh.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[sh.label, { color: colors.muted }]}>SERVICE NAME *</Text>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <TextInput
                value={form.emoji}
                onChangeText={(t) => setForm((f) => ({ ...f, emoji: t }))}
                style={[sh.emojiInput, { color: colors.foreground, borderColor: colors.border }]}
                maxLength={2}
              />
              <TextInput
                value={form.name}
                onChangeText={(t) => setForm((f) => ({ ...f, name: t }))}
                placeholder="e.g. Luxury Detail"
                placeholderTextColor={colors.muted}
                style={[sh.input, { flex: 1, color: colors.foreground, borderColor: colors.border }]}
              />
            </View>
          </View>

          {/* Description */}
          <View style={[sh.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[sh.label, { color: colors.muted }]}>DESCRIPTION / TAGLINE</Text>
            <TextInput
              value={form.description}
              onChangeText={(t) => setForm((f) => ({ ...f, description: t }))}
              placeholder="Short description shown under the service name"
              placeholderTextColor={colors.muted}
              style={[sh.input, { color: colors.foreground, borderColor: colors.border }]}
              multiline
              numberOfLines={2}
            />
          </View>

          {/* Pricing — RV services show size-based pricing, others show vehicle type pricing */}
          <View style={[sh.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[sh.label, { color: colors.muted }]}>
              {isRvService(form) ? "PRICING BY RV SIZE" : "PRICING BY VEHICLE TYPE"}
            </Text>
            {(isRvService(form) ? RV_LABELS : VEHICLE_LABELS).map(({ key, label, emoji }) => (
              <View key={key} style={sh.priceRow}>
                <Text style={{ fontSize: 18 }}>{emoji}</Text>
                <Text style={[sh.priceLabel, { color: colors.foreground }]}>{label}</Text>
                <View style={[sh.priceInputWrap, { borderColor: colors.border }]}>
                  <Text style={{ color: colors.muted, fontSize: 15 }}>$</Text>
                  <TextInput
                    value={(form.vehiclePrices[key] ?? 0) > 0 ? String(form.vehiclePrices[key]) : ""}
                    onChangeText={(v) => setPrice(key, v)}
                    placeholder="0"
                    placeholderTextColor={colors.muted}
                    keyboardType="decimal-pad"
                    style={[sh.priceInput, { color: colors.foreground }]}
                  />
                </View>
              </View>
            ))}
          </View>

          {/* Features list */}
          <View style={[sh.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[sh.label, { color: colors.muted }]}>INCLUDED FEATURES</Text>
            {form.features.map((f, i) => (
              <View key={i} style={sh.featureRow}>
                <Text style={{ color: colors.muted, fontSize: 14, marginRight: 6 }}>•</Text>
                <Text style={[sh.featureText, { color: colors.foreground }]}>{f}</Text>
                <TouchableOpacity onPress={() => removeFeature(i)} style={{ padding: 4 }}>
                  <Text style={{ color: colors.error, fontSize: 16 }}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <TextInput
                value={featureInput}
                onChangeText={setFeatureInput}
                placeholder="Add a feature…"
                placeholderTextColor={colors.muted}
                style={[sh.input, { flex: 1, color: colors.foreground, borderColor: colors.border }]}
                onSubmitEditing={addFeature}
                returnKeyType="done"
              />
              <TouchableOpacity
                onPress={addFeature}
                style={[sh.addBtn, { backgroundColor: colors.primary }]}
              >
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 18 }}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminPricebookScreen() {
  const colors = useColors();
  const utils = trpc.useUtils();
  const router = useRouter();

  const listQ = trpc.pricebook.listAll.useQuery(undefined, { staleTime: 30_000 });
  const upsertM = trpc.pricebook.upsert.useMutation({
    onSuccess: () => utils.pricebook.listAll.invalidate(),
  });
  const deleteM = trpc.pricebook.delete.useMutation({
    onSuccess: () => utils.pricebook.listAll.invalidate(),
  });
  const reorderM = trpc.pricebook.reorder.useMutation({
    onSuccess: () => utils.pricebook.listAll.invalidate(),
  });
  const toggleActiveM = trpc.pricebook.toggleActive.useMutation({
    onSuccess: () => utils.pricebook.listAll.invalidate(),
  });

  const [sheetVisible, setSheetVisible] = useState(false);
  const [editing, setEditing] = useState<PBService | null>(null);

  // Local ordered list for optimistic sort UI
  const [localOrder, setLocalOrder] = useState<PBService[]>([]);
  const serverServices: PBService[] = listQ.data ?? [];

  // Sync local order when server data arrives (but not while reordering)
  React.useEffect(() => {
    if (serverServices.length > 0) {
      setLocalOrder(serverServices);
    }
  }, [listQ.dataUpdatedAt]);

  const services = localOrder.length > 0 ? localOrder : serverServices;

  const openAdd = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditing(null);
    setSheetVisible(true);
  };

  const openEdit = (svc: PBService) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditing(svc);
    setSheetVisible(true);
  };

  const handleSave = useCallback((data: Omit<PBService, "sortOrder">) => {
    upsertM.mutate({
      serviceId: data.serviceId,
      name: data.name,
      emoji: data.emoji,
      description: data.description,
      features: data.features,
      vehiclePrices: data.vehiclePrices,
      sortOrder: editing?.sortOrder ?? services.length,
      imageUrl: data.imageUrl ?? undefined,
    });
    setSheetVisible(false);
  }, [editing, services.length]);

  const handleDelete = (svc: PBService) => {
    Alert.alert(
      "Remove Service",
      `Remove "${svc.name}" from the price book? It will no longer appear in job bookings.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            deleteM.mutate({ serviceId: svc.serviceId });
          },
        },
      ]
    );
  };

  const moveService = (index: number, direction: "up" | "down") => {
    const newOrder = [...services];
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newOrder.length) return;
    // Swap
    [newOrder[index], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[index]];
    setLocalOrder(newOrder);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // Persist to server
    reorderM.mutate({ orderedIds: newOrder.map((s) => s.serviceId) });
  };

  return (
    <ScreenContainer edges={["left", "right"]} containerClassName="bg-background">
      {/* Header */}
      <View style={[s.header, { borderBottomColor: colors.border }]}>
        <Text style={[s.title, { color: colors.foreground }]}>Price Book</Text>
        <TouchableOpacity
          onPress={openAdd}
          style={[s.addButton, { backgroundColor: colors.primary }]}
          activeOpacity={0.8}
        >
          <Text style={{ color: "#fff", fontSize: 22, lineHeight: 26, fontWeight: "700" }}>+</Text>
        </TouchableOpacity>
      </View>

      {listQ.isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.muted, marginTop: 8 }}>Loading services…</Text>
        </View>
      ) : services.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>📋</Text>
          <Text style={[s.emptyTitle, { color: colors.foreground }]}>No Services Yet</Text>
          <Text style={[s.emptyBody, { color: colors.muted }]}>
            Tap the + button to add your first service. Services added here will appear in the job booking wizard.
          </Text>
          <TouchableOpacity
            onPress={openAdd}
            style={[s.emptyBtn, { backgroundColor: colors.primary }]}
            activeOpacity={0.8}
          >
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Add First Service</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }} showsVerticalScrollIndicator={false}>
          <Text style={[s.hint, { color: colors.muted }]}>
            {services.length} service{services.length !== 1 ? "s" : ""} · Use ▲ ▼ to reorder · Tap to edit
          </Text>
          {services.map((svc, index) => (
            <View
              key={svc.serviceId}
              style={[s.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              {/* Service image preview (if set) */}
              {svc.imageUrl && (
                <Image
                  source={{ uri: svc.imageUrl }}
                  style={{ width: "100%", height: 100, borderRadius: 8, marginBottom: 10 }}
                  resizeMode="cover"
                />
              )}

              {/* Sort controls + name row */}
              <View style={s.cardTop}>
                {/* Up/Down arrows */}
                <View style={s.sortControls}>
                  <TouchableOpacity
                    onPress={() => moveService(index, "up")}
                    disabled={index === 0}
                    style={[s.sortBtn, { opacity: index === 0 ? 0.25 : 1 }]}
                    activeOpacity={0.6}
                  >
                    <Text style={[s.sortArrow, { color: colors.primary }]}>▲</Text>
                  </TouchableOpacity>
                  <Text style={[s.sortIndex, { color: colors.muted }]}>{index + 1}</Text>
                  <TouchableOpacity
                    onPress={() => moveService(index, "down")}
                    disabled={index === services.length - 1}
                    style={[s.sortBtn, { opacity: index === services.length - 1 ? 0.25 : 1 }]}
                    activeOpacity={0.6}
                  >
                    <Text style={[s.sortArrow, { color: colors.primary }]}>▼</Text>
                  </TouchableOpacity>
                </View>

                {/* Emoji + name + price */}
                <TouchableOpacity style={{ flex: 1, flexDirection: "row", alignItems: "flex-start" }} onPress={() => openEdit(svc)} activeOpacity={0.8}>
                  <Text style={{ fontSize: 26, marginRight: 10 }}>{svc.emoji}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.cardName, { color: colors.foreground }]}>{svc.name}</Text>
                    {!!svc.description && (
                      <Text style={[s.cardDesc, { color: colors.muted }]} numberOfLines={2}>{svc.description}</Text>
                    )}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[s.cardPrice, { color: colors.primary }]}>
                      ${isRvService(svc)
                        ? ((svc.vehiclePrices.rv_20_29 ?? 0) > 0 ? svc.vehiclePrices.rv_20_29! : (svc.vehiclePrices.rv_30_39 ?? 0) > 0 ? svc.vehiclePrices.rv_30_39! : svc.vehiclePrices.rv_40_plus ?? 0).toFixed(0)
                        : svc.vehiclePrices.sedan.toFixed(0)}
                    </Text>
                    <Text style={[s.cardPriceSub, { color: colors.muted }]}>
                      {isRvService(svc) ? "from" : "sedan"}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>

              {/* Vehicle / RV size price chips */}
              <View style={s.priceChips}>
                {(isRvService(svc) ? RV_LABELS : VEHICLE_LABELS).map(({ key, label, emoji }) => (
                  <View key={key} style={[s.chip, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <Text style={{ fontSize: 12 }}>{emoji}</Text>
                    <Text style={[s.chipText, { color: colors.foreground }]}>${(svc.vehiclePrices[key] ?? 0).toFixed(0)}</Text>
                    <Text style={[s.chipText, { color: colors.muted, fontSize: 9 }]}>{label}</Text>
                  </View>
                ))}
              </View>

              {/* Features preview */}
              {svc.features.length > 0 && (
                <View style={{ marginTop: 8 }}>
                  {svc.features.slice(0, 3).map((f, i) => (
                    <Text key={i} style={[s.featurePreview, { color: colors.muted }]}>• {f}</Text>
                  ))}
                  {svc.features.length > 3 && (
                    <Text style={[s.featurePreview, { color: colors.muted }]}>+{svc.features.length - 3} more…</Text>
                  )}
                </View>
              )}

              {/* Active Toggle + Actions */}
              <View style={[s.cardActions, { borderTopColor: colors.border }]}>
                <View style={{ flexDirection: "row", alignItems: "center", marginRight: 12 }}>
                  <Text style={{ color: svc.isActive !== false ? colors.success : colors.muted, fontSize: 12, fontWeight: "600", marginRight: 6 }}>
                    {svc.isActive !== false ? "Active" : "Inactive"}
                  </Text>
                  <Switch
                    value={svc.isActive !== false}
                    onValueChange={(val) => toggleActiveM.mutate({ serviceId: svc.serviceId, isActive: val })}
                    trackColor={{ false: colors.border, true: colors.success }}
                    thumbColor="#fff"
                    style={{ transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }] }}
                  />
                </View>
                <TouchableOpacity
                  onPress={() => openEdit(svc)}
                  style={[s.actionBtn, { borderColor: colors.border }]}
                >
                  <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "600" }}>✏️ Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleDelete(svc)}
                  style={[s.actionBtn, { borderColor: colors.border }]}
                >
                  <Text style={{ color: colors.error, fontSize: 13, fontWeight: "600" }}>🗑 Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      <ServiceSheet
        visible={sheetVisible}
        initial={editing}
        onClose={() => setSheetVisible(false)}
        onSave={handleSave}
      />
    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  title: { fontSize: 24, fontWeight: "700", letterSpacing: -0.5 },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  hint: { fontSize: 12, marginBottom: 4 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    marginBottom: 2,
  },
  cardTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  sortControls: {
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    gap: 2,
  },
  sortBtn: {
    padding: 4,
  },
  sortArrow: {
    fontSize: 13,
    fontWeight: "700",
  },
  sortIndex: {
    fontSize: 11,
    fontWeight: "600",
    minWidth: 16,
    textAlign: "center",
  },
  cardName: { fontSize: 16, fontWeight: "700", marginBottom: 2 },
  cardDesc: { fontSize: 12, lineHeight: 16 },
  cardPrice: { fontSize: 18, fontWeight: "700" },
  cardPriceSub: { fontSize: 10 },
  priceChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  chipText: { fontSize: 12, fontWeight: "600" },
  featurePreview: { fontSize: 12, lineHeight: 18 },
  cardActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  emptyTitle: { fontSize: 20, fontWeight: "700", marginBottom: 8 },
  emptyBody: { fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 24 },
  emptyBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
});

const sh = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  headerBtn: { minWidth: 60 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 2,
  },
  label: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    minHeight: 42,
  },
  emojiInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 22,
    width: 52,
    textAlign: "center",
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  priceLabel: { flex: 1, fontSize: 14, fontWeight: "500" },
  priceInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
    minWidth: 90,
  },
  priceInput: { fontSize: 15, minWidth: 60 },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
  },
  featureText: { flex: 1, fontSize: 14 },
  addBtn: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
});
