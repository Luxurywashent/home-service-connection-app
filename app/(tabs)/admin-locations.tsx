import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Modal,
  Alert,
  ActivityIndicator,
  Switch,
  StyleSheet,
  FlatList,
} from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";

// ─── Types ────────────────────────────────────────────────────────────────────
type LocationDetaier = { locationId: string; employeeId: string; isPrimary: number };
type ServiceLocation = {
  locationId: string;
  name: string;
  slug: string;
  state: string;
  isActive: number;
  sortOrder: number;
  zapierWebhookUrl: string | null;
  thankYouPageUrl: string | null;
  bookingUrl: string | null;
  availableDays: string | null;
  startHour: number;
  endHour: number;
  slotDurationMinutes: number;
  latitude: string | null;
  longitude: string | null;
  radiusMeters: number;
  notes: string | null;
  detailers: LocationDetaier[];
};

type Detailer = { employeeId: string; fullName: string; city?: string | null };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

type DaysRecord = { mon: boolean; tue: boolean; wed: boolean; thu: boolean; fri: boolean; sat: boolean; sun: boolean; };

function parseDays(availableDays: string | null): DaysRecord {
  const result: DaysRecord = { mon: false, tue: false, wed: false, thu: false, fri: false, sat: false, sun: false };
  if (!availableDays) return result;
  availableDays.split(",").forEach((d) => {
    const k = d.trim().toLowerCase() as keyof DaysRecord;
    if (k in result) result[k] = true;
  });
  return result;
}

function serializeDays(days: Record<string, boolean>): string {
  return DAY_KEYS.filter((d) => days[d]).join(",");
}

// ─── Empty form state ─────────────────────────────────────────────────────────
function emptyForm() {
  return {
    name: "",
    slug: "",
    state: "FL",
    isActive: true,
    sortOrder: 0,
    zapierWebhookUrl: "",
    thankYouPageUrl: "",
    bookingUrl: "",
    days: { mon: true, tue: true, wed: true, thu: true, fri: true, sat: true, sun: false } as DaysRecord,
    startHour: 8,
    endHour: 18,
    slotDurationMinutes: 60,
    latitude: "",
    longitude: "",
    radiusMeters: 40000,
    notes: "",
    detailerIds: [] as string[],
  };
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
function CompanyLocationsUnavailable() {
  const colors = useColors();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.background }}>
      <Text style={{ color: colors.foreground, fontSize: 22, fontWeight: "700", textAlign: "center" }}>Locations is not available in Home Service Connected yet</Text>
      <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22, marginTop: 12, textAlign: "center" }}>This legacy location and booking configuration has no verified Home Service Connected contract. Your Company data will not be sent to the legacy service.</Text>
    </View>
  );
}

export default function AdminLocationsScreen() {
  const { session } = useJobSyncAuth();
  return session?.portal === "company" ? <CompanyLocationsUnavailable /> : <AdminLocationsLegacyScreen />;
}

function AdminLocationsLegacyScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const { data: rawLocations, isLoading, refetch } = trpc.serviceLocations.list.useQuery();
  const { data: rawDetailers } = trpc.employee.listDetailers.useQuery();

  const locations: ServiceLocation[] = (rawLocations as any)?.result?.data?.json ?? rawLocations ?? [];
  const allDetailers: Detailer[] = (rawDetailers as any)?.result?.data?.json ?? rawDetailers ?? [];

  const createMutation = trpc.serviceLocations.create.useMutation({ onSuccess: () => { refetch(); closeModal(); } });
  const updateMutation = trpc.serviceLocations.update.useMutation({ onSuccess: () => { refetch(); closeModal(); } });
  const deleteMutation = trpc.serviceLocations.delete.useMutation({ onSuccess: () => refetch() });

  const [modalVisible, setModalVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm());

  const openAdd = useCallback(() => {
    setEditingId(null);
    setForm(emptyForm());
    setModalVisible(true);
  }, []);

  const openEdit = useCallback((loc: ServiceLocation) => {
    setEditingId(loc.locationId);
    setForm({
      name: loc.name,
      slug: loc.slug,
      state: loc.state,
      isActive: loc.isActive === 1,
      sortOrder: loc.sortOrder,
      zapierWebhookUrl: loc.zapierWebhookUrl ?? "",
      thankYouPageUrl: loc.thankYouPageUrl ?? "",
      bookingUrl: loc.bookingUrl ?? "",
      days: parseDays(loc.availableDays),
      startHour: loc.startHour,
      endHour: loc.endHour,
      slotDurationMinutes: loc.slotDurationMinutes,
      latitude: loc.latitude ?? "",
      longitude: loc.longitude ?? "",
      radiusMeters: loc.radiusMeters,
      notes: loc.notes ?? "",
      detailerIds: loc.detailers.map((d) => d.employeeId),
    });
    setModalVisible(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    setEditingId(null);
  }, []);

  const handleNameChange = (val: string) => {
    setForm((f) => ({ ...f, name: val, slug: slugify(val) }));
  };

  const toggleDay = (key: string) => {
    setForm((f) => ({ ...f, days: { ...f.days, [key as keyof DaysRecord]: !f.days[key as keyof DaysRecord] } }));
  };

  const toggleDetailer = (empId: string) => {
    setForm((f) => {
      const ids = f.detailerIds.includes(empId)
        ? f.detailerIds.filter((id) => id !== empId)
        : [...f.detailerIds, empId];
      return { ...f, detailerIds: ids };
    });
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      Alert.alert("Validation", "Location name is required.");
      return;
    }
    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim() || slugify(form.name),
      state: form.state.trim() || "FL",
      isActive: form.isActive ? 1 : 0,
      sortOrder: Number(form.sortOrder) || 0,
      zapierWebhookUrl: form.zapierWebhookUrl.trim() || undefined,
      thankYouPageUrl: form.thankYouPageUrl.trim() || undefined,
      bookingUrl: form.bookingUrl.trim() || undefined,
      availableDays: serializeDays(form.days) || undefined,
      startHour: Number(form.startHour) || 8,
      endHour: Number(form.endHour) || 18,
      slotDurationMinutes: Number(form.slotDurationMinutes) || 60,
      latitude: form.latitude.trim() || undefined,
      longitude: form.longitude.trim() || undefined,
      radiusMeters: Number(form.radiusMeters) || 40000,
      notes: form.notes.trim() || undefined,
      detailerIds: form.detailerIds,
    };
    if (editingId) {
      updateMutation.mutate({ locationId: editingId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleDelete = (loc: ServiceLocation) => {
    Alert.alert(
      "Delete Location",
      `Are you sure you want to delete "${loc.name}"? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteMutation.mutate({ locationId: loc.locationId }),
        },
      ]
    );
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.replace("/(tabs)/admin-dashboard")} style={styles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[styles.backArrow, { color: colors.primary }]}>‹</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Service Locations</Text>
        <TouchableOpacity onPress={openAdd} style={[styles.addBtn, { backgroundColor: colors.primary }]}>
          <Text style={styles.addBtnText}>+ Add</Text>
        </TouchableOpacity>
      </View>

      {/* ── Location List ── */}
      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : locations.length === 0 ? (
        <View style={styles.center}>
          <Text style={[styles.emptyText, { color: colors.muted }]}>No service locations yet.</Text>
          <TouchableOpacity onPress={openAdd} style={[styles.emptyAddBtn, { backgroundColor: colors.primary }]}>
            <Text style={styles.addBtnText}>Add First Location</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={locations}
          keyExtractor={(item) => item.locationId}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          renderItem={({ item }) => (
            <LocationCard
              loc={item}
              allDetailers={allDetailers}
              colors={colors}
              onEdit={() => openEdit(item)}
              onDelete={() => handleDelete(item)}
            />
          )}
        />
      )}

      {/* ── Add / Edit Modal ── */}
      <Modal visible={modalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={closeModal}>
        <LocationForm
          form={form}
          setForm={setForm}
          editingId={editingId}
          allDetailers={allDetailers}
          colors={colors}
          isSaving={isSaving}
          onNameChange={handleNameChange}
          onToggleDay={toggleDay}
          onToggleDetailer={toggleDetailer}
          onSave={handleSave}
          onClose={closeModal}
        />
      </Modal>
    </View>
  );
}

// ─── Location Card ────────────────────────────────────────────────────────────
function LocationCard({
  loc,
  allDetailers,
  colors,
  onEdit,
  onDelete,
}: {
  loc: ServiceLocation;
  allDetailers: Detailer[];
  colors: ReturnType<typeof useColors>;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const assignedNames = loc.detailers
    .map((d) => allDetailers.find((e) => e.employeeId === d.employeeId)?.fullName ?? d.employeeId)
    .join(", ");
  const [showSubs, setShowSubs] = useState(false);
  const [newSubCity, setNewSubCity] = useState("");
  const utils = trpc.useUtils();

  const subsQuery = trpc.subsidiaryCities.list.useQuery(
    { locationId: loc.locationId },
    { enabled: showSubs }
  );
  const addMutation = trpc.subsidiaryCities.add.useMutation({
    onSuccess: () => { subsQuery.refetch(); setNewSubCity(""); },
  });
  const removeMutation = trpc.subsidiaryCities.remove.useMutation({
    onSuccess: () => subsQuery.refetch(),
  });

  const subs = subsQuery.data ?? [];

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <Text style={[styles.cardName, { color: colors.foreground }]}>{loc.name}</Text>
          <View style={[styles.statusBadge, { backgroundColor: loc.isActive ? "#22C55E22" : "#EF444422" }]}>
            <Text style={[styles.statusText, { color: loc.isActive ? "#22C55E" : "#EF4444" }]}>
              {loc.isActive ? "Active" : "Inactive"}
            </Text>
          </View>
        </View>
        <Text style={[styles.cardSlug, { color: colors.muted }]}>{loc.state} · /{loc.slug}</Text>
      </View>

      <View style={styles.cardBody}>
        {loc.detailers.length > 0 && (
          <InfoRow label="Detailers" value={assignedNames} colors={colors} />
        )}
        {loc.zapierWebhookUrl && (
          <InfoRow label="Zapier" value={loc.zapierWebhookUrl} colors={colors} truncate />
        )}
        {loc.bookingUrl && (
          <InfoRow label="Booking URL" value={loc.bookingUrl} colors={colors} truncate />
        )}
        {loc.availableDays && (
          <InfoRow label="Days" value={loc.availableDays.toUpperCase()} colors={colors} />
        )}
        <InfoRow label="Hours" value={`${loc.startHour}:00 – ${loc.endHour}:00`} colors={colors} />
        <InfoRow label="Slot" value={`${loc.slotDurationMinutes} min`} colors={colors} />
      </View>

      {/* ── Subsidiary Cities ── */}
      <TouchableOpacity
        onPress={() => setShowSubs((v) => !v)}
        style={[styles.subsToggle, { borderTopColor: colors.border, borderBottomColor: showSubs ? colors.border : "transparent" }]}
        activeOpacity={0.8}
      >
        <Text style={[styles.subsToggleText, { color: colors.primary }]}>
          {showSubs ? "▾" : "▸"} Surrounding Areas {subs.length > 0 ? `(${subs.length})` : ""}
        </Text>
      </TouchableOpacity>

      {showSubs && (
        <View style={[styles.subsPanel, { borderBottomColor: colors.border }]}>
          {subsQuery.isLoading ? (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 8 }} />
          ) : subs.length === 0 ? (
            <Text style={[styles.subsEmpty, { color: colors.muted }]}>No surrounding areas added yet.</Text>
          ) : (
            subs.map((s) => (
              <View key={s.id} style={[styles.subRow, { borderColor: colors.border }]}>
                <Text style={[styles.subName, { color: colors.foreground }]}>{s.name}</Text>
                <TouchableOpacity
                  onPress={() => removeMutation.mutate({ id: s.id })}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  disabled={removeMutation.isPending}
                >
                  <Text style={styles.subRemove}>✕</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
          <View style={styles.subAddRow}>
            <TextInput
              value={newSubCity}
              onChangeText={setNewSubCity}
              placeholder="Add city (e.g. Gulf Breeze)"
              placeholderTextColor={colors.muted}
              style={[styles.subInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
              returnKeyType="done"
              onSubmitEditing={() => {
                if (newSubCity.trim()) addMutation.mutate({ locationId: loc.locationId, name: newSubCity.trim() });
              }}
            />
            <TouchableOpacity
              onPress={() => {
                if (newSubCity.trim()) addMutation.mutate({ locationId: loc.locationId, name: newSubCity.trim() });
              }}
              disabled={!newSubCity.trim() || addMutation.isPending}
              style={[styles.subAddBtn, { backgroundColor: colors.primary, opacity: !newSubCity.trim() ? 0.5 : 1 }]}
            >
              <Text style={styles.subAddBtnText}>{addMutation.isPending ? "…" : "+"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={[styles.cardActions, { borderTopColor: colors.border }]}>
        <TouchableOpacity onPress={onEdit} style={[styles.actionBtn, { backgroundColor: colors.primary + "22" }]}>
          <Text style={[styles.actionBtnText, { color: colors.primary }]}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onDelete} style={[styles.actionBtn, { backgroundColor: "#EF444422" }]}>
          <Text style={[styles.actionBtnText, { color: "#EF4444" }]}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function InfoRow({ label, value, colors, truncate }: { label: string; value: string; colors: ReturnType<typeof useColors>; truncate?: boolean }) {
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: colors.muted }]}>{label}:</Text>
      <Text style={[styles.infoValue, { color: colors.foreground }]} numberOfLines={truncate ? 1 : undefined} ellipsizeMode="tail">
        {value}
      </Text>
    </View>
  );
}

// ─── Location Form Modal ──────────────────────────────────────────────────────
function LocationForm({
  form,
  setForm,
  editingId,
  allDetailers,
  colors,
  isSaving,
  onNameChange,
  onToggleDay,
  onToggleDetailer,
  onSave,
  onClose,
}: {
  form: ReturnType<typeof emptyForm>;
  setForm: React.Dispatch<React.SetStateAction<ReturnType<typeof emptyForm>>>;
  editingId: string | null;
  allDetailers: Detailer[];
  colors: ReturnType<typeof useColors>;
  isSaving: boolean;
  onNameChange: (val: string) => void;
  onToggleDay: (key: string) => void;
  onToggleDetailer: (empId: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
      {/* Modal Header */}
      <View style={[styles.modalHeader, { paddingTop: insets.top + 8, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={[styles.modalCancel, { color: colors.muted }]}>Cancel</Text>
        </TouchableOpacity>
        <Text style={[styles.modalTitle, { color: colors.foreground }]}>
          {editingId ? "Edit Location" : "Add New Location"}
        </Text>
        <TouchableOpacity onPress={onSave} disabled={isSaving} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          {isSaving ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <Text style={[styles.modalSave, { color: colors.primary }]}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        {/* Basic Info */}
        <SectionTitle title="Basic Info" colors={colors} />

        <FieldLabel label="Location Name *" colors={colors} />
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
          value={form.name}
          onChangeText={onNameChange}
          placeholder="e.g. Pensacola"
          placeholderTextColor={colors.muted}
        />

        <FieldLabel label="Slug (auto-generated)" colors={colors} />
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
          value={form.slug}
          onChangeText={(v) => setForm((f) => ({ ...f, slug: v }))}
          placeholder="e.g. pensacola"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
        />

        <View style={styles.row}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <FieldLabel label="State" colors={colors} />
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              value={form.state}
              onChangeText={(v) => setForm((f) => ({ ...f, state: v }))}
              placeholder="FL"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              maxLength={2}
            />
          </View>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <FieldLabel label="Sort Order" colors={colors} />
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              value={String(form.sortOrder)}
              onChangeText={(v) => setForm((f) => ({ ...f, sortOrder: parseInt(v) || 0 }))}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={colors.muted}
            />
          </View>
        </View>

        <View style={styles.switchRow}>
          <Text style={[styles.switchLabel, { color: colors.foreground }]}>Active</Text>
          <Switch
            value={form.isActive}
            onValueChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="#fff"
          />
        </View>

        {/* URLs */}
        <SectionTitle title="URLs & Webhooks" colors={colors} />

        <FieldLabel label="Zapier Webhook URL" colors={colors} />
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
          value={form.zapierWebhookUrl}
          onChangeText={(v) => setForm((f) => ({ ...f, zapierWebhookUrl: v }))}
          placeholder="https://hooks.zapier.com/..."
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          keyboardType="url"
        />

        <FieldLabel label="Thank You Page URL" colors={colors} />
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
          value={form.thankYouPageUrl}
          onChangeText={(v) => setForm((f) => ({ ...f, thankYouPageUrl: v }))}
          placeholder="https://luxurywashonwheels.com/[city]/thank-you-booking/"
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          keyboardType="url"
        />

        <FieldLabel label="Booking URL" colors={colors} />
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
          value={form.bookingUrl}
          onChangeText={(v) => setForm((f) => ({ ...f, bookingUrl: v }))}
          placeholder="https://..."
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          keyboardType="url"
        />

        {/* Schedule */}
        <SectionTitle title="Schedule" colors={colors} />

        <FieldLabel label="Available Days" colors={colors} />
        <View style={styles.daysRow}>
          {DAYS.map((day, i) => {
            const key = DAY_KEYS[i];
            const active = form.days[key as keyof DaysRecord];
            return (
              <TouchableOpacity
                key={key}
                onPress={() => onToggleDay(key)}
                style={[styles.dayBtn, { backgroundColor: active ? colors.primary : colors.surface, borderColor: active ? colors.primary : colors.border }]}
              >
                <Text style={[styles.dayBtnText, { color: active ? "#fff" : colors.muted }]}>{day}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.row}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <FieldLabel label="Start Hour (24h)" colors={colors} />
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              value={String(form.startHour)}
              onChangeText={(v) => setForm((f) => ({ ...f, startHour: parseInt(v) || 8 }))}
              keyboardType="numeric"
              placeholder="8"
              placeholderTextColor={colors.muted}
            />
          </View>
          <View style={{ flex: 1, marginHorizontal: 8 }}>
            <FieldLabel label="End Hour (24h)" colors={colors} />
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              value={String(form.endHour)}
              onChangeText={(v) => setForm((f) => ({ ...f, endHour: parseInt(v) || 18 }))}
              keyboardType="numeric"
              placeholder="18"
              placeholderTextColor={colors.muted}
            />
          </View>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <FieldLabel label="Slot (min)" colors={colors} />
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              value={String(form.slotDurationMinutes)}
              onChangeText={(v) => setForm((f) => ({ ...f, slotDurationMinutes: parseInt(v) || 60 }))}
              keyboardType="numeric"
              placeholder="60"
              placeholderTextColor={colors.muted}
            />
          </View>
        </View>

        {/* Geography */}
        <SectionTitle title="Geography" colors={colors} />

        <View style={styles.row}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <FieldLabel label="Latitude" colors={colors} />
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              value={form.latitude}
              onChangeText={(v) => setForm((f) => ({ ...f, latitude: v }))}
              placeholder="30.4213"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
            />
          </View>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <FieldLabel label="Longitude" colors={colors} />
            <TextInput
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
              value={form.longitude}
              onChangeText={(v) => setForm((f) => ({ ...f, longitude: v }))}
              placeholder="-87.2169"
              placeholderTextColor={colors.muted}
              keyboardType="decimal-pad"
            />
          </View>
        </View>

        <FieldLabel label="Radius (meters)" colors={colors} />
        <TextInput
          style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
          value={String(form.radiusMeters)}
          onChangeText={(v) => setForm((f) => ({ ...f, radiusMeters: parseInt(v) || 40000 }))}
          keyboardType="numeric"
          placeholder="40000"
          placeholderTextColor={colors.muted}
        />

        {/* Assign Detailers */}
        <SectionTitle title="Assign Detailers" colors={colors} />
        {allDetailers.length === 0 ? (
          <Text style={[styles.noDetailers, { color: colors.muted }]}>No detailers found.</Text>
        ) : (
          allDetailers.map((d) => {
            const selected = form.detailerIds.includes(d.employeeId);
            return (
              <TouchableOpacity
                key={d.employeeId}
                onPress={() => onToggleDetailer(d.employeeId)}
                style={[styles.detailerRow, { backgroundColor: selected ? colors.primary + "22" : colors.surface, borderColor: selected ? colors.primary : colors.border }]}
              >
                <View style={[styles.checkbox, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary : "transparent" }]}>
                  {selected && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.detailerName, { color: colors.foreground }]}>{d.fullName}</Text>
                  {d.city && <Text style={[styles.detailerCity, { color: colors.muted }]}>{d.city}</Text>}
                </View>
              </TouchableOpacity>
            );
          })
        )}

        {/* Notes */}
        <SectionTitle title="Notes" colors={colors} />
        <TextInput
          style={[styles.input, styles.textArea, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.foreground }]}
          value={form.notes}
          onChangeText={(v) => setForm((f) => ({ ...f, notes: v }))}
          placeholder="Internal notes about this location..."
          placeholderTextColor={colors.muted}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />

        {/* Save Button */}
        <TouchableOpacity
          onPress={onSave}
          disabled={isSaving}
          style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: isSaving ? 0.6 : 1 }]}
        >
          {isSaving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.saveBtnText}>{editingId ? "Save Changes" : "Create Location"}</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────
function SectionTitle({ title, colors }: { title: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{title}</Text>
    </View>
  );
}

function FieldLabel({ label, colors }: { label: string; colors: ReturnType<typeof useColors> }) {
  return <Text style={[styles.fieldLabel, { color: colors.muted }]}>{label}</Text>;
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  emptyText: { fontSize: 16 },
  emptyAddBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { paddingRight: 12 },
  backArrow: { fontSize: 32, lineHeight: 36, fontWeight: "300" },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: "700" },
  addBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  addBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },

  // Card
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  cardHeader: { padding: 14, paddingBottom: 8 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  cardName: { fontSize: 17, fontWeight: "700", flex: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  statusText: { fontSize: 11, fontWeight: "600" },
  cardSlug: { fontSize: 12 },
  cardBody: { paddingHorizontal: 14, paddingBottom: 8 },
  infoRow: { flexDirection: "row", gap: 6, marginTop: 4 },
  infoLabel: { fontSize: 12, minWidth: 72 },
  infoValue: { fontSize: 12, flex: 1 },
  cardActions: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    padding: 10,
    gap: 10,
  },
  actionBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  actionBtnText: { fontSize: 14, fontWeight: "600" },

  // Modal
  modalContainer: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalCancel: { fontSize: 16 },
  modalTitle: { fontSize: 17, fontWeight: "700" },
  modalSave: { fontSize: 16, fontWeight: "700" },

  // Form
  sectionTitleRow: { marginTop: 24, marginBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#33333333", paddingBottom: 4 },
  sectionTitle: { fontSize: 15, fontWeight: "700", letterSpacing: 0.3 },
  fieldLabel: { fontSize: 12, fontWeight: "600", marginBottom: 4, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  textArea: { minHeight: 90, paddingTop: 10 },
  row: { flexDirection: "row", marginTop: 0 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16 },
  switchLabel: { fontSize: 15, fontWeight: "500" },

  // Days
  daysRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 4 },
  dayBtn: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
  dayBtnText: { fontSize: 13, fontWeight: "600" },

  // Detailers
  noDetailers: { fontSize: 14, marginTop: 8 },
  detailerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkmark: { color: "#fff", fontSize: 13, fontWeight: "700" },
  detailerName: { fontSize: 15, fontWeight: "500" },
  detailerCity: { fontSize: 12, marginTop: 1 },

  // Subsidiary cities
  subsToggle: { paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  subsToggleText: { fontSize: 13, fontWeight: "600" },
  subsPanel: { paddingHorizontal: 14, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  subsEmpty: { fontSize: 13, marginTop: 8, marginBottom: 4 },
  subRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth },
  subName: { fontSize: 14, flex: 1 },
  subRemove: { fontSize: 14, color: "#EF4444", fontWeight: "700", paddingLeft: 8 },
  subAddRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  subInput: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  subAddBtn: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  subAddBtnText: { color: "#fff", fontSize: 20, fontWeight: "700", lineHeight: 22 },

  // Save button
  saveBtn: {
    marginTop: 32,
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: "center",
  },
  saveBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
