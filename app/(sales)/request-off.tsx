import { useState, useMemo } from "react";
import { Text, View, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Platform } from "react-native";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useEmployeeAuth } from "@/lib/auth-context";
import { trpc } from "@/lib/trpc";
import { CalendarPicker } from "@/components/calendar-picker";

function calculateDays(start: string, end: string): number {
  const s = new Date(start + "T12:00:00");
  const e = new Date(end + "T12:00:00");
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1);
}

function calculateNotice(startDate: string): number {
  const start = new Date(startDate + "T12:00:00");
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  return Math.max(0, Math.round((start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}

function validatePolicy(days: number, notice: number): { valid: boolean; message: string } {
  if (days === 1 && notice < 5) return { valid: false, message: `1 day off requires at least 5 days notice. You have ${notice} days.` };
  if (days >= 2 && days <= 4 && notice < 14) return { valid: false, message: `${days} days off requires at least 14 days notice. You have ${notice} days.` };
  if (days >= 5 && notice < 30) return { valid: false, message: `${days} days off requires at least 30 days notice. You have ${notice} days.` };
  return { valid: true, message: "Meets policy requirements" };
}

function formatDateDisplay(dateStr: string) {
  if (!dateStr) return "Not selected";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getTomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STATUS_COLORS: Record<string, string> = { pending: "#F59E0B", approved: "#22C55E", denied: "#EF4444" };

export default function RequestOffScreen() {
  const colors = useColors();
  const { employee } = useEmployeeAuth();
  const utils = trpc.useUtils();

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [showPolicy, setShowPolicy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [activeCalendar, setActiveCalendar] = useState<"start" | "end" | null>(null);

  const { data: requests, isLoading } = trpc.timeOff.getForEmployee.useQuery(
    { employeeId: employee?.employeeId ?? "" },
    { enabled: !!employee }
  );

  const createMutation = trpc.timeOff.create.useMutation({
    onSuccess: () => {
      utils.timeOff.getForEmployee.invalidate();
      setStartDate("");
      setEndDate("");
      setReason("");
      setActiveCalendar(null);
      setSubmitSuccess(true);
      setTimeout(() => setSubmitSuccess(false), 3000);
    },
  });

  const validation = useMemo(() => {
    if (!startDate || !endDate) return null;
    const days = calculateDays(startDate, endDate);
    const notice = calculateNotice(startDate);
    const policy = validatePolicy(days, notice);
    return { days, notice, ...policy };
  }, [startDate, endDate]);

  const handleSubmit = async () => {
    if (!validation || !startDate || !endDate || !employee) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const requestId = `TOR-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      await createMutation.mutateAsync({
        requestId,
        employeeId: employee.employeeId,
        fullName: employee.fullName,
        startDate,
        endDate,
        totalDaysRequested: validation.days,
        daysNoticeGiven: validation.notice,
        reason: reason.trim() || undefined,
        policyValid: validation.valid ? "yes" : "no",
        policyMessage: validation.message,
      });
    } catch (e: any) {
      setSubmitError("Failed to submit request. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSelectStartDate = (dateStr: string) => {
    setStartDate(dateStr);
    // If end date is before start date, reset it
    if (endDate && endDate < dateStr) {
      setEndDate("");
    }
    // Auto-advance to end date picker
    setActiveCalendar("end");
  };

  const handleSelectEndDate = (dateStr: string) => {
    setEndDate(dateStr);
    setActiveCalendar(null);
  };

  const tomorrowStr = getTomorrowStr();

  return (
    <ScreenContainer edges={["left", "right"]} className="px-5">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={{ marginTop: 8, marginBottom: 16 }}>
          <Text style={{ fontSize: 24, fontWeight: "800", color: colors.foreground }}>Request Time Off</Text>
        </View>

        {/* Policy Info */}
        <TouchableOpacity
          onPress={() => setShowPolicy(!showPolicy)}
          activeOpacity={0.7}
          style={{
            backgroundColor: colors.primary + "10",
            borderRadius: 12,
            padding: 14,
            marginBottom: 16,
            borderWidth: 1,
            borderColor: colors.primary + "30",
          }}
        >
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>
            {showPolicy ? "Hide" : "View"} Time-Off Policy
          </Text>
          {showPolicy && (
            <View style={{ marginTop: 10, gap: 6 }}>
              <Text style={{ fontSize: 13, color: colors.foreground }}>1 day off = minimum 5 days notice</Text>
              <Text style={{ fontSize: 13, color: colors.foreground }}>2-4 days off = minimum 14 days notice</Text>
              <Text style={{ fontSize: 13, color: colors.foreground }}>5+ days off = minimum 30 days notice</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* Date Selection */}
        <View style={{ gap: 12, marginBottom: 16 }}>
          {/* Start Date Button */}
          <View>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
              Start Date
            </Text>
            <TouchableOpacity
              onPress={() => setActiveCalendar(activeCalendar === "start" ? null : "start")}
              activeOpacity={0.7}
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: activeCalendar === "start" ? colors.primary : colors.border,
                borderRadius: 12,
                paddingHorizontal: 16,
                paddingVertical: 14,
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text style={{
                fontSize: 16,
                color: startDate ? colors.foreground : colors.muted,
                fontWeight: startDate ? "600" : "400",
              }}>
                {startDate ? formatDateDisplay(startDate) : "Tap to select date"}
              </Text>
              <Text style={{ fontSize: 18, color: colors.primary }}>📅</Text>
            </TouchableOpacity>
          </View>

          {/* Start Date Calendar */}
          {activeCalendar === "start" && (
            <CalendarPicker
              selectedDate={startDate}
              onSelectDate={handleSelectStartDate}
              minDate={tomorrowStr}
            />
          )}

          {/* End Date Button */}
          <View>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
              End Date
            </Text>
            <TouchableOpacity
              onPress={() => setActiveCalendar(activeCalendar === "end" ? null : "end")}
              activeOpacity={0.7}
              style={{
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: activeCalendar === "end" ? colors.primary : colors.border,
                borderRadius: 12,
                paddingHorizontal: 16,
                paddingVertical: 14,
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <Text style={{
                fontSize: 16,
                color: endDate ? colors.foreground : colors.muted,
                fontWeight: endDate ? "600" : "400",
              }}>
                {endDate ? formatDateDisplay(endDate) : "Tap to select date"}
              </Text>
              <Text style={{ fontSize: 18, color: colors.primary }}>📅</Text>
            </TouchableOpacity>
          </View>

          {/* End Date Calendar */}
          {activeCalendar === "end" && (
            <CalendarPicker
              selectedDate={endDate}
              onSelectDate={handleSelectEndDate}
              minDate={startDate || tomorrowStr}
              rangeStart={startDate}
              rangeEnd={endDate}
            />
          )}
        </View>

        {/* Validation Display */}
        {validation && (
          <View style={{
            backgroundColor: validation.valid ? colors.success + "10" : colors.error + "10",
            borderRadius: 12, padding: 14, borderWidth: 1,
            borderColor: validation.valid ? colors.success + "30" : colors.error + "30",
            marginBottom: 14,
          }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
              <Text style={{ fontSize: 13, color: colors.foreground }}>Days requested: <Text style={{ fontWeight: "700" }}>{validation.days}</Text></Text>
              <Text style={{ fontSize: 13, color: colors.foreground }}>Notice: <Text style={{ fontWeight: "700" }}>{validation.notice} days</Text></Text>
            </View>
            <Text style={{ fontSize: 13, fontWeight: "600", color: validation.valid ? colors.success : colors.error }}>
              {validation.valid ? "\u2713 " : "\u26a0\ufe0f "}{validation.message}
            </Text>
            {!validation.valid && (
              <Text style={{ fontSize: 12, color: colors.warning, marginTop: 6, fontStyle: "italic" }}>
                You may still submit, but requests outside policy have a high chance of denial.
              </Text>
            )}
          </View>
        )}

        {/* Reason */}
        <View style={{ marginBottom: 14 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Reason (optional)</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Enter reason for time off"
            placeholderTextColor={colors.muted}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            style={{
              backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
              borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16,
              color: colors.foreground, minHeight: 80,
            }}
          />
        </View>

        {submitError ? (
          <View style={{ backgroundColor: "#FEF2F2", borderRadius: 8, padding: 12, marginBottom: 14 }}>
            <Text style={{ color: colors.error, fontSize: 14, textAlign: "center" }}>{submitError}</Text>
          </View>
        ) : null}

        {submitSuccess && (
          <View style={{ backgroundColor: colors.success + "15", borderRadius: 8, padding: 12, marginBottom: 14 }}>
            <Text style={{ color: colors.success, fontSize: 14, textAlign: "center", fontWeight: "600" }}>Request submitted successfully!</Text>
          </View>
        )}

        <TouchableOpacity
          onPress={handleSubmit}
          disabled={!validation || !startDate || !endDate || submitting}
          activeOpacity={0.8}
          style={{
            backgroundColor: (validation && startDate && endDate) ? (validation.valid ? colors.primary : colors.warning) : colors.border,
            borderRadius: 12, paddingVertical: 16, alignItems: "center",
            opacity: submitting ? 0.7 : 1,
            marginBottom: 24,
          }}
        >
          {submitting ? (
            <ActivityIndicator color="#FFF" />
          ) : (
            <Text style={{ color: "#FFF", fontSize: 16, fontWeight: "700" }}>
              {validation && !validation.valid ? "Submit Anyway" : "Submit Request"}
            </Text>
          )}
        </TouchableOpacity>

        {/* Request History */}
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>Request History</Text>
        {isLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (requests ?? []).length === 0 ? (
          <Text style={{ color: colors.muted, fontSize: 14 }}>No previous requests</Text>
        ) : (
          (requests ?? []).map((req) => (
            <View key={req.requestId} style={{
              backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 10,
              borderWidth: 1, borderColor: colors.border,
              borderLeftWidth: 4, borderLeftColor: STATUS_COLORS[req.status] ?? colors.muted,
            }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>
                  {formatDateDisplay(req.startDate)} - {formatDateDisplay(req.endDate)}
                </Text>
                <View style={{ backgroundColor: (STATUS_COLORS[req.status] ?? colors.muted) + "20", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 }}>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: STATUS_COLORS[req.status] ?? colors.muted, textTransform: "capitalize" }}>{req.status}</Text>
                </View>
              </View>
              <Text style={{ fontSize: 12, color: colors.muted }}>{req.totalDaysRequested} day(s) | {req.daysNoticeGiven} days notice</Text>
              {req.reason && <Text style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>{req.reason}</Text>}
              {req.managerNote && (
                <View style={{ backgroundColor: colors.primary + "10", borderRadius: 8, padding: 8, marginTop: 8 }}>
                  <Text style={{ fontSize: 12, color: colors.primary, fontWeight: "600" }}>Manager: {req.managerNote}</Text>
                </View>
              )}
            </View>
          ))
        )}
      </ScrollView>
    </ScreenContainer>
  );
}
