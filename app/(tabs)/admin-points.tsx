import React, { useState, useMemo } from "react";
import {
  Text, View, FlatList, TouchableOpacity, ActivityIndicator,
  Modal, ScrollView, TextInput, Alert, StyleSheet,
} from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { CalendarPicker } from "@/components/calendar-picker";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { useEmployeeAuth } from "@/lib/auth-context";

// ─── Period filter helpers ────────────────────────────────────────────────────
type PeriodKey = "day" | "week" | "month" | "custom";
const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "day",    label: "Day" },
  { key: "week",   label: "Week" },
  { key: "month",  label: "Month" },
  { key: "custom", label: "Custom" },
];
function localDateStr(d: Date = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function todayStr() { return localDateStr(); }
function weekRangeStr() {
  const d = new Date();
  const day = d.getDay();
  const mon = new Date(d); mon.setDate(d.getDate() - ((day + 6) % 7));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  return { from: localDateStr(mon), to: localDateStr(sun) };
}
function monthRangeStr() {
  const d = new Date();
  const y = d.getFullYear(), m = d.getMonth();
  const from = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const last = new Date(y, m + 1, 0).getDate();
  const to = `${y}-${String(m + 1).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { from, to };
}
function getPeriodRange(key: PeriodKey, customFrom?: string, customTo?: string): { from: string; to: string } {
  switch (key) {
    case "day":    return { from: todayStr(), to: todayStr() };
    case "week":   return weekRangeStr();
    case "month":  return monthRangeStr();
    case "custom": return { from: customFrom ?? todayStr(), to: customTo ?? todayStr() };
  }
}
function getPeriodLabel(key: PeriodKey, customFrom?: string, customTo?: string): string {
  switch (key) {
    case "day":   return `Today · ${todayStr()}`;
    case "week":  { const r = weekRangeStr(); return `Week · ${r.from} – ${r.to}`; }
    case "month": { const r = monthRangeStr(); return `Month · ${r.from} – ${r.to}`; }
    case "custom":
      if (customFrom && customTo) return `${customFrom} – ${customTo}`;
      if (customFrom) return `From ${customFrom}`;
      return "Custom Range";
  }
}

// Violation presets with labels, deduction amounts, and descriptions
const VIOLATION_PRESETS = [
  {
    type: "missed_morning_meeting" as const,
    label: "Missed Morning Meeting",
    points: 1,
    description: "Did not attend the scheduled morning meeting",
  },
  {
    type: "no_before_after_photos" as const,
    label: "No Before/After Photos",
    points: 1,
    description: "Failed to upload before and after photos for a job",
  },
  {
    type: "no_late_arrival_notice" as const,
    label: "No Late Arrival Notice",
    points: 1,
    description: "Did not notify of late arrival to a job",
  },
  {
    type: "qc_issue" as const,
    label: "QC Issue",
    points: 1.5,
    description: "Quality control issue reported on a completed job",
  },
  {
    type: "forgot_clock_in_out" as const,
    label: "Forgot to Clock In/Out",
    points: 0.5,
    description: "Failed to clock in or out at the correct time",
  },
  {
    type: "vehicle_damage" as const,
    label: "Vehicle Damage",
    points: 3,
    description: "Caused damage to a customer's vehicle",
  },
  {
    type: "other" as const,
    label: "Other",
    points: 1,
    description: "Custom violation — specify in notes",
  },
];

const REASON_LABELS: Record<string, string> = {
  pto: "PTO",
  sick: "Sick Day",
  personal: "Personal",
  other: "Other",
};

function getPointsColor(pts: number, colors: any) {
  if (pts >= 8) return colors.success;
  if (pts >= 7) return colors.warning;
  return colors.error;
}

function formatViolationType(type: string) {
  return VIOLATION_PRESETS.find(v => v.type === type)?.label ?? type;
}

function getCurrentWeekLabel() {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(monday)} – ${fmt(sunday)}`;
}

function formatDateLabel(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** Returns today's date as YYYY-MM-DD in CST */
function todayCSTString(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function AdminPointsScreen() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const utils = trpc.useUtils();

  // ── Points tab state ──────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<"points" | "daysoff">("points");
  const [selectedDetailer, setSelectedDetailer] = useState<any>(null);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedViolation, setSelectedViolation] = useState<typeof VIOLATION_PRESETS[0] | null>(null);
  const [customPoints, setCustomPoints] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ── Period filter state ───────────────────────────────────────────────────
  const [periodKey, setPeriodKey] = useState<PeriodKey>("week");
  const [customFrom, setCustomFrom] = useState<string | undefined>(undefined);
  const [customTo, setCustomTo] = useState<string | undefined>(undefined);
  const [customStep, setCustomStep] = useState<"from" | "to">("from");
  const [showCustomPicker, setShowCustomPicker] = useState(false);

  const periodRange = useMemo(
    () => getPeriodRange(periodKey, customFrom, customTo),
    [periodKey, customFrom, customTo]
  );
  const isCurrentWeek = periodKey === "week" && !customFrom;

  const { data: allEmployees, isLoading: empLoading } = trpc.employee.listAll.useQuery();
  const { data: allPoints, isLoading: ptsLoading, refetch: refetchPoints } = trpc.points.getAllPoints.useQuery();

  const [writeUpMode, setWriteUpMode] = useState(false);
  const [writeUpTitle, setWriteUpTitle] = useState("");
  const issueViolationMutation = trpc.points.issueViolation.useMutation();
  const issueWriteUpMutation = trpc.points.issueWriteUp.useMutation();
  const adjustPointsMutation = trpc.points.adjustPoints.useMutation();

  const { data: violations, refetch: refetchViolations } = trpc.points.getAllViolations.useQuery(
    {},
    { enabled: showHistoryModal }
  );

  // Period-filtered violations (used when period != current week)
  const { data: periodViolations, isLoading: periodViolationsLoading } = trpc.points.getViolationsByDateRange.useQuery(
    { startDate: periodRange.from, endDate: periodRange.to },
    { enabled: !isCurrentWeek && activeTab === "points" }
  );

  // ── Days Off tab state ────────────────────────────────────────────────────
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [dayOffEmployee, setDayOffEmployee] = useState<any>(null);
  const [dayOffDate, setDayOffDate] = useState(todayCSTString());
  const [dayOffReason, setDayOffReason] = useState<"pto" | "sick" | "personal" | "other">("pto");
  const [dayOffNotes, setDayOffNotes] = useState("");
  const [assigningDayOff, setAssigningDayOff] = useState(false);

  const { data: upcomingDaysOff, refetch: refetchDaysOff, isLoading: daysOffLoading } = trpc.daysOff.getUpcoming.useQuery(
    undefined,
    { enabled: activeTab === "daysoff" }
  );
  const assignDayOffMutation = trpc.daysOff.assign.useMutation();
  const removeDayOffMutation = trpc.daysOff.remove.useMutation();

  // Only show detailers
  const detailers = useMemo(() => {
    if (!allEmployees) return [];
    return allEmployees.filter((e: any) => e.role === "detailer" && e.activeStatus === "active");
  }, [allEmployees]);

  // Merge employee info with points data
  // For current week: use live balance from detailerPoints table
  // For other periods: compute from violation history (start at 10, subtract deductions)
  const detailersWithPoints = useMemo(() => {
    return detailers.map((emp: any) => {
      if (isCurrentWeek) {
        const pts = allPoints?.find((p: any) => p.employeeId === emp.employeeId);
        return {
          ...emp,
          currentPoints: pts?.currentPoints ?? 10,
          bonusEligible: pts?.bonusEligible ?? true,
        };
      } else {
        // Compute from period violations
        const empViolations = (periodViolations ?? []).filter(
          (v: any) => v.employeeId === emp.employeeId
        );
        const totalDeducted = empViolations.reduce(
          (sum: number, v: any) => sum + parseFloat(String(v.pointsDeducted)),
          0
        );
        const computedPts = Math.max(0, 10 - totalDeducted);
        return {
          ...emp,
          currentPoints: computedPts,
          bonusEligible: computedPts >= 7,
          periodViolationCount: empViolations.length,
        };
      }
    });
  }, [detailers, allPoints, isCurrentWeek, periodViolations]);

  const handleIssueViolation = async () => {
    if (!selectedDetailer || !selectedViolation) return;
    const pts = selectedViolation.type === "other"
      ? parseFloat(customPoints)
      : selectedViolation.points;
    if (isNaN(pts) || pts <= 0) {
      Alert.alert("Invalid Points", "Please enter a valid point amount.");
      return;
    }
    if (writeUpMode && !writeUpTitle.trim()) {
      Alert.alert("Title Required", "Please enter a write-up title.");
      return;
    }
    setSubmitting(true);
    try {
      if (writeUpMode) {
        await issueWriteUpMutation.mutateAsync({
          employeeId: selectedDetailer.employeeId,
          employeeName: selectedDetailer.fullName,
          violationType: selectedViolation.type,
          pointsDeducted: pts,
          title: writeUpTitle.trim(),
          message: notes.trim() || undefined,
          issuedBy: employee?.fullName ?? "Admin",
        });
        Alert.alert(
          "Write-Up Issued",
          `${selectedDetailer.fullName} has been issued a formal write-up and lost ${pts} pt${pts !== 1 ? "s" : ""}. They will be notified immediately.`
        );
      } else {
        await issueViolationMutation.mutateAsync({
          employeeId: selectedDetailer.employeeId,
          employeeName: selectedDetailer.fullName,
          violationType: selectedViolation.type,
          pointsDeducted: pts,
          notes: notes.trim() || undefined,
          issuedBy: employee?.fullName ?? "Admin",
        });
        Alert.alert(
          "Points Deducted",
          `${selectedDetailer.fullName} lost ${pts} point${pts !== 1 ? "s" : ""} for: ${selectedViolation.label}.`
        );
      }
      await refetchPoints();
      setShowIssueModal(false);
      setSelectedViolation(null);
      setNotes("");
      setCustomPoints("");
      setWriteUpTitle("");
      setWriteUpMode(false);
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "Failed to issue violation.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddPoints = (detailer: any) => {
    Alert.alert(
      "Add Points",
      `Add points back to ${detailer.fullName}?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "+0.5", onPress: () => doAdjust(detailer, 0.5) },
        { text: "+1", onPress: () => doAdjust(detailer, 1) },
      ]
    );
  };

  const doAdjust = async (detailer: any, amount: number) => {
    try {
      await adjustPointsMutation.mutateAsync({
        employeeId: detailer.employeeId,
        adjustment: amount,
        issuedBy: employee?.fullName ?? "Admin",
        notes: `Manual adjustment +${amount}`,
      });
      await refetchPoints();
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "Failed to adjust points.");
    }
  };

  const handleAssignDayOff = async () => {
    if (!dayOffEmployee || !dayOffDate) return;
    setAssigningDayOff(true);
    try {
      await assignDayOffMutation.mutateAsync({
        employeeId: dayOffEmployee.employeeId,
        fullName: dayOffEmployee.fullName,
        offDate: dayOffDate,
        reason: dayOffReason,
        notes: dayOffNotes.trim() || undefined,
        assignedBy: employee?.fullName ?? "Admin",
      });
      await refetchDaysOff();
      setShowAssignModal(false);
      setDayOffEmployee(null);
      setDayOffDate(todayCSTString());
      setDayOffReason("pto");
      setDayOffNotes("");
      Alert.alert("Day Off Assigned", `${dayOffEmployee.fullName} is marked off on ${formatDateLabel(dayOffDate)}.`);
    } catch (e: any) {
      Alert.alert("Error", e.message ?? "Failed to assign day off.");
    } finally {
      setAssigningDayOff(false);
    }
  };

  const handleRemoveDayOff = (dayOff: any) => {
    Alert.alert(
      "Remove Day Off",
      `Remove ${dayOff.fullName}'s day off on ${formatDateLabel(dayOff.offDate)}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await removeDayOffMutation.mutateAsync({ dayOffId: dayOff.dayOffId });
              await refetchDaysOff();
            } catch (e: any) {
              Alert.alert("Error", e.message ?? "Failed to remove day off.");
            }
          },
        },
      ]
    );
  };

  const isLoading = empLoading || ptsLoading || (!isCurrentWeek && periodViolationsLoading);

  return (
    <ScreenContainer edges={["left", "right"]} className="flex-1">
      {/* Header */}
      <View style={{ backgroundColor: colors.primary, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 }}>
        <Text style={{ color: "#fff", fontSize: 20, fontWeight: "700" }}>Accountability Points</Text>
        <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 13, marginTop: 2 }}>
          {getPeriodLabel(periodKey, customFrom, customTo)} · 10 pts/period · Bonus eligibility: 7+ pts
        </Text>
      </View>

      {/* Tab bar */}
      <View style={{ flexDirection: "row", backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <TouchableOpacity
          onPress={() => setActiveTab("points")}
          style={{
            flex: 1, paddingVertical: 11, alignItems: "center",
            borderBottomWidth: 2.5,
            borderBottomColor: activeTab === "points" ? colors.primary : "transparent",
          }}
        >
          <Text style={{ color: activeTab === "points" ? colors.primary : colors.muted, fontSize: 14, fontWeight: "700" }}>
            Points
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setActiveTab("daysoff")}
          style={{
            flex: 1, paddingVertical: 11, alignItems: "center",
            borderBottomWidth: 2.5,
            borderBottomColor: activeTab === "daysoff" ? colors.primary : "transparent",
          }}
        >
          <Text style={{ color: activeTab === "daysoff" ? colors.primary : colors.muted, fontSize: 14, fontWeight: "700" }}>
            Days Off
          </Text>
        </TouchableOpacity>
      </View>

      {/* ── POINTS TAB ── */}
      {activeTab === "points" && (
        <>
          {/* Period filter tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ backgroundColor: colors.background, borderBottomWidth: 1, borderBottomColor: colors.border }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}
          >
            {PERIOD_OPTIONS.map((opt) => {
              const isActive = periodKey === opt.key;
              return (
                <TouchableOpacity
                  key={opt.key}
                  onPress={() => {
                    if (opt.key === "custom") {
                      setCustomFrom(undefined);
                      setCustomTo(undefined);
                      setCustomStep("from");
                      setShowCustomPicker(true);
                      setPeriodKey("custom");
                    } else {
                      setPeriodKey(opt.key);
                    }
                  }}
                  style={{
                    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
                    backgroundColor: isActive ? colors.primary : colors.surface,
                    borderWidth: 1.5,
                    borderColor: isActive ? colors.primary : colors.border,
                    minWidth: 64,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: isActive ? "#fff" : colors.foreground, fontSize: 13, fontWeight: "700", lineHeight: 18, includeFontPadding: false }}>
                    {opt.key === "custom" && customFrom
                      ? (customTo ? `${customFrom} – ${customTo}` : customFrom)
                      : opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Custom Date Range Modal */}
          <Modal visible={showCustomPicker} transparent animationType="slide" onRequestClose={() => setShowCustomPicker(false)}>
            <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
              <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 40 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }}>
                  <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 17 }}>Custom Date Range</Text>
                  <TouchableOpacity onPress={() => setShowCustomPicker(false)}>
                    <Text style={{ color: colors.primary, fontSize: 16 }}>Done</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 }}>
                  <View style={{ flex: 1, padding: 10, borderRadius: 10, borderWidth: 2, borderColor: customStep === "from" ? colors.primary : colors.border, backgroundColor: customFrom ? colors.primary + "22" : colors.surface, alignItems: "center" }}>
                    <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>START DATE</Text>
                    <Text style={{ color: customFrom ? colors.primary : colors.muted, fontWeight: "700", fontSize: 14 }}>{customFrom ?? "Tap to select"}</Text>
                  </View>
                  <View style={{ flex: 1, padding: 10, borderRadius: 10, borderWidth: 2, borderColor: customStep === "to" ? colors.primary : colors.border, backgroundColor: customTo ? colors.primary + "22" : colors.surface, alignItems: "center" }}>
                    <Text style={{ color: colors.muted, fontSize: 11, marginBottom: 2 }}>END DATE</Text>
                    <Text style={{ color: customTo ? colors.primary : colors.muted, fontWeight: "700", fontSize: 14 }}>{customTo ?? "Tap to select"}</Text>
                  </View>
                </View>
                <Text style={{ color: colors.muted, fontSize: 12, textAlign: "center", marginBottom: 8 }}>
                  {customStep === "from" ? "Select start date" : "Select end date"}
                </Text>
                <CalendarPicker
                  selectedDate={customStep === "from" ? customFrom : customTo}
                  rangeStart={customFrom}
                  rangeEnd={customTo}
                  onSelectDate={(dateStr) => {
                    if (customStep === "from") {
                      setCustomFrom(dateStr);
                      setCustomTo(undefined);
                      setCustomStep("to");
                    } else {
                      if (customFrom && dateStr < customFrom) {
                        setCustomFrom(dateStr);
                        setCustomTo(customFrom);
                      } else {
                        setCustomTo(dateStr);
                      }
                      setCustomStep("from");
                      setShowCustomPicker(false);
                    }
                  }}
                />
              </View>
            </View>
          </Modal>

          {/* Legend */}
          <View style={{ flexDirection: "row", paddingHorizontal: 16, paddingVertical: 8, gap: 16, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.success }} />
              <Text style={{ color: colors.muted, fontSize: 11 }}>8–10 pts (Bonus eligible)</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.warning }} />
              <Text style={{ color: colors.muted, fontSize: 11 }}>7 pts (At risk)</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.error }} />
              <Text style={{ color: colors.muted, fontSize: 11 }}>Below 7 (No bonus)</Text>
            </View>
          </View>

          {/* History button */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 8, flexDirection: "row", justifyContent: "flex-end" }}>
            <TouchableOpacity
              onPress={() => { setShowHistoryModal(true); refetchViolations(); }}
              style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
            >
              <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "600" }}>View All Violations</Text>
            </TouchableOpacity>
          </View>

          {isLoading ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator color={colors.primary} size="large" />
            </View>
          ) : (
            <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
              data={detailersWithPoints}
              keyExtractor={item => item.employeeId}
              contentContainerStyle={{ padding: 16, gap: 12 }}
              renderItem={({ item }) => {
                const pts = item.currentPoints;
                const ptsColor = getPointsColor(pts, colors);
                const bonusEligible = pts >= 7;
                return (
                  <View style={{
                    backgroundColor: colors.surface,
                    borderRadius: 14,
                    padding: 16,
                    borderWidth: 1,
                    borderColor: bonusEligible ? colors.border : colors.error,
                    shadowColor: "#000",
                    shadowOpacity: 0.04,
                    shadowRadius: 4,
                    elevation: 2,
                  }}>
                    {/* Top row */}
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700" }}>{item.fullName}</Text>
                        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{item.city ?? "—"}</Text>
                      </View>
                      {/* Points circle */}
                      <View style={{
                        width: 56, height: 56, borderRadius: 28,
                        backgroundColor: ptsColor + "22",
                        borderWidth: 2.5, borderColor: ptsColor,
                        alignItems: "center", justifyContent: "center",
                      }}>
                        <Text style={{ color: ptsColor, fontSize: 20, fontWeight: "800" }}>{pts % 1 === 0 ? pts : pts.toFixed(1)}</Text>
                        <Text style={{ color: ptsColor, fontSize: 9, fontWeight: "600" }}>PTS</Text>
                      </View>
                    </View>

                    {/* Progress bar */}
                    <View style={{ height: 6, backgroundColor: colors.border, borderRadius: 3, marginBottom: 10 }}>
                      <View style={{
                        height: 6, borderRadius: 3,
                        backgroundColor: ptsColor,
                        width: `${Math.min(100, (pts / 10) * 100)}%`,
                      }} />
                    </View>

                    {/* Bonus eligibility badge */}
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                      <View style={{
                        flexDirection: "row", alignItems: "center", gap: 4,
                        backgroundColor: bonusEligible ? colors.success + "22" : colors.error + "22",
                        paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
                      }}>
                        <Text style={{ fontSize: 12 }}>{bonusEligible ? "✅" : "🚫"}</Text>
                        <Text style={{ color: bonusEligible ? colors.success : colors.error, fontSize: 12, fontWeight: "600" }}>
                          {bonusEligible ? "Bonus Eligible" : "Bonus Ineligible"}
                        </Text>
                      </View>

                      {/* Action buttons */}
                      <View style={{ flexDirection: "row", gap: 6 }}>
                        <TouchableOpacity
                          onPress={() => handleAddPoints(item)}
                          style={{ backgroundColor: colors.success + "22", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 }}
                        >
                          <Text style={{ color: colors.success, fontSize: 12, fontWeight: "700" }}>+ Add</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => { setSelectedDetailer(item); setWriteUpMode(false); setShowIssueModal(true); }}
                          style={{ backgroundColor: colors.warning + "22", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 }}
                        >
                          <Text style={{ color: colors.warning, fontSize: 12, fontWeight: "700" }}>− Deduct</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => { setSelectedDetailer(item); setWriteUpMode(true); setShowIssueModal(true); }}
                          style={{ backgroundColor: colors.error + "22", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 }}
                        >
                          <Text style={{ color: colors.error, fontSize: 12, fontWeight: "700" }}>✍️ Write-Up</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                );
              }}
              ListEmptyComponent={
                <View style={{ alignItems: "center", paddingTop: 60 }}>
                  <Text style={{ color: colors.muted, fontSize: 15 }}>No active detailers found.</Text>
                </View>
              }
            />
          )}
        </>
      )}

      {/* ── DAYS OFF TAB ── */}
      {activeTab === "daysoff" && (
        <>
          {/* Header row */}
          <View style={{ paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View>
              <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>Scheduled Days Off</Text>
              <Text style={{ color: colors.muted, fontSize: 12 }}>Team members marked off are skipped by the auto-deduction monitor</Text>
            </View>
            <TouchableOpacity
              onPress={() => setShowAssignModal(true)}
              style={{ backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 }}
            >
              <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>+ Assign</Text>
            </TouchableOpacity>
          </View>

          {daysOffLoading ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <ActivityIndicator color={colors.primary} size="large" />
            </View>
          ) : (
            <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
              data={upcomingDaysOff ?? []}
              keyExtractor={item => item.dayOffId}
              contentContainerStyle={{ padding: 16, gap: 10 }}
              renderItem={({ item }) => {
                const isToday = item.offDate === todayCSTString();
                return (
                  <View style={{
                    backgroundColor: colors.surface,
                    borderRadius: 12,
                    padding: 14,
                    borderWidth: 1,
                    borderColor: isToday ? colors.primary : colors.border,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                  }}>
                    {/* Avatar */}
                    <View style={{
                      width: 44, height: 44, borderRadius: 22,
                      backgroundColor: colors.primary + "22",
                      alignItems: "center", justifyContent: "center",
                    }}>
                      <Text style={{ color: colors.primary, fontSize: 18, fontWeight: "700" }}>
                        {item.fullName.charAt(0).toUpperCase()}
                      </Text>
                    </View>

                    {/* Info */}
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }}>{item.fullName}</Text>
                        {isToday && (
                          <View style={{ backgroundColor: colors.primary + "22", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 }}>
                            <Text style={{ color: colors.primary, fontSize: 10, fontWeight: "700" }}>TODAY</Text>
                          </View>
                        )}
                      </View>
                      <Text style={{ color: colors.muted, fontSize: 13 }}>{formatDateLabel(item.offDate)}</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
                        <View style={{ backgroundColor: colors.border, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Text style={{ color: colors.muted, fontSize: 11, fontWeight: "600" }}>{REASON_LABELS[item.reason] ?? item.reason}</Text>
                        </View>
                        {item.assignedBy && (
                          <Text style={{ color: colors.muted, fontSize: 11 }}>by {item.assignedBy}</Text>
                        )}
                      </View>
                      {item.notes ? (
                        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 3, fontStyle: "italic" }}>{item.notes}</Text>
                      ) : null}
                    </View>

                    {/* Remove button */}
                    <TouchableOpacity
                      onPress={() => handleRemoveDayOff(item)}
                      style={{ backgroundColor: colors.error + "22", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 }}
                    >
                      <Text style={{ color: colors.error, fontSize: 12, fontWeight: "700" }}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                );
              }}
              ListEmptyComponent={
                <View style={{ alignItems: "center", paddingTop: 60, gap: 8 }}>
                  <Text style={{ fontSize: 32 }}>🏖️</Text>
                  <Text style={{ color: colors.foreground, fontSize: 16, fontWeight: "700" }}>No days off scheduled</Text>
                  <Text style={{ color: colors.muted, fontSize: 14, textAlign: "center", paddingHorizontal: 32 }}>
                    Tap "+ Assign" to mark a team member as off for a specific day.
                  </Text>
                </View>
              }
            />
          )}
        </>
      )}

      {/* ── ASSIGN DAY OFF MODAL ── */}
      <Modal visible={showAssignModal} transparent animationType="slide" onRequestClose={() => setShowAssignModal(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "90%" }}>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "700", marginBottom: 4 }}>Assign Day Off</Text>
              <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 20 }}>
                The team member will be skipped by the auto-deduction monitor on this date.
              </Text>

              {/* Team member picker */}
              <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600", marginBottom: 8 }}>Team Member</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  {detailers.map((d: any) => (
                    <TouchableOpacity
                      key={d.employeeId}
                      onPress={() => setDayOffEmployee(d)}
                      style={{
                        paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
                        backgroundColor: dayOffEmployee?.employeeId === d.employeeId ? colors.primary : colors.surface,
                        borderWidth: 1.5,
                        borderColor: dayOffEmployee?.employeeId === d.employeeId ? colors.primary : colors.border,
                      }}
                    >
                      <Text style={{
                        color: dayOffEmployee?.employeeId === d.employeeId ? "#fff" : colors.foreground,
                        fontSize: 14, fontWeight: "600",
                      }}>{d.fullName}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              {/* Date input */}
              <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600", marginBottom: 6 }}>Date (YYYY-MM-DD)</Text>
              <TextInput
                value={dayOffDate}
                onChangeText={setDayOffDate}
                placeholder="e.g. 2026-05-20"
                placeholderTextColor={colors.muted}
                keyboardType="numbers-and-punctuation"
                style={{
                  backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
                  borderRadius: 8, padding: 10, color: colors.foreground, fontSize: 15, marginBottom: 16,
                }}
              />

              {/* Reason picker */}
              <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600", marginBottom: 8 }}>Reason</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {(["pto", "sick", "personal", "other"] as const).map(r => (
                  <TouchableOpacity
                    key={r}
                    onPress={() => setDayOffReason(r)}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8,
                      backgroundColor: dayOffReason === r ? colors.primary : colors.surface,
                      borderWidth: 1.5,
                      borderColor: dayOffReason === r ? colors.primary : colors.border,
                    }}
                  >
                    <Text style={{ color: dayOffReason === r ? "#fff" : colors.foreground, fontSize: 13, fontWeight: "600" }}>
                      {REASON_LABELS[r]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Notes */}
              <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600", marginBottom: 6 }}>Notes (optional)</Text>
              <TextInput
                value={dayOffNotes}
                onChangeText={setDayOffNotes}
                placeholder="e.g. Doctor's appointment"
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={2}
                style={{
                  backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
                  borderRadius: 8, padding: 10, color: colors.foreground, fontSize: 14,
                  minHeight: 56, textAlignVertical: "top", marginBottom: 20,
                }}
              />

              <TouchableOpacity
                onPress={handleAssignDayOff}
                disabled={!dayOffEmployee || !dayOffDate || assigningDayOff}
                style={{
                  backgroundColor: (!dayOffEmployee || !dayOffDate || assigningDayOff) ? colors.muted : colors.primary,
                  borderRadius: 12, padding: 14, alignItems: "center", marginBottom: 8,
                }}
              >
                {assigningDayOff ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>
                    {dayOffEmployee ? `Mark ${dayOffEmployee.fullName} Off` : "Select a Team Member"}
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setShowAssignModal(false); setDayOffEmployee(null); setDayOffDate(todayCSTString()); setDayOffReason("pto"); setDayOffNotes(""); }}
                style={{ alignItems: "center", padding: 12 }}
              >
                <Text style={{ color: colors.muted, fontSize: 14 }}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── ISSUE VIOLATION / WRITE-UP MODAL ── */}
      <Modal visible={showIssueModal} transparent animationType="slide" onRequestClose={() => setShowIssueModal(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "90%" }}>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "700", marginBottom: 4 }}>
                {writeUpMode ? "Issue Formal Write-Up" : "Deduct Points"}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 14, marginBottom: 12 }}>
                {selectedDetailer?.fullName} · Current: {selectedDetailer?.currentPoints ?? 10} pts
              </Text>

              {/* Mode toggle */}
              <View style={{ flexDirection: "row", backgroundColor: colors.surface, borderRadius: 10, padding: 3, marginBottom: 16, borderWidth: 1, borderColor: colors.border }}>
                <TouchableOpacity
                  onPress={() => setWriteUpMode(false)}
                  style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center",
                    backgroundColor: !writeUpMode ? colors.warning : "transparent" }}
                >
                  <Text style={{ color: !writeUpMode ? "#fff" : colors.muted, fontSize: 13, fontWeight: "700" }}>− Deduct Points</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setWriteUpMode(true)}
                  style={{ flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center",
                    backgroundColor: writeUpMode ? colors.error : "transparent" }}
                >
                  <Text style={{ color: writeUpMode ? "#fff" : colors.muted, fontSize: 13, fontWeight: "700" }}>✍️ Formal Write-Up</Text>
                </TouchableOpacity>
              </View>

              {writeUpMode && (
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600", marginBottom: 4 }}>Write-Up Title *</Text>
                  <TextInput
                    value={writeUpTitle}
                    onChangeText={setWriteUpTitle}
                    placeholder="e.g. Missed Morning Meeting on 4/30"
                    placeholderTextColor={colors.muted}
                    style={{
                      backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.error + "88",
                      borderRadius: 8, padding: 10, color: colors.foreground, fontSize: 14,
                    }}
                  />
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
                    This title will appear in the detailer's Alerts tab and requires their acknowledgment.
                  </Text>
                </View>
              )}

              <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600", marginBottom: 8 }}>Select Violation</Text>
              {VIOLATION_PRESETS.map(v => (
                <TouchableOpacity
                  key={v.type}
                  onPress={() => { setSelectedViolation(v); if (v.type !== "other") setCustomPoints(""); }}
                  style={{
                    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                    padding: 12, borderRadius: 10, marginBottom: 8,
                    backgroundColor: selectedViolation?.type === v.type ? colors.primary + "22" : colors.surface,
                    borderWidth: 1.5,
                    borderColor: selectedViolation?.type === v.type ? colors.primary : colors.border,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "600" }}>{v.label}</Text>
                    <Text style={{ color: colors.muted, fontSize: 12 }}>{v.description}</Text>
                  </View>
                  <View style={{ backgroundColor: colors.error + "22", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8 }}>
                    <Text style={{ color: colors.error, fontSize: 13, fontWeight: "700" }}>−{v.points}</Text>
                  </View>
                </TouchableOpacity>
              ))}

              {selectedViolation?.type === "other" && (
                <View style={{ marginBottom: 12 }}>
                  <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600", marginBottom: 4 }}>Points to Deduct</Text>
                  <TextInput
                    value={customPoints}
                    onChangeText={setCustomPoints}
                    keyboardType="decimal-pad"
                    placeholder="e.g. 1.5"
                    placeholderTextColor={colors.muted}
                    style={{
                      backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
                      borderRadius: 8, padding: 10, color: colors.foreground, fontSize: 15,
                    }}
                  />
                </View>
              )}

              <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600", marginBottom: 4 }}>Notes (optional)</Text>
              <TextInput
                value={notes}
                onChangeText={setNotes}
                placeholder="Add context or job reference..."
                placeholderTextColor={colors.muted}
                multiline
                numberOfLines={3}
                style={{
                  backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
                  borderRadius: 8, padding: 10, color: colors.foreground, fontSize: 14,
                  minHeight: 70, textAlignVertical: "top", marginBottom: 20,
                }}
              />

              <TouchableOpacity
                onPress={handleIssueViolation}
                disabled={!selectedViolation || submitting}
                style={{
                  backgroundColor: (!selectedViolation || submitting) ? colors.muted : (writeUpMode ? colors.error : colors.warning),
                  borderRadius: 12, padding: 14, alignItems: "center", marginBottom: 8,
                }}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>
                    {writeUpMode ? "Issue Write-Up" : "Deduct Points"}
                    {selectedViolation ? ` (−${selectedViolation.type === "other" ? (customPoints || "?") : selectedViolation.points} pts)` : ""}
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setShowIssueModal(false); setSelectedViolation(null); setNotes(""); setCustomPoints(""); setWriteUpTitle(""); setWriteUpMode(false); }}
                style={{ alignItems: "center", padding: 12 }}
              >
                <Text style={{ color: colors.muted, fontSize: 14 }}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── VIOLATION HISTORY MODAL ── */}
      <Modal visible={showHistoryModal} transparent animationType="slide" onRequestClose={() => setShowHistoryModal(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "85%" }}>
            <View style={{ padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "700" }}>This Week's Violations</Text>
              <Text style={{ color: colors.muted, fontSize: 13 }}>Week of {getCurrentWeekLabel()}</Text>
            </View>
            <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
              data={violations ?? []}
              keyExtractor={item => item.violationId}
              contentContainerStyle={{ padding: 16, gap: 10 }}
              renderItem={({ item }) => (
                <View style={{ backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                    <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "700" }}>{item.employeeName}</Text>
                    <View style={{ backgroundColor: colors.error + "22", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                      <Text style={{ color: colors.error, fontSize: 13, fontWeight: "700" }}>−{parseFloat(String(item.pointsDeducted))}</Text>
                    </View>
                  </View>
                  <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "600" }}>{formatViolationType(item.violationType)}</Text>
                  {item.notes ? <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{item.notes}</Text> : null}
                  <Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
                    Issued by {item.issuedBy} · {new Date(item.issuedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                  </Text>
                </View>
              )}
              ListEmptyComponent={
                <View style={{ alignItems: "center", paddingTop: 40 }}>
                  <Text style={{ color: colors.muted, fontSize: 15 }}>No violations this week. 🎉</Text>
                </View>
              }
            />
            <TouchableOpacity
              onPress={() => setShowHistoryModal(false)}
              style={{ margin: 16, backgroundColor: colors.surface, borderRadius: 12, padding: 14, alignItems: "center", borderWidth: 1, borderColor: colors.border }}
            >
              <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "600" }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}
