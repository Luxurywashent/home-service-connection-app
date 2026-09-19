import React, { useState, useMemo, useCallback } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator,
  TextInput, Modal, Alert, Platform, Linking,
} from "react-native";
import { CompanyAuthorityLoading } from "@/components/company-authority-state";
import { CompanyTimesheetPanel } from "@/components/company-timesheet-panel";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useJobSyncAuth } from "@/lib/jobsync-auth-context";
import {
  allowsLegacyTimekeepingAuthority,
  resolveCompanyTimekeepingAuthority,
  usesCompanyTimekeepingAuthority,
} from "@/lib/jobsync-company-authority";
import { trpc } from "@/lib/trpc";
import * as Haptics from "expo-haptics";
import { CalendarPicker } from "@/components/calendar-picker";

// Lazy-load react-native-maps to avoid web crashes
let MapView: any = null;
let Marker: any = null;
let PROVIDER_GOOGLE: any = null;
if (Platform.OS !== "web") {
  const maps = require("react-native-maps");
  MapView = maps.default;
  Marker = maps.Marker;
  PROVIDER_GOOGLE = maps.PROVIDER_GOOGLE;
}

/** Map showing pins for Clock In (green), Break Start (amber), Break End (orange), Clock Out (red) */
function ClockLocationMap({
  clockInLat, clockInLng,
  clockOutLat, clockOutLng,
  breakStartLat, breakStartLng,
  breakEndLat, breakEndLng,
}: {
  clockInLat?: string | null;
  clockInLng?: string | null;
  clockOutLat?: string | null;
  clockOutLng?: string | null;
  breakStartLat?: string | null;
  breakStartLng?: string | null;
  breakEndLat?: string | null;
  breakEndLng?: string | null;
}) {
  const hasIn = clockInLat != null && clockInLng != null;
  const hasOut = clockOutLat != null && clockOutLng != null;
  const hasBreakStart = breakStartLat != null && breakStartLng != null;
  const hasBreakEnd = breakEndLat != null && breakEndLng != null;

  if (!hasIn && !hasOut && !hasBreakStart && !hasBreakEnd) return null;
  if (Platform.OS === "web") return null;

  // Collect all valid coordinates to compute center
  const allLats: number[] = [];
  const allLngs: number[] = [];
  if (hasIn) { allLats.push(parseFloat(clockInLat!)); allLngs.push(parseFloat(clockInLng!)); }
  if (hasOut) { allLats.push(parseFloat(clockOutLat!)); allLngs.push(parseFloat(clockOutLng!)); }
  if (hasBreakStart) { allLats.push(parseFloat(breakStartLat!)); allLngs.push(parseFloat(breakStartLng!)); }
  if (hasBreakEnd) { allLats.push(parseFloat(breakEndLat!)); allLngs.push(parseFloat(breakEndLng!)); }

  const minLat = Math.min(...allLats);
  const maxLat = Math.max(...allLats);
  const minLng = Math.min(...allLngs);
  const maxLng = Math.max(...allLngs);
  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;
  const latDelta = Math.max(maxLat - minLat, 0.005) * 1.6;
  const lngDelta = Math.max(maxLng - minLng, 0.005) * 1.6;

  const LEGEND = [
    { key: "in", color: "#16A34A", label: "Clock In", show: hasIn },
    { key: "bs", color: "#D97706", label: "Break Start", show: hasBreakStart },
    { key: "be", color: "#EA580C", label: "Break End", show: hasBreakEnd },
    { key: "out", color: "#DC2626", label: "Clock Out", show: hasOut },
  ];

  return (
    <View style={{ marginBottom: 12 }}>
      <MapView
        provider={PROVIDER_GOOGLE}
        style={{ width: "100%", height: 180, borderRadius: 12, overflow: "hidden" }}
        initialRegion={{ latitude: centerLat, longitude: centerLng, latitudeDelta: latDelta, longitudeDelta: lngDelta }}
        scrollEnabled={false}
        zoomEnabled={false}
        pitchEnabled={false}
        rotateEnabled={false}
        pointerEvents="none"
      >
        {hasIn && (
          <Marker
            coordinate={{ latitude: parseFloat(clockInLat!), longitude: parseFloat(clockInLng!) }}
            title="Clock In"
            pinColor="#16A34A"
          />
        )}
        {hasBreakStart && (
          <Marker
            coordinate={{ latitude: parseFloat(breakStartLat!), longitude: parseFloat(breakStartLng!) }}
            title="Break Start"
            pinColor="#D97706"
          />
        )}
        {hasBreakEnd && (
          <Marker
            coordinate={{ latitude: parseFloat(breakEndLat!), longitude: parseFloat(breakEndLng!) }}
            title="Break End"
            pinColor="#EA580C"
          />
        )}
        {hasOut && (
          <Marker
            coordinate={{ latitude: parseFloat(clockOutLat!), longitude: parseFloat(clockOutLng!) }}
            title="Clock Out"
            pinColor="#DC2626"
          />
        )}
      </MapView>
      {/* Legend */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 6 }}>
        {LEGEND.filter(l => l.show).map(l => (
          <View key={l.key} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: l.color }} />
            <Text style={{ fontSize: 10, color: "#6B7280" }}>{l.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function getWeekDates(weekOffset: number = 0) {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + weekOffset * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    start: monday.toISOString().split("T")[0],
    end: sunday.toISOString().split("T")[0],
    monday,
    sunday,
  };
}

const TIME_OPTIONS: string[] = (() => {
  const opts: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      const period = h < 12 ? "AM" : "PM";
      const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
      opts.push(`${String(hour).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`);
    }
  }
  return opts;
})();

function parseTimeStr(timeStr: string, dateStr: string): Date | null {
  const parts = timeStr.trim().split(" ");
  if (parts.length !== 2) return null;
  const [hm, period] = parts;
  const [hStr, mStr] = hm.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (isNaN(h) || isNaN(m)) return null;
  if (period?.toUpperCase() === "PM" && h !== 12) h += 12;
  if (period?.toUpperCase() === "AM" && h === 12) h = 0;
  return new Date(`${dateStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
}

function formatTime(date: Date | string | null | undefined): string {
  if (!date) return "--:--";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
}

function toTimeStr(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const h = d.getHours();
  const m = d.getMinutes();
  const period = h < 12 ? "AM" : "PM";
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${String(hour).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function isAutoClockOut(clockOutTime: Date | string | null): boolean {
  if (!clockOutTime) return false;
  const d = typeof clockOutTime === "string" ? new Date(clockOutTime) : clockOutTime;
  const h = d.getHours(); const m = d.getMinutes();
  return (h === 0 && m === 0) || (h === 23 && m === 59);
}

const BREAK_LABELS: Record<string, string> = {
  morning_15min: "Morning Break (15m)",
  afternoon_15min: "Afternoon Break (15m)",
  lunch_30min: "Lunch Break (30m)",
};

// ─── Inline Time Picker ───────────────────────────────────────────────────────
function InlineTimePicker({
  value, onChange, onSave, onCancel, colors,
}: { value: string; onChange: (v: string) => void; onSave: () => void; onCancel: () => void; colors: any }) {
  const selectedIdx = TIME_OPTIONS.indexOf(value);
  const listRef = React.useRef<ScrollView>(null);
  React.useEffect(() => {
    if (selectedIdx >= 0) {
      setTimeout(() => { listRef.current?.scrollTo({ y: selectedIdx * 44, animated: false }); }, 50);
    }
  }, []);
  return (
    <View style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 10, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: colors.border }}>
        <TextInput
          style={{ flex: 1, fontSize: 15, fontWeight: "700", color: colors.primary, paddingHorizontal: 10, paddingVertical: 8 }}
          value={value} onChangeText={onChange} placeholder="e.g. 08:30 AM"
          placeholderTextColor={colors.muted} returnKeyType="done" onSubmitEditing={onSave} autoFocus
        />
        <TouchableOpacity onPress={onSave} style={{ paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.success }}>
          <Text style={{ color: "#FFF", fontWeight: "700", fontSize: 13 }}>✓</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onCancel} style={{ paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.error + "20" }}>
          <Text style={{ color: colors.error, fontWeight: "700", fontSize: 13 }}>✕</Text>
        </TouchableOpacity>
      </View>
      <ScrollView ref={listRef} style={{ maxHeight: 176 }} showsVerticalScrollIndicator={false} nestedScrollEnabled>
        {TIME_OPTIONS.map((t) => {
          const isSelected = t === value;
          return (
            <TouchableOpacity key={t} onPress={() => onChange(t)}
              style={{ height: 44, justifyContent: "center", paddingHorizontal: 12,
                backgroundColor: isSelected ? colors.primary + "20" : "transparent",
                borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
              <Text style={{ fontSize: 14, fontWeight: isSelected ? "700" : "400", color: isSelected ? colors.primary : colors.foreground }}>{t}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ─── Add Time Slot Modal ──────────────────────────────────────────────────────
function AddTimeSlotModal({
  visible, date, onClose, onSave, colors,
}: { visible: boolean; date: string; onClose: () => void; onSave: (clockIn: Date, clockOut?: Date) => void; colors: any }) {
  const [clockIn, setClockIn] = useState("07:30 AM");
  const [clockOut, setClockOut] = useState("12:00 PM");
  const [hasClockOut, setHasClockOut] = useState(true);

  const handleSave = () => {
    const inDate = parseTimeStr(clockIn, date);
    if (!inDate) { Alert.alert("Invalid Time", "Please enter a valid clock-in time (e.g. 07:30 AM)"); return; }
    const outDate = hasClockOut ? parseTimeStr(clockOut, date) : undefined;
    if (hasClockOut && !outDate) { Alert.alert("Invalid Time", "Please enter a valid clock-out time"); return; }
    onSave(inDate, outDate ?? undefined);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 }}>
            <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground, marginBottom: 4 }}>Add Time Slot</Text>
            <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 20 }}>{formatDate(date)}</Text>

            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase" }}>Clock In</Text>
            <InlineTimePicker value={clockIn} onChange={setClockIn} onSave={() => {}} onCancel={() => {}} colors={colors} />

            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 16, marginBottom: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, textTransform: "uppercase", flex: 1 }}>Clock Out</Text>
              <TouchableOpacity onPress={() => setHasClockOut(!hasClockOut)}
                style={{ backgroundColor: hasClockOut ? colors.primary + "20" : colors.surface, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: hasClockOut ? colors.primary : colors.border }}>
                <Text style={{ fontSize: 12, color: hasClockOut ? colors.primary : colors.muted }}>{hasClockOut ? "Included" : "Not yet"}</Text>
              </TouchableOpacity>
            </View>
            {hasClockOut && (
              <InlineTimePicker value={clockOut} onChange={setClockOut} onSave={() => {}} onCancel={() => {}} colors={colors} />
            )}

            <View style={{ flexDirection: "row", gap: 12, marginTop: 20 }}>
              <TouchableOpacity onPress={onClose}
                style={{ flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.border, alignItems: "center" }}>
                <Text style={{ fontSize: 15, fontWeight: "600", color: colors.muted }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSave}
                style={{ flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center" }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#FFF" }}>Add Time Slot</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Add/Edit Break Modal ─────────────────────────────────────────────────────
function BreakModal({
  visible, date, existingBreak, onClose, onSave, colors,
}: {
  visible: boolean; date: string;
  existingBreak?: { breakId: string; breakType: string; breakStartTime?: any; breakEndTime?: any; status: string } | null;
  onClose: () => void;
  onSave: (data: { breakType: string; startTime?: Date; endTime?: Date; status: string }) => void;
  colors: any;
}) {
  const [breakType, setBreakType] = useState<string>(existingBreak?.breakType ?? "morning_15min");
  const [startTime, setStartTime] = useState(existingBreak?.breakStartTime ? toTimeStr(existingBreak.breakStartTime) : "10:00 AM");
  const [endTime, setEndTime] = useState(existingBreak?.breakEndTime ? toTimeStr(existingBreak.breakEndTime) : "10:15 AM");
  const [status, setStatus] = useState(existingBreak?.status ?? "taken");
  const [hasStart, setHasStart] = useState<boolean>(!!existingBreak?.breakStartTime || true);
  const [hasEnd, setHasEnd] = useState<boolean>(!!existingBreak?.breakEndTime || true);

  React.useEffect(() => {
    if (visible) {
      setBreakType(existingBreak?.breakType ?? "morning_15min");
      setStartTime(existingBreak?.breakStartTime ? toTimeStr(existingBreak.breakStartTime) : "10:00 AM");
      setEndTime(existingBreak?.breakEndTime ? toTimeStr(existingBreak.breakEndTime) : "10:15 AM");
      setStatus(existingBreak?.status ?? "taken");
      setHasStart(true);
      setHasEnd(!!existingBreak?.breakEndTime);
    }
  }, [visible, existingBreak]);

  const handleSave = () => {
    const startDate = hasStart ? parseTimeStr(startTime, date) : undefined;
    const endDate = hasEnd ? parseTimeStr(endTime, date) : undefined;
    onSave({ breakType, startTime: startDate ?? undefined, endTime: endDate ?? undefined, status });
    onClose();
  };

  const BREAK_TYPES = ["morning_15min", "afternoon_15min", "lunch_30min"] as const;
  const STATUS_OPTS = ["taken", "skipped", "pending"] as const;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <ScrollView style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}
            contentContainerStyle={{ padding: 24, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground, marginBottom: 4 }}>
              {existingBreak ? "Edit Break" : "Add Break"}
            </Text>
            <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 20 }}>{formatDate(date)}</Text>

            {/* Break Type */}
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase" }}>Break Type</Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
              {BREAK_TYPES.map((bt) => (
                <TouchableOpacity key={bt} onPress={() => setBreakType(bt)}
                  style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1,
                    backgroundColor: breakType === bt ? colors.primary + "20" : "transparent",
                    borderColor: breakType === bt ? colors.primary : colors.border }}>
                  <Text style={{ fontSize: 12, fontWeight: "600", color: breakType === bt ? colors.primary : colors.muted }}>
                    {BREAK_LABELS[bt]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Status */}
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase" }}>Status</Text>
            <View style={{ flexDirection: "row", gap: 8, marginBottom: 16 }}>
              {STATUS_OPTS.map((s) => (
                <TouchableOpacity key={s} onPress={() => setStatus(s)}
                  style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1,
                    backgroundColor: status === s ? (s === "taken" ? colors.success : s === "skipped" ? colors.error : colors.warning) + "20" : "transparent",
                    borderColor: status === s ? (s === "taken" ? colors.success : s === "skipped" ? colors.error : colors.warning) : colors.border }}>
                  <Text style={{ fontSize: 12, fontWeight: "600", textTransform: "capitalize",
                    color: status === s ? (s === "taken" ? colors.success : s === "skipped" ? colors.error : colors.warning) : colors.muted }}>
                    {s}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Start Time */}
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, textTransform: "uppercase", flex: 1 }}>Start Time</Text>
              <TouchableOpacity onPress={() => setHasStart(!hasStart)}
                style={{ backgroundColor: hasStart ? colors.primary + "20" : "transparent", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: hasStart ? colors.primary : colors.border }}>
                <Text style={{ fontSize: 12, color: hasStart ? colors.primary : colors.muted }}>{hasStart ? "Set" : "Not set"}</Text>
              </TouchableOpacity>
            </View>
            {hasStart && (
              <View style={{ marginBottom: 16 }}>
                <InlineTimePicker value={startTime} onChange={setStartTime} onSave={() => {}} onCancel={() => {}} colors={colors} />
              </View>
            )}

            {/* End Time */}
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 8 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, textTransform: "uppercase", flex: 1 }}>End Time</Text>
              <TouchableOpacity onPress={() => setHasEnd(!hasEnd)}
                style={{ backgroundColor: hasEnd ? colors.primary + "20" : "transparent", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: hasEnd ? colors.primary : colors.border }}>
                <Text style={{ fontSize: 12, color: hasEnd ? colors.primary : colors.muted }}>{hasEnd ? "Set" : "Not set"}</Text>
              </TouchableOpacity>
            </View>
            {hasEnd && (
              <View style={{ marginBottom: 16 }}>
                <InlineTimePicker value={endTime} onChange={setEndTime} onSave={() => {}} onCancel={() => {}} colors={colors} />
              </View>
            )}

            <View style={{ flexDirection: "row", gap: 12, marginTop: 4 }}>
              <TouchableOpacity onPress={onClose}
                style={{ flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.border, alignItems: "center" }}>
                <Text style={{ fontSize: 15, fontWeight: "600", color: colors.muted }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleSave}
                style={{ flex: 2, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.primary, alignItems: "center" }}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#FFF" }}>{existingBreak ? "Save Changes" : "Add Break"}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
// ─── Team Dashboard Component ─────────────────────────────────────────────────
type DashPeriod = "day" | "week" | "month" | "custom";

function getDashDateRange(period: DashPeriod, customStart?: string, customEnd?: string) {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  if (period === "day") {
    const today = fmt(now);
    return { start: today, end: today, label: now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) };
  }
  if (period === "week") {
    const day = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return { start: fmt(mon), end: fmt(sun), label: `${mon.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${sun.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` };
  }
  if (period === "month") {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: fmt(first), end: fmt(last), label: now.toLocaleDateString("en-US", { month: "long", year: "numeric" }) };
  }
  return { start: customStart ?? fmt(now), end: customEnd ?? fmt(now), label: `${customStart ?? ""} → ${customEnd ?? ""}` };
}

function TeamDashboard({ colors, onSelectMember }: { colors: any; onSelectMember: (id: string) => void }) {
  const [period, setPeriod] = useState<DashPeriod>("week");
  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [pickingStart, setPickingStart] = useState(false);
  const [pickingEnd, setPickingEnd] = useState(false);

  const range = useMemo(() => getDashDateRange(period, customStart, customEnd), [period, customStart, customEnd]);

  const dashQuery = trpc.timesheet.getTeamDashboard.useQuery(
    { startDate: range.start, endDate: range.end },
    { enabled: !!(range.start && range.end) }
  );
  const members = dashQuery.data?.members ?? [];

  const totalHours = members.reduce((s, m) => s + m.totalHours, 0);
  const totalBreakHrs = members.reduce((s, m) => s + m.breakMinutes / 60, 0);
  const activeHrs = Math.max(totalHours - totalBreakHrs, 0);

  const breakPct = totalHours > 0 ? (totalBreakHrs / totalHours) * 100 : 0;
  const activePct = totalHours > 0 ? (activeHrs / totalHours) * 100 : 0;

  const haptic = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
      {/* Header */}
      <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 }}>
        <Text style={{ fontSize: 28, fontWeight: "800", color: colors.foreground }}>Team Dashboard</Text>
        <Text style={{ fontSize: 13, color: colors.muted, marginTop: 4 }}>{range.label}</Text>
      </View>

      {/* Period Filter */}
      <View style={{ flexDirection: "row", paddingHorizontal: 20, marginBottom: 16, gap: 8 }}>
        {(["day", "week", "month", "custom"] as DashPeriod[]).map((p) => (
          <TouchableOpacity
            key={p}
            onPress={() => { setPeriod(p); haptic(); if (p === "custom" && !customStart) { setPickingStart(true); } }}
            style={{
              flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center",
              backgroundColor: period === p ? colors.primary : colors.surface,
              borderWidth: 1, borderColor: period === p ? colors.primary : colors.border,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: "600", color: period === p ? "#fff" : colors.foreground, textTransform: "capitalize" }}>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Custom Date Picker */}
      {period === "custom" && (
        <View style={{ paddingHorizontal: 20, marginBottom: 16 }}>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <TouchableOpacity onPress={() => setPickingStart(true)} style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>From</Text>
              <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{customStart || "Select"}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setPickingEnd(true)} style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: 11, color: colors.muted }}>To</Text>
              <Text style={{ fontSize: 14, fontWeight: "600", color: colors.foreground }}>{customEnd || "Select"}</Text>
            </TouchableOpacity>
          </View>
          {pickingStart && (
            <View style={{ marginTop: 12 }}>
              <CalendarPicker selectedDate={customStart} onSelectDate={(d: string) => { setCustomStart(d); setPickingStart(false); if (!customEnd) setPickingEnd(true); }} />
            </View>
          )}
          {pickingEnd && !pickingStart && (
            <View style={{ marginTop: 12 }}>
              <CalendarPicker selectedDate={customEnd} onSelectDate={(d: string) => { setCustomEnd(d); setPickingEnd(false); }} />
            </View>
          )}
        </View>
      )}

      {/* Percentage Breakdown */}
      <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 20, borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>Time Breakdown</Text>
          {/* Bar */}
          <View style={{ height: 24, borderRadius: 12, overflow: "hidden", flexDirection: "row", backgroundColor: colors.border, marginBottom: 16 }}>
            {activePct > 0 && <View style={{ width: `${activePct}%` as any, backgroundColor: "#16A34A", height: 24 }} />}
            {breakPct > 0 && <View style={{ width: `${breakPct}%` as any, backgroundColor: "#F59E0B", height: 24 }} />}
          </View>
          {/* Legend */}
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#16A34A" }} />
              <Text style={{ fontSize: 12, color: colors.foreground }}>Active ({activePct.toFixed(0)}%)</Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: "#F59E0B" }} />
              <Text style={{ fontSize: 12, color: colors.foreground }}>Breaks ({breakPct.toFixed(0)}%)</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Team Totals */}
      <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1, backgroundColor: colors.primary + "10", borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.primary + "30" }}>
            <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, textTransform: "uppercase" }}>Total Hours</Text>
            <Text style={{ fontSize: 28, fontWeight: "800", color: colors.primary, marginTop: 4 }}>{totalHours.toFixed(1)}</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: "#F59E0B10", borderRadius: 14, padding: 16, borderWidth: 1, borderColor: "#F59E0B30" }}>
            <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, textTransform: "uppercase" }}>Total Breaks</Text>
            <Text style={{ fontSize: 28, fontWeight: "800", color: "#F59E0B", marginTop: 4 }}>{totalBreakHrs.toFixed(1)}h</Text>
          </View>
        </View>
      </View>

      {/* Team Member List */}
      <View style={{ paddingHorizontal: 20 }}>
        <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>Team Members ({members.length})</Text>
        {dashQuery.isLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : members.length === 0 ? (
          <Text style={{ fontSize: 13, color: colors.muted }}>No time records for this period.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {members.map((m) => (
              <TouchableOpacity
                key={m.employeeId}
                onPress={() => { onSelectMember(m.employeeId); haptic(); }}
                activeOpacity={0.7}
                style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                  backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
                  borderWidth: 1, borderColor: colors.border }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "600", color: colors.foreground }}>{m.fullName}</Text>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>
                    {m.breakMinutes > 0 ? `${(m.breakMinutes / 60).toFixed(1)}h breaks` : "No breaks logged"}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ fontSize: 18, fontWeight: "700", color: colors.primary }}>{m.totalHours.toFixed(1)}h</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>total</Text>
                </View>
                <Text style={{ fontSize: 16, color: colors.muted, marginLeft: 8 }}>›</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

export default function AdminTimesheetScreen() {
  const { session, isLoading: jobSyncLoading } = useJobSyncAuth();
  const authority = resolveCompanyTimekeepingAuthority({ session, sessionLoading: jobSyncLoading });
  if (authority === "unknown") {
    return <CompanyAuthorityLoading message="Confirming Company identity before Timesheets…" />;
  }
  if (usesCompanyTimekeepingAuthority(authority) && session?.token) {
    return <CompanyTimesheetPanel token={session.token} role={session.user.role} showTeam showTimeOffLink={false} />;
  }
  if (!allowsLegacyTimekeepingAuthority(authority)) {
    return <CompanyAuthorityLoading message="Confirming Company identity before Timesheets…" />;
  }
  return <LegacyAdminTimesheetScreen />;
}

function LegacyAdminTimesheetScreen() {
  const colors = useColors();
  const [viewMode, setViewMode] = useState<"dashboard" | "individual">("dashboard");
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Add time slot modal state
  const [addSlotDate, setAddSlotDate] = useState<string | null>(null);
  // Add/Edit break modal state
  const [breakModalDate, setBreakModalDate] = useState<string | null>(null);
  const [editingBreak, setEditingBreak] = useState<any | null>(null);

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);

  const detailersQuery = trpc.employee.listAll.useQuery();
  const employees = detailersQuery.data ?? [];
  const defaultEmployeeId = employees.length > 0 ? (employees[0] as any).employeeId : "";
  const activeEmployeeId = selectedEmployeeId || defaultEmployeeId;
  const activeEmployee = employees.find((e: any) => e.employeeId === activeEmployeeId);

  const weeklyLogsQuery = trpc.timesheet.getWeeklyLogs.useQuery(
    { employeeId: activeEmployeeId, startDate: weekDates.start, endDate: weekDates.end },
    { enabled: !!activeEmployeeId }
  );
  const weeklyHoursQuery = trpc.timesheet.getWeeklyHours.useQuery(
    { employeeId: activeEmployeeId, startDate: weekDates.start, endDate: weekDates.end },
    { enabled: !!activeEmployeeId }
  );

  const updateClockInMutation = trpc.timesheet.updateClockInTime.useMutation();
  const updateClockOutMutation = trpc.timesheet.updateClockOutTime.useMutation();
  const addClockRecordMutation = trpc.timesheet.addClockRecord.useMutation();
  const deleteClockRecordMutation = trpc.timesheet.deleteClockRecord.useMutation();
  const recalculateHoursMutation = trpc.timesheet.recalculateHours.useMutation();
  const addBreakMutation = trpc.timesheet.addBreak.useMutation();
  const updateBreakMutation = trpc.timesheet.updateBreak.useMutation();
  const deleteBreakMutation = trpc.timesheet.deleteBreak.useMutation();

  const logs = (weeklyLogsQuery.data as any)?.logs ?? [];
  const breaks = (weeklyLogsQuery.data as any)?.breaks ?? [];
  const totalHours = (weeklyHoursQuery.data as any)?.totalHours ?? 0;

  const refetchAll = useCallback(async () => {
    await weeklyLogsQuery.refetch();
    await weeklyHoursQuery.refetch();
  }, [weeklyLogsQuery, weeklyHoursQuery]);

  const haptic = () => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); };
  const hapticSuccess = () => { if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); };

  // ── Edit clock in/out time ──
  const handleEditTime = (id: string, current: string) => { setEditingId(id); setEditingValue(current); };

  const handleSaveTime = async (recordId: string, isClockIn: boolean) => {
    if (!editingValue) return;
    try {
      const record = logs.find((l: any) => l.recordId === recordId);
      if (!record) return;
      const newDateTime = parseTimeStr(editingValue, record.date);
      if (!newDateTime) { Alert.alert("Invalid Time", "Please enter a valid time (e.g. 08:30 AM)"); return; }
      if (isClockIn) {
        await updateClockInMutation.mutateAsync({ recordId, clockInTime: newDateTime });
      } else {
        await updateClockOutMutation.mutateAsync({ recordId, clockOutTime: newDateTime });
      }
      await refetchAll();
      setEditingId(null); setEditingValue("");
      hapticSuccess();
    } catch (e) { console.error(e); }
  };

  // ── Add time slot ──
  const handleAddTimeSlot = async (clockIn: Date, clockOut?: Date) => {
    if (!activeEmployee || !addSlotDate) return;
    try {
      await addClockRecordMutation.mutateAsync({
        employeeId: activeEmployeeId,
        fullName: (activeEmployee as any).fullName,
        date: addSlotDate,
        clockInTime: clockIn,
        clockOutTime: clockOut,
      });
      await refetchAll();
      hapticSuccess();
    } catch (e) { console.error(e); }
  };

  // ── Delete time slot ──
  const handleDeleteSlot = (recordId: string) => {
    Alert.alert("Delete Time Slot", "Remove this clock record? This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          try {
            await deleteClockRecordMutation.mutateAsync({ recordId });
            await refetchAll();
            haptic();
          } catch (e) { console.error(e); }
        }
      },
    ]);
  };

  // ── Add/edit break ──
  const handleSaveBreak = async (data: { breakType: string; startTime?: Date; endTime?: Date; status: string }) => {
    if (!activeEmployee) return;
    try {
      if (editingBreak) {
        await updateBreakMutation.mutateAsync({
          breakId: editingBreak.breakId,
          breakStartTime: data.startTime,
          breakEndTime: data.endTime,
          status: data.status as any,
        });
      } else if (breakModalDate) {
        await addBreakMutation.mutateAsync({
          employeeId: activeEmployeeId,
          fullName: (activeEmployee as any).fullName,
          date: breakModalDate,
          breakType: data.breakType as any,
          breakStartTime: data.startTime,
          breakEndTime: data.endTime,
          status: data.status as any,
        });
      }
      await refetchAll();
      hapticSuccess();
    } catch (e) { console.error(e); }
    setEditingBreak(null);
  };

  // ── Delete break ──
  const handleDeleteBreak = (breakId: string) => {
    Alert.alert("Delete Break", "Remove this break record?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive", onPress: async () => {
          try {
            await deleteBreakMutation.mutateAsync({ breakId });
            await refetchAll();
            haptic();
          } catch (e) { console.error(e); }
        }
      },
    ]);
  };

  const groupedByDate = useMemo(() => {
    const grouped: Record<string, any[]> = {};
    logs.forEach((log: any) => {
      if (!grouped[log.date]) grouped[log.date] = [];
      grouped[log.date].push(log);
    });
    return grouped;
  }, [logs]);

  const isLoading = weeklyLogsQuery.isLoading || weeklyHoursQuery.isLoading;

  const handleSelectFromDashboard = (empId: string) => {
    setSelectedEmployeeId(empId);
    setViewMode("individual");
  };

  return (
    <ScreenContainer className="px-0" edges={["left", "right"]}>
      {/* View Mode Toggle */}
      <View style={{ flexDirection: "row", paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, gap: 0 }}>
        <TouchableOpacity
          onPress={() => { setViewMode("dashboard"); haptic(); }}
          style={{ flex: 1, paddingVertical: 10, alignItems: "center",
            backgroundColor: viewMode === "dashboard" ? colors.primary : "transparent",
            borderTopLeftRadius: 10, borderBottomLeftRadius: 10,
            borderWidth: 1, borderColor: colors.primary }}
        >
          <Text style={{ fontSize: 13, fontWeight: "600", color: viewMode === "dashboard" ? "#fff" : colors.primary }}>Dashboard</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => { setViewMode("individual"); haptic(); }}
          style={{ flex: 1, paddingVertical: 10, alignItems: "center",
            backgroundColor: viewMode === "individual" ? colors.primary : "transparent",
            borderTopRightRadius: 10, borderBottomRightRadius: 10,
            borderWidth: 1, borderColor: colors.primary }}
        >
          <Text style={{ fontSize: 13, fontWeight: "600", color: viewMode === "individual" ? "#fff" : colors.primary }}>Individual</Text>
        </TouchableOpacity>
      </View>

      {viewMode === "dashboard" ? (
        <TeamDashboard colors={colors} onSelectMember={handleSelectFromDashboard} />
      ) : (
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 60 }}>
        {/* Header */}
        <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 }}>
          <Text style={{ fontSize: 28, fontWeight: "800", color: colors.foreground }}>Team Timesheet</Text>
        </View>

        {/* Team Member Selector */}
        <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase" }}>Select Team Member</Text>
          <TouchableOpacity onPress={() => { setDropdownOpen(true); haptic(); }}
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between",
              backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
              borderWidth: 1, borderColor: colors.border }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: "600", color: activeEmployee ? colors.foreground : colors.muted }}>
                {(activeEmployee as any)?.fullName ?? "Select a team member..."}
              </Text>
              {(activeEmployee as any)?.role ? (
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2, textTransform: "capitalize" }}>
                  {(activeEmployee as any).role.replace(/_/g, " ")}
                </Text>
              ) : null}
            </View>
            <Text style={{ fontSize: 16, color: colors.muted }}>▾</Text>
          </TouchableOpacity>
          <Modal visible={dropdownOpen} transparent animationType="fade" onRequestClose={() => setDropdownOpen(false)}>
            <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", paddingHorizontal: 24 }}
              activeOpacity={1} onPress={() => setDropdownOpen(false)}>
              <View style={{ backgroundColor: colors.surface, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
                <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>Select Team Member</Text>
                </View>
                {employees.map((emp: any, idx: number) => (
                  <TouchableOpacity key={emp.employeeId} onPress={() => { setSelectedEmployeeId(emp.employeeId); setDropdownOpen(false); haptic(); }}
                    style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                      paddingHorizontal: 16, paddingVertical: 14,
                      backgroundColor: activeEmployeeId === emp.employeeId ? colors.primary + "20" : "transparent",
                      borderTopWidth: idx > 0 ? 1 : 0, borderTopColor: colors.border }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 15, fontWeight: "500", color: activeEmployeeId === emp.employeeId ? colors.primary : colors.foreground }}>{emp.fullName}</Text>
                      {emp.role ? <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2, textTransform: "capitalize" }}>{emp.role.replace(/_/g, " ")}</Text> : null}
                    </View>
                    {activeEmployeeId === emp.employeeId && <Text style={{ fontSize: 16, color: colors.primary }}>✓</Text>}
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableOpacity>
          </Modal>
        </View>

        {/* Week Navigation */}
        <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <TouchableOpacity onPress={() => { setWeekOffset(weekOffset - 1); haptic(); }} style={{ padding: 8 }}>
              <Text style={{ fontSize: 18, color: colors.primary }}>← Previous</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.muted }}>
              {weekDates.monday.toLocaleDateString()} - {weekDates.sunday.toLocaleDateString()}
            </Text>
            <TouchableOpacity onPress={() => { setWeekOffset(weekOffset + 1); haptic(); }} style={{ padding: 8 }}>
              <Text style={{ fontSize: 18, color: colors.primary }}>Next →</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Weekly Hours */}
        <View style={{ paddingHorizontal: 20, marginBottom: 24 }}>
          <View style={{ backgroundColor: colors.primary + "10", borderRadius: 16, padding: 20, borderWidth: 1, borderColor: colors.primary + "30" }}>
            <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Weekly Hours</Text>
            <Text style={{ fontSize: 40, fontWeight: "800", color: colors.primary }}>{totalHours.toFixed(2)}</Text>
            <Text style={{ fontSize: 13, color: colors.muted, marginTop: 8 }}>hours worked this week</Text>
          </View>
        </View>

        {/* Daily Logs */}
        {isLoading ? (
          <View style={{ alignItems: "center", justifyContent: "center", paddingVertical: 40 }}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <View style={{ paddingHorizontal: 20, gap: 16 }}>
            {/* Show days that have logs */}
            {Object.entries(groupedByDate)
              .sort(([a], [b]) => b.localeCompare(a))
              .map(([date, dayLogs]) => {
                const dayBreaks = breaks.filter((b: any) => b.date === date);
                return (
                  <View key={date}>
                    <Text style={{ fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 8, textTransform: "uppercase" }}>
                      {formatDate(date)}
                    </Text>

                    {/* Time Slots */}
                    {(dayLogs as any[]).map((log: any) => {
                      // Aggregate break GPS from all breaks for this day
                      const firstBreak = dayBreaks[0] as any;
                      return (
                      <View key={log.recordId} style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 16,
                        borderWidth: 1, borderColor: colors.border, marginBottom: 8 }}>
                        {/* GPS Location Map */}
                        <ClockLocationMap
                          clockInLat={(log as any).clockInLat}
                          clockInLng={(log as any).clockInLng}
                          clockOutLat={(log as any).clockOutLat}
                          clockOutLng={(log as any).clockOutLng}
                          breakStartLat={firstBreak?.breakStartLat}
                          breakStartLng={firstBreak?.breakStartLng}
                          breakEndLat={firstBreak?.breakEndLat}
                          breakEndLng={firstBreak?.breakEndLng}
                        />
                        {/* Clock In / Out */}
                        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 12 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>Clock In</Text>
                            {editingId === `${log.recordId}-in` ? (
                              <InlineTimePicker value={editingValue} onChange={setEditingValue}
                                onSave={() => handleSaveTime(log.recordId, true)}
                                onCancel={() => { setEditingId(null); setEditingValue(""); }} colors={colors} />
                            ) : (
                              <TouchableOpacity onPress={() => handleEditTime(`${log.recordId}-in`, formatTime(log.clockInTime))}
                                style={{ backgroundColor: colors.primary + "15", borderRadius: 8, padding: 8 }}>
                                <Text style={{ color: colors.primary, fontWeight: "600", fontSize: 13 }}>{formatTime(log.clockInTime)}</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                          <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 4 }}>Clock Out</Text>
                            {editingId === `${log.recordId}-out` ? (
                              <InlineTimePicker value={editingValue} onChange={setEditingValue}
                                onSave={() => handleSaveTime(log.recordId, false)}
                                onCancel={() => { setEditingId(null); setEditingValue(""); }} colors={colors} />
                            ) : (
                              <TouchableOpacity onPress={() => handleEditTime(`${log.recordId}-out`, formatTime(log.clockOutTime))}
                                style={{ backgroundColor: log.clockOutTime ? colors.success + "15" : colors.warning + "15", borderRadius: 8, padding: 8 }}>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                  <Text style={{ color: log.clockOutTime ? colors.success : colors.warning, fontWeight: "600", fontSize: 13 }}>
                                    {formatTime(log.clockOutTime)}
                                  </Text>
                                  {log.clockOutTime && isAutoClockOut(log.clockOutTime) && (
                                    <View style={{ backgroundColor: "#F59E0B20", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                                      <Text style={{ fontSize: 9, fontWeight: "700", color: "#F59E0B" }}>AUTO</Text>
                                    </View>
                                  )}
                                </View>
                              </TouchableOpacity>
                            )}
                          </View>
                        </View>

                        {/* Hours + Delete */}
                        <View style={{ flexDirection: "row", alignItems: "center", paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 2 }}>Hours</Text>
                            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground }}>{Number(log.totalHours || 0).toFixed(2)} hrs</Text>
                          </View>
                          <View style={{ flexDirection: "row", gap: 6 }}>
                            {log.clockOutTime && (
                              <TouchableOpacity
                                onPress={async () => {
                                  try {
                                    await recalculateHoursMutation.mutateAsync({ recordId: log.recordId });
                                    weeklyLogsQuery.refetch();
                                    weeklyHoursQuery.refetch();
                                    haptic();
                                  } catch (e: any) {
                                    Alert.alert("Error", e.message);
                                  }
                                }}
                                style={{ backgroundColor: colors.primary + "15", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 }}>
                                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.primary }}>↻ Recalc</Text>
                              </TouchableOpacity>
                            )}
                            <TouchableOpacity onPress={() => handleDeleteSlot(log.recordId)}
                              style={{ backgroundColor: colors.error + "15", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
                              <Text style={{ fontSize: 12, fontWeight: "600", color: colors.error }}>🗑 Delete</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    );
                    })}

                    {/* Add Time Slot Button */}
                    <TouchableOpacity onPress={() => { setAddSlotDate(date); haptic(); }}
                      style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
                        backgroundColor: colors.primary + "10", borderRadius: 10, paddingVertical: 10,
                        borderWidth: 1, borderColor: colors.primary + "30", borderStyle: "dashed", marginBottom: 8 }}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.primary }}>+ Add Time Slot</Text>
                    </TouchableOpacity>

                    {/* Breaks */}
                    {dayBreaks.length > 0 && (
                      <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 16,
                        borderWidth: 1, borderColor: colors.border, marginBottom: 8 }}>
                        <Text style={{ fontSize: 11, fontWeight: "600", color: colors.muted, marginBottom: 10, textTransform: "uppercase" }}>Breaks</Text>
                        {dayBreaks.map((br: any) => (
                          <View key={br.breakId} style={{ flexDirection: "row", alignItems: "center",
                            paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.foreground }}>{BREAK_LABELS[br.breakType] ?? br.breakType}</Text>
                              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                                {br.breakStartTime ? formatTime(br.breakStartTime) : "--"} – {br.breakEndTime ? formatTime(br.breakEndTime) : "--"}
                              </Text>
                            </View>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                              <View style={{ backgroundColor: br.status === "taken" ? colors.success + "20" : br.status === "skipped" ? colors.error + "20" : colors.warning + "20",
                                paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}>
                                <Text style={{ fontSize: 10, fontWeight: "600", textTransform: "capitalize",
                                  color: br.status === "taken" ? colors.success : br.status === "skipped" ? colors.error : colors.warning }}>
                                  {br.status}
                                </Text>
                              </View>
                              <TouchableOpacity onPress={() => { setBreakModalDate(date); setEditingBreak(br); haptic(); }}
                                style={{ backgroundColor: colors.primary + "15", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                                <Text style={{ fontSize: 11, fontWeight: "600", color: colors.primary }}>Edit</Text>
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => handleDeleteBreak(br.breakId)}
                                style={{ backgroundColor: colors.error + "15", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                                <Text style={{ fontSize: 11, fontWeight: "600", color: colors.error }}>🗑</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        ))}
                      </View>
                    )}

                    {/* Add Break Button */}
                    <TouchableOpacity onPress={() => { setBreakModalDate(date); setEditingBreak(null); haptic(); }}
                      style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
                        backgroundColor: colors.warning + "10", borderRadius: 10, paddingVertical: 10,
                        borderWidth: 1, borderColor: colors.warning + "30", borderStyle: "dashed", marginBottom: 16 }}>
                      <Text style={{ fontSize: 13, fontWeight: "600", color: colors.warning }}>+ Add Break</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}

            {Object.keys(groupedByDate).length === 0 && (
              <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 20, alignItems: "center" }}>
                <Text style={{ fontSize: 14, color: colors.muted }}>No clock records for this week</Text>
              </View>
            )}

            {/* Missing Days — show all 7 days of the week, highlight ones with no records */}
            {(() => {
              const allWeekDays: string[] = [];
              for (let i = 0; i < 7; i++) {
                const d = new Date(weekDates.monday);
                d.setDate(weekDates.monday.getDate() + i);
                allWeekDays.push(d.toISOString().split("T")[0]);
              }
              const missingDays = allWeekDays.filter(day => !groupedByDate[day]);
              if (missingDays.length === 0) return null;
              return (
                <View style={{ marginTop: 8 }}>
                  <Text style={{ fontSize: 12, fontWeight: "700", color: colors.muted, marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Days Without Records
                  </Text>
                  {missingDays.map(day => (
                    <TouchableOpacity
                      key={day}
                      onPress={() => { setAddSlotDate(day); haptic(); }}
                      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                        backgroundColor: colors.surface, borderRadius: 12, padding: 14,
                        borderWidth: 1, borderColor: colors.border, borderStyle: "dashed", marginBottom: 8 }}
                    >
                      <Text style={{ fontSize: 14, fontWeight: "600", color: colors.muted }}>
                        {new Date(day + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                      </Text>
                      <Text style={{ fontSize: 13, fontWeight: "700", color: colors.primary }}>+ Add Hours</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              );
            })()}
          </View>
        )}
      </ScrollView>
      )}

      {/* Add Time Slot Modal */}
      <AddTimeSlotModal
        visible={!!addSlotDate}
        date={addSlotDate ?? ""}
        onClose={() => setAddSlotDate(null)}
        onSave={handleAddTimeSlot}
        colors={colors}
      />

      {/* Add/Edit Break Modal */}
      <BreakModal
        visible={!!breakModalDate}
        date={breakModalDate ?? ""}
        existingBreak={editingBreak}
        onClose={() => { setBreakModalDate(null); setEditingBreak(null); }}
        onSave={handleSaveBreak}
        colors={colors}
      />
    </ScreenContainer>
  );
}
