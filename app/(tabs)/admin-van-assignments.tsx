import { useState, useMemo } from "react";
import { Text, View, FlatList, TouchableOpacity, ActivityIndicator, Modal, ScrollView, TextInput, Alert } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShiftSlot {
  shift: "shift1" | "shift2";
  label: string;
  assignment: any | null;
}

// ─── Shift Slot Card ──────────────────────────────────────────────────────────

function ShiftSlotCard({
  van,
  slot,
  allEmployees,
  colors,
  onAssign,
  onRemove,
  isPending,
}: {
  van: any;
  slot: ShiftSlot;
  allEmployees: any[];
  colors: any;
  onAssign: (employeeId: string, employeeName: string) => void;
  onRemove: (employeeId: string) => void;
  isPending: boolean;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState("");

  const unassignedEmployees = useMemo(() => {
    return allEmployees.filter(
      (e) => e.role === "detailer" && e.employeeId !== slot.assignment?.employeeId
    );
  }, [allEmployees, slot.assignment]);

  const filtered = useMemo(() => {
    if (!search.trim()) return unassignedEmployees;
    const q = search.toLowerCase();
    return unassignedEmployees.filter((e) => e.fullName?.toLowerCase().includes(q) || e.city?.toLowerCase().includes(q));
  }, [unassignedEmployees, search]);

  const isOccupied = !!slot.assignment;

  return (
    <View
      style={{
        borderRadius: 12,
        borderWidth: 1,
        borderColor: isOccupied ? colors.primary + "50" : colors.border,
        backgroundColor: isOccupied ? colors.primary + "08" : colors.surface,
        marginBottom: 10,
        overflow: "hidden",
      }}
    >
      {/* Slot header */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingHorizontal: 14,
          paddingVertical: 10,
          backgroundColor: isOccupied ? colors.primary + "15" : colors.surface,
          borderBottomWidth: isOccupied || showPicker ? 1 : 0,
          borderBottomColor: colors.border,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: isOccupied ? colors.primary : colors.border,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>
              {slot.shift === "shift1" ? "1" : "2"}
            </Text>
          </View>
          <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>
            {slot.label}
          </Text>
        </View>

        {isOccupied ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <TouchableOpacity
              onPress={() => { setShowPicker(!showPicker); setSearch(""); }}
              style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.primary + "20" }}
            >
              <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "700" }}>Change</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() =>
                Alert.alert("Remove Assignment", `Remove ${slot.assignment.employeeName} from ${slot.label}?`, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Remove", style: "destructive", onPress: () => onRemove(slot.assignment.employeeId) },
                ])
              }
              style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.error + "20" }}
            >
              <Text style={{ color: colors.error, fontSize: 12, fontWeight: "700" }}>Remove</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => { setShowPicker(!showPicker); setSearch(""); }}
            style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, backgroundColor: colors.primary }}
          >
            <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>+ Assign</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Current assignee */}
      {isOccupied && !showPicker && (
        <View style={{ paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              backgroundColor: colors.primary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 14 }}>
              {(slot.assignment.employeeName ?? "?").charAt(0).toUpperCase()}
            </Text>
          </View>
          <View>
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{slot.assignment.employeeName}</Text>
            {slot.assignment.city ? (
              <Text style={{ fontSize: 12, color: colors.muted }}>{slot.assignment.city}</Text>
            ) : null}
          </View>
        </View>
      )}

      {/* Picker */}
      {showPicker && (
        <View style={{ padding: 12 }}>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search team members..."
            placeholderTextColor={colors.muted}
            style={{
              backgroundColor: colors.background,
              borderRadius: 8,
              paddingHorizontal: 12,
              paddingVertical: 8,
              fontSize: 14,
              color: colors.foreground,
              borderWidth: 1,
              borderColor: colors.border,
              marginBottom: 8,
            }}
          />
          {filtered.length === 0 ? (
            <Text style={{ color: colors.muted, fontSize: 13, textAlign: "center", paddingVertical: 8 }}>
              No available detailers
            </Text>
          ) : (
            filtered.map((emp: any) => (
              <TouchableOpacity
                key={emp.employeeId}
                onPress={() => {
                  onAssign(emp.employeeId, emp.fullName);
                  setShowPicker(false);
                  setSearch("");
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingVertical: 10,
                  paddingHorizontal: 8,
                  borderRadius: 8,
                  backgroundColor: colors.surface,
                  marginBottom: 6,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <View
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    backgroundColor: colors.primary + "30",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: colors.primary, fontWeight: "700", fontSize: 13 }}>
                    {(emp.fullName ?? "?").charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{emp.fullName}</Text>
                  {emp.city ? <Text style={{ fontSize: 12, color: colors.muted }}>{emp.city}</Text> : null}
                </View>
                {isPending && <ActivityIndicator size="small" color={colors.primary} style={{ marginLeft: "auto" }} />}
              </TouchableOpacity>
            ))
          )}
        </View>
      )}
    </View>
  );
}

// ─── Van Card ─────────────────────────────────────────────────────────────────

function VanCard({
  van,
  allAssignments,
  allEmployees,
  colors,
  onAssign,
  onRemove,
  isPending,
}: {
  van: any;
  allAssignments: any[];
  allEmployees: any[];
  colors: any;
  onAssign: (vanId: string, vanName: string, employeeId: string, employeeName: string, shift: "shift1" | "shift2") => void;
  onRemove: (employeeId: string) => void;
  isPending: boolean;
}) {
  const vanAssignments = allAssignments.filter((a) => a.vanId === van.id);

  const empMap = useMemo(() => {
    const m: Record<string, any> = {};
    allEmployees.forEach((e) => { m[e.employeeId] = e; });
    return m;
  }, [allEmployees]);

  const slots: ShiftSlot[] = [
    {
      shift: "shift1",
      label: "1st Shift",
      assignment: (() => {
        const a = vanAssignments.find((x) => x.shift === "shift1");
        if (!a) return null;
        const emp = empMap[a.employeeId];
        return { employeeId: a.employeeId, employeeName: emp?.fullName ?? a.employeeId, city: emp?.city };
      })(),
    },
    {
      shift: "shift2",
      label: "2nd Shift",
      assignment: (() => {
        const a = vanAssignments.find((x) => x.shift === "shift2");
        if (!a) return null;
        const emp = empMap[a.employeeId];
        return { employeeId: a.employeeId, employeeName: emp?.fullName ?? a.employeeId, city: emp?.city };
      })(),
    },
  ];

  const filledSlots = slots.filter((s) => s.assignment).length;

  return (
    <View
      style={{
        marginBottom: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        overflow: "hidden",
      }}
    >
      {/* Van header */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 14,
          backgroundColor: colors.surface,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Text style={{ fontSize: 22 }}>🚐</Text>
          <View>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>{van.name}</Text>
            {van.city ? <Text style={{ fontSize: 12, color: colors.muted }}>{van.city}</Text> : null}
          </View>
        </View>
        <View
          style={{
            paddingHorizontal: 10,
            paddingVertical: 4,
            borderRadius: 20,
            backgroundColor: filledSlots === 2 ? colors.success + "20" : filledSlots === 1 ? colors.warning + "20" : colors.error + "15",
          }}
        >
          <Text
            style={{
              fontSize: 12,
              fontWeight: "700",
              color: filledSlots === 2 ? colors.success : filledSlots === 1 ? colors.warning : colors.muted,
            }}
          >
            {filledSlots}/2 Assigned
          </Text>
        </View>
      </View>

      {/* Shift slots */}
      <View style={{ padding: 12 }}>
        {slots.map((slot) => (
          <ShiftSlotCard
            key={slot.shift}
            van={van}
            slot={slot}
            allEmployees={allEmployees}
            colors={colors}
            onAssign={(empId, empName) => onAssign(van.id, van.name, empId, empName, slot.shift)}
            onRemove={onRemove}
            isPending={isPending}
          />
        ))}
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function AdminVanAssignmentsScreen() {
  const colors = useColors();
  const [search, setSearch] = useState("");

  const { data: vans = [], isLoading: vansLoading } = trpc.fleet.listVans.useQuery({});
  const { data: allAssignments = [], refetch: refetchAssignments } = trpc.fleet.getAllVanAssignments.useQuery();
  const { data: allEmployees = [], isLoading: empsLoading } = trpc.employee.listAll.useQuery();

  const utils = trpc.useUtils();

  const setAssignment = trpc.fleet.setVanAssignment.useMutation({
    onSuccess: () => {
      refetchAssignments();
      utils.fleet.getAllVanAssignments.invalidate();
    },
    onError: (e) => Alert.alert("Error", e.message),
  });

  const removeAssignment = trpc.fleet.removeVanAssignment.useMutation({
    onSuccess: () => {
      refetchAssignments();
      utils.fleet.getAllVanAssignments.invalidate();
    },
    onError: (e) => Alert.alert("Error", e.message),
  });

  const handleAssign = (
    vanId: string,
    vanName: string,
    employeeId: string,
    employeeName: string,
    shift: "shift1" | "shift2"
  ) => {
    setAssignment.mutate({ vanId, vanName, employeeId, shift, assignedBy: "Admin" });
  };

  const handleRemove = (employeeId: string) => {
    removeAssignment.mutate({ employeeId });
  };

  const filteredVans = useMemo(() => {
    if (!search.trim()) return vans as any[];
    const q = search.toLowerCase();
    return (vans as any[]).filter(
      (v) => v.name?.toLowerCase().includes(q) || v.city?.toLowerCase().includes(q)
    );
  }, [vans, search]);

  // Summary stats
  const totalSlots = (vans as any[]).length * 2;
  const filledSlots = (allAssignments as any[]).length;
  const openSlots = totalSlots - filledSlots;

  const isLoading = vansLoading || empsLoading;

  return (
    <ScreenContainer edges={["left", "right"]}>
      <View style={{ flex: 1 }}>
        {/* Header */}
        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: 16,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground }}>
            🚐 Van Assignments
          </Text>
          <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>
            Assign 1st & 2nd shift team members to each van
          </Text>

          {/* Stats row */}
          {!isLoading && (
            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
              {[
                { label: "Total Vans", value: (vans as any[]).length, color: colors.primary },
                { label: "Filled Slots", value: filledSlots, color: colors.success },
                { label: "Open Slots", value: openSlots, color: openSlots > 0 ? colors.warning : colors.success },
              ].map((stat) => (
                <View
                  key={stat.label}
                  style={{
                    flex: 1,
                    backgroundColor: colors.surface,
                    borderRadius: 10,
                    padding: 10,
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text style={{ fontSize: 20, fontWeight: "800", color: stat.color }}>{stat.value}</Text>
                  <Text style={{ fontSize: 10, color: colors.muted, fontWeight: "600", textAlign: "center" }}>{stat.label}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Search */}
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search vans..."
            placeholderTextColor={colors.muted}
            style={{
              marginTop: 12,
              backgroundColor: colors.surface,
              borderRadius: 10,
              paddingHorizontal: 14,
              paddingVertical: 10,
              fontSize: 14,
              color: colors.foreground,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          />
        </View>

        {/* Content */}
        {isLoading ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={{ color: colors.muted, marginTop: 12 }}>Loading vans...</Text>
          </View>
        ) : filteredVans.length === 0 ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 40 }}>
            <Text style={{ fontSize: 40 }}>🚐</Text>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginTop: 12 }}>No Vans Found</Text>
            <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center", marginTop: 6 }}>
              Add vans in the Fleet tab first, then come back to assign team members.
            </Text>
          </View>
        ) : (
          <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
            data={filteredVans}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 16 }}
            renderItem={({ item: van }) => (
              <VanCard
                van={van}
                allAssignments={allAssignments as any[]}
                allEmployees={allEmployees as any[]}
                colors={colors}
                onAssign={handleAssign}
                onRemove={handleRemove}
                isPending={setAssignment.isPending || removeAssignment.isPending}
              />
            )}
          />
        )}
      </View>
    </ScreenContainer>
  );
}
