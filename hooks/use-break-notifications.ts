import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import { useEmployeeAuth } from "@/lib/auth-context";

const BREAK_TIMES = [
  { hour: 10, minute: 0, type: "morning_15min", name: "Morning Break", duration: 15 },
  { hour: 12, minute: 0, type: "lunch_30min", name: "Lunch Break", duration: 30 },
  { hour: 15, minute: 0, type: "afternoon_15min", name: "Afternoon Break", duration: 15 },
] as const;

/**
 * Sends a local push notification to prompt the team member to take their break.
 * Does NOT auto-create a break record — the break is only recorded when the
 * team member taps "Start Break" in the BreakModal.
 */
export function useBreakNotifications() {
  const { employee } = useEmployeeAuth();
  const notificationCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sentBreaksRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!employee?.employeeId) return;

    // Check for break times every minute
    const checkBreaks = async () => {
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();

      for (const breakTime of BREAK_TIMES) {
        // Check if it's time for this break (within the same minute)
        if (currentHour === breakTime.hour && currentMinute === breakTime.minute) {
          const breakKey = `${breakTime.type}_${now.toISOString().split("T")[0]}`;

          // Only notify once per day per break type
          if (!sentBreaksRef.current.has(breakKey)) {
            sentBreaksRef.current.add(breakKey);

            try {
              // Send local notification to prompt the team member — do NOT auto-create a break record
              await Notifications.scheduleNotificationAsync({
                content: {
                  title: `${breakTime.name} Time! 🎉`,
                  body: `Time for your ${breakTime.duration}-minute break. Open the app to start it.`,
                  sound: "default",
                  badge: 1,
                },
                trigger: null, // Send immediately
              });
            } catch (error) {
              console.error("Break notification error:", error);
            }
          }
        }
      }
    };

    // Start checking every minute
    notificationCheckRef.current = setInterval(checkBreaks, 60000);

    // Do NOT check immediately on mount — avoids false triggers if component
    // mounts right at a break time (e.g. app restart at 12:00 PM)

    return () => {
      if (notificationCheckRef.current) {
        clearInterval(notificationCheckRef.current);
      }
    };
  }, [employee?.employeeId]);
}
