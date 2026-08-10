/**
 * Appointment Confirmation Monitor
 *
 * Runs every 5 minutes on the server.
 *
 * Rules:
 * 1. REMINDER (9 AM window): Any upcoming job (up to 72 hours away) that hasn't
 *    been reminded yet gets a confirmation email AND SMS at 9 AM CST.
 *    The token is pre-generated at any time so the confirm link is ready,
 *    but the actual send only happens during the 9:00–9:14 AM window.
 *    Sets appt_reminder_sent = 1 ONLY after the email/SMS is actually sent.
 *
 * 2. NO-RESPONSE ALERT (7 AM window): On the day of the appointment, if
 *    appt_confirmation_status is still 'pending' at 7:00–7:14 AM CST,
 *    send an urgent reminder email to the customer AND notify admin/sales.
 *
 * 3. CONFIRMED NOTIFICATION: When a customer confirms (via email button or SMS C),
 *    notify admin + sales that the appointment is confirmed.
 */

import mysql from "mysql2/promise";
import crypto from "crypto";
import { sendEmail, buildUrgentConfirmationEmail } from "./email";
import { createNotification, getAdminEmployees, resolvePackageNameAsync } from "./db";
import { ENV } from "./_core/env";

function getDb() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

/** Generate a secure random token for the confirm link */
function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Get the public base URL for building confirm links */
function getBaseUrl(): string {
  return process.env.PUBLIC_URL ?? "https://www.luxurywashonwheels.app";
}

/** Send Twilio SMS */
async function sendSms(to: string, body: string): Promise<void> {
  // SMS DISABLED: A2P 10DLC campaign pending approval — re-enable by setting SMS_ENABLED=true
  if (process.env.SMS_ENABLED !== "true") {
    console.log("[SMS] Outbound SMS disabled — A2P campaign pending. Skipping to:", to);
    return;
  }
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    console.warn("[ApptConfirm] Twilio not configured — skipping SMS");
    return;
  }
  const toNumber = to.startsWith("+") ? to : `+1${to.replace(/\D/g, "")}`;
  const params = new URLSearchParams({ To: toNumber, From: fromNumber, Body: body });
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        },
        body: params.toString(),
      }
    );
    if (!res.ok) {
      const txt = await res.text();
      console.error(`[ApptConfirm] SMS error ${res.status}: ${txt}`);
    } else {
      console.log(`[ApptConfirm] SMS sent to ${toNumber}`);
    }
  } catch (err) {
    console.error("[ApptConfirm] SMS send failed:", err);
  }
}

/** Build the confirmation reminder email HTML */
export function buildConfirmationReminderEmail(opts: {
  firstName: string;
  date: string;
  time: string;
  packageType: string | null;
  vehicleType: string | null;
  address: string | null;
  city: string | null;
  location?: string | null;  // city slug fallback e.g. "destin"
  confirmUrl: string;
  hoursAway: number;
}): { subject: string; html: string } {
  const daysAway = Math.round(opts.hoursAway / 24);
  const timeLabel = daysAway >= 2 ? `${daysAway} days` : opts.hoursAway <= 24 ? "tomorrow" : `${daysAway} days`;
  const subject = `⏰ Confirm Your Appointment — Luxury Wash On Wheels`;
  const serviceDesc = [opts.vehicleType, opts.packageType].filter(Boolean).join(" — ");
  // Build a human-readable city label from slug (e.g. "fort_walton_beach" → "Fort Walton Beach, FL")
  const citySlug = opts.city || opts.location || null;
  const cityLabel = citySlug
    ? citySlug.split(/[_\s]+/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') + ', FL'
    : null;
  const addressLine = opts.address
    ? [opts.address, cityLabel].filter(Boolean).join(', ')
    : cityLabel;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.10);">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#0a7ea4 0%,#0369a1 100%);padding:32px 28px;text-align:center;">
          <div style="font-size:48px;margin-bottom:12px;">🚐</div>
          <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:800;">Your Appointment is ${timeLabel === "tomorrow" ? "Tomorrow!" : `in ${timeLabel}!`}</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Luxury Wash On Wheels</p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:28px;">
          <p style="margin:0 0 20px;color:#374151;font-size:16px;line-height:1.6;">Hi <strong>${opts.firstName}</strong>,</p>
          <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
            Your appointment is coming up ${timeLabel === "tomorrow" ? "<strong>tomorrow</strong>" : `in <strong>${timeLabel}</strong>`}. Please confirm your appointment so we can have your detailer ready to go!
          </p>
          <!-- Appointment Details -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;padding:20px;margin-bottom:24px;border:1px solid #e2e8f0;">
            <tr><td style="padding:6px 0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="color:#64748b;font-size:13px;width:120px;padding-bottom:10px;">📅 Date</td>
                  <td style="color:#111827;font-size:14px;font-weight:700;padding-bottom:10px;">${opts.date}</td>
                </tr>
                <tr>
                  <td style="color:#64748b;font-size:13px;padding-bottom:10px;">⏰ Time</td>
                  <td style="color:#111827;font-size:14px;font-weight:700;padding-bottom:10px;">${opts.time}</td>
                </tr>
                ${serviceDesc ? `<tr><td style="color:#64748b;font-size:13px;padding-bottom:10px;">🚗 Service</td><td style="color:#111827;font-size:14px;padding-bottom:10px;">${serviceDesc}</td></tr>` : ""}
                ${addressLine ? `<tr><td style="color:#64748b;font-size:13px;">📍 Location</td><td style="color:#111827;font-size:14px;">${addressLine}</td></tr>` : ""}
              </table>
            </td></tr>
          </table>
          <!-- Confirm Button -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td align="center">
              <a href="${opts.confirmUrl}" 
                 style="display:inline-block;background:#22c55e;color:#ffffff;font-size:17px;font-weight:800;text-decoration:none;padding:16px 40px;border-radius:50px;letter-spacing:0.3px;box-shadow:0 4px 12px rgba(34,197,94,0.35);">
                ✅ Confirm My Appointment
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-align:center;">
            Button not working? <a href="${opts.confirmUrl}" style="color:#0a7ea4;">Click here to confirm</a>
          </p>
          <p style="margin:0 0 24px;color:#6b7280;font-size:13px;text-align:center;">
            Questions? Call or text us at <strong>850-517-7874</strong>
          </p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px;">
          <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
            Luxury Wash On Wheels · Automated Appointment Reminder<br>
            If you need to reschedule, please call us as soon as possible.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, html };
}

/** In-memory sets to avoid duplicate sends within the same server session */
const sentReminders = new Set<string>();   // jobId
const sentNoResponse = new Set<string>(); // jobId

/** Returns the current CST hour (0–23) */
function getCSTHour(): number {
  const nowCST = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  return nowCST.getHours();
}

/** Returns true if we are in the 9 AM send window (9:00–9:14 CST) — reminders fire here */
function isReminderWindow(): boolean {
  const nowCST = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  return nowCST.getHours() === 9 && nowCST.getMinutes() < 15;
}

/** Returns true if we are in the 7 AM send window (7:00–7:14 CST) — day-of nudge fires here */
function isDayOfNudgeWindow(): boolean {
  const nowCST = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  return nowCST.getHours() === 7 && nowCST.getMinutes() < 15;
}

export async function runApptConfirmationMonitor() {
  const conn = await getDb();
  try {
    const now = new Date();

    // ── SEND WINDOW CHECKS ──
    const inReminderWindow   = isReminderWindow();    // 9:00–9:14 AM CST
    const inDayOfNudgeWindow = isDayOfNudgeWindow();  // 7:00–7:14 AM CST
    if (!inReminderWindow && !inDayOfNudgeWindow) {
      console.log(`[ApptConfirm] Outside send windows (CST hour: ${getCSTHour()}) — skipping sends`);
    }

    // ── 1. SEND REMINDERS (9 AM window) ──
    // Pick up any upcoming job (within 72 hours) that hasn't been reminded yet.
    // Tokens are pre-generated at any time so the confirm link is ready when 9 AM arrives.
    // We only mark appt_reminder_sent = 1 AFTER the message is actually sent.
    const reminderWindowStart = new Date(now.getTime() + 1 * 60 * 60 * 1000);   // 1 hour from now
    const reminderWindowEnd   = new Date(now.getTime() + 72 * 60 * 60 * 1000);  // 72 hours from now

    // Format dates as MySQL-compatible strings for comparison
    const fmtMysql = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

    const [reminderJobs] = await conn.execute(
      `SELECT j.*, e.full_name as employee_name
       FROM schedule_jobs j
       LEFT JOIN employees e ON e.employee_id = j.assigned_to
       WHERE j.status NOT IN ('cancelled','completed')
         AND j.appt_reminder_sent = 0
         AND j.date IS NOT NULL
         AND (
           CASE
             WHEN j.start_hour IS NOT NULL THEN
               DATE_ADD(STR_TO_DATE(j.date, '%Y-%m-%d'), INTERVAL FLOOR(j.start_hour) HOUR)
             ELSE
               STR_TO_DATE(CONCAT(j.date, ' 08:00:00'), '%Y-%m-%d %H:%i:%s')
           END
         ) BETWEEN ? AND ?
         AND (j.customer_email IS NOT NULL AND j.customer_email != '' OR j.customer_phone IS NOT NULL AND j.customer_phone != '')`,
      [fmtMysql(reminderWindowStart), fmtMysql(reminderWindowEnd)]
    ) as [any[], any];

    for (const job of reminderJobs) {
      if (sentReminders.has(job.job_id)) continue;

      // Outside the 9 AM window: pre-generate the token so the confirm link is ready,
      // but do NOT send the email/SMS yet and do NOT mark as sent.
      // The 9 AM monitor run will pick it up and send it.
      if (!inReminderWindow) {
        // Pre-generate token if not already set
        if (!job.appt_confirm_token) {
          const token = generateToken();
          await conn.execute(
            `UPDATE schedule_jobs SET appt_confirm_token = ? WHERE job_id = ?`,
            [token, job.job_id]
          );
        }
        continue;
      }

      sentReminders.add(job.job_id);

      // Generate or reuse confirm token
      let token = job.appt_confirm_token;
      if (!token) {
        token = generateToken();
      }
      const confirmUrl = `${getBaseUrl()}/api/confirm/${token}`;

      const firstName = (job.customer_name ?? "").split(" ")[0] || "there";
      const dateStr = job.date ?? "";
      const timeStr = job.time_slot ?? "";

      // Calculate how many hours away the appointment is.
      // time_slot may be a range like "8:00 AM - Noon" or "1:00 PM - 4:00 PM";
      // extract only the start time for the calculation.
      let hoursAway = 48;
      try {
        // Strip everything after " - " (or " – ") to get just the start time
        const startTimeStr = timeStr.split(/\s*[-–]\s*/)[0].trim();
        // Normalise: "1:00pm" → "1:00 PM", "8:00" → "8:00"
        const normalised = startTimeStr.replace(/(am|pm)/i, (m: string) => ` ${m.toUpperCase()}`);
        // Build a parseable string: "2026-06-15 8:00 AM"
        const apptDate = new Date(`${dateStr} ${normalised}`);
        if (!isNaN(apptDate.getTime())) {
          const diff = Math.round((apptDate.getTime() - now.getTime()) / (1000 * 60 * 60));
          hoursAway = Math.max(1, diff);
        }
      } catch (_) {}

      let emailSent = false;
      let smsSent = false;

      // Send confirmation email
      if (job.customer_email && ENV.gmailUser) {
        try {
          const resolvedPackageType = await resolvePackageNameAsync(job.package_type).catch(() => job.package_type ?? null);
          const emailData = buildConfirmationReminderEmail({
            firstName,
            date: dateStr,
            time: timeStr,
            packageType: resolvedPackageType,
            vehicleType: job.vehicle_type ?? null,
            address: job.customer_address ?? null,
            city: job.city ?? null,
            location: job.location ?? null,
            confirmUrl,
            hoursAway,
          });
          await sendEmail({
            to: job.customer_email,
            subject: emailData.subject,
            html: emailData.html,
            type: "booking_confirmation",
            customerName: job.customer_name ?? "",
            bookingRef: job.job_id,
          });
          emailSent = true;
          console.log(`[ApptConfirm] Reminder email sent to ${job.customer_email} for job ${job.job_id}`);
        } catch (err) {
          console.error(`[ApptConfirm] Failed to send reminder email for job ${job.job_id}:`, err);
        }
      }

      // Send confirmation SMS
      if (job.customer_phone) {
        try {
          const smsBody = [
            `Hi ${firstName}! This is Luxury Wash On Wheels.`,
            `Your appointment is ${hoursAway <= 24 ? "TOMORROW" : `in ${Math.round(hoursAway / 24)} DAYS`} — ${dateStr} at ${timeStr}.`,
            `Please confirm: ${confirmUrl}`,
            `Or call/text 850-517-7874 with questions.`,
          ].join(" ");
          await sendSms(job.customer_phone, smsBody);
          smsSent = true;
        } catch (err) {
          console.error(`[ApptConfirm] Failed to send reminder SMS for job ${job.job_id}:`, err);
        }
      }

      // Only mark as sent if at least one channel succeeded
      if (emailSent || smsSent) {
        await conn.execute(
          `UPDATE schedule_jobs SET appt_confirm_token = ?, appt_reminder_sent = 1, appt_reminder_sent_at = NOW() WHERE job_id = ?`,
          [token, job.job_id]
        );
      }
    }

    // ── 2. DAY-OF NUDGE: 7 AM on appointment day, still unconfirmed ──
    // Only fires during the 7:00–7:14 AM CST window.
    // Looks for jobs scheduled TODAY (same calendar date in CST) that are still pending.
    // Get today's date in CST as YYYY-MM-DD (toISOString would give UTC, so we use locale formatting)
    const cstNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
    const todayCST = `${cstNow.getFullYear()}-${String(cstNow.getMonth() + 1).padStart(2, "0")}-${String(cstNow.getDate()).padStart(2, "0")}`;

    const [unconfirmedJobs] = inDayOfNudgeWindow
      ? await conn.execute(
          `SELECT j.*
           FROM schedule_jobs j
           WHERE j.status NOT IN ('cancelled','completed')
             AND j.appt_reminder_sent = 1
             AND j.appt_confirmation_status = 'pending'
             AND j.date = ?`,
          [todayCST]
        ) as [any[], any]
      : [[], null];

    for (const job of unconfirmedJobs) {
      if (sentNoResponse.has(job.job_id)) continue;
      sentNoResponse.add(job.job_id);

      // Mark as no_response in DB
      await conn.execute(
        `UPDATE schedule_jobs SET appt_confirmation_status = 'no_response' WHERE job_id = ?`,
        [job.job_id]
      );

      // Send urgent confirmation email to customer
      if (job.customer_email && job.appt_confirm_token && ENV.gmailUser) {
        try {
          const urgentConfirmUrl = `${getBaseUrl()}/api/confirm/${job.appt_confirm_token}`;
          const urgentFirstName = (job.customer_name ?? "").split(" ")[0] || "there";
          const resolvedUrgentPackageType = await resolvePackageNameAsync(job.package_type).catch(() => job.package_type ?? null);
          const urgentEmail = buildUrgentConfirmationEmail({
            firstName: urgentFirstName,
            date: job.date ?? "",
            time: job.time_slot ?? "",
            packageType: resolvedUrgentPackageType,
            vehicleType: job.vehicle_type ?? null,
            address: job.customer_address ?? null,
            city: job.city ?? null,
            location: job.location ?? null,
            confirmUrl: urgentConfirmUrl,
          });
          await sendEmail({
            to: job.customer_email,
            subject: urgentEmail.subject,
            html: urgentEmail.html,
            type: "booking_confirmation",
            customerName: job.customer_name ?? "",
            bookingRef: job.job_id,
          });
          console.log(`[ApptConfirm] Urgent confirmation email sent to ${job.customer_email} for job ${job.job_id}`);
        } catch (err) {
          console.error(`[ApptConfirm] Failed to send urgent email for job ${job.job_id}:`, err);
        }
      }

      // Notify all admin + sales employees
      try {
        const admins = await getAdminEmployees();
        for (const admin of admins) {
          await createNotification({
            notificationId: `APPT_NORESPONSE_${Date.now()}_${job.job_id}_${admin.employeeId}`,
            employeeId: admin.employeeId,
            fullName: admin.fullName ?? admin.employeeId,
            notificationType: "callback_reminder",
            title: `⚠️ Unconfirmed Appointment — Reach Out`,
            message: `${job.customer_name ?? "Customer"} has NOT confirmed their appointment today at ${job.time_slot}. Please call or text them to confirm.`,
            createdBy: "System",
            status: "unread",
            requiresAcknowledgment: "yes",
          });
        }
      } catch (err) {
        console.error(`[ApptConfirm] Failed to send no-response notification for job ${job.job_id}:`, err);
      }
      console.log(`[ApptConfirm] No-response alert sent for job ${job.job_id}`);
    }

  } catch (err) {
    console.error("[ApptConfirm] Monitor error:", err);
  } finally {
    await conn.end();
  }
}

export function startApptConfirmationMonitor() {
  runApptConfirmationMonitor().catch(console.error);
  setInterval(() => runApptConfirmationMonitor().catch(console.error), 5 * 60 * 1000);
  console.log("[ApptConfirm] Started — checking every 5 minutes");
}
