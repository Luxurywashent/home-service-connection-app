import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  FlatList, Modal, TextInput, Alert, ScrollView, Platform, Linking, Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { trpc } from "@/lib/trpc";
import * as ImagePicker from "expo-image-picker";
import { CalendarPicker } from "@/components/calendar-picker";

// ─── Constants ────────────────────────────────────────────────────────────────

const BLUE = "#0057FF";
const DARK_BG = "#0A0A0A";
const CARD_BG = "#141414";
const BORDER = "#1E1E1E";

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: string) {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatCurrency(n?: number | null) {
  if (n == null) return "—";
  return `$${Number(n).toFixed(2)}`;
}

// ─── Health Stat Card ─────────────────────────────────────────────────────────

function StatCard({ icon, label, value, color }: { icon: string; label: string; value: string; color?: string }) {
  return (
    <View style={statStyles.card}>
      <Text style={statStyles.icon}>{icon}</Text>
      <Text style={[statStyles.value, color ? { color } : {}]}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  );
}

const statStyles = StyleSheet.create({
  card: {
    flex: 1, backgroundColor: CARD_BG, borderRadius: 12, padding: 12,
    alignItems: "center", borderWidth: 1, borderColor: BORDER, minWidth: 80,
  },
  icon: { fontSize: 22, marginBottom: 4 },
  value: { fontSize: 18, fontWeight: "800", color: "#fff", marginBottom: 2 },
  label: { fontSize: 10, color: "#6B7280", textAlign: "center", textTransform: "uppercase", letterSpacing: 0.5 },
});

// ─── Modal Field ──────────────────────────────────────────────────────────────

function ModalField({ label, value, onChangeText, placeholder, keyboardType, multiline }: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; keyboardType?: any; multiline?: boolean;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#4B5563"
        keyboardType={keyboardType ?? "default"}
        multiline={multiline}
        style={[styles.fieldInput, multiline && { height: 80, textAlignVertical: "top" }]}
      />
    </View>
  );
}

// ─── Date Picker Field ────────────────────────────────────────────────────────

function DatePickerField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const display = value
    ? new Date(value + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "Tap to select";
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TouchableOpacity
        onPress={() => setOpen(!open)}
        style={[styles.fieldInput, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
        activeOpacity={0.7}
      >
        <Text style={{ color: value ? "#fff" : "#4B5563", fontSize: 15 }}>{display}</Text>
        <Text style={{ color: BLUE, fontSize: 13 }}>{open ? "Close" : "📅 Pick"}</Text>
      </TouchableOpacity>
      {open && (
        <View style={{ marginTop: 8, borderRadius: 12, overflow: "hidden" }}>
          <CalendarPicker
            selectedDate={value}
            onSelectDate={(d) => { onChange(d); setOpen(false); }}
          />
        </View>
      )}
    </View>
  );
}

// ─── Add Maintenance Modal ────────────────────────────────────────────────────

function AddMaintenanceModal({ visible, vanId, onClose, onSaved }: {
  visible: boolean; vanId: string; onClose: () => void; onSaved: () => void;
}) {
  const [type, setType] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [odometer, setOdometer] = useState("");
  const [nextDate, setNextDate] = useState("");
  const [cost, setCost] = useState("");
  const [shop, setShop] = useState("");
  const [notes, setNotes] = useState("");
  const [proofUri, setProofUri] = useState<string | null>(null);
  const [proofBase64, setProofBase64] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const uploadProof = trpc.fleet.uploadMaintenanceProof.useMutation();
  const addM = trpc.fleet.addMaintenance.useMutation({
    onSuccess: () => { onSaved(); onClose(); resetForm(); },
    onError: (e) => Alert.alert("Error", e.message),
  });

  const resetForm = () => {
    setType(""); setDate(new Date().toISOString().split("T")[0]);
    setOdometer(""); setNextDate(""); setCost(""); setShop(""); setNotes("");
    setProofUri(null); setProofBase64(null);
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7, base64: true });
    if (!result.canceled && result.assets[0]) {
      setProofUri(result.assets[0].uri);
      setProofBase64(result.assets[0].base64 ?? null);
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission Required", "Camera access is needed to take a photo."); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true });
    if (!result.canceled && result.assets[0]) {
      setProofUri(result.assets[0].uri);
      setProofBase64(result.assets[0].base64 ?? null);
    }
  };

  const handleSave = async () => {
    if (!type.trim()) { Alert.alert("Required", "Service type is required."); return; }
    setUploading(true);
    try {
      let proofImageUrl: string | undefined;
      if (proofBase64) {
        const res = await uploadProof.mutateAsync({ base64: proofBase64, mimeType: "image/jpeg" });
        proofImageUrl = res.url;
      }
      await addM.mutateAsync({
        van_id: vanId, type: type.trim(), service_date: date,
        odometer_at_service: odometer ? parseInt(odometer) : undefined,
        next_due_date: nextDate || undefined,
        cost: cost ? parseFloat(cost) : undefined,
        shop_name: shop.trim() || undefined,
        notes: notes.trim() || undefined,
        proof_image_url: proofImageUrl,
      });
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "Failed to save");
    } finally {
      setUploading(false);
    }
  };

  const COMMON_TYPES = ["Oil Change", "Tire Rotation", "Brake Service", "Air Filter", "Transmission", "Inspection", "Other"];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: DARK_BG }}>
        <View style={[styles.modalHeader, { borderBottomColor: BORDER }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={{ color: "#6B7280", fontSize: 16 }}>Cancel</Text>
          </TouchableOpacity>
          <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700" }}>Add Maintenance</Text>
          <TouchableOpacity onPress={handleSave} disabled={uploading || addM.isPending}>
            {uploading || addM.isPending
              ? <ActivityIndicator size="small" color={BLUE} />
              : <Text style={{ color: BLUE, fontSize: 16, fontWeight: "700" }}>Save</Text>
            }
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
          <Text style={styles.fieldLabel}>Service Type *</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {COMMON_TYPES.map((t) => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setType(t)}
                  style={[styles.typeChip, type === t && { backgroundColor: BLUE, borderColor: BLUE }]}
                >
                  <Text style={[styles.typeChipText, type === t && { color: "#fff" }]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
          <ModalField label="Or type custom service" value={type} onChangeText={setType} placeholder="e.g. Coolant Flush" />
          <DatePickerField label="Service Date *" value={date} onChange={setDate} />
          <ModalField label="Odometer at Service (mi)" value={odometer} onChangeText={setOdometer} keyboardType="numeric" placeholder="e.g. 45000" />
          <DatePickerField label="Next Due Date" value={nextDate} onChange={setNextDate} />
          <ModalField label="Cost ($)" value={cost} onChangeText={setCost} keyboardType="decimal-pad" placeholder="e.g. 89.99" />
          <ModalField label="Shop / Mechanic" value={shop} onChangeText={setShop} placeholder="e.g. Jiffy Lube" />
          <ModalField label="Notes" value={notes} onChangeText={setNotes} multiline placeholder="Any additional notes..." />

          {/* Repair Proof Image */}
          <Text style={[styles.fieldLabel, { marginTop: 4 }]}>Repair Proof (Photo)</Text>
          {proofUri ? (
            <View style={{ marginBottom: 12 }}>
              <Image source={{ uri: proofUri }} style={{ width: "100%", height: 200, borderRadius: 10, marginBottom: 8 }} resizeMode="cover" />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity onPress={pickImage} style={{ flex: 1, padding: 10, borderRadius: 8, backgroundColor: "#1E1E1E", alignItems: "center" }}>
                  <Text style={{ color: BLUE, fontWeight: "600" }}>Change Photo</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => { setProofUri(null); setProofBase64(null); }} style={{ flex: 1, padding: 10, borderRadius: 8, backgroundColor: "#1E1E1E", alignItems: "center" }}>
                  <Text style={{ color: "#EF4444", fontWeight: "600" }}>Remove</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
              <TouchableOpacity onPress={takePhoto} style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: "#1E1E1E", borderWidth: 1, borderColor: BORDER, alignItems: "center", gap: 4 }}>
                <Text style={{ fontSize: 22 }}>📷</Text>
                <Text style={{ color: "#9CA3AF", fontSize: 13, fontWeight: "600" }}>Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={pickImage} style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: "#1E1E1E", borderWidth: 1, borderColor: BORDER, alignItems: "center", gap: 4 }}>
                <Text style={{ fontSize: 22 }}>🖼️</Text>
                <Text style={{ color: "#9CA3AF", fontSize: 13, fontWeight: "600" }}>Choose from Library</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Add Fuel Log Modal ───────────────────────────────────────────────────────

function AddFuelModal({ visible, vanId, onClose, onSaved }: {
  visible: boolean; vanId: string; onClose: () => void; onSaved: () => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [gallons, setGallons] = useState("");
  const [pricePerGallon, setPricePerGallon] = useState("");
  const [total, setTotal] = useState("");
  const [odometer, setOdometer] = useState("");
  const [station, setStation] = useState("");

  const addM = trpc.fleet.addFuelLog.useMutation({
    onSuccess: () => { onSaved(); onClose(); resetForm(); },
    onError: (e) => Alert.alert("Error", e.message),
  });

  const resetForm = () => {
    setDate(new Date().toISOString().split("T")[0]);
    setGallons(""); setPricePerGallon(""); setTotal(""); setOdometer(""); setStation("");
  };

  // Auto-calculate total when gallons and price change
  const handleGallonsChange = (v: string) => {
    setGallons(v);
    if (v && pricePerGallon) setTotal((parseFloat(v) * parseFloat(pricePerGallon)).toFixed(2));
  };
  const handlePriceChange = (v: string) => {
    setPricePerGallon(v);
    if (gallons && v) setTotal((parseFloat(gallons) * parseFloat(v)).toFixed(2));
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: DARK_BG }}>
        <View style={[styles.modalHeader, { borderBottomColor: BORDER }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={{ color: "#6B7280", fontSize: 16 }}>Cancel</Text>
          </TouchableOpacity>
          <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700" }}>Add Fuel Fill-up</Text>
          <TouchableOpacity onPress={() => {
            addM.mutate({
              van_id: vanId, log_date: date,
              gallons: gallons ? parseFloat(gallons) : undefined,
              cost_per_gallon: pricePerGallon ? parseFloat(pricePerGallon) : undefined,
              total_cost: total ? parseFloat(total) : undefined,
              odometer: odometer ? parseInt(odometer) : undefined,
              station: station.trim() || undefined,
            });
          }} disabled={addM.isPending}>
            {addM.isPending
              ? <ActivityIndicator size="small" color={BLUE} />
              : <Text style={{ color: BLUE, fontSize: 16, fontWeight: "700" }}>Save</Text>
            }
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
          <ModalField label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} placeholder="2025-01-15" />
          <ModalField label="Gallons" value={gallons} onChangeText={handleGallonsChange} keyboardType="decimal-pad" placeholder="e.g. 12.5" />
          <ModalField label="Price per Gallon ($)" value={pricePerGallon} onChangeText={handlePriceChange} keyboardType="decimal-pad" placeholder="e.g. 3.49" />
          <ModalField label="Total Cost ($)" value={total} onChangeText={setTotal} keyboardType="decimal-pad" placeholder="Auto-calculated" />
          <ModalField label="Odometer (mi)" value={odometer} onChangeText={setOdometer} keyboardType="numeric" placeholder="e.g. 45200" />
          <ModalField label="Gas Station" value={station} onChangeText={setStation} placeholder="e.g. Shell on Hwy 98" />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Add Trip Modal ───────────────────────────────────────────────────────────

function AddTripModal({ visible, vanId, onClose, onSaved }: {
  visible: boolean; vanId: string; onClose: () => void; onSaved: () => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [startAddr, setStartAddr] = useState("");
  const [endAddr, setEndAddr] = useState("");
  const [duration, setDuration] = useState("");
  const [miles, setMiles] = useState("");

  const addM = trpc.fleet.addTrip.useMutation({
    onSuccess: () => { onSaved(); onClose(); resetForm(); },
    onError: (e) => Alert.alert("Error", e.message),
  });

  const resetForm = () => {
    setDate(new Date().toISOString().split("T")[0]);
    setStartAddr(""); setEndAddr(""); setDuration(""); setMiles("");
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: DARK_BG }}>
        <View style={[styles.modalHeader, { borderBottomColor: BORDER }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={{ color: "#6B7280", fontSize: 16 }}>Cancel</Text>
          </TouchableOpacity>
          <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700" }}>Log Trip</Text>
          <TouchableOpacity onPress={() => {
            addM.mutate({
              van_id: vanId, trip_date: date,
              start_address: startAddr.trim() || undefined,
              end_address: endAddr.trim() || undefined,
              duration_minutes: duration ? parseInt(duration) : undefined,
              distance_miles: miles ? parseFloat(miles) : undefined,
            });
          }} disabled={addM.isPending}>
            {addM.isPending
              ? <ActivityIndicator size="small" color={BLUE} />
              : <Text style={{ color: BLUE, fontSize: 16, fontWeight: "700" }}>Save</Text>
            }
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
          <ModalField label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} placeholder="2025-01-15" />
          <ModalField label="Start Address" value={startAddr} onChangeText={setStartAddr} placeholder="e.g. 123 Main St, Niceville, FL" />
          <ModalField label="End Address" value={endAddr} onChangeText={setEndAddr} placeholder="e.g. 456 Elm Ave, Destin, FL" />
          <ModalField label="Duration (minutes)" value={duration} onChangeText={setDuration} keyboardType="numeric" placeholder="e.g. 45" />
          <ModalField label="Distance (miles)" value={miles} onChangeText={setMiles} keyboardType="decimal-pad" placeholder="e.g. 18.5" />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Edit Van Modal ───────────────────────────────────────────────────────────

function EditVanModal({ visible, van, onClose, onSaved }: {
  visible: boolean; van: any; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(van?.name ?? "");
  const [make, setMake] = useState(van?.make ?? "");
  const [model, setModel] = useState(van?.model ?? "");
  const [year, setYear] = useState(van?.year ? String(van.year) : "");
  const [plate, setPlate] = useState(van?.plate ?? "");
  const [color, setColor] = useState(van?.color ?? "");
  const [driver, setDriver] = useState(van?.assigned_driver ?? "");
  const [vin, setVin] = useState(van?.vin ?? "");
  const [odometer, setOdometer] = useState(van?.odometer ? String(van.odometer) : "");
  const [fuel, setFuel] = useState(van?.fuel_percent ? String(van.fuel_percent) : "");
  const [status, setStatus] = useState<"active" | "parked" | "maintenance">(van?.status ?? "parked");

  const updateM = trpc.fleet.updateVan.useMutation({
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e) => Alert.alert("Error", e.message),
  });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: DARK_BG }}>
        <View style={[styles.modalHeader, { borderBottomColor: BORDER }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={{ color: "#6B7280", fontSize: 16 }}>Cancel</Text>
          </TouchableOpacity>
          <Text style={{ color: "#fff", fontSize: 17, fontWeight: "700" }}>Edit Van</Text>
          <TouchableOpacity onPress={() => {
            if (!name.trim()) { Alert.alert("Required", "Van name is required."); return; }
            updateM.mutate({
              id: van.id, name: name.trim(),
              make: make.trim() || undefined, model: model.trim() || undefined,
              year: year ? parseInt(year) : undefined,
              plate: plate.trim() || undefined, color: color.trim() || undefined,
              vin: vin.trim() || undefined,
              assigned_driver: driver.trim() || undefined,
              odometer: odometer ? parseInt(odometer) : undefined,
              fuel_percent: fuel ? parseInt(fuel) : undefined,
              status,
            });
          }} disabled={updateM.isPending}>
            {updateM.isPending
              ? <ActivityIndicator size="small" color={BLUE} />
              : <Text style={{ color: BLUE, fontSize: 16, fontWeight: "700" }}>Save</Text>
            }
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
          <ModalField label="Van Name *" value={name} onChangeText={setName} placeholder="e.g. Van 1 – Niceville" />
          <ModalField label="Make" value={make} onChangeText={setMake} placeholder="e.g. Ford" />
          <ModalField label="Model" value={model} onChangeText={setModel} placeholder="e.g. Transit" />
          <ModalField label="Year" value={year} onChangeText={setYear} placeholder="e.g. 2022" keyboardType="numeric" />
          <ModalField label="License Plate" value={plate} onChangeText={setPlate} placeholder="e.g. ABC-1234" />
          <ModalField label="Color" value={color} onChangeText={setColor} placeholder="e.g. White" />
          <ModalField label="VIN" value={vin} onChangeText={setVin} placeholder="17-character VIN" />
          <ModalField label="Assigned Driver" value={driver} onChangeText={setDriver} placeholder="e.g. Casey" />
          <ModalField label="Odometer (mi)" value={odometer} onChangeText={setOdometer} keyboardType="numeric" placeholder="e.g. 45000" />
          <ModalField label="Fuel %" value={fuel} onChangeText={setFuel} keyboardType="numeric" placeholder="e.g. 75" />
          <View style={{ marginBottom: 12 }}>
            <Text style={styles.fieldLabel}>Status</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
              {(["active", "parked", "maintenance"] as const).map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => setStatus(s)}
                  style={[styles.typeChip, status === s && { backgroundColor: VAN_STATUS_COLORS[s] + "33", borderColor: VAN_STATUS_COLORS[s] }]}
                >
                  <Text style={[styles.typeChipText, status === s && { color: VAN_STATUS_COLORS[s] }]}>
                    {VAN_STATUS_LABELS[s]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={{ marginBottom: 12, padding: 12, borderRadius: 10, backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER }}>
            <Text style={[styles.fieldLabel, { marginBottom: 4 }]}>City / Location</Text>
            <Text style={{ color: "#6B7280", fontSize: 13 }}>City is managed from the Van Assignment tab on the Fleet screen.</Text>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function AdminFleetVanDetailScreen() {
  const { vanId } = useLocalSearchParams<{ vanId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const utils = trpc.useUtils();

  const [activeTab, setActiveTab] = useState<"overview" | "maintenance" | "fuel" | "trips">("overview");
  const [showAddMaint, setShowAddMaint] = useState(false);
  const [showAddFuel, setShowAddFuel] = useState(false);
  const [showAddTrip, setShowAddTrip] = useState(false);
  const [showEditVan, setShowEditVan] = useState(false);

  const { data: van, isLoading: vanLoading, refetch: refetchVan } =
    trpc.fleet.getVan.useQuery({ id: vanId ?? "" }, { enabled: !!vanId });

  const { data: maintenance = [], isLoading: maintLoading, refetch: refetchMaint } =
    trpc.fleet.listMaintenance.useQuery({ vanId: vanId ?? "" }, { enabled: !!vanId });

  const { data: fuelLogs = [], isLoading: fuelLoading, refetch: refetchFuel } =
    trpc.fleet.listFuelLogs.useQuery({ vanId: vanId ?? "" }, { enabled: !!vanId });

  const { data: trips = [], isLoading: tripsLoading, refetch: refetchTrips } =
    trpc.fleet.listTrips.useQuery({ vanId: vanId ?? "" }, { enabled: !!vanId });

  const deleteMaintM = trpc.fleet.deleteMaintenance.useMutation({ onSuccess: () => refetchMaint() });
  const deleteFuelM = trpc.fleet.deleteFuelLog.useMutation({ onSuccess: () => refetchFuel() });

  if (vanLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: DARK_BG, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={BLUE} />
      </View>
    );
  }

  if (!van) {
    return (
      <View style={{ flex: 1, backgroundColor: DARK_BG, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: "#fff", fontSize: 16 }}>Van not found.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: BLUE, fontSize: 15 }}>← Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const statusColor = VAN_STATUS_COLORS[van.status] ?? "#6B7280";
  const statusLabel = VAN_STATUS_LABELS[van.status] ?? van.status;

  const fuelColor = van.fuel_percent < 20 ? "#EF4444" : van.fuel_percent < 40 ? "#F59E0B" : "#22C55E";
  const battColor = van.battery_voltage < 12 ? "#EF4444" : van.battery_voltage < 12.4 ? "#F59E0B" : "#22C55E";

  return (
    <View style={{ flex: 1, backgroundColor: DARK_BG }}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8, borderBottomColor: BORDER }]}>
        <TouchableOpacity
          onPress={() => {
            router.replace("/(tabs)/admin-fleet-map" as any);
          }}
          style={styles.backBtn}
        >
          <Text style={styles.backText}>← Fleet</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, marginHorizontal: 12 }}>
          <Text style={styles.title} numberOfLines={1}>{van.name}</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {[van.year, van.make, van.model].filter(Boolean).join(" ") || "No vehicle info"}
          </Text>
        </View>
        <TouchableOpacity onPress={() => setShowEditVan(true)} style={styles.editBtn}>
          <Text style={styles.editBtnText}>Edit</Text>
        </TouchableOpacity>
      </View>

      {/* Status + City strip */}
      <View style={[styles.statusStrip, { borderBottomColor: BORDER }]}>
        <View style={[styles.statusBadge, { backgroundColor: statusColor + "22" }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        {van.city ? <Text style={styles.cityText}>📍 {van.city}</Text> : null}
        {van.plate ? <Text style={styles.plateText}>{van.plate}</Text> : null}
        {van.assigned_driver ? <Text style={styles.driverText}>👤 {van.assigned_driver}</Text> : null}
      </View>

      {/* Tab Bar */}
      <View style={[styles.tabBar, { borderBottomColor: BORDER }]}>
        {(["overview", "maintenance", "fuel", "trips"] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tabBtn, activeTab === tab && styles.tabBtnActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabLabel, activeTab === tab && styles.tabLabelActive]}>
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === "overview" && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
          {/* Health Stats */}
          <Text style={styles.sectionTitle}>Health Stats</Text>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            <StatCard icon="⛽" label="Fuel" value={van.fuel_percent > 0 ? `${van.fuel_percent}%` : "—"} color={fuelColor} />
            <StatCard icon="🔋" label="Battery" value={van.battery_voltage > 0 ? `${van.battery_voltage}V` : "—"} color={battColor} />
            <StatCard icon="⚠️" label="DTCs" value={String(van.dtc_count ?? 0)} color={van.dtc_count > 0 ? "#EF4444" : "#22C55E"} />
            <StatCard icon="📋" label="Recalls" value={String(van.recall_count ?? 0)} color={van.recall_count > 0 ? "#F59E0B" : "#22C55E"} />
          </View>

          {/* Odometer */}
          {van.odometer > 0 && (
            <View style={[styles.infoRow, { marginBottom: 16 }]}>
              <Text style={styles.infoLabel}>Odometer</Text>
              <Text style={styles.infoValue}>{van.odometer.toLocaleString()} mi</Text>
            </View>
          )}

          {/* Last Location */}
          {van.last_location && (
            <View style={[styles.infoCard, { marginBottom: 16 }]}>
              <Text style={styles.sectionTitle}>Last Known Location</Text>
              <Text style={styles.infoValue}>{van.last_location}</Text>
              {van.last_seen_at && (
                <Text style={styles.infoMuted}>Last seen: {formatDate(van.last_seen_at)}</Text>
              )}
              <TouchableOpacity
                style={[styles.dirBtn, { marginTop: 10 }]}
                onPress={() => {
                  const encoded = encodeURIComponent(van.last_location!);
                  const url = Platform.OS === "ios"
                    ? `maps://?daddr=${encoded}`
                    : `https://maps.google.com/?daddr=${encoded}`;
                  Linking.openURL(url);
                }}
              >
                <Text style={styles.dirBtnText}>🗺 Directions</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Vehicle Info */}
          <Text style={styles.sectionTitle}>Vehicle Info</Text>
          <View style={styles.infoCard}>
            {[
              { label: "Make / Model", value: [van.make, van.model].filter(Boolean).join(" ") || "—" },
              { label: "Year", value: van.year ? String(van.year) : "—" },
              { label: "Color", value: van.color || "—" },
              { label: "License Plate", value: van.plate || "—" },
              { label: "VIN", value: van.vin || "—" },
              { label: "Assigned Driver", value: van.assigned_driver || "—" },
              { label: "Device IMEI", value: van.device_imei || "—" },
            ].map(({ label, value }) => (
              <View key={label} style={styles.infoRow}>
                <Text style={styles.infoLabel}>{label}</Text>
                <Text style={styles.infoValue} numberOfLines={1}>{value}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      )}

      {/* ── MAINTENANCE TAB ── */}
      {activeTab === "maintenance" && (
        <View style={{ flex: 1 }}>
          <View style={styles.tabActionRow}>
            <Text style={styles.tabActionTitle}>
              {maintenance.length} Record{maintenance.length !== 1 ? "s" : ""}
            </Text>
            <TouchableOpacity
              style={[styles.addRowBtn, { backgroundColor: BLUE }]}
              onPress={() => setShowAddMaint(true)}
            >
              <Text style={styles.addRowBtnText}>+ Add Record</Text>
            </TouchableOpacity>
          </View>
          {maintLoading ? (
            <View style={styles.centered}><ActivityIndicator size="large" color={BLUE} /></View>
          ) : maintenance.length === 0 ? (
            <View style={styles.centered}>
              <Text style={{ fontSize: 36, marginBottom: 10 }}>🔧</Text>
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700", marginBottom: 6 }}>No Records Yet</Text>
              <Text style={{ color: "#6B7280", fontSize: 13, textAlign: "center" }}>
                Log the first maintenance record for this van.
              </Text>
            </View>
          ) : (
            <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
              data={maintenance}
              keyExtractor={(item: any) => item.id}
              renderItem={({ item }) => (
                <View style={[styles.recordCard, { marginHorizontal: 12, marginBottom: 8 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recordTitle}>{item.type}</Text>
                    <Text style={styles.recordSub}>{formatDate(item.service_date)}</Text>
                    {item.odometer_at_service && (
                      <Text style={styles.recordMeta}>📍 {item.odometer_at_service.toLocaleString()} mi</Text>
                    )}
                    {item.next_due_date && (
                      <Text style={styles.recordMeta}>⏭ Next: {formatDate(item.next_due_date)}</Text>
                    )}
                    {item.shop_name && (
                      <Text style={styles.recordMeta}>🏪 {item.shop_name}</Text>
                    )}
                    {item.notes && (
                      <Text style={styles.recordNote}>{item.notes}</Text>
                    )}
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    {item.cost != null && (
                      <Text style={styles.recordCost}>{formatCurrency(item.cost)}</Text>
                    )}
                    <TouchableOpacity
                      onPress={() => Alert.alert("Delete", "Remove this record?", [
                        { text: "Cancel" },
                        { text: "Delete", style: "destructive", onPress: () => deleteMaintM.mutate({ id: item.id }) },
                      ])}
                    >
                      <Text style={{ color: "#EF4444", fontSize: 12 }}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + 80 }}
            />
          )}
        </View>
      )}

      {/* ── FUEL LOG TAB ── */}
      {activeTab === "fuel" && (
        <View style={{ flex: 1 }}>
          <View style={styles.tabActionRow}>
            <Text style={styles.tabActionTitle}>
              {fuelLogs.length} Fill-up{fuelLogs.length !== 1 ? "s" : ""}
            </Text>
            <TouchableOpacity
              style={[styles.addRowBtn, { backgroundColor: BLUE }]}
              onPress={() => setShowAddFuel(true)}
            >
              <Text style={styles.addRowBtnText}>+ Add Fill-up</Text>
            </TouchableOpacity>
          </View>
          {fuelLoading ? (
            <View style={styles.centered}><ActivityIndicator size="large" color={BLUE} /></View>
          ) : fuelLogs.length === 0 ? (
            <View style={styles.centered}>
              <Text style={{ fontSize: 36, marginBottom: 10 }}>⛽</Text>
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700", marginBottom: 6 }}>No Fuel Logs</Text>
              <Text style={{ color: "#6B7280", fontSize: 13, textAlign: "center" }}>
                Track fuel fill-ups to monitor costs and efficiency.
              </Text>
            </View>
          ) : (
            <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
              data={fuelLogs}
              keyExtractor={(item: any) => item.id}
              renderItem={({ item }) => (
                <View style={[styles.recordCard, { marginHorizontal: 12, marginBottom: 8 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recordTitle}>{formatDate(item.log_date)}</Text>
                    {item.station && <Text style={styles.recordSub}>{item.station}</Text>}
                    {item.gallons != null && (
                      <Text style={styles.recordMeta}>⛽ {Number(item.gallons).toFixed(2)} gal</Text>
                    )}
                    {item.cost_per_gallon != null && (
                      <Text style={styles.recordMeta}>💲 ${Number(item.cost_per_gallon).toFixed(3)}/gal</Text>
                    )}
                    {item.odometer != null && (
                      <Text style={styles.recordMeta}>📍 {item.odometer.toLocaleString()} mi</Text>
                    )}
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    {item.total_cost != null && (
                      <Text style={styles.recordCost}>{formatCurrency(item.total_cost)}</Text>
                    )}
                    <TouchableOpacity
                      onPress={() => Alert.alert("Delete", "Remove this fuel log?", [
                        { text: "Cancel" },
                        { text: "Delete", style: "destructive", onPress: () => deleteFuelM.mutate({ id: item.id }) },
                      ])}
                    >
                      <Text style={{ color: "#EF4444", fontSize: 12 }}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + 80 }}
            />
          )}
        </View>
      )}

      {/* ── TRIPS TAB ── */}
      {activeTab === "trips" && (
        <View style={{ flex: 1 }}>
          <View style={styles.tabActionRow}>
            <Text style={styles.tabActionTitle}>
              {trips.length} Trip{trips.length !== 1 ? "s" : ""}
            </Text>
            <TouchableOpacity
              style={[styles.addRowBtn, { backgroundColor: BLUE }]}
              onPress={() => setShowAddTrip(true)}
            >
              <Text style={styles.addRowBtnText}>+ Log Trip</Text>
            </TouchableOpacity>
          </View>
          {tripsLoading ? (
            <View style={styles.centered}><ActivityIndicator size="large" color={BLUE} /></View>
          ) : trips.length === 0 ? (
            <View style={styles.centered}>
              <Text style={{ fontSize: 36, marginBottom: 10 }}>🗺</Text>
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700", marginBottom: 6 }}>No Trips Logged</Text>
              <Text style={{ color: "#6B7280", fontSize: 13, textAlign: "center" }}>
                Log trips to track mileage and routes.
              </Text>
            </View>
          ) : (
            <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
              data={trips}
              keyExtractor={(item: any) => item.id}
              renderItem={({ item }) => (
                <View style={[styles.recordCard, { marginHorizontal: 12, marginBottom: 8 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recordTitle}>{formatDate(item.trip_date)}</Text>
                    {item.start_address && (
                      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4, marginTop: 4 }}>
                        <Text style={{ color: "#22C55E", fontSize: 11, fontWeight: "700", marginTop: 1 }}>FROM</Text>
                        <Text style={[styles.recordSub, { flex: 1 }]}>{item.start_address}</Text>
                      </View>
                    )}
                    {item.end_address && (
                      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4, marginTop: 2 }}>
                        <Text style={{ color: "#EF4444", fontSize: 11, fontWeight: "700", marginTop: 1 }}>TO</Text>
                        <Text style={[styles.recordSub, { flex: 1 }]}>{item.end_address}</Text>
                      </View>
                    )}
                    <View style={{ flexDirection: "row", gap: 12, marginTop: 6 }}>
                      {item.duration_minutes != null && (
                        <Text style={styles.recordMeta}>⏱ {item.duration_minutes} min</Text>
                      )}
                      {item.distance_miles != null && (
                        <Text style={styles.recordMeta}>📏 {Number(item.distance_miles).toFixed(1)} mi</Text>
                      )}
                    </View>
                  </View>
                </View>
              )}
              contentContainerStyle={{ paddingTop: 8, paddingBottom: insets.bottom + 80 }}
            />
          )}
        </View>
      )}

      {/* Modals */}
      <AddMaintenanceModal
        visible={showAddMaint}
        vanId={vanId ?? ""}
        onClose={() => setShowAddMaint(false)}
        onSaved={() => refetchMaint()}
      />
      <AddFuelModal
        visible={showAddFuel}
        vanId={vanId ?? ""}
        onClose={() => setShowAddFuel(false)}
        onSaved={() => refetchFuel()}
      />
      <AddTripModal
        visible={showAddTrip}
        vanId={vanId ?? ""}
        onClose={() => setShowAddTrip(false)}
        onSaved={() => refetchTrips()}
      />
      {van && (
        <EditVanModal
          visible={showEditVan}
          van={van}
          onClose={() => setShowEditVan(false)}
          onSaved={() => {
            refetchVan();
            // Invalidate the fleet list so VanCards on the Fleet screen show updated data
            utils.fleet.listVans.invalidate();
          }}
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: DARK_BG, borderBottomWidth: 0.5,
  },
  backBtn: { paddingRight: 8 },
  backText: { color: BLUE, fontSize: 15, fontWeight: "600" },
  title: { fontSize: 18, fontWeight: "800", color: "#fff" },
  subtitle: { fontSize: 12, color: "#6B7280", marginTop: 1 },
  editBtn: {
    paddingHorizontal: 14, paddingVertical: 6,
    borderRadius: 16, borderWidth: 1, borderColor: BORDER,
  },
  editBtnText: { color: "#9CA3AF", fontSize: 13, fontWeight: "600" },
  statusStrip: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: DARK_BG, borderBottomWidth: 0.5, flexWrap: "wrap",
  },
  statusBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontWeight: "700" },
  cityText: { fontSize: 12, color: "#9CA3AF" },
  plateText: { fontSize: 12, color: "#6B7280", backgroundColor: CARD_BG, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  driverText: { fontSize: 12, color: "#9CA3AF" },
  tabBar: {
    flexDirection: "row", backgroundColor: DARK_BG, borderBottomWidth: 0.5,
  },
  tabBtn: {
    flex: 1, paddingVertical: 11, alignItems: "center",
    borderBottomWidth: 2, borderBottomColor: "transparent",
  },
  tabBtnActive: { borderBottomColor: BLUE },
  tabLabel: { fontSize: 12, fontWeight: "600", color: "#6B7280" },
  tabLabelActive: { color: "#fff" },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  infoCard: {
    backgroundColor: CARD_BG, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: BORDER, marginBottom: 16,
  },
  infoRow: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: BORDER,
  },
  infoLabel: { fontSize: 13, color: "#6B7280" },
  infoValue: { fontSize: 13, color: "#fff", fontWeight: "600", maxWidth: "60%", textAlign: "right" },
  infoMuted: { fontSize: 12, color: "#6B7280", marginTop: 4 },
  dirBtn: {
    backgroundColor: BLUE, paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, alignSelf: "flex-start",
  },
  dirBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  tabActionRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: BORDER,
  },
  tabActionTitle: { fontSize: 14, fontWeight: "700", color: "#9CA3AF" },
  addRowBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20 },
  addRowBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  recordCard: {
    backgroundColor: CARD_BG, borderRadius: 10, padding: 14,
    flexDirection: "row", alignItems: "flex-start",
    borderWidth: 1, borderColor: BORDER,
  },
  recordTitle: { fontSize: 14, fontWeight: "700", color: "#fff", marginBottom: 2 },
  recordSub: { fontSize: 12, color: "#9CA3AF" },
  recordMeta: { fontSize: 12, color: "#6B7280", marginTop: 3 },
  recordNote: { fontSize: 12, color: "#6B7280", fontStyle: "italic", marginTop: 4 },
  recordCost: { fontSize: 15, fontWeight: "800", color: "#22C55E" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5,
  },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: "#9CA3AF", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  fieldInput: {
    backgroundColor: CARD_BG, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    color: "#fff", fontSize: 15, borderWidth: 1, borderColor: BORDER,
  },
  typeChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    borderWidth: 1, borderColor: BORDER, backgroundColor: CARD_BG,
  },
  typeChipText: { fontSize: 13, fontWeight: "600", color: "#9CA3AF" },
});
