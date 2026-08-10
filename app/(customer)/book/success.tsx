import { useState, useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Alert, Platform } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { ScreenContainer } from "@/components/screen-container";
import { MaterialIcons } from "@expo/vector-icons";
// expo-calendar is loaded dynamically to prevent crash on builds where native module may not be linked
type CalendarModule = typeof import("expo-calendar");

// Parse "8:00 AM" or "10:30 AM" into { hours, minutes }
function parseTime(timeStr: string): { hours: number; minutes: number } {
  if (!timeStr) return { hours: 9, minutes: 0 };
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return { hours: 9, minutes: 0 };
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return { hours, minutes };
}

export default function BookingSuccessScreen() {
  const router = useRouter();
  const { ref, date, time, service, address, isGuest } = useLocalSearchParams<{
    ref: string;
    date: string;
    time: string;
    service: string;
    address: string;
    isGuest?: string;
  }>();

  const [calendarAdded, setCalendarAdded] = useState(false);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const isGuestBooking = isGuest === "true";

  async function addToCalendar(silent = false) {
    if (calendarLoading || calendarAdded) return;
    setCalendarLoading(true);
    try {
      // Dynamic import prevents crash if native module is not linked in the build
      const Calendar: CalendarModule = await import("expo-calendar");

      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== "granted") {
        if (!silent) {
          Alert.alert(
            "Calendar Access Required",
            "Please allow calendar access in your device settings to add this appointment.",
            [{ text: "OK" }]
          );
        }
        return;
      }

      const decodedDate = decodeURIComponent(date ?? "");
      const decodedTime = decodeURIComponent(time ?? "");
      const decodedService = decodeURIComponent(service ?? "Detail Service");
      const decodedAddress = decodeURIComponent(address ?? "");

      let startDate: Date;
      let endDate: Date;

      if (decodedDate) {
        const { hours, minutes } = parseTime(decodedTime);
        startDate = new Date(`${decodedDate}T12:00:00`);
        startDate.setHours(hours, minutes, 0, 0);
        endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
      } else {
        startDate = new Date();
        startDate.setDate(startDate.getDate() + 1);
        startDate.setHours(9, 0, 0, 0);
        endDate = new Date(startDate.getTime() + 2 * 60 * 60 * 1000);
      }

      let calendarId: string | undefined;

      if (Platform.OS === "ios") {
        const defaultCalendar = await Calendar.getDefaultCalendarAsync();
        calendarId = defaultCalendar?.id;
      } else {
        const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
        const writable = calendars.find((c) => c.allowsModifications);
        calendarId = writable?.id;
      }

      if (!calendarId) {
        if (!silent) {
          Alert.alert("No Calendar Found", "We couldn't find a calendar on your device to add this event to.");
        }
        return;
      }

      await Calendar.createEventAsync(calendarId, {
        title: `🚗 ${decodedService} — Luxury Wash On Wheels`,
        startDate,
        endDate,
        location: decodedAddress || undefined,
        notes: ref ? `Booking Reference: ${ref}` : undefined,
        alarms: [{ relativeOffset: -60 }],
      });

      setCalendarAdded(true);
      if (!silent) {
        Alert.alert("Added to Calendar!", "Your appointment has been added to your calendar with a 1-hour reminder.", [{ text: "OK" }]);
      }
    } catch (err: any) {
      // Silently fail if calendar module not available (e.g. not linked in build)
      if (!silent) {
        Alert.alert("Couldn't Add Event", err?.message ?? "Something went wrong. Please try again.");
      }
    } finally {
      setCalendarLoading(false);
    }
  }

  // Auto-add to calendar when screen loads (silently — no alert on success)
  useEffect(() => {
    if (Platform.OS !== "web") {
      // Small delay to let the screen fully mount before requesting permissions
      const timer = setTimeout(() => {
        addToCalendar(true);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, []);

  return (
    <ScreenContainer edges={["top", "left", "right"]} containerClassName="bg-white">
      <View style={styles.container}>
        {/* Success icon */}
        <View style={styles.iconCircle}>
          <MaterialIcons name="check-circle" size={64} color="#059669" />
        </View>

        <Text style={styles.title}>Booking Confirmed!</Text>
        <Text style={styles.subtitle}>
          Your detail has been scheduled. We'll confirm your appointment within 24 hours.
        </Text>

        {ref && (
          <View style={styles.refBox}>
            <Text style={styles.refLabel}>Booking Reference</Text>
            <Text style={styles.refValue}>{ref}</Text>
          </View>
        )}

        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <MaterialIcons name="notifications" size={18} color="#6B7280" />
            <Text style={styles.infoText}>You'll receive a push notification when your detailer is on the way.</Text>
          </View>
          <View style={styles.infoRow}>
            <MaterialIcons name="my-location" size={18} color="#6B7280" />
            <Text style={styles.infoText}>Track your detailer in real-time from the Bookings tab.</Text>
          </View>
        </View>

        {/* Add to Calendar — auto-attempted on load, manual fallback if needed */}
        <TouchableOpacity
          style={[styles.calendarBtn, calendarAdded && styles.calendarBtnDone]}
          onPress={() => addToCalendar(false)}
          disabled={calendarLoading || calendarAdded}
          activeOpacity={0.85}
        >
          <MaterialIcons
            name={calendarAdded ? "event-available" : "event"}
            size={20}
            color={calendarAdded ? "#059669" : "#1A1A1A"}
          />
          <Text style={[styles.calendarBtnText, calendarAdded && styles.calendarBtnTextDone]}>
            {calendarLoading ? "Adding to Calendar…" : calendarAdded ? "Added to Calendar ✓" : "Add to My Calendar"}
          </Text>
        </TouchableOpacity>

        {isGuestBooking ? (
          <>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => router.replace("/signup" as any)}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Create Account</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => router.replace("/(customer)/book/lookup" as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.secondaryBtnText}>Track Your Booking</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.tertiaryBtn}
              onPress={() => router.replace("/(customer)/home" as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.tertiaryBtnText}>Back to Home</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => router.replace("/(customer)/bookings" as any)}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>View My Bookings</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => router.replace("/(customer)/home" as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.secondaryBtnText}>Back to Home</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  iconCircle: { width: 100, height: 100, borderRadius: 50, backgroundColor: "#D1FAE5", justifyContent: "center", alignItems: "center", marginBottom: 24 },
  title: { fontSize: 28, fontWeight: "900", color: "#1A1A1A", textAlign: "center", marginBottom: 12 },
  subtitle: { fontSize: 15, color: "#6B7280", textAlign: "center", lineHeight: 22, marginBottom: 24 },
  refBox: { backgroundColor: "#F5F5F5", borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginBottom: 24, alignItems: "center" },
  refLabel: { fontSize: 11, color: "#9CA3AF", fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  refValue: { fontSize: 18, fontWeight: "800", color: "#1A1A1A", marginTop: 4 },
  infoCard: { backgroundColor: "#F9FAFB", borderRadius: 16, padding: 16, width: "100%", gap: 12, marginBottom: 24 },
  infoRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  infoText: { flex: 1, fontSize: 13, color: "#6B7280", lineHeight: 19 },
  calendarBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    width: "100%", borderRadius: 100, paddingVertical: 16, paddingHorizontal: 40,
    backgroundColor: "#F3F4F6", borderWidth: 1.5, borderColor: "#D1D5DB", marginBottom: 12,
  },
  calendarBtnDone: { backgroundColor: "#D1FAE5", borderColor: "#6EE7B7" },
  calendarBtnText: { fontSize: 16, fontWeight: "700", color: "#1A1A1A" },
  calendarBtnTextDone: { color: "#059669" },
  primaryBtn: { backgroundColor: "#1A1A1A", borderRadius: 100, paddingVertical: 16, paddingHorizontal: 40, width: "100%", alignItems: "center", marginBottom: 12 },
  primaryBtnText: { fontSize: 16, fontWeight: "700", color: "#FFFFFF" },
  secondaryBtn: { backgroundColor: "#F3F4F6", borderRadius: 100, paddingVertical: 14, paddingHorizontal: 40, width: "100%", alignItems: "center", marginBottom: 12 },
  secondaryBtnText: { fontSize: 15, fontWeight: "600", color: "#1A1A1A" },
  tertiaryBtn: { paddingVertical: 12 },
  tertiaryBtnText: { fontSize: 15, fontWeight: "600", color: "#6B7280", textAlign: "center" },
});
