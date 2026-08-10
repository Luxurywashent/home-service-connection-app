import { useState, useEffect, useCallback, useRef } from "react";
import {
  ScrollView, Text, View, ActivityIndicator, TouchableOpacity,
  Alert, TextInput, Modal, Platform, RefreshControl, Image,
} from "react-native";
import MapView, { Marker, PROVIDER_GOOGLE } from "react-native-maps";
import * as Location from "expo-location";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenContainer } from "@/components/screen-container";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import * as Haptics from "expo-haptics";

/** Returns today's date as YYYY-MM-DD in local time */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

type OutreachType = "door_hangers" | "business_cards" | "yard_signs" | "table_toppers";

const TYPE_CONFIG: Record<OutreachType, { label: string; emoji: string; color: string }> = {
  door_hangers: { label: "Door Hanger", emoji: "🚪", color: "#2563EB" },
  business_cards: { label: "Business Card", emoji: "💼", color: "#16A34A" },
  yard_signs: { label: "Yard Sign", emoji: "🏷️", color: "#EA580C" },
  table_toppers: { label: "Table Topper", emoji: "📋", color: "#9333EA" },
};

interface Entry {
  id: number;
  entryId: string;
  employeeId: string;
  date: string;
  address: string;
  city: string;
  outreachType: OutreachType;
  quantityDistributed: number;
  notes: string | null;
  photoUrls?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

interface Goals {
  goalId: string;
  dailyDoorHangerGoal?: number;
  dailyBusinessCardGoal?: number;
  dailyYardSignGoal?: number;
  dailyTableTopperGoal?: number;
}

interface EditModalProps {
  entry: Entry | null;
  visible: boolean;
  onClose: () => void;
  onSave: (entryId: string, updates: Partial<Entry>) => Promise<void>;
  colors: any;
}

function EditEntryModal({ entry, visible, onClose, onSave, colors }: EditModalProps) {
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [outreachType, setOutreachType] = useState<OutreachType>("door_hangers");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (entry) {
      setAddress(entry.address || "");
      setCity(entry.city || "");
      setOutreachType(entry.outreachType);
      setNotes(entry.notes || "");
    }
  }, [entry]);

  const handleSave = async () => {
    if (!entry) return;
    setSaving(true);
    try {
      await onSave(entry.entryId, { address, city, outreachType, notes: notes || null });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
        <View
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            padding: 20,
            paddingBottom: 40,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>Edit Entry</Text>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ fontSize: 16, color: colors.muted }}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Type selector */}
          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase" }}>
            Type
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {(Object.entries(TYPE_CONFIG) as [OutreachType, typeof TYPE_CONFIG[OutreachType]][]).map(([type, cfg]) => (
              <TouchableOpacity
                key={type}
                onPress={() => setOutreachType(type)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 10,
                  backgroundColor: outreachType === type ? cfg.color : colors.surface,
                  borderWidth: 1,
                  borderColor: outreachType === type ? cfg.color : colors.border,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "600", color: outreachType === type ? "#fff" : colors.foreground }}>
                  {cfg.emoji} {cfg.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Address */}
          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase" }}>
            Address
          </Text>
          <AddressAutocomplete
            value={address}
            onChangeText={setAddress}
            onSelectAddress={(addr) => {
              setAddress(addr);
              // Auto-fill city from suggestion
              const parts = addr.split(",").map((p: string) => p.trim());
              if (parts.length >= 2) setCity(parts[1]);
            }}
            placeholder="Street address"
            style={{ marginBottom: 12, zIndex: 999 }}
          />

          {/* City */}
          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase" }}>
            City
          </Text>
          <TextInput
            value={city}
            onChangeText={setCity}
            placeholder="City"
            placeholderTextColor={colors.muted}
            style={{
              backgroundColor: colors.surface,
              borderRadius: 10,
              padding: 12,
              color: colors.foreground,
              borderWidth: 1,
              borderColor: colors.border,
              marginBottom: 12,
              fontSize: 14,
            }}
          />

          {/* Notes */}
          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase" }}>
            Notes (optional)
          </Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Add notes..."
            placeholderTextColor={colors.muted}
            multiline
            numberOfLines={3}
            style={{
              backgroundColor: colors.surface,
              borderRadius: 10,
              padding: 12,
              color: colors.foreground,
              borderWidth: 1,
              borderColor: colors.border,
              marginBottom: 20,
              fontSize: 14,
              minHeight: 72,
              textAlignVertical: "top",
            }}
          />

          <TouchableOpacity
            onPress={handleSave}
            disabled={saving}
            style={{
              backgroundColor: colors.primary,
              borderRadius: 12,
              padding: 16,
              alignItems: "center",
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Save Changes</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

export default function AdminDoorHangersScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { employee } = useEmployeeAuth();
  const [goals, setGoals] = useState<Goals | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [editingGoals, setEditingGoals] = useState(false);
  const [newGoals, setNewGoals] = useState({ doorHangers: 50, businessCards: 20, yardSigns: 2, tableToppers: 5 });
  const [activeTab, setActiveTab] = useState<"overview" | "entries" | "map" | "history">("overview");
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [dateFilter, setDateFilter] = useState<"today" | "week" | "month" | "all">("today");
  const today = todayLocal();

  const dateFrom = (() => {
    if (dateFilter === "today") return today;
    if (dateFilter === "week") {
      const d = new Date(today + "T12:00:00");
      const day = d.getDay();
      const mon = new Date(d);
      mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
      return mon.toISOString().slice(0, 10);
    }
    if (dateFilter === "month") return today.slice(0, 7) + "-01";
    return undefined;
  })();
  const dateTo = dateFilter === "all" ? undefined : today;

  const getStats = trpc.doorHanger.getStats.useQuery({ dateFrom, dateTo });
  const getGoals = trpc.doorHanger.getGoals.useQuery({} as any);
  const getAllEntries = trpc.doorHanger.getAllEntries.useQuery({ dateFrom, dateTo });
  const updateGoals = trpc.doorHanger.updateGoals.useMutation();
  const deleteEntry = trpc.doorHanger.deleteEntry.useMutation();
  const updateEntry = trpc.doorHanger.updateEntry.useMutation();

  // Use stable primitive values as deps to avoid re-firing on every tRPC object re-creation
  const goalsDataId = getGoals.data?.goalId ?? null;
  const goalsLoading = getGoals.isLoading;
  const statsLoading = getStats.isLoading;
  useEffect(() => {
    if (!statsLoading && !goalsLoading) {
      setIsLoading(false);
      if (getGoals.data) {
        setGoals(getGoals.data);
        setNewGoals({
          doorHangers: getGoals.data.dailyDoorHangerGoal || 50,
          businessCards: getGoals.data.dailyBusinessCardGoal || 20,
          yardSigns: getGoals.data.dailyYardSignGoal || 2,
          tableToppers: getGoals.data.dailyTableTopperGoal || 5,
        });
      } else {
        setGoals({ goalId: "default", dailyDoorHangerGoal: 50, dailyBusinessCardGoal: 20, dailyYardSignGoal: 2, dailyTableTopperGoal: 5 });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statsLoading, goalsLoading, goalsDataId]);  // stable primitives only

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([getStats.refetch(), getGoals.refetch(), getAllEntries.refetch()]);
    setRefreshing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);  // stable — refetch refs don't change

  const handleSaveGoals = async () => {
    try {
      await updateGoals.mutateAsync({
        dailyDoorHangerGoal: newGoals.doorHangers,
        dailyBusinessCardGoal: newGoals.businessCards,
        dailyYardSignGoal: newGoals.yardSigns,
        dailyTableTopperGoal: newGoals.tableToppers,
        updatedBy: employee?.employeeId || "admin",
      });
      if (goals) {
        setGoals({
          goalId: goals.goalId,
          dailyDoorHangerGoal: newGoals.doorHangers,
          dailyBusinessCardGoal: newGoals.businessCards,
          dailyYardSignGoal: newGoals.yardSigns,
          dailyTableTopperGoal: newGoals.tableToppers,
        });
      }
      setEditingGoals(false);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Success", "Daily goals updated!");
    } catch {
      Alert.alert("Error", "Failed to update goals");
    }
  };

  const handleDeleteEntry = (entry: Entry) => {
    Alert.alert(
      "Delete Entry",
      `Delete this ${TYPE_CONFIG[entry.outreachType]?.label || "entry"} at ${entry.address}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteEntry.mutateAsync({ entryId: entry.entryId });
              await getAllEntries.refetch();
              await getStats.refetch();
              if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } catch {
              Alert.alert("Error", "Failed to delete entry");
            }
          },
        },
      ]
    );
  };

  const handleSaveEntry = async (entryId: string, updates: Partial<Entry>) => {
    await updateEntry.mutateAsync({
      entryId,
      address: updates.address,
      city: updates.city,
      outreachType: updates.outreachType,
      notes: updates.notes,
    });
    await getAllEntries.refetch();
    await getStats.refetch();
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  // ── Map state (must be above early return to satisfy Rules of Hooks) ──
  const mapRef = useRef<MapView>(null);
  const [mapEntries, setMapEntries] = useState<Array<{ id: string; latitude: number; longitude: number; address: string; outreachType: OutreachType; employeeId: string; createdAt: string; photoUrls?: string | null }>>([]);
  const [selectedMapEntry, setSelectedMapEntry] = useState<{ id: string; latitude: number; longitude: number; address: string; outreachType: OutreachType; employeeId: string; createdAt: string; photoUrls?: string | null } | null>(null);
  const [userRegion, setUserRegion] = useState({ latitude: 30.4213, longitude: -87.2169, latitudeDelta: 0.08, longitudeDelta: 0.08 });
  const hasFittedRef = useRef(false);

  const getProgressPercent = (actual: number, goal: number) => Math.min(Math.round((actual / Math.max(goal, 1)) * 100), 100);
  const getProgressColor = (percent: number) => {
    if (percent >= 100) return colors.success;
    if (percent >= 75) return "#FBBF24";
    return colors.error;
  };

  const entries = (getAllEntries.data || []) as Entry[];

  // Map entries = all entries that have GPS coords
  // Use getAllEntries.data directly (stable reference from tRPC cache) to avoid
  // re-running the effect every render due to derived array identity changes.
  useEffect(() => {
    const rawEntries = (getAllEntries.data || []) as Entry[];
    const mapped = rawEntries
      .filter((e) => e.latitude && e.longitude)
      .map((e) => ({
        id: String(e.id),
        latitude: Number(e.latitude),
        longitude: Number(e.longitude),
        address: e.address || "Unknown",
        outreachType: e.outreachType,
        employeeId: e.employeeId,
        createdAt: e.date,
        photoUrls: (e as any).photoUrls ?? null,
      }));
    setMapEntries(mapped);
    if (mapped.length > 0 && !hasFittedRef.current && activeTab === "map") {
      hasFittedRef.current = true;
      setTimeout(() => {
        if (mapRef.current && mapped.length > 0) {
          mapRef.current.fitToCoordinates(
            mapped.map((e) => ({ latitude: e.latitude, longitude: e.longitude })),
            { edgePadding: { top: 80, right: 60, bottom: 120, left: 60 }, animated: true }
          );
        }
      }, 600);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getAllEntries.data, activeTab]);  // depend on the cache reference, not derived array

  // Get user location for default map center
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === "granted") {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setUserRegion({ latitude: loc.coords.latitude, longitude: loc.coords.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 });
        }
      } catch {}
    })();
  }, []);

  if (isLoading) {
    return (
      <ScreenContainer edges={["left", "right"]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </ScreenContainer>
    );
  }

  const stats = getStats.data as any;

  const doorHangerGoal = goals?.dailyDoorHangerGoal || 50;
  const businessCardGoal = goals?.dailyBusinessCardGoal || 20;
  const yardSignGoal = goals?.dailyYardSignGoal || 2;
  const tableTopperGoal = goals?.dailyTableTopperGoal || 5;

  const doorHangerPct = getProgressPercent(stats?.doorHangers || 0, doorHangerGoal);
  const businessCardPct = getProgressPercent(stats?.businessCards || 0, businessCardGoal);
  const yardSignPct = getProgressPercent(stats?.yardSigns || 0, yardSignGoal);
  const tableTopperPct = getProgressPercent(stats?.tableToppers || 0, tableTopperGoal);

  const TABS: { key: "overview" | "entries" | "map" | "history"; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "entries", label: `Entries (${entries.length})` },
    { key: "map", label: "Map" },
    { key: "history", label: "History" },
  ];

  return (
    <ScreenContainer edges={["left", "right"]} className="px-0">
      {/* Edit Entry Modal */}
      <EditEntryModal
        entry={editingEntry}
        visible={!!editingEntry}
        onClose={() => setEditingEntry(null)}
        onSave={handleSaveEntry}
        colors={colors}
      />

      {/* Tab bar */}
      <View style={{ flexDirection: "row", backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => setActiveTab(tab.key)}
            style={{
              flex: 1,
              paddingVertical: 14,
              alignItems: "center",
              borderBottomWidth: 2,
              borderBottomColor: activeTab === tab.key ? colors.primary : "transparent",
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: "700", color: activeTab === tab.key ? colors.primary : colors.muted }}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── MAP TAB (full-screen, outside ScrollView) ── */}
      {activeTab === "map" && (
        <View style={{ flex: 1 }}>
          <MapView
            ref={mapRef}
            provider={Platform.OS !== "web" ? PROVIDER_GOOGLE : undefined}
            style={{ flex: 1 }}
            initialRegion={mapEntries.length > 0 ? {
              latitude: mapEntries.reduce((s, e) => s + e.latitude, 0) / mapEntries.length,
              longitude: mapEntries.reduce((s, e) => s + e.longitude, 0) / mapEntries.length,
              latitudeDelta: 0.08,
              longitudeDelta: 0.08,
            } : userRegion}
            showsUserLocation
            showsMyLocationButton
            onPress={() => setSelectedMapEntry(null)}
          >
            {mapEntries.map((entry) => {
              const cfg = TYPE_CONFIG[entry.outreachType] || TYPE_CONFIG.door_hangers;
              return (
                <Marker
                  key={entry.id}
                  coordinate={{ latitude: entry.latitude, longitude: entry.longitude }}
                  pinColor={cfg.color}
                  onPress={(e) => { e.stopPropagation?.(); setSelectedMapEntry(entry); }}
                />
              );
            })}
          </MapView>

          {/* Header overlay */}
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.55)", paddingTop: 16, paddingHorizontal: 16, paddingBottom: 12 }}>
            <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700" }}>🗺️ Team Distribution Map</Text>
            <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 12, marginTop: 2 }}>{mapEntries.length} pinned {mapEntries.length === 1 ? "entry" : "entries"} · {entries.length - mapEntries.length} without GPS</Text>
          </View>

          {/* Fit pins button */}
          {mapEntries.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                if (mapRef.current) {
                  mapRef.current.fitToCoordinates(
                    mapEntries.map((e) => ({ latitude: e.latitude, longitude: e.longitude })),
                    { edgePadding: { top: 80, right: 60, bottom: 120, left: 60 }, animated: true }
                  );
                }
              }}
              style={{ position: "absolute", top: 72, left: 12, backgroundColor: "rgba(255,255,255,0.93)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }}
            >
              <Text style={{ fontSize: 13, color: "#333", fontWeight: "600" }}>📍 Fit All Pins</Text>
            </TouchableOpacity>
          )}

          {/* Empty state */}
          {mapEntries.length === 0 && (
            <View style={{ position: "absolute", bottom: 120, left: 24, right: 24, backgroundColor: "rgba(255,255,255,0.95)", borderRadius: 14, padding: 20, alignItems: "center" }}>
              <Text style={{ fontSize: 15, fontWeight: "600", color: "#333", marginBottom: 6 }}>No GPS entries yet</Text>
              <Text style={{ fontSize: 13, color: "#666", textAlign: "center" }}>Entries logged with location will appear as pins here.</Text>
            </View>
          )}

          {/* Bottom sheet for selected pin */}
          {selectedMapEntry && (
            <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, shadowColor: "#000", shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 8, padding: 16, paddingBottom: Platform.OS === "android" ? Math.max(insets.bottom + 16, 32) : 32 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <View style={{ backgroundColor: TYPE_CONFIG[selectedMapEntry.outreachType]?.color || "#2563EB", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                      <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>{TYPE_CONFIG[selectedMapEntry.outreachType]?.emoji} {TYPE_CONFIG[selectedMapEntry.outreachType]?.label}</Text>
                    </View>
                  </View>
                  <Text style={{ fontSize: 14, color: colors.foreground, fontWeight: "600" }} numberOfLines={2}>📍 {selectedMapEntry.address}</Text>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 3 }}>Rep ID: {selectedMapEntry.employeeId} · {formatDate(selectedMapEntry.createdAt)}</Text>
                </View>
                <TouchableOpacity onPress={() => setSelectedMapEntry(null)} style={{ marginLeft: 12, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.border, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "700" }}>✕</Text>
                </TouchableOpacity>
              </View>
              {(() => {
                let photos: string[] = [];
                try { photos = selectedMapEntry.photoUrls ? JSON.parse(selectedMapEntry.photoUrls) : []; } catch {}
                if (photos.length === 0) return null;
                return (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ marginTop: 12 }}
                    contentContainerStyle={{ gap: 8, paddingRight: 4 }}
                  >
                    {photos.map((uri: string, idx: number) => (
                      <Image
                        key={idx}
                        source={{ uri }}
                        style={{ width: 160, height: 160, borderRadius: 12, backgroundColor: colors.border }}
                        resizeMode="cover"
                      />
                    ))}
                  </ScrollView>
                );
              })()}
            </View>
          )}
        </View>
      )}

      <ScrollView
        style={{ display: activeTab === "map" ? "none" : "flex" }}
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* ── OVERVIEW TAB ── */}
        {activeTab === "overview" && (
          <View style={{ padding: 16 }}>
            {/* Header */}
            <View
              style={{
                backgroundColor: colors.primary,
                borderRadius: 16,
                padding: 20,
                marginBottom: 16,
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <View>
                  <Text style={{ fontSize: 22, fontWeight: "800", color: "#fff" }}>🚪 Door Hangers</Text>
                  <Text style={{ fontSize: 13, color: "rgba(255,255,255,0.75)", marginTop: 4 }}>
                    Admin overview & goal management
                  </Text>
                </View>
                {!editingGoals && (
                  <TouchableOpacity
                    onPress={() => setEditingGoals(true)}
                    style={{
                      backgroundColor: "rgba(255,255,255,0.2)",
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                    }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>Edit Goals</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* Edit Goals Form */}
            {editingGoals && (
              <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground, marginBottom: 16 }}>Update Daily Goals</Text>

                {[
                  { key: "doorHangers" as const, label: "🚪 Door Hangers", step: 10 },
                  { key: "businessCards" as const, label: "💼 Business Cards", step: 5 },
                  { key: "yardSigns" as const, label: "🏷️ Yard Signs", step: 1 },
                  { key: "tableToppers" as const, label: "📋 Table Toppers", step: 1 },
                ].map(({ key, label, step }) => (
                  <View key={key} style={{ marginBottom: 12 }}>
                    <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 6 }}>{label}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.background, borderRadius: 10, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
                      <TouchableOpacity
                        onPress={() => setNewGoals(g => ({ ...g, [key]: Math.max(1, g[key] - step) }))}
                        style={{ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.surface }}
                      >
                        <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 18 }}>−</Text>
                      </TouchableOpacity>
                      <Text style={{ flex: 1, textAlign: "center", color: colors.foreground, fontWeight: "700", fontSize: 16 }}>
                        {newGoals[key]}
                      </Text>
                      <TouchableOpacity
                        onPress={() => setNewGoals(g => ({ ...g, [key]: g[key] + step }))}
                        style={{ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.surface }}
                      >
                        <Text style={{ color: colors.primary, fontWeight: "800", fontSize: 18 }}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}

                <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                  <TouchableOpacity
                    onPress={handleSaveGoals}
                    style={{ flex: 1, backgroundColor: colors.success, borderRadius: 10, padding: 14, alignItems: "center" }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "700" }}>Save Goals</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setEditingGoals(false)}
                    style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 10, padding: 14, alignItems: "center", borderWidth: 1, borderColor: colors.border }}
                  >
                    <Text style={{ color: colors.muted, fontWeight: "700" }}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Progress Cards */}
            {[
              { label: "Door Hangers", emoji: "🚪", count: stats?.doorHangers || 0, goal: doorHangerGoal, pct: doorHangerPct, color: "#2563EB" },
              { label: "Business Cards", emoji: "💼", count: stats?.businessCards || 0, goal: businessCardGoal, pct: businessCardPct, color: "#16A34A" },
              { label: "Yard Signs", emoji: "🏷️", count: stats?.yardSigns || 0, goal: yardSignGoal, pct: yardSignPct, color: "#EA580C" },
              { label: "Table Toppers", emoji: "📋", count: stats?.tableToppers || 0, goal: tableTopperGoal, pct: tableTopperPct, color: "#9333EA" },
            ].map(({ label, emoji, count, goal, pct, color }) => (
              <View
                key={label}
                style={{
                  backgroundColor: colors.surface,
                  borderRadius: 14,
                  padding: 16,
                  marginBottom: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderLeftWidth: 4,
                  borderLeftColor: color,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{emoji} {label}</Text>
                  <Text style={{ fontSize: 14, fontWeight: "800", color: getProgressColor(pct) }}>{pct}%</Text>
                </View>
                <View style={{ height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: "hidden", marginBottom: 6 }}>
                  <View style={{ height: "100%", width: `${pct}%`, backgroundColor: getProgressColor(pct), borderRadius: 4 }} />
                </View>
                <Text style={{ fontSize: 12, color: colors.muted }}>{count} of {goal}</Text>
              </View>
            ))}

            {/* Total */}
            <View style={{ backgroundColor: colors.primary + "15", borderRadius: 14, padding: 16, alignItems: "center", borderWidth: 1, borderColor: colors.primary + "30", marginTop: 4 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>Total Entries</Text>
              <Text style={{ fontSize: 44, fontWeight: "900", color: colors.primary, marginTop: 4 }}>{entries.length}</Text>
            </View>
          </View>
        )}

        {/* ── HISTORY TAB ── */}
        {activeTab === "history" && (
          <View style={{ padding: 16 }}>
            {/* Date filter */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: "row", gap: 8, paddingRight: 8 }}>
                {([["today", "Today"], ["week", "This Week"], ["month", "This Month"], ["all", "All Time"]] as const).map(([f, label]) => (
                  <TouchableOpacity
                    key={f}
                    onPress={() => setDateFilter(f)}
                    style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: dateFilter === f ? colors.primary : colors.surface, borderWidth: 1, borderColor: dateFilter === f ? colors.primary : colors.border }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: "600", color: dateFilter === f ? "#fff" : colors.muted }}>{label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* Totals summary */}
            <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 12, textTransform: "uppercase" }}>Total Logged</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {(Object.entries(TYPE_CONFIG) as [OutreachType, typeof TYPE_CONFIG[OutreachType]][]).map(([type, cfg]) => {
                  const count = entries.reduce((s, e) => s + (e.outreachType === type ? (e.quantityDistributed || 1) : 0), 0);
                  return (
                    <View key={type} style={{ flex: 1, minWidth: "45%", backgroundColor: colors.background, borderRadius: 10, padding: 12, borderLeftWidth: 3, borderLeftColor: cfg.color }}>
                      <Text style={{ fontSize: 12, color: colors.muted }}>{cfg.emoji} {cfg.label}</Text>
                      <Text style={{ fontSize: 22, fontWeight: "800", color: cfg.color, marginTop: 4 }}>{count}</Text>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* Entry list */}
            {getAllEntries.isLoading ? (
              <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
            ) : entries.length === 0 ? (
              <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 24, alignItems: "center", borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.muted, fontSize: 15, textAlign: "center" }}>No entries found.</Text>
              </View>
            ) : (
              entries.slice().reverse().map(entry => {
                const cfg = TYPE_CONFIG[entry.outreachType] || TYPE_CONFIG.door_hangers;
                return (
                  <View key={entry.entryId} style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4, borderLeftColor: cfg.color }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <View style={{ backgroundColor: cfg.color + "20", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                        <Text style={{ fontSize: 12, fontWeight: "700", color: cfg.color }}>{cfg.emoji} {cfg.label}</Text>
                      </View>
                      <Text style={{ fontSize: 11, color: colors.muted }}>{formatDate(entry.date)}</Text>
                    </View>
                    <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>📍 {entry.address || "No address"}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>Rep: {entry.employeeId} · {entry.city}</Text>
                    {entry.notes ? <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }} numberOfLines={1}>📝 {entry.notes}</Text> : null}
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* ── ENTRIES TAB ── */}
        {activeTab === "entries" && (
          <View style={{ padding: 16 }}>
            {/* Date filter */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: "row", gap: 8, paddingRight: 8 }}>
                {([["today", "Today"], ["week", "This Week"], ["month", "This Month"], ["all", "All Time"]] as const).map(([f, label]) => (
                  <TouchableOpacity
                    key={f}
                    onPress={() => setDateFilter(f)}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                      backgroundColor: dateFilter === f ? colors.primary : colors.surface,
                      borderWidth: 1,
                      borderColor: dateFilter === f ? colors.primary : colors.border,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: "600", color: dateFilter === f ? "#fff" : colors.muted }}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {getAllEntries.isLoading ? (
              <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
            ) : entries.length === 0 ? (
              <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 24, alignItems: "center", borderWidth: 1, borderColor: colors.border }}>
                <Text style={{ color: colors.muted, fontSize: 15, textAlign: "center" }}>
                  No entries found.
                </Text>
              </View>
            ) : (
              entries.slice().reverse().map(entry => {
                const cfg = TYPE_CONFIG[entry.outreachType] || TYPE_CONFIG.door_hangers;
                return (
                  <View
                    key={entry.entryId}
                    style={{
                      backgroundColor: colors.surface,
                      borderRadius: 14,
                      padding: 14,
                      marginBottom: 10,
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderLeftWidth: 4,
                      borderLeftColor: cfg.color,
                    }}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          <View style={{ backgroundColor: cfg.color + "20", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                            <Text style={{ fontSize: 12, fontWeight: "700", color: cfg.color }}>{cfg.emoji} {cfg.label}</Text>
                          </View>
                          <Text style={{ fontSize: 11, color: colors.muted }}>{formatDate(entry.date)}</Text>
                        </View>
                        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }} numberOfLines={1}>
                          📍 {entry.address || "No address"}
                        </Text>
                        <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                          {entry.city} · ID: {entry.employeeId}
                        </Text>
                        {entry.notes ? (
                          <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }} numberOfLines={1}>
                            📝 {entry.notes}
                          </Text>
                        ) : null}
                      </View>

                      {/* Action buttons */}
                      <View style={{ flexDirection: "row", gap: 8, marginLeft: 10 }}>
                        <TouchableOpacity
                          onPress={() => setEditingEntry(entry)}
                          style={{
                            backgroundColor: colors.primary + "20",
                            borderRadius: 8,
                            paddingHorizontal: 10,
                            paddingVertical: 8,
                          }}
                        >
                          <Text style={{ fontSize: 13, color: colors.primary, fontWeight: "700" }}>Edit</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleDeleteEntry(entry)}
                          style={{
                            backgroundColor: colors.error + "15",
                            borderRadius: 8,
                            paddingHorizontal: 10,
                            paddingVertical: 8,
                          }}
                        >
                          <Text style={{ fontSize: 13, color: colors.error, fontWeight: "700" }}>Delete</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    {/* Photo thumbnails below the row */}
                    {(() => {
                      let photos: string[] = [];
                      try { photos = (entry as any).photoUrls ? JSON.parse((entry as any).photoUrls) : []; } catch {}
                      if (photos.length === 0) return null;
                      return (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }} contentContainerStyle={{ gap: 6 }}>
                          {photos.map((uri: string, idx: number) => (
                            <Image key={idx} source={{ uri }} style={{ width: 80, height: 80, borderRadius: 8, backgroundColor: colors.border }} resizeMode="cover" />
                          ))}
                        </ScrollView>
                      );
                    })()}
                  </View>
                );
              })
            )}
          </View>
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
