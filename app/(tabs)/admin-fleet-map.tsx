import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Platform, Linking, FlatList, Modal, TextInput, Alert, ScrollView,
} from "react-native";
import MapView, { Marker, Callout, PROVIDER_GOOGLE } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { useRouter } from "expo-router";

// ─── Constants ────────────────────────────────────────────────────────────────

const BLUE = "#0057FF";
const DARK_BG = "#0A0A0A";
const CARD_BG = "#141414";
const BORDER = "#1E1E1E";

const REGION_DEFAULT = {
  latitude: 30.52,
  longitude: -86.48,
  latitudeDelta: 0.9,
  longitudeDelta: 0.9,
};



const DETAILER_STATUS_COLORS: Record<string, string> = {
  on_my_way: "#F59E0B",
  arrived: "#8B5CF6",
  clocked_in: "#22C55E",
  inactive: "#6B7280",
};

const DETAILER_STATUS_LABELS: Record<string, string> = {
  on_my_way: "On My Way",
  arrived: "Arrived",
  clocked_in: "Active",
};

const VAN_STATUS_COLORS: Record<string, string> = {
  active: "#22C55E",
  parked: "#6B7280",
  maintenance: "#F59E0B",
};

const VAN_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  parked: "Parked",
  maintenance: "Maintenance",
};

const SEVERITY_COLORS: Record<string, string> = {
  info: BLUE,
  warning: "#F59E0B",
  critical: "#EF4444",
};

const CITIES = ["All", "Destin", "FWB", "Niceville", "Crestview", "Pensacola"];

// ─── Live Map Marker ──────────────────────────────────────────────────────────

function VanMarker({ color, label }: { color: string; label: string }) {
  return (
    <View style={markerStyles.container}>
      <View style={[markerStyles.bubble, { backgroundColor: color, shadowColor: color }]}>
        <Text style={markerStyles.emoji}>🚐</Text>
      </View>
      <View style={[markerStyles.tail, { borderTopColor: color }]} />
      <View style={[markerStyles.labelBg, { backgroundColor: "#1e293b" }]}>
        <Text style={markerStyles.labelText} numberOfLines={1}>{label}</Text>
      </View>
    </View>
  );
}

function CustomerMarker({ label }: { label: string }) {
  const CUSTOMER_COLOR = "#22C55E";
  return (
    <View style={markerStyles.container}>
      <View style={[markerStyles.bubble, { backgroundColor: CUSTOMER_COLOR, shadowColor: CUSTOMER_COLOR, width: 36, height: 36, borderRadius: 18 }]}>
        <Text style={[markerStyles.emoji, { fontSize: 17 }]}>🏠</Text>
      </View>
      <View style={[markerStyles.tail, { borderTopColor: CUSTOMER_COLOR }]} />
      <View style={[markerStyles.labelBg, { backgroundColor: "#14532d" }]}>
        <Text style={markerStyles.labelText} numberOfLines={1}>{label}</Text>
      </View>
    </View>
  );
}

const markerStyles = StyleSheet.create({
  container: { alignItems: "center" },
  bubble: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: "center", justifyContent: "center",
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.5, shadowRadius: 4, elevation: 6,
  },
  emoji: { fontSize: 22 },
  tail: {
    width: 0, height: 0,
    borderLeftWidth: 7, borderRightWidth: 7, borderTopWidth: 10,
    borderLeftColor: "transparent", borderRightColor: "transparent", marginTop: -1,
  },
  labelBg: { marginTop: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, maxWidth: 110 },
  labelText: { color: "#fff", fontSize: 10, fontWeight: "600" },
});

// ─── Add Van Modal ────────────────────────────────────────────────────────────

function AddVanModal({ visible, onClose, onSaved }: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [plate, setPlate] = useState("");
  const [color, setColor] = useState("");
  const [city, setCity] = useState("Niceville");
  const [driver, setDriver] = useState("");
  const [vin, setVin] = useState("");

  const createVan = trpc.fleet.createVan.useMutation({
    onSuccess: () => { onSaved(); onClose(); resetForm(); },
    onError: (e) => Alert.alert("Error", e.message),
  });

  const resetForm = () => {
    setName(""); setMake(""); setModel(""); setYear(""); setPlate("");
    setColor(""); setCity("Niceville"); setDriver(""); setVin("");
  };

  const handleSave = () => {
    if (!name.trim()) { Alert.alert("Required", "Van name is required."); return; }
    createVan.mutate({
      name: name.trim(),
      make: make.trim() || undefined,
      model: model.trim() || undefined,
      year: year ? parseInt(year) : undefined,
      plate: plate.trim() || undefined,
      color: color.trim() || undefined,
      city: city || undefined,
      vin: vin.trim() || undefined,
      assigned_driver: driver.trim() || undefined,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: DARK_BG }}>
        <View style={[styles.modalHeader, { borderBottomColor: BORDER }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={{ color: "#6B7280", fontSize: 16 }}>Cancel</Text>
          </TouchableOpacity>
          <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700" }}>Add Van</Text>
          <TouchableOpacity onPress={handleSave} disabled={createVan.isPending}>
            {createVan.isPending
              ? <ActivityIndicator size="small" color={BLUE} />
              : <Text style={{ color: BLUE, fontSize: 16, fontWeight: "700" }}>Save</Text>
            }
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
          <ModalField label="Van Name *" value={name} onChangeText={setName} placeholder="e.g. Van 1 – Niceville" />
          <ModalField label="Make" value={make} onChangeText={setMake} placeholder="e.g. Ford" />
          <ModalField label="Model" value={model} onChangeText={setModel} placeholder="e.g. Transit" />
          <ModalField label="Year" value={year} onChangeText={setYear} placeholder="e.g. 2022" keyboardType="numeric" />
          <ModalField label="License Plate" value={plate} onChangeText={setPlate} placeholder="e.g. ABC-1234" />
          <ModalField label="Color" value={color} onChangeText={setColor} placeholder="e.g. White" />
          <ModalField label="VIN" value={vin} onChangeText={setVin} placeholder="17-character VIN" />
          <ModalField label="Assigned Driver" value={driver} onChangeText={setDriver} placeholder="e.g. Casey" />
          <View>
            <Text style={styles.fieldLabel}>City</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
              {["Niceville", "Destin", "FWB", "Crestview", "Pensacola"].map((c) => (
                <TouchableOpacity
                  key={c}
                  onPress={() => setCity(c)}
                  style={[styles.cityChip, city === c && { backgroundColor: BLUE, borderColor: BLUE }]}
                >
                  <Text style={[styles.cityChipText, city === c && { color: "#fff" }]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function ModalField({ label, value, onChangeText, placeholder, keyboardType }: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; keyboardType?: any;
}) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#4B5563"
        keyboardType={keyboardType ?? "default"}
        style={styles.fieldInput}
      />
    </View>
  );
}

// ─── Van Card ─────────────────────────────────────────────────────────────────

function VanCard({ van, onPress }: { van: any; onPress: () => void }) {
  const statusColor = VAN_STATUS_COLORS[van.status] ?? "#6B7280";
  const statusLabel = VAN_STATUS_LABELS[van.status] ?? van.status;
  return (
    <TouchableOpacity style={styles.vanCard} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.vanCardLeft}>
        <View style={[styles.vanIcon, { backgroundColor: statusColor + "22" }]}>
          <Text style={{ fontSize: 22 }}>🚐</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.vanName} numberOfLines={1}>{van.name}</Text>
          <Text style={styles.vanSub} numberOfLines={1}>
            {[van.year, van.make, van.model].filter(Boolean).join(" ") || "No vehicle info"}
          </Text>
          {van.city ? <Text style={styles.vanCity}>📍 {van.city}</Text> : null}
        </View>
      </View>
      <View style={styles.vanCardRight}>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + "22" }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        {van.fuel_percent > 0 && (
          <Text style={styles.fuelText}>⛽ {van.fuel_percent}%</Text>
        )}
        {van.odometer > 0 && (
          <Text style={styles.odomText}>{van.odometer.toLocaleString()} mi</Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Alert Row ────────────────────────────────────────────────────────────────

function AlertRow({ alert, onMarkRead }: { alert: any; onMarkRead: (id: string) => void }) {
  const sevColor = SEVERITY_COLORS[alert.severity] ?? BLUE;
  return (
    <TouchableOpacity
      style={[styles.alertRow, !alert.is_read && { borderLeftColor: BLUE, borderLeftWidth: 3 }]}
      onPress={() => { if (!alert.is_read) onMarkRead(alert.id); }}
      activeOpacity={0.8}
    >
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <View style={[styles.sevDot, { backgroundColor: sevColor }]} />
          <Text style={styles.alertVan} numberOfLines={1}>{alert.van_name}</Text>
          {alert.van_city ? <Text style={styles.alertCity}>{alert.van_city}</Text> : null}
          {!alert.is_read && (
            <View style={styles.unreadBadge}><Text style={styles.unreadText}>NEW</Text></View>
          )}
        </View>
        <Text style={styles.alertMsg}>{alert.message}</Text>
        <Text style={styles.alertTime}>{new Date(alert.created_at).toLocaleDateString()}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Repair Order Card ───────────────────────────────────────────────────────

const REPAIR_STATUS_COLORS: Record<string, string> = {
  open: "#EF4444",
  in_progress: "#F59E0B",
  resolved: "#22C55E",
};
const REPAIR_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
};
const REPAIR_PRIORITY_COLORS: Record<string, string> = {
  low: "#6B7280",
  medium: "#F59E0B",
  high: "#EF4444",
};

function RepairOrderCardView({ order, onUpdateStatus }: {
  order: any;
  onUpdateStatus: (status: "open" | "in_progress" | "resolved") => void;
}) {
  const statusColor = REPAIR_STATUS_COLORS[order.status] ?? "#6B7280";
  const priorityColor = REPAIR_PRIORITY_COLORS[order.priority] ?? "#6B7280";
  return (
    <View style={[repairCardStyles.card, order.status === "open" && { borderLeftColor: "#EF4444", borderLeftWidth: 3 }]}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
        <View style={{ flex: 1 }}>
          <Text style={repairCardStyles.equipment}>{order.equipmentName}</Text>
          {order.subIssue ? <Text style={repairCardStyles.sub}>{order.subIssue}</Text> : null}
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <View style={[repairCardStyles.badge, { backgroundColor: statusColor + "22" }]}>
            <Text style={[repairCardStyles.badgeText, { color: statusColor }]}>{REPAIR_STATUS_LABELS[order.status]}</Text>
          </View>
          <View style={[repairCardStyles.badge, { backgroundColor: priorityColor + "22" }]}>
            <Text style={[repairCardStyles.badgeText, { color: priorityColor }]}>{order.priority?.toUpperCase()}</Text>
          </View>
        </View>
      </View>
      <Text style={repairCardStyles.meta}>🚐 {order.vanName ?? order.vanId}  •  👤 {order.employeeName ?? order.employeeId}</Text>
      {order.notes ? <Text style={repairCardStyles.notes}>{order.notes}</Text> : null}
      <Text style={repairCardStyles.date}>{new Date(order.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}</Text>
      {order.status !== "resolved" && (
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          {order.status === "open" && (
            <TouchableOpacity
              style={[repairCardStyles.actionBtn, { borderColor: "#F59E0B" }]}
              onPress={() => onUpdateStatus("in_progress")}
            >
              <Text style={{ color: "#F59E0B", fontSize: 12, fontWeight: "700" }}>Mark In Progress</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[repairCardStyles.actionBtn, { borderColor: "#22C55E", flex: 1 }]}
            onPress={() => onUpdateStatus("resolved")}
          >
            <Text style={{ color: "#22C55E", fontSize: 12, fontWeight: "700" }}>Mark Resolved ✓</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const repairCardStyles = StyleSheet.create({
  card: {
    backgroundColor: "#141414", borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: "#1E1E1E",
  },
  equipment: { color: "#fff", fontSize: 15, fontWeight: "700", marginBottom: 2 },
  sub: { color: "#9CA3AF", fontSize: 13 },
  meta: { color: "#6B7280", fontSize: 12, marginBottom: 4 },
  notes: { color: "#6B7280", fontSize: 12, fontStyle: "italic", marginBottom: 4 },
  date: { color: "#4B5563", fontSize: 11 },
  badge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  actionBtn: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: "center", borderWidth: 1 },
});


// ─── Assignments Tab ──────────────────────────────────────────────────────────

function AssignmentsShiftSlot({
  van,
  shift,
  label,
  assignment,
  allEmployees,
  allAssignments,
  onAssign,
  onRemove,
  isPending,
}: {
  van: any;
  shift: "shift1" | "shift2";
  label: string;
  assignment: any | null;
  allEmployees: any[];
  allAssignments: any[];
  onAssign: (empId: string, empName: string) => void;
  onRemove: (empId: string) => void;
  isPending: boolean;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState("");

  // Globally exclude detailers already assigned to any van/shift
  const assignedIds = new Set((allAssignments as any[]).map((a: any) => a.employeeId));

  const available = (allEmployees as any[]).filter((e: any) => {
    if (e.role !== "detailer") return false;
    if (e.employeeId === assignment?.employeeId) return false; // allow re-assign current
    return !assignedIds.has(e.employeeId);
  });

  const filtered = search.trim()
    ? available.filter((e: any) =>
        (e.fullName ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (e.city ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : available;

  const isOccupied = !!assignment;

  return (
    <View style={{
      borderRadius: 12, borderWidth: 1,
      borderColor: isOccupied ? BLUE + "50" : BORDER,
      backgroundColor: isOccupied ? BLUE + "10" : CARD_BG,
      marginBottom: 10, overflow: "hidden",
    }}>
      <View style={{
        flexDirection: "row", justifyContent: "space-between", alignItems: "center",
        paddingHorizontal: 14, paddingVertical: 10,
        backgroundColor: isOccupied ? BLUE + "18" : CARD_BG,
        borderBottomWidth: isOccupied || showPicker ? 1 : 0, borderBottomColor: BORDER,
      }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{
            width: 26, height: 26, borderRadius: 13,
            backgroundColor: isOccupied ? BLUE : "#374151",
            alignItems: "center", justifyContent: "center",
          }}>
            <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>{shift === "shift1" ? "1" : "2"}</Text>
          </View>
          <Text style={{ fontSize: 14, fontWeight: "700", color: "#fff" }}>{label}</Text>
        </View>
        {isOccupied ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity
              onPress={() => { setShowPicker(!showPicker); setSearch(""); }}
              style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: BLUE + "30" }}
            >
              <Text style={{ color: BLUE, fontSize: 12, fontWeight: "700" }}>Change</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => Alert.alert("Remove", `Remove ${assignment.employeeName} from ${label}?`, [
                { text: "Cancel", style: "cancel" },
                { text: "Remove", style: "destructive", onPress: () => onRemove(assignment.employeeId) },
              ])}
              style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: "#EF444430" }}
            >
              <Text style={{ color: "#EF4444", fontSize: 12, fontWeight: "700" }}>Remove</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => { setShowPicker(!showPicker); setSearch(""); }}
            style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, backgroundColor: BLUE }}
          >
            <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>+ Assign</Text>
          </TouchableOpacity>
        )}
      </View>

      {isOccupied && !showPicker && (
        <View style={{ paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: BLUE, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>{(assignment.employeeName ?? "?").charAt(0).toUpperCase()}</Text>
          </View>
          <View>
            <Text style={{ fontSize: 14, fontWeight: "700", color: "#fff" }}>{assignment.employeeName}</Text>
            {assignment.city ? <Text style={{ fontSize: 12, color: "#6B7280" }}>{assignment.city}</Text> : null}
          </View>
        </View>
      )}

      {showPicker && (
        <View style={{ padding: 12 }}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search team members..."
            placeholderTextColor="#6B7280"
            style={{
              backgroundColor: DARK_BG, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8,
              fontSize: 14, color: "#fff", borderWidth: 1, borderColor: BORDER, marginBottom: 8,
            }}
          />
          {filtered.length === 0 ? (
            <Text style={{ color: "#6B7280", fontSize: 13, textAlign: "center", paddingVertical: 8 }}>
              No available detailers
            </Text>
          ) : (
            filtered.map((emp: any) => (
              <TouchableOpacity
                key={emp.employeeId}
                onPress={() => { onAssign(emp.employeeId, emp.fullName); setShowPicker(false); setSearch(""); }}
                style={{
                  flexDirection: "row", alignItems: "center", gap: 10,
                  paddingVertical: 10, paddingHorizontal: 8, borderRadius: 8,
                  backgroundColor: DARK_BG, marginBottom: 6, borderWidth: 1, borderColor: BORDER,
                }}
              >
                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: BLUE + "30", alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ color: BLUE, fontWeight: "700", fontSize: 13 }}>{(emp.fullName ?? "?").charAt(0).toUpperCase()}</Text>
                </View>
                <View>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: "#fff" }}>{emp.fullName}</Text>
                  {emp.city ? <Text style={{ fontSize: 12, color: "#6B7280" }}>{emp.city}</Text> : null}
                </View>
                {isPending && <ActivityIndicator size="small" color={BLUE} style={{ marginLeft: "auto" }} />}
              </TouchableOpacity>
            ))
          )}
        </View>
      )}
    </View>
  );
}

const CITY_OPTIONS = ["Niceville", "Destin", "FWB", "Crestview", "Pensacola"];

function AssignmentsVanCard({
  van,
  allAssignments,
  allEmployees,
  onAssign,
  onRemove,
  isPending,
}: {
  van: any;
  allAssignments: any[];
  allEmployees: any[];
  onAssign: (vanId: string, vanName: string, empId: string, empName: string, shift: "shift1" | "shift2") => void;
  onRemove: (empId: string) => void;
  isPending: boolean;
}) {
  const utils = trpc.useUtils();
  const [showCityPicker, setShowCityPicker] = useState(false);
  const updateVan = trpc.fleet.updateVan.useMutation({
    onSuccess: () => {
      utils.fleet.listVans.invalidate();
      utils.fleet.getVan.invalidate({ id: van.id });
      setShowCityPicker(false);
    },
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  const vanAssignments = allAssignments.filter((a: any) => a.vanId === van.id);
  const empMap: Record<string, any> = {};
  allEmployees.forEach((e: any) => { empMap[e.employeeId] = e; });

  const slots: { shift: "shift1" | "shift2"; label: string; assignment: any | null }[] = [
    { shift: "shift1", label: "1st Shift", assignment: (() => { const a = vanAssignments.find((x: any) => x.shift === "shift1"); if (!a) return null; const emp = empMap[a.employeeId]; return { employeeId: a.employeeId, employeeName: emp?.fullName ?? a.employeeId, city: emp?.city }; })() },
    { shift: "shift2", label: "2nd Shift", assignment: (() => { const a = vanAssignments.find((x: any) => x.shift === "shift2"); if (!a) return null; const emp = empMap[a.employeeId]; return { employeeId: a.employeeId, employeeName: emp?.fullName ?? a.employeeId, city: emp?.city }; })() },
  ];
  const filled = slots.filter((s) => s.assignment).length;

  return (
    <View style={{ marginBottom: 16, borderRadius: 16, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD_BG, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ fontSize: 20 }}>🚐</Text>
          <View>
            <Text style={{ fontSize: 16, fontWeight: "700", color: "#fff" }}>{van.name}</Text>
            <TouchableOpacity
              onPress={() => setShowCityPicker(!showCityPicker)}
              style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}
            >
              <Text style={{ fontSize: 12, color: van.city ? BLUE : "#6B7280" }}>
                📍 {van.city ?? "Set city"}
              </Text>
              <Text style={{ fontSize: 10, color: "#6B7280" }}>▾</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: filled === 2 ? "#22C55E20" : filled === 1 ? "#F59E0B20" : "#EF444420" }}>
          <Text style={{ fontSize: 12, fontWeight: "700", color: filled === 2 ? "#22C55E" : filled === 1 ? "#F59E0B" : "#9CA3AF" }}>{filled}/2 Assigned</Text>
        </View>
      </View>
      {showCityPicker && (
        <View style={{ paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER }}>
          <Text style={{ fontSize: 11, fontWeight: "700", color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Assign City</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {CITY_OPTIONS.map((c) => (
              <TouchableOpacity
                key={c}
                onPress={() => updateVan.mutate({ id: van.id, city: c })}
                style={[
                  { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: BORDER, backgroundColor: DARK_BG },
                  van.city === c && { backgroundColor: BLUE, borderColor: BLUE },
                ]}
                disabled={updateVan.isPending}
              >
                <Text style={{ fontSize: 13, fontWeight: "600", color: van.city === c ? "#fff" : "#9CA3AF" }}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {updateVan.isPending && <ActivityIndicator size="small" color={BLUE} style={{ marginTop: 8 }} />}
        </View>
      )}
      <View style={{ padding: 12 }}>
        {slots.map((slot) => (
          <AssignmentsShiftSlot
            key={slot.shift}
            van={van}
            shift={slot.shift}
            label={slot.label}
            assignment={slot.assignment}
            allEmployees={allEmployees}
            allAssignments={allAssignments}
            onAssign={(empId, empName) => onAssign(van.id, van.name, empId, empName, slot.shift)}
            onRemove={onRemove}
            isPending={isPending}
          />
        ))}
      </View>
    </View>
  );
}

function AssignmentsTabContent({
  vans,
  allAssignments,
  allEmployees,
  onAssign,
  onRemove,
  isPending,
  bottomPad,
}: {
  vans: any[];
  allAssignments: any[];
  allEmployees: any[];
  onAssign: (vanId: string, vanName: string, empId: string, empName: string, shift: "shift1" | "shift2") => void;
  onRemove: (empId: string) => void;
  isPending: boolean;
  bottomPad: number;
}) {
  const [search, setSearch] = useState("");
  const filtered = search.trim()
    ? vans.filter((v) => (v.name ?? "").toLowerCase().includes(search.toLowerCase()) || (v.city ?? "").toLowerCase().includes(search.toLowerCase()))
    : vans;

  const totalSlots = vans.length * 2;
  const filledSlots = allAssignments.length;
  const openSlots = totalSlots - filledSlots;

  return (
    <View style={{ flex: 1, backgroundColor: DARK_BG }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: BORDER }}>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
          {[
            { label: "Vans", value: vans.length, color: BLUE },
            { label: "Filled", value: filledSlots, color: "#22C55E" },
            { label: "Open", value: openSlots, color: openSlots > 0 ? "#F59E0B" : "#22C55E" },
          ].map((s) => (
            <View key={s.label} style={{ flex: 1, backgroundColor: CARD_BG, borderRadius: 10, padding: 10, alignItems: "center", borderWidth: 1, borderColor: BORDER }}>
              <Text style={{ fontSize: 20, fontWeight: "800", color: s.color }}>{s.value}</Text>
              <Text style={{ fontSize: 10, color: "#6B7280", fontWeight: "600" }}>{s.label}</Text>
            </View>
          ))}
        </View>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search vans..."
          placeholderTextColor="#6B7280"
          style={{
            backgroundColor: CARD_BG, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8,
            fontSize: 14, color: "#fff", borderWidth: 1, borderColor: BORDER,
          }}
        />
      </View>
      {filtered.length === 0 ? (
        <View style={styles.centered}>
          <Text style={{ fontSize: 36, marginBottom: 10 }}>🚐</Text>
          <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>No Vans Found</Text>
          <Text style={{ color: "#6B7280", fontSize: 13, textAlign: "center", marginTop: 4 }}>Add vans in the Vans tab first.</Text>
        </View>
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <AssignmentsVanCard
              van={item}
              allAssignments={allAssignments}
              allEmployees={allEmployees}
              onAssign={onAssign}
              onRemove={onRemove}
              isPending={isPending}
            />
          )}
          contentContainerStyle={{ padding: 12, paddingBottom: bottomPad }}
        />
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function AdminFleetMapScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const mapRef = useRef<MapView>(null);

  const [activeTab, setActiveTab] = useState<"map" | "vans" | "alerts" | "repairs" | "assignments">("map");
  const [cityFilter, setCityFilter] = useState("All");
  const [showAddVan, setShowAddVan] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  // ── Live Map data ──
  const { data: locationData, isLoading: mapLoading, refetch: refetchMap, isFetching: mapFetching } =
    trpc.location.getActive.useQuery(undefined, { refetchInterval: 30000 });

  const realVans = locationData ?? [];
  const mapVans = realVans;
  const isDemoMode = false;

  // ── Fleet Vans ──
  const cityParam = cityFilter === "All" ? undefined : cityFilter;
  const { data: fleetVans = [], isLoading: vansLoading, refetch: refetchVans } =
    trpc.fleet.listVans.useQuery({ city: cityParam });

  // ── Alerts ──
  const { data: alerts = [], isLoading: alertsLoading, refetch: refetchAlerts } =
    trpc.fleet.listAlerts.useQuery({ city: cityParam });

  const markReadM = trpc.fleet.markAlertRead.useMutation({
    onSuccess: () => refetchAlerts(),
  });

  const unreadCount = alerts.filter((a: any) => !a.is_read).length;

  // ── Van Assignments ──
  const { data: allVanAssignments = [], refetch: refetchAssignments } = trpc.fleet.getAllVanAssignments.useQuery();
  const { data: allEmployees = [] } = trpc.employee.listAll.useQuery();
  const assignUtils = trpc.useUtils();
  const setVanAssignment = trpc.fleet.setVanAssignment.useMutation({
    onSuccess: () => { refetchAssignments(); assignUtils.fleet.getAllVanAssignments.invalidate(); assignUtils.fleet.getVanAssignment.invalidate(); assignUtils.fleet.listVans.invalidate(); },
    onError: (e: any) => Alert.alert("Error", e.message),
  });
  const removeVanAssignment = trpc.fleet.removeVanAssignment.useMutation({
    onSuccess: () => { refetchAssignments(); assignUtils.fleet.getAllVanAssignments.invalidate(); assignUtils.fleet.getVanAssignment.invalidate(); assignUtils.fleet.listVans.invalidate(); },
    onError: (e: any) => Alert.alert("Error", e.message),
  });

  // ── Repair Orders ──
  const { data: repairOrders = [], isLoading: repairsLoading, refetch: refetchRepairs } =
    trpc.fleet.listRepairOrders.useQuery({ status: "all" });
  const { data: openRepairCount = 0, refetch: refetchRepairCount } = trpc.fleet.countOpenRepairs.useQuery();

  const updateRepairStatus = trpc.fleet.updateRepairStatus.useMutation({
    onSuccess: () => { refetchRepairs(); refetchRepairCount(); },
  });

  // ── Map fit ──
  useEffect(() => {
    if (!mapRef.current || mapVans.length === 0) return;
    if (mapVans.length === 1) {
      mapRef.current.animateToRegion({
        latitude: parseFloat(mapVans[0].lat),
        longitude: parseFloat(mapVans[0].lng),
        latitudeDelta: 0.12, longitudeDelta: 0.12,
      }, 800);
    } else {
      const lats = mapVans.map((v) => parseFloat(v.lat));
      const lngs = mapVans.map((v) => parseFloat(v.lng));
      const minLat = Math.min(...lats), maxLat = Math.max(...lats);
      const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
      const pad = 0.08;
      mapRef.current.animateToRegion({
        latitude: (minLat + maxLat) / 2, longitude: (minLng + maxLng) / 2,
        latitudeDelta: (maxLat - minLat) + pad * 2,
        longitudeDelta: (maxLng - minLng) + pad * 2,
      }, 800);
    }
  }, [mapVans.length]);

  const handleRefresh = () => {
    refetchMap(); refetchVans(); refetchAlerts(); refetchRepairs(); refetchRepairCount();
    setLastRefreshed(new Date());
  };

  const formatTime = (d: Date) =>
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });

  const formatUpdated = (iso: string) => {
    const d = new Date(iso);
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins === 1) return "1 min ago";
    return `${mins} mins ago`;
  };

  const legendBottom = insets.bottom + 8;

  // ── Render ──
  return (
    <ScreenContainer edges={["left", "right"]} containerClassName="bg-background">
      {/* Header */}
      <View style={[styles.header, { backgroundColor: DARK_BG, borderBottomColor: BORDER }]}>
        <View>
          <Text style={styles.title}>Fleet</Text>
          <Text style={styles.subtitle}>Updated {formatTime(lastRefreshed)}</Text>
        </View>
        <TouchableOpacity
          onPress={handleRefresh}
          style={[styles.refreshBtn, { backgroundColor: BLUE }]}
          disabled={mapFetching}
        >
          {mapFetching
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.refreshBtnText}>↻ Refresh</Text>
          }
        </TouchableOpacity>
      </View>

      {/* Tab Bar */}
      <View style={[styles.tabBar, { backgroundColor: DARK_BG, borderBottomColor: BORDER }]}>
        {(["map", "vans", "alerts", "repairs", "assignments"] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]}
            onPress={() => setActiveTab(tab)}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Text style={[styles.tabLabel, activeTab === tab && styles.tabLabelActive]}>
                {tab === "map" ? "Map" : tab === "vans" ? "Vans" : tab === "alerts" ? "Alerts" : tab === "repairs" ? "Repairs" : "Van Assignment"}
                {tab === "alerts" && unreadCount > 0 ? ` (${unreadCount})` : ""}
              </Text>
              {tab === "repairs" && openRepairCount > 0 && (
                <View style={styles.repairBadge}>
                  <Text style={styles.repairBadgeText}>{openRepairCount}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
         ))}
      </View>

      {/* ── LIVE MAP TAB ── */}
      {activeTab === "map" && (
        Platform.OS === "web" ? (
          <View style={[styles.webFallback, { backgroundColor: CARD_BG }]}>
            <Text style={{ color: "#6B7280", fontSize: 15, textAlign: "center" }}>
              Map view is available on the iOS and Android apps.{"\n"}
              Open the app on your device to see live van locations.
            </Text>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <MapView
              provider={(Platform.OS as string) !== "web" ? PROVIDER_GOOGLE : undefined}
              ref={mapRef}
              style={StyleSheet.absoluteFill}
              initialRegion={REGION_DEFAULT}
              showsUserLocation={false}
              showsMyLocationButton={false}
            >
              {mapVans.map((van) => {
                const lat = parseFloat(van.lat);
                const lng = parseFloat(van.lng);
                const color = DETAILER_STATUS_COLORS[van.status] ?? "#6B7280";
                const name = (van.fullName ?? van.employeeId).split(" ")[0];
                return (
                  <Marker
                    key={van.employeeId}
                    coordinate={{ latitude: lat, longitude: lng }}
                    anchor={{ x: 0.5, y: 1.0 }}
                  >
                    <VanMarker color={color} label={name} />
                    <Callout tooltip>
                      <View style={styles.callout}>
                        <Text style={styles.calloutName}>{van.fullName ?? van.employeeId}</Text>
                        <View style={[styles.calloutBadge, { backgroundColor: color + "33" }]}>
                          <Text style={[styles.calloutStatus, { color }]}>
                            {DETAILER_STATUS_LABELS[van.status] ?? van.status}
                          </Text>
                        </View>
                        {van.customerAddress ? (
                          <View style={styles.calloutAddressRow}>
                            <Text style={styles.calloutAddressLabel}>📍 Heading to:</Text>
                            <Text style={styles.calloutAddress} numberOfLines={2}>{van.customerAddress}</Text>
                          </View>
                        ) : null}
                        <Text style={styles.calloutTime}>
                          Updated {formatUpdated(van.updatedAt instanceof Date ? van.updatedAt.toISOString() : String(van.updatedAt))}
                        </Text>

                        {van.customerAddress ? (
                          <TouchableOpacity
                            style={styles.navigateBtn}
                            onPress={() => {
                              const encoded = encodeURIComponent(van.customerAddress!);
                              const url = Platform.OS === "ios"
                                ? `maps://?daddr=${encoded}`
                                : `https://maps.google.com/?daddr=${encoded}`;
                              Linking.openURL(url);
                            }}
                          >
                            <Text style={styles.navigateBtnText}>🗺 Navigate</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </Callout>
                  </Marker>
                );
              })}

            </MapView>
            {mapLoading && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color={BLUE} />
                <Text style={{ color: "#fff", marginTop: 8, fontSize: 13 }}>Loading fleet locations...</Text>
              </View>
            )}
            {!mapLoading && mapVans.length === 0 && (
              <View style={styles.demoBanner}>
                <Text style={styles.demoBannerText}>No team members are currently active on the map</Text>
              </View>
            )}

            <View style={[styles.legend, { bottom: legendBottom, backgroundColor: "#1e293bEE" }]}>
              {Object.entries(DETAILER_STATUS_LABELS).map(([key, label]) => (
                <View key={key} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: DETAILER_STATUS_COLORS[key] }]} />
                  <Text style={styles.legendLabel}>{label}</Text>
                </View>
              ))}

              <Text style={styles.legendNote}>Tap a pin for details</Text>
            </View>
          </View>
        )
      )}

      {/* ── VANS TAB ── */}
      {activeTab === "vans" && (
        <View style={{ flex: 1, backgroundColor: DARK_BG }}>
          {/* City Filter */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={styles.cityFilterRow}
          >
            {CITIES.map((c) => (
              <TouchableOpacity
                key={c}
                onPress={() => setCityFilter(c)}
                style={[styles.cityChip, cityFilter === c && { backgroundColor: BLUE, borderColor: BLUE }]}
              >
                <Text style={[styles.cityChipText, cityFilter === c && { color: "#fff" }]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Van List */}
          {vansLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={BLUE} />
            </View>
          ) : fleetVans.length === 0 ? (
            <View style={styles.centered}>
              <Text style={{ fontSize: 40, marginBottom: 12 }}>🚐</Text>
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: 6 }}>No Vans Yet</Text>
              <Text style={{ color: "#6B7280", fontSize: 13, textAlign: "center", marginBottom: 20 }}>
                Add your first van to start tracking your fleet.
              </Text>
              <TouchableOpacity
                style={[styles.addBtn, { backgroundColor: BLUE }]}
                onPress={() => setShowAddVan(true)}
              >
                <Text style={styles.addBtnText}>+ Add Van</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
              data={fleetVans}
              keyExtractor={(item: any) => item.id}
              renderItem={({ item }) => (
                <VanCard
                  van={item}
                  onPress={() => router.push({ pathname: "/(tabs)/admin-fleet-van-detail", params: { vanId: item.id } })}
                />
              )}
              contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 80 }}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            />
          )}

          {/* FAB */}
          {fleetVans.length > 0 && (
            <TouchableOpacity
              style={[styles.fab, { bottom: insets.bottom + 80, backgroundColor: BLUE }]}
              onPress={() => setShowAddVan(true)}
            >
              <Text style={styles.fabText}>+</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* ── ALERTS TAB ── */}
      {activeTab === "alerts" && (
        <View style={{ flex: 1, backgroundColor: DARK_BG }}>
          {/* City Filter */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={styles.cityFilterRow}
          >
            {CITIES.map((c) => (
              <TouchableOpacity
                key={c}
                onPress={() => setCityFilter(c)}
                style={[styles.cityChip, cityFilter === c && { backgroundColor: BLUE, borderColor: BLUE }]}
              >
                <Text style={[styles.cityChipText, cityFilter === c && { color: "#fff" }]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {alertsLoading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={BLUE} />
            </View>
          ) : alerts.length === 0 ? (
            <View style={styles.centered}>
              <Text style={{ fontSize: 40, marginBottom: 12 }}>✅</Text>
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: 6 }}>No Alerts</Text>
              <Text style={{ color: "#6B7280", fontSize: 13, textAlign: "center" }}>
                All clear — no maintenance alerts for this location.
              </Text>
            </View>
          ) : (
            <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
              data={alerts}
              keyExtractor={(item: any) => item.id}
              renderItem={({ item }) => (
                <AlertRow
                  alert={item}
                  onMarkRead={(id) => markReadM.mutate({ id })}
                />
              )}
              contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 80 }}
              ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: BORDER }} />}
            />
          )}
        </View>
      )}

      {/* ── REPAIRS TAB ── */}
      {activeTab === "repairs" && (
        <View style={{ flex: 1, backgroundColor: DARK_BG }}>
          {repairsLoading ? (
            <View style={styles.centered}><ActivityIndicator size="large" color={BLUE} /></View>
          ) : repairOrders.length === 0 ? (
            <View style={styles.centered}>
              <Text style={{ fontSize: 40, marginBottom: 12 }}>🔧</Text>
              <Text style={{ color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: 6 }}>No Repair Orders</Text>
              <Text style={{ color: "#6B7280", fontSize: 13, textAlign: "center" }}>No repair requests in this status.</Text>
            </View>
          ) : (
            <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
              data={repairOrders}
              keyExtractor={(item: any) => item.repairId}
              renderItem={({ item }) => (
                <RepairOrderCardView
                  order={item}
                  onUpdateStatus={(status: "open" | "in_progress" | "resolved") => updateRepairStatus.mutate({ repairId: item.repairId, status, resolvedBy: "Admin" })}
                />
              )}
              contentContainerStyle={{ padding: 12, paddingBottom: insets.bottom + 80 }}
              ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            />
          )}
        </View>
      )}

      {/* ── ASSIGNMENTS TAB ── */}
      {activeTab === "assignments" && (
        <AssignmentsTabContent
          vans={fleetVans as any[]}
          allAssignments={allVanAssignments as any[]}
          allEmployees={allEmployees as any[]}
          onAssign={(vanId, vanName, employeeId, employeeName, shift) =>
            setVanAssignment.mutate({ vanId, vanName, employeeId, shift, assignedBy: "Admin" })
          }
          onRemove={(employeeId) => removeVanAssignment.mutate({ employeeId })}
          isPending={setVanAssignment.isPending || removeVanAssignment.isPending}
          bottomPad={insets.bottom + 80}
        />
      )}

      {/* Add Van Modal */}
      <AddVanModal
        visible={showAddVan}
        onClose={() => setShowAddVan(false)}
        onSaved={() => refetchVans()}
      />
    </ScreenContainer>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5,
  },
  title: { fontSize: 20, fontWeight: "800", color: "#fff" },
  subtitle: { fontSize: 12, marginTop: 2, color: "#6B7280" },
  refreshBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, minWidth: 90, alignItems: "center" },
  refreshBtnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  tabBar: {
    flexDirection: "row", borderBottomWidth: 0.5,
  },
  tabBtn: {
    flex: 1, paddingVertical: 12, alignItems: "center",
    borderBottomWidth: 2, borderBottomColor: "transparent",
  },
  tabBtnActive: { borderBottomColor: BLUE },
  tabLabel: { fontSize: 14, fontWeight: "600", color: "#6B7280" },
  tabLabelActive: { color: "#fff" },
  cityFilterRow: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  cityChip: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
    borderWidth: 1, borderColor: BORDER, backgroundColor: CARD_BG,
  },
  cityChipText: { fontSize: 13, fontWeight: "600", color: "#9CA3AF" },
  vanCard: {
    backgroundColor: CARD_BG, borderRadius: 12, padding: 14,
    flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: BORDER,
  },
  vanCardLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  vanCardRight: { alignItems: "flex-end", gap: 4 },
  vanIcon: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  vanName: { fontSize: 15, fontWeight: "700", color: "#fff", marginBottom: 2 },
  vanSub: { fontSize: 12, color: "#6B7280" },
  vanCity: { fontSize: 11, color: "#9CA3AF", marginTop: 2 },
  statusBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: "700" },
  fuelText: { fontSize: 11, color: "#9CA3AF" },
  odomText: { fontSize: 11, color: "#6B7280" },
  alertRow: {
    backgroundColor: CARD_BG, padding: 14, borderRadius: 10,
    borderWidth: 1, borderColor: BORDER, borderLeftWidth: 1,
  },
  sevDot: { width: 8, height: 8, borderRadius: 4 },
  alertVan: { fontSize: 13, fontWeight: "700", color: "#fff" },
  alertCity: { fontSize: 11, color: "#6B7280", backgroundColor: "#1E1E1E", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  unreadBadge: { backgroundColor: BLUE, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  unreadText: { color: "#fff", fontSize: 9, fontWeight: "800" },
  alertMsg: { fontSize: 13, color: "#D1D5DB", lineHeight: 18, marginBottom: 4 },
  alertTime: { fontSize: 11, color: "#6B7280" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  addBtn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 24 },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  fab: {
    position: "absolute", right: 20, width: 52, height: 52,
    borderRadius: 26, alignItems: "center", justifyContent: "center",
    shadowColor: BLUE, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 8,
  },
  fabText: { color: "#fff", fontSize: 28, fontWeight: "300", lineHeight: 32 },
  webFallback: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  loadingOverlay: {
    ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  demoBanner: {
    position: "absolute", top: 12, alignSelf: "center",
    backgroundColor: "#F59E0B", paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
  },
  demoBannerText: { color: "#000", fontWeight: "700", fontSize: 12 },
  legend: {
    position: "absolute", left: 12, right: 12,
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, gap: 12, flexWrap: "wrap",
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { fontSize: 12, color: "#e2e8f0" },
  legendNote: { fontSize: 11, color: "#94a3b8", marginLeft: "auto" },
  callout: {
    backgroundColor: "#1e293b", borderRadius: 10, padding: 12, minWidth: 160,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 4,
  },
  calloutName: { color: "#fff", fontWeight: "700", fontSize: 14, marginBottom: 4 },
  calloutBadge: { borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start", marginBottom: 4 },
  calloutStatus: { fontSize: 12, fontWeight: "600" },
  calloutTime: { color: "#94a3b8", fontSize: 11 },
  calloutAddressRow: { marginTop: 6, marginBottom: 2 },
  calloutAddressLabel: { color: "#94a3b8", fontSize: 10, fontWeight: "600", marginBottom: 2 },
  calloutAddress: { color: "#e2e8f0", fontSize: 12, lineHeight: 16 },
  navigateBtn: { marginTop: 10, backgroundColor: BLUE, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 12, alignSelf: "flex-start" },
  navigateBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  repairBadge: {
    backgroundColor: "#EF4444", borderRadius: 10, minWidth: 18, height: 18,
    alignItems: "center", justifyContent: "center", paddingHorizontal: 4,
  },
  repairBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  repairCard: {
    backgroundColor: CARD_BG, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: BORDER,
  },
  repairEquipment: { color: "#fff", fontSize: 15, fontWeight: "700", marginBottom: 2 },
  repairSub: { color: "#9CA3AF", fontSize: 13, marginBottom: 2 },
  repairMeta: { color: "#6B7280", fontSize: 12, marginBottom: 4 },
  repairNotes: { color: "#6B7280", fontSize: 12, fontStyle: "italic", marginBottom: 6 },
  repairActions: { flexDirection: "row", gap: 8, marginTop: 8 },
  repairActionBtn: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: "center", borderWidth: 1 },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5,
  },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: "#9CA3AF", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  fieldInput: {
    backgroundColor: CARD_BG, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    color: "#fff", fontSize: 15, borderWidth: 1, borderColor: BORDER,
  },
  customerToggleBtn: {
    position: "absolute", right: 12,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4, elevation: 5,
  },
  customerToggleText: { color: "#fff", fontSize: 12, fontWeight: "700" },
});
