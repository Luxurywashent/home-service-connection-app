import { useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Modal, KeyboardAvoidingView, Platform } from "react-native";
import { TextInput } from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useCustomerAuth } from "@/lib/customer-context";
import { useBooking, type VehicleType } from "@/lib/booking-context";
import { trpc } from "@/lib/trpc";
import { MaterialIcons } from "@expo/vector-icons";

const VEHICLE_TYPES = [
  { id: "sedan" as VehicleType, label: "Sedan / Coupe" },
  { id: "suv" as VehicleType, label: "SUV / Crossover" },
  { id: "large_suv_van" as VehicleType, label: "Large SUV / Van" },
  { id: "truck" as VehicleType, label: "Truck" },
  { id: "rv" as VehicleType, label: "RV / Motorhome / Trailer" },
];

export default function BookVehicleStep() {
  const router = useRouter();
  const { token } = useCustomerAuth();
  const { setVehicle, setGuestInfo } = useBooking();
  const [showAdd, setShowAdd] = useState(false);
  const [vYear, setVYear] = useState("");
  const [vMake, setVMake] = useState("");
  const [vModel, setVModel] = useState("");
  const [vType, setVType] = useState<VehicleType>("sedan");
  const [vColor, setVColor] = useState("");
  const [vRvClass, setVRvClass] = useState("");
  const [vRvLength, setVRvLength] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const RV_CLASSES = ["Class A", "Class B", "Class C", "Fifth Wheel", "Bumper Pull Trailer"];

  const vehiclesQuery = trpc.customer.listVehicles.useQuery(
    { token: token ?? "" },
    { enabled: !!token }
  );

  const addVehicleMutation = trpc.customer.addVehicle.useMutation({
    onSuccess: () => {
      vehiclesQuery.refetch();
      setShowAdd(false);
      resetForm();
    },
  });

  function resetForm() {
    setVYear(""); setVMake(""); setVModel(""); setVType("sedan"); setVColor("");
    setVRvClass(""); setVRvLength("");
  }

  function handleSelectVehicle(v: any) {
    setVehicle({
      vehicleId: v.vehicleId,
      year: v.year,
      make: v.make,
      model: v.model,
      vehicleType: v.vehicleType,
      color: v.color,
      label: `${v.year} ${v.make} ${v.model}`,
      rvClass: v.rvClass ?? null,
      rvLengthFt: v.rvLengthFt ?? null,
    });
    router.push("/(customer)/book/package" as any);
  }

  // Guest flow: select vehicle inline without saving to DB
  function handleGuestContinue() {
    if (!vYear.trim() || !vMake.trim() || !vModel.trim()) return;
    if (vType === "rv" && (!vRvClass || !vRvLength.trim())) return;
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim()) return;
    setVehicle({
      vehicleId: `guest_${Date.now()}`,
      year: vYear.trim(),
      make: vMake.trim(),
      model: vModel.trim(),
      vehicleType: vType,
      color: vColor.trim() || null,
      label: `${vYear.trim()} ${vMake.trim()} ${vModel.trim()}`,
      rvClass: vType === "rv" ? vRvClass : null,
      rvLengthFt: vType === "rv" && vRvLength ? Number(vRvLength) : null,
    });
    setGuestInfo({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: phone.trim(),
    });
    router.push("/(customer)/book/package" as any);
  }

  async function handleAddAndSelect() {
    if (!vYear.trim() || !vMake.trim() || !vModel.trim()) return;
    if (vType === "rv") {
      if (!vRvClass) { return; }
      if (!vRvLength.trim() || isNaN(Number(vRvLength)) || Number(vRvLength) <= 0) { return; }
    }
    const result = await addVehicleMutation.mutateAsync({
      token: token ?? "",
      year: vYear.trim(),
      make: vMake.trim(),
      model: vModel.trim(),
      vehicleType: vType as any,
      color: vColor.trim() || undefined,
      rvClass: vType === "rv" ? vRvClass : undefined,
      rvLengthFt: vType === "rv" && vRvLength.trim() ? parseInt(vRvLength.trim()) : undefined,
      isDefault: (vehiclesQuery.data?.length ?? 0) === 0,
    });
    if (result) {
      setVehicle({
        vehicleId: result.vehicleId,
        year: result.year,
        make: result.make,
        model: result.model,
        vehicleType: result.vehicleType as VehicleType,
        color: result.color,
        label: `${result.year} ${result.make} ${result.model}`,
        rvClass: (result as any).rvClass ?? null,
        rvLengthFt: (result as any).rvLengthFt ?? null,
      });
      router.push("/(customer)/book/package" as any);
    }
  }

  // ── Guest flow: inline form (no saved vehicles) ──────────────────────────
  if (!token) {
    const guestFormValid = !!vYear.trim() && !!vMake.trim() && !!vModel.trim() &&
      (vType !== "rv" || (!!vRvClass && !!vRvLength.trim())) &&
      !!firstName.trim() && !!lastName.trim() && !!email.trim() && !!phone.trim();
    return (
      <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-white">
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <MaterialIcons name="arrow-back" size={24} color="#1A1A1A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Your Vehicle</Text>
          <View style={{ width: 24 }} />
        </View>
        <StepIndicator current={1} total={5} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
          <Text style={styles.sectionTitle}>Which vehicle are we detailing?</Text>
          <Text style={styles.sectionSub}>Pricing is based on vehicle size.</Text>
          <Field label="Year" value={vYear} onChange={setVYear} placeholder="e.g. 2022" keyboardType="numeric" />
          <Field label="Make" value={vMake} onChange={setVMake} placeholder="e.g. Toyota" />
          <Field label="Model" value={vModel} onChange={setVModel} placeholder="e.g. Camry" />
          <Field label="Color (optional)" value={vColor} onChange={setVColor} placeholder="e.g. Silver" />
          <Text style={styles.fieldLabel}>Vehicle Type</Text>
          <View style={styles.typeGrid}>
            {VEHICLE_TYPES.map((t) => (
              <TouchableOpacity
                key={t.id}
                style={[styles.typeChip, vType === t.id && styles.typeChipActive]}
                onPress={() => setVType(t.id)}
                activeOpacity={0.8}
              >
                <Text style={[styles.typeChipText, vType === t.id && styles.typeChipTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {vType === "rv" && (
            <>
              <Text style={styles.fieldLabel}>RV Class</Text>
              <View style={styles.typeGrid}>
                {RV_CLASSES.map((cls) => (
                  <TouchableOpacity
                    key={cls}
                    style={[styles.typeChip, vRvClass === cls && styles.typeChipActive]}
                    onPress={() => setVRvClass(cls)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.typeChipText, vRvClass === cls && styles.typeChipTextActive]}>{cls}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Field
                label="Length (feet)"
                value={vRvLength}
                onChange={setVRvLength}
                placeholder="e.g. 35"
                keyboardType="numeric"
              />
            </>
          )}
          <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Your Contact Info</Text>
          <View style={styles.twoColumnRow}>
            <View style={styles.twoColumnField}>
              <Field label="First Name" value={firstName} onChange={setFirstName} placeholder="Jane" />
            </View>
            <View style={styles.twoColumnField}>
              <Field label="Last Name" value={lastName} onChange={setLastName} placeholder="Smith" />
            </View>
          </View>
          <Field label="Email" value={email} onChange={setEmail} placeholder="jane@example.com" keyboardType="email-address" />
          <Field label="Phone" value={phone} onChange={setPhone} placeholder="(555) 000-0000" keyboardType="phone-pad" />
          <TouchableOpacity
            style={[styles.saveBtn, !guestFormValid && { opacity: 0.5 }]}
            onPress={handleGuestContinue}
            disabled={!guestFormValid}
            activeOpacity={0.85}
          >
            <Text style={styles.saveBtnText}>Continue</Text>
          </TouchableOpacity>
          <Text style={styles.infoNote}>We'll send your booking confirmation to the email address above.</Text>
        </ScrollView>
        </KeyboardAvoidingView>
      </ScreenContainer>
    );
  }

  // ── Authenticated flow: show saved vehicles list ─────────────────────────
  return (
    <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-white">
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <MaterialIcons name="arrow-back" size={24} color="#1A1A1A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Select Vehicle</Text>
        <View style={{ width: 24 }} />
      </View>

      {/* Step indicator */}
      <StepIndicator current={1} total={5} />

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
        <Text style={styles.sectionTitle}>Which vehicle are we detailing?</Text>
        <Text style={styles.sectionSub}>Pricing is based on vehicle size.</Text>

        {vehiclesQuery.isLoading ? (
          <ActivityIndicator size="large" color="#1A1A1A" style={{ marginTop: 40 }} />
        ) : vehiclesQuery.data?.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialIcons name="directions-car" size={48} color="#E5E7EB" />
            <Text style={styles.emptyText}>No vehicles saved yet.</Text>
            <Text style={styles.emptySubText}>Add your vehicle to get started.</Text>
          </View>
        ) : (
          vehiclesQuery.data?.map((v) => (
            <TouchableOpacity
              key={v.vehicleId}
              style={styles.vehicleCard}
              onPress={() => handleSelectVehicle(v)}
              activeOpacity={0.85}
            >
              <View style={styles.vehicleIcon}>
                <MaterialIcons name="directions-car" size={24} color="#1A1A1A" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.vehicleName}>{v.year} {v.make} {v.model}</Text>
                <Text style={styles.vehicleType}>
                  {VEHICLE_TYPES.find(t => t.id === v.vehicleType)?.label ?? v.vehicleType}
                  {v.vehicleType === "rv" && (v as any).rvClass ? ` · ${(v as any).rvClass}` : ""}
                  {v.vehicleType === "rv" && (v as any).rvLengthFt ? ` · ${(v as any).rvLengthFt} ft` : ""}
                  {v.color ? ` · ${v.color}` : ""}
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color="#9CA3AF" />
            </TouchableOpacity>
          ))
        )}

        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => setShowAdd(true)}
          activeOpacity={0.85}
        >
          <MaterialIcons name="add" size={20} color="#1A1A1A" />
          <Text style={styles.addBtnText}>Add a Vehicle</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Add Vehicle Modal */}
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Vehicle</Text>
            <TouchableOpacity onPress={() => { setShowAdd(false); resetForm(); }}>
              <MaterialIcons name="close" size={24} color="#1A1A1A" />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <Field label="Year" value={vYear} onChange={setVYear} placeholder="e.g. 2022" keyboardType="numeric" />
            <Field label="Make" value={vMake} onChange={setVMake} placeholder="e.g. Toyota" />
            <Field label="Model" value={vModel} onChange={setVModel} placeholder="e.g. Camry" />
            <Field label="Color (optional)" value={vColor} onChange={setVColor} placeholder="e.g. Silver" />

            <Text style={styles.fieldLabel}>Vehicle Type</Text>
            <View style={styles.typeGrid}>
              {VEHICLE_TYPES.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.typeChip, vType === t.id && styles.typeChipActive]}
                  onPress={() => setVType(t.id)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.typeChipText, vType === t.id && styles.typeChipTextActive]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {vType === "rv" && (
              <>
                <Text style={styles.fieldLabel}>RV Class</Text>
                <View style={styles.typeGrid}>
                  {RV_CLASSES.map((cls) => (
                    <TouchableOpacity
                      key={cls}
                      style={[styles.typeChip, vRvClass === cls && styles.typeChipActive]}
                      onPress={() => setVRvClass(cls)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.typeChipText, vRvClass === cls && styles.typeChipTextActive]}>{cls}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Field
                  label="Length (feet)"
                  value={vRvLength}
                  onChange={setVRvLength}
                  placeholder="e.g. 35"
                  keyboardType="numeric"
                />
              </>
            )}

            <TouchableOpacity
              style={[styles.saveBtn, (!vYear || !vMake || !vModel || (vType === "rv" && (!vRvClass || !vRvLength))) && { opacity: 0.5 }]}
              onPress={handleAddAndSelect}
              disabled={addVehicleMutation.isPending || !vYear || !vMake || !vModel || (vType === "rv" && (!vRvClass || !vRvLength))}
              activeOpacity={0.85}
            >
              {addVehicleMutation.isPending ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.saveBtnText}>Save & Continue</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

function Field({ label, value, onChange, placeholder, keyboardType = "default" }: any) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        keyboardType={keyboardType}
        style={styles.input}
        returnKeyType="next"
      />
    </View>
  );
}

export function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <View style={stepStyles.container}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[stepStyles.dot, i + 1 === current && stepStyles.dotActive, i + 1 < current && stepStyles.dotDone]}
        />
      ))}
      <Text style={stepStyles.label}>Step {current} of {total}</Text>
    </View>
  );
}

const stepStyles = StyleSheet.create({
  container: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 16, gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#E5E7EB" },
  dotActive: { backgroundColor: "#1A1A1A", width: 24, borderRadius: 4 },
  dotDone: { backgroundColor: "#6B7280" },
  label: { fontSize: 12, color: "#9CA3AF", marginLeft: 8 },
});

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#1A1A1A" },
  sectionTitle: { fontSize: 22, fontWeight: "800", color: "#1A1A1A", marginBottom: 4 },
  sectionSub: { fontSize: 14, color: "#9CA3AF", marginBottom: 24 },
  emptyState: { alignItems: "center", paddingVertical: 40, gap: 8 },
  emptyText: { fontSize: 16, fontWeight: "600", color: "#6B7280" },
  emptySubText: { fontSize: 13, color: "#9CA3AF" },
  vehicleCard: { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: 16, borderWidth: 1, borderColor: "#F0F0F0", marginBottom: 12, backgroundColor: "#FFFFFF", gap: 12 },
  vehicleIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#F5F5F5", justifyContent: "center", alignItems: "center" },
  vehicleName: { fontSize: 16, fontWeight: "700", color: "#1A1A1A" },
  vehicleType: { fontSize: 13, color: "#9CA3AF", marginTop: 2 },
  addBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 16, borderRadius: 16, borderWidth: 1.5, borderColor: "#E5E7EB", borderStyle: "dashed", marginTop: 4 },
  addBtnText: { fontSize: 15, fontWeight: "600", color: "#1A1A1A" },
  modal: { flex: 1, backgroundColor: "#FFFFFF" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1, borderBottomColor: "#F0F0F0", paddingTop: 56 },
  modalTitle: { fontSize: 20, fontWeight: "800", color: "#1A1A1A" },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
  input: { backgroundColor: "#F9FAFB", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: "#1A1A1A" },
  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 },
  typeChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 100, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#FFFFFF" },
  typeChipActive: { borderColor: "#1A1A1A", backgroundColor: "#1A1A1A" },
  typeChipText: { fontSize: 13, fontWeight: "600", color: "#374151" },
  typeChipTextActive: { color: "#FFFFFF" },
  saveBtn: { backgroundColor: "#1A1A1A", borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  saveBtnText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
  twoColumnRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
  twoColumnField: { flex: 1 },
  infoNote: { fontSize: 13, color: "#0a7ea4", textAlign: "center", marginTop: 12, fontWeight: "500" },
});
