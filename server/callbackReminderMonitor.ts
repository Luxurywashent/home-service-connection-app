/**
 * Callback Reminder Monitor — runs every 60 seconds on the server.
 *
 * Rule: 15 minutes before a scheduled callback, send an in-app notification
 * AND a push notification to the assigned sales rep AND all admins.
 */

import * as db from "./db";
import { createNotification } from "./db";

async function sendPushNotifications(tokens: string[], title: string, body: string, data: Record<string, unknown>) {
  const validTokens = tokens.filter(t => t && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')));
  if (validTokens.length === 0) return;
  const payloads = validTokens.map(to => ({ to, title, body, sound: 'default', data }));
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloads),
    });
  } catch (e) {
    console.error('[CallbackReminder] Push send failed:', e);
  }
}

// In-memory set to avoid duplicate reminders per callback
const sentReminders = new Set<string>(); // callbackId

function formatTime(isoString: string, timezone: string): string {
  const dt = new Date(isoString);
  return dt.toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: timezone,
  });
}

export async function runCallbackReminderMonitor() {
  try {
    const upcoming = await db.getUpcomingCallbacksForReminder(15);
    for (const callback of upcoming) {
      if (sentReminders.has(callback.callbackId)) continue;
      sentReminders.add(callback.callbackId);

      const scheduledStr = callback.scheduledAt as unknown as string;
      const timeStr = formatTime(scheduledStr, callback.timezone);
      const repName = callback.assignedToName ?? callback.assignedTo;
      const prospectName = `${callback.prospectFirstName} ${callback.prospectLastName}`;
      const pushTitle = `📞 Callback in ~15 min`;
      const pushBody = `${prospectName} — ${timeStr} | ${callback.prospectPhone}`;
      const pushData = { screen: 'callbacks', callbackId: callback.callbackId };

      // 1. In-app notification + push to the assigned sales rep
      await createNotification({
        notificationId: `CB_REMINDER_${Date.now()}_${callback.callbackId}`,
        employeeId: callback.assignedTo,
        fullName: repName,
        notificationType: "callback_reminder",
        title: pushTitle,
        message: `You have a scheduled callback with ${prospectName} at ${timeStr}. Phone: ${callback.prospectPhone}`,
        createdBy: "System",
        status: "unread",
        requiresAcknowledgment: "yes",
      });

      // Push to sales rep device
      try {
        const repEmployee = await db.getEmployeeById(callback.assignedTo);
        const repToken = (repEmployee as any)?.pushToken;
        if (repToken) await sendPushNotifications([repToken], pushTitle, pushBody, pushData);
      } catch (e) {
        console.error('[CallbackReminder] Rep push failed:', e);
      }

      // 2. In-app notification + push to all admins
      try {
        const admins = await db.getAdminEmployees();
        for (const admin of admins) {
          // Skip if admin is also the assigned rep (already notified above)
          if (admin.employeeId === callback.assignedTo) continue;
          await createNotification({
            notificationId: `CB_REMINDER_ADMIN_${Date.now()}_${callback.callbackId}_${admin.employeeId}`,
            employeeId: admin.employeeId,
            fullName: admin.fullName ?? admin.employeeId,
            notificationType: "callback_reminder",
            title: pushTitle,
            message: `${repName} has a callback with ${prospectName} at ${timeStr}. Phone: ${callback.prospectPhone}`,
            createdBy: "System",
            status: "unread",
            requiresAcknowledgment: "no",
          });
        }
        const adminTokens = admins
          .filter(a => a.employeeId !== callback.assignedTo)
          .map(a => (a as any).pushToken)
          .filter(Boolean) as string[];
        if (adminTokens.length > 0) {
          await sendPushNotifications(
            adminTokens,
            `📞 Upcoming Callback — ${repName}`,
            `${prospectName} at ${timeStr} | ${callback.prospectPhone}`,
            pushData,
          );
        }
      } catch (e) {
        console.error('[CallbackReminder] Admin notification failed:', e);
      }

      // Mark reminder as sent in DB
      await db.updateSalesCallbackStatus(callback.callbackId, {
        reminderSent: "yes",
        reminderSentAt: new Date(),
      });

      console.log(`[CallbackReminder] Sent reminder for callback ${callback.callbackId} to ${repName} + admins`);
    }
  } catch (err) {
    console.error("[CallbackReminder] Error:", err);
  }
}

export function startCallbackReminderMonitor() {
  // Run immediately on startup, then every 60 seconds
  runCallbackReminderMonitor().catch(console.error);
  setInterval(() => runCallbackReminderMonitor().catch(console.error), 60 * 1000);
  console.log("[CallbackReminder] Started — checking every 60 seconds");
}
