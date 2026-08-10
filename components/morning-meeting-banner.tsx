import { View, Text, TouchableOpacity, Linking } from "react-native";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useEmployeeAuth } from "@/lib/auth-context";

interface MorningMeetingConfig {
  zoomLink: string;
  meetingTime?: string;
  enabled?: string;
}

/** Returns today's date as YYYY-MM-DD in CST (America/Chicago) */
function todayCSTString(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Returns true if the current time in CST is between 7:15 AM and 7:31 AM.
 */
function isWithinMeetingWindow(): boolean {
  const now = new Date();
  const cstParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);

  const hourPart = cstParts.find((p) => p.type === "hour");
  const minutePart = cstParts.find((p) => p.type === "minute");
  if (!hourPart || !minutePart) return false;

  const hour = parseInt(hourPart.value, 10);
  const minute = parseInt(minutePart.value, 10);
  const totalMinutes = hour * 60 + minute;

  // Window: 7:15 AM (435 min) to 7:31 AM (451 min), exclusive of 7:31
  return totalMinutes >= 435 && totalMinutes < 451;
}

/**
 * Returns how many minutes remain until 7:31 AM CST (end of window).
 */
function minutesRemainingInWindow(): number {
  const now = new Date();
  const cstParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);

  const hourPart = cstParts.find((p) => p.type === "hour");
  const minutePart = cstParts.find((p) => p.type === "minute");
  if (!hourPart || !minutePart) return 0;

  const hour = parseInt(hourPart.value, 10);
  const minute = parseInt(minutePart.value, 10);
  const totalMinutes = hour * 60 + minute;
  const windowEnd = 451; // 7:31 AM in minutes

  return Math.max(0, windowEnd - totalMinutes);
}

export function MorningMeetingBanner() {
  const { employee } = useEmployeeAuth();
  const [config, setConfig] = useState<MorningMeetingConfig | null>(null);
  const [visible, setVisible] = useState<boolean>(false);
  const [minutesLeft, setMinutesLeft] = useState<number>(0);
  const [attended, setAttended] = useState<boolean>(false);
  const query = trpc.morningMeeting.getConfig.useQuery(undefined, { enabled: true });
  const recordAttendanceMutation = trpc.morningMeeting.recordAttendance.useMutation();
  // Check if this team member is marked off today — hide the banner if so
  const isOffQuery = trpc.daysOff.isOff.useQuery(
    { employeeId: employee?.employeeId ?? "", offDate: todayCSTString() },
    { enabled: !!employee?.employeeId }
  );

  useEffect(() => {
    if (query.data && query.data.enabled === "yes") {
      setConfig(query.data as MorningMeetingConfig);
    }
  }, [query.data]);

  useEffect(() => {
    const checkWindow = () => {
      const inWindow = isWithinMeetingWindow();
      setVisible(inWindow);
      if (inWindow) {
        setMinutesLeft(minutesRemainingInWindow());
      }
    };

    checkWindow();
    // Check every 30 seconds so it disappears promptly at 7:31 AM
    const interval = setInterval(checkWindow, 30000);
    return () => clearInterval(interval);
  }, []);

  // Hide if outside the 7:15–7:31 AM CST window, config not loaded, or team member is off today
  if (!visible || query.isLoading || !config) return null;
  if (isOffQuery.data === true) return null;

  const handleJoinMeeting = async () => {
    // Record attendance in the database
    if (employee?.employeeId && !attended) {
      try {
        await recordAttendanceMutation.mutateAsync({
          employeeId: employee.employeeId,
          fullName: employee.fullName ?? employee.employeeId,
          meetingDate: todayCSTString(),
        });
        setAttended(true);
      } catch {
        // Non-fatal — still open the Zoom link even if recording fails
      }
    }

    if (config.zoomLink) {
      Linking.openURL(config.zoomLink).catch(() => {
        alert("Unable to open Zoom link. Please try again.");
      });
    }
  };

  return (
    <TouchableOpacity
      onPress={handleJoinMeeting}
      activeOpacity={0.8}
      style={{
        marginHorizontal: 16,
        marginBottom: 16,
        backgroundColor: attended ? "#15803d" : "#1d4ed8",
        borderRadius: 12,
        padding: 16,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 4,
        elevation: 3,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>
            {attended ? "✅ Morning Meeting" : "📹 Morning Meeting"}
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.8)", fontSize: 13, marginTop: 2 }}>
            {attended
              ? "Attendance recorded — you're all set!"
              : minutesLeft > 1
              ? `Banner disappears in ${minutesLeft} min`
              : "Starting now — join quickly!"}
          </Text>
        </View>
        <View style={{ backgroundColor: "rgba(255,255,255,0.2)", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 }}>
          <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>
            {attended ? "Joined ✓" : "Join Now"}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}
