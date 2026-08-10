import { LinearGradient } from 'expo-linear-gradient';
import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useVideoPlayer, VideoView } from "expo-video";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
  Linking,
  Alert,
  Modal,
  Pressable,
  FlatList,
  Dimensions,
  Platform,
  Image,
  TextInput,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { ScreenContainer } from "@/components/screen-container";
import { useColors } from "@/hooks/use-colors";
import { useCustomerAuth } from "@/lib/customer-context";
import { trpc } from "@/lib/trpc";
import { MaterialIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CustomerMessageBanner } from "@/components/customer-message-banner";
import { VipSignupModal } from "@/components/vip-signup-modal";

// ─── Date helpers ─────────────────────────────────────────────────────────────
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_LABELS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_SHORT = ["S","M","T","W","T","F","S"];

function fmtDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function buildUpcomingDates(days = 90): Date[] {
  const today = new Date(); today.setHours(0,0,0,0);
  return Array.from({ length: days }, (_, i) => { const d = new Date(today); d.setDate(today.getDate()+i); return d; });
}

function buildMonthGrid(year: number, month: number): (Date|null)[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const cells: (Date|null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  return cells;
}

function buildMonthWeeks(year: number, month: number): (Date|null)[][] {
  const cells = buildMonthGrid(year, month);
  // pad to multiple of 7
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (Date|null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function hoursUntil(dateStr: string, timeStr: string): number {
  const m = timeStr.trim().match(/(\d+)(?::\d+)?\s*(AM|PM)/i);
  let h = m ? parseInt(m[1],10) : 8;
  if (m && m[2].toUpperCase()==="PM" && h!==12) h+=12;
  if (m && m[2].toUpperCase()==="AM" && h===12) h=0;
  const appt = new Date(`${dateStr}T${String(h).padStart(2,"00")}:00:00`);
  return (appt.getTime() - Date.now()) / 3600000;
}

// ─── My Schedule Section ──────────────────────────────────────────────────────
function MyScheduleSection({ token: customerToken, city }: { token: string; city: string }) {
  const colors = useColors();
  const utils = trpc.useUtils();

  const [rescheduleJob, setRescheduleJob] = useState<{ bookingRef?: string; scheduleJobId?: string; packageId: string; city: string; date: string; time: string } | null>(null);
  const [cancelLoading, setCancelLoading] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ label: string; available: boolean } | null>(null);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calMonth, setCalMonth] = useState(() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }; });

  const jobsQuery = trpc.customer.allJobs.useQuery(
    { token: customerToken },
    { enabled: !!customerToken, staleTime: 0 }
  );

  const rescheduleMutation = trpc.customer.rescheduleBooking.useMutation({
    onSuccess: () => {
      utils.customer.allJobs.invalidate();
      setRescheduleJob(null); setSelectedDate(null); setSelectedSlot(null);
      Alert.alert("Rescheduled ✓", "Your appointment has been moved successfully.");
    },
    onError: (err) => Alert.alert("Error", err.message),
  });
  const rescheduleScheduleJobMutation = trpc.customer.rescheduleScheduleJob.useMutation({
    onSuccess: () => {
      utils.customer.allJobs.invalidate();
      setRescheduleJob(null); setSelectedDate(null); setSelectedSlot(null);
      Alert.alert("Rescheduled ✓", "Your appointment has been moved successfully.");
    },
    onError: (err) => Alert.alert("Error", err.message),
  });
  const cancelMutation = trpc.customer.cancelBooking.useMutation({
    onSuccess: () => { utils.customer.allJobs.invalidate(); },
  });
  const cancelScheduleJobMutation = trpc.customer.cancelScheduleJob.useMutation({
    onSuccess: () => { utils.customer.allJobs.invalidate(); },
  });
  const isReschedulePending = rescheduleMutation.isPending || rescheduleScheduleJobMutation.isPending;

  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const upcomingDates = useMemo(() => buildUpcomingDates(90), []);
  const monthGrid = useMemo(() => buildMonthGrid(calMonth.year, calMonth.month), [calMonth]);

  const rescheduleCity = rescheduleJob?.city || city || "";
  const dateKey = selectedDate ? fmtDateKey(selectedDate) : "";

  const { data: availableDatesData, isLoading: datesLoading } = trpc.employee.getAvailableDates.useQuery(
    { city: rescheduleCity, daysAhead: 90 },
    { enabled: !!rescheduleJob && !!rescheduleCity, staleTime: 5 * 60 * 1000 }
  );
  const availableDateSet = useMemo(() => new Set(availableDatesData ?? []), [availableDatesData]);
  const isDateAvailable = (d: Date) => {
    if (datesLoading || !availableDatesData) return true;
    return availableDateSet.has(fmtDateKey(d));
  };
  // Only show confirmed-available dates in the carousel (filter once loaded)
  const carouselDates = useMemo(() => {
    if (datesLoading || !availableDatesData) return upcomingDates;
    return upcomingDates.filter(d => availableDateSet.has(fmtDateKey(d)));
  }, [upcomingDates, availableDateSet, datesLoading, availableDatesData]);

  const { data: slots, isLoading: slotsLoading } = trpc.employee.getAvailableSlots.useQuery(
    { date: dateKey, city: rescheduleCity, packageName: rescheduleJob?.packageId ?? "Basic Detail" },
    { enabled: !!rescheduleJob && !!dateKey && !!rescheduleCity }
  );

  const nowStr = new Date().toISOString().split("T")[0];
  const upcomingJobs = (jobsQuery.data ?? [])
    .filter(j => j.date >= nowStr && j.status !== "completed" && j.status !== "cancelled")
    .sort((a, b) => a.date.localeCompare(b.date));

  const handleReschedule = (job: any) => {
    const hours = hoursUntil(job.date, job.time ?? "");
    if (hours < 24) {
      Alert.alert("Cannot Reschedule", "Reschedules must be made at least 24 hours before your appointment. Please contact us directly for assistance.");
      return;
    }
    setRescheduleJob({
      bookingRef: (job as any).bookingRef ?? undefined,
      scheduleJobId: !(job as any).bookingRef ? job.id : undefined,
      packageId: (job as any).packageId ?? "basic_detail",
      city: job.city ?? city,
      date: job.date,
      time: job.time ?? "",
    });
    setSelectedDate(null); setSelectedSlot(null);
  };

  const handleCancel = (job: any) => {
    const hours = hoursUntil(job.date, job.time ?? "");
    if (hours < 24) {
      Alert.alert("Cannot Cancel", "Cancellations must be made at least 24 hours before your appointment. Please contact us directly for assistance.");
      return;
    }
    const loadingKey = (job as any).bookingRef ?? job.id;
    Alert.alert(
      "Cancel Appointment",
      "Are you sure you want to cancel this appointment? This cannot be undone.",
      [
        { text: "Keep Appointment", style: "cancel" },
        {
          text: "Cancel Booking",
          style: "destructive",
          onPress: async () => {
            setCancelLoading(loadingKey);
            try {
              if ((job as any).bookingRef) {
                await cancelMutation.mutateAsync({ token: customerToken, bookingRef: (job as any).bookingRef });
              } else {
                await cancelScheduleJobMutation.mutateAsync({ token: customerToken, jobId: job.id });
              }
              Alert.alert("Cancelled", "Your appointment has been cancelled.");
            } catch (e: any) {
              Alert.alert("Error", e.message ?? "Failed to cancel appointment.");
            } finally {
              setCancelLoading(null);
            }
          },
        },
      ]
    );
  };

  const confirmReschedule = async () => {
    if (!rescheduleJob || !selectedDate || !selectedSlot) {
      Alert.alert("Select Date & Time", "Please select a new date and time slot.");
      return;
    }
    if (rescheduleJob.bookingRef) {
      await rescheduleMutation.mutateAsync({
        token: customerToken,
        bookingRef: rescheduleJob.bookingRef,
        newDate: fmtDateKey(selectedDate),
        newTime: selectedSlot.label,
      });
    } else if (rescheduleJob.scheduleJobId) {
      await rescheduleScheduleJobMutation.mutateAsync({
        token: customerToken,
        jobId: rescheduleJob.scheduleJobId,
        newDate: fmtDateKey(selectedDate),
        newTime: selectedSlot.label,
      });
    }
  };

  function selectDate(d: Date) { setSelectedDate(d); setSelectedSlot(null); setCalendarVisible(false); }

  const renderDateCard = ({ item: d }: { item: Date }) => {
    const isSel = selectedDate?.toDateString() === d.toDateString();
    const available = isDateAvailable(d);
    return (
      <TouchableOpacity
        style={[sched.dateCard, isSel && sched.dateCardSel, !available && sched.dateCardDis]}
        onPress={() => available && selectDate(d)}
        disabled={!available}
        activeOpacity={0.8}
      >
        <Text style={[sched.dateDayLabel, isSel && sched.dateTextSel, !available && sched.dateTextDis]}>
          {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()]}
        </Text>
        <Text style={[sched.dateNum, isSel && sched.dateTextSel, !available && sched.dateTextDis]}>
          {d.getDate()}
        </Text>
        <Text style={[sched.dateMon, isSel && sched.dateTextSel, !available && sched.dateTextDis]}>
          {MONTH_SHORT[d.getMonth()]}
        </Text>
        {!available && <View style={sched.unavailDot} />}
      </TouchableOpacity>
    );
  };

  if (jobsQuery.isLoading) {
    return (
      <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
        <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground, marginBottom: 12 }}>My Upcoming Appointments</Text>
        <ActivityIndicator color="#0057FF" />
      </View>
    );
  }

  return (
    <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
      <Text style={{ fontSize: 17, fontWeight: "700", color: colors.foreground, marginBottom: 4 }}>My Upcoming Appointments</Text>
      <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 12 }}>All your scheduled services. Tap Reschedule to pick a new date based on availability.</Text>

      {upcomingJobs.length === 0 ? (
        <View style={[sched.emptyBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <MaterialIcons name="event-available" size={32} color={colors.muted} />
          <Text style={{ color: colors.muted, fontSize: 14, marginTop: 8, textAlign: "center" }}>No upcoming appointments{"\n"}Book a service to get started.</Text>
        </View>
      ) : (
        upcomingJobs.map((job) => {
          const d = new Date(job.date + "T12:00:00");
          // canModify: available for ALL upcoming jobs regardless of source
          const canModify = hoursUntil(job.date, job.time ?? "") >= 24;
          const isCancelLoading = cancelLoading === ((job as any).bookingRef ?? job.id);
          return (
            <View key={job.id} style={[sched.jobCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                {/* Date badge */}
                <View style={sched.dateBadge}>
                  <Text style={sched.dateBadgeMon}>{MONTH_SHORT[d.getMonth()]}</Text>
                  <Text style={sched.dateBadgeDay}>{d.getDate()}</Text>
                  <Text style={sched.dateBadgeYear}>{d.getFullYear()}</Text>
                </View>
                {/* Details */}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: "700", color: colors.foreground, lineHeight: 20 }}>{job.packageName || "Detail Service"}</Text>
                  {job.time ? <Text style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>🕐 {job.time}</Text> : null}
                  {job.city ? <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>📍 {job.city}</Text> : null}
                  {job.vehicleLabel ? <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>🚗 {job.vehicleLabel}</Text> : null}
                  {/* Status pill */}
                  <View style={{ flexDirection: "row", marginTop: 8, gap: 6 }}>
                    <View style={[sched.statusPill, { backgroundColor: job.status === "confirmed" ? "#D1FAE5" : "#FEF3C7" }]}>
                      <Text style={{ fontSize: 11, fontWeight: "700", color: job.status === "confirmed" ? "#059669" : "#D97706" }}>
                        {job.status === "confirmed" ? "Confirmed" : job.status === "pending" ? "Pending" : job.status}
                      </Text>
                    </View>
                    {job.source === "portal" && (
                      <View style={[sched.statusPill, { backgroundColor: "#DBEAFE" }]}>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: "#1D4ED8" }}>Portal</Text>
                      </View>
                    )}
                  </View>
                  {/* Reschedule + Cancel buttons — available for ALL upcoming jobs >24h away */}
                  {isCancelLoading ? (
                    <ActivityIndicator size="small" color="#9CA3AF" style={{ marginTop: 10 }} />
                  ) : canModify ? (
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                      <TouchableOpacity
                        style={sched.rescheduleBtn}
                        onPress={() => handleReschedule(job)}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="schedule" size={14} color="#0057FF" />
                        <Text style={{ fontSize: 13, fontWeight: "600", color: "#0057FF" }}>Reschedule</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[sched.rescheduleBtn, { backgroundColor: "#FEF2F2" }]}
                        onPress={() => handleCancel(job)}
                        activeOpacity={0.8}
                      >
                        <MaterialIcons name="cancel" size={14} color="#EF4444" />
                        <Text style={{ fontSize: 13, fontWeight: "600", color: "#EF4444" }}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <Text style={{ fontSize: 11, color: colors.muted, marginTop: 6 }}>Changes locked within 24 hrs of appointment</Text>
                  )}
                </View>
              </View>
            </View>
          );
        })
      )}

      {/* ── Reschedule Modal ──────────────────────────────────────────────── */}
      <Modal visible={!!rescheduleJob} animationType="slide" transparent onRequestClose={() => setRescheduleJob(null)}>
        <Pressable style={sched.overlay} onPress={() => setRescheduleJob(null)}>
          <Pressable style={[sched.sheet, { backgroundColor: colors.background }]} onPress={e => e.stopPropagation()}>
            {/* Header */}
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <Text style={{ fontSize: 18, fontWeight: "800", color: colors.foreground }}>Reschedule Appointment</Text>
              <TouchableOpacity onPress={() => setRescheduleJob(null)} hitSlop={{ top:10,bottom:10,left:10,right:10 }}>
                <MaterialIcons name="close" size={22} color={colors.muted} />
              </TouchableOpacity>
            </View>

            {/* City availability note */}
            {rescheduleCity ? (
              <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 12 }}>Showing availability for <Text style={{ fontWeight: "700", color: colors.foreground }}>{rescheduleCity}</Text></Text>
            ) : null}

            {/* Date carousel */}
            <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, marginBottom: 8 }}>Select a new date</Text>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>Swipe to browse available dates</Text>
              <TouchableOpacity
                style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.surface, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}
                onPress={() => setCalendarVisible(true)}
                activeOpacity={0.8}
              >
                <MaterialIcons name="calendar-month" size={16} color={colors.foreground} />
                <Text style={{ fontSize: 12, fontWeight: "600", color: colors.foreground }}>Month</Text>
              </TouchableOpacity>
            </View>
            {datesLoading ? (
              <View style={{ height: 80, alignItems: "center", justifyContent: "center" }}>
                <ActivityIndicator color="#0057FF" size="small" />
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 6 }}>Loading availability…</Text>
              </View>
            ) : (
              <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
                data={carouselDates}
                keyExtractor={d => fmtDateKey(d)}
                renderItem={renderDateCard}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingHorizontal: 2, paddingBottom: 8 }}
                getItemLayout={(_, i) => ({ length: 70, offset: 70 * i, index: i })}
                style={{ marginBottom: 16 }}
              />
            )}

            {/* Time slots */}
            {selectedDate && (
              <>
                <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, marginBottom: 8 }}>Available times</Text>
                {slotsLoading ? (
                  <View style={{ height: 60, alignItems: "center", justifyContent: "center" }}>
                    <ActivityIndicator color="#0057FF" size="small" />
                  </View>
                ) : slots && slots.length > 0 ? (
                  <View style={{ gap: 8, marginBottom: 16 }}>
                    {slots.map((slot: any) => {
                      const isSel = selectedSlot?.label === slot.label;
                      const isUnavail = !slot.available;
                      return (
                        <TouchableOpacity
                          key={slot.label}
                          style={[sched.slotBtn, { backgroundColor: isSel ? "#0057FF" : colors.surface, borderColor: isSel ? "#0057FF" : colors.border, opacity: isUnavail ? 0.4 : 1 }]}
                          onPress={() => !isUnavail && setSelectedSlot(slot)}
                          disabled={isUnavail}
                          activeOpacity={0.8}
                        >
                          <MaterialIcons name="access-time" size={16} color={isSel ? "#fff" : colors.foreground} />
                          <Text style={{ fontSize: 14, fontWeight: "600", color: isSel ? "#fff" : colors.foreground }}>{slot.label}</Text>
                          {isUnavail && <Text style={{ fontSize: 11, color: colors.muted, marginLeft: "auto" }}>Booked</Text>}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : (
                  <View style={{ alignItems: "center", paddingVertical: 20, marginBottom: 16 }}>
                    <MaterialIcons name="event-busy" size={28} color={colors.muted} />
                    <Text style={{ color: colors.muted, fontSize: 13, marginTop: 8 }}>No availability on this date.</Text>
                    <Text style={{ color: colors.muted, fontSize: 12, marginTop: 4 }}>Please select a different day.</Text>
                  </View>
                )}
              </>
            )}

            {/* Confirm button */}
            <TouchableOpacity
              style={[sched.confirmBtn, { opacity: (!selectedDate || !selectedSlot || isReschedulePending) ? 0.4 : 1 }]}
              onPress={confirmReschedule}
              disabled={!selectedDate || !selectedSlot || isReschedulePending}
              activeOpacity={0.85}
            >
              {isReschedulePending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>Confirm Reschedule</Text>
              )}
            </TouchableOpacity>
          </Pressable>
        </Pressable>

        {/* Month calendar modal (nested inside reschedule modal) */}
        <Modal visible={calendarVisible} animationType="slide" transparent onRequestClose={() => setCalendarVisible(false)}>
          <Pressable style={sched.overlay} onPress={() => setCalendarVisible(false)}>
            <Pressable style={[sched.calSheet, { backgroundColor: colors.background }]} onPress={e => e.stopPropagation()}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <TouchableOpacity onPress={() => setCalMonth(({ year, month }) => month===0 ? {year:year-1,month:11} : {year,month:month-1})} style={{ padding: 8 }}>
                  <MaterialIcons name="chevron-left" size={24} color={colors.foreground} />
                </TouchableOpacity>
                <Text style={{ fontSize: 16, fontWeight: "700", color: colors.foreground }}>{MONTH_LABELS[calMonth.month]} {calMonth.year}</Text>
                <TouchableOpacity onPress={() => setCalMonth(({ year, month }) => month===11 ? {year:year+1,month:0} : {year,month:month+1})} style={{ padding: 8 }}>
                  <MaterialIcons name="chevron-right" size={24} color={colors.foreground} />
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: "row", marginBottom: 8 }}>
                {DAY_SHORT.map((d, i) => <Text key={i} style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: "700", color: colors.muted }}>{d}</Text>)}
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                {monthGrid.map((d, i) => {
                  if (!d) return <View key={`e${i}`} style={{ width: "14.28%", aspectRatio: 1 }} />;
                  const isPast = d < today;
                  const isSel = selectedDate?.toDateString() === d.toDateString();
                  const isToday = d.toDateString() === today.toDateString();
                  const available = !isPast && isDateAvailable(d);
                  return (
                    <TouchableOpacity
                      key={i}
                      style={{ width: "14.28%", aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: 100, backgroundColor: isSel ? "#0057FF" : "transparent" }}
                      onPress={() => available && selectDate(d)}
                      disabled={!available}
                      activeOpacity={0.75}
                    >
                      <Text style={{ fontSize: 14, fontWeight: isSel || isToday ? "700" : "400", color: isSel ? "#fff" : (isPast || !available) ? colors.muted : isToday ? "#0057FF" : colors.foreground }}>{d.getDate()}</Text>
                      {available && !isSel && <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: "#0057FF", marginTop: 2 }} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity style={[sched.confirmBtn, { marginTop: 16 }]} onPress={() => setCalendarVisible(false)} activeOpacity={0.8}>
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#fff" }}>Done</Text>
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </Modal>
      </Modal>
    </View>
  );
}

const sched = StyleSheet.create({
  emptyBox: { borderRadius: 14, padding: 24, borderWidth: 1, alignItems: "center", marginBottom: 8 },
  jobCard: { borderRadius: 14, padding: 14, borderWidth: 1, marginBottom: 10 },
  dateBadge: { width: 52, alignItems: "center", backgroundColor: "#0057FF", borderRadius: 10, paddingVertical: 8 },
  dateBadgeMon: { fontSize: 11, fontWeight: "700", color: "rgba(255,255,255,0.8)", textTransform: "uppercase", letterSpacing: 0.5 },
  dateBadgeDay: { fontSize: 26, fontWeight: "800", color: "#fff", lineHeight: 30 },
  dateBadgeYear: { fontSize: 10, color: "rgba(255,255,255,0.7)" },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  rescheduleBtn: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10, alignSelf: "flex-start", backgroundColor: "#0057FF15", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40, maxHeight: "90%" },
  calSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  dateCard: { width: 62, height: 80, borderRadius: 12, backgroundColor: "#F5F5F5", alignItems: "center", justifyContent: "center", gap: 2 },
  dateCardSel: { backgroundColor: "#0057FF" },
  dateCardDis: { opacity: 0.35 },
  dateDayLabel: { fontSize: 11, fontWeight: "600", color: "#6B7280" },
  dateNum: { fontSize: 22, fontWeight: "800", color: "#1A1A1A" },
  dateMon: { fontSize: 11, color: "#6B7280" },
  dateTextSel: { color: "#fff" },
  dateTextDis: { color: "#9CA3AF" },
  unavailDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#EF4444", marginTop: 2 },
  slotBtn: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1 },
  confirmBtn: { backgroundColor: "#0057FF", paddingVertical: 14, borderRadius: 14, alignItems: "center" },
});

const SCREEN_W = Dimensions.get("window").width;
// Use a tighter crop: show the middle 60% of the portrait video height to eliminate letterbox
const VIDEO_HEIGHT = Math.round(SCREEN_W * 0.6);

// ─── VIP Video Hero ───────────────────────────────────────────────────────────
const VIP_VIDEO_URL = "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/EvDmJQGFjZoaCrwU.mp4";

// Inner player — only mounted after user taps play, preventing ExoPlayer/AVPlayer OOM on screen load
const VipVideoPlayer = React.memo(function VipVideoPlayer({ onClose }: { onClose: () => void }) {
  const player = useVideoPlayer(VIP_VIDEO_URL, (p) => {
    p.loop = false;
    p.muted = false;
    p.play();
  });

  useEffect(() => {
    return () => {
      try { player.pause(); player.release(); } catch { /* ignore */ }
    };
  }, [player]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        try { player.pause(); } catch { /* ignore */ }
      };
    }, [player])
  );

  return (
    <View style={{ width: SCREEN_W, height: VIDEO_HEIGHT, backgroundColor: "#000" }}>
      <VideoView
        player={player}
        style={{ width: SCREEN_W, height: VIDEO_HEIGHT }}
        allowsFullscreen
        allowsPictureInPicture={false}
        contentFit="contain"
        nativeControls
      />
      {/* Close / collapse button */}
      <TouchableOpacity
        onPress={onClose}
        style={{ position: "absolute", top: 8, right: 8, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 14, width: 28, height: 28, alignItems: "center", justifyContent: "center" }}
        activeOpacity={0.8}
      >
        <Text style={{ color: "#fff", fontSize: 14, fontWeight: "700" }}>✕</Text>
      </TouchableOpacity>
    </View>
  );
});

// Outer hero — shows a thumbnail/poster until user taps play
// No native video player is created until the user explicitly taps, preventing OOM crashes
const VipVideoHero = React.memo(function VipVideoHero() {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return <VipVideoPlayer onClose={() => setPlaying(false)} />;
  }

  return (
    <TouchableOpacity
      style={{ width: SCREEN_W, height: VIDEO_HEIGHT, backgroundColor: "#0a0a2e", alignItems: "center", justifyContent: "center" }}
      onPress={() => setPlaying(true)}
      activeOpacity={0.85}
    >
      {/* Play button circle */}
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: "rgba(0,87,255,0.85)", alignItems: "center", justifyContent: "center", marginBottom: 14, shadowColor: "#0057FF", shadowOpacity: 0.6, shadowRadius: 16, elevation: 8 }}>
        <Text style={{ fontSize: 30, marginLeft: 5 }}>▶</Text>
      </View>
      <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700", letterSpacing: 0.3 }}>🎬 How the VIP Program Works</Text>
      <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 12, marginTop: 6 }}>Tap to watch · 2 min</Text>
    </TouchableOpacity>
  );
});

const API_BASE = "https://luxwashapp-n2wveyqg.manus.space";
// Key is scoped to customer ID to prevent cross-account cache leakage
const vipTokenKey = (customerId: string) => `customer_vip_token_${customerId}`;

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
}

interface VipContract {
  id: number;
  contract_number: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  vehicle_description: string | null;
  city: string | null;
  start_date: string;
  end_date: string;
  total_price: string;
  status: ContractStatus;
  signed_at: string | null;
  signature_token?: string;
  rep_name: string | null;
  notes: string | null;
  frequency?: "monthly" | "biweekly";
  visits?: VipVisit[];
  credits_remaining?: number;
  total_visits?: number;
  completed_visits?: number;
  redeemed_visits?: number;
  luxury_total?: number;
  basic_total?: number;
  luxury_remaining?: number;
  basic_remaining?: number;
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

function fmtFullDate(d: string | null): string {
  if (!d) return "TBD";
  const dt = new Date(d + "T12:00:00");
  return dt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function daysUntil(d: string | null): number {
  if (!d) return 999;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

function visitIcon(visit: VipVisit, isPast: boolean): string {
  if (visit.status === "completed") return "✅";
  if (visit.status === "missed") return "❌";
  if (visit.status === "cancelled") return "🚫";
  if (isPast) return "⏳";
  return "📅";
}

// ─── Token Entry Screen ───────────────────────────────────────────────────────
function TokenEntryScreen({ onToken }: { onToken: (token: string) => void }) {
  const colors = useColors();
  const s = styles(colors);
  const [token, setToken] = useState("");

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
      <Text style={{ fontSize: 56, marginBottom: 20 }}>⭐</Text>
      <Text style={[s.heroTitle, { color: colors.foreground, textAlign: "center" }]}>
        VIP Member Portal
      </Text>
      <Text style={[s.heroSub, { color: colors.muted, textAlign: "center", marginBottom: 32 }]}>
        Enter your VIP contract token to view your membership details and service schedule.
      </Text>
      <View style={[s.tokenInput, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={[s.tokenInputPlaceholder, { color: colors.muted }]}>
          Paste your contract token here
        </Text>
      </View>
      <Text style={[s.heroSub, { color: colors.muted, textAlign: "center", marginTop: 24 }]}>
        Your token was included in the signature link sent by Luxury Wash On Wheels.
        Contact us at 850-517-7874 if you need help.
      </Text>
    </View>
  );
}

// ─── Visit Timeline Card ──────────────────────────────────────────────────────
function VisitTimelineCard({ visit, isCurrentMonth, isRenewal }: { visit: VipVisit; isCurrentMonth: boolean; isRenewal?: boolean }) {
  const colors = useColors();
  const s = styles(colors);
  const now = new Date();
  const visitDate = visit.scheduled_date ? new Date(visit.scheduled_date + "T12:00:00") : null;
  const isPast = visitDate ? visitDate < now : false;
  const isCompleted = visit.status === "completed";
  const isMissed = visit.status === "missed";
  const hasAddOns = visit.add_ons.length > 0;

  // Force light theme for VIP portal cards
  const cardBg = isCompleted
    ? "#DCFCE7"
    : isMissed
    ? "#FEE2E2"
    : isCurrentMonth
    ? "#EFF6FF"
    : "#FFFFFF";

  const borderColor = isCompleted
    ? "#86EFAC"
    : isMissed
    ? "#FECACA"
    : isCurrentMonth
    ? "#93C5FD"
    : "#E5E7EB";

  return (
    <View style={[s.visitCard, { backgroundColor: cardBg, borderColor }]}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
        {/* Number badge */}
        <View style={[s.visitBadge, {
          backgroundColor: isCompleted ? "#22C55E" : isMissed ? "#EF4444" : isCurrentMonth ? "#0057FF" : "#9CA3AF",
        }]}>
          <Text style={{ color: "#fff", fontWeight: "800", fontSize: 14 }}>{visit.visit_number}</Text>
        </View>

        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={[s.visitMonth, { color: "#1F2937" }]}>
              {visitIcon(visit, isPast)} {visitDate ? fmtFullDate(visit.scheduled_date) : "Available — Book Anytime"}
            </Text>
            {isCurrentMonth && (
              <View style={{ backgroundColor: visit.scheduled_date ? "#059669" : "#0057FF", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{visit.scheduled_date ? "REDEEMED" : "THIS MONTH"}</Text>
              </View>
            )}
          </View>

          {/* Show service type for VIP Elite credit visits */}
          {(visit as any).notes && ((visit as any).notes === 'Luxury Detail' || (visit as any).notes === 'Basic Detail') && (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 4 }}>
              <Text style={{ fontSize: 12, color: (visit as any).notes === 'Luxury Detail' ? '#D97706' : '#6B7280', fontWeight: '700' }}>
                {(visit as any).notes === 'Luxury Detail' ? '✨ Luxury Detail' : '🛡️ Basic Detail'}
              </Text>
            </View>
          )}
          {visit.scheduled_time && (
            <Text style={[s.visitTime, { color: "#6B7280" }]}>🕐 {visit.scheduled_time}</Text>
          )}

          {hasAddOns && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
              {visit.add_ons.map((a) => (
                <View key={a} style={[s.addOnBadge, { backgroundColor: "#0057FF18" }]}>
                  <Text style={[s.addOnText, { color: "#0057FF" }]}>✨ {a}</Text>
                </View>
              ))}
            </View>
          )}

          {isRenewal && (
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
              <View style={{ backgroundColor: "#7C3AED", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>🔄 RENEWAL APPOINTMENT</Text>
              </View>
            </View>
          )}
          {isCompleted && (
            <Text style={[s.visitTime, { color: "#22C55E", marginTop: 4 }]}>
              Completed
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function CustomerVipScreen() {
  const colors = useColors();
  const { customer, token: authToken } = useCustomerAuth();
  const router = useRouter();
  const [contracts, setContracts] = useState<VipContract[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedToken, setSavedToken] = useState<string | null>(null);
  const contract = contracts[selectedIndex] ?? null;
  const [interestSent, setInterestSent] = useState<null | 'vip' | 'maintenance'>(null);
  const [interestLoading, setInterestLoading] = useState<null | 'vip' | 'maintenance'>(null);
  const [renewalSent, setRenewalSent] = useState(false);
  const [renewalLoading, setRenewalLoading] = useState(false);
  const [signupModalVisible, setSignupModalVisible] = useState(false);
  // Derive customerKey for saved-card lookup (same logic as profile.tsx)
  const customerKey = customer?.phone
    ? `phone:${customer.phone.replace(/\D/g, "").slice(-10)}`
    : customer?.email
    ? `email:${customer.email.toLowerCase().trim()}`
    : customer?.firstName
    ? `name:${(customer.firstName + " " + (customer.lastName ?? "")).toLowerCase().trim()}`
    : undefined;
  // Live credit booking modal state
  const [creditBookingVisible, setCreditBookingVisible] = useState(false);
  const [creditBookingType, setCreditBookingType] = useState<'luxury' | 'basic' | null>(null);
  const [creditBookingStep, setCreditBookingStep] = useState<'vehicle' | 'calendar' | 'address' | 'confirm' | 'done'>('vehicle');
  const [creditSelectedVehicle, setCreditSelectedVehicle] = useState<{ vehicleId: string; label: string; vehicleType: string } | null>(null);
  const [creditDetectedCity, setCreditDetectedCity] = useState<string>('');
  const [creditSelectedDate, setCreditSelectedDate] = useState<Date | null>(null);
  const [creditSelectedSlot, setCreditSelectedSlot] = useState<string | null>(null);
  const [creditBookingLoading, setCreditBookingLoading] = useState(false);
  const [creditCalMonth, setCreditCalMonth] = useState(() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }; });
  const [creditSelectedAddress, setCreditSelectedAddress] = useState<string>('');
  const [creditNewAddress, setCreditNewAddress] = useState<string>('');
  const [creditAddressMode, setCreditAddressMode] = useState<'saved' | 'new'>('saved');
  const addressesQuery = trpc.customer.listAddresses.useQuery(
    { token: authToken ?? '' },
    { enabled: !!authToken && creditBookingVisible }
  );
  const vehiclesQuery = trpc.customer.listVehicles.useQuery(
    { token: authToken ?? '' },
    { enabled: !!authToken && creditBookingVisible }
  );
  // Flex Pass modal state
  const [flexPassVisible, setFlexPassVisible] = useState(false);
  const [flexDate, setFlexDate] = useState("");
  const [flexTime, setFlexTime] = useState("");
  const [flexCity, setFlexCity] = useState("");
  const [flexNotes, setFlexNotes] = useState("");
  const [flexLoading, setFlexLoading] = useState(false);
  const [flexSent, setFlexSent] = useState(false);
  // Flex Pass calendar picker state
  const [flexSelectedDate, setFlexSelectedDate] = useState<Date | null>(null);
  const [flexSelectedSlot, setFlexSelectedSlot] = useState<string | null>(null);
  const [flexCalMonth, setFlexCalMonth] = useState(() => { const n = new Date(); return { year: n.getFullYear(), month: n.getMonth() }; });
  const insets = useSafeAreaInsets();
  const s = styles(colors);
  const vipInterestMutation = trpc.customer.vipInterest.useMutation({
    onSuccess: () => { setInterestSent('vip'); },
    onError: (e) => Alert.alert('Error', e.message ?? 'Could not send request. Please try again.'),
  });
  const maintenanceInterestMutation = trpc.customer.maintenanceInterest.useMutation({
    onSuccess: () => { setInterestSent('maintenance'); },
    onError: (e) => Alert.alert('Error', e.message ?? 'Could not send request. Please try again.'),
  });
  const renewalInterestMutation = trpc.customer.renewalInterest.useMutation({
    onSuccess: () => { setRenewalSent(true); },
    onError: (e) => Alert.alert('Error', e.message ?? 'Could not send renewal request. Please try again.'),
  });
  async function handleVipInterest() {
    if (!authToken) return;
    setInterestLoading('vip');
    try { await vipInterestMutation.mutateAsync({ token: authToken }); } finally { setInterestLoading(null); }
  }
  async function handleMaintenanceInterest() {
    if (!authToken) return;
    setInterestLoading('maintenance');
    try { await maintenanceInterestMutation.mutateAsync({ token: authToken }); } finally { setInterestLoading(null); }
  }
  async function handleRenewalRequest() {
    if (!authToken || !contract) return;
    setRenewalLoading(true);
    try {
      await renewalInterestMutation.mutateAsync({
        token: authToken,
        contractNumber: contract.contract_number ?? '',
        programType: (contract as any).program_type ?? 'vip',
      });
    } finally { setRenewalLoading(false); }
  }

  // Handle live credit booking confirmation
  async function handleCreditBookingConfirm() {
    if (!contract || !creditBookingType || !creditSelectedDate || !creditSelectedSlot) return;
    const finalAddress = creditAddressMode === 'new' ? creditNewAddress.trim() : creditSelectedAddress;
    if (!finalAddress) { Alert.alert('Missing Address', 'Please select or enter a service address.'); return; }
    setCreditBookingLoading(true);
    try {
      const dateStr = fmtDateKey(creditSelectedDate);
      const resp = await fetch(`${API_BASE}/api/vip/book-credit-live`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractId: contract.id,
          serviceType: creditBookingType,
          scheduledDate: dateStr,
          scheduledTime: creditSelectedSlot,
          serviceAddress: finalAddress,
          vehicleId: creditSelectedVehicle?.vehicleId,
          vehicleLabel: creditSelectedVehicle?.label,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        setCreditBookingStep('done');
        // Refresh contract data after a short delay
        setTimeout(() => { loadByCustomer(true); }, 1200);
      } else {
        Alert.alert("Error", data.error ?? "Could not book appointment. Please try again.");
      }
    } catch (e) {
      Alert.alert("Error", "Network error. Please check your connection.");
    } finally {
      setCreditBookingLoading(false);
    }
  }

  // Handle Flex Pass priority scheduling request
  async function handleFlexPassRequest() {
    if (!contract || !flexDate) {
      Alert.alert("Missing Info", "Please select a preferred date.");
      return;
    }
    setFlexLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/api/vip/request-flex-pass`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractId: contract.id,
          customerName: contract.customer_name,
          customerEmail: (contract as any).customer_email ?? "",
          requestedDate: flexDate,
          requestedTime: flexTime || null,
          city: flexCity || contract.city || null,
          notes: flexNotes || null,
        }),
      });
      const data = await resp.json();
      if (data.success) {
        setFlexSent(true);
      } else {
        Alert.alert("Error", data.error ?? "Could not send request. Please try again.");
      }
    } catch (e) {
      Alert.alert("Error", "Network error. Please check your connection.");
    } finally {
      setFlexLoading(false);
    }
  }

  // Try to load contract by matching customer email
  const loadByCustomer = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    const tokenKey = customer?.customerId ? vipTokenKey(customer.customerId) : null;

    try {
      // Prefer email lookup — returns ALL contracts with enriched visit data (live dates + auto-completion)
      if (customer?.email) {
        const encodedEmail = encodeURIComponent(customer.email.toLowerCase().trim());
        const lastNameParam = customer.lastName ? `?lastName=${encodeURIComponent(customer.lastName.toLowerCase().trim())}` : '';
        const data = await fetch(`${API_BASE}/api/vip/by-email/${encodedEmail}${lastNameParam}`).then(r => r.json());
        if (data.success && data.contracts && data.contracts.length > 0) {
          setContracts(data.contracts);
          setSelectedIndex(0);
          // Cache the primary token for unauthenticated fallback
          if (data.contracts[0].signature_token && tokenKey) {
            await AsyncStorage.setItem(tokenKey, data.contracts[0].signature_token);
          }
          setLoading(false);
          setRefreshing(false);
          return;
        }
        // Email lookup succeeded but returned no active contracts (e.g. contract was cancelled/expired).
        // Clear any cached token so the fallback below doesn't reload the cancelled contract.
        if (data.success && tokenKey) {
          await AsyncStorage.removeItem(tokenKey);
          setSavedToken(null);
          setContracts([]);
          setLoading(false);
          setRefreshing(false);
          return;
        }
      }

      // Fallback: saved token (unauthenticated or email lookup failed)
      const token = tokenKey ? await AsyncStorage.getItem(tokenKey) : null;
      if (token) {
        setSavedToken(token);
        const data = await fetch(`${API_BASE}/api/vip/by-token/${token}`).then(r => r.json());
        if (data.success && data.contract) {
          setContracts([data.contract]);
          setSelectedIndex(0);
          setLoading(false);
          setRefreshing(false);
          return;
        }
        // Token is stale — clear it
        if (tokenKey) await AsyncStorage.removeItem(tokenKey);
        setSavedToken(null);
      }

      setContracts([]);
    } catch (e) {
      setError("Could not load VIP information. Please check your connection.");
    }

    setLoading(false);
    setRefreshing(false);
  }, [customer?.email, customer?.customerId, customer?.lastName]);

  useFocusEffect(useCallback(() => { loadByCustomer(); }, [loadByCustomer]));

  const onRefresh = () => { setRefreshing(true); loadByCustomer(true); };

  const openSignaturePage = () => {
    if (!contract?.signature_token) return;
    const url = `https://luxurywashonwheels.app/api/vip/sign/${contract.signature_token}`;
    Linking.openURL(url).catch(() => Alert.alert("Error", "Could not open the signature page."));
  };
  // Scroll refs for pill buttons (MUST be before any conditional return per Rules of Hooks)
  const scrollRef = useRef<ScrollView>(null);
  const [eliteCardY, setEliteCardY] = useState(0);
  const [vipCardY, setVipCardY] = useState(0);
  const [maintCardY, setMaintCardY] = useState(0);
  const scrollToElite = () => { scrollRef.current?.scrollTo({ y: eliteCardY, animated: true }); };
  const scrollToVip = () => { scrollRef.current?.scrollTo({ y: vipCardY, animated: true }); };
  const scrollToMaint = () => { scrollRef.current?.scrollTo({ y: maintCardY, animated: true }); };

  // ── Credit booking hooks — MUST be before any conditional return (Rules of Hooks) ──
  // Use the city detected from the customer's entered address; fall back to contract city (trimmed)
  const _creditCity = creditDetectedCity || (contract?.city ?? '').trim();
  const _creditDateKey = creditSelectedDate ? fmtDateKey(creditSelectedDate) : "";
  const _creditPackageName = creditBookingType === 'luxury' ? 'Luxury Detail' : 'Basic Detail';
  const { data: _creditAvailDates, isLoading: _creditDatesLoading } = trpc.employee.getAvailableDates.useQuery(
    { city: _creditCity, daysAhead: 90 },
    { enabled: creditBookingVisible && !!_creditCity, staleTime: 5 * 60 * 1000 }
  );
  const _creditAvailDateSet = useMemo(() => new Set(_creditAvailDates ?? []), [_creditAvailDates]);
  const _creditUpcomingDates = useMemo(() => buildUpcomingDates(90), []);
  const _creditCarouselDates = useMemo(() => {
    if (_creditDatesLoading || !_creditAvailDates) return _creditUpcomingDates;
    return _creditUpcomingDates.filter(d => _creditAvailDateSet.has(fmtDateKey(d)));
  }, [_creditUpcomingDates, _creditAvailDateSet, _creditDatesLoading, _creditAvailDates]);
  const { data: _creditSlots, isLoading: _creditSlotsLoading } = trpc.employee.getAvailableSlots.useQuery(
    { date: _creditDateKey, city: _creditCity, packageName: _creditPackageName },
    { enabled: creditBookingVisible && !!_creditDateKey && !!_creditCity }
  );
  const _creditMonthGrid = useMemo(() => buildMonthWeeks(creditCalMonth.year, creditCalMonth.month), [creditCalMonth]);

  // ── Flex Pass calendar hooks — MUST be before any conditional return ──
  const _flexCity = contract?.city ?? "";
  const _flexDateKey = flexSelectedDate ? fmtDateKey(flexSelectedDate) : "";
  const { data: _flexAvailDates, isLoading: _flexDatesLoading } = trpc.employee.getAvailableDates.useQuery(
    { city: _flexCity, daysAhead: 90 },
    { enabled: flexPassVisible && !!_flexCity, staleTime: 5 * 60 * 1000 }
  );
  const _flexAvailDateSet = useMemo(() => new Set(_flexAvailDates ?? []), [_flexAvailDates]);
  const { data: _flexSlots, isLoading: _flexSlotsLoading } = trpc.employee.getAvailableSlots.useQuery(
    { date: _flexDateKey, city: _flexCity, packageName: 'Luxury Detail' },
    { enabled: flexPassVisible && !!_flexDateKey && !!_flexCity }
  );
  const _flexMonthGrid = useMemo(() => buildMonthWeeks(flexCalMonth.year, flexCalMonth.month), [flexCalMonth]);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <ScreenContainer containerClassName="bg-white">
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color="#0057FF" size="large" />
          <Text style={{ color: colors.muted, marginTop: 16 }}>Loading VIP membership…</Text>
        </View>
      </ScreenContainer>
    );
  }

  // ── No contract found ──────────────────────────────────────────────────────
  if (contracts.length === 0) {
    return (
      <ScreenContainer containerClassName="bg-white">
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0057FF" />}
        >
          <View>
          {/* VIP Explainer Video — only shown after loading confirms no contract exists */}
          {/* Rendered here (not during loading) to prevent ExoPlayer from being created */}
          {/* and immediately destroyed when the contract API resolves for existing members */}
          <VipVideoHero />

          {/* Active Profile Preview Mockup */}
          <View style={{ backgroundColor: "#F9FAFB", paddingVertical: 28, paddingHorizontal: 24, alignItems: "center" }}>
            <Text style={{ color: "#6B7280", fontSize: 10, fontWeight: "800", letterSpacing: 2, marginBottom: 10, textTransform: "uppercase" }}>See It In Action</Text>
            <Text style={{ color: "#1A1A1A", fontSize: 16, fontWeight: "800", textAlign: "center", marginBottom: 16, lineHeight: 22 }}>Your entire year of service,{"\n"}organized and on schedule.</Text>
            {/* Two-phone mockup */}
            <Image
              source={{ uri: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/vyaZJhDOzjrxwnTk.png" }}
              style={{ width: SCREEN_W - 32, aspectRatio: 1.37, borderRadius: 12 }}
              resizeMode="contain"
            />
            <Text style={{ color: "#9CA3AF", fontSize: 11, marginTop: 14, textAlign: "center", lineHeight: 16 }}>Every visit tracked. Every add-on scheduled.{"\n"}Nothing left to chance.</Text>
          </View>

          {/* Hero */}
          <View style={{ backgroundColor: "#FFFFFF", paddingTop: 44, paddingBottom: 32, paddingHorizontal: 24, alignItems: "center" }}>
            <Text style={{ color: "#6B7280", fontSize: 11, fontWeight: "800", letterSpacing: 2, marginBottom: 12 }}>LUXURY WASH ON WHEELS</Text>
            <Text style={{ fontSize: 30, fontWeight: "900", color: "#1A1A1A", textAlign: "center", lineHeight: 36, marginBottom: 14 }}>
              Never Worry About{"\n"}Your Detail Again
            </Text>
            <Text style={{ color: "#6B7280", textAlign: "center", fontSize: 14, lineHeight: 22, marginBottom: 24 }}>
              Choose the program that fits your lifestyle. All include recurring professional detailing — you pick the level of service.
            </Text>
            {/* Program pills — tap to jump to the sign-up card */}
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={scrollToElite}
                style={{ backgroundColor: "#0a7ea4", borderRadius: 100, paddingHorizontal: 14, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 5 }}
              >
                <Text style={{ fontSize: 13 }}>👑</Text>
                <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>VIP Elite</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={scrollToVip}
                style={{ backgroundColor: "#7C3AED", borderRadius: 100, paddingHorizontal: 14, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 5 }}
              >
                <Text style={{ fontSize: 13 }}>⭐</Text>
                <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>VIP</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={scrollToMaint}
                style={{ backgroundColor: "#059669", borderRadius: 100, paddingHorizontal: 14, paddingVertical: 6, flexDirection: "row", alignItems: "center", gap: 5 }}
              >
                <Text style={{ fontSize: 13 }}>🔧</Text>
                <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>Maintenance</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ padding: 20, gap: 20 }}>

            {/* ── Comparison Table ── */}
            <View style={{ backgroundColor: colors.surface, borderRadius: 18, overflow: "hidden", borderWidth: 1, borderColor: colors.border }}>
              <View style={{ backgroundColor: "#0A0A0A", padding: 16, paddingBottom: 12 }}>
                <Text style={{ color: "#fff", fontSize: 15, fontWeight: "800", textAlign: "center" }}>Which Program Is Right for You?</Text>
              </View>
              {/* Header row */}
              <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <View style={{ flex: 1.6, paddingVertical: 14, paddingHorizontal: 10, justifyContent: "center" }}>
                  <Text style={{ color: colors.muted, fontSize: 10, fontWeight: "700" }}>FEATURE</Text>
                </View>
                <View style={{ flex: 1, paddingVertical: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#0a7ea415", borderLeftWidth: 1, borderLeftColor: "#0a7ea440" }}>
                  <Text style={{ fontSize: 14 }}>👑</Text>
                  <Text style={{ color: "#0a7ea4", fontSize: 10, fontWeight: "800", marginTop: 2 }}>Elite</Text>
                </View>
                <View style={{ flex: 1, paddingVertical: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#7C3AED15", borderLeftWidth: 1, borderLeftColor: "#7C3AED40" }}>
                  <Text style={{ fontSize: 14 }}>⭐</Text>
                  <Text style={{ color: "#7C3AED", fontSize: 10, fontWeight: "800", marginTop: 2 }}>VIP</Text>
                </View>
                <View style={{ flex: 1, paddingVertical: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#05966915", borderLeftWidth: 1, borderLeftColor: "#05966940" }}>
                  <Text style={{ fontSize: 14 }}>🔧</Text>
                  <Text style={{ color: "#059669", fontSize: 10, fontWeight: "800", marginTop: 2 }}>Maint.</Text>
                </View>
              </View>
              {([
                { label: "Full Luxury Detail", elite: true, vip: false, maint: false },
                { label: "Basic Detail Service", elite: true, vip: true, maint: true },
                { label: "Paint Sealant", elite: true, vip: true, maint: false },
                { label: "Leather Deep Clean", elite: true, vip: true, maint: false },
                { label: "Leather Conditioning", elite: true, vip: true, maint: false },
                { label: "Shampoo Treatments", elite: true, vip: true, maint: false },
                { label: "Self-Schedule Anytime", elite: true, vip: false, maint: false },
                { label: "Priority Scheduling", elite: true, vip: true, maint: false },
                { label: "Annual Contract", elite: true, vip: true, maint: false },
                { label: "Month-to-Month", elite: false, vip: false, maint: true },
              ] as { label: string; elite: boolean; vip: boolean; maint: boolean }[]).map((row, i) => (
                <View key={row.label} style={{ flexDirection: "row", borderBottomWidth: i < 9 ? 1 : 0, borderBottomColor: colors.border }}>
                  <View style={{ flex: 1.6, padding: 10, justifyContent: "center" }}>
                    <Text style={{ color: colors.foreground, fontSize: 12 }}>{row.label}</Text>
                  </View>
                  <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0a7ea408", borderLeftWidth: 1, borderLeftColor: "#0a7ea420" }}>
                    <MaterialIcons name={row.elite ? "check-circle" : "cancel"} size={18} color={row.elite ? "#0a7ea4" : colors.border} />
                  </View>
                  <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#7C3AED08", borderLeftWidth: 1, borderLeftColor: "#7C3AED20" }}>
                    <MaterialIcons name={row.vip ? "check-circle" : "cancel"} size={18} color={row.vip ? "#7C3AED" : colors.border} />
                  </View>
                  <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#05966908", borderLeftWidth: 1, borderLeftColor: "#05966920" }}>
                    <MaterialIcons name={row.maint ? "check-circle" : "cancel"} size={18} color={row.maint ? "#059669" : colors.border} />
                  </View>
                </View>
              ))}
            </View>

            {/* ── VIP Elite Program Card ── */}
            <View
              onLayout={(e) => setEliteCardY(e.nativeEvent.layout.y)}
              style={{ borderRadius: 18, overflow: "hidden", borderWidth: 2, borderColor: "#0a7ea4" }}
            >
              <View style={{ backgroundColor: "#0a7ea4", padding: 16 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <Text style={{ fontSize: 22 }}>👑</Text>
                  <Text style={{ color: "#fff", fontSize: 18, fontWeight: "900" }}>VIP Elite Program</Text>
                  <View style={{ marginLeft: "auto", backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 100, paddingHorizontal: 10, paddingVertical: 3 }}>
                    <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>ELITE</Text>
                  </View>
                </View>
                <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 13, lineHeight: 19 }}>
                  The pinnacle of car care. 2 Luxury Details + 10 Basic Details — use them anytime, in any order.
                </Text>
              </View>
              <View style={{ backgroundColor: colors.surface, padding: 16, gap: 8 }}>
                {[
                  "2 Full Luxury Details (deep clean, clay bar, polish, sealant)",
                  "10 Basic Details (exterior wash, interior clean, windows, tires)",
                  "Use anytime — mix & match at your convenience",
                  "Self-schedule or let us pre-schedule for you",
                  "Priority scheduling — first access to slots",
                  "Use credits on any vehicle",
                ].map(b => (
                  <View key={b} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <MaterialIcons name="check-circle" size={18} color="#0a7ea4" />
                    <Text style={{ color: colors.foreground, fontSize: 13, flex: 1 }}>{b}</Text>
                  </View>
                ))}
                <View style={{ marginTop: 8 }}>
                  <TouchableOpacity
                    onPress={() => setSignupModalVisible(true)}
                    activeOpacity={0.85}
                    style={{ backgroundColor: "#0a7ea4", borderRadius: 14, paddingVertical: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}
                  >
                    <MaterialIcons name="workspace-premium" size={18} color="#fff" />
                    <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>Sign Up for VIP Elite</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* ── VIP Program Card ── */}
            <View
              onLayout={(e) => setVipCardY(e.nativeEvent.layout.y)}
              style={{ borderRadius: 18, overflow: "hidden", borderWidth: 2, borderColor: "#7C3AED" }}
            >
              <View style={{ backgroundColor: "#7C3AED", padding: 16 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <Text style={{ fontSize: 22 }}>⭐</Text>
                  <Text style={{ color: "#fff", fontSize: 18, fontWeight: "900" }}>VIP Program</Text>
                  <View style={{ marginLeft: "auto", backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 100, paddingHorizontal: 10, paddingVertical: 3 }}>
                    <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>PREMIUM</Text>
                  </View>
                </View>
                <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 13, lineHeight: 19 }}>
                  Full detail service plus rotating premium add-ons every visit. The ultimate hands-off car care experience.
                </Text>
              </View>
              <View style={{ backgroundColor: colors.surface, padding: 16, gap: 8 }}>
                {[
                  "12 monthly full detail services",
                  "Paint Sealant on visits 1 & 7",
                  "Leather Deep Clean on visits 1, 5 & 9",
                  "Leather Conditioning on visits 1 & 7",
                  "Shampoo treatments as needed",
                  "Priority scheduling — first access",
                ].map(b => (
                  <View key={b} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <MaterialIcons name="check-circle" size={18} color="#7C3AED" />
                    <Text style={{ color: colors.foreground, fontSize: 13, flex: 1 }}>{b}</Text>
                  </View>
                ))}
                <View style={{ marginTop: 8 }}>
                  <TouchableOpacity
                    onPress={() => setSignupModalVisible(true)}
                    activeOpacity={0.85}
                    style={{ backgroundColor: "#7C3AED", borderRadius: 14, paddingVertical: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}
                  >
                    <MaterialIcons name="star" size={18} color="#fff" />
                    <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>Sign Up for VIP</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* ── Maintenance Program Card ── */}
            <View
              onLayout={(e) => setMaintCardY(e.nativeEvent.layout.y)}
              style={{ borderRadius: 18, overflow: "hidden", borderWidth: 2, borderColor: "#059669" }}
            >
              <View style={{ backgroundColor: "#059669", padding: 16 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <Text style={{ fontSize: 22 }}>🔧</Text>
                  <Text style={{ color: "#fff", fontSize: 18, fontWeight: "900" }}>Maintenance Program</Text>
                  <View style={{ marginLeft: "auto", backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 100, paddingHorizontal: 10, paddingVertical: 3 }}>
                    <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>STANDARD</Text>
                  </View>
                </View>
                <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 13, lineHeight: 19 }}>
                  Consistent professional detailing on a recurring schedule. Clean car, zero effort — every single time.
                </Text>
              </View>
              <View style={{ backgroundColor: colors.surface, padding: 16, gap: 8 }}>
                {[
                  "12 monthly full detail services",
                  "Standard service on every visit",
                  "We schedule all your appointments",
                  "Priority scheduling — first access",
                  "Annual contract — one upfront payment",
                ].map(b => (
                  <View key={b} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <MaterialIcons name="check-circle" size={18} color="#059669" />
                    <Text style={{ color: colors.foreground, fontSize: 13, flex: 1 }}>{b}</Text>
                  </View>
                ))}
                <View style={{ marginTop: 8 }}>
                  <TouchableOpacity
                    onPress={() => setSignupModalVisible(true)}
                    activeOpacity={0.85}
                    style={{ backgroundColor: "#059669", borderRadius: 14, paddingVertical: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}
                  >
                    <MaterialIcons name="build" size={18} color="#fff" />
                    <Text style={{ color: "#fff", fontSize: 15, fontWeight: "700" }}>Sign Up for Maintenance</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* How it works */}
            <View style={{ backgroundColor: colors.surface, borderRadius: 18, padding: 20, borderWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontSize: 16, fontWeight: "800", color: colors.foreground, marginBottom: 16 }}>How Both Programs Work</Text>
              {([
                { icon: "payments", title: "Prepay Once", desc: "One upfront payment covers your entire year of service. No surprises, no monthly billing." },
                { icon: "event-repeat", title: "We Schedule Everything", desc: "Our team reaches out to set your recurring appointment dates at a time that works for you." },
                { icon: "calendar-today", title: "Priority Scheduling", desc: "Program members get first access to the best time slots before they open to the public." },

              ] as { icon: any; title: string; desc: string }[]).map((item) => (
                <View key={item.title} style={{ flexDirection: "row", gap: 14, marginBottom: 14, alignItems: "flex-start" }}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "#0057FF15", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <MaterialIcons name={item.icon} size={20} color="#0057FF" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: colors.foreground, marginBottom: 3 }}>{item.title}</Text>
                    <Text style={{ fontSize: 13, color: colors.muted, lineHeight: 19 }}>{item.desc}</Text>
                  </View>
                </View>
              ))}
            </View>

            {/* Call CTA */}
            <TouchableOpacity
              onPress={() => Linking.openURL("tel:8505177874")}
              activeOpacity={0.7}
              style={{ alignItems: "center", paddingVertical: 12 }}
            >
              <Text style={{ color: colors.muted, fontSize: 13, textAlign: "center" }}>
                Questions? Call us directly: <Text style={{ color: colors.primary, fontWeight: "700" }}>850-517-7874</Text>
              </Text>
            </TouchableOpacity>

            {error && (
              <Text style={{ color: colors.error, fontSize: 13, textAlign: "center" }}>{error}</Text>
            )}
          </View>
          </View>
        </ScrollView>

        {/* VIP Self-Serve Signup Modal */}
        <VipSignupModal
          visible={signupModalVisible}
          onClose={() => setSignupModalVisible(false)}
          onSuccess={() => {
            setSignupModalVisible(false);
            loadByCustomer();
          }}
          defaultInfo={{
            firstName: customer?.firstName ?? "",
            lastName: customer?.lastName ?? "",
            email: customer?.email ?? "",
            phone: customer?.phone ?? "",
          }}
          customerKey={customerKey}
        />
      </ScreenContainer>
    );
  }

  // ── Contract found ─────────────────────────────────────────────────────────
  const visits = contract?.visits ?? [];
  // Determine total visit count based on frequency
  const totalVisits = (contract as any)?.total_visits ?? ((contract as any)?.frequency === "biweekly" ? 26 : 12);
  // VIP Elite always uses the credit system (customers book visits on demand)
  const isEliteCreditSystem = (contract as any)?.program_type === 'vip_elite';
  // Only count original visits (not replacement visits) for progress/remaining display
  const originalVisits = visits.filter((v: any) => !v.is_replacement);
  // Count both completed AND scheduled-with-date visits as "used" for progress display
  const completedCount = (contract as any)?.completed_visits ?? originalVisits.filter(v =>
    v.status === "completed" || (v.status === "scheduled" && !!v.scheduled_date)
  ).length;
  // Use server-computed remaining (includes pending/redeemed visits)
  const remainingCount = (contract as any)?.credits_remaining ?? Math.max(totalVisits - completedCount, 0);
  // Per-type credit counts (VIP Elite)
  const luxuryRemaining = (contract as any)?.luxury_remaining ?? 0;
  const basicRemaining = (contract as any)?.basic_remaining ?? 0;
  const luxuryTotal = (contract as any)?.luxury_total ?? 2;
  const basicTotal = (contract as any)?.basic_total ?? (totalVisits - luxuryTotal);
  // Live calendar queries for credit booking modal (hoisted above early returns — aliases of _credit* hooks)
  const creditCity = _creditCity;
  const creditDateKey = _creditDateKey;
  const creditPackageName = _creditPackageName;
  const creditAvailDates = _creditAvailDates;
  const creditDatesLoading = _creditDatesLoading;
  const creditAvailDateSet = _creditAvailDateSet;
  const creditUpcomingDates = _creditUpcomingDates;
  const creditCarouselDates = _creditCarouselDates;
  const creditSlots = _creditSlots;
  const creditSlotsLoading = _creditSlotsLoading;
  const creditMonthGrid = _creditMonthGrid;
  // Flex Pass calendar aliases
  const flexAvailDateSet = _flexAvailDateSet;
  const flexDatesLoading = _flexDatesLoading;
  const flexSlots = _flexSlots;
  const flexSlotsLoading = _flexSlotsLoading;
  const flexMonthGrid = _flexMonthGrid;
  const expiryDays = daysUntil(contract?.end_date ?? null);
  const renewalAlert = expiryDays <= 60 && expiryDays > 0 && contract?.status === "active";
  const isPendingSig = contract?.status === "pending_signature";
  const now = new Date();
  const currentMonthVisit = visits.find(v => {
    if (!v.scheduled_date) return false;
    const d = new Date(v.scheduled_date + "T12:00:00");
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && v.status === "scheduled";
  });

  return (
    <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-white">
      <StatusBar style="dark" />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#0057FF" />}
        contentContainerStyle={{ paddingBottom: 60 }}
        style={{ backgroundColor: "#FFFFFF" }}
      >
        {/* Customer Message Banner */}
        <CustomerMessageBanner />

        {/* VIP Hero Header */}
        <View style={[s.heroHeader, { backgroundColor: "#F9FAFB", borderBottomWidth: 1, borderBottomColor: "#E5E7EB", paddingTop: Math.max(insets.top + 16, 48) }]}>
          {(contract as any)?.program_type === 'maintenance' ? (
            <View style={[s.vipBadge, { backgroundColor: "#059669" }]}>
              <Text style={s.vipBadgeText}>🔧 MAINTENANCE MEMBER</Text>
            </View>
          ) : (contract as any)?.program_type === 'vip_elite' ? (
            <View style={[s.vipBadge, { backgroundColor: "#D97706" }]}>
              <Text style={s.vipBadgeText}>👑 VIP ELITE MEMBER</Text>
            </View>
          ) : (
            <View style={s.vipBadge}>
              <Text style={s.vipBadgeText}>⭐ VIP MEMBER</Text>
            </View>
          )}

          {/* Vehicle selector — shown when customer has multiple contracts */}
          {contracts.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginBottom: 16 }}
              contentContainerStyle={{ gap: 8, paddingRight: 8 }}
            >
              {contracts.map((c, idx) => (
                <TouchableOpacity
                  key={c.id}
                  onPress={() => setSelectedIndex(idx)}
                  activeOpacity={0.8}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 20,
                    borderWidth: 1.5,
                    borderColor: idx === selectedIndex ? "#0057FF" : "#E5E7EB",
                    backgroundColor: idx === selectedIndex ? "#0057FF" : "#F3F4F6",
                  }}
                >
                  <Text style={{ color: idx === selectedIndex ? "#fff" : "#6B7280", fontWeight: "700", fontSize: 13 }}>
                    🚗 {c.vehicle_description || `Contract #${c.contract_number}`}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <Text style={s.heroName}>{contract?.customer_name}</Text>
          <Text style={s.heroVehicle}>{contract?.vehicle_description ?? "—"}</Text>
          <Text style={s.heroContract}>Contract #{contract?.contract_number}</Text>

          {/* Progress bar */}
          <View style={s.progressSection}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
              <Text style={{ color: "#6B7280", fontSize: 13 }}>
                {completedCount} of {totalVisits} visits completed
              </Text>
              <Text style={{ color: "#0057FF", fontSize: 13, fontWeight: "700" }}>
                {Math.round((completedCount / totalVisits) * 100)}%
              </Text>
            </View>
            <View style={[s.progressBar]}>
              <View style={[s.progressFill, { width: `${(completedCount / totalVisits) * 100}%` as any }]} />
            </View>
          </View>

          {/* Status chips */}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            <View style={[s.chip, { backgroundColor: contract?.status === "active" ? "#22C55E22" : "#F59E0B22", borderColor: contract?.status === "active" ? "#22C55E" : "#F59E0B" }]}>
              <Text style={{ color: contract?.status === "active" ? "#22C55E" : "#F59E0B", fontSize: 12, fontWeight: "700" }}>
                {contract?.status === "active" ? "✅ Active" : "⏳ Awaiting Signature"}
              </Text>
            </View>
            <View style={[s.chip, { backgroundColor: "#0057FF22", borderColor: "#0057FF" }]}>
              <Text style={{ color: "#0057FF", fontSize: 12, fontWeight: "700" }}>
                {remainingCount} visits remaining
              </Text>
            </View>
            {(contract as any)?.frequency === "biweekly" && (
              <View style={[s.chip, { backgroundColor: "#7C3AED22", borderColor: "#7C3AED" }]}>
                <Text style={{ color: "#7C3AED", fontSize: 12, fontWeight: "700" }}>⚡ Biweekly</Text>
              </View>
            )}
          </View>
        </View>



        {/* ── Pending Signature Banner ──────────────────────────────────── */}
        {isPendingSig && (
          <View style={{ marginHorizontal: 16, marginTop: 16, backgroundColor: "#FFF7ED", borderRadius: 16, borderWidth: 1.5, borderColor: "#F59E0B", padding: 18 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <Text style={{ fontSize: 22 }}>✍️</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: "800", color: "#92400E" }}>Contract Awaiting Signature</Text>
                <Text style={{ fontSize: 13, color: "#B45309", marginTop: 2 }}>Your contract is ready. Please review and sign to activate your membership.</Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={openSignaturePage}
              style={{ backgroundColor: "#F59E0B", borderRadius: 12, paddingVertical: 13, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}
              activeOpacity={0.85}
            >
              <MaterialIcons name="edit" size={18} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>Review & Sign Contract</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Credit Balance Card ─────────────────────────────────────────── */}
        {contract?.status === "active" && (
          <View style={{ marginHorizontal: 16, marginTop: 16, borderRadius: 20, overflow: "hidden" }}>
            <LinearGradient
              colors={["#0057FF", "#0040CC"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ padding: 20 }}
            >
              <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 11, fontWeight: "800", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 4 }}>
                Service Credits
              </Text>
              {isEliteCreditSystem ? (
                <>
                  {/* VIP Elite: two separate credit type rows */}
                  <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
                    {/* Luxury Detail */}
                    <View style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 14, padding: 14 }}>
                      <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 10, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>✨ Luxury</Text>
                      <Text style={{ color: "#fff", fontSize: 28, fontWeight: "900", lineHeight: 32 }}>{luxuryRemaining}</Text>
                      <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 2 }}>of {luxuryTotal} remaining</Text>
                      <TouchableOpacity
                        onPress={() => {
                          if (luxuryRemaining <= 0) return;
                          setCreditBookingType('luxury');
                          setCreditBookingStep('vehicle');
                          setCreditSelectedVehicle(null);
                          setCreditDetectedCity('');
                          setCreditSelectedDate(null);
                          setCreditSelectedSlot(null);
                          setCreditSelectedAddress('');
                          setCreditNewAddress('');
                          setCreditAddressMode('saved');
                          setCreditBookingVisible(true);
                        }}
                        style={{
                          marginTop: 10,
                          backgroundColor: luxuryRemaining > 0 ? "#D97706" : "rgba(255,255,255,0.2)",
                          borderRadius: 10,
                          paddingVertical: 9,
                          paddingHorizontal: 12,
                          alignItems: "center",
                          opacity: luxuryRemaining > 0 ? 1 : 0.5,
                        }}
                        activeOpacity={luxuryRemaining > 0 ? 0.8 : 1}
                      >
                        <Text style={{ color: "#fff", fontSize: 12, fontWeight: "800" }}>
                          {luxuryRemaining > 0 ? "Book Luxury" : "All Used"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    {/* Basic Detail */}
                    <View style={{ flex: 1, backgroundColor: "rgba(255,255,255,0.12)", borderRadius: 14, padding: 14 }}>
                      <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 10, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>🛡️ Basic</Text>
                      <Text style={{ color: "#fff", fontSize: 28, fontWeight: "900", lineHeight: 32 }}>{basicRemaining}</Text>
                      <Text style={{ color: "rgba(255,255,255,0.6)", fontSize: 11, marginTop: 2 }}>of {basicTotal} remaining</Text>
                      <TouchableOpacity
                        onPress={() => {
                          if (basicRemaining <= 0) return;
                          setCreditBookingType('basic');
                          setCreditBookingStep('vehicle');
                          setCreditSelectedVehicle(null);
                          setCreditDetectedCity('');
                          setCreditSelectedDate(null);
                          setCreditSelectedSlot(null);
                          setCreditSelectedAddress('');
                          setCreditNewAddress('');
                          setCreditAddressMode('saved');
                          setCreditBookingVisible(true);
                        }}
                        style={{
                          marginTop: 10,
                          backgroundColor: basicRemaining > 0 ? "#059669" : "rgba(255,255,255,0.2)",
                          borderRadius: 10,
                          paddingVertical: 9,
                          paddingHorizontal: 12,
                          alignItems: "center",
                          opacity: basicRemaining > 0 ? 1 : 0.5,
                        }}
                        activeOpacity={basicRemaining > 0 ? 0.8 : 1}
                      >
                        <Text style={{ color: "#fff", fontSize: 12, fontWeight: "800" }}>
                          {basicRemaining > 0 ? "Book Basic" : "All Used"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                  {remainingCount === 0 && (
                    <View style={{ marginTop: 12, backgroundColor: "rgba(255,255,255,0.1)", borderRadius: 10, padding: 10, alignItems: "center" }}>
                      <Text style={{ color: "rgba(255,255,255,0.9)", fontSize: 13, fontWeight: "700", textAlign: "center" }}>🎉 All credits redeemed — Contract Fulfilled!</Text>
                    </View>
                  )}
                </>
              ) : (
                <>
                  <Text style={{ color: "#fff", fontSize: 42, fontWeight: "900", lineHeight: 46, marginTop: 4 }}>{remainingCount}</Text>
                  <Text style={{ color: "rgba(255,255,255,0.75)", fontSize: 13, marginTop: 2 }}>of {totalVisits} visits remaining</Text>
                  <View style={{ height: 1, backgroundColor: "rgba(255,255,255,0.2)", marginVertical: 12 }} />
                  <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 13, lineHeight: 18 }}>
                    Each credit = 1 full detail visit. Tap <Text style={{ fontWeight: "700" }}>"Use a Credit"</Text> on any unscheduled visit below.
                  </Text>
                </>
              )}
            </LinearGradient>
          </View>
        )}

        {/* Renewal alert */}
        {renewalAlert && (
          <View style={[s.alertBanner, { backgroundColor: "#FFF3CD", borderColor: "#F59E0B" }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#92400E", fontWeight: "700", fontSize: 15 }}>
                ⚠️ Contract Expires in {expiryDays} Day{expiryDays === 1 ? '' : 's'}
              </Text>
              <Text style={{ color: "#92400E", fontSize: 13, marginTop: 4 }}>
                {renewalSent
                  ? "✅ Renewal request sent! We'll reach out to get you set up for another year."
                  : `Your ${(contract as any)?.program_type === 'maintenance' ? 'Maintenance Program' : (contract as any)?.program_type === 'vip_elite' ? 'VIP Elite' : 'VIP'} contract is expiring soon. Tap below to request a renewal and we'll reach out to you.`
                }
              </Text>
              {!renewalSent && (
                <TouchableOpacity
                  onPress={handleRenewalRequest}
                  disabled={renewalLoading}
                  style={{ marginTop: 10, backgroundColor: "#F59E0B", paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10, alignSelf: "flex-start" }}
                >
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>
                    {renewalLoading ? "Sending..." : "🔄 Request Renewal"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {/* This month's visit */}
        {currentMonthVisit && (
          <View style={[s.thisMonthCard, { backgroundColor: "#0057FF", marginHorizontal: 16, marginTop: 16, borderRadius: 16 }]}>
            <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>
              This Month — Visit {currentMonthVisit.visit_number}
            </Text>
            <Text style={{ color: "#fff", fontSize: 20, fontWeight: "800", marginTop: 4 }}>
              📅 {fmtFullDate(currentMonthVisit.scheduled_date)}
            </Text>
            {currentMonthVisit.scheduled_time && (
              <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 14, marginTop: 4 }}>🕐 {currentMonthVisit.scheduled_time}</Text>
            )}
            {currentMonthVisit.add_ons.length > 0 && (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {currentMonthVisit.add_ons.map(a => (
                  <View key={a} style={{ backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 }}>
                    <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>✨ {a}</Text>
                  </View>
                ))}
              </View>
            )}

          </View>
        )}

        {/* Contract details */}
        <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
          <Text style={[s.sectionTitle, { color: "#1F2937" }]}>Contract Details</Text>
          <View style={[s.detailCard, { backgroundColor: "#FFFFFF", borderColor: "#E5E7EB" }]}>
            <DetailRow label="Contract" value={`#${contract?.contract_number ?? 'N/A'}`} />
            <DetailRow label="Program" value={(contract as any)?.program_type === 'vip_elite' ? 'VIP Elite' : (contract as any)?.program_type === 'maintenance' ? 'Maintenance' : 'VIP'} />
            <DetailRow label="Start Date" value={fmtDate(contract?.start_date ?? null)} />
            <DetailRow label="End Date" value={fmtDate(contract?.end_date ?? null)} />
            <DetailRow label="Total Paid" value={`$${Number(contract?.total_price ?? 0).toFixed(2)}`} />
            {contract?.city && <DetailRow label="Service Area" value={contract.city} />}
            <DetailRow label="Credits" value={`${completedCount} of ${totalVisits} used (${remainingCount} remaining)`} />
          </View>
        </View>

        {/* Visit timeline */}
        <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
          <Text style={[s.sectionTitle, { color: "#1F2937" }]}>
            {isEliteCreditSystem ? `Your ${totalVisits} Service Credits` : `Your ${totalVisits}-Visit Schedule`}
          </Text>
          <Text style={{ color: "#6B7280", fontSize: 13, marginBottom: 12 }}>
            {isEliteCreditSystem
              ? `Use the "Book Luxury" or "Book Basic" buttons above to schedule your appointments.`
              : 'Each visit includes a full detail service. Tap "Use a Credit" on any unscheduled visit to request your preferred date.'}
          </Text>
          {visits.map((visit) => {
            const visitDate = visit.scheduled_date ? new Date(visit.scheduled_date + "T12:00:00") : null;
            const isCurrentMonth = visitDate
              ? visitDate.getMonth() === now.getMonth() && visitDate.getFullYear() === now.getFullYear()
              : false;
            const isRenewal = visit.visit_number === totalVisits + 1;
            return (
              <View key={visit.id}>
                <VisitTimelineCard
                  visit={visit}
                  isCurrentMonth={isCurrentMonth}
                  isRenewal={isRenewal}
                />
              </View>
            );
          })}
        </View>

        {/* ── Credits Used History ──────────────────────────────────────── */}
{(() => {
          // Show all redeemed credits: completed + pending/scheduled with a date
          const redeemedVisits = visits.filter((v: any) =>
            v.status === 'completed' || (v.status !== 'cancelled' && v.scheduled_date)
          ).sort((a: any, b: any) => (a.visit_number ?? 0) - (b.visit_number ?? 0));
          if (redeemedVisits.length === 0) return null;
          const usedCount = completedCount + ((contract as any)?.redeemed_visits ?? 0);
          return (
            <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
              <Text style={[s.sectionTitle, { color: "#1F2937" }]}>Redeemed Credits</Text>
              <Text style={{ color: "#6B7280", fontSize: 13, marginBottom: 12 }}>
                {usedCount} of {totalVisits} credit{usedCount !== 1 ? 's' : ''} redeemed
              </Text>
              {redeemedVisits.map((v: any) => {
                const vDate = v.scheduled_date ? new Date(v.scheduled_date + 'T12:00:00') : null;
                const isDone = v.status === 'completed';
                const serviceLabel = v.service_type === 'luxury' || (v.notes && v.notes.includes('Luxury Detail'))
                  ? '✨ Luxury Detail'
                  : v.service_type === 'basic' || (v.notes && v.notes.includes('Basic Detail'))
                  ? '🛡️ Basic Detail'
                  : (v.service_type ?? 'Detail Service');
                return (
                  <View
                    key={v.id}
                    style={[s.detailCard, {
                      backgroundColor: isDone ? '#DCFCE7' : '#EFF6FF',
                      borderColor: isDone ? '#86EFAC' : '#93C5FD',
                      marginBottom: 8,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                    }]}
                  >
                    <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: isDone ? '#22C55E' : '#0057FF', alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>{v.visit_number}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: '#1F2937' }}>{serviceLabel}</Text>
                      {vDate ? (
                        <Text style={{ fontSize: 12, color: '#6B7280', marginTop: 2 }}>
                          {isDone ? '✅' : '📅'} {vDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          {v.scheduled_time ? `  🕐 ${v.scheduled_time}` : ''}
                        </Text>
                      ) : null}
                      <Text style={{ fontSize: 11, color: isDone ? '#22C55E' : '#0057FF', fontWeight: '700', marginTop: 2 }}>
                        {isDone ? 'Completed' : 'Pending Confirmation'}
                      </Text>
                    </View>
                    <MaterialIcons name={isDone ? 'check-circle' : 'schedule'} size={20} color={isDone ? '#22C55E' : '#0057FF'} />
                  </View>
                );
              })}
            </View>
          );
        })()}

        {/* Add-on legend */}
        {(contract as any)?.program_type === 'vip_elite' ? (
          <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
            <Text style={[s.sectionTitle, { color: "#1F2937" }]}>Your {totalVisits} Detail Credits</Text>
            <View style={[s.detailCard, { backgroundColor: "#FFFFFF", borderColor: "#E5E7EB" }]}>
              <View style={{ flexDirection: "row", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" }}>
                <Text style={{ fontWeight: "700", color: "#D97706", width: 30, fontSize: 14 }}>{totalVisits === 6 ? 1 : 2}</Text>
                <Text style={{ flex: 1, color: "#1F2937", fontSize: 14, fontWeight: "600" }}>Luxury Detail</Text>
              </View>
              <View style={{ flexDirection: "row", paddingVertical: 10 }}>
                <Text style={{ fontWeight: "700", color: "#D97706", width: 30, fontSize: 14 }}>{totalVisits === 6 ? 5 : 10}</Text>
                <Text style={{ flex: 1, color: "#1F2937", fontSize: 14, fontWeight: "600" }}>Basic Detail</Text>
              </View>
            </View>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 16, marginTop: 20 }}>
            <Text style={[s.sectionTitle, { color: "#1F2937" }]}>Premium Add-Ons Schedule</Text>
            <View style={[s.detailCard, { backgroundColor: "#FFFFFF", borderColor: "#E5E7EB" }]}>
              {[
                { visit: "Visit 1", addOns: "Paint Sealant + Leather Deep Clean + Leather Condition" },
                { visit: "Visit 5", addOns: "Leather Deep Clean" },
                { visit: "Visit 7", addOns: "Paint Sealant + Leather Condition" },
                { visit: "Visit 9", addOns: "Leather Deep Clean" },
              ].map(({ visit, addOns }) => (
                <View key={visit} style={{ flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" }}>
                  <Text style={{ fontWeight: "700", color: "#0057FF", width: 70, fontSize: 13 }}>{visit}</Text>
                  <Text style={{ flex: 1, color: "#1F2937", fontSize: 13 }}>{addOns}</Text>
                </View>
              ))}
              <Text style={{ color: "#6B7280", fontSize: 12, marginTop: 10 }}>
                * Shampoo added manually as needed by your detailer.
              </Text>
            </View>
          </View>
        )}

        {/* My Upcoming Appointments + Reschedule */}
        {authToken && (
          <MyScheduleSection token={authToken} city={contract?.city ?? ""} />
        )}

        {/* ── Request Flex Pass (VIP Elite only) ──────────────────── */}
        {(contract as any)?.program_type === 'vip_elite' && contract?.status === 'active' && (
          <View style={{ paddingHorizontal: 16, marginTop: 24 }}>
            <TouchableOpacity
              onPress={() => {
                setFlexDate("");
                setFlexTime("");
                setFlexCity(contract.city || "");
                setFlexNotes("");
                setFlexSent(false);
                setFlexPassVisible(true);
              }}
              activeOpacity={0.85}
              style={{
                backgroundColor: "#D97706",
                borderRadius: 14,
                paddingVertical: 16,
                paddingHorizontal: 20,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                shadowColor: "#D97706",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 8,
                elevation: 4,
              }}
            >
              <MaterialIcons name="flash-on" size={22} color="#fff" />
              <View>
                <Text style={{ color: "#fff", fontSize: 16, fontWeight: "800" }}>Request Flex Pass</Text>
                <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2 }}>Priority scheduling — pick any date & time</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Contact */}
        <View style={{ paddingHorizontal: 16, marginTop: 20, marginBottom: 20, gap: 10 }}>
          <TouchableOpacity
            onPress={() => router.push("/(customer)/messages" as any)}
            style={[s.ctaBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={[s.ctaBtnText, { color: "#fff" }]}>💬 Message Us</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => Linking.openURL("tel:8505177874")}
            style={[s.ctaBtn, { backgroundColor: "#0057FF" }]}
          >
            <Text style={[s.ctaBtnText, { color: "#fff" }]}>📞 Contact Us: 850-517-7874</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ── Live Credit Booking Modal ─────────────────────────────────────── */}
      <Modal
        visible={creditBookingVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCreditBookingVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '88%', paddingBottom: Math.max(insets.bottom + 16, 32) }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginTop: 12, marginBottom: 4 }} />

            {creditBookingStep === 'vehicle' ? (
              // Step 1: Vehicle selection
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24 }} showsVerticalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                  <View>
                    <Text style={{ fontSize: 20, fontWeight: '900', color: '#1A1A1A' }}>
                      {creditBookingType === 'luxury' ? '✨ Book Luxury Detail' : '🛡️ Book Basic Detail'}
                    </Text>
                    <Text style={{ color: '#6B7280', fontSize: 13, marginTop: 2 }}>Step 1 of 3 — Select your vehicle</Text>
                  </View>
                  <TouchableOpacity onPress={() => setCreditBookingVisible(false)} style={{ padding: 8 }}>
                    <MaterialIcons name="close" size={22} color="#6B7280" />
                  </TouchableOpacity>
                </View>
                {vehiclesQuery.isLoading ? (
                  <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                    <ActivityIndicator color="#0057FF" />
                    <Text style={{ color: '#9CA3AF', fontSize: 13, marginTop: 8 }}>Loading your vehicles...</Text>
                  </View>
                ) : (vehiclesQuery.data ?? []).length === 0 ? (
                  <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                    <MaterialIcons name="directions-car" size={48} color="#E5E7EB" />
                    <Text style={{ color: '#374151', fontSize: 15, fontWeight: '700', marginTop: 12 }}>No vehicles saved</Text>
                    <Text style={{ color: '#9CA3AF', fontSize: 13, marginTop: 4, textAlign: 'center' }}>Add a vehicle to your profile first to book a VIP credit appointment.</Text>
                  </View>
                ) : (
                  <View style={{ gap: 10 }}>
                    {(vehiclesQuery.data ?? []).map((v: any) => {
                      const isSelected = creditSelectedVehicle?.vehicleId === v.vehicleId;
                      const label = [v.year, v.make, v.model].filter(Boolean).join(' ');
                      return (
                        <TouchableOpacity
                          key={v.vehicleId}
                          onPress={() => setCreditSelectedVehicle({ vehicleId: v.vehicleId, label, vehicleType: v.vehicleType ?? 'sedan' })}
                          style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isSelected ? '#EFF6FF' : '#F9FAFB', borderRadius: 14, padding: 16, borderWidth: 2, borderColor: isSelected ? '#0057FF' : '#E5E7EB' }}
                        >
                          <MaterialIcons name="directions-car" size={24} color={isSelected ? '#0057FF' : '#9CA3AF'} style={{ marginRight: 12 }} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 15, fontWeight: '700', color: '#1A1A1A' }}>{label || 'Vehicle'}</Text>
                            <Text style={{ fontSize: 12, color: '#6B7280', marginTop: 2, textTransform: 'capitalize' }}>{v.vehicleType}{v.color ? ` · ${v.color}` : ''}</Text>
                          </View>
                          {isSelected && <MaterialIcons name="check-circle" size={22} color="#0057FF" />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
                {creditSelectedVehicle && (
                  <TouchableOpacity
                    onPress={() => setCreditBookingStep('address')}
                    style={{ marginTop: 24, backgroundColor: '#0057FF', borderRadius: 14, paddingVertical: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>Continue</Text>
                    <MaterialIcons name="arrow-forward" size={20} color="#fff" />
                  </TouchableOpacity>
                )}
              </ScrollView>
            ) : creditBookingStep === 'done' ? (
              <View style={{ alignItems: "center", paddingVertical: 40, paddingHorizontal: 24 }}>
                <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: "#22C55E15", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                  <MaterialIcons name="check-circle" size={44} color="#22C55E" />
                </View>
                <Text style={{ fontSize: 22, fontWeight: "900", color: "#1A1A1A", marginBottom: 8 }}>Appointment Booked!</Text>
                <Text style={{ color: "#6B7280", fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 8 }}>
                  Your {creditBookingType === 'luxury' ? 'Luxury Detail' : 'Basic Detail'} appointment has been scheduled.
                </Text>
                {creditSelectedDate && (
                  <Text style={{ color: "#0057FF", fontSize: 16, fontWeight: "700", marginBottom: 4 }}>
                    📅 {creditSelectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                  </Text>
                )}
                {creditSelectedSlot && (
                  <Text style={{ color: "#374151", fontSize: 15, fontWeight: "600", marginBottom: 24 }}>🕐 {creditSelectedSlot}</Text>
                )}
                <TouchableOpacity
                  onPress={() => setCreditBookingVisible(false)}
                  style={{ backgroundColor: "#0057FF", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 40 }}
                >
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Done</Text>
                </TouchableOpacity>
              </View>
            ) : creditBookingStep === 'address' ? (
              // Address selection step
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24 }} showsVerticalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                  <View>
                    <Text style={{ fontSize: 20, fontWeight: '900', color: '#1A1A1A' }}>Service Address</Text>
                    <Text style={{ color: '#6B7280', fontSize: 13, marginTop: 2 }}>Step 2 of 3 — Where should we come to?</Text>
                  </View>
                  <TouchableOpacity onPress={() => setCreditBookingVisible(false)} style={{ padding: 8 }}>
                    <MaterialIcons name="close" size={22} color="#6B7280" />
                  </TouchableOpacity>
                </View>

                {/* Saved addresses */}
                {(addressesQuery.data ?? []).length > 0 && (
                  <View style={{ marginBottom: 20 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Saved Addresses</Text>
                    {(addressesQuery.data ?? []).map((a: any) => {
                      const fullAddr = `${a.street}${a.unit ? ` ${a.unit}` : ''}, ${a.city}, ${a.state} ${a.zip}`;
                      const isSelected = creditAddressMode === 'saved' && creditSelectedAddress === fullAddr;
                      return (
                        <TouchableOpacity
                          key={a.addressId}
                          onPress={() => { setCreditSelectedAddress(fullAddr); setCreditAddressMode('saved'); }}
                          style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: isSelected ? '#EFF6FF' : '#F9FAFB', borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 2, borderColor: isSelected ? '#0057FF' : '#E5E7EB' }}
                        >
                          <MaterialIcons name="location-on" size={22} color={isSelected ? '#0057FF' : '#9CA3AF'} style={{ marginRight: 12 }} />
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 13, fontWeight: '600', color: '#6B7280', marginBottom: 2 }}>{a.label ?? 'Address'}</Text>
                            <Text style={{ fontSize: 15, fontWeight: '700', color: '#1A1A1A' }}>{fullAddr}</Text>
                          </View>
                          {isSelected && <MaterialIcons name="check-circle" size={22} color="#0057FF" />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}

                {/* New address entry */}
                <View style={{ marginBottom: 24 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Use a Different Address</Text>
                  <TextInput
                    value={creditNewAddress}
                    onChangeText={(t) => { setCreditNewAddress(t); if (t.trim()) setCreditAddressMode('new'); }}
                    placeholder="Enter full address (e.g. 123 Main St, Crestview, FL 32539)"
                    placeholderTextColor="#9CA3AF"
                    style={{ backgroundColor: creditAddressMode === 'new' && creditNewAddress.trim() ? '#EFF6FF' : '#F9FAFB', borderRadius: 14, padding: 16, fontSize: 15, color: '#1A1A1A', borderWidth: 2, borderColor: creditAddressMode === 'new' && creditNewAddress.trim() ? '#0057FF' : '#E5E7EB', minHeight: 56 }}
                    multiline
                    returnKeyType="done"
                  />
                </View>

                {/* Navigation buttons */}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity
                    onPress={() => setCreditBookingStep('vehicle')}
                    style={{ flex: 1, borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}
                  >
                    <Text style={{ color: '#6B7280', fontWeight: '700', fontSize: 15 }}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      const addr = creditAddressMode === 'new' ? creditNewAddress.trim() : creditSelectedAddress;
                      if (!addr) { Alert.alert('Select Address', 'Please select or enter a service address.'); return; }
                      // Detect city from address for calendar query
                      const addrLower = addr.toLowerCase();
                      const cityKeywords = [
                        { kws: ['pensacola', 'gulf breeze', 'pace', 'milton', 'navarre', 'cantonment', 'ferry pass'], city: 'pensacola' },
                        { kws: ['destin', 'miramar beach', 'sandestin', 'santa rosa beach', 'inlet beach', 'freeport', 'shalimar'], city: 'destin' },
                        { kws: ['fort walton beach', 'fort walton', 'ftw', 'ft walton', 'wright', 'mary esther', 'hurlburt', 'eglin'], city: 'fwb' },
                        { kws: ['niceville', 'bluewater bay', 'valparaiso'], city: 'niceville' },
                        { kws: ['crestview', 'baker', 'laurel hill', 'holt', 'milligan'], city: 'crestview' },
                      ];
                      let detectedCity = '';
                      for (const { kws, city } of cityKeywords) {
                        if (kws.some(kw => addrLower.includes(kw))) { detectedCity = city; break; }
                      }
                      if (!detectedCity) detectedCity = (contract?.city ?? '').trim();
                      setCreditDetectedCity(detectedCity);
                      setCreditSelectedDate(null);
                      setCreditSelectedSlot(null);
                      setCreditBookingStep('calendar');
                    }}
                    style={{ flex: 2, backgroundColor: '#0057FF', borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>Continue</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            ) : creditBookingStep === 'confirm' ? (
              <View style={{ padding: 24 }}>
                <Text style={{ fontSize: 20, fontWeight: "900", color: "#1A1A1A", marginBottom: 4 }}>Confirm Booking</Text>
                <Text style={{ color: "#6B7280", fontSize: 13, marginBottom: 20 }}>Review your appointment details below.</Text>
                <View style={{ backgroundColor: "#F9FAFB", borderRadius: 16, padding: 18, gap: 12, marginBottom: 24 }}>
                  {creditSelectedVehicle && (
                    <>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <MaterialIcons name="directions-car" size={20} color="#0057FF" />
                        <View>
                          <Text style={{ fontSize: 11, color: "#9CA3AF", fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>Vehicle</Text>
                          <Text style={{ fontSize: 15, fontWeight: "700", color: "#1A1A1A" }}>{creditSelectedVehicle.label}</Text>
                        </View>
                      </View>
                      <View style={{ height: 1, backgroundColor: "#E5E7EB" }} />
                    </>
                  )}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <MaterialIcons name="cleaning-services" size={20} color="#0057FF" />
                    <View>
                      <Text style={{ fontSize: 11, color: "#9CA3AF", fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>Service</Text>
                      <Text style={{ fontSize: 15, fontWeight: "700", color: "#1A1A1A" }}>
                        {creditBookingType === 'luxury' ? '✨ Luxury Detail' : '🛡️ Basic Detail'}
                      </Text>
                    </View>
                  </View>
                  <View style={{ height: 1, backgroundColor: "#E5E7EB" }} />
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <MaterialIcons name="event" size={20} color="#0057FF" />
                    <View>
                      <Text style={{ fontSize: 11, color: "#9CA3AF", fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>Date</Text>
                      <Text style={{ fontSize: 15, fontWeight: "700", color: "#1A1A1A" }}>
                        {creditSelectedDate?.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                      </Text>
                    </View>
                  </View>
                  <View style={{ height: 1, backgroundColor: "#E5E7EB" }} />
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <MaterialIcons name="access-time" size={20} color="#0057FF" />
                    <View>
                      <Text style={{ fontSize: 11, color: "#9CA3AF", fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>Time</Text>
                      <Text style={{ fontSize: 15, fontWeight: "700", color: "#1A1A1A" }}>{creditSelectedSlot}</Text>
                    </View>
                  </View>
                  <View style={{ height: 1, backgroundColor: "#E5E7EB" }} />
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <MaterialIcons name="location-on" size={20} color="#0057FF" />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 11, color: "#9CA3AF", fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>Address</Text>
                      <Text style={{ fontSize: 15, fontWeight: "700", color: "#1A1A1A" }}>
                        {creditAddressMode === 'new' ? creditNewAddress.trim() : creditSelectedAddress}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TouchableOpacity
                    onPress={() => setCreditBookingStep('calendar')}
                    style={{ flex: 1, borderWidth: 1.5, borderColor: "#E5E7EB", borderRadius: 14, paddingVertical: 14, alignItems: "center" }}
                  >
                    <Text style={{ color: "#6B7280", fontWeight: "700", fontSize: 15 }}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleCreditBookingConfirm}
                    disabled={creditBookingLoading}
                    style={{ flex: 2, backgroundColor: creditBookingLoading ? "#93C5FD" : "#0057FF", borderRadius: 14, paddingVertical: 14, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}
                  >
                    {creditBookingLoading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <MaterialIcons name="confirmation-number" size={18} color="#fff" />
                        <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>Confirm Booking</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              // Calendar step
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <View>
                    <Text style={{ fontSize: 20, fontWeight: "900", color: "#1A1A1A" }}>
                      {creditBookingType === 'luxury' ? '✨ Book Luxury Detail' : '🛡️ Book Basic Detail'}
                    </Text>
                    <Text style={{ color: "#6B7280", fontSize: 13, marginTop: 2 }}>Step 3 of 3 — Select a date and time</Text>
                  </View>
                  <TouchableOpacity onPress={() => setCreditBookingVisible(false)} style={{ padding: 8 }}>
                    <MaterialIcons name="close" size={22} color="#6B7280" />
                  </TouchableOpacity>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <TouchableOpacity
                    onPress={() => setCreditCalMonth(m => { const d = new Date(m.year, m.month - 1, 1); return { year: d.getFullYear(), month: d.getMonth() }; })}
                    style={{ padding: 8 }}
                  >
                    <MaterialIcons name="chevron-left" size={24} color="#374151" />
                  </TouchableOpacity>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: "#1A1A1A" }}>
                    {new Date(creditCalMonth.year, creditCalMonth.month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setCreditCalMonth(m => { const d = new Date(m.year, m.month + 1, 1); return { year: d.getFullYear(), month: d.getMonth() }; })}
                    style={{ padding: 8 }}
                  >
                    <MaterialIcons name="chevron-right" size={24} color="#374151" />
                  </TouchableOpacity>
                </View>
                <View style={{ flexDirection: "row", marginBottom: 4 }}>
                  {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                    <Text key={d} style={{ flex: 1, textAlign: "center", fontSize: 11, fontWeight: "700", color: "#9CA3AF" }}>{d}</Text>
                  ))}
                </View>
                {creditDatesLoading ? (
                  <View style={{ alignItems: "center", paddingVertical: 24 }}>
                    <ActivityIndicator color="#0057FF" />
                    <Text style={{ color: "#9CA3AF", fontSize: 13, marginTop: 8 }}>Loading available dates...</Text>
                  </View>
                ) : (
                  creditMonthGrid.map((week, wi) => (
                    <View key={wi} style={{ flexDirection: "row", marginBottom: 4 }}>
                      {week.map((day, di) => {
                        if (!day) return <View key={di} style={{ flex: 1 }} />;
                        const dateKey = fmtDateKey(day);
                        const isAvail = creditAvailDateSet.has(dateKey);
                        const isSelected = creditSelectedDate ? fmtDateKey(creditSelectedDate) === dateKey : false;
                        const isPast = day < new Date(new Date().setHours(0,0,0,0));
                        return (
                          <TouchableOpacity
                            key={di}
                            onPress={() => { if (!isAvail || isPast) return; setCreditSelectedDate(day); setCreditSelectedSlot(null); }}
                            style={{
                              flex: 1, aspectRatio: 1, margin: 2, borderRadius: 8,
                              alignItems: "center", justifyContent: "center",
                              backgroundColor: isSelected ? "#0057FF" : isAvail && !isPast ? "#EFF6FF" : "transparent",
                              opacity: isPast || (!isAvail && !isPast) ? 0.3 : 1,
                            }}
                            activeOpacity={isAvail && !isPast ? 0.7 : 1}
                          >
                            <Text style={{ fontSize: 13, fontWeight: isSelected ? "800" : "500", color: isSelected ? "#fff" : isAvail && !isPast ? "#0057FF" : "#374151" }}>
                              {day.getDate()}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ))
                )}
                {creditSelectedDate && (
                  <View style={{ marginTop: 20 }}>
                    <Text style={{ fontSize: 15, fontWeight: "800", color: "#1A1A1A", marginBottom: 12 }}>
                      Available Times — {creditSelectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                    </Text>
                    {creditSlotsLoading ? (
                      <View style={{ alignItems: "center", paddingVertical: 16 }}>
                        <ActivityIndicator color="#0057FF" />
                      </View>
                    ) : !creditSlots || creditSlots.length === 0 ? (
                      <Text style={{ color: "#9CA3AF", fontSize: 13, textAlign: "center", paddingVertical: 12 }}>No available slots for this date. Please choose another day.</Text>
                    ) : (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                        {(creditSlots as any[]).map((slot: any) => { const slotLabel = typeof slot === 'string' ? slot : slot?.label ?? String(slot); return (
                          <TouchableOpacity
                            key={slotLabel}
                            onPress={() => setCreditSelectedSlot(slotLabel)}
                            style={{
                              paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10,
                              borderWidth: 1.5,
                              borderColor: creditSelectedSlot === slotLabel ? "#0057FF" : "#E5E7EB",
                              backgroundColor: creditSelectedSlot === slotLabel ? "#EFF6FF" : "#fff",
                            }}
                          >
                            <Text style={{ fontSize: 14, fontWeight: "700", color: creditSelectedSlot === slotLabel ? "#0057FF" : "#374151" }}>{slotLabel}</Text>
                          </TouchableOpacity>
                        ); })}
                      </View>
                    )}
                  </View>
                )}
                {creditSelectedDate && creditSelectedSlot && (
                  <TouchableOpacity
                    onPress={() => {
                      setCreditBookingStep('confirm');
                    }}
                    style={{ marginTop: 24, backgroundColor: "#0057FF", borderRadius: 14, paddingVertical: 16, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}
                  >
                    <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Continue to Confirm</Text>
                    <MaterialIcons name="arrow-forward" size={20} color="#fff" />
                  </TouchableOpacity>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

            {/* ── Flex Pass Request Modal ──────────────────────────────────── */}
      <Modal
        visible={flexPassVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFlexPassVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '88%', paddingBottom: Math.max(insets.bottom + 16, 32) }}>
            {/* Handle bar */}
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: "#E5E7EB", alignSelf: "center", marginBottom: 20 }} />

            {flexSent ? (
              <View style={{ alignItems: "center", paddingVertical: 40, paddingHorizontal: 24 }}>
                <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: "#D9770615", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
                  <MaterialIcons name="flash-on" size={44} color="#D97706" />
                </View>
                <Text style={{ fontSize: 22, fontWeight: "900", color: "#1A1A1A", marginBottom: 8 }}>Flex Pass Requested!</Text>
                <Text style={{ color: "#6B7280", fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 8 }}>
                  Our team has received your priority scheduling request. As a VIP Elite member, you get priority access — we'll confirm your slot shortly.
                </Text>
                {flexSelectedDate && (
                  <Text style={{ color: "#D97706", fontSize: 16, fontWeight: "700", marginBottom: 4 }}>
                    📅 {flexSelectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                  </Text>
                )}
                {flexSelectedSlot && (
                  <Text style={{ color: "#374151", fontSize: 15, fontWeight: "600", marginBottom: 24 }}>🕐 {flexSelectedSlot}</Text>
                )}
                <TouchableOpacity
                  onPress={() => setFlexPassVisible(false)}
                  style={{ backgroundColor: "#D97706", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 40 }}
                >
                  <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Done</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}>
                {/* Header */}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                  <View>
                    <Text style={{ fontSize: 20, fontWeight: "900", color: "#1A1A1A" }}>⚡ Flex Pass</Text>
                    <Text style={{ color: "#6B7280", fontSize: 13, marginTop: 2 }}>VIP Priority Scheduling — pick your date & time</Text>
                  </View>
                  <TouchableOpacity onPress={() => setFlexPassVisible(false)} style={{ padding: 8 }}>
                    <MaterialIcons name="close" size={22} color="#6B7280" />
                  </TouchableOpacity>
                </View>

                {/* Month navigator */}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <TouchableOpacity
                    onPress={() => setFlexCalMonth(m => { const d = new Date(m.year, m.month - 1, 1); return { year: d.getFullYear(), month: d.getMonth() }; })}
                    style={{ padding: 8 }}
                  >
                    <MaterialIcons name="chevron-left" size={24} color="#374151" />
                  </TouchableOpacity>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: "#1A1A1A" }}>
                    {new Date(flexCalMonth.year, flexCalMonth.month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </Text>
                  <TouchableOpacity
                    onPress={() => setFlexCalMonth(m => { const d = new Date(m.year, m.month + 1, 1); return { year: d.getFullYear(), month: d.getMonth() }; })}
                    style={{ padding: 8 }}
                  >
                    <MaterialIcons name="chevron-right" size={24} color="#374151" />
                  </TouchableOpacity>
                </View>

                {/* Day headers */}
                <View style={{ flexDirection: "row", marginBottom: 4 }}>
                  {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                    <Text key={d} style={{ flex: 1, textAlign: "center", fontSize: 11, fontWeight: "700", color: "#9CA3AF" }}>{d}</Text>
                  ))}
                </View>

                {/* Calendar grid */}
                {flexDatesLoading ? (
                  <View style={{ alignItems: "center", paddingVertical: 24 }}>
                    <ActivityIndicator color="#D97706" />
                    <Text style={{ color: "#9CA3AF", fontSize: 13, marginTop: 8 }}>Loading available dates...</Text>
                  </View>
                ) : (
                  flexMonthGrid.map((week, wi) => (
                    <View key={wi} style={{ flexDirection: "row", marginBottom: 4 }}>
                      {week.map((day, di) => {
                        if (!day) return <View key={di} style={{ flex: 1 }} />;
                        const dk = fmtDateKey(day);
                        const isAvail = flexAvailDateSet.has(dk);
                        const isSelected = flexSelectedDate ? fmtDateKey(flexSelectedDate) === dk : false;
                        const isPast = day < new Date(new Date().setHours(0,0,0,0));
                        return (
                          <TouchableOpacity
                            key={di}
                            onPress={() => { if (!isAvail || isPast) return; setFlexSelectedDate(day); setFlexSelectedSlot(null); }}
                            style={{
                              flex: 1, aspectRatio: 1, margin: 2, borderRadius: 8,
                              alignItems: "center", justifyContent: "center",
                              backgroundColor: isSelected ? "#D97706" : isAvail && !isPast ? "#FEF3C7" : "transparent",
                              opacity: isPast || (!isAvail && !isPast) ? 0.3 : 1,
                            }}
                            activeOpacity={isAvail && !isPast ? 0.7 : 1}
                          >
                            <Text style={{ fontSize: 13, fontWeight: isSelected ? "800" : "500", color: isSelected ? "#fff" : isAvail && !isPast ? "#D97706" : "#374151" }}>
                              {day.getDate()}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ))
                )}

                {/* Time slots */}
                {flexSelectedDate && (
                  <View style={{ marginTop: 20 }}>
                    <Text style={{ fontSize: 15, fontWeight: "800", color: "#1A1A1A", marginBottom: 12 }}>
                      Available Times — {flexSelectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                    </Text>
                    {flexSlotsLoading ? (
                      <View style={{ alignItems: "center", paddingVertical: 16 }}>
                        <ActivityIndicator color="#D97706" />
                      </View>
                    ) : !flexSlots || flexSlots.length === 0 ? (
                      <Text style={{ color: "#9CA3AF", fontSize: 13, textAlign: "center", paddingVertical: 12 }}>No available slots for this date. Please choose another day.</Text>
                    ) : (
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                        {(flexSlots as any[]).map((slot: any) => { const slotLabel = typeof slot === 'string' ? slot : slot?.label ?? String(slot); return (
                          <TouchableOpacity
                            key={slotLabel}
                            onPress={() => setFlexSelectedSlot(slotLabel)}
                            style={{
                              paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10,
                              borderWidth: 1.5,
                              borderColor: flexSelectedSlot === slotLabel ? "#D97706" : "#E5E7EB",
                              backgroundColor: flexSelectedSlot === slotLabel ? "#FEF3C7" : "#fff",
                            }}
                          >
                            <Text style={{ fontSize: 14, fontWeight: "700", color: flexSelectedSlot === slotLabel ? "#D97706" : "#374151" }}>{slotLabel}</Text>
                          </TouchableOpacity>
                        ); })}
                      </View>
                    )}
                  </View>
                )}

                {/* Submit button — shown once date + slot selected */}
                {flexSelectedDate && flexSelectedSlot && (
                  <TouchableOpacity
                    onPress={() => {
                      setFlexDate(fmtDateKey(flexSelectedDate));
                      setFlexTime(flexSelectedSlot);
                      handleFlexPassRequest();
                    }}
                    disabled={flexLoading}
                    style={{ marginTop: 24, backgroundColor: flexLoading ? "#F6C97A" : "#D97706", borderRadius: 14, paddingVertical: 16, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}
                  >
                    {flexLoading ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <>
                        <MaterialIcons name="flash-on" size={20} color="#fff" />
                        <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>Request This Slot</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* VIP Self-Serve Signup Modal (accessible from contract view too) */}
      <VipSignupModal
        visible={signupModalVisible}
        onClose={() => setSignupModalVisible(false)}
        onSuccess={() => {
          setSignupModalVisible(false);
          loadByCustomer();
        }}
        defaultInfo={{
          firstName: customer?.firstName ?? "",
          lastName: customer?.lastName ?? "",
          email: customer?.email ?? "",
          phone: customer?.phone ?? "",
        }}
        customerKey={customerKey}
      />
    </ScreenContainer>
  );
}

// ─── Detail Row ───────────────────────────────────────────────────────────────
function DetailRow({ label, value }: { label: string; value: string; colors?: any }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" }}>
      <Text style={{ color: "#6B7280", fontSize: 13 }}>{label}</Text>
      <Text style={{ color: "#1F2937", fontSize: 13, fontWeight: "600" }}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
function styles(colors: any) {
  return StyleSheet.create({
    heroHeader: {
      padding: 24,
      paddingTop: 32,
    },
    vipBadge: {
      backgroundColor: "#0057FF",
      alignSelf: "flex-start",
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 20,
      marginBottom: 12,
    },
    vipBadgeText: {
      color: "#fff",
      fontWeight: "800",
      fontSize: 12,
      letterSpacing: 1,
    },
    heroName: {
      color: "#1A1A1A",
      fontSize: 26,
      fontWeight: "800",
    },
    heroVehicle: {
      color: "#6B7280",
      fontSize: 15,
      marginTop: 4,
    },
    heroContract: {
      color: "#9CA3AF",
      fontSize: 13,
      marginTop: 2,
    },
    progressSection: {
      marginTop: 20,
    },
    progressBar: {
      height: 8,
      backgroundColor: "#E5E7EB",
      borderRadius: 4,
      overflow: "hidden",
    },
    progressFill: {
      height: "100%",
      backgroundColor: "#0057FF",
      borderRadius: 4,
    },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 20,
      borderWidth: 1,
    },
    alertBanner: {
      flexDirection: "row",
      alignItems: "center",
      margin: 16,
      marginBottom: 0,
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
      gap: 10,
    },
    thisMonthCard: {
      padding: 20,
    },
    sectionTitle: {
      fontSize: 17,
      fontWeight: "700",
      marginBottom: 12,
    },
    detailCard: {
      borderRadius: 14,
      padding: 16,
      borderWidth: 1,
    },
    visitCard: {
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      marginBottom: 8,
    },
    visitBadge: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    visitMonth: {
      fontSize: 15,
      fontWeight: "700",
    },
    visitTime: {
      fontSize: 13,
      marginTop: 3,
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
    benefitCard: {
      borderRadius: 14,
      padding: 20,
      borderWidth: 1,
      width: "100%",
      marginBottom: 24,
    },
    benefitTitle: {
      fontSize: 16,
      fontWeight: "700",
      marginBottom: 14,
    },
    ctaBtn: {
      paddingVertical: 16,
      paddingHorizontal: 24,
      borderRadius: 14,
      alignItems: "center",
    },
    ctaBtnText: {
      fontSize: 16,
      fontWeight: "700",
    },
    heroTitle: {
      fontSize: 28,
      fontWeight: "800",
      marginBottom: 12,
    },
    heroSub: {
      fontSize: 15,
      lineHeight: 22,
    },
    tokenInput: {
      width: "100%",
      borderRadius: 12,
      borderWidth: 1,
      padding: 14,
      marginBottom: 12,
    },
    tokenInputPlaceholder: {
      fontSize: 14,
    },
  });
}
