import { useState, useMemo, useRef, useEffect } from "react";
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Modal, Pressable, FlatList, Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenContainer } from "@/components/screen-container";
import { useBooking } from "@/lib/booking-context";
import { MaterialIcons } from "@expo/vector-icons";
import { StepIndicator } from "./vehicle";
import { trpc } from "@/lib/trpc";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_SHORT  = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_LABELS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_SHORT  = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Build an array of the next `days` days starting from today (same-day bookings allowed) */
function buildUpcomingDates(days = 60): Date[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    return d;
  });
}

/** Build a grid of dates for a given month/year (includes leading/trailing nulls for alignment) */
function buildMonthGrid(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  return cells;
}

export default function BookDateTimeStep() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { booking, setDateTime } = useBooking();
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ label: string; startHour: number; endHour: number } | null>(null);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [calMonth, setCalMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const carouselRef = useRef<FlatList>(null);
  const today = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d; }, []);
  const upcomingDates = useMemo(() => buildUpcomingDates(90), []);
  const monthGrid = useMemo(() => buildMonthGrid(calMonth.year, calMonth.month), [calMonth]);

  const city = booking.address?.city ?? "";
  const packageName = booking.pkg?.name ?? "Basic Detail";
  const dateKey = selectedDate ? formatDateKey(selectedDate) : "";
  // Fetch all available dates in one efficient query (checks shift schedule + job conflicts)
  const { data: availableDatesData, isLoading: datesLoading } = trpc.employee.getAvailableDates.useQuery(
    { city, daysAhead: 90 },
    { enabled: !!city, staleTime: 5 * 60 * 1000 }
  );

  const availableDateSet = useMemo(() => new Set(availableDatesData ?? []), [availableDatesData]);

  const isDateAvailable = (d: Date) => {
    // While loading, show all dates as available (will filter once loaded)
    if (datesLoading || !availableDatesData) return true;
    return availableDateSet.has(formatDateKey(d));
  };

  // Only show dates that are confirmed available (or all dates while still loading)
  const carouselDates = useMemo(() => {
    if (datesLoading || !availableDatesData) return upcomingDates;
    return upcomingDates.filter(d => availableDateSet.has(formatDateKey(d)));
  }, [upcomingDates, availableDateSet, datesLoading, availableDatesData]);

  // Track the first available date for the badge
  const firstAvailableDate = useMemo(() => {
    if (!availableDatesData) return null;
    return upcomingDates.find(d => availableDateSet.has(formatDateKey(d))) ?? null;
  }, [availableDatesData, availableDateSet, upcomingDates]);

  // Auto-select the first available date once the data loads (only if user hasn't already picked one)
  // Also scroll the carousel to it
  useEffect(() => {
    if (!datesLoading && availableDatesData && availableDatesData.length > 0 && !selectedDate) {
      const firstAvailable = upcomingDates.find(d => availableDateSet.has(formatDateKey(d)));
      if (firstAvailable) {
        setSelectedDate(firstAvailable);
        // Scroll carousel to the first available date
        const idx = carouselDates.findIndex(d => formatDateKey(d) === formatDateKey(firstAvailable));
        if (idx >= 0) {
          setTimeout(() => {
            carouselRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.1 });
          }, 150);
        }
      }
    }
  }, [datesLoading, availableDatesData]);

  // Query available time slots
  const { data: slots, isLoading: slotsLoading } = trpc.employee.getAvailableSlots.useQuery(
    { date: dateKey, city, packageName },
    { enabled: !!dateKey && !!city }
  );

  function handleContinue() {
    if (!selectedDate || !selectedSlot) return;
    setDateTime(formatDateKey(selectedDate), selectedSlot.label);
    router.push("/(customer)/book/confirm" as any);
  }

  function selectDate(d: Date) {
    setSelectedDate(d);
    setSelectedSlot(null);
    setCalendarVisible(false);
  }

  // Calendar month navigation
  function prevMonth() {
    setCalMonth(({ year, month }) => {
      if (month === 0) return { year: year - 1, month: 11 };
      return { year, month: month - 1 };
    });
  }
  function nextMonth() {
    setCalMonth(({ year, month }) => {
      if (month === 11) return { year: year + 1, month: 0 };
      return { year, month: month + 1 };
    });
  }

  // Render a single date card in the carousel
  const renderCarouselItem = ({ item: d }: { item: Date }) => {
    const isSelected = selectedDate?.toDateString() === d.toDateString();
    const available = isDateAvailable(d);
    const isFirstAvailable = firstAvailableDate !== null && formatDateKey(d) === formatDateKey(firstAvailableDate);
    return (
      <View style={{ alignItems: 'center' }}>
        {isFirstAvailable && (
          <View style={styles.firstAvailableBadge}>
            <Text style={styles.firstAvailableBadgeText}>First Available</Text>
          </View>
        )}
        <TouchableOpacity
          style={[
            styles.dateCard,
            isSelected && styles.dateCardSelected,
            !available && styles.dateCardDisabled,
            isFirstAvailable && !isSelected && styles.dateCardFirstAvailable,
          ]}
          onPress={() => available && selectDate(d)}
          disabled={!available}
          activeOpacity={0.8}
        >
          <Text style={[styles.dateDayLabel, isSelected && styles.dateTextSelected, !available && styles.dateTextDisabled]}>
            {DAY_LABELS[d.getDay()]}
          </Text>
          <Text style={[styles.dateNumber, isSelected && styles.dateTextSelected, !available && styles.dateTextDisabled]}>
            {d.getDate()}
          </Text>
          <Text style={[styles.dateMonth, isSelected && styles.dateTextSelected, !available && styles.dateTextDisabled]}>
            {MONTH_SHORT[d.getMonth()]}
          </Text>
          {!available && <View style={styles.unavailableDot} />}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-white">
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <MaterialIcons name="arrow-back" size={24} color="#1A1A1A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pick a Date & Time</Text>
        <View style={{ width: 24 }} />
      </View>

      <StepIndicator current={5} total={5} />

      <ScrollView contentContainerStyle={{ paddingBottom: 160 }}>
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          {/* Section heading + calendar toggle */}
          <View style={styles.sectionRow}>
            <View>
              <Text style={styles.sectionTitle}>When works for you?</Text>
              <Text style={styles.sectionSub}>Swipe to browse available dates.</Text>
            </View>
            <TouchableOpacity
              style={styles.calendarBtn}
              onPress={() => setCalendarVisible(true)}
              activeOpacity={0.8}
            >
              <MaterialIcons name="calendar-month" size={20} color="#1A1A1A" />
              <Text style={styles.calendarBtnText}>Month</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Horizontal date carousel — full width, no padding clipping */}
        <FlatList
          windowSize={5}
          maxToRenderPerBatch={8}
          initialNumToRender={10}
          ref={carouselRef}
          data={carouselDates}
          keyExtractor={(d) => formatDateKey(d)}
          renderItem={renderCarouselItem}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.carouselContent}
          getItemLayout={(_, index) => ({ length: 74, offset: 74 * index, index })}
          style={{ marginTop: 12 }}
        />

        {/* Time slots */}
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          {selectedDate && (
            <>
              <Text style={styles.timeSectionTitle}>Available Times</Text>
              <Text style={styles.packageNote}>{packageName}</Text>

              {slotsLoading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color="#1A1A1A" />
                  <Text style={styles.loadingText}>Checking availability...</Text>
                </View>
              ) : slots && slots.length > 0 ? (
                <View style={styles.timeGrid}>
                  {slots.map((slot) => {
                    const isSel = selectedSlot?.label === slot.label;
                    const isUnavail = !slot.available;
                    return (
                      <TouchableOpacity
                        key={slot.label}
                        style={[styles.timeChip, isSel && styles.timeChipSelected, isUnavail && styles.timeChipUnavailable]}
                        onPress={() => !isUnavail && setSelectedSlot(slot)}
                        disabled={isUnavail}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.timeChipText, isSel && styles.timeChipTextSelected, isUnavail && styles.timeChipTextUnavailable]}>
                          {slot.label}
                        </Text>
                        {isUnavail && <Text style={styles.unavailableLabel}>Booked</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : (
                <View style={styles.noSlotsBox}>
                  <MaterialIcons name="event-busy" size={28} color="#9CA3AF" />
                  <Text style={styles.noSlotsText}>No availability on this date.</Text>
                  <Text style={styles.noSlotsSubText}>Please select a different day.</Text>
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>

      {/* Sticky bottom bar */}
      <View style={[styles.bottomBar, { paddingBottom: Platform.OS === "android" ? Math.max(insets.bottom + 16, 36) : 36 }]}>
        <View style={{ flex: 1 }}>
          {selectedDate && selectedSlot ? (
            <>
              <Text style={styles.selectedDateText}>
                {selectedDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
              </Text>
              <Text style={styles.selectedTimeText}>{selectedSlot.label}</Text>
            </>
          ) : (
            <Text style={styles.selectPrompt}>Select a date & time</Text>
          )}
        </View>
        <TouchableOpacity
          style={[styles.continueBtn, (!selectedDate || !selectedSlot) && { opacity: 0.4 }]}
          onPress={handleContinue}
          disabled={!selectedDate || !selectedSlot}
          activeOpacity={0.85}
        >
          <Text style={styles.continueBtnText}>Review Order</Text>
          <MaterialIcons name="arrow-forward" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Month Calendar Modal */}
      <Modal
        visible={calendarVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setCalendarVisible(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setCalendarVisible(false)}>
          <Pressable style={styles.calendarSheet} onPress={(e) => e.stopPropagation()}>
            {/* Modal header */}
            <View style={styles.calHeader}>
              <TouchableOpacity onPress={prevMonth} style={styles.calNavBtn} activeOpacity={0.7}>
                <MaterialIcons name="chevron-left" size={24} color="#1A1A1A" />
              </TouchableOpacity>
              <Text style={styles.calMonthLabel}>
                {MONTH_LABELS[calMonth.month]} {calMonth.year}
              </Text>
              <TouchableOpacity onPress={nextMonth} style={styles.calNavBtn} activeOpacity={0.7}>
                <MaterialIcons name="chevron-right" size={24} color="#1A1A1A" />
              </TouchableOpacity>
            </View>

            {/* Day-of-week headers */}
            <View style={styles.calDayHeaders}>
              {DAY_SHORT.map((d, i) => (
                <Text key={i} style={styles.calDayHeader}>{d}</Text>
              ))}
            </View>

            {/* Calendar grid */}
            <View style={styles.calGrid}>
              {monthGrid.map((d, i) => {
                if (!d) return <View key={`empty-${i}`} style={styles.calCell} />;
                const isPast = d < today; // strictly before today (yesterday and earlier)
                const isSelected = selectedDate?.toDateString() === d.toDateString();
                const isToday = d.toDateString() === today.toDateString();
                const available = !isPast && isDateAvailable(d); // today is not "past", server controls same-day slot availability
                return (
                  <TouchableOpacity
                    key={i}
                    style={[
                      styles.calCell,
                      isSelected && styles.calCellSelected,
                      isToday && !isSelected && styles.calCellToday,
                    ]}
                    onPress={() => available && selectDate(d)}
                    disabled={!available}
                    activeOpacity={0.75}
                  >
                    <Text style={[
                      styles.calCellText,
                      isSelected && styles.calCellTextSelected,
                      (isPast || !available) && styles.calCellTextDisabled,
                      isToday && !isSelected && styles.calCellTextToday,
                    ]}>
                      {d.getDate()}
                    </Text>
                    {available && !isSelected && (
                      <View style={styles.availDot} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity style={styles.calCloseBtn} onPress={() => setCalendarVisible(false)} activeOpacity={0.8}>
              <Text style={styles.calCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
  headerTitle: { fontSize: 18, fontWeight: "700", color: "#1A1A1A" },

  sectionRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  sectionTitle: { fontSize: 22, fontWeight: "800", color: "#1A1A1A", marginBottom: 2 },
  sectionSub: { fontSize: 13, color: "#9CA3AF" },
  calendarBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#FAFAFA" },
  calendarBtnText: { fontSize: 13, fontWeight: "600", color: "#1A1A1A" },

  // Carousel
  carouselContent: { paddingHorizontal: 20, gap: 8 },
  dateCard: { width: 64, paddingVertical: 14, borderRadius: 16, borderWidth: 1.5, borderColor: "#E5E7EB", alignItems: "center", backgroundColor: "#FFFFFF" },
  dateCardSelected: { backgroundColor: "#1A1A1A", borderColor: "#1A1A1A" },
  dateCardDisabled: { opacity: 0.35, backgroundColor: "#F9FAFB" },
  dateCardFirstAvailable: { borderColor: "#22C55E", borderWidth: 2 },
  firstAvailableBadge: { backgroundColor: "#22C55E", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginBottom: 4 },
  firstAvailableBadgeText: { fontSize: 9, fontWeight: "700", color: "#FFFFFF", textTransform: "uppercase", letterSpacing: 0.3 },
  dateDayLabel: { fontSize: 11, fontWeight: "600", color: "#9CA3AF", marginBottom: 4 },
  dateNumber: { fontSize: 20, fontWeight: "800", color: "#1A1A1A" },
  dateMonth: { fontSize: 11, color: "#9CA3AF", marginTop: 2 },
  dateTextSelected: { color: "#FFFFFF" },
  dateTextDisabled: { color: "#D1D5DB" },
  unavailableDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: "#EF4444", marginTop: 4 },

  // Time slots
  timeSectionTitle: { fontSize: 16, fontWeight: "700", color: "#1A1A1A", marginTop: 24, marginBottom: 4 },
  packageNote: { fontSize: 12, color: "#6B7280", marginBottom: 12 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 16 },
  loadingText: { fontSize: 14, color: "#6B7280" },
  timeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  timeChip: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: "#E5E7EB", backgroundColor: "#FFFFFF", minWidth: 150 },
  timeChipSelected: { backgroundColor: "#1A1A1A", borderColor: "#1A1A1A" },
  timeChipUnavailable: { backgroundColor: "#F9FAFB", borderColor: "#E5E7EB", opacity: 0.5 },
  timeChipText: { fontSize: 14, fontWeight: "600", color: "#374151" },
  timeChipTextSelected: { color: "#FFFFFF" },
  timeChipTextUnavailable: { color: "#9CA3AF" },
  unavailableLabel: { fontSize: 11, color: "#EF4444", marginTop: 2 },
  noSlotsBox: { alignItems: "center", paddingVertical: 32, gap: 8 },
  noSlotsText: { fontSize: 15, fontWeight: "600", color: "#374151" },
  noSlotsSubText: { fontSize: 13, color: "#9CA3AF" },

  // Bottom bar
  bottomBar: { position: "absolute", bottom: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, backgroundColor: "#FFFFFF", borderTopWidth: 1, borderTopColor: "#F0F0F0" },
  selectedDateText: { fontSize: 14, fontWeight: "700", color: "#1A1A1A" },
  selectedTimeText: { fontSize: 13, color: "#6B7280", marginTop: 2 },
  selectPrompt: { fontSize: 13, color: "#9CA3AF" },
  continueBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#1A1A1A", paddingHorizontal: 24, paddingVertical: 14, borderRadius: 100 },
  continueBtnText: { fontSize: 15, fontWeight: "700", color: "#FFFFFF" },

  // Calendar modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  calendarSheet: { backgroundColor: "#FFFFFF", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 20, paddingBottom: 40, paddingHorizontal: 20 },
  calHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  calNavBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#F5F5F5", justifyContent: "center", alignItems: "center" },
  calMonthLabel: { fontSize: 17, fontWeight: "800", color: "#1A1A1A" },
  calDayHeaders: { flexDirection: "row", marginBottom: 8 },
  calDayHeader: { flex: 1, textAlign: "center", fontSize: 12, fontWeight: "700", color: "#9CA3AF" },
  calGrid: { flexDirection: "row", flexWrap: "wrap" },
  calCell: { width: "14.28%", aspectRatio: 1, justifyContent: "center", alignItems: "center", marginBottom: 2 },
  calCellSelected: { backgroundColor: "#1A1A1A", borderRadius: 100 },
  calCellToday: { borderWidth: 1.5, borderColor: "#1A1A1A", borderRadius: 100 },
  calCellText: { fontSize: 14, fontWeight: "600", color: "#1A1A1A" },
  calCellTextSelected: { color: "#FFFFFF" },
  calCellTextDisabled: { color: "#D1D5DB" },
  calCellTextToday: { color: "#1A1A1A", fontWeight: "800" },
  availDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: "#22C55E", marginTop: 2 },
  calCloseBtn: { marginTop: 20, backgroundColor: "#F5F5F5", borderRadius: 14, paddingVertical: 14, alignItems: "center" },
  calCloseBtnText: { fontSize: 15, fontWeight: "700", color: "#1A1A1A" },
});
