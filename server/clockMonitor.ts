/**
 * Clock Monitor — runs every 60 seconds on the server.
 *
 * Rules:
 * 1. At 5:00 PM, 5:30 PM, 6:00 PM, 6:30 PM → send each still-clocked-in detailer a
 *    "Still Working?" notification (type: "clock_check_5pm") so the mobile app can
 *    show the confirmation prompt.
 * 2. At 7:00 PM → auto clock out anyone who hasn't responded, notify admins.
 *
 * NOTE: Break overrun auto clock-back-in has been intentionally disabled.
 *       If a detailer forgets to clock back in from break, an admin must do it manually.
 */

import * as db from "./db";
import { createNotification } from "./db";

// In-memory sets to avoid duplicate actions within the same day
// One set per reminder window: 5pm, 5:30pm, 6pm, 6:30pm
const sentPrompt = new Map<string, Set<string>>(); // key: "17:00"|"17:30"|"18:00"|"18:30" → Set<employeeId>
const autoClockOutDone = new Set<string>();  // employeeId

// Reminder windows: [startTotalMinutes, label, message]
const REMINDER_WINDOWS: [number, string, string][] = [
  [17 * 60,      "5:00 PM",  "Hi {name}, it's 5:00 PM. Are you still working? Tap \"Still Working\" to continue or \"Clock Me Out\" to end your shift. If no response by 7:00 PM you will be automatically clocked out."],
  [17 * 60 + 30, "5:30 PM",  "Hi {name}, it's 5:30 PM. You're still clocked in. Tap \"Still Working\" to confirm or \"Clock Me Out\" to end your shift. Auto clock-out at 7:00 PM."],
  [18 * 60,      "6:00 PM",  "Hi {name}, it's 6:00 PM. You're still clocked in. Tap \"Still Working\" to confirm or \"Clock Me Out\" to end your shift. Auto clock-out at 7:00 PM."],
  [18 * 60 + 30, "6:30 PM",  "Hi {name}, it's 6:30 PM — last reminder before auto clock-out. Tap \"Still Working\" to confirm or \"Clock Me Out\" to end your shift. You will be automatically clocked out at 7:00 PM."],
];

// Auto clock-out at 7:00 PM (19:00)
const AUTO_CLOCK_OUT_MINUTES = 19 * 60;

// Reset daily sets at midnight
function scheduleMidnightReset() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = midnight.getTime() - now.getTime();
  setTimeout(() => {
    sentPrompt.clear();
    autoClockOutDone.clear();
    console.log("[ClockMonitor] Daily sets reset at midnight");
    scheduleMidnightReset();
  }, msUntilMidnight);
}

function getBreakLimitMinutes(breakType: string): number {
  if (breakType === "lunch_30min") return 30;
  return 15; // morning_15min, afternoon_15min
}

async function notifyAdmins(title: string, message: string) {
  try {
    const admins = await db.getAdminEmployees();
    for (const admin of admins) {
      await createNotification({
        notificationId: `CLOCK_${Date.now()}_${admin.employeeId}`,
        employeeId: admin.employeeId,
        fullName: admin.fullName,
        notificationType: "clock_alert",
        title,
        message,
        createdBy: "System",
        status: "unread",
        requiresAcknowledgment: "no",
      });
    }
  } catch (err) {
    console.error("[ClockMonitor] Failed to notify admins:", err);
  }
}

export async function runClockMonitor() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const totalMinutes = hours * 60 + minutes;

  // ── 1. Reminder prompts (5:00, 5:30, 6:00, 6:30 PM) ─────────────────────
  for (const [windowStart, label, msgTemplate] of REMINDER_WINDOWS) {
    // Fire within a 2-minute window to account for the 60-second poll interval
    if (totalMinutes >= windowStart && totalMinutes < windowStart + 2) {
      const key = String(windowStart);
      if (!sentPrompt.has(key)) sentPrompt.set(key, new Set());
      const sent = sentPrompt.get(key)!;
      try {
        const active = await db.getAllActiveClockedIn();
        for (const record of active) {
          if (sent.has(record.employeeId)) continue;
          sent.add(record.employeeId);
          const firstName = record.fullName.split(" ")[0];
          await createNotification({
            notificationId: `CLOCK_PROMPT_${windowStart}_${Date.now()}_${record.employeeId}`,
            employeeId: record.employeeId,
            fullName: record.fullName,
            notificationType: "clock_check_5pm",
            title: "Are you still working?",
            message: msgTemplate.replace("{name}", firstName),
            createdBy: "System",
            status: "unread",
            requiresAcknowledgment: "yes",
          });
          console.log(`[ClockMonitor] Sent ${label} prompt to ${record.fullName}`);
        }
      } catch (err) {
        console.error(`[ClockMonitor] ${label} prompt error:`, err);
      }
    }
  }

  // ── 2. 7:00 PM auto clock-out ─────────────────────────────────────────────
  if (totalMinutes >= AUTO_CLOCK_OUT_MINUTES) {
    try {
      const active = await db.getAllActiveClockedIn();
      for (const record of active) {
        if (autoClockOutDone.has(record.employeeId)) continue;
        autoClockOutDone.add(record.employeeId);
        const result = await db.autoClockOut(record.recordId, "7:00 PM auto clock-out");
        await notifyAdmins(
          `⏰ Auto Clock-Out: ${result.fullName}`,
          `${result.fullName} was automatically clocked out at 7:00 PM. Total hours: ${Number(result.totalHours).toFixed(2)}h.`
        );
        console.log(`[ClockMonitor] Auto clocked out ${result.fullName} at 7:00 PM`);
      }
    } catch (err) {
      console.error("[ClockMonitor] 7:00 PM auto clock-out error:", err);
    }
  }

  // Break overrun auto clock-back-in is intentionally disabled.
  // Admins must manually clock detailers back in if they forget to end their break.
}

export function startClockMonitor() {
  scheduleMidnightReset();
  // Run immediately on startup, then every 60 seconds
  runClockMonitor().catch(console.error);
  setInterval(() => runClockMonitor().catch(console.error), 60 * 1000);
  console.log("[ClockMonitor] Started — checking every 60 seconds");
}
