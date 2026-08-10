import { useState, useMemo, useCallback } from "react";
import {
  Text,
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";

function getTodayStr() {
  return new Date().toISOString().split("T")[0];
}

function formatDateDisplay(dateStr: string) {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(parts[1], 10) - 1]} ${parseInt(parts[2], 10)}, ${parts[0]}`;
}

function shiftDate(dateStr: string, days: number) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

export default function AdminEntryScreen() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const utils = trpc.useUtils();

  // State
  const [selectedDate, setSelectedDate] = useState(getTodayStr);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [hoursWorked, setHoursWorked] = useState("");
  const [revenueProduced, setRevenueProduced] = useState("");

  const [upsells, setUpsells] = useState("");
  const [tips, setTips] = useState("");
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  // Queries
  const { data: detailers, isLoading: loadingDetailers } = trpc.employee.listDetailers.useQuery();
  const { data: existingRecords, isLoading: loadingRecords } = trpc.performance.getAllByDate.useQuery(
    { date: selectedDate },
    { enabled: !!selectedDate }
  );

  // Mutation
  const upsertMutation = trpc.performance.upsert.useMutation();

  // Selected employee info
  const selectedEmployee = useMemo(
    () => detailers?.find((d) => d.employeeId === selectedEmployeeId) ?? null,
    [detailers, selectedEmployeeId]
  );

  // Check if there's an existing record for the selected employee+date
  const existingRecord = useMemo(
    () => existingRecords?.find((r) => r.employeeId === selectedEmployeeId) ?? null,
    [existingRecords, selectedEmployeeId]
  );

  // Load existing data when selecting an employee
  const handleSelectEmployee = useCallback(
    (empId: string) => {
      setSelectedEmployeeId(empId);
      setSuccessMsg("");
      const existing = existingRecords?.find((r) => r.employeeId === empId);
      if (existing) {
        setHoursWorked(String(existing.hoursWorked ?? ""));
        setRevenueProduced(String(existing.revenueProduced ?? ""));
        setUpsells(String(existing.upsells ?? ""));
        setTips(String(existing.tips ?? ""));
      } else {
        setHoursWorked("");
        setRevenueProduced("");
        setUpsells("");
        setTips("");
      }
    },
    [existingRecords]
  );

  // Navigate date
  const goToPrevDay = () => {
    setSelectedDate((d) => shiftDate(d, -1));
    setSelectedEmployeeId(null);
    resetForm();
  };
  const goToNextDay = () => {
    const next = shiftDate(selectedDate, 1);
    if (next <= getTodayStr()) {
      setSelectedDate(next);
      setSelectedEmployeeId(null);
      resetForm();
    }
  };
  const goToToday = () => {
    setSelectedDate(getTodayStr());
    setSelectedEmployeeId(null);
    resetForm();
  };

  const resetForm = () => {
    setHoursWorked("");
    setRevenueProduced("");
    setUpsells("");
    setTips("");
    setSuccessMsg("");
  };

  const isToday = selectedDate === getTodayStr();

  // Save handler
  const handleSave = async () => {
    if (!selectedEmployeeId || !selectedEmployee) return;

    const hours = parseFloat(hoursWorked);
    const revenue = parseFloat(revenueProduced);
    const bonusAmount = parseFloat(upsells);
    const tipsAmount = parseFloat(tips);

    if (isNaN(hours) || hours < 0) {
      showAlert("Please enter valid hours worked (0 or more).");
      return;
    }
    if (isNaN(revenue) || revenue < 0) {
      showAlert("Please enter valid revenue (0 or more).");
      return;
    }

    // Auto-calculate efficiency: target is $100/hr = 100%
    // Formula: (revenue / hours) / 100 * 100  →  revenue / hours
    // e.g. $800 revenue / 8 hrs = $100/hr = 100% efficiency
    const efficiency = hours > 0 ? (revenue / hours) / 100 * 100 : 0;
    if (isNaN(bonusAmount) || bonusAmount < 0) {
      showAlert("Please enter a valid bonus amount (0 or more).");
      return;
    }
    if (isNaN(tipsAmount) || tipsAmount < 0) {
      showAlert("Please enter a valid tips amount (0 or more).");
      return;
    }

    setSaving(true);
    setSuccessMsg("");
    try {
      // Generate a deterministic recordId based on employee+date so upsert works correctly.
      // Use the same format as syncPerformanceFromJobs (PERF_ID_YYYYMMDD) so records merge properly.
      const recordId = `PERF_${selectedEmployeeId}_${selectedDate.replace(/-/g, '')}`;
      await upsertMutation.mutateAsync({
        recordId,
        date: selectedDate,
        employeeId: selectedEmployeeId,
        fullName: selectedEmployee.fullName,
        city: selectedEmployee.city ?? undefined,
        hoursWorked: hours.toFixed(2),
        revenueProduced: revenue.toFixed(2),
        efficiencyPercent: efficiency.toFixed(0),
        upsells: bonusAmount.toFixed(2),
        tips: tipsAmount.toFixed(2),
        createdBy: employee?.employeeId ?? "admin",
      });

      // Invalidate related queries
      utils.performance.getAllByDate.invalidate({ date: selectedDate });
      utils.performance.getAllDateRange.invalidate();
      utils.performance.getDateRange.invalidate();
      utils.performance.getByDate.invalidate();
      utils.performance.getHistory.invalidate();

      setSuccessMsg(`Saved ${selectedEmployee.fullName}'s data for ${formatDateDisplay(selectedDate)}`);
    } catch (e: any) {
      showAlert("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  function showAlert(msg: string) {
    if (Platform.OS === "web") {
      alert(msg);
    } else {
      Alert.alert("Validation Error", msg);
    }
  }

  // Summary of who has data for this date
  const entryStatus = useMemo(() => {
    if (!detailers || !existingRecords) return [];
    return detailers.map((d) => {
      const record = existingRecords.find((r) => r.employeeId === d.employeeId);
      return {
        employeeId: d.employeeId,
        fullName: d.fullName,
        hasData: !!record,
        efficiency: record ? Number(record.efficiencyPercent ?? 0) : null,
      };
    });
  }, [detailers, existingRecords]);

  const completedCount = entryStatus.filter((e) => e.hasData).length;
  const totalCount = entryStatus.length;

  return (
    <ScreenContainer edges={["left", "right"]} className="px-5">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={{ marginTop: 8, marginBottom: 16 }}>
            <Text style={{ fontSize: 14, color: colors.muted }}>Daily Entry</Text>
            <Text style={{ fontSize: 24, fontWeight: "800", color: colors.foreground }}>
              Log Performance
            </Text>
          </View>

          {/* Date Navigator */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              backgroundColor: colors.surface,
              borderRadius: 14,
              padding: 14,
              marginBottom: 16,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <TouchableOpacity
              onPress={goToPrevDay}
              activeOpacity={0.7}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: colors.primary + "15",
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Text style={{ fontSize: 18, color: colors.primary, fontWeight: "700" }}>‹</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={goToToday} activeOpacity={0.7}>
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>
                {formatDateDisplay(selectedDate)}
              </Text>
              {isToday && (
                <Text
                  style={{
                    fontSize: 11,
                    color: colors.primary,
                    textAlign: "center",
                    fontWeight: "600",
                  }}
                >
                  Today
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={goToNextDay}
              activeOpacity={0.7}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: isToday ? colors.border + "50" : colors.primary + "15",
                justifyContent: "center",
                alignItems: "center",
                opacity: isToday ? 0.4 : 1,
              }}
            >
              <Text
                style={{
                  fontSize: 18,
                  color: isToday ? colors.muted : colors.primary,
                  fontWeight: "700",
                }}
              >
                ›
              </Text>
            </TouchableOpacity>
          </View>

          {/* Completion Progress */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>
              Select Team Member
            </Text>
            <View
              style={{
                backgroundColor:
                  completedCount === totalCount && totalCount > 0
                    ? colors.success + "15"
                    : colors.warning + "15",
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 12,
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: "700",
                  color:
                    completedCount === totalCount && totalCount > 0
                      ? colors.success
                      : colors.warning,
                }}
              >
                {completedCount}/{totalCount} logged
              </Text>
            </View>
          </View>

          {/* Team Member Chips */}
          {loadingDetailers ? (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginVertical: 20 }} />
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
              {entryStatus.map((emp) => {
                const isSelected = emp.employeeId === selectedEmployeeId;
                return (
                  <TouchableOpacity
                    key={emp.employeeId}
                    onPress={() => handleSelectEmployee(emp.employeeId)}
                    activeOpacity={0.7}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: isSelected ? colors.primary : colors.surface,
                      borderRadius: 20,
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderWidth: 1,
                      borderColor: isSelected ? colors.primary : colors.border,
                      gap: 6,
                    }}
                  >
                    {emp.hasData && (
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: isSelected ? "#FFFFFF" : colors.success,
                        }}
                      />
                    )}
                    <Text
                      style={{
                        fontSize: 13,
                        fontWeight: "600",
                        color: isSelected ? "#FFFFFF" : colors.foreground,
                      }}
                    >
                      {emp.fullName.split(" ")[0]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {/* Entry Form */}
          {selectedEmployeeId && selectedEmployee ? (
            <View
              style={{
                backgroundColor: colors.surface,
                borderRadius: 16,
                padding: 20,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground }}>
                  {selectedEmployee.fullName}
                </Text>
                <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>
                  {selectedEmployee.city ?? "No city"} •{" "}
                  {existingRecord ? "Editing existing record" : "New entry"}
                </Text>
              </View>

              {/* Hours Worked */}
              <View style={{ marginBottom: 14 }}>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "600",
                    color: colors.muted,
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  Hours Worked
                </Text>
                <TextInput
                  value={hoursWorked}
                  onChangeText={setHoursWorked}
                  placeholder="e.g. 8.5"
                  placeholderTextColor={colors.muted}
                  keyboardType="decimal-pad"
                  returnKeyType="next"
                  style={{
                    backgroundColor: colors.background,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 10,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    fontSize: 16,
                    color: colors.foreground,
                  }}
                />
              </View>

              {/* Revenue Produced */}
              <View style={{ marginBottom: 14 }}>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "600",
                    color: colors.muted,
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  Revenue Produced ($)
                </Text>
                <TextInput
                  value={revenueProduced}
                  onChangeText={setRevenueProduced}
                  placeholder="e.g. 450.00"
                  placeholderTextColor={colors.muted}
                  keyboardType="decimal-pad"
                  returnKeyType="next"
                  style={{
                    backgroundColor: colors.background,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 10,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    fontSize: 16,
                    color: colors.foreground,
                  }}
                />
              </View>



              {/* Upsells */}
              <View style={{ marginBottom: 14 }}>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "600",
                    color: colors.muted,
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  Bonus ($)
                </Text>
                <TextInput
                  value={upsells}
                  onChangeText={(t) => setUpsells(t.replace(/[^0-9.]/g, ""))}
                  placeholder="e.g. 75.00"
                  placeholderTextColor={colors.muted}
                  keyboardType="number-pad"
                  returnKeyType="next"
                  style={{
                    backgroundColor: colors.background,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 10,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    fontSize: 16,
                    color: colors.foreground,
                  }}
                />
              </View>

              {/* Tips */}
              <View style={{ marginBottom: 20 }}>
                <Text
                  style={{
                    fontSize: 13,
                    fontWeight: "600",
                    color: colors.muted,
                    marginBottom: 6,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  Tips ($)
                </Text>
                <TextInput
                  value={tips}
                  onChangeText={(t) => setTips(t.replace(/[^0-9.]/g, ""))}
                  placeholder="e.g. 25.00"
                  placeholderTextColor={colors.muted}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  onSubmitEditing={handleSave}
                  style={{
                    backgroundColor: colors.background,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 10,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    fontSize: 16,
                    color: colors.foreground,
                  }}
                />
              </View>

              {/* Success Message */}
              {successMsg ? (
                <View
                  style={{
                    backgroundColor: colors.success + "15",
                    borderRadius: 10,
                    padding: 12,
                    marginBottom: 14,
                    borderWidth: 1,
                    borderColor: colors.success + "30",
                  }}
                >
                  <Text style={{ color: colors.success, fontSize: 13, fontWeight: "600", textAlign: "center" }}>
                    {successMsg}
                  </Text>
                </View>
              ) : null}

              {/* Save Button */}
              <TouchableOpacity
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.8}
                style={{
                  backgroundColor: colors.primary,
                  borderRadius: 12,
                  paddingVertical: 16,
                  alignItems: "center",
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "700" }}>
                    {existingRecord ? "Update Record" : "Save Record"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <View
              style={{
                backgroundColor: colors.surface,
                borderRadius: 16,
                padding: 30,
                alignItems: "center",
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text style={{ fontSize: 40, marginBottom: 12 }}>📋</Text>
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: "600",
                  color: colors.foreground,
                  textAlign: "center",
                  marginBottom: 4,
                }}
              >
                Select an employee above
              </Text>
              <Text style={{ fontSize: 13, color: colors.muted, textAlign: "center" }}>
                Choose a detailer to log their daily performance metrics
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
