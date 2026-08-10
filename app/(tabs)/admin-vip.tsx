import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  FlatList,
  ActivityIndicator,
  Alert,
  StyleSheet,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
  Linking,
  Switch,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useFocusEffect } from "expo-router";
import { trpc } from "@/lib/trpc";

const API_BASE = "https://luxwashapp-n2wveyqg.manus.space";

// ─── Types ────────────────────────────────────────────────────────────────────
type ContractStatus = "pending_signature" | "active" | "expired" | "cancelled";

interface VipVisit {
  id: number;
  visit_number: number;
  scheduled_date: string | null;
  scheduled_time: string | null;
  status: "scheduled" | "completed" | "missed" | "cancelled";
  add_ons: string[];
  notes: string | null;
  completed_at: string | null;
  is_replacement?: number; // 1 = replacement for a missed visit
  replaced_visit_id?: number | null;
}

interface VipContract {
  id: number;
  contract_number: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  vehicle_description: string | null;
  city: string | null;
  start_date: string;
  end_date: string;
  total_price: string;
  status: ContractStatus;
  signed_at: string | null;
  rep_name: string | null;
  renewal_notified: number;
  notes: string | null;
  signature_token?: string;
  created_at: string;
  frequency?: "monthly" | "biweekly";
  program_type?: "vip" | "maintenance" | "vip_elite";
  visits?: VipVisit[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtMonth(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function daysUntil(d: string | null): number {
  if (!d) return 999;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

function statusColor(status: ContractStatus, colors: any): string {
  switch (status) {
    case "active": return colors.success;
    case "pending_signature": return colors.warning;
    case "expired": return colors.muted;
    case "cancelled": return colors.error;
    default: return colors.muted;
  }
}

function statusLabel(status: ContractStatus): string {
  switch (status) {
    case "active": return "Active";
    case "pending_signature": return "Awaiting Signature";
    case "expired": return "Expired";
    case "cancelled": return "Cancelled";
    default: return status;
  }
}

function visitStatusIcon(status: string): string {
  switch (status) {
    case "completed": return "✅";
    case "missed": return "❌";
    case "cancelled": return "🚫";
    default: return "📅";
  }
}

// ─── API calls ────────────────────────────────────────────────────────────────
async function apiGet(path: string) {
  const r = await fetch(`${API_BASE}/api/vip${path}`);
  return r.json();
}

async function apiPost(path: string, body: any) {
  const r = await fetch(`${API_BASE}/api/vip${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

// ─── New Contract Form ────────────────────────────────────────────────────────
interface NewContractFormProps {
  visible: boolean;
  onClose: () => void;
  onCreated: (contract: any) => void;
}

function NewContractForm({ visible, onClose, onCreated }: NewContractFormProps) {
  const colors = useColors();
  const [form, setForm] = useState({
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    customerAddress: "",
    vehicleDescription: "",
    city: "",
    startDate: new Date().toISOString().split("T")[0],
    serviceStartDate: "",
    totalPrice: "",
    repName: "",
    notes: "",
  });
  // Program type: vip (full service + add-ons), maintenance (standard service only), or vip_elite (2 luxury + 10 basic)
  const [programType, setProgramType] = useState<"vip" | "maintenance" | "vip_elite">("vip");
  // Frequency: monthly (12 visits/yr) or biweekly (26 visits/yr)
  const [frequency, setFrequency] = useState<"monthly" | "biweekly">("monthly");
  // Scheduling: week of month (1-5) and day of week (0-6)
  const [scheduleWeek, setScheduleWeek] = useState<number | null>(null);
  const [scheduleDay, setScheduleDay] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showServiceStartPicker, setShowServiceStartPicker] = useState(false);
  const [autoCreateJobs, setAutoCreateJobs] = useState(true);

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.customerName.trim()) e.customerName = "Required";
    if (!form.customerEmail.trim()) e.customerEmail = "Required — used to link contract to customer account";
    else if (!/^[^@]+@[^@]+\.[^@]+$/.test(form.customerEmail.trim())) e.customerEmail = "Enter a valid email address";
    if (!form.vehicleDescription.trim()) e.vehicleDescription = "Required";
    if (!form.startDate) e.startDate = "Required";
    if (!form.totalPrice || isNaN(Number(form.totalPrice)) || Number(form.totalPrice) <= 0) {
      e.totalPrice = "Enter a valid price";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const data = await apiPost("/create", {
        ...form,
        totalPrice: Number(form.totalPrice),
        scheduleWeek: scheduleWeek,
        scheduleDay: scheduleDay,
        frequency,
        programType,
        autoCreateJobs,
      });
      if (data.success) {
        onCreated(data);
        setForm({
          customerName: "", customerEmail: "", customerPhone: "",
          customerAddress: "", vehicleDescription: "", city: "",
          startDate: new Date().toISOString().split("T")[0],
          serviceStartDate: "",
          totalPrice: "", repName: "", notes: "",
        });
        setScheduleWeek(null);
        setScheduleDay(null);
        setFrequency("monthly");
        setProgramType("vip");
        setAutoCreateJobs(true);
      } else {
        Alert.alert("Error", data.error ?? "Failed to create contract");
      }
    } catch {
      Alert.alert("Error", "Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const s = styles(colors);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.modalContainer, { backgroundColor: colors.background }]}>
        <View style={s.modalHeader}>
          <TouchableOpacity onPress={onClose} style={s.modalCloseBtn}>
            <Text style={{ color: colors.primary, fontSize: 16 }}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[s.modalTitle, { color: colors.foreground }]}>
            {programType === "maintenance" ? "New Maintenance Contract" : programType === "vip_elite" ? "New VIP Elite Contract" : "New VIP Contract"}
          </Text>
          <TouchableOpacity onPress={submit} disabled={loading} style={s.modalSaveBtn}>
            {loading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={{ color: colors.primary, fontSize: 16, fontWeight: "700" }}>Create</Text>
            )}
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
            {/* Program Type Selector */}
            <Text style={s.sectionHeader}>Program Type</Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              {(["vip", "vip_elite", "maintenance"] as const).map(opt => {
                const isSelected = programType === opt;
                const color = opt === "vip" ? "#7C3AED" : opt === "vip_elite" ? "#D97706" : "#059669";
                const icon = opt === "vip" ? "⭐" : opt === "vip_elite" ? "👑" : "🔧";
                const label = opt === "vip" ? "VIP Program" : opt === "vip_elite" ? "VIP Elite" : "Maintenance";
                const sub = opt === "vip" ? "Full service + premium add-ons" : opt === "vip_elite" ? "2 Luxury + 10 Basic details" : "Standard service only";
                return (
                  <TouchableOpacity
                    key={opt}
                    onPress={() => setProgramType(opt)}
                    style={[{
                      flex: 1, minWidth: 90, paddingVertical: 12, borderRadius: 12, borderWidth: 2, alignItems: "center",
                      borderColor: isSelected ? color : colors.border,
                      backgroundColor: isSelected ? color : colors.surface,
                    }]}
                  >
                    <Text style={{ fontSize: 20, marginBottom: 4 }}>{icon}</Text>
                    <Text style={{ color: isSelected ? "#fff" : colors.foreground, fontWeight: "800", fontSize: 13 }}>{label}</Text>
                    <Text style={{ color: isSelected ? "rgba(255,255,255,0.8)" : colors.muted, fontSize: 10, marginTop: 2, textAlign: "center", paddingHorizontal: 4 }}>{sub}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={s.sectionHeader}>Customer Information</Text>
            <FormField label="Customer Name *" value={form.customerName} onChange={v => set("customerName", v)} error={errors.customerName} colors={colors} />
            <FormField label="Email * (links contract to customer account)" value={form.customerEmail} onChange={v => set("customerEmail", v)} keyboardType="email-address" error={errors.customerEmail} colors={colors} />
            <FormField label="Phone" value={form.customerPhone} onChange={v => set("customerPhone", v)} keyboardType="phone-pad" colors={colors} />
            <FormField label="Address" value={form.customerAddress} onChange={v => set("customerAddress", v)} colors={colors} />

            <Text style={[s.sectionHeader, { marginTop: 20 }]}>Vehicle & Service</Text>
            <FormField label="Vehicle Description *" value={form.vehicleDescription} onChange={v => set("vehicleDescription", v)} placeholder="e.g. 2022 Toyota Camry Silver" error={errors.vehicleDescription} colors={colors} />
            <FormField label="City" value={form.city} onChange={v => set("city", v)} placeholder="e.g. Crestview" colors={colors} />

            <Text style={[s.sectionHeader, { marginTop: 20 }]}>Contract Terms</Text>
            {/* Contract Date picker */}
            <Text style={[s.fieldLabel, { marginBottom: 6 }]}>Contract Date *</Text>
            <TouchableOpacity
              onPress={() => setShowStartDatePicker(true)}
              style={[s.input, { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 }]}
              activeOpacity={0.8}
            >
              <Text style={{ fontSize: 16 }}>📅</Text>
              <Text style={{ color: form.startDate ? colors.foreground : colors.muted, flex: 1 }}>
                {form.startDate || "Select contract date"}
              </Text>
            </TouchableOpacity>
            {errors.startDate ? <Text style={{ color: colors.error, fontSize: 12, marginBottom: 8 }}>{errors.startDate}</Text> : null}
            {showStartDatePicker && (
              <>
                <DateTimePicker
                  value={form.startDate ? new Date(form.startDate) : new Date()}
                  mode="date"
                  display="inline"
                  onChange={(_, date) => {
                    if (date) set("startDate", date.toISOString().split("T")[0]);
                  }}
                  style={{ marginBottom: 4 }}
                />
                <TouchableOpacity onPress={() => setShowStartDatePicker(false)} style={{ alignSelf: "flex-end", paddingVertical: 8, paddingHorizontal: 16, backgroundColor: colors.primary, borderRadius: 8, marginBottom: 12 }}>
                  <Text style={{ color: "#fff", fontWeight: "700" }}>Done</Text>
                </TouchableOpacity>
              </>
            )}
            {/* Service Start Date picker */}
            <Text style={[s.fieldLabel, { marginBottom: 6 }]}>Service Start Date</Text>
            <TouchableOpacity
              onPress={() => setShowServiceStartPicker(true)}
              style={[s.input, { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12 }]}
              activeOpacity={0.8}
            >
              <Text style={{ fontSize: 16 }}>📅</Text>
              <Text style={{ color: form.serviceStartDate ? colors.foreground : colors.muted, flex: 1 }}>
                {form.serviceStartDate || "Same as contract date"}
              </Text>
              {form.serviceStartDate ? (
                <TouchableOpacity onPress={() => set("serviceStartDate", "")}>
                  <Text style={{ color: colors.muted, fontSize: 18 }}>✕</Text>
                </TouchableOpacity>
              ) : null}
            </TouchableOpacity>
            <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4, marginBottom: 8 }}>Service Start Date is when the first recurring job begins. Leave blank to use the contract date.</Text>
            {showServiceStartPicker && (
              <>
                <DateTimePicker
                  value={form.serviceStartDate ? new Date(form.serviceStartDate) : new Date()}
                  mode="date"
                  display="inline"
                  onChange={(_, date) => {
                    if (date) set("serviceStartDate", date.toISOString().split("T")[0]);
                  }}
                  style={{ marginBottom: 4 }}
                />
                <TouchableOpacity onPress={() => setShowServiceStartPicker(false)} style={{ alignSelf: "flex-end", paddingVertical: 8, paddingHorizontal: 16, backgroundColor: colors.primary, borderRadius: 8, marginBottom: 12 }}>
                  <Text style={{ color: "#fff", fontWeight: "700" }}>Done</Text>
                </TouchableOpacity>
              </>
            )}
            <FormField label="Total Price (upfront) *" value={form.totalPrice} onChange={v => set("totalPrice", v)} keyboardType="decimal-pad" placeholder="e.g. 1200" error={errors.totalPrice} prefix="$" colors={colors} />
            <FormField label="Rep Name" value={form.repName} onChange={v => set("repName", v)} placeholder="Luxury Wash On Wheels" colors={colors} />
            <FormField label="Internal Notes" value={form.notes} onChange={v => set("notes", v)} multiline colors={colors} />

            {/* Auto-Schedule Preferences */}
            <Text style={[s.sectionHeader, { marginTop: 20 }]}>🔁 Service Frequency</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 10 }}>
              How often does this customer receive service? Monthly = 12 visits/year. Biweekly = every 2 weeks (26 visits/year).
            </Text>
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 16 }}>
              {(["monthly", "biweekly"] as const).map(opt => (
                <TouchableOpacity
                  key={opt}
                  onPress={() => setFrequency(opt)}
                  style={[{
                    flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, alignItems: "center",
                    borderColor: frequency === opt ? colors.primary : colors.border,
                    backgroundColor: frequency === opt ? colors.primary : colors.surface,
                  }]}
                >
                  <Text style={{ color: frequency === opt ? "#fff" : colors.foreground, fontWeight: "700", fontSize: 14 }}>
                    {opt === "monthly" ? "📅 Monthly" : "⚡ Biweekly"}
                  </Text>
                  <Text style={{ color: frequency === opt ? "rgba(255,255,255,0.8)" : colors.muted, fontSize: 11, marginTop: 2 }}>
                    {opt === "monthly" ? "12 visits / year" : "Every 2 weeks · 26 visits"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[s.sectionHeader, { marginTop: 4 }]}>📅 Auto-Schedule Preferences</Text>
            <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 10 }}>
              {frequency === "biweekly"
                ? "Choose the starting day of week. Visits will be scheduled every 2 weeks from the service start date."
                : "Choose which part of the month and which day all 12 visits will be scheduled on. Jobs will auto-appear on the admin calendar."
              }
            </Text>
            <Text style={[s.fieldLabel, { color: colors.muted, marginBottom: 6 }]}>Week of Month</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              {[{label:"1st",v:1},{label:"2nd",v:2},{label:"3rd",v:3},{label:"4th",v:4},{label:"Last",v:5}].map(opt => (
                <TouchableOpacity
                  key={opt.v}
                  onPress={() => setScheduleWeek(scheduleWeek === opt.v ? null : opt.v)}
                  style={[{
                    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5,
                    borderColor: scheduleWeek === opt.v ? colors.primary : colors.border,
                    backgroundColor: scheduleWeek === opt.v ? colors.primary : colors.surface,
                  }]}
                >
                  <Text style={{ color: scheduleWeek === opt.v ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 13 }}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[s.fieldLabel, { color: colors.muted, marginBottom: 6 }]}>Day of Week</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
              {[{label:"Sun",v:0},{label:"Mon",v:1},{label:"Tue",v:2},{label:"Wed",v:3},{label:"Thu",v:4},{label:"Fri",v:5},{label:"Sat",v:6}].map(opt => (
                <TouchableOpacity
                  key={opt.v}
                  onPress={() => setScheduleDay(scheduleDay === opt.v ? null : opt.v)}
                  style={[{
                    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5,
                    borderColor: scheduleDay === opt.v ? colors.primary : colors.border,
                    backgroundColor: scheduleDay === opt.v ? colors.primary : colors.surface,
                  }]}
                >
                  <Text style={{ color: scheduleDay === opt.v ? "#fff" : colors.foreground, fontWeight: "600", fontSize: 13 }}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {frequency === "monthly" && scheduleWeek !== null && scheduleDay !== null && (
              <View style={[s.infoBox, { backgroundColor: colors.surface, borderColor: colors.primary, marginBottom: 14 }]}>
                <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>
                  ✅ All 12 visits will be scheduled on the {["1st","2nd","3rd","4th","Last"][scheduleWeek-1]} {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][scheduleDay]} of each month.
                </Text>
              </View>
            )}
            {frequency === "biweekly" && scheduleDay !== null && (
              <View style={[s.infoBox, { backgroundColor: colors.surface, borderColor: colors.primary, marginBottom: 14 }]}>
                <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>
                  ✅ 26 visits will be scheduled every 2 weeks starting on the service start date (every {["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][scheduleDay]}).
                </Text>
              </View>
            )}

            {/* Auto-Create Jobs Toggle */}
            <View style={{
              flexDirection: "row", alignItems: "center", justifyContent: "space-between",
              backgroundColor: autoCreateJobs ? "#05966915" : "#EF444415",
              borderRadius: 12, padding: 14, marginBottom: 16,
              borderWidth: 1.5,
              borderColor: autoCreateJobs ? "#059669" : "#EF4444",
            }}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={{ fontWeight: "800", fontSize: 14, color: autoCreateJobs ? "#059669" : "#EF4444", marginBottom: 3 }}>
                  {autoCreateJobs ? "✅ Auto-Create Visit Jobs" : "🚫 Do NOT Create Jobs"}
                </Text>
                <Text style={{ fontSize: 12, color: colors.muted, lineHeight: 17 }}>
                  {autoCreateJobs
                    ? "All visit jobs will be automatically added to the schedule calendar."
                    : "Contract will be created but NO jobs will be added to the schedule. Use this when jobs are already set up."}
                </Text>
              </View>
              <Switch
                value={autoCreateJobs}
                onValueChange={setAutoCreateJobs}
                trackColor={{ false: "#EF444440", true: "#05966940" }}
                thumbColor={autoCreateJobs ? "#059669" : "#EF4444"}
              />
            </View>

            {programType === "vip" ? (
              <View style={[s.infoBox, { backgroundColor: "#7C3AED15", borderColor: "#7C3AED" }]}>
                <Text style={[s.infoBoxTitle, { color: "#7C3AED" }]}>⭐ VIP Auto-Scheduled Add-Ons</Text>
                <Text style={[s.infoBoxText, { color: colors.muted }]}>
                  Visit 1: Paint Sealant + Leather Deep Clean + Leather Condition{"\n"}
                  Visit 5: Leather Deep Clean{"\n"}
                  Visit 7: Paint Sealant + Leather Condition{"\n"}
                  Visit 9: Leather Deep Clean{"\n"}
                  Shampoo added manually as needed
                </Text>
              </View>
            ) : programType === "vip_elite" ? (
              <View style={[s.infoBox, { backgroundColor: "#D9770615", borderColor: "#D97706" }]}>
                <Text style={[s.infoBoxTitle, { color: "#D97706" }]}>👑 VIP Elite — 12 Detail Credits</Text>
                <Text style={[s.infoBoxText, { color: colors.muted }]}>
                  2 Luxury Details + 10 Basic Details{"\n"}
                  Use anytime, in any order{"\n"}
                  No rotating add-ons — add-ons can be added manually per visit.{"\n"}
                  Customer self-schedules via the portal.
                </Text>
              </View>
            ) : (
              <View style={[s.infoBox, { backgroundColor: "#05966915", borderColor: "#059669" }]}>
                <Text style={[s.infoBoxTitle, { color: "#059669" }]}>🔧 Maintenance Program</Text>
                <Text style={[s.infoBoxText, { color: colors.muted }]}>
                  Standard full detail service on every visit.{"\n"}
                  No rotating premium add-ons.{"\n"}
                  Add-ons can be added manually per visit as needed.
                </Text>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Form Field helper ────────────────────────────────────────────────────────
function FormField({
  label, value, onChange, error, placeholder, keyboardType, multiline, prefix, colors,
}: {
  label: string; value: string; onChange: (v: string) => void;
  error?: string; placeholder?: string; keyboardType?: any;
  multiline?: boolean; prefix?: string; colors: any;
}) {
  const s = styles(colors);
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[s.fieldLabel, { color: colors.muted }]}>{label}</Text>
      <View style={[s.fieldRow, { borderColor: error ? colors.error : colors.border, backgroundColor: colors.surface }]}>
        {prefix && <Text style={[s.fieldPrefix, { color: colors.muted }]}>{prefix}</Text>}
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          keyboardType={keyboardType}
          multiline={multiline}
          numberOfLines={multiline ? 3 : 1}
          style={[s.fieldInput, { color: colors.foreground, height: multiline ? 72 : undefined }]}
          returnKeyType="done"
        />
      </View>
      {error && <Text style={[s.fieldError, { color: colors.error }]}>{error}</Text>}
    </View>
  );
}

// ─── Send Signature Sheet ─────────────────────────────────────────────────────


// ─── Contract Detail Modal ────────────────────────────────────────────────────
interface ContractDetailProps {
  contractId: number | null;
  visible: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

function ContractDetail({ contractId, visible, onClose, onUpdated }: ContractDetailProps) {
  const colors = useColors();
  const [contract, setContract] = useState<VipContract | null>(null);
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const s = styles(colors);

  const load = useCallback(async () => {
    if (!contractId) return;
    setLoading(true);
    try {
      const data = await apiGet(`/contract/${contractId}`);
      if (data.success) setContract(data.contract);
    } catch {}
    setLoading(false);
  }, [contractId]);

  React.useEffect(() => {
    if (visible && contractId) load();
  }, [visible, contractId]);

  const markVisit = async (visitId: number, status: "completed" | "missed") => {
    const result = await apiPost("/visit/update", { visitId, status });
    if (status === "missed" && result.replacementVisit) {
      Alert.alert(
        "Replacement Scheduled",
        `A replacement appointment has been added for ${fmtDate(result.replacementVisit.scheduledDate)}. It will appear on the admin calendar.`,
        [{ text: "OK" }]
      );
    }
    load();
    onUpdated();
  };

  const sendContractEmail = async () => {
    if (!contract) return;
    if (!contract.customer_email) {
      Alert.alert("No Email", "This customer does not have an email address on file. Please update their profile first.");
      return;
    }
    setSendingEmail(true);
    try {
      const result = await apiPost("/send-signature", { contractId: contract.id, method: "email" });
      if (result.success) {
        Alert.alert("✅ Email Sent", `Signature link sent to ${contract.customer_email}`);
      } else {
        Alert.alert("Error", result.error ?? "Failed to send email. Please try again.");
      }
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "Failed to send email.");
    }
    setSendingEmail(false);
  };

  const cancelContract = () => {
    Alert.alert(
      "Cancel Contract",
      "Are you sure you want to cancel this VIP contract? This cannot be undone.",
      [
        { text: "Keep Contract", style: "cancel" },
        {
          text: "Cancel Contract",
          style: "destructive",
          onPress: async () => {
            setCancelling(true);
            await apiPost("/cancel", { contractId });
            setCancelling(false);
            onClose();
            onUpdated();
          },
        },
      ]
    );
  };

  const deleteContract = () => {
    Alert.alert(
      "Delete Contract",
      "Permanently delete this cancelled contract? This cannot be undone.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Delete Permanently",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            await apiPost("/delete", { contractId });
            setDeleting(false);
            onClose();
            onUpdated();
          },
        },
      ]
    );
  };

  if (!visible) return null;

  const expiryDays = contract ? daysUntil(contract.end_date) : 999;
  const renewalAlert = expiryDays <= 60 && expiryDays > 0 && contract?.status === "active";

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.modalContainer, { backgroundColor: colors.background }]}>
        <View style={s.modalHeader}>
          <TouchableOpacity onPress={onClose} style={s.modalCloseBtn}>
            <Text style={{ color: colors.primary, fontSize: 16 }}>← Back</Text>
          </TouchableOpacity>
          <Text style={[s.modalTitle, { color: colors.foreground }]}>
            {contract?.program_type === "maintenance" ? "🔧 Maintenance Contract" : contract?.program_type === "vip_elite" ? "👑 VIP Elite Contract" : "⭐ VIP Contract"}
          </Text>
          <View style={{ width: 70 }} />
        </View>

        {loading || !contract ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
            {/* Contract header card */}
            <View style={[s.detailCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.detailName, { color: colors.foreground }]}>{contract.customer_name}</Text>
                  <Text style={[s.detailSub, { color: colors.muted }]}>{contract.vehicle_description ?? "—"}</Text>
                  <Text style={[s.detailSub, { color: colors.muted }]}>#{contract.contract_number}</Text>
                </View>
                <View style={[s.statusBadge, { backgroundColor: statusColor(contract.status, colors) + "22", borderColor: statusColor(contract.status, colors) }]}>
                  <Text style={[s.statusBadgeText, { color: statusColor(contract.status, colors) }]}>
                    {statusLabel(contract.status)}
                  </Text>
                </View>
              </View>

              <View style={[s.divider, { backgroundColor: colors.border }]} />

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
               <InfoPill label="Contract Date" value={fmtDate(contract.start_date)} colors={colors} />
               {(contract as any).service_start_date && (contract as any).service_start_date !== contract.start_date && (
                 <InfoPill label="Service Start" value={fmtDate((contract as any).service_start_date)} colors={colors} />
               )}
               <InfoPill label="End Date" value={fmtDate(contract.end_date)} colors={colors} />
               <InfoPill label="Total" value={`$${Number(contract.total_price).toFixed(2)}`} colors={colors} />
               <InfoPill label="City" value={contract.city ?? "—"} colors={colors} />
             </View>
              {contract.signed_at ? (
                <View style={{ marginTop: 10, backgroundColor: "#16A34A15", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: "#16A34A40", flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontSize: 16 }}>✅</Text>
                  <View>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: "#16A34A", textTransform: "uppercase", letterSpacing: 0.5 }}>Signed</Text>
                    <Text style={{ fontSize: 13, color: colors.foreground, marginTop: 1 }}>
                      {new Date(contract.signed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Chicago' })} CT
                    </Text>
                  </View>
                </View>
              ) : contract.status === 'pending_signature' ? (
                <View style={{ marginTop: 10, backgroundColor: "#F59E0B15", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: "#F59E0B40", flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text style={{ fontSize: 16 }}>⏳</Text>
                  <Text style={{ fontSize: 13, color: "#92400E", fontWeight: "600" }}>Awaiting Signature — not yet signed</Text>
                </View>
              ) : null}

              {contract.customer_email && (
                <Text style={[s.detailSub, { color: colors.muted, marginTop: 8 }]}>✉️ {contract.customer_email}</Text>
              )}
              {contract.customer_phone && (
                <Text style={[s.detailSub, { color: colors.muted }]}>📞 {contract.customer_phone}</Text>
              )}

            </View>

            {/* Renewal alert */}
            {renewalAlert && (
              <View style={[s.alertBox, { backgroundColor: "#FFF3CD", borderColor: "#F59E0B" }]}>
                <Text style={{ color: "#92400E", fontWeight: "700", fontSize: 14 }}>
                  ⚠️ Renewal Due in {expiryDays} Days
                </Text>
                <Text style={{ color: "#92400E", fontSize: 13, marginTop: 4 }}>
                  This contract expires {fmtDate(contract.end_date)}. Contact the customer to renew.
                </Text>
              </View>
            )}

            {/* Action buttons */}
            <View style={{ gap: 10, marginBottom: 20 }}>
              {/* Send Contract Email — prominent for unsigned contracts */}
              {(contract.status === "pending_signature") && (
                <TouchableOpacity
                  onPress={sendContractEmail}
                  disabled={sendingEmail}
                  style={[s.actionBtn, { backgroundColor: "#1a1a2e", borderWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }]}
                >
                  <Text style={{ fontSize: 18 }}>✉️</Text>
                  <Text style={[s.actionBtnText, { color: "#fff" }]}>
                    {sendingEmail ? "Sending…" : contract.customer_email ? `Send Contract to ${contract.customer_email}` : "Send Contract Email"}
                  </Text>
                </TouchableOpacity>
              )}
             {/* Resend for active contracts too */}
             {(contract.status === "active") && (
               <TouchableOpacity
                 onPress={sendContractEmail}
                 disabled={sendingEmail}
                 style={[s.actionBtn, { backgroundColor: colors.primary + "15", borderWidth: 1, borderColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }]}
               >
                 <Text style={{ fontSize: 16 }}>✉️</Text>
                 <Text style={[s.actionBtnText, { color: colors.primary }]}>
                   {sendingEmail ? "Sending…" : "Resend Contract Copy"}
                 </Text>
               </TouchableOpacity>
             )}
              {/* View Signed Contract — only for signed contracts */}
              {contract.signed_at && (
                <TouchableOpacity
                  onPress={() => Linking.openURL(`${API_BASE}/api/vip/view-signed/${contract.id}`)}
                  style={[s.actionBtn, { backgroundColor: "#16A34A15", borderWidth: 1, borderColor: "#16A34A", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }]}
                >
                  <Text style={{ fontSize: 16 }}>📄</Text>
                  <Text style={[s.actionBtnText, { color: "#16A34A" }]}>View Signed Contract</Text>
                </TouchableOpacity>
              )}
             <View style={{ flexDirection: "row", gap: 10 }}>
                {contract.status !== "cancelled" && contract.status !== "expired" && (
                  <TouchableOpacity
                    onPress={cancelContract}
                    disabled={cancelling}
                    style={[s.actionBtn, { backgroundColor: colors.error + "15", borderWidth: 1, borderColor: colors.error, flex: 1 }]}
                  >
                    <Text style={[s.actionBtnText, { color: colors.error }]}>
                      {cancelling ? "Cancelling…" : "Cancel Contract"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
              {contract.status === "cancelled" && (
                <TouchableOpacity
                  onPress={deleteContract}
                  disabled={deleting}
                  style={[s.actionBtn, { backgroundColor: "#7F1D1D20", borderWidth: 1, borderColor: "#7F1D1D", marginTop: 8 }]}
                >
                  <Text style={[s.actionBtnText, { color: "#7F1D1D" }]}>
                    {deleting ? "Deleting…" : "🗑 Delete Contract Permanently"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Visit timeline */}
            <Text style={[s.sectionHeader, { color: colors.foreground, marginBottom: 12 }]}>
              Visit Schedule ({(contract.visits ?? []).filter(v => !v.is_replacement).length} scheduled
              {(contract.visits ?? []).some(v => v.is_replacement) ? ` + ${(contract.visits ?? []).filter(v => v.is_replacement).length} replacement(s)` : ""})
            </Text>
            {(contract.visits ?? []).map((visit) => (
              <VisitCard
                key={visit.id}
                visit={visit}
                colors={colors}
                onMarkComplete={() => markVisit(visit.id, "completed")}
                onMarkMissed={() => markVisit(visit.id, "missed")}
              />
            ))}

            {/* Notes */}
            {contract.notes && (
              <View style={[s.infoBox, { backgroundColor: colors.surface, borderColor: colors.border, marginTop: 16 }]}>
                <Text style={[s.infoBoxTitle, { color: colors.foreground }]}>Internal Notes</Text>
                <Text style={[s.infoBoxText, { color: colors.muted }]}>{contract.notes}</Text>
              </View>
            )}

          </ScrollView>
        )}
      </View>


    </Modal>
  );
}

// ─── Visit Card ───────────────────────────────────────────────────────────────
function VisitCard({
  visit, colors, onMarkComplete, onMarkMissed,
}: {
  visit: VipVisit; colors: any;
  onMarkComplete: () => void; onMarkMissed: () => void;
}) {
  const s = styles(colors);
  const isCompleted = visit.status === "completed";
  const isMissed = visit.status === "missed";
  const isCancelled = visit.status === "cancelled";
  const hasAddOns = visit.add_ons.length > 0;
  const isReplacement = !!visit.is_replacement;

  return (
    <View style={[s.visitCard, {
      backgroundColor: isCompleted ? colors.success + "10" : isMissed ? colors.error + "10" : isReplacement ? "#FFF7ED" : colors.surface,
      borderColor: isCompleted ? colors.success + "40" : isMissed ? colors.error + "40" : isReplacement ? "#F97316" : colors.border,
      borderLeftWidth: isReplacement ? 3 : 1,
    }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={[s.visitNumber, {
          backgroundColor: isCompleted ? colors.success : isMissed ? colors.error : isReplacement ? "#F97316" : colors.primary,
        }]}>
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 11 }}>{isReplacement ? "R" : visit.visit_number}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={[s.visitDate, { color: colors.foreground }]}>
              {visitStatusIcon(visit.status)} {visit.scheduled_date ? fmtMonth(visit.scheduled_date) : "TBD"}
            </Text>
            {isReplacement && (
              <View style={{ backgroundColor: "#F97316", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                <Text style={{ color: "#fff", fontSize: 9, fontWeight: "700" }}>REPLACEMENT</Text>
              </View>
            )}
          </View>
          {isReplacement && visit.notes && (
            <Text style={{ color: "#F97316", fontSize: 11, marginTop: 2 }}>{visit.notes}</Text>
          )}
          {hasAddOns && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
              {visit.add_ons.map((a) => (
                <View key={a} style={[s.addOnBadge, { backgroundColor: colors.primary + "18" }]}>
                  <Text style={[s.addOnText, { color: colors.primary }]}>{a}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        {!isCompleted && !isMissed && !isCancelled && (
          <View style={{ flexDirection: "row", gap: 6 }}>
            <TouchableOpacity
              onPress={onMarkComplete}
              style={[s.visitBtn, { backgroundColor: colors.success }]}
            >
              <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>Done</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onMarkMissed}
              style={[s.visitBtn, { backgroundColor: colors.error }]}
            >
              <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>Miss</Text>
            </TouchableOpacity>
          </View>
        )}
        {(isCompleted || isMissed) && (
          <Text style={{ fontSize: 20 }}>{isCompleted ? "✅" : "❌"}</Text>
        )}
      </View>
    </View>
  );
}

// ─── Info Pill ────────────────────────────────────────────────────────────────
function InfoPill({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={{ alignItems: "center" }}>
      <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>{label}</Text>
      <Text style={{ fontSize: 13, fontWeight: "700", color: colors.foreground }}>{value}</Text>
    </View>
  );
}

// ─── Contract List Card ───────────────────────────────────────────────────────
function ContractCard({
  contract, colors, onPress, onSendEmail,
}: {
  contract: VipContract; colors: any; onPress: () => void; onSendEmail?: () => void;
}) {
  const s = styles(colors);
  const expiryDays = daysUntil(contract.end_date);
  const renewalAlert = expiryDays <= 60 && expiryDays > 0 && contract.status === "active";
  const [sending, setSending] = React.useState(false);

  const handleSendEmail = async (e: any) => {
    e.stopPropagation?.();
    if (!contract.customer_email) {
      Alert.alert("No Email", "This customer has no email address on file.");
      return;
    }
    setSending(true);
    try {
      const result = await apiPost("/send-signature", { contractId: contract.id, method: "email" });
      if (result.success) {
        Alert.alert("✅ Sent!", `Contract emailed to ${contract.customer_email}`);
      } else {
        Alert.alert("Error", result.error ?? "Failed to send.");
      }
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to send.");
    }
    setSending(false);
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[s.contractCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      activeOpacity={0.75}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1, marginRight: 10 }}>
          <Text style={[s.contractName, { color: colors.foreground }]}>{contract.customer_name}</Text>
          <Text style={[s.contractSub, { color: colors.muted }]}>{contract.vehicle_description ?? "—"}</Text>
          <Text style={[s.contractSub, { color: colors.muted }]}>#{contract.contract_number}</Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 4 }}>
          <View style={[s.statusBadge, { backgroundColor: statusColor(contract.status, colors) + "22", borderColor: statusColor(contract.status, colors) }]}>
            <Text style={[s.statusBadgeText, { color: statusColor(contract.status, colors) }]}>
              {statusLabel(contract.status)}
            </Text>
          </View>
          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>
            ${Number(contract.total_price).toFixed(0)}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
        <Text style={[s.contractMeta, { color: colors.muted }]}>📅 {fmtDate(contract.start_date)} – {fmtDate(contract.end_date)}</Text>
        {contract.city && <Text style={[s.contractMeta, { color: colors.muted }]}>📍 {contract.city}</Text>}
        <View style={[s.statusBadge, { backgroundColor: contract.frequency === "biweekly" ? "#EFF6FF" : "#F0FDF4", borderColor: contract.frequency === "biweekly" ? "#93C5FD" : "#86EFAC" }]}>
          <Text style={[s.statusBadgeText, { color: contract.frequency === "biweekly" ? "#1D4ED8" : "#15803D" }]}>
            {contract.frequency === "biweekly" ? "⚡ Biweekly" : "📅 Monthly"}
          </Text>
        </View>
        {/* Program type badge */}
        <View style={[s.statusBadge, {
          backgroundColor: contract.program_type === "maintenance" ? "#05966915" : contract.program_type === "vip_elite" ? "#D9770615" : "#7C3AED15",
          borderColor: contract.program_type === "maintenance" ? "#059669" : contract.program_type === "vip_elite" ? "#D97706" : "#7C3AED",
        }]}>
          <Text style={[s.statusBadgeText, { color: contract.program_type === "maintenance" ? "#059669" : contract.program_type === "vip_elite" ? "#D97706" : "#7C3AED" }]}>
            {contract.program_type === "maintenance" ? "🔧 Maintenance" : contract.program_type === "vip_elite" ? "👑 VIP Elite" : "⭐ VIP"}
          </Text>
        </View>
      </View>
      {renewalAlert && (
        <View style={[s.renewalBadge, { backgroundColor: "#FFF3CD" }]}>
          <Text style={{ color: "#92400E", fontSize: 12, fontWeight: "600" }}>
            ⚠️ Renewal due in {expiryDays} days
          </Text>
        </View>
      )}
      {/* Quick-send email button for unsigned contracts */}
      {contract.status === "pending_signature" && (
        <TouchableOpacity
          onPress={handleSendEmail}
          disabled={sending}
          style={{
            marginTop: 10,
            backgroundColor: "#1a1a2e",
            borderRadius: 8,
            paddingVertical: 9,
            paddingHorizontal: 14,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <Text style={{ fontSize: 15 }}>✉️</Text>
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>
            {sending ? "Sending…" : contract.customer_email ? `Email Contract to ${contract.customer_email}` : "No Email on File"}
          </Text>
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function AdminVipScreen() {
  const colors = useColors();
  const [contracts, setContracts] = useState<VipContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterStatus, setFilterStatus] = useState<ContractStatus | "all">("all");
  const [filterProgram, setFilterProgram] = useState<"all" | "vip" | "vip_elite" | "maintenance">("all");
  const [showNewForm, setShowNewForm] = useState(false);
  const [selectedContractId, setSelectedContractId] = useState<number | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [newContractResult, setNewContractResult] = useState<any>(null);
  const [mainView, setMainView] = useState<"contracts" | "flexpass">("contracts");
  const [selectedFlex, setSelectedFlex] = useState<any>(null);
  const [flexNote, setFlexNote] = useState("");
  const [flexProcessing, setFlexProcessing] = useState(false);
  const [flexFilter, setFlexFilter] = useState<"pending" | "confirmed" | "declined" | "all">("pending");
  const utils = trpc.useUtils();
  const s = styles(colors);

  const { data: flexData, isLoading: flexLoading, refetch: refetchFlex } = trpc.finance.getFlexPassRequests.useQuery({});
  const reviewFlexMutation = trpc.finance.reviewFlexPassRequest.useMutation({
    onSuccess: () => {
      utils.finance.getFlexPassRequests.invalidate();
      setSelectedFlex(null);
      setFlexNote("");
    },
  });
  const flexRequests = (flexData?.requests ?? []).filter((r: any) => flexFilter === "all" || r.status === flexFilter);
  const pendingFlexCount = (flexData?.requests ?? []).filter((r: any) => r.status === "pending").length;

  const handleFlexDecision = async (status: "confirmed" | "declined") => {
    if (!selectedFlex) return;
    setFlexProcessing(true);
    try {
      await reviewFlexMutation.mutateAsync({ requestId: selectedFlex.id, status, adminNote: flexNote.trim() || undefined });
    } catch (e) { console.error(e); }
    finally { setFlexProcessing(false); }
  };

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiGet("/list");
      if (data.success) setContracts(data.contracts ?? []);
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = () => { setRefreshing(true); load(true); };

  const handleCreated = (result: any) => {
    setShowNewForm(false);
    setNewContractResult(result);
    load(true);
  };

  const filtered = contracts.filter(c => {
    if (filterStatus !== "all" && c.status !== filterStatus) return false;
    if (filterProgram !== "all" && (c.program_type ?? "vip") !== filterProgram) return false;
    // vip_elite is a subset of non-maintenance contracts
    return true;
  });

  const stats = {
    active: contracts.filter(c => c.status === "active").length,
    pending: contracts.filter(c => c.status === "pending_signature").length,
    total: contracts.length,
    revenue: contracts.filter(c => c.status === "active").reduce((s, c) => s + Number(c.total_price), 0),
  };

  const FILTERS: { label: string; value: ContractStatus | "all" }[] = [
    { label: "All", value: "all" },
    { label: "Active", value: "active" },

    { label: "Expired", value: "expired" },
    { label: "Cancelled", value: "cancelled" },
  ];
  const PROGRAM_FILTERS: { label: string; value: "all" | "vip" | "vip_elite" | "maintenance" }[] = [
    { label: "All Programs", value: "all" },
    { label: "⭐ VIP", value: "vip" },
    { label: "👑 VIP Elite", value: "vip_elite" },
    { label: "🔧 Maintenance", value: "maintenance" },
  ];

  return (
    <ScreenContainer edges={["left", "right"]} containerClassName="bg-background">
      {/* Header block — flexShrink:0 keeps it from expanding, all children stack tightly */}
      <View style={{ flexShrink: 0, backgroundColor: "#1a1a2e" }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 6 }}>
          <View>
            <Text style={{ color: "#fff", fontSize: 22, fontWeight: "800" }}>⭐ VIP Program</Text>
            <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, marginTop: 2 }}>
              {stats.active} active · {stats.total} total
            </Text>
          </View>
          {mainView === "contracts" ? (
            <TouchableOpacity onPress={() => setShowNewForm(true)} style={[s.newBtn, { backgroundColor: "#fff" }]}>
              <Text style={{ color: "#1a1a2e", fontWeight: "700", fontSize: 14 }}>+ New Contract</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ backgroundColor: pendingFlexCount > 0 ? "#F59E0B" : "rgba(255,255,255,0.2)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}>
              <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>{pendingFlexCount} pending</Text>
            </View>
          )}
        </View>
        {/* Main view switcher */}
        <View style={{ flexDirection: "row", paddingHorizontal: 20, paddingBottom: 10, gap: 8 }}>
          <TouchableOpacity
            onPress={() => setMainView("contracts")}
            style={{ flex: 1, paddingVertical: 7, borderRadius: 10, alignItems: "center", backgroundColor: mainView === "contracts" ? "rgba(255,255,255,0.2)" : "transparent", borderWidth: 1, borderColor: mainView === "contracts" ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.15)" }}
          >
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>📋 Contracts</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setMainView("flexpass")}
            style={{ flex: 1, paddingVertical: 7, borderRadius: 10, alignItems: "center", backgroundColor: mainView === "flexpass" ? "#F59E0B" : "transparent", borderWidth: 1, borderColor: mainView === "flexpass" ? "#F59E0B" : "rgba(255,255,255,0.15)" }}
          >
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>⚡ Flex Pass{pendingFlexCount > 0 ? ` (${pendingFlexCount})` : ""}</Text>
          </TouchableOpacity>
        </View>
        {/* Stats row — height:72 constrains the ScrollView */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: 20, height: 72 }}>
          <View style={{ flexDirection: "row", gap: 12, alignItems: "center", height: 72 }}>
            <StatChip label="Active" value={stats.active.toString()} color="#4ADE80" />

            <StatChip label="Total" value={stats.total.toString()} color="#60A5FA" />
            <StatChip label="Active Revenue" value={`$${stats.revenue.toLocaleString()}`} color="#A78BFA" />
          </View>
        </ScrollView>
        {/* Program filter tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.border, height: 40 }}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center', height: 40 }}
        >
          {PROGRAM_FILTERS.map(f => (
            <TouchableOpacity
              key={f.value}
              onPress={() => setFilterProgram(f.value)}
              style={[s.filterTab, {
                backgroundColor: filterProgram === f.value
                  ? (f.value === "vip" ? "#7C3AED" : f.value === "maintenance" ? "#059669" : "#1a1a2e")
                  : colors.surface,
                borderColor: filterProgram === f.value
                  ? (f.value === "vip" ? "#7C3AED" : f.value === "maintenance" ? "#059669" : "#1a1a2e")
                  : colors.border,
              }]}
            >
              <Text style={[s.filterTabText, { color: filterProgram === f.value ? "#fff" : colors.muted }]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        {/* Status filter tabs — height:44 constrains the ScrollView */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, height: 44 }}
          contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center', height: 44 }}
        >
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f.value}
              onPress={() => setFilterStatus(f.value)}
              style={[s.filterTab, {
                backgroundColor: filterStatus === f.value ? "#1a1a2e" : colors.background,
                borderColor: filterStatus === f.value ? "#1a1a2e" : colors.border,
              }]}
            >
              <Text style={[s.filterTabText, { color: filterStatus === f.value ? "#fff" : colors.muted }]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {mainView === "flexpass" ? (
        <View style={{ flex: 1 }}>
          {/* Flex Pass filter chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexShrink: 0, borderBottomWidth: 1, borderBottomColor: colors.border, height: 44 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center', height: 44 }}>
            {(["pending", "confirmed", "declined", "all"] as const).map(f => (
              <TouchableOpacity key={f} onPress={() => setFlexFilter(f)} style={{ paddingHorizontal: 14, paddingVertical: 5, borderRadius: 16, backgroundColor: flexFilter === f ? (f === "confirmed" ? colors.success : f === "declined" ? colors.error : "#F59E0B") : colors.surface, borderWidth: 1, borderColor: flexFilter === f ? "transparent" : colors.border }}>
                <Text style={{ fontSize: 12, fontWeight: "600", color: flexFilter === f ? "#fff" : colors.muted, textTransform: "capitalize" }}>{f}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          {flexLoading ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
              data={flexRequests}
              keyExtractor={(item: any) => String(item.id)}
              contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}
              ListEmptyComponent={
                <View style={{ alignItems: "center", marginTop: 60 }}>
                  <Text style={{ fontSize: 40, marginBottom: 12 }}>⚡</Text>
                  <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700", marginBottom: 6 }}>No Flex Pass Requests</Text>
                  <Text style={{ color: colors.muted, textAlign: "center" }}>{flexFilter === "pending" ? "No pending requests right now." : `No ${flexFilter} requests.`}</Text>
                </View>
              }
              renderItem={({ item }: { item: any }) => {
                const statusColor = item.status === "confirmed" ? colors.success : item.status === "declined" ? colors.error : "#F59E0B";
                return (
                  <TouchableOpacity
                    onPress={() => { setSelectedFlex(item); setFlexNote(""); }}
                    activeOpacity={0.7}
                    style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4, borderLeftColor: statusColor }}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{item.customer_name ?? "Unknown"}</Text>
                      <View style={{ backgroundColor: statusColor + "20", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: statusColor, textTransform: "capitalize" }}>{item.status}</Text>
                      </View>
                    </View>
                    <Text style={{ fontSize: 13, color: colors.foreground, marginBottom: 2 }}>📅 {item.requested_date}{item.requested_time ? ` · ${item.requested_time}` : ""}</Text>
                    {item.city && <Text style={{ fontSize: 12, color: colors.muted }}>📍 {item.city}</Text>}
                    {item.contract_number && <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>Contract: {item.contract_number}</Text>}
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      ) : loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.muted, marginTop: 12 }}>Loading contracts…</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>⭐</Text>
          <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "700", marginBottom: 8 }}>
            No VIP Contracts
          </Text>
          <Text style={{ color: colors.muted, textAlign: "center", marginBottom: 24 }}>
            {filterStatus === "all"
              ? "Create your first VIP contract to get started."
              : `No ${statusLabel(filterStatus as ContractStatus).toLowerCase()} contracts.`}
          </Text>
          {filterStatus === "all" && (
            <TouchableOpacity
              onPress={() => setShowNewForm(true)}
              style={[s.btn, { backgroundColor: "#1a1a2e" }]}
            >
              <Text style={[s.btnText, { color: "#fff" }]}>+ Create First Contract</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          data={filtered}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          renderItem={({ item }) => (
            <ContractCard
              contract={item}
              colors={colors}
              onPress={() => {
                setSelectedContractId(item.id);
                setShowDetail(true);
              }}
            />
          )}
        />
      )}

      {/* New contract form */}
      <NewContractForm
        visible={showNewForm}
        onClose={() => setShowNewForm(false)}
        onCreated={handleCreated}
      />

      {/* Post-creation: send signature sheet */}
      {newContractResult && (
        <Modal visible={!!newContractResult} animationType="slide" transparent onRequestClose={() => setNewContractResult(null)}>
          <View style={s.sheetOverlay}>
            <View style={[s.sheet, { backgroundColor: colors.background }]}>
              <View style={s.sheetHandle} />
              <Text style={{ fontSize: 48, textAlign: "center", marginBottom: 12 }}>🎉</Text>
              <Text style={[s.sheetTitle, { color: colors.foreground, textAlign: "center" }]}>Contract Created!</Text>
              <Text style={[s.sheetSub, { color: colors.muted, textAlign: "center", marginBottom: 20 }]}>
                #{newContractResult.contractNumber} — {newContractResult.visitDates?.length ?? 12} visits auto-scheduled.
              </Text>
              <Text style={[s.sheetSub, { color: colors.muted, textAlign: "center", marginBottom: 20 }]}>
                Send the signature link to the customer now?
              </Text>
              <View style={{ gap: 10 }}>
                <TouchableOpacity
                  onPress={() => {
                    const c = contracts.find(c => c.id === newContractResult.contractId) ?? null;
                    if (c) {
                      setSelectedContractId(newContractResult.contractId);
                      setShowDetail(true);
                    }
                    setNewContractResult(null);
                  }}
                  style={[s.btn, { backgroundColor: "#1a1a2e" }]}
                >
                  <Text style={[s.btnText, { color: "#fff" }]}>View Contract & Send Signature</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setNewContractResult(null)}
                  style={[s.btn, { backgroundColor: colors.surface }]}
                >
                  <Text style={[s.btnText, { color: colors.muted }]}>Send Later</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* Contract detail */}
      <ContractDetail
        contractId={selectedContractId}
        visible={showDetail}
        onClose={() => { setShowDetail(false); setSelectedContractId(null); load(true); }}
        onUpdated={() => load(true)}
      />

      {/* Flex Pass review modal */}
      <Modal visible={!!selectedFlex} animationType="slide" presentationStyle="pageSheet">
        {selectedFlex && (
          <ScreenContainer edges={["bottom", "left", "right"]} className="px-5">
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ marginTop: 12 }}>
                <TouchableOpacity onPress={() => setSelectedFlex(null)} activeOpacity={0.7} style={{ paddingVertical: 8 }}>
                  <Text style={{ fontSize: 16, color: colors.primary, fontWeight: "600" }}>Close</Text>
                </TouchableOpacity>
                <View style={{ marginTop: 16 }}>
                  <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground, marginBottom: 4 }}>⚡ Flex Pass Request</Text>
                  <Text style={{ fontSize: 14, color: colors.muted, marginBottom: 20 }}>{selectedFlex.customer_name}</Text>
                  <View style={{ gap: 8, marginBottom: 24 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                      <Text style={{ fontSize: 13, color: colors.muted }}>Date</Text>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{selectedFlex.requested_date}</Text>
                    </View>
                    {selectedFlex.requested_time && (
                      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <Text style={{ fontSize: 13, color: colors.muted }}>Time</Text>
                        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{selectedFlex.requested_time}</Text>
                      </View>
                    )}
                    {selectedFlex.city && (
                      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <Text style={{ fontSize: 13, color: colors.muted }}>City</Text>
                        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{selectedFlex.city}</Text>
                      </View>
                    )}
                    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                      <Text style={{ fontSize: 13, color: colors.muted }}>Contract</Text>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{selectedFlex.contract_number}</Text>
                    </View>
                    {selectedFlex.customer_email && (
                      <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                        <Text style={{ fontSize: 13, color: colors.muted }}>Email</Text>
                        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{selectedFlex.customer_email}</Text>
                      </View>
                    )}
                    {selectedFlex.notes && (
                      <View style={{ paddingVertical: 8 }}>
                        <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 4 }}>Notes</Text>
                        <Text style={{ fontSize: 13, color: colors.foreground }}>{selectedFlex.notes}</Text>
                      </View>
                    )}
                  </View>
                  {selectedFlex.status === "pending" ? (
                    <>
                      <View style={{ marginBottom: 16 }}>
                        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Admin Note (optional)</Text>
                        <TextInput
                          value={flexNote}
                          onChangeText={setFlexNote}
                          placeholder="Add a note for the customer..."
                          placeholderTextColor={colors.muted}
                          multiline
                          numberOfLines={3}
                          textAlignVertical="top"
                          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: colors.foreground, minHeight: 80 }}
                        />
                      </View>
                      <View style={{ flexDirection: "row", gap: 12, marginBottom: 32 }}>
                        <TouchableOpacity
                          onPress={() => handleFlexDecision("declined")}
                          disabled={flexProcessing}
                          activeOpacity={0.8}
                          style={{ flex: 1, backgroundColor: colors.error + "15", borderRadius: 12, paddingVertical: 16, alignItems: "center", borderWidth: 1, borderColor: colors.error + "30" }}
                        >
                          <Text style={{ color: colors.error, fontSize: 16, fontWeight: "700" }}>Decline</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleFlexDecision("confirmed")}
                          disabled={flexProcessing}
                          activeOpacity={0.8}
                          style={{ flex: 1, backgroundColor: colors.success, borderRadius: 12, paddingVertical: 16, alignItems: "center" }}
                        >
                          {flexProcessing ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: "#FFF", fontSize: 16, fontWeight: "700" }}>Confirm</Text>}
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : (
                    <View style={{ backgroundColor: (selectedFlex.status === "confirmed" ? colors.success : colors.error) + "15", borderRadius: 12, padding: 16, alignItems: "center", marginBottom: 32 }}>
                      <Text style={{ color: selectedFlex.status === "confirmed" ? colors.success : colors.error, fontSize: 14, fontWeight: "600", textTransform: "capitalize" }}>{selectedFlex.status}</Text>
                      {selectedFlex.admin_note && <Text style={{ color: colors.foreground, fontSize: 13, marginTop: 8, textAlign: "center" }}>{selectedFlex.admin_note}</Text>}
                    </View>
                  )}
                </View>
              </View>
            </ScrollView>
          </ScreenContainer>
        )}
      </Modal>
    </ScreenContainer>
  );
}

// ─── Stat Chip ────────────────────────────────────────────────────────────────
function StatChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={{ backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, alignItems: "center", minWidth: 80 }}>
      <Text style={{ color, fontWeight: "800", fontSize: 18 }}>{value}</Text>
      <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
function styles(colors: any) {
  return StyleSheet.create({
    header: {},
    newBtn: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
    },
    filterTab: {
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 20,
      borderWidth: 1,
    },
    filterTabText: {
      fontSize: 13,
      fontWeight: "600",
    },
    contractCard: {
      borderRadius: 14,
      padding: 16,
      borderWidth: 1,
    },
    contractName: {
      fontSize: 16,
      fontWeight: "700",
    },
    contractSub: {
      fontSize: 13,
      marginTop: 2,
    },
    contractMeta: {
      fontSize: 12,
    },
    statusBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 20,
      borderWidth: 1,
    },
    statusBadgeText: {
      fontSize: 11,
      fontWeight: "700",
    },
    renewalBadge: {
      marginTop: 10,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    modalContainer: {
      flex: 1,
    },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    modalTitle: {
      fontSize: 17,
      fontWeight: "700",
    },
    modalCloseBtn: {
      width: 70,
    },
    modalSaveBtn: {
      width: 70,
      alignItems: "flex-end",
    },
    sectionHeader: {
      fontSize: 13,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 10,
      color: colors.muted,
    },
    fieldLabel: {
      fontSize: 12,
      fontWeight: "600",
      marginBottom: 4,
    },
    fieldRow: {
      flexDirection: "row",
      alignItems: "center",
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    input: {
      borderWidth: 1,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    },
    fieldPrefix: {
      fontSize: 15,
      marginRight: 4,
    },
    fieldInput: {
      flex: 1,
      fontSize: 15,
    },
    fieldError: {
      fontSize: 12,
      marginTop: 4,
    },
    infoBox: {
      borderRadius: 10,
      padding: 14,
      borderWidth: 1,
    },
    infoBoxTitle: {
      fontSize: 13,
      fontWeight: "700",
      marginBottom: 6,
    },
    infoBoxText: {
      fontSize: 13,
      lineHeight: 20,
    },
    sheetOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.5)",
      justifyContent: "flex-end",
    },
    sheet: {
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      padding: 24,
      paddingBottom: 40,
    },
    sheetHandle: {
      width: 40,
      height: 4,
      backgroundColor: "#ccc",
      borderRadius: 2,
      alignSelf: "center",
      marginBottom: 20,
    },
    sheetTitle: {
      fontSize: 20,
      fontWeight: "800",
      marginBottom: 6,
    },
    sheetSub: {
      fontSize: 14,
      lineHeight: 20,
    },
    btn: {
      paddingVertical: 14,
      paddingHorizontal: 20,
      borderRadius: 12,
      alignItems: "center",
    },
    btnText: {
      fontSize: 15,
      fontWeight: "700",
    },
    detailCard: {
      borderRadius: 14,
      padding: 16,
      borderWidth: 1,
      marginBottom: 16,
    },
    detailName: {
      fontSize: 20,
      fontWeight: "800",
    },
    detailSub: {
      fontSize: 13,
      marginTop: 3,
    },
    divider: {
      height: 1,
      marginVertical: 12,
    },
    alertBox: {
      borderRadius: 10,
      padding: 14,
      borderWidth: 1,
      marginBottom: 16,
    },
    actionBtn: {
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 10,
      alignItems: "center",
    },
    actionBtnText: {
      fontSize: 14,
      fontWeight: "700",
    },
    visitCard: {
      borderRadius: 12,
      padding: 12,
      borderWidth: 1,
      marginBottom: 8,
    },
    visitNumber: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    visitDate: {
      fontSize: 14,
      fontWeight: "600",
    },
    addOnBadge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 10,
    },
    addOnText: {
      fontSize: 11,
      fontWeight: "600",
    },
    visitBtn: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 8,
    },
  });
}
