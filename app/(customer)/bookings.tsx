import { useRef, useState, useEffect, useMemo } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, Modal, Platform, Animated,
} from "react-native";
import { useRouter } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { useCustomerAuth } from "@/lib/customer-context";
import { trpc } from "@/lib/trpc";
import { MaterialIcons } from "@expo/vector-icons";
import { CustomerMessageBanner } from "@/components/customer-message-banner";

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending:     { label: "Pending",     color: "#D97706", bg: "#FEF3C7" },
  confirmed:   { label: "Confirmed",   color: "#059669", bg: "#D1FAE5" },
  en_route:    { label: "On the Way",  color: "#2563EB", bg: "#DBEAFE" },
  arrived:     { label: "Arrived",     color: "#7C3AED", bg: "#EDE9FE" },
  in_progress: { label: "In Progress", color: "#0891B2", bg: "#CFFAFE" },
  completed:   { label: "Completed",   color: "#059669", bg: "#D1FAE5" },
  cancelled:   { label: "Cancelled",   color: "#9CA3AF", bg: "#F3F4F6" },
};

const SOURCE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  portal:   { label: "Portal",   color: "#1D4ED8", bg: "#DBEAFE" },
  schedule: { label: "Admin",    color: "#6D28D9", bg: "#EDE9FE" },
  online:   { label: "Online",   color: "#065F46", bg: "#D1FAE5" },
  vip_credit: { label: "VIP Credit", color: "#92400E", bg: "#FEF3C7" },
};

// Time slots per package (mirrors server logic)
const PACKAGE_SLOTS: Record<string, { label: string; startHour: number; endHour: number }[]> = {
  basic_detail:    [
    { label: "8:00 AM – 10:00 AM", startHour: 8,  endHour: 10 },
    { label: "10:00 AM – 12:00 PM", startHour: 10, endHour: 12 },
    { label: "1:00 PM – 3:00 PM",  startHour: 13, endHour: 15 },
    { label: "3:00 PM – 5:00 PM",  startHour: 15, endHour: 17 },
  ],
  interior_detail: [
    { label: "8:00 AM – 10:00 AM", startHour: 8,  endHour: 10 },
    { label: "10:00 AM – 12:00 PM", startHour: 10, endHour: 12 },
    { label: "1:00 PM – 3:00 PM",  startHour: 13, endHour: 15 },
    { label: "3:00 PM – 5:00 PM",  startHour: 15, endHour: 17 },
  ],
  exterior_detail: [
    { label: "8:00 AM – 10:00 AM", startHour: 8,  endHour: 10 },
    { label: "10:00 AM – 12:00 PM", startHour: 10, endHour: 12 },
    { label: "1:00 PM – 3:00 PM",  startHour: 13, endHour: 15 },
    { label: "3:00 PM – 5:00 PM",  startHour: 15, endHour: 17 },
  ],
  full_detail: [
    { label: "8:00 AM – 11:00 AM", startHour: 8,  endHour: 11 },
    { label: "11:00 AM – 2:00 PM", startHour: 11, endHour: 14 },
    { label: "2:00 PM – 5:00 PM",  startHour: 14, endHour: 17 },
  ],
  luxury_detail: [
    { label: "8:00 AM – 12:00 PM", startHour: 8,  endHour: 12 },
    { label: "1:00 PM – 5:00 PM",  startHour: 13, endHour: 17 },
  ],
};

function hoursUntil(dateStr: string, timeStr: string): number {
  const parseHour = (t: string) => {
    const m = t.trim().match(/(\d+)(?::\d+)?\s*(AM|PM)/i);
    if (!m) return 8;
    let h = parseInt(m[1], 10);
    if (m[2].toUpperCase() === "PM" && h !== 12) h += 12;
    if (m[2].toUpperCase() === "AM" && h === 12) h = 0;
    return h;
  };
  const startPart = timeStr.split(/[–\-]/)[0] ?? timeStr;
  const startHour = parseHour(startPart);
  const appt = new Date(`${dateStr}T${String(startHour).padStart(2, "0")}:00:00`);
  return (appt.getTime() - Date.now()) / 3600000;
}

export default function CustomerBookingsScreen() {
  const router = useRouter();
  const { token, customer } = useCustomerAuth();
  const utils = trpc.useUtils();

  // ── Charge Card on File state ──
  const [showPayModal, setShowPayModal] = useState(false);
  const [payJobId, setPayJobId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payingCard, setPayingCard] = useState(false);
  const [selectedPayCardId, setSelectedPayCardId] = useState<string | null>(null);
  // Build customerKey from logged-in customer
  const portalCustomerKey = customer
    ? (() => {
        const np = customer.phone ? customer.phone.replace(/\D/g, "").slice(-10) : null;
        if (np && np.length === 10) return `phone:${np}`;
        if (customer.email) return `email:${customer.email.toLowerCase()}`;
        return `name:${(customer.firstName + " " + customer.lastName).toLowerCase().trim()}`;
      })()
    : "";
  const { data: portalSavedCards } = trpc.savedCards.list.useQuery(
    { customerKey: portalCustomerKey },
    { enabled: !!portalCustomerKey && showPayModal }
  );
  const portalChargeCardMutation = trpc.savedCards.chargeCard.useMutation({
    onSuccess: (data) => {
      setPayingCard(false);
      setShowPayModal(false);
      setPayAmount("");
      setPayJobId(null);
      utils.customer.allJobs.invalidate();
      Alert.alert("✅ Payment Successful", `Your card has been charged $${parseFloat(payAmount).toFixed(2)}.\n\nPayment ID: ${data.paymentIntentId?.slice(-8) ?? "—"}`);
    },
    onError: (e) => { setPayingCard(false); Alert.alert("Payment Failed", e.message); },
  });

  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  // bookingRef is set for portal/online jobs; scheduleJobId is set for admin-scheduled jobs
  const [rescheduleItem, setRescheduleItem] = useState<{ bookingRef?: string; scheduleJobId?: string; packageId: string; city: string } | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedSlot, setSelectedSlot] = useState("");

  // Real availability queries — same as VIP reschedule
  const rescheduleCity = rescheduleItem?.city ?? "";
  const { data: availableDatesData, isLoading: datesLoading } = trpc.employee.getAvailableDates.useQuery(
    { city: rescheduleCity, daysAhead: 60 },
    { enabled: !!rescheduleItem && !!rescheduleCity, staleTime: 5 * 60 * 1000 }
  );
  const availableDateSet = useMemo(() => new Set(availableDatesData ?? []), [availableDatesData]);

  const { data: availableSlots, isLoading: slotsLoading } = trpc.employee.getAvailableSlots.useQuery(
    { date: selectedDate, city: rescheduleCity, packageName: rescheduleItem?.packageId ?? "Basic Detail" },
    { enabled: !!rescheduleItem && !!selectedDate && !!rescheduleCity }
  );
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const jobsQuery = trpc.customer.allJobs.useQuery(
    { token: token ?? "" },
    { enabled: !!token }
  );

  // Poll for active tracking (detailer on the way)
  const { data: activeTracking } = trpc.customer.activeTracking.useQuery(
    { token: token ?? "" },
    { enabled: !!token, refetchInterval: 60000 }
  );
  // Pulse animation for tracking banner
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!activeTracking) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.03, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [activeTracking]);
  const cancelMutation = trpc.customer.cancelBooking.useMutation({
    onSuccess: () => { utils.customer.allJobs.invalidate(); utils.customer.listBookings.invalidate(); },
  });
  const cancelScheduleJobMutation = trpc.customer.cancelScheduleJob.useMutation({
    onSuccess: () => { utils.customer.allJobs.invalidate(); utils.customer.listBookings.invalidate(); },
  });

  const rescheduleMutation = trpc.customer.rescheduleBooking.useMutation({
    onSuccess: () => {
      utils.customer.allJobs.invalidate();
      utils.customer.listBookings.invalidate();
      setRescheduleItem(null);
      setSelectedDate("");
      setSelectedSlot("");
      Alert.alert("Rescheduled", "Your appointment has been rescheduled successfully.");
    },
    onError: (err) => Alert.alert("Error", err.message),
  });
  const rescheduleScheduleJobMutation = trpc.customer.rescheduleScheduleJob.useMutation({
    onSuccess: () => {
      utils.customer.allJobs.invalidate();
      utils.customer.listBookings.invalidate();
      setRescheduleItem(null);
      setSelectedDate("");
      setSelectedSlot("");
      Alert.alert("Rescheduled", "Your appointment has been rescheduled successfully.");
    },
    onError: (err) => Alert.alert("Error", err.message),
  });

  const jobs = jobsQuery.data ?? [];
  const now = new Date().toISOString().split("T")[0];

  const upcoming = jobs
    .filter(j => j.date >= now && j.status !== "completed" && j.status !== "cancelled" && j.status !== "abandoned" && j.status !== "closed")
    .sort((a, b) => a.date.localeCompare(b.date)); // soonest first
  const past = jobs
    .filter(j => (j.date < now || j.status === "completed" || j.status === "cancelled") && j.status !== "abandoned" && j.status !== "closed")
    .sort((a, b) => b.date.localeCompare(a.date)); // most recent first

  const displayed = tab === "upcoming" ? upcoming : past;

  const handleCancel = (item: { bookingRef?: string; scheduleJobId?: string }, dateStr: string, timeStr: string) => {
    const hours = hoursUntil(dateStr, timeStr);
    if (hours < 24) {
      Alert.alert(
        "Cannot Cancel",
        "Cancellations must be made at least 24 hours before your appointment. Please contact us directly for assistance.",
        [{ text: "OK" }]
      );
      return;
    }
    const loadingKey = (item as any).bookingRef ?? item.scheduleJobId ?? "";
    Alert.alert(
      "Cancel Booking",
      "Are you sure you want to cancel this appointment? This cannot be undone.",
      [
        { text: "Keep Appointment", style: "cancel" },
        {
          text: "Cancel Booking",
          style: "destructive",
          onPress: async () => {
            setActionLoading(loadingKey);
            try {
              if ((item as any).bookingRef) {
                await cancelMutation.mutateAsync({ token: token ?? "", bookingRef: (item as any).bookingRef });
              } else if (item.scheduleJobId) {
                await cancelScheduleJobMutation.mutateAsync({ token: token ?? "", jobId: item.scheduleJobId });
              }
              Alert.alert("Cancelled", "Your appointment has been cancelled.");
            } catch (e: any) {
              Alert.alert("Error", e.message ?? "Failed to cancel appointment.");
            } finally {
              setActionLoading(null);
            }
          },
        },
      ]
    );
  };

  const handleReschedule = (item: { bookingRef?: string; scheduleJobId?: string; packageId: string; city: string; date: string; time: string }) => {
    const hours = hoursUntil(item.date, item.time);
    if (hours < 24) {
      Alert.alert(
        "Cannot Reschedule",
        "Reschedules must be made at least 24 hours before your appointment. Please contact us directly for assistance.",
        [{ text: "OK" }]
      );
      return;
    }
    setRescheduleItem({ bookingRef: (item as any).bookingRef, scheduleJobId: item.scheduleJobId, packageId: (item as any).packageId, city: item.city });
    setSelectedDate("");
    setSelectedSlot("");
  };

  const isReschedulePending = rescheduleMutation.isPending || rescheduleScheduleJobMutation.isPending;

  const confirmReschedule = async () => {
    if (!rescheduleItem || !selectedDate || !selectedSlot) {
      Alert.alert("Select Date & Time", "Please select a new date and time slot.");
      return;
    }
    if (rescheduleItem.bookingRef) {
      await rescheduleMutation.mutateAsync({
        token: token ?? "",
        bookingRef: rescheduleItem.bookingRef,
        newDate: selectedDate,
        newTime: selectedSlot,
      });
    } else if (rescheduleItem.scheduleJobId) {
      await rescheduleScheduleJobMutation.mutateAsync({
        token: token ?? "",
        jobId: rescheduleItem.scheduleJobId,
        newDate: selectedDate,
        newTime: selectedSlot,
      });
    }
  };

  // Generate next 60 days, filtered to only available dates once loaded
  const allDateOptions: { label: string; value: string }[] = [];
  for (let i = 1; i <= 60; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const value = d.toISOString().split("T")[0];
    const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    allDateOptions.push({ label, value });
  }
  // Only show dates that have availability (once loaded); show all while loading
  const dateOptions = useMemo(() => {
    if (datesLoading || !availableDatesData || availableDatesData.length === 0) return allDateOptions;
    return allDateOptions.filter(d => availableDateSet.has(d.value));
  }, [allDateOptions, availableDateSet, datesLoading, availableDatesData]);

  return (
    <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-white">
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Jobs</Text>
        <TouchableOpacity
          style={styles.newBookingBtn}
          onPress={() => router.push("/(customer)/book/vehicle" as any)}
          activeOpacity={0.85}
        >
          <MaterialIcons name="add" size={18} color="#FFFFFF" />
          <Text style={styles.newBookingText}>New</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === "upcoming" && styles.tabActive]}
          onPress={() => setTab("upcoming")}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, tab === "upcoming" && styles.tabTextActive]}>
            Upcoming{upcoming.length > 0 ? ` (${upcoming.length})` : ""}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === "past" && styles.tabActive]}
          onPress={() => setTab("past")}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, tab === "past" && styles.tabTextActive]}>
            History{past.length > 0 ? ` (${past.length})` : ""}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Customer Message Banner */}
      <CustomerMessageBanner />

      {/* ── Live Tracking Banner ─────────────────────────────── */}
      {activeTracking && (
        <Animated.View style={{ transform: [{ scale: pulseAnim }], marginHorizontal: 16, marginTop: 8, marginBottom: 4 }}>
          <TouchableOpacity
            activeOpacity={0.88}
            onPress={() => router.push(`/(customer)/track/${activeTracking.jobId}` as any)}
            style={{
              backgroundColor: "#0057FF",
              borderRadius: 14,
              padding: 14,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              shadowColor: "#0057FF",
              shadowOffset: { width: 0, height: 3 },
              shadowOpacity: 0.4,
              shadowRadius: 10,
              elevation: 6,
            }}
          >
            <MaterialIcons name="local-shipping" size={22} color="#FFFFFF" />
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#FFFFFF", fontSize: 14, fontWeight: "700" }}>
                🚚 {activeTracking.detailerName} is on the way!
              </Text>
              <Text style={{ color: "rgba(255,255,255,0.85)", fontSize: 12, marginTop: 2 }}>
                Tap to see live location on map
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color="rgba(255,255,255,0.8)" />
          </TouchableOpacity>
        </Animated.View>
      )}
      {/* Content */}
      {jobsQuery.isLoading ? (
        <ActivityIndicator size="large" color="#1A1A1A" style={{ marginTop: 60 }} />
      ) : displayed.length === 0 ? (
        <View style={styles.empty}>
          <MaterialIcons name="calendar-today" size={48} color="#E5E7EB" />
          <Text style={styles.emptyTitle}>
            {tab === "upcoming" ? "No upcoming jobs" : "No past jobs"}
          </Text>
          {tab === "upcoming" && (
            <TouchableOpacity
              style={styles.bookNowBtn}
              onPress={() => router.push("/(customer)/book/vehicle" as any)}
              activeOpacity={0.85}
            >
              <Text style={styles.bookNowText}>Book a Detail</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 100 }}>
          {displayed.map((item) => {
            const status = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.pending;
            const source = SOURCE_CONFIG[item.source] ?? SOURCE_CONFIG.portal;
            const addons: string[] = Array.isArray(item.addons) ? item.addons : [];
            const { month, day, year, time } = parseDate(item.date, item.time);
            const isPortalBooking = !!(item as any).bookingRef;
            // canModify: available for ALL upcoming jobs (portal, admin-scheduled, online)
            // only locked within 24 hours of appointment
            const canModify =
              item.status !== "cancelled" &&
              item.status !== "completed" &&
              hoursUntil(item.date, item.time ?? "") >= 24;
            const itemKey = (item as any).bookingRef ?? item.id;
            const isActioning = actionLoading === itemKey;

            return (
              <TouchableOpacity
                key={item.id}
                style={styles.card}
                onPress={() => router.push(`/(customer)/job/${item.id}` as any)}
                activeOpacity={0.88}
              >
                {/* Card body: left info + divider + right date */}
                <View style={styles.cardBody}>
                  {/* Left side */}
                  <View style={styles.cardLeft}>
                    {/* Status + source badges */}
                    <View style={styles.badgesRow}>
                      <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
                        <Text style={[styles.statusPillText, { color: status.color }]}>{status.label}</Text>
                      </View>
                      <View style={[styles.sourcePill, { backgroundColor: source.bg }]}>
                        <Text style={[styles.sourcePillText, { color: source.color }]}>{source.label}</Text>
                      </View>
                    </View>

                    {/* Service name */}
                    <Text style={styles.serviceName} numberOfLines={1}>
                      {item.packageName || "Detail Service"}
                    </Text>

                    {/* Vehicle */}
                    <Text style={styles.vehicleText} numberOfLines={1}>
                      {item.vehicleLabel || item.vehicleType || "Vehicle"}
                    </Text>

                    {/* Add-ons */}
                    {addons.length > 0 && (
                      <Text style={styles.addonsText} numberOfLines={1}>
                        +{" "}{addons.slice(0, 2).map((a: string) => typeof a === "string" ? a.replace(/_/g, " ") : a).join(", ")}
                        {addons.length > 2 ? ` & ${addons.length - 2} more` : ""}
                      </Text>
                    )}

                    {/* Location */}
                    {!!item.addressLabel && (
                      <View style={styles.locationRow}>
                        <MaterialIcons name="place" size={12} color="#9CA3AF" />
                        <Text style={styles.locationText} numberOfLines={1}>{item.addressLabel}</Text>
                      </View>
                    )}
                  </View>

                  {/* Vertical divider */}
                  <View style={styles.divider} />

                  {/* Right: big date */}
                  <View style={styles.cardRight}>
                    <Text style={styles.dateMonth} numberOfLines={1} adjustsFontSizeToFit>{month}</Text>
                    <Text style={styles.dateDay}>{day}</Text>
                    <Text style={styles.dateYear}>{year}</Text>
                    {!!time && <Text style={styles.dateTime}>{time}</Text>}
                  </View>
                </View>

                {/* Total row */}
                {item.total > 0 && (
                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Total</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      {!!(item as any).paymentPaidAt ? (
                        <View style={{ backgroundColor: "#22C55E", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                          <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>PAID</Text>
                        </View>
                      ) : (
                        <View style={{ backgroundColor: "#FEE2E2", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 }}>
                          <Text style={{ color: "#EF4444", fontSize: 11, fontWeight: "700" }}>UNPAID</Text>
                        </View>
                      )}
                      <Text style={(item as any).paymentPaidAt ? { color: "#22C55E", fontWeight: "700", fontSize: 16 } : { color: "#EF4444", fontWeight: "700", fontSize: 16 }}>
                        ${Number((item as any).paymentTotal ?? item.total).toFixed(0)}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Pay with Card on File — shown for upcoming unpaid jobs */}
                {tab === "upcoming" && item.status !== "cancelled" && item.status !== "completed" && !(item as any).paymentPaidAt && item.total > 0 && (
                  <TouchableOpacity
                    style={styles.payCardBtn}
                    onPress={(e) => {
                      e.stopPropagation?.();
                      setPayJobId(item.id);
                      setPayAmount(Number((item as any).paymentTotal ?? item.total).toFixed(2));
                      const cards = (portalSavedCards as any[]) ?? [];
                      const defaultCard = cards.find((c: any) => c.isDefault) ?? cards[0];
                      setSelectedPayCardId(defaultCard?.stripePaymentMethodId ?? null);
                      setShowPayModal(true);
                    }}
                    activeOpacity={0.85}
                  >
                    <MaterialIcons name="credit-card" size={16} color="#22C55E" />
                    <Text style={styles.payCardBtnText}>Pay with Card on File</Text>
                  </TouchableOpacity>
                )}

                {/* Cancel / Reschedule actions — shown for ALL upcoming jobs */}
                {tab === "upcoming" && item.status !== "cancelled" && item.status !== "completed" && (
                  <View style={styles.actionsRow}>
                    {isActioning ? (
                      <ActivityIndicator size="small" color="#6B7280" />
                    ) : (
                      <>
                        <TouchableOpacity
                          style={[styles.actionBtn, styles.rescheduleBtn, !canModify && styles.actionBtnDisabled]}
                          onPress={(e) => {
                            e.stopPropagation?.();
                            handleReschedule({
                              bookingRef: (item as any).bookingRef ?? undefined,
                              scheduleJobId: !(item as any).bookingRef ? item.id : undefined,
                              packageId: (item as any).packageId ?? "basic_detail",
                              city: item.city ?? "",
                              date: item.date,
                              time: item.time ?? "",
                            });
                          }}
                          activeOpacity={canModify ? 0.8 : 1}
                        >
                          <MaterialIcons name="schedule" size={14} color={canModify ? "#0a7ea4" : "#9CA3AF"} />
                          <Text style={[styles.actionBtnText, { color: canModify ? "#0a7ea4" : "#9CA3AF" }]}>Reschedule</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.actionBtn, styles.cancelBtn, !canModify && styles.actionBtnDisabled]}
                          onPress={(e) => {
                            e.stopPropagation?.();
                            handleCancel(
                              { bookingRef: (item as any).bookingRef ?? undefined, scheduleJobId: !(item as any).bookingRef ? item.id : undefined },
                              item.date,
                              item.time ?? ""
                            );
                          }}
                          activeOpacity={canModify ? 0.8 : 1}
                        >
                          <MaterialIcons name="cancel" size={14} color={canModify ? "#EF4444" : "#9CA3AF"} />
                          <Text style={[styles.actionBtnText, { color: canModify ? "#EF4444" : "#9CA3AF" }]}>Cancel</Text>
                        </TouchableOpacity>
                      </>
                    )}
                    {!canModify && (
                      <Text style={styles.cutoffNote}>Changes locked within 24 hrs of appointment</Text>
                    )}
                  </View>
                )}

                {/* Tap for full details hint */}
                <View style={styles.tapHintRow}>
                  <Text style={styles.tapHintText}>Tap for full details</Text>
                  <MaterialIcons name="chevron-right" size={14} color="#9CA3AF" />
                </View>

                {/* Track button — shown when en_route OR when this job matches the active tracking token */}
                {(item.status === "en_route" || (activeTracking && (activeTracking.jobId === item.id || activeTracking.bookingRef === (item as any).bookingRef))) && (
                  <TouchableOpacity
                    style={styles.trackBtn}
                    onPress={(e) => {
                      e.stopPropagation?.();
                      const trackId = (item as any).bookingRef ?? item.id;
                      router.push(`/(customer)/track/${trackId}` as any);
                    }}
                    activeOpacity={0.85}
                  >
                    <MaterialIcons name="my-location" size={15} color="#2563EB" />
                    <Text style={styles.trackBtnText}>🚚 Track Your Detailer</Text>
                  </TouchableOpacity>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Reschedule Modal */}
      <Modal visible={!!rescheduleItem} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Reschedule Appointment</Text>
              <TouchableOpacity onPress={() => setRescheduleItem(null)} style={{ padding: 4 }}>
                <MaterialIcons name="close" size={22} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {/* City availability label */}
            {rescheduleCity ? (
              <Text style={{ fontSize: 13, color: "#6B7280", marginBottom: 12 }}>
                Showing availability for{" "}
                <Text style={{ fontWeight: "700", color: "#111827" }}>{rescheduleCity}</Text>
              </Text>
            ) : null}

            <Text style={styles.modalLabel}>Select a new date</Text>
            {datesLoading ? (
              <View style={{ alignItems: "center", paddingVertical: 16 }}>
                <ActivityIndicator size="small" color="#0a7ea4" />
                <Text style={{ color: "#6B7280", fontSize: 13, marginTop: 6 }}>Loading availability…</Text>
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 4 }}>
                  {dateOptions.length === 0 ? (
                    <Text style={{ color: "#6B7280", fontSize: 13, paddingVertical: 8 }}>No available dates in the next 60 days.</Text>
                  ) : dateOptions.map((d) => (
                    <TouchableOpacity
                      key={d.value}
                      style={[styles.dateChip, selectedDate === d.value && styles.dateChipActive]}
                      onPress={() => { setSelectedDate(d.value); setSelectedSlot(""); }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.dateChipText, selectedDate === d.value && styles.dateChipTextActive]}>
                        {d.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            )}

            {selectedDate && (
              <>
                <Text style={styles.modalLabel}>Select a time slot</Text>
                {slotsLoading ? (
                  <View style={{ alignItems: "center", paddingVertical: 12 }}>
                    <ActivityIndicator size="small" color="#0a7ea4" />
                    <Text style={{ color: "#6B7280", fontSize: 13, marginTop: 6 }}>Checking availability…</Text>
                  </View>
                ) : (
                  <View style={{ gap: 8, marginBottom: 20 }}>
                    {(availableSlots ?? []).filter((s: any) => s.available !== false).length === 0 ? (
                      <Text style={{ color: "#6B7280", fontSize: 13, paddingVertical: 8 }}>No availability on this date.</Text>
                    ) : (availableSlots ?? []).filter((s: any) => s.available !== false).map((s: any) => {
                      const isSelected = selectedSlot === s.label;
                      return (
                        <TouchableOpacity
                          key={s.label}
                          style={[
                            styles.slotBtn,
                            isSelected && styles.slotBtnActive,
                          ]}
                          onPress={() => setSelectedSlot(s.label)}
                          activeOpacity={0.8}
                        >
                          <MaterialIcons
                            name="access-time"
                            size={16}
                            color={isSelected ? "#FFFFFF" : "#374151"}
                          />
                          <Text style={[styles.slotBtnText, isSelected && styles.slotBtnTextActive]}>
                            {s.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </>
            )}

            <TouchableOpacity
              style={[styles.confirmBtn, (!selectedDate || !selectedSlot) && styles.confirmBtnDisabled]}
              onPress={confirmReschedule}
              activeOpacity={0.85}
              disabled={!selectedDate || !selectedSlot || isReschedulePending}
            >
              {isReschedulePending ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.confirmBtnText}>Confirm Reschedule</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ─── Pay with Card on File Modal ────────────────────────────────────────────────────────────────────────────────── */}
      <Modal
        visible={showPayModal}
        transparent
        animationType="slide"
        onRequestClose={() => { if (!payingCard) setShowPayModal(false); }}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: "#FFFFFF", borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 44 }}>
            <View style={{ width: 40, height: 4, backgroundColor: "#E5E7EB", borderRadius: 2, alignSelf: "center", marginBottom: 20 }} />
            <Text style={{ fontSize: 20, fontWeight: "800", color: "#1A1A1A", marginBottom: 4 }}>💳 Pay with Card on File</Text>
            <Text style={{ fontSize: 13, color: "#6B7280", marginBottom: 20 }}>Securely charge your saved card</Text>

            {/* Card selector */}
            {((portalSavedCards as any[]) ?? []).length > 1 && (
              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontSize: 12, fontWeight: "700", color: "#9CA3AF", letterSpacing: 0.5, marginBottom: 8 }}>SELECT CARD</Text>
                {((portalSavedCards as any[]) ?? []).map((card: any) => (
                  <TouchableOpacity
                    key={card.stripePaymentMethodId}
                    onPress={() => setSelectedPayCardId(card.stripePaymentMethodId)}
                    style={{ flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 12, marginBottom: 8, borderWidth: 2, borderColor: selectedPayCardId === card.stripePaymentMethodId ? "#22C55E" : "#E5E7EB", backgroundColor: "#F9FAFB" }}
                    activeOpacity={0.8}
                  >
                    <Text style={{ fontSize: 16, marginRight: 10 }}>💳</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: "700", color: "#1A1A1A" }}>{card.brand?.toUpperCase() ?? "Card"} •••• {card.last4 ?? "????"}</Text>
                      <Text style={{ fontSize: 12, color: "#6B7280" }}>Expires {card.expMonth}/{card.expYear}{card.isDefault ? " · Default" : ""}</Text>
                    </View>
                    {selectedPayCardId === card.stripePaymentMethodId && <MaterialIcons name="check-circle" size={20} color="#22C55E" />}
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {((portalSavedCards as any[]) ?? []).length === 1 && (() => {
              const card = (portalSavedCards as any[])[0];
              return (
                <View style={{ flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: "#22C55E", backgroundColor: "#F0FDF4" }}>
                  <Text style={{ fontSize: 16, marginRight: 10 }}>💳</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: "#1A1A1A" }}>{card.brand?.toUpperCase() ?? "Card"} •••• {card.last4 ?? "????"}</Text>
                    <Text style={{ fontSize: 12, color: "#6B7280" }}>Expires {card.expMonth}/{card.expYear}</Text>
                  </View>
                  <MaterialIcons name="check-circle" size={20} color="#22C55E" />
                </View>
              );
            })()}
            {((portalSavedCards as any[]) ?? []).length === 0 && (
              <View style={{ alignItems: "center", paddingVertical: 24, marginBottom: 16 }}>
                <Text style={{ fontSize: 32, marginBottom: 8 }}>💳</Text>
                <Text style={{ color: "#1A1A1A", fontWeight: "700", fontSize: 15, marginBottom: 4 }}>No Cards on File</Text>
                <Text style={{ color: "#6B7280", fontSize: 13, textAlign: "center", lineHeight: 18 }}>Add a card in your Profile to pay here.</Text>
              </View>
            )}

            {/* Amount display */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#F9FAFB", borderRadius: 12, padding: 16, marginBottom: 24, borderWidth: 1, borderColor: "#E5E7EB" }}>
              <Text style={{ fontSize: 14, color: "#6B7280", fontWeight: "600" }}>Amount Due</Text>
              <Text style={{ fontSize: 24, fontWeight: "800", color: "#1A1A1A" }}>${payAmount}</Text>
            </View>

            {/* Buttons */}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity
                onPress={() => { if (!payingCard) { setShowPayModal(false); setPayAmount(""); setPayJobId(null); } }}
                style={{ flex: 1, padding: 16, backgroundColor: "#F3F4F6", borderRadius: 14, alignItems: "center" }}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: 15, fontWeight: "700", color: "#374151" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const cards = (portalSavedCards as any[]) ?? [];
                  const card = cards.find((c: any) => c.stripePaymentMethodId === selectedPayCardId) ?? cards[0];
                  if (!card) { Alert.alert("No Card", "Please add a card in your Profile first."); return; }
                  const amountDollars = parseFloat(payAmount);
                  if (!amountDollars || amountDollars <= 0) { Alert.alert("Invalid Amount", "No amount to charge."); return; }
                  const amountCents = Math.round(amountDollars * 100);
                  Alert.alert(
                    "Confirm Payment",
                    `Pay $${amountDollars.toFixed(2)} with ${card.brand?.toUpperCase() ?? "card"} ending in ${card.last4 ?? "????"} ?`,
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Pay Now",
                        style: "default",
                        onPress: () => {
                          setPayingCard(true);
                          portalChargeCardMutation.mutate({
                            stripeCustomerId: card.stripeCustomerId,
                            stripePaymentMethodId: card.stripePaymentMethodId,
                            amountCents,
                            description: `Customer portal payment — Job ${payJobId ?? ""}`,
                          });
                        },
                      },
                    ]
                  );
                }}
                style={{ flex: 2, padding: 16, backgroundColor: payingCard ? "#22C55E80" : "#22C55E", borderRadius: 14, alignItems: "center" }}
                activeOpacity={0.8}
                disabled={payingCard || ((portalSavedCards as any[]) ?? []).length === 0}
              >
                {payingCard ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={{ fontSize: 15, fontWeight: "700", color: "#FFFFFF" }}>Pay Now</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

function parseDate(dateStr: string, timeStr?: string) {
  if (!dateStr) return { month: "", day: "", year: "", time: timeStr ?? "" };
  const d = new Date(dateStr + "T12:00:00");
  const month = d.toLocaleDateString("en-US", { month: "long" });
  const day = String(d.getDate());
  const year = String(d.getFullYear());
  return { month, day, year, time: timeStr ?? "" };
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 26, fontWeight: "800", color: "#1A1A1A" },
  newBookingBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#1A1A1A",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 100,
  },
  newBookingText: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },

  tabs: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: "#F5F5F5",
    borderRadius: 12,
    padding: 4,
  },
  tab: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 10 },
  tabActive: {
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  tabText: { fontSize: 14, fontWeight: "600", color: "#9CA3AF" },
  tabTextActive: { color: "#1A1A1A" },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyTitle: { fontSize: 16, color: "#9CA3AF", fontWeight: "500" },
  bookNowBtn: {
    backgroundColor: "#1A1A1A",
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 100,
    marginTop: 8,
  },
  bookNowText: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },

  // Card
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#EBEBEB",
    overflow: "hidden",
  },
  cardBody: {
    flexDirection: "row",
    padding: 16,
  },
  cardLeft: {
    flex: 1,
    paddingRight: 14,
    gap: 3,
  },
  badgesRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
  },
  statusPillText: { fontSize: 12, fontWeight: "700" },
  sourcePill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 100,
  },
  sourcePillText: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },

  serviceName: {
    fontSize: 18,
    fontWeight: "800",
    color: "#1A1A1A",
    lineHeight: 22,
  },
  vehicleText: {
    fontSize: 13,
    color: "#6B7280",
  },
  addonsText: {
    fontSize: 12,
    color: "#9CA3AF",
  },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 2,
  },
  locationText: {
    fontSize: 12,
    color: "#9CA3AF",
    flex: 1,
  },

  divider: {
    width: 1,
    backgroundColor: "#EBEBEB",
    marginVertical: 2,
  },

  cardRight: {
    width: 96,
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 10,
    gap: 1,
  },
  dateMonth: {
    fontSize: 13,
    fontWeight: "500",
    color: "#6B7280",
    textAlign: "center",
  },
  dateDay: {
    fontSize: 38,
    fontWeight: "800",
    color: "#1A1A1A",
    lineHeight: 44,
  },
  dateYear: {
    fontSize: 12,
    fontWeight: "500",
    color: "#6B7280",
    textAlign: "center",
  },
  dateTime: {
    fontSize: 11,
    color: "#6B7280",
    textAlign: "center",
    lineHeight: 15,
  },

  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#F0F0F0",
  },
  totalLabel: { fontSize: 14, color: "#6B7280" },
  totalAmount: { fontSize: 20, fontWeight: "800", color: "#1A1A1A" },

  payCardBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#22C55E",
    backgroundColor: "#F0FDF4",
  },
  payCardBtnText: { fontSize: 14, fontWeight: "700", color: "#22C55E" },

  actionsRow: {
    flexDirection: "row",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 12,
    flexWrap: "wrap",
    alignItems: "center",
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
  },
  rescheduleBtn: { borderColor: "#0a7ea4", backgroundColor: "#F0F9FF" },
  cancelBtn: { borderColor: "#EF4444", backgroundColor: "#FEF2F2" },
  actionBtnDisabled: { borderColor: "#E5E7EB", backgroundColor: "#F9FAFB" },
  actionBtnText: { fontSize: 13, fontWeight: "700" },
  cutoffNote: { fontSize: 11, color: "#9CA3AF", flex: 1, marginLeft: 4 },

  trackBtn: {
    marginHorizontal: 16,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
    borderColor: "#2563EB",
    borderRadius: 10,
    paddingVertical: 11,
  },
  trackBtnText: { fontSize: 14, fontWeight: "700", color: "#2563EB" },

  tapHintRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 2,
    marginHorizontal: 16,
    marginBottom: 12,
    marginTop: -4,
  },
  tapHintText: { fontSize: 12, color: "#9CA3AF" },

  // Reschedule modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    maxHeight: "85%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: { fontSize: 20, fontWeight: "800", color: "#1A1A1A" },
  modalLabel: { fontSize: 14, fontWeight: "600", color: "#374151", marginBottom: 10 },

  dateChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
  },
  dateChipActive: { borderColor: "#0a7ea4", backgroundColor: "#EFF9FF" },
  dateChipText: { fontSize: 13, fontWeight: "600", color: "#374151" },
  dateChipTextActive: { color: "#0a7ea4" },

  slotBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9FAFB",
  },
  slotBtnActive: { borderColor: "#0a7ea4", backgroundColor: "#0a7ea4" },
  slotBtnText: { fontSize: 15, fontWeight: "600", color: "#374151" },
  slotBtnTextActive: { color: "#FFFFFF" },

  confirmBtn: {
    backgroundColor: "#0a7ea4",
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
  },
  confirmBtnDisabled: { backgroundColor: "#D1D5DB" },
  confirmBtnText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
});
