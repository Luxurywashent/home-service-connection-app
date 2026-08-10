import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, Alert, ActivityIndicator, Modal,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { trpc } from "@/lib/trpc";
import { useEmployeeAuth } from "@/lib/auth-context";

const BLUE = "#0057FF";
const DARK_BG = "#0A0A0A";
const CARD_BG = "#141414";
const BORDER = "#1E1E1E";
const RED = "#EF4444";
const GREEN = "#22C55E";
const YELLOW = "#F59E0B";

const PRIORITY_OPTIONS: { value: "low" | "medium" | "high"; label: string; color: string }[] = [
  { value: "low", label: "Low", color: "#6B7280" },
  { value: "medium", label: "Medium", color: YELLOW },
  { value: "high", label: "High", color: RED },
];

const STATUS_COLORS: Record<string, string> = {
  open: RED,
  in_progress: YELLOW,
  resolved: GREEN,
};
const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
};

export default function RepairRequestScreen() {
  const { employee } = useEmployeeAuth();
  const employeeId = employee?.employeeId ?? "";
  const employeeName = employee?.fullName ?? "";

  // ── Van Assignment ──
  const { data: vanAssignment, isLoading: vanLoading } = trpc.fleet.getVanAssignment.useQuery(
    { employeeId },
    { enabled: !!employeeId }
  );

  // ── Equipment List ──
  const { data: equipment = [], isLoading: eqLoading } = trpc.fleet.listRepairEquipment.useQuery();

  // ── My Repair Orders ──
  const { data: myOrders = [], isLoading: ordersLoading, refetch: refetchOrders } =
    trpc.fleet.listRepairOrders.useQuery(
      { employeeId },
      { enabled: !!employeeId }
    );

  const createRepair = trpc.fleet.createRepairOrder.useMutation({
    onSuccess: () => {
      Alert.alert("Submitted", "Your repair request has been sent to admin.");
      resetForm();
      refetchOrders();
    },
    onError: (e) => Alert.alert("Error", e.message),
  });

  // ── Form State ──
  const [selectedEquipment, setSelectedEquipment] = useState<any>(null);
  const [selectedSubIssue, setSelectedSubIssue] = useState("");
  const [notes, setNotes] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("medium");
  const [showHistory, setShowHistory] = useState(false);

  const resetForm = () => {
    setSelectedEquipment(null);
    setSelectedSubIssue("");
    setNotes("");
    setPriority("medium");
  };

  const handleSubmit = () => {
    if (!vanAssignment) {
      Alert.alert("No Van Assigned", "You don't have a van assigned yet. Please contact your admin.");
      return;
    }
    if (!selectedEquipment) {
      Alert.alert("Required", "Please select the equipment that needs repair.");
      return;
    }
    createRepair.mutate({
      vanId: vanAssignment.vanId,
      vanName: vanAssignment.vanName,
      employeeId,
      employeeName,
      equipmentId: selectedEquipment.equipmentId,
      equipmentName: selectedEquipment.name,
      subIssue: selectedSubIssue || undefined,
      notes: notes.trim() || undefined,
      priority,
    });
  };

  const openCount = myOrders.filter((o: any) => o.status !== "resolved").length;

  if (vanLoading || eqLoading) {
    return (
      <ScreenContainer edges={["left", "right"]} containerClassName="bg-background">
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={BLUE} />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer edges={["left", "right"]} containerClassName="bg-background">
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Repair Request</Text>
          <Text style={styles.subtitle}>
            {vanAssignment
              ? `🚐 ${vanAssignment.vanName ?? vanAssignment.vanId} · ${(vanAssignment as any).shift === "shift2" ? "2nd Shift" : "1st Shift"}`
              : "No van assigned"}
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.historyBtn, openCount > 0 && { borderColor: RED }]}
          onPress={() => setShowHistory(true)}
        >
          <Text style={[styles.historyBtnText, openCount > 0 && { color: RED }]}>
            My Requests {openCount > 0 ? `(${openCount})` : ""}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 40 }}>
        {/* No van warning */}
        {!vanAssignment && (
          <View style={styles.warnCard}>
            <Text style={styles.warnText}>⚠️ You don't have a van assigned. Ask your admin to assign you a van before submitting repairs.</Text>
          </View>
        )}

        {/* Equipment Picker */}
        <View>
          <Text style={styles.sectionLabel}>Equipment *</Text>
          <View style={styles.equipGrid}>
            {equipment.map((eq: any) => {
              const isSelected = selectedEquipment?.equipmentId === eq.equipmentId;
              return (
                <TouchableOpacity
                  key={eq.equipmentId}
                  style={[styles.equipChip, isSelected && styles.equipChipSelected]}
                  onPress={() => {
                    setSelectedEquipment(eq);
                    setSelectedSubIssue("");
                  }}
                >
                  <Text style={[styles.equipChipText, isSelected && styles.equipChipTextSelected]}>
                    {eq.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Sub-Issue Picker (only if equipment has sub-issues) */}
        {selectedEquipment && selectedEquipment.subIssues?.length > 0 && (
          <View>
            <Text style={styles.sectionLabel}>Specific Issue</Text>
            <View style={styles.equipGrid}>
              {selectedEquipment.subIssues.map((issue: string) => {
                const isSelected = selectedSubIssue === issue;
                return (
                  <TouchableOpacity
                    key={issue}
                    style={[styles.subChip, isSelected && styles.subChipSelected]}
                    onPress={() => setSelectedSubIssue(isSelected ? "" : issue)}
                  >
                    <Text style={[styles.subChipText, isSelected && styles.subChipTextSelected]}>
                      {issue}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Priority */}
        <View>
          <Text style={styles.sectionLabel}>Priority</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {PRIORITY_OPTIONS.map((p) => (
              <TouchableOpacity
                key={p.value}
                style={[
                  styles.priorityChip,
                  { borderColor: p.color },
                  priority === p.value && { backgroundColor: p.color },
                ]}
                onPress={() => setPriority(p.value)}
              >
                <Text style={[styles.priorityText, { color: priority === p.value ? "#fff" : p.color }]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Notes */}
        <View>
          <Text style={styles.sectionLabel}>Additional Notes</Text>
          <TextInput
            style={styles.notesInput}
            value={notes}
            onChangeText={setNotes}
            placeholder="Describe the issue in more detail..."
            placeholderTextColor="#4B5563"
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
        </View>

        {/* Submit */}
        <TouchableOpacity
          style={[styles.submitBtn, (!selectedEquipment || !vanAssignment) && { opacity: 0.5 }]}
          onPress={handleSubmit}
          disabled={createRepair.isPending || !selectedEquipment || !vanAssignment}
        >
          {createRepair.isPending
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.submitBtnText}>Submit Repair Request</Text>
          }
        </TouchableOpacity>
      </ScrollView>

      {/* History Modal */}
      <Modal visible={showHistory} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowHistory(false)}>
        <View style={{ flex: 1, backgroundColor: DARK_BG }}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>My Repair Requests</Text>
            <TouchableOpacity onPress={() => setShowHistory(false)}>
              <Text style={{ color: "#6B7280", fontSize: 16 }}>Close</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
            {ordersLoading ? (
              <ActivityIndicator size="large" color={BLUE} />
            ) : myOrders.length === 0 ? (
              <Text style={{ color: "#6B7280", textAlign: "center", marginTop: 40 }}>No repair requests yet.</Text>
            ) : (
              myOrders.map((order: any) => (
                <View key={order.repairId} style={styles.orderCard}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <Text style={styles.orderEquipment}>{order.equipmentName}</Text>
                    <View style={[styles.statusBadge, { backgroundColor: (STATUS_COLORS[order.status] ?? "#6B7280") + "22" }]}>
                      <Text style={[styles.statusText, { color: STATUS_COLORS[order.status] ?? "#6B7280" }]}>
                        {STATUS_LABELS[order.status] ?? order.status}
                      </Text>
                    </View>
                  </View>
                  {order.subIssue ? <Text style={styles.orderSub}>Issue: {order.subIssue}</Text> : null}
                  {order.notes ? <Text style={styles.orderNotes}>{order.notes}</Text> : null}
                  <Text style={styles.orderDate}>{new Date(order.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}</Text>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    backgroundColor: DARK_BG, borderBottomWidth: 1, borderBottomColor: BORDER,
    paddingHorizontal: 16, paddingVertical: 14,
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
  },
  title: { color: "#fff", fontSize: 20, fontWeight: "800" },
  subtitle: { color: "#6B7280", fontSize: 12, marginTop: 2 },
  historyBtn: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  historyBtnText: { color: "#9CA3AF", fontSize: 13, fontWeight: "600" },
  warnCard: {
    backgroundColor: "#F59E0B22", borderWidth: 1, borderColor: YELLOW,
    borderRadius: 10, padding: 14,
  },
  warnText: { color: YELLOW, fontSize: 13, lineHeight: 20 },
  sectionLabel: { color: "#9CA3AF", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 },
  equipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  equipChip: {
    borderWidth: 1, borderColor: BORDER, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8, backgroundColor: CARD_BG,
  },
  equipChipSelected: { backgroundColor: BLUE, borderColor: BLUE },
  equipChipText: { color: "#9CA3AF", fontSize: 13, fontWeight: "600" },
  equipChipTextSelected: { color: "#fff" },
  subChip: {
    borderWidth: 1, borderColor: "#334155", borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 7, backgroundColor: "#1e293b",
  },
  subChipSelected: { backgroundColor: "#0057FF33", borderColor: BLUE },
  subChipText: { color: "#9CA3AF", fontSize: 13 },
  subChipTextSelected: { color: "#60A5FA" },
  priorityChip: {
    flex: 1, borderWidth: 1.5, borderRadius: 8,
    paddingVertical: 8, alignItems: "center",
  },
  priorityText: { fontSize: 13, fontWeight: "700" },
  notesInput: {
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
    borderRadius: 10, padding: 12, color: "#fff", fontSize: 14,
    minHeight: 100,
  },
  submitBtn: {
    backgroundColor: BLUE, borderRadius: 12, paddingVertical: 16,
    alignItems: "center",
  },
  submitBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  modalHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: 16, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  modalTitle: { color: "#fff", fontSize: 17, fontWeight: "700" },
  orderCard: {
    backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER,
    borderRadius: 10, padding: 14,
  },
  orderEquipment: { color: "#fff", fontSize: 15, fontWeight: "700" },
  orderSub: { color: "#9CA3AF", fontSize: 13, marginBottom: 2 },
  orderNotes: { color: "#6B7280", fontSize: 12, marginBottom: 4 },
  orderDate: { color: "#4B5563", fontSize: 11, marginTop: 4 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  statusText: { fontSize: 11, fontWeight: "700" },
});
