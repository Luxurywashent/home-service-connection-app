import { useState, useMemo, useEffect } from "react";
import { Text, View, FlatList, TouchableOpacity, ActivityIndicator, Modal, ScrollView, TextInput, Alert, Platform } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";
import { getJobSyncCompanyMembers, type JobSyncCompanyMember } from "@/lib/jobsync-mobile-api";

function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: monday.toISOString().split("T")[0], end: sunday.toISOString().split("T")[0] };
}

function getEfficiencyColor(eff: number, colors: any) {
  if (eff >= 80) return colors.success;
  if (eff >= 70) return colors.warning;
  return colors.error;
}

function roleLabel(role: string) {
  switch (role) {
    case "detailer": return "Detailer";
    case "admin": return "Admin";
    case "office": return "Office";
    case "operations_manager": return "Ops Manager";
    case "door_hanger_rep": return "Door Hanger Rep";
    case "sales": return "Sales Rep";
    default: return role;
  }
}

function nativeRoleForJobSyncMember(role: string) {
  switch (role.toLowerCase()) {
    case "owner": return "admin";
    case "dispatcher": return "operations_manager";
    case "technician": return "detailer";
    default: return role;
  }
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return "-";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default function AdminEmployeesScreen() {
  const colors = useColors();
  const { session: jobSyncSession } = useJobSyncAuth();
  const isJobSyncCompany = jobSyncSession?.portal === "company";
  const [activeTab, setActiveTab] = useState<"active" | "archive">("active");
  const [selectedEmp, setSelectedEmp] = useState<any>(null);
  const [selectedArchivedEmp, setSelectedArchivedEmp] = useState<any>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editData, setEditData] = useState<any>({});
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [companyMembers, setCompanyMembers] = useState<JobSyncCompanyMember[]>([]);
  const [companyMembersLoading, setCompanyMembersLoading] = useState(false);
  const { start, end } = useMemo(() => getWeekRange(), []);

  const utils = trpc.useUtils();
  const { data: employees, isLoading } = trpc.employee.listAll.useQuery();
  const { data: deactivatedEmployees, isLoading: archiveLoading } = trpc.employee.listDeactivated.useQuery();
  const { data: weekPerf } = trpc.performance.getAllDateRange.useQuery({ startDate: start, endDate: end });
  const updateMutation = trpc.employee.update.useMutation();
  const changeCityMutation = trpc.employee.changeCityWithJobUnassign.useMutation();
  const resetPinMutation = trpc.employee.resetPin.useMutation();
  const deactivateWithJobsMutation = trpc.employee.deactivateWithJobs.useMutation();
  const transferJobMutation = trpc.employee.transferJob.useMutation();
  const unassignJobMutation = trpc.employee.unassignJob.useMutation();
  const reactivateMutation = trpc.employee.reactivate.useMutation();

  const CITY_OPTIONS = ["Niceville", "Destin", "Fort Walton Beach", "Crestview", "Pensacola"];

  // Deactivation confirmation state

  // Job handling modal (after deactivation)
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [deactivatingJobs, setDeactivatingJobs] = useState<any[]>([]);
  const [jobActions, setJobActions] = useState<Record<string, { action: "transfer" | "unassign"; toEmployeeId?: string; toEmployeeName?: string }>>({});
  const [deactivateLoading, setDeactivateLoading] = useState(false);

  // PIN reset state
  const [showPinReset, setShowPinReset] = useState(false);
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [pinSuccess, setPinSuccess] = useState(false);

  // Show deactivation confirmation sheet with job preview
  const handleShowDeactivateConfirm = () => {
    if (!selectedEmp) return;
    Alert.alert(
      `Deactivate ${selectedEmp.fullName}?`,
      `This will immediately remove them from the ${selectedEmp.city ?? "city"} calendar and live map. All upcoming jobs will be moved to Unassigned and their login access will be revoked.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Deactivate", style: "destructive", onPress: handleDeactivate },
      ]
    );
  };

  const handleDeactivate = async () => {
    if (!selectedEmp) return;
    setDeactivateLoading(true);
    try {
      const result = await deactivateWithJobsMutation.mutateAsync({ employeeId: selectedEmp.employeeId });
      const jobs = result.jobs ?? [];
      utils.employee.listAll.invalidate();
      utils.employee.listDeactivated.invalidate();
      setSelectedEmp(null);
      if (jobs.length === 0) {
        Alert.alert("Team Member Deactivated", `${selectedEmp.fullName} has been deactivated. Their calendar slot has been removed.`);
      } else {
        // Show job handling modal
        setDeactivatingJobs(jobs);
        const defaultActions: Record<string, { action: "transfer" | "unassign" }> = {};
        jobs.forEach((j: any) => { defaultActions[j.jobId] = { action: "unassign" }; });
        setJobActions(defaultActions);
        setShowDeactivateModal(true);
      }
    } catch {
      Alert.alert("Error", "Failed to deactivate team member. Please try again.");
    } finally {
      setDeactivateLoading(false);
    }
  };

  const handleConfirmJobActions = async () => {
    setDeactivateLoading(true);
    try {
      for (const job of deactivatingJobs) {
        const action = jobActions[job.jobId];
        if (action?.action === "transfer" && action.toEmployeeId) {
          await transferJobMutation.mutateAsync({
            jobId: job.jobId,
            toEmployeeId: action.toEmployeeId,
            toEmployeeName: action.toEmployeeName ?? "",
          });
        } else {
          await unassignJobMutation.mutateAsync({ jobId: job.jobId });
        }
      }
      setShowDeactivateModal(false);
      setDeactivatingJobs([]);
      setJobActions({});
      Alert.alert("Done", "All jobs have been handled successfully.");
    } catch {
      Alert.alert("Error", "Some jobs could not be updated. Please check the schedule.");
    } finally {
      setDeactivateLoading(false);
    }
  };

  const handleReactivate = async (emp: any) => {
    try {
      await reactivateMutation.mutateAsync({ employeeId: emp.employeeId });
      utils.employee.listAll.invalidate();
      utils.employee.listDeactivated.invalidate();
      setSelectedArchivedEmp(null);
      Alert.alert(
        "Team Member Reactivated",
        `${emp.fullName} has been reactivated and restored to the ${emp.city ?? "city"} calendar.`
      );
    } catch {
      Alert.alert("Error", "Failed to reactivate team member.");
    }
  };

  const handleResetPin = async () => {
    if (!selectedEmp) return;
    if (newPin.length < 4) { setPinError("PIN must be at least 4 digits"); return; }
    if (newPin !== confirmPin) { setPinError("PINs do not match"); return; }
    setPinError("");
    try {
      await resetPinMutation.mutateAsync({ employeeId: selectedEmp.employeeId, newPin });
      setPinSuccess(true);
      setNewPin(""); setConfirmPin("");
      setTimeout(() => { setPinSuccess(false); setShowPinReset(false); }, 2000);
    } catch {
      setPinError("Failed to reset PIN. Please try again.");
    }
  };

  const [roleFilter, setRoleFilter] = useState<string>("all");

  useEffect(() => {
    if (!isJobSyncCompany) return;
    const token = jobSyncSession?.token;
    const companyId = jobSyncSession?.company?.id;
    if (!token || !companyId) return;
    let cancelled = false;
    setCompanyMembersLoading(true);
    getJobSyncCompanyMembers(token, companyId)
      .then((roster) => {
        if (!cancelled) setCompanyMembers(roster.members);
      })
      .catch(() => {
        if (!cancelled) setCompanyMembers([]);
      })
      .finally(() => {
        if (!cancelled) setCompanyMembersLoading(false);
      });
    return () => { cancelled = true; };
  }, [isJobSyncCompany, jobSyncSession?.token, jobSyncSession?.company?.id]);

  const empWithPerf = useMemo(() => {
    if (!employees) return [];
    return employees.map((emp) => {
      const records = (weekPerf ?? []).filter((p) => p.employeeId === emp.employeeId);
      const totalRevenue = records.reduce((s, r) => s + Number(r.revenueProduced ?? 0), 0);
      const totalHours = records.reduce((s, r) => s + Number(r.hoursWorked ?? 0), 0);
      // Efficiency: total revenue / total hours / $100 target (weighted rate, not average of daily %)
      const avgEff = totalHours > 0 ? (totalRevenue / totalHours) / 100 * 100 : 0;
      return { ...emp, avgEff, totalRevenue, daysWorked: records.length };
    });
  }, [employees, weekPerf]);

  const companyRosterEmployees = useMemo(() => companyMembers.map((member) => ({
    employeeId: `jobsync-${member.id}`,
    fullName: member.name,
    role: nativeRoleForJobSyncMember(member.role),
    city: jobSyncSession?.company?.name ?? "Company workspace",
    avgEff: 0,
    totalRevenue: 0,
    daysWorked: 0,
    isJobSyncMember: true,
  })), [companyMembers, jobSyncSession?.company?.name]);

  const activeEmployees = isJobSyncCompany ? companyRosterEmployees : empWithPerf;
  const activeEmployeesLoading = isJobSyncCompany ? companyMembersLoading : isLoading;
  const archivedEmployees = isJobSyncCompany ? [] : (deactivatedEmployees ?? []);
  const visibleEmployees = roleFilter === "all" ? activeEmployees : activeEmployees.filter((employee: any) => employee.role === roleFilter);

  const detailEmpPerf = trpc.performance.getHistory.useQuery(
    { employeeId: selectedEmp?.employeeId ?? "", limit: 14 },
    { enabled: !!selectedEmp }
  );

  const detailEmpNotifs = trpc.notifications.getForEmployee.useQuery(
    { employeeId: selectedEmp?.employeeId ?? "" },
    { enabled: !!selectedEmp }
  );

  const archivedEmpPerf = trpc.performance.getHistory.useQuery(
    { employeeId: selectedArchivedEmp?.employeeId ?? "", limit: 30 },
    { enabled: !!selectedArchivedEmp }
  );

  const { data: progressionSummary } = trpc.mysteryBonus.getAllSummary.useQuery();

  const getLatestAttemptForEmp = (empId: string) => {
    const entry = (progressionSummary ?? []).find((p: any) => p.employeeId === empId);
    return entry ? Number(entry.count) : 0;
  };

  const startEdit = () => {
    setEditData({
      fullName: selectedEmp.fullName,
      email: selectedEmp.email ?? "",
      phoneNumber: selectedEmp.phoneNumber ?? "",
      city: selectedEmp.city ?? "",
      role: selectedEmp.role,
      pin: "",
      hourlyRate: selectedEmp.hourlyRate != null ? String(selectedEmp.hourlyRate) : "17.00",
      upsellBonusPct: selectedEmp.upsellBonusPct != null ? String(selectedEmp.upsellBonusPct) : "40.00",
      shiftStartHour: selectedEmp.shiftStartHour != null ? parseFloat(selectedEmp.shiftStartHour) : 8.0,
      shiftEndHour: selectedEmp.shiftEndHour != null ? parseFloat(selectedEmp.shiftEndHour) : 17.0,
      shift: (selectedEmp.shift ?? "shift1") as "shift1" | "shift2",
      customWorkDays: selectedEmp.customWorkDays ?? null,
    });
    setEditError("");
    setEditMode(true);
  };

  const handleSaveEdit = async () => {
    if (!editData.fullName?.trim()) { setEditError("Name is required"); return; }
    if (editData.pin && editData.pin.length < 4) { setEditError("PIN must be at least 4 digits"); return; }
    setEditSaving(true);
    setEditError("");
    try {
      const hourlyRateNum = parseFloat(editData.hourlyRate);
      const upsellBonusPctNum = parseFloat(editData.upsellBonusPct);
      const shiftStartHourNum = typeof editData.shiftStartHour === "number" ? editData.shiftStartHour : 8.0;
      const shiftEndHourNum = typeof editData.shiftEndHour === "number" ? editData.shiftEndHour : 17.0;
      const cityChanged = editData.role === "detailer" && editData.city && editData.city !== selectedEmp.city;
      // If city changed for a detailer, use the special procedure that unassigns their jobs first
      if (cityChanged) {
        await changeCityMutation.mutateAsync({
          employeeId: selectedEmp.employeeId,
          newCity: editData.city,
        });
        // Then update the rest of the fields (excluding city, already handled)
        await updateMutation.mutateAsync({
          employeeId: selectedEmp.employeeId,
          fullName: editData.fullName.trim(),
          email: editData.email?.trim() || null,
          phoneNumber: editData.phoneNumber?.trim() || null,
          role: editData.role,
          ...(editData.pin ? { pin: editData.pin } : {}),
          hourlyRate: isNaN(hourlyRateNum) ? null : hourlyRateNum,
          upsellBonusPct: isNaN(upsellBonusPctNum) ? null : upsellBonusPctNum,
          shiftStartHour: shiftStartHourNum,
          shiftEndHour: shiftEndHourNum,
          ...(editData.role === "detailer" ? { shift: editData.shift ?? "shift1", customWorkDays: editData.customWorkDays ?? null } : {}),
        });
      } else {
        await updateMutation.mutateAsync({
          employeeId: selectedEmp.employeeId,
          fullName: editData.fullName.trim(),
          email: editData.email?.trim() || null,
          phoneNumber: editData.phoneNumber?.trim() || null,
          city: editData.city?.trim() || null,
          role: editData.role,
          ...(editData.pin ? { pin: editData.pin } : {}),
          hourlyRate: isNaN(hourlyRateNum) ? null : hourlyRateNum,
          upsellBonusPct: isNaN(upsellBonusPctNum) ? null : upsellBonusPctNum,
          shiftStartHour: shiftStartHourNum,
          shiftEndHour: shiftEndHourNum,
          ...(editData.role === "detailer" ? { shift: editData.shift ?? "shift1", customWorkDays: editData.customWorkDays ?? null } : {}),
        });
      }
      utils.employee.listAll.invalidate();
      utils.employee.listDetailers.invalidate();
      setSelectedEmp({ ...selectedEmp, ...editData, pin: editData.pin || selectedEmp.pin });
      setEditMode(false);
    } catch {
      setEditError("Failed to save changes. Please try again.");
    } finally {
      setEditSaving(false);
    }
  };

  const roles: Array<{ value: string; label: string }> = [
    { value: "detailer", label: "Detailer" },
    { value: "admin", label: "Admin" },
    { value: "office", label: "Office" },
    { value: "operations_manager", label: "Ops Manager" },
    { value: "door_hanger_rep", label: "Door Hanger Rep" },
    { value: "sales", label: "Sales Rep" },
  ];

  return (
    <ScreenContainer edges={["left", "right"]} className="px-5">
      {/* Header */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8, marginBottom: 12 }}>
        <View>
          <Text style={{ fontSize: 24, fontWeight: "800", color: colors.foreground }}>Team Members</Text>
          <Text style={{ fontSize: 13, color: colors.muted }}>
            {activeTab === "active"
              ? `${activeEmployees.length} active`
              : `${archivedEmployees.length} archived`}
          </Text>
        </View>
        {activeTab === "active" && !isJobSyncCompany && (
          <TouchableOpacity
            onPress={() => setShowAddModal(true)}
            activeOpacity={0.7}
            style={{ backgroundColor: colors.primary, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 }}
          >
            <Text style={{ fontSize: 14, fontWeight: "700", color: "#FFF" }}>+ Add</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Tab Bar */}
      <View style={{
        flexDirection: "row", backgroundColor: colors.surface, borderRadius: 12,
        padding: 4, marginBottom: 16, borderWidth: 1, borderColor: colors.border,
      }}>
        {(["active", "archive"] as const).map((tab) => (
          <TouchableOpacity
            key={tab}
            onPress={() => setActiveTab(tab)}
            activeOpacity={0.7}
            style={{
              flex: 1, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center",
              backgroundColor: activeTab === tab ? colors.primary : "transparent",
            }}
          >
            <Text style={{
              fontSize: 14, fontWeight: "700", lineHeight: 18,
              color: activeTab === tab ? "#FFF" : colors.muted,
            }}>
              {tab === "active" ? "Active" : `Archive${archivedEmployees.length > 0 ? ` (${archivedEmployees.length})` : ""}`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Active Team Members Tab */}
      {activeTab === "active" && (
        activeEmployeesLoading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        ) : (
          <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
            data={visibleEmployees}
            keyExtractor={(item) => item.employeeId}
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 40 }}
            ListHeaderComponent={
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 4, paddingRight: 16 }}>
                  {([["all", "All Positions"], ["detailer", "Detailer"], ["admin", "Admin"], ["office", "Office"], ["operations_manager", "Ops Manager"], ["door_hanger_rep", "Door Hanger Rep"], ["sales", "Sales Rep"]] as const).map(([val, label]) => (
                    <TouchableOpacity
                      key={val}
                      onPress={() => setRoleFilter(val)}
                      activeOpacity={0.8}
                      style={{
                        height: 34,
                        paddingHorizontal: 14,
                        borderRadius: 17,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: roleFilter === val ? colors.primary : colors.surface,
                        borderWidth: 1,
                        borderColor: roleFilter === val ? colors.primary : colors.border,
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: "600", color: roleFilter === val ? "#FFF" : colors.muted, lineHeight: 16 }}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                disabled={isJobSyncCompany}
                onPress={() => { if (!isJobSyncCompany) { setSelectedEmp(item); setEditMode(false); } }}
                activeOpacity={0.7}
                style={{
                  backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 10,
                  borderWidth: 1, borderColor: colors.border,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{
                    width: 44, height: 44, borderRadius: 22,
                    backgroundColor: colors.primary + "20",
                    justifyContent: "center", alignItems: "center",
                  }}>
                    <Text style={{ fontSize: 16, fontWeight: "800", color: colors.primary }}>
                      {item.fullName.split(" ").map((n: string) => n[0]).join("").substring(0, 2)}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{item.fullName}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>{roleLabel(item.role)} | {item.city}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 2 }}>
                    {item.role === "detailer" && item.daysWorked > 0 && (
                      <Text style={{ fontSize: 20, fontWeight: "900", color: getEfficiencyColor(item.avgEff, colors) }}>
                        {item.avgEff.toFixed(0)}%
                      </Text>
                    )}
                    {item.role === "detailer" && getLatestAttemptForEmp(item.employeeId) > 0 && (
                      <View style={{ backgroundColor: "#D9770620", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 }}>
                        <Text style={{ fontSize: 10, fontWeight: "700", color: "#D97706" }}>
                          🎁 {getLatestAttemptForEmp(item.employeeId)} quiz
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            )}
          />
        )
      )}

      {/* Archive Tab */}
      {activeTab === "archive" && (
        archiveLoading ? (
          <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
        ) : archivedEmployees.length === 0 ? (
          <View style={{ alignItems: "center", marginTop: 60, gap: 8 }}>
            <Text style={{ fontSize: 40 }}>📦</Text>
            <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>No Archived Members</Text>
            <Text style={{ fontSize: 14, color: colors.muted, textAlign: "center" }}>
              Deactivated team members will appear here with their full history.
            </Text>
          </View>
        ) : (
          <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
            data={archivedEmployees}
            keyExtractor={(item) => item.employeeId}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40 }}
            renderItem={({ item }) => (
              <TouchableOpacity
                onPress={() => setSelectedArchivedEmp(item)}
                activeOpacity={0.7}
                style={{
                  backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 10,
                  borderWidth: 1, borderColor: colors.border, opacity: 0.85,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{
                    width: 44, height: 44, borderRadius: 22,
                    backgroundColor: colors.muted + "25",
                    justifyContent: "center", alignItems: "center",
                  }}>
                    <Text style={{ fontSize: 16, fontWeight: "800", color: colors.muted }}>
                      {item.fullName.split(" ").map((n: string) => n[0]).join("").substring(0, 2)}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: "700", color: colors.muted }}>{item.fullName}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted }}>{roleLabel(item.role)} | {item.city ?? "-"}</Text>
                  </View>
                  <View style={{
                    backgroundColor: colors.error + "15", borderRadius: 8,
                    paddingHorizontal: 10, paddingVertical: 4,
                    borderWidth: 1, borderColor: colors.error + "30",
                  }}>
                    <Text style={{ fontSize: 11, fontWeight: "700", color: colors.error }}>Inactive</Text>
                  </View>
                </View>
              </TouchableOpacity>
            )}
          />
        )
      )}

      {/* ─── Deactivation Confirmation Sheet ─── */}

      {/* ─── Job Handling Modal ─── */}
      <Modal visible={showDeactivateModal} animationType="slide" presentationStyle="pageSheet">
        <ScreenContainer edges={["bottom", "left", "right"]} className="px-5">
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={{ marginTop: 16 }}>
              <Text style={{ fontSize: 22, fontWeight: "800", color: colors.foreground, marginBottom: 4 }}>Handle Scheduled Jobs</Text>
              <Text style={{ fontSize: 14, color: colors.muted, marginBottom: 24 }}>
                This team member had {deactivatingJobs.length} upcoming job{deactivatingJobs.length !== 1 ? "s" : ""}. Choose what to do with each:
              </Text>
              {deactivatingJobs.map((job) => {
                const action = jobActions[job.jobId] ?? { action: "unassign" };
                return (
                  <View key={job.jobId} style={{
                    backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 12,
                    borderWidth: 1, borderColor: colors.border,
                  }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{job.customerName ?? "Customer"}</Text>
                    <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>
                      {job.date} · {job.timeSlot ?? "TBD"} · {job.location}
                    </Text>
                    <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 12 }}>
                      {job.vehicleYear} {job.vehicleMake} {job.vehicleModel} — {job.packageType}
                    </Text>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <TouchableOpacity
                        onPress={() => setJobActions(prev => ({ ...prev, [job.jobId]: { action: "unassign" } }))}
                        activeOpacity={0.7}
                        style={{
                          flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center",
                          backgroundColor: action.action === "unassign" ? colors.warning + "20" : colors.surface,
                          borderWidth: 1, borderColor: action.action === "unassign" ? colors.warning : colors.border,
                        }}
                      >
                        <Text style={{ fontSize: 13, fontWeight: "600", color: action.action === "unassign" ? colors.warning : colors.muted }}>Unassign</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          const activeDetailers = (employees ?? []).filter((e: any) => e.role === "detailer" && e.city === job.location);
                          if (activeDetailers.length === 0) {
                            Alert.alert("No Detailers", `No active detailers found in ${job.location}. Job will be unassigned.`);
                            return;
                          }
                          Alert.alert(
                            "Transfer To",
                            "Select a detailer to transfer this job to:",
                            [
                              ...activeDetailers.map((d: any) => ({
                                text: d.fullName,
                                onPress: () => setJobActions(prev => ({
                                  ...prev,
                                  [job.jobId]: { action: "transfer", toEmployeeId: d.employeeId, toEmployeeName: d.fullName },
                                })),
                              })),
                              { text: "Cancel", style: "cancel" },
                            ]
                          );
                        }}
                        activeOpacity={0.7}
                        style={{
                          flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center",
                          backgroundColor: action.action === "transfer" ? colors.primary + "20" : colors.surface,
                          borderWidth: 1, borderColor: action.action === "transfer" ? colors.primary : colors.border,
                        }}
                      >
                        <Text style={{ fontSize: 13, fontWeight: "600", color: action.action === "transfer" ? colors.primary : colors.muted }}>
                          {action.action === "transfer" && action.toEmployeeName ? `→ ${action.toEmployeeName}` : "Transfer"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
              <TouchableOpacity
                onPress={handleConfirmJobActions}
                disabled={deactivateLoading}
                activeOpacity={0.8}
                style={{
                  backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16,
                  alignItems: "center", marginTop: 8, marginBottom: 40,
                  opacity: deactivateLoading ? 0.7 : 1,
                }}
              >
                {deactivateLoading ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <Text style={{ fontSize: 16, fontWeight: "700", color: "#FFF" }}>Confirm & Apply</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </ScreenContainer>
      </Modal>

      {/* ─── Active Team Member Detail Modal ─── */}
      <Modal visible={!!selectedEmp} animationType="slide" presentationStyle="pageSheet">
        {selectedEmp && (
          <ScreenContainer edges={["bottom", "left", "right"]} className="px-5">
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <View style={{ marginTop: 12 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <TouchableOpacity
                    onPress={() => { setSelectedEmp(null); setEditMode(false); setShowPinReset(false); setNewPin(""); setConfirmPin(""); setPinError(""); setPinSuccess(false); }}
                    activeOpacity={0.7} style={{ paddingVertical: 8 }}
                  >
                    <Text style={{ fontSize: 16, color: colors.primary, fontWeight: "600" }}>Close</Text>
                  </TouchableOpacity>
                  {!editMode && (
                    <TouchableOpacity onPress={startEdit} activeOpacity={0.7} style={{ paddingVertical: 8 }}>
                      <Text style={{ fontSize: 16, color: colors.primary, fontWeight: "600" }}>Edit</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Header */}
                <View style={{ alignItems: "center", marginTop: 16, marginBottom: 24 }}>
                  <View style={{
                    width: 72, height: 72, borderRadius: 36,
                    backgroundColor: colors.primary,
                    justifyContent: "center", alignItems: "center", marginBottom: 12,
                  }}>
                    <Text style={{ fontSize: 24, fontWeight: "800", color: "#FFF" }}>
                      {(editMode ? editData.fullName : selectedEmp.fullName).split(" ").map((n: string) => n[0]).join("").substring(0, 2)}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 20, fontWeight: "800", color: colors.foreground }}>
                    {editMode ? editData.fullName : selectedEmp.fullName}
                  </Text>
                  <Text style={{ fontSize: 14, color: colors.muted }}>
                    {roleLabel(editMode ? editData.role : selectedEmp.role)} · {editMode ? editData.city : selectedEmp.city}
                  </Text>
                </View>

                {editMode ? (
                  /* ─── Edit Mode ─── */
                  <View>
                    <EditField label="Full Name" value={editData.fullName} onChangeText={(t: string) => setEditData({ ...editData, fullName: t })} colors={colors} />
                    <EditField label="Email" value={editData.email} onChangeText={(t: string) => setEditData({ ...editData, email: t })} colors={colors} keyboardType="email-address" autoCapitalize="none" />
                    <EditField label="Phone" value={editData.phoneNumber} onChangeText={(t: string) => setEditData({ ...editData, phoneNumber: t })} colors={colors} keyboardType="phone-pad" />
                    {/* City dropdown — for detailers this also moves their jobs to Unassigned */}
                    <View style={{ marginBottom: 16 }}>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>City</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                        {CITY_OPTIONS.map((c) => (
                          <TouchableOpacity
                            key={c}
                            onPress={() => setEditData({ ...editData, city: c })}
                            activeOpacity={0.7}
                            style={{
                              paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                              backgroundColor: editData.city === c ? colors.primary : colors.surface,
                              borderWidth: 1, borderColor: editData.city === c ? colors.primary : colors.border,
                            }}
                          >
                            <Text style={{ fontSize: 13, fontWeight: "600", color: editData.city === c ? "#FFF" : colors.foreground }}>{c}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      {editData.role === "detailer" && editData.city && editData.city !== selectedEmp.city && (
                        <Text style={{ fontSize: 11, color: colors.warning, marginTop: 6 }}>
                          ⚠️ Changing city will move this detailer&apos;s upcoming jobs to Unassigned.
                        </Text>
                      )}
                    </View>
                    <EditField label="New PIN (leave blank to keep)" value={editData.pin} onChangeText={(t: string) => setEditData({ ...editData, pin: t.replace(/[^0-9]/g, "").substring(0, 6) })} colors={colors} keyboardType="number-pad" secureTextEntry placeholder="Leave blank to keep current" />

                    {/* Pay Rates */}
                    <View style={{ marginBottom: 20 }}>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>💰 Pay Rates</Text>
                      <View style={{ flexDirection: "row", gap: 12 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6 }}>Hourly Rate ($)</Text>
                          <TextInput
                            value={editData.hourlyRate}
                            onChangeText={(t: string) => setEditData({ ...editData, hourlyRate: t.replace(/[^0-9.]/g, "") })}
                            keyboardType="decimal-pad"
                            placeholder="17.00"
                            placeholderTextColor={colors.muted}
                            returnKeyType="done"
                            style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 12, fontSize: 16, color: colors.foreground, borderWidth: 1, borderColor: colors.border }}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6 }}>Upsell Bonus (%)</Text>
                          <TextInput
                            value={editData.upsellBonusPct}
                            onChangeText={(t: string) => setEditData({ ...editData, upsellBonusPct: t.replace(/[^0-9.]/g, "") })}
                            keyboardType="decimal-pad"
                            placeholder="40.00"
                            placeholderTextColor={colors.muted}
                            returnKeyType="done"
                            style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 12, fontSize: 16, color: colors.foreground, borderWidth: 1, borderColor: colors.border }}
                          />
                        </View>
                      </View>
                      <Text style={{ fontSize: 11, color: colors.muted, marginTop: 6 }}>These rates apply to payroll, projected paycheck, and upsell bonus calculations.</Text>
                    </View>

                    <View style={{ marginBottom: 20 }}>
                      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Role</Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                        {roles.map((r) => (
                          <TouchableOpacity
                            key={r.value}
                            onPress={() => setEditData({ ...editData, role: r.value })}
                            activeOpacity={0.7}
                            style={{
                              paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                              backgroundColor: editData.role === r.value ? colors.primary : colors.surface,
                              borderWidth: 1, borderColor: editData.role === r.value ? colors.primary : colors.border,
                            }}
                          >
                            <Text style={{ fontSize: 13, fontWeight: "600", color: editData.role === r.value ? "#FFF" : colors.foreground }}>{r.label}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>

                    {/* Custom Work Days — only shown for detailers */}
                    {editData.role === "detailer" && (
                      <View style={{ marginBottom: 20 }}>
                        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>Work Days</Text>
                        <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 10 }}>
                          Tap to toggle working days. Overrides the default Mon–Thu / Fri–Sun shift pattern.
                        </Text>
                        <View style={{ flexDirection: "row", gap: 6 }}>
                          {([{label:"Mo",day:1},{label:"Tu",day:2},{label:"We",day:3},{label:"Th",day:4},{label:"Fr",day:5},{label:"Sa",day:6},{label:"Su",day:0}]).map(({ label, day }) => {
                            const activeDays: number[] = editData.customWorkDays
                              ? editData.customWorkDays.split(",").map((x: string) => parseInt(x.trim(), 10))
                              : (editData.shift === "shift2" ? [5,6,0] : [1,2,3,4]);
                            const isActive = activeDays.includes(day);
                            return (
                              <TouchableOpacity
                                key={day}
                                onPress={() => {
                                  const current: number[] = editData.customWorkDays
                                    ? editData.customWorkDays.split(",").map((x: string) => parseInt(x.trim(), 10))
                                    : (editData.shift === "shift2" ? [5,6,0] : [1,2,3,4]);
                                  const next = current.includes(day) ? current.filter(d => d !== day) : [...current, day];
                                  setEditData({ ...editData, customWorkDays: next.length > 0 ? next.join(",") : null });
                                }}
                                activeOpacity={0.7}
                                style={{
                                  flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center",
                                  backgroundColor: isActive ? colors.primary : colors.surface,
                                  borderWidth: 1, borderColor: isActive ? colors.primary : colors.border,
                                }}
                              >
                                <Text style={{ fontSize: 13, fontWeight: "700", color: isActive ? "#FFF" : colors.muted }}>{label}</Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                        {editData.customWorkDays && (
                          <TouchableOpacity
                            onPress={() => setEditData({ ...editData, customWorkDays: null })}
                            activeOpacity={0.7}
                            style={{ marginTop: 8, alignSelf: "flex-end" }}
                          >
                            <Text style={{ fontSize: 12, color: colors.muted, textDecorationLine: "underline" }}>Reset to default shift</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}

                    {editError ? (
                      <View style={{ backgroundColor: colors.error + "15", borderRadius: 10, padding: 12, marginBottom: 12 }}>
                        <Text style={{ color: colors.error, fontSize: 14, textAlign: "center" }}>{editError}</Text>
                      </View>
                    ) : null}
                    <View style={{ flexDirection: "row", gap: 12 }}>
                      <TouchableOpacity
                        onPress={() => setEditMode(false)}
                        activeOpacity={0.7}
                        style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 12, paddingVertical: 14, alignItems: "center", borderWidth: 1, borderColor: colors.border }}
                      >
                        <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={handleSaveEdit}
                        disabled={editSaving}
                        activeOpacity={0.8}
                        style={{ flex: 1, backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center", opacity: editSaving ? 0.7 : 1 }}
                      >
                        {editSaving ? <ActivityIndicator color="#FFF" /> : <Text style={{ fontSize: 15, fontWeight: "700", color: "#FFF" }}>Save Changes</Text>}
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  /* ─── View Mode ─── */
                  <>
                    <View style={{ gap: 8, marginBottom: 16 }}>
                      <InfoRow label="Team Member ID" value={selectedEmp.employeeId} colors={colors} />
                      <InfoRow label="Email" value={selectedEmp.email ?? "-"} colors={colors} />
                      <InfoRow label="Phone" value={selectedEmp.phoneNumber ?? "-"} colors={colors} />
                      <InfoRow label="Hire Date" value={formatDate(selectedEmp.hireDate)} colors={colors} />
                      {selectedEmp.role === "detailer" && (() => {
                        const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
                        const activeDays: number[] = selectedEmp.customWorkDays
                          ? selectedEmp.customWorkDays.split(",").map((x: string) => parseInt(x.trim(), 10))
                          : (selectedEmp.shift === "shift2" ? [5,6,0] : [1,2,3,4]);
                        const label = activeDays.sort((a: number, b: number) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b)).map((d: number) => DAY_NAMES[d]).join(", ");
                        return <InfoRow label="Work Days" value={label || "-"} colors={colors} />;
                      })()}
                    </View>

                    {/* Pay Rates Card */}
                    <View style={{ backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border }}>
                      <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>💰 Pay Rates</Text>
                      <View style={{ flexDirection: "row", gap: 12 }}>
                        <View style={{ flex: 1, backgroundColor: colors.background, borderRadius: 10, padding: 12, alignItems: "center", borderWidth: 1, borderColor: colors.border }}>
                          <Text style={{ fontSize: 22, fontWeight: "900", color: colors.primary }}>${Number(selectedEmp.hourlyRate ?? 17).toFixed(2)}</Text>
                          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>per hour</Text>
                        </View>
                        <View style={{ flex: 1, backgroundColor: colors.background, borderRadius: 10, padding: 12, alignItems: "center", borderWidth: 1, borderColor: colors.border }}>
                          <Text style={{ fontSize: 22, fontWeight: "900", color: colors.success }}>{Number(selectedEmp.upsellBonusPct ?? 40).toFixed(0)}%</Text>
                          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>upsell bonus</Text>
                        </View>
                      </View>
                      <Text style={{ fontSize: 11, color: colors.muted, marginTop: 8, textAlign: "center" }}>Tap Edit to change rates · Syncs with payroll &amp; projected paycheck</Text>
                    </View>

                    <View style={{ gap: 8, marginBottom: 16 }}>
                      {selectedEmp.role === "detailer" && (
                        <InfoRow
                          label="Mystery Bonus"
                          value={getLatestAttemptForEmp(selectedEmp.employeeId) > 0
                            ? `${getLatestAttemptForEmp(selectedEmp.employeeId)} challenge(s) attempted`
                            : "No challenges attempted"}
                          colors={colors}
                        />
                      )}
                    </View>

                    {/* Van Assignment */}
                    {selectedEmp.role === "detailer" && (
                      <VanAssignmentSection employeeId={selectedEmp.employeeId} employeeName={selectedEmp.fullName} colors={colors} />
                    )}

                    {/* Reset PIN */}
                    <View style={{ marginBottom: 24, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
                      <TouchableOpacity
                        onPress={() => { setShowPinReset(!showPinReset); setNewPin(""); setConfirmPin(""); setPinError(""); setPinSuccess(false); }}
                        activeOpacity={0.7}
                        style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, backgroundColor: colors.surface }}
                      >
                        <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }}>🔑 Reset Login PIN</Text>
                        <Text style={{ fontSize: 13, color: colors.primary }}>{showPinReset ? "Cancel" : "Change"}</Text>
                      </TouchableOpacity>
                      {showPinReset && (
                        <View style={{ padding: 16, backgroundColor: colors.background, gap: 12 }}>
                          {pinSuccess ? (
                            <View style={{ backgroundColor: colors.success + "20", borderRadius: 10, padding: 14, alignItems: "center" }}>
                              <Text style={{ color: colors.success, fontWeight: "700", fontSize: 15 }}>✓ PIN Updated Successfully</Text>
                            </View>
                          ) : (
                            <>
                              <View>
                                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>New PIN (4–6 digits)</Text>
                                <TextInput
                                  value={newPin}
                                  onChangeText={(t) => setNewPin(t.replace(/[^0-9]/g, "").substring(0, 6))}
                                  keyboardType="number-pad"
                                  secureTextEntry
                                  placeholder="Enter new PIN"
                                  placeholderTextColor={colors.muted}
                                  returnKeyType="next"
                                  style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 12, fontSize: 16, color: colors.foreground, borderWidth: 1, borderColor: colors.border }}
                                />
                              </View>
                              <View>
                                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Confirm New PIN</Text>
                                <TextInput
                                  value={confirmPin}
                                  onChangeText={(t) => setConfirmPin(t.replace(/[^0-9]/g, "").substring(0, 6))}
                                  keyboardType="number-pad"
                                  secureTextEntry
                                  placeholder="Confirm new PIN"
                                  placeholderTextColor={colors.muted}
                                  returnKeyType="done"
                                  onSubmitEditing={handleResetPin}
                                  style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 12, fontSize: 16, color: colors.foreground, borderWidth: 1, borderColor: colors.border }}
                                />
                              </View>
                              {pinError ? <Text style={{ color: colors.error, fontSize: 13, textAlign: "center" }}>{pinError}</Text> : null}
                              <TouchableOpacity
                                onPress={handleResetPin}
                                disabled={resetPinMutation.isPending}
                                activeOpacity={0.8}
                                style={{ backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center", opacity: resetPinMutation.isPending ? 0.7 : 1 }}
                              >
                                {resetPinMutation.isPending ? <ActivityIndicator color="#FFF" /> : <Text style={{ fontSize: 15, fontWeight: "700", color: "#FFF" }}>Update PIN</Text>}
                              </TouchableOpacity>
                            </>
                          )}
                        </View>
                      )}
                    </View>

                    {/* Deactivate Button */}
                    <TouchableOpacity
                      onPress={handleShowDeactivateConfirm}
                      disabled={deactivateLoading}
                      activeOpacity={0.8}
                      style={{
                        backgroundColor: colors.error + "15",
                        borderRadius: 12, paddingVertical: 14, alignItems: "center",
                        borderWidth: 1, borderColor: colors.error + "40",
                        marginBottom: 24, opacity: deactivateLoading ? 0.6 : 1,
                      }}
                    >
                      {deactivateLoading ? (
                        <ActivityIndicator color={colors.error} />
                      ) : (
                        <Text style={{ fontSize: 15, fontWeight: "700", color: colors.error }}>Deactivate Team Member</Text>
                      )}
                    </TouchableOpacity>

                    {/* Performance History */}
                    {selectedEmp.role === "detailer" && (
                      <>
                        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>Recent Performance</Text>
                        {detailEmpPerf.isLoading ? (
                          <ActivityIndicator color={colors.primary} />
                        ) : (detailEmpPerf.data ?? []).length === 0 ? (
                          <Text style={{ color: colors.muted, fontSize: 14, marginBottom: 16 }}>No performance data</Text>
                        ) : (
                          (detailEmpPerf.data ?? []).map((p) => {
                            const eff = Number(p.efficiencyPercent ?? 0);
                            return (
                              <View key={p.recordId} style={{
                                backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 8,
                                borderWidth: 1, borderColor: colors.border,
                                borderLeftWidth: 3, borderLeftColor: getEfficiencyColor(eff, colors),
                              }}>
                                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{formatDate(p.date)}</Text>
                                  <Text style={{ fontSize: 18, fontWeight: "900", color: getEfficiencyColor(eff, colors) }}>{eff.toFixed(1)}%</Text>
                                </View>
                                <View style={{ flexDirection: "row", gap: 16, marginTop: 4 }}>
                                  <Text style={{ fontSize: 12, color: colors.muted }}>Rev: ${Number(p.revenueProduced ?? 0).toFixed(0)}</Text>
                                  <Text style={{ fontSize: 12, color: colors.muted }}>Hrs: {Number(p.hoursWorked ?? 0).toFixed(1)}</Text>
                                  <Text style={{ fontSize: 12, color: colors.muted }}>Bonus: ${Number(p.upsells ?? 0).toFixed(0)}</Text>
                                </View>
                              </View>
                            );
                          })
                        )}

                        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginTop: 16, marginBottom: 12 }}>Recent Notifications</Text>
                        {detailEmpNotifs.isLoading ? (
                          <ActivityIndicator color={colors.primary} />
                        ) : (detailEmpNotifs.data ?? []).length === 0 ? (
                          <Text style={{ color: colors.muted, fontSize: 14, marginBottom: 16 }}>No notifications</Text>
                        ) : (
                          (detailEmpNotifs.data ?? []).slice(0, 5).map((n) => (
                            <View key={n.notificationId} style={{
                              backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 8,
                              borderWidth: 1, borderColor: colors.border,
                            }}>
                              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{n.title}</Text>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
                                <Text style={{ fontSize: 11, color: colors.muted, textTransform: "capitalize" }}>{n.status}</Text>
                                <Text style={{ fontSize: 11, color: colors.muted }}>{n.notificationType.replace(/_/g, " ")}</Text>
                              </View>
                            </View>
                          ))
                        )}
                      </>
                    )}
                  </>
                )}
              </View>
            </ScrollView>
          </ScreenContainer>
        )}
      </Modal>

      {/* ─── Archived Team Member Detail Modal ─── */}
      <Modal visible={!!selectedArchivedEmp} animationType="slide" presentationStyle="pageSheet">
        {selectedArchivedEmp && (
          <ScreenContainer edges={["bottom", "left", "right"]} className="px-5">
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ marginTop: 12 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <TouchableOpacity onPress={() => setSelectedArchivedEmp(null)} activeOpacity={0.7} style={{ paddingVertical: 8 }}>
                    <Text style={{ fontSize: 16, color: colors.primary, fontWeight: "600" }}>Close</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      Alert.alert(
                        `Reactivate ${selectedArchivedEmp.fullName}?`,
                        `They will be restored to the ${selectedArchivedEmp.city ?? "city"} calendar and regain login access.`,
                        [
                          { text: "Cancel", style: "cancel" },
                          { text: "Reactivate", onPress: () => handleReactivate(selectedArchivedEmp) },
                        ]
                      );
                    }}
                    activeOpacity={0.7}
                    style={{
                      backgroundColor: colors.success + "20", borderRadius: 10,
                      paddingHorizontal: 14, paddingVertical: 8,
                      borderWidth: 1, borderColor: colors.success + "40",
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.success }}>Reactivate</Text>
                  </TouchableOpacity>
                </View>

                {/* Header */}
                <View style={{ alignItems: "center", marginTop: 16, marginBottom: 24 }}>
                  <View style={{
                    width: 72, height: 72, borderRadius: 36,
                    backgroundColor: colors.muted + "30",
                    justifyContent: "center", alignItems: "center", marginBottom: 12,
                  }}>
                    <Text style={{ fontSize: 24, fontWeight: "800", color: colors.muted }}>
                      {selectedArchivedEmp.fullName.split(" ").map((n: string) => n[0]).join("").substring(0, 2)}
                    </Text>
                  </View>
                  <Text style={{ fontSize: 20, fontWeight: "800", color: colors.foreground }}>{selectedArchivedEmp.fullName}</Text>
                  <Text style={{ fontSize: 14, color: colors.muted }}>{roleLabel(selectedArchivedEmp.role)} · {selectedArchivedEmp.city ?? "-"}</Text>
                  <View style={{
                    marginTop: 8, backgroundColor: colors.error + "15", borderRadius: 8,
                    paddingHorizontal: 12, paddingVertical: 4,
                    borderWidth: 1, borderColor: colors.error + "30",
                  }}>
                    <Text style={{ fontSize: 12, fontWeight: "700", color: colors.error }}>Inactive</Text>
                  </View>
                </View>

                {/* Info */}
                <View style={{ gap: 8, marginBottom: 24 }}>
                  <InfoRow label="Team Member ID" value={selectedArchivedEmp.employeeId} colors={colors} />
                  <InfoRow label="Email" value={selectedArchivedEmp.email ?? "-"} colors={colors} />
                  <InfoRow label="Phone" value={selectedArchivedEmp.phoneNumber ?? "-"} colors={colors} />
                  <InfoRow label="Hire Date" value={formatDate(selectedArchivedEmp.hireDate)} colors={colors} />
                </View>

                {/* Performance History */}
                {selectedArchivedEmp.role === "detailer" && (
                  <>
                    <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground, marginBottom: 4 }}>Performance History</Text>
                    <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>Last 30 recorded days</Text>
                    {archivedEmpPerf.isLoading ? (
                      <ActivityIndicator color={colors.primary} />
                    ) : (archivedEmpPerf.data ?? []).length === 0 ? (
                      <View style={{
                        backgroundColor: colors.surface, borderRadius: 12, padding: 20, alignItems: "center",
                        borderWidth: 1, borderColor: colors.border, marginBottom: 16,
                      }}>
                        <Text style={{ fontSize: 14, color: colors.muted }}>No performance records found</Text>
                      </View>
                    ) : (
                      <>
                        {/* Summary stats */}
                        {(() => {
                          const records = archivedEmpPerf.data ?? [];
                          const totalRev = records.reduce((s, r) => s + Number(r.revenueProduced ?? 0), 0);
                          const totalHrs = records.reduce((s, r) => s + Number(r.hoursWorked ?? 0), 0);
                          // Efficiency: total revenue / total hours / $100 target
                          const avgEff = totalHrs > 0 ? (totalRev / totalHrs) / 100 * 100 : 0;
                          return (
                            <View style={{
                              flexDirection: "row", gap: 8, marginBottom: 16,
                            }}>
                              {[
                                { label: "Days", value: records.length.toString() },
                                { label: "Revenue", value: `$${totalRev.toFixed(0)}` },
                                { label: "Hours", value: totalHrs.toFixed(0) },
                                { label: "Avg Eff", value: `${avgEff.toFixed(0)}%` },
                              ].map((stat) => (
                                <View key={stat.label} style={{
                                  flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 12,
                                  alignItems: "center", borderWidth: 1, borderColor: colors.border,
                                }}>
                                  <Text style={{ fontSize: 16, fontWeight: "800", color: colors.foreground }}>{stat.value}</Text>
                                  <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>{stat.label}</Text>
                                </View>
                              ))}
                            </View>
                          );
                        })()}
                        {(archivedEmpPerf.data ?? []).map((p) => {
                          const eff = Number(p.efficiencyPercent ?? 0);
                          return (
                            <View key={p.recordId} style={{
                              backgroundColor: colors.surface, borderRadius: 12, padding: 14, marginBottom: 8,
                              borderWidth: 1, borderColor: colors.border,
                              borderLeftWidth: 3, borderLeftColor: getEfficiencyColor(eff, colors),
                            }}>
                              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{formatDate(p.date)}</Text>
                                <Text style={{ fontSize: 18, fontWeight: "900", color: getEfficiencyColor(eff, colors) }}>{eff.toFixed(1)}%</Text>
                              </View>
                              <View style={{ flexDirection: "row", gap: 16, marginTop: 4 }}>
                                <Text style={{ fontSize: 12, color: colors.muted }}>Rev: ${Number(p.revenueProduced ?? 0).toFixed(0)}</Text>
                                <Text style={{ fontSize: 12, color: colors.muted }}>Hrs: {Number(p.hoursWorked ?? 0).toFixed(1)}</Text>
                                <Text style={{ fontSize: 12, color: colors.muted }}>Bonus: ${Number(p.upsells ?? 0).toFixed(0)}</Text>
                              </View>
                            </View>
                          );
                        })}
                      </>
                    )}
                  </>
                )}
              </View>
            </ScrollView>
          </ScreenContainer>
        )}
      </Modal>

      {/* Add Team Member Modal */}
      <AddTeamMemberModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        colors={colors}
        onSuccess={() => {
          utils.employee.listAll.invalidate();
          utils.employee.listDetailers.invalidate();
        }}
      />
    </ScreenContainer>
  );
}

function AddTeamMemberModal({ visible, onClose, colors, onSuccess }: { visible: boolean; onClose: () => void; colors: any; onSuccess: () => void }) {
  const [memberId, setMemberId] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<"detailer" | "admin" | "office" | "operations_manager" | "door_hanger_rep" | "sales">("detailer");
  const [shift, setShift] = useState<"shift1" | "shift2">("shift1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const createMutation = trpc.employee.create.useMutation();

  const resetForm = () => {
    setMemberId(""); setFullName(""); setEmail(""); setPhone(""); setCity(""); setPin(""); setRole("detailer"); setShift("shift1"); setError("");
  };

  const handleSave = async () => {
    if (!memberId.trim()) { setError("Team Member ID is required"); return; }
    if (!fullName.trim()) { setError("Full name is required"); return; }
    if (!pin || pin.length < 4) { setError("PIN must be at least 4 digits"); return; }
    setError("");
    setSaving(true);
    try {
      const result = await createMutation.mutateAsync({
        employeeId: memberId.trim().toUpperCase(),
        fullName: fullName.trim(),
        email: email.trim() || undefined,
        phoneNumber: phone.trim() || undefined,
        city: city.trim() || undefined,
        pin,
        role,
        hireDate: new Date().toISOString().split("T")[0],
        shift: role === "detailer" ? shift : undefined,
      });
      if (!result.success) {
        setError((result as any).error ?? "Failed to create team member");
        setSaving(false);
        return;
      }
      onSuccess();
      resetForm();
      onClose();
    } catch {
      setError("Failed to create team member. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const roles: Array<{ value: typeof role; label: string }> = [
    { value: "detailer", label: "Detailer" },
    { value: "admin", label: "Admin" },
    { value: "office", label: "Office" },
    { value: "operations_manager", label: "Ops Manager" },
    { value: "door_hanger_rep", label: "Door Hanger Rep" },
    { value: "sales", label: "Sales Rep" },
  ];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <ScreenContainer edges={["bottom", "left", "right"]} className="px-5">
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={{ marginTop: 12 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
              <TouchableOpacity onPress={() => { resetForm(); onClose(); }} activeOpacity={0.7} style={{ paddingVertical: 8 }}>
                <Text style={{ fontSize: 16, color: colors.primary, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>Add Team Member</Text>
              <View style={{ width: 60 }} />
            </View>

            <FormField label="Team Member ID" value={memberId} onChangeText={(t: string) => setMemberId(t.replace(/[^a-zA-Z0-9]/g, "").toUpperCase())} placeholder="e.g. EMP006" colors={colors} autoCapitalize="characters" />
            <FormField label="Full Name" value={fullName} onChangeText={setFullName} placeholder="e.g. John Smith" colors={colors} />
            <FormField label="Email" value={email} onChangeText={setEmail} placeholder="e.g. john@example.com" colors={colors} keyboardType="email-address" autoCapitalize="none" />
            <FormField label="Phone" value={phone} onChangeText={setPhone} placeholder="e.g. 555-123-4567" colors={colors} keyboardType="phone-pad" />
            {/* City dropdown */}
            <View style={{ marginBottom: 16 }}>
              <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>City</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {["Niceville", "Destin", "Fort Walton Beach", "Crestview", "Pensacola"].map((c) => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => setCity(c)}
                    activeOpacity={0.7}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                      backgroundColor: city === c ? colors.primary : colors.surface,
                      borderWidth: 1, borderColor: city === c ? colors.primary : colors.border,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: "600", color: city === c ? "#FFF" : colors.foreground }}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <FormField label="PIN (4-6 digits)" value={pin} onChangeText={(t: string) => setPin(t.replace(/[^0-9]/g, "").substring(0, 6))} placeholder="e.g. 1234" colors={colors} keyboardType="number-pad" secureTextEntry />

            {/* Shift selector — only relevant for detailers */}
            {role === "detailer" && (
              <View style={{ marginBottom: 20 }}>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Shift</Text>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  {(["shift1", "shift2"] as const).map((s) => (
                    <TouchableOpacity
                      key={s}
                      onPress={() => setShift(s)}
                      activeOpacity={0.7}
                      style={{
                        flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center",
                        backgroundColor: shift === s ? colors.primary : colors.surface,
                        borderWidth: 1, borderColor: shift === s ? colors.primary : colors.border,
                      }}
                    >
                      <Text style={{ fontSize: 14, fontWeight: "700", color: shift === s ? "#FFF" : colors.foreground }}>
                        {s === "shift1" ? "1st Shift" : "2nd Shift"}
                      </Text>
                      <Text style={{ fontSize: 11, color: shift === s ? "rgba(255,255,255,0.8)" : colors.muted, marginTop: 2 }}>
                        {s === "shift1" ? "Mon – Thu" : "Fri – Sun"}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            <View style={{ marginBottom: 20 }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Role</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {roles.map((r) => (
                  <TouchableOpacity
                    key={r.value}
                    onPress={() => setRole(r.value)}
                    activeOpacity={0.7}
                    style={{
                      paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
                      backgroundColor: role === r.value ? colors.primary : colors.surface,
                      borderWidth: 1, borderColor: role === r.value ? colors.primary : colors.border,
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: "600", color: role === r.value ? "#FFF" : colors.foreground }}>{r.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {error ? (
              <View style={{ backgroundColor: colors.error + "15", borderRadius: 10, padding: 12, marginBottom: 16 }}>
                <Text style={{ color: colors.error, fontSize: 14, textAlign: "center" }}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.8}
              style={{
                backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 16,
                alignItems: "center", opacity: saving ? 0.7 : 1, marginBottom: 40,
              }}
            >
              {saving ? <ActivityIndicator color="#FFF" /> : <Text style={{ color: "#FFF", fontSize: 16, fontWeight: "700" }}>Add Team Member</Text>}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </ScreenContainer>
    </Modal>
  );
}

function EditField({ label, value, onChangeText, colors, keyboardType, autoCapitalize, secureTextEntry, placeholder }: {
  label: string; value: string; onChangeText: (t: string) => void; colors: any;
  keyboardType?: any; autoCapitalize?: any; secureTextEntry?: boolean; placeholder?: string;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? label}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        secureTextEntry={secureTextEntry}
        returnKeyType="next"
        style={{
          backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
          borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: colors.foreground,
        }}
      />
    </View>
  );
}

function FormField({ label, value, onChangeText, placeholder, colors, keyboardType, autoCapitalize, secureTextEntry }: {
  label: string; value: string; onChangeText: (t: string) => void; placeholder: string; colors: any;
  keyboardType?: any; autoCapitalize?: any; secureTextEntry?: boolean;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        secureTextEntry={secureTextEntry}
        returnKeyType="next"
        style={{
          backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
          borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: colors.foreground,
        }}
      />
    </View>
  );
}

function InfoRow({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View style={{
      flexDirection: "row", justifyContent: "space-between", alignItems: "center",
      backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
      borderWidth: 1, borderColor: colors.border,
    }}>
      <Text style={{ fontSize: 13, color: colors.muted }}>{label}</Text>
      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{value}</Text>
    </View>
  );
}

// ─── Van Assignment Section ───────────────────────────────────────────────────

function VanAssignmentSection({ employeeId, employeeName, colors }: {
  employeeId: string;
  employeeName: string;
  colors: any;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [selectedShift, setSelectedShift] = useState<"shift1" | "shift2">("shift1");

  const utils = trpc.useUtils();
  const { data: assignment, refetch: refetchAssignment } =
    trpc.fleet.getVanAssignment.useQuery({ employeeId }, { enabled: !!employeeId });

  const { data: vans = [] } = trpc.fleet.listVans.useQuery({}, { enabled: showPicker });

  const invalidateAll = () => {
    refetchAssignment();
    utils.fleet.getAllVanAssignments.invalidate();
    utils.fleet.listVans.invalidate();
  };

  const setAssignment = trpc.fleet.setVanAssignment.useMutation({
    onSuccess: () => { invalidateAll(); setShowPicker(false); },
    onError: (e) => Alert.alert("Error", e.message),
  });

  const removeAssignment = trpc.fleet.removeVanAssignment.useMutation({
    onSuccess: () => invalidateAll(),
    onError: (e) => Alert.alert("Error", e.message),
  });

  const shiftLabel = (s?: string) => s === "shift2" ? "2nd Shift" : "1st Shift";

  return (
    <View style={{ marginBottom: 24, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, backgroundColor: colors.surface }}>
        <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }}>🚐 Assigned Van</Text>
        <TouchableOpacity onPress={() => setShowPicker(!showPicker)} activeOpacity={0.7}>
          <Text style={{ fontSize: 13, color: colors.primary }}>{showPicker ? "Cancel" : assignment ? "Change" : "Assign"}</Text>
        </TouchableOpacity>
      </View>

      <View style={{ padding: 16, backgroundColor: colors.background }}>
        {assignment ? (
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View>
              <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground }}>{assignment.vanName ?? assignment.vanId}</Text>
              <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600", marginTop: 2 }}>
                {shiftLabel((assignment as any).shift)}
              </Text>
              <Text style={{ fontSize: 12, color: colors.muted, marginTop: 1 }}>
                Assigned {new Date(assignment.assignedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                Alert.alert("Remove Assignment", `Remove ${employeeName} from this van?`, [
                  { text: "Cancel", style: "cancel" },
                  { text: "Remove", style: "destructive", onPress: () => removeAssignment.mutate({ employeeId }) },
                ]);
              }}
              style={{ backgroundColor: colors.error + "20", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: colors.error + "40" }}
            >
              <Text style={{ color: colors.error, fontSize: 12, fontWeight: "700" }}>Remove</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={{ color: colors.muted, fontSize: 13 }}>No van assigned yet.</Text>
        )}

        {showPicker && (
          <View style={{ marginTop: 14, gap: 10 }}>
            {/* Shift selector */}
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>Shift</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["shift1", "shift2"] as const).map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => setSelectedShift(s)}
                  style={{
                    flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center",
                    backgroundColor: selectedShift === s ? colors.primary : colors.surface,
                    borderWidth: 1, borderColor: selectedShift === s ? colors.primary : colors.border,
                  }}
                >
                  <Text style={{ color: selectedShift === s ? "#fff" : colors.foreground, fontWeight: "700", fontSize: 13 }}>
                    {s === "shift1" ? "1st Shift" : "2nd Shift"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Van list */}
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4 }}>Select a Van</Text>
            {(vans as any[]).length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 13 }}>No vans found. Add vans in the Fleet tab first.</Text>
            ) : (
              (vans as any[]).map((van: any) => (
                <TouchableOpacity
                  key={van.id}
                  onPress={() => setAssignment.mutate({ employeeId, vanId: van.id, vanName: van.name, shift: selectedShift, assignedBy: "Admin" })}
                  style={{
                    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                    backgroundColor: assignment?.vanId === van.id ? colors.primary + "20" : colors.surface,
                    borderRadius: 10, padding: 12, borderWidth: 1,
                    borderColor: assignment?.vanId === van.id ? colors.primary : colors.border,
                  }}
                >
                  <View>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{van.name}</Text>
                    {van.city ? <Text style={{ fontSize: 12, color: colors.muted }}>{van.city}</Text> : null}
                  </View>
                  {assignment?.vanId === van.id && (
                    <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "700" }}>✓ Current</Text>
                  )}
                  {setAssignment.isPending && <ActivityIndicator size="small" color={colors.primary} />}
                </TouchableOpacity>
              ))
            )}
          </View>
        )}
      </View>
    </View>
  );
}
