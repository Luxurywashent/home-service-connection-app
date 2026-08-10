/**
 * Admin Geofence Management Screen
 * - View all geofence zones on a map with 0.25-mile radius circles
 * - Add a new zone by entering an address (geocoded via expo-location)
 * - Toggle zones active/inactive, delete zones
 * - View recent enter/exit events log
 */
import {
  ActivityIndicator, Alert, FlatList, Modal, Platform,
  RefreshControl, ScrollView, StyleSheet, Text,
  TextInput, TouchableOpacity, View,
} from "react-native";
import { useState, useCallback } from "react";
import MapView, { Circle, Marker, PROVIDER_GOOGLE } from "react-native-maps";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { useEmployeeAuth } from "@/lib/auth-context";
import * as Haptics from "expo-haptics";

// 0.10 miles in metres
const TENTH_MILE_M = 161;

type Zone = {
  zoneId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isActive: number;
  createdBy?: string | null;
  createdAt?: string;
};

type GeoEvent = {
  eventId: string;
  employeeId: string;
  fullName?: string | null;
  zoneId: string;
  zoneName?: string | null;
  eventType: "enter" | "exit";
  createdAt?: string;
};

type Tab = "map" | "zones" | "events";

export default function AdminGeofenceScreen() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { employee } = useEmployeeAuth();
  const [activeTab, setActiveTab] = useState<Tab>("map");
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [geocoding, setGeocoding] = useState(false);
  const [saving, setSaving] = useState(false);

  const zonesQuery = trpc.geofence.listZones.useQuery();
  const eventsQuery = trpc.geofence.listEvents.useQuery({ limit: 100 });
  const createZoneMut = trpc.geofence.createZone.useMutation();
  const toggleZoneMut = trpc.geofence.toggleZone.useMutation();
  const deleteZoneMut = trpc.geofence.deleteZone.useMutation();

  const zones: Zone[] = (zonesQuery.data ?? []) as unknown as Zone[];
  const events: GeoEvent[] = (eventsQuery.data ?? []) as unknown as GeoEvent[];
  const activeZones = zones.filter((z) => z.isActive === 1);

  const handleAddZone = useCallback(async () => {
    if (!newName.trim() || !newAddress.trim()) {
      Alert.alert("Missing Info", "Please enter both a name and an address.");
      return;
    }
    setGeocoding(true);
    try {
      // Use OpenStreetMap Nominatim — free, no API key, no rate-limit issues
      const encoded = encodeURIComponent(newAddress.trim());
      const resp = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1`,
        { headers: { "User-Agent": "LuxuryWashApp/1.0" } }
      );
      const data = await resp.json();
      if (!data || data.length === 0) {
        Alert.alert("Not Found", "Could not find coordinates for that address. Try a more specific address.");
        setGeocoding(false);
        return;
      }
      const latitude = parseFloat(data[0].lat);
      const longitude = parseFloat(data[0].lon);
      setGeocoding(false);
      setSaving(true);
      await createZoneMut.mutateAsync({
        zoneId: `ZONE-${Date.now()}`,
        name: newName.trim(),
        address: newAddress.trim(),
        latitude,
        longitude,
        radiusMeters: TENTH_MILE_M,
        createdBy: employee?.fullName ?? employee?.employeeId,
      });
      await zonesQuery.refetch();
      setNewName("");
      setNewAddress("");
      setShowAddModal(false);
      setSaving(false);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      setGeocoding(false);
      setSaving(false);
      Alert.alert("Error", err?.message ?? "Failed to create zone.");
    }
  }, [newName, newAddress, employee, createZoneMut, zonesQuery]);

  const handleToggle = useCallback(async (zone: Zone) => {
    const newVal = zone.isActive === 1 ? 0 : 1;
    await toggleZoneMut.mutateAsync({ zoneId: zone.zoneId, isActive: newVal });
    zonesQuery.refetch();
  }, [toggleZoneMut, zonesQuery]);

  const handleDelete = useCallback((zone: Zone) => {
    Alert.alert("Delete Zone", `Delete "${zone.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          await deleteZoneMut.mutateAsync({ zoneId: zone.zoneId });
          zonesQuery.refetch();
        },
      },
    ]);
  }, [deleteZoneMut, zonesQuery]);

  const fmtTime = (ts?: string) => {
    if (!ts) return "";
    try { return new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
    catch { return ts; }
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: "map", label: "Map" },
    { key: "zones", label: "Zones" },
    { key: "events", label: "Events" },
  ];

  return (
    <ScreenContainer edges={["left", "right"]} className="flex-1">
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Geofence Zones</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddModal(true)}>
          <Text style={styles.addBtnText}>+ Add Zone</Text>
        </TouchableOpacity>
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tabBtn, activeTab === t.key && styles.tabBtnActive]}
            onPress={() => setActiveTab(t.key)}
          >
            <Text style={[styles.tabLabel, activeTab === t.key && styles.tabLabelActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Map Tab */}
      {activeTab === "map" && (
        <View style={{ flex: 1 }}>
          {Platform.OS === "web" ? (
            <View style={styles.webMapPlaceholder}>
              <Text style={styles.webMapText}>📡 Map view is available on iOS and Android.</Text>
              <Text style={[styles.webMapText, { fontSize: 13, marginTop: 8 }]}>
                {activeZones.length} active zone{activeZones.length !== 1 ? "s" : ""} defined.
              </Text>
            </View>
          ) : (
<MapView
              style={{ flex: 1 }}
              provider={PROVIDER_GOOGLE}
              initialRegion={
                activeZones.length > 0
                  ? { latitude: activeZones[0].latitude, longitude: activeZones[0].longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }
                  : { latitude: 30.5, longitude: -86.5, latitudeDelta: 0.5, longitudeDelta: 0.5 }
              }
            >
              {activeZones.map((zone) => (
                <Circle
                  key={`circle-${zone.zoneId}`}
                  center={{ latitude: zone.latitude, longitude: zone.longitude }}
                  radius={zone.radiusMeters}
                  strokeColor={colors.primary + "CC"}
                  fillColor={colors.primary + "22"}
                  strokeWidth={2}
                />
              ))}
              {activeZones.map((zone) => (
                <Marker
                  key={`marker-${zone.zoneId}`}
                  coordinate={{ latitude: zone.latitude, longitude: zone.longitude }}
                  title={zone.name}
                  description={zone.address}
                  pinColor={colors.primary}
                />
              ))}
            </MapView>
          )}
        </View>
      )}

      {/* Zones Tab */}
      {activeTab === "zones" && (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={zones}
          keyExtractor={(z) => z.zoneId}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={zonesQuery.isRefetching} onRefresh={zonesQuery.refetch} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyIcon}>📡</Text>
              <Text style={styles.emptyText}>No zones yet. Tap "+ Add Zone" to create one.</Text>
            </View>
          }
          renderItem={({ item: zone }) => (
            <View style={styles.zoneCard}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={styles.zoneName}>{zone.name}</Text>
                  <View style={[styles.statusPill, { backgroundColor: zone.isActive === 1 ? colors.success + "22" : colors.muted + "22" }]}>
                    <Text style={[styles.statusText, { color: zone.isActive === 1 ? colors.success : colors.muted }]}>
                      {zone.isActive === 1 ? "Active" : "Inactive"}
                    </Text>
                  </View>
                </View>
                <Text style={styles.zoneAddr}>{zone.address}</Text>
                <Text style={styles.zoneMeta}>Radius: 0.10 mi · {zone.latitude.toFixed(5)}, {zone.longitude.toFixed(5)}</Text>
              </View>
              <View style={styles.zoneActions}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => handleToggle(zone)}>
                  <Text style={styles.actionBtnText}>{zone.isActive === 1 ? "Disable" : "Enable"}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.error + "22" }]} onPress={() => handleDelete(zone)}>
                  <Text style={[styles.actionBtnText, { color: colors.error }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      {/* Events Tab */}
      {activeTab === "events" && (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={events}
          keyExtractor={(e) => e.eventId}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={eventsQuery.isRefetching} onRefresh={eventsQuery.refetch} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyIcon}>📋</Text>
              <Text style={styles.emptyText}>No events yet. Events appear when team members enter or exit zones.</Text>
            </View>
          }
          renderItem={({ item: ev }) => (
            <View style={styles.eventRow}>
              <Text style={[styles.eventIcon, { color: ev.eventType === "enter" ? colors.success : colors.warning }]}>
                {ev.eventType === "enter" ? "📍" : "🚗"}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.eventName}>{ev.fullName ?? ev.employeeId}</Text>
                <Text style={styles.eventSub}>
                  {ev.eventType === "enter" ? "Entered" : "Exited"} {ev.zoneName ?? ev.zoneId}
                </Text>
              </View>
              <Text style={styles.eventTime}>{fmtTime(ev.createdAt as any)}</Text>
            </View>
          )}
        />
      )}

      {/* Add Zone Modal */}
      <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={() => setShowAddModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Geofence Zone</Text>
            <Text style={styles.modalLabel}>Zone Name</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Niceville Depot"
              placeholderTextColor={colors.muted}
              value={newName}
              onChangeText={setNewName}
              returnKeyType="next"
            />
            <Text style={styles.modalLabel}>Address</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. 123 Main St, Niceville FL"
              placeholderTextColor={colors.muted}
              value={newAddress}
              onChangeText={setNewAddress}
              returnKeyType="done"
              multiline
            />
            <Text style={styles.modalNote}>Radius is fixed at 0.10 miles (161 m)</Text>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.surface, flex: 1 }]} onPress={() => setShowAddModal(false)}>
                <Text style={[styles.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: colors.primary, flex: 1 }]}
                onPress={handleAddZone}
                disabled={geocoding || saving}
              >
                {geocoding || saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={[styles.modalBtnText, { color: "#fff" }]}>Save Zone</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

function makeStyles(colors: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
    headerTitle: { fontSize: 22, fontWeight: "800", color: colors.foreground },
    addBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
    addBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
    tabBar: { flexDirection: "row", marginHorizontal: 16, marginBottom: 8, backgroundColor: colors.surface, borderRadius: 12, padding: 4, gap: 4 },
    tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 10, alignItems: "center" },
    tabBtnActive: { backgroundColor: colors.primary },
    tabLabel: { fontSize: 13, fontWeight: "600", color: colors.muted },
    tabLabelActive: { color: "#fff" },
    listContent: { padding: 16, paddingBottom: 40 },
    zoneCard: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 10 },
    zoneName: { fontSize: 15, fontWeight: "700", color: colors.foreground },
    zoneAddr: { fontSize: 12, color: colors.muted, marginTop: 3 },
    zoneMeta: { fontSize: 11, color: colors.muted, marginTop: 2 },
    statusPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
    statusText: { fontSize: 11, fontWeight: "700" },
    zoneActions: { flexDirection: "row", gap: 8, marginTop: 10 },
    actionBtn: { flex: 1, backgroundColor: colors.primary + "22", borderRadius: 8, paddingVertical: 7, alignItems: "center" },
    actionBtnText: { fontSize: 13, fontWeight: "700", color: colors.primary },
    eventRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8, gap: 10 },
    eventIcon: { fontSize: 22 },
    eventName: { fontSize: 14, fontWeight: "700", color: colors.foreground },
    eventSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
    eventTime: { fontSize: 11, color: colors.muted },
    emptyWrap: { alignItems: "center", paddingVertical: 60 },
    emptyIcon: { fontSize: 40, marginBottom: 12 },
    emptyText: { fontSize: 14, color: colors.muted, textAlign: "center", maxWidth: 260 },
    webMapPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, margin: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
    webMapText: { fontSize: 16, color: colors.muted, textAlign: "center" },
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center", padding: 20 },
    modalCard: { backgroundColor: colors.background, borderRadius: 20, padding: 24, width: "100%", maxWidth: 420 },
    modalTitle: { fontSize: 20, fontWeight: "800", color: colors.foreground, marginBottom: 16 },
    modalLabel: { fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 6 },
    modalInput: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: colors.foreground, marginBottom: 14 },
    modalNote: { fontSize: 12, color: colors.muted, fontStyle: "italic" },
    modalBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center" },
    modalBtnText: { fontSize: 15, fontWeight: "700" },
  });
}
