import nodemailer from "nodemailer";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { emailLogs, emailQueue } from "../drizzle/schema";
import { eq, lte, and } from "drizzle-orm";

// ─── Time Formatting Helpers ────────────────────────────────────────────────
/**
 * Converts a decimal hour like 11.5 to "11:30 AM" or 13.5 to "1:30 PM".
 * Handles already-formatted strings like "11:30 AM" by returning them unchanged.
 */
function formatDecimalHour(raw: string): string {
  // Already formatted (e.g. "11:30 AM") — return as-is
  if (/\d+:\d+\s*(AM|PM)/i.test(raw)) return raw;
  // Decimal hour like "11.5" or "13.5"
  const num = parseFloat(raw);
  if (isNaN(num)) return raw;
  const wholeHour = Math.floor(num);
  const mins = Math.round((num - wholeHour) * 60);
  const period = wholeHour >= 12 ? "PM" : "AM";
  const displayHour = wholeHour > 12 ? wholeHour - 12 : wholeHour === 0 ? 12 : wholeHour;
  return `${displayHour}:${mins.toString().padStart(2, "0")} ${period}`;
}

/**
 * Normalises a time slot string that may contain decimal hours.
 * e.g. "11.5:00 AM – 3.5:00 PM" → "11:30 AM – 3:30 PM"
 * e.g. "11:30 AM – 3:30 PM" → "11:30 AM – 3:30 PM" (unchanged)
 */
export function formatTimeSlot(slot: string): string {
  // Match decimal-hour patterns like "11.5:00 AM" or "3.5:00 PM"
  return slot.replace(/(\d+\.\d+):\d+\s*(AM|PM)/gi, (_match, decimal, ampm) => {
    const num = parseFloat(decimal);
    const wholeHour = Math.floor(num);
    const mins = Math.round((num - wholeHour) * 60);
    const displayHour = wholeHour > 12 ? wholeHour - 12 : wholeHour === 0 ? 12 : wholeHour;
    return `${displayHour}:${mins.toString().padStart(2, "0")} ${ampm.toUpperCase()}`;
  });
}

// ─── Quiet Hours Config ───────────────────────────────────────────────────────
// Emails are only sent between QUIET_START_HOUR and QUIET_END_HOUR (America/Chicago).
// Uses Intl.DateTimeFormat for proper DST handling (CDT = UTC-5, CST = UTC-6).
// Outside this window, emails are queued and sent at QUIET_START_HOUR the next day.
const QUIET_START_HOUR = 7;  // 7 AM
const QUIET_END_HOUR = 20;   // 8 PM

/** Returns the current hour in America/Chicago time (handles CDT/CST automatically). */
function currentHourCST(): number {
  const now = new Date();
  const chicagoHour = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    hour12: false,
  }).format(now);
  return parseInt(chicagoHour, 10) % 24;
}

/**
 * Returns true if the current time is within the allowed sending window (7 AM – 8 PM CST).
 */
function isWithinQuietHours(): boolean {
  const hour = currentHourCST();
  return hour < QUIET_START_HOUR || hour >= QUIET_END_HOUR;
}

/**
 * Computes the next 7 AM CST as a UTC Date.
 * Uses Intl.DateTimeFormat parts to avoid hardcoded UTC offsets (handles DST automatically).
 */
function nextSendWindowStart(): Date {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const get = (t: string) => parseInt(parts.find(p => p.type === t)?.value ?? '0', 10);
  const y = get('year'), mo = get('month'), d = get('day');
  // Build 7 AM CST today — use fixed -06:00 offset string; JS Date will normalise to UTC
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayAt7 = new Date(`${y}-${pad(mo)}-${pad(d)}T07:00:00-06:00`);
  // If that time has already passed, push to tomorrow
  if (todayAt7 <= now) {
    todayAt7.setDate(todayAt7.getDate() + 1);
  }
  return todayAt7;
}

export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  // Optional metadata for logging
  type?: "booking_confirmation" | "notification" | "other" | "review_request";
  customerName?: string;
  bookingRef?: string;
  /** When true, bypasses quiet hours and sends immediately (e.g. admin booking alerts) */
  urgent?: boolean;
};

/**
 * Creates a Gmail SMTP transporter using an App Password.
 * Requires GMAIL_USER and GMAIL_APP_PASSWORD environment variables.
 */
function createTransporter() {
  if (!ENV.gmailUser || !ENV.gmailAppPassword) {
    return null;
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: ENV.gmailUser,
      pass: ENV.gmailAppPassword,
    },
  });
}

/**
 * Sends an email via Gmail SMTP.
 * Returns true if sent successfully, false if Gmail credentials are not configured or send fails.
 *
 * If the current time is outside 7 AM – 8 PM CST, the email is queued for delivery
 * at 7 AM the next morning instead of being sent immediately.
 */
export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  // ── Quiet hours check ──────────────────────────────────────────────────────
  // Booking confirmations and urgent admin alerts always send immediately regardless of time of day.
  // All other email types (reminders, notifications) respect quiet hours (7 AM – 8 PM CST).
  if (payload.type !== "booking_confirmation" && !payload.urgent && isWithinQuietHours()) {
    const sendAfter = nextSendWindowStart();
    console.log(`[Email] Quiet hours — queuing email to ${payload.to} for ${sendAfter.toISOString()}`);
    await queueEmail(payload, sendAfter);
    return true; // treated as success (will be sent later)
  }

  return sendEmailNow(payload);
}

/**
 * Sends an email immediately, bypassing quiet hours. Used internally and by the queue processor.
 */
export async function sendEmailNow(payload: EmailPayload): Promise<boolean> {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn("[Email] Gmail credentials not configured — skipping email send.");
    return false;
  }

  try {
    await transporter.sendMail({
      from: `"Luxury Wash On Wheels" <${ENV.gmailUser}>`,
      to: payload.to,
      subject: payload.subject,
      text: payload.text ?? payload.html.replace(/<[^>]+>/g, ""),
      html: payload.html,
    });
    console.log(`[Email] Sent to ${payload.to}: ${payload.subject}`);
    await logEmail({ ...payload, status: "sent" });
    return true;
  } catch (err) {
    console.error("[Email] Failed to send:", err);
    await logEmail({ ...payload, status: "failed" });
    return false;
  }
}

/**
 * Saves an email to the queue for later delivery.
 */
async function queueEmail(payload: EmailPayload, sendAfter: Date): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const queueId = `eq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(emailQueue).values({
      queueId,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      textBody: payload.text ?? null,
      type: payload.type ?? "other",
      customerName: payload.customerName ?? null,
      bookingRef: payload.bookingRef ?? null,
      status: "pending",
      sendAfter,
    });
  } catch (e) {
    console.error("[Email] Failed to queue email:", e);
  }
}

/**
 * Processes the email queue — sends all pending emails whose sendAfter time has passed.
 * Should be called on a regular interval (e.g., every 5 minutes).
 */
export async function processEmailQueue(): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    const now = new Date();
    const pending = await db
      .select()
      .from(emailQueue)
      .where(and(eq(emailQueue.status, "pending"), lte(emailQueue.sendAfter, now)))
      .limit(20);

    if (pending.length === 0) return;
    console.log(`[EmailQueue] Processing ${pending.length} queued email(s)...`);

    for (const item of pending) {
      const success = await sendEmailNow({
        to: item.to,
        subject: item.subject,
        html: item.html,
        text: item.textBody ?? undefined,
        type: item.type,
        customerName: item.customerName ?? undefined,
        bookingRef: item.bookingRef ?? undefined,
      });
      await db
        .update(emailQueue)
        .set({ status: success ? "sent" : "failed", sentAt: new Date() })
        .where(eq(emailQueue.queueId, item.queueId));
    }
  } catch (e) {
    console.error("[EmailQueue] Error processing queue:", e);
  }
}

async function logEmail(payload: EmailPayload & { status: "sent" | "failed" }) {
  try {
    const db = await getDb();
    if (!db) return;
    const logId = `elog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(emailLogs).values({
      logId,
      to: payload.to,
      subject: payload.subject,
      type: payload.type ?? "other",
      customerName: payload.customerName ?? null,
      bookingRef: payload.bookingRef ?? null,
      status: payload.status,
      body: payload.html ?? null,
      sentAt: new Date(),
    });
  } catch (e) {
    // Logging failure should never break the main flow
    console.error("[Email] Failed to write log:", e);
  }
}

/**
 * Builds a branded booking confirmation email for a customer.
 */
export function buildBookingConfirmationEmail(opts: {
  customerName: string;
  bookingRef: string;
  packageName: string;
  vehicleLabel?: string;
  /** For multi-vehicle bookings: list of { label, packageName } for each vehicle */
  vehicles?: { label: string; packageName: string }[];
  scheduledDate: string;
  scheduledTime: string;
  addressLabel?: string;
  addons?: string[];
  total: number;
  /** If a discount was applied, the original pre-discount price */
  originalTotal?: number;
  /** Discount amount in dollars (e.g. 50 for $50 off) */
  discountAmount?: number;
  /** Discount code used, if any */
  discountCode?: string;
  notes?: string;
  /** If true, email subject says "Appointment Rescheduled" instead of "Booking Confirmed" */
  isReschedule?: boolean;
  /** If provided, renders a "Confirm My Appointment" button in the email */
  confirmUrl?: string;
}): { subject: string; html: string } {
  // Normalise time slot (handles decimal hours like "11.5:00 AM – 3.5:00 PM")
  const displayTime = formatTimeSlot(opts.scheduledTime);
  const subject = opts.isReschedule
    ? `Appointment Rescheduled — ${opts.packageName} on ${opts.scheduledDate}`
    : `Booking Confirmed — ${opts.packageName} on ${opts.scheduledDate}`;

  // Build vehicle rows — use multi-vehicle list if provided, otherwise fall back to single vehicleLabel
  let vehicleRows = "";
  if (opts.vehicles && opts.vehicles.length > 0) {
    vehicleRows = opts.vehicles.map((v, i) =>
      `<tr>
        <td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Vehicle ${i + 1}</td>
        <td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">${v.label}${v.packageName ? ` — <strong>${v.packageName}</strong>` : ""}</td>
      </tr>`
    ).join("");
  } else if (opts.vehicleLabel) {
    vehicleRows = `<tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Vehicle</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">${opts.vehicleLabel}</td></tr>`;
  }

  const addonRows = opts.addons && opts.addons.length > 0
    ? `<tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Add-ons</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">${opts.addons.join(", ")}</td></tr>`
    : "";

  const addressRow = opts.addressLabel
    ? `<tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Location</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">${opts.addressLabel}</td></tr>`
    : "";

  const notesRow = opts.notes
    ? `<tr><td style="padding:8px 0;color:#6B7280;font-size:14px;">Notes</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;">${opts.notes}</td></tr>`
    : "";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#0A0A0A;padding:20px 28px;">
            <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">Luxury Wash On Wheels</p>
            <p style="margin:4px 0 0;color:#9CA3AF;font-size:12px;">Mobile Detailing — We Come To You</p>
          </td>
        </tr>
        <!-- Success badge -->
        <tr>
          <td style="padding:24px 28px 0;">
            <div style="display:inline-flex;align-items:center;gap:6px;background:${opts.isReschedule ? '#EFF6FF' : '#DCFCE7'};color:${opts.isReschedule ? '#1D4ED8' : '#16A34A'};font-size:13px;font-weight:700;padding:6px 14px;border-radius:20px;">
              ${opts.isReschedule ? '📅 &nbsp;Appointment Rescheduled' : '✓ &nbsp;Booking Confirmed'}
            </div>
          </td>
        </tr>
        <!-- Greeting -->
        <tr>
          <td style="padding:16px 28px 0;">
            <h2 style="margin:0;color:#111827;font-size:22px;font-weight:700;line-height:1.3;">${opts.isReschedule ? `Your appointment has been updated, ${opts.customerName.split(' ')[0]}!` : `You're all set, ${opts.customerName.split(' ')[0]}!`}</h2>
            <p style="margin:8px 0 0;color:#6B7280;font-size:14px;line-height:1.6;">${opts.isReschedule ? 'Your appointment has been rescheduled. Here are your updated details.' : 'Your mobile detail has been booked. Here\'s a summary of your appointment.'}</p>
          </td>
        </tr>
        <!-- Booking details card -->
        <tr>
          <td style="padding:20px 28px;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border-radius:10px;padding:16px;border:1px solid #E5E7EB;">
              <tr><td style="padding:0 0 12px;color:#374151;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Booking Details</td></tr>
              <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Ref #</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #F3F4F6;">${opts.bookingRef}</td></tr>
              <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Service</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">${opts.packageName}</td></tr>
              ${vehicleRows}
              ${addonRows}
              <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Date</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">${opts.scheduledDate}</td></tr>
              <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Time</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">${displayTime}</td></tr>
              ${addressRow}
              ${notesRow}
              ${opts.discountAmount && opts.discountAmount > 0 && opts.originalTotal ? `<tr><td style="padding:8px 0 0;color:#6B7280;font-size:13px;">Original Price</td><td style="padding:8px 0 0;color:#9CA3AF;font-size:13px;text-align:right;text-decoration:line-through;">$${opts.originalTotal.toFixed(2)}</td></tr><tr><td style="padding:4px 0;color:#6B7280;font-size:13px;">Discount${opts.discountCode ? ` (${opts.discountCode})` : ""}</td><td style="padding:4px 0;color:#16A34A;font-size:13px;font-weight:600;text-align:right;">−$${opts.discountAmount.toFixed(2)}</td></tr>` : ""}
              <tr><td style="padding:12px 0 0;color:#111827;font-size:15px;font-weight:700;">Total</td><td style="padding:12px 0 0;color:#0057FF;font-size:16px;font-weight:800;text-align:right;">$${opts.total.toFixed(2)}</td></tr>
            </table>
          </td>
        </tr>
        <!-- Confirm button (only shown when confirmUrl is provided) -->
        ${opts.confirmUrl ? `
        <tr>
          <td style="padding:0 28px 20px;text-align:center;">
            <p style="margin:0 0 16px;color:#374151;font-size:14px;">Please confirm your appointment by clicking the button below:</p>
            <a href="${opts.confirmUrl}" style="display:inline-block;background:#dc2626;color:#ffffff;font-size:17px;font-weight:800;text-decoration:none;padding:16px 40px;border-radius:50px;letter-spacing:0.3px;box-shadow:0 4px 12px rgba(220,38,38,0.35);">&#x2705; Confirm My Appointment Now</a>
            <p style="margin:12px 0 0;color:#6b7280;font-size:13px;">Button not working? <a href="${opts.confirmUrl}" style="color:#dc2626;">Click here to confirm</a></p>
          </td>
        </tr>` : ''}
        <!-- What to expect -->
        <tr>
          <td style="padding:0 28px 28px;">
            <p style="margin:0 0 8px;color:#374151;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">What to Expect</p>
            <p style="margin:0;color:#6B7280;font-size:14px;line-height:1.7;">Our team will reach out to confirm your appointment. Please ensure your vehicle is accessible at the scheduled time. If you need to make any changes, reply to this email or contact us directly.</p>
            <p style="margin:16px 0 0;color:#9CA3AF;font-size:12px;">Luxury Wash On Wheels &nbsp;·&nbsp; luxurywashonwheels.com</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

/**
 * Builds a branded HTML email for a team member notification/alert.
 */
export function buildNotificationEmail(opts: {
  recipientName: string;
  notificationType: string;
  title: string;
  message?: string;
  requiresAcknowledgment: boolean;
  createdBy?: string;
}): { subject: string; html: string } {
  const typeLabels: Record<string, string> = {
    qc_issue: "QC Issue",
    write_up: "Write-Up",
    missed_step: "Missed Step",
    coaching_note: "Coaching Note",
    time_off_update: "Time Off Update",
    company_announcement: "Company Announcement",
    repair_request: "Repair Request",
  };

  const typeColors: Record<string, string> = {
    qc_issue: "#EF4444",
    write_up: "#DC2626",
    missed_step: "#F59E0B",
    coaching_note: "#2563EB",
    time_off_update: "#22C55E",
    company_announcement: "#6B7280",
    repair_request: "#F59E0B",
  };

  const label = typeLabels[opts.notificationType] ?? opts.notificationType;
  const color = typeColors[opts.notificationType] ?? "#6B7280";
  const ackNote = opts.requiresAcknowledgment
    ? `<p style="margin:16px 0 0;padding:12px 16px;background:#FEF2F2;border-left:4px solid #DC2626;border-radius:4px;color:#991B1B;font-size:14px;">
        <strong>Action Required:</strong> Please open the Luxury Wash On Wheels app and acknowledge this notice.
       </p>`
    : "";

  const subject = `[${label}] ${opts.title}`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#0A0A0A;padding:20px 28px;">
            <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">
              Luxury Wash On Wheels
            </p>
            <p style="margin:4px 0 0;color:#9CA3AF;font-size:12px;">Luxury Wash On Wheels</p>
          </td>
        </tr>
        <!-- Type badge -->
        <tr>
          <td style="padding:24px 28px 0;">
            <span style="display:inline-block;background:${color}20;color:${color};font-size:12px;font-weight:700;padding:4px 10px;border-radius:6px;letter-spacing:0.5px;">
              ${label.toUpperCase()}
            </span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:16px 28px 28px;">
            <p style="margin:0 0 4px;color:#6B7280;font-size:13px;">Hi ${opts.recipientName},</p>
            <h2 style="margin:8px 0 0;color:#111827;font-size:20px;font-weight:700;line-height:1.3;">${opts.title}</h2>
            ${opts.message ? `<p style="margin:14px 0 0;color:#374151;font-size:15px;line-height:1.6;">${opts.message}</p>` : ""}
            ${ackNote}
            <p style="margin:24px 0 0;color:#9CA3AF;font-size:12px;">
              Sent by ${opts.createdBy ?? "Management"} &nbsp;·&nbsp; Luxury Wash On Wheels
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

// ─── Admin New Booking Alert ───────────────────────────────────────────────
export function buildAdminBookingAlertEmail(opts: {
  customerName: string;
  customerEmail: string;
  bookingRef: string;
  packageName: string;
  vehicleLabel: string;
  scheduledDate: string;
  scheduledTime: string;
  city: string;
  addressLabel?: string;
  total: number;
  assignedDetailer?: string;
}) {
  const subject = `New Booking: ${opts.customerName} — ${opts.packageName} on ${opts.scheduledDate}`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <tr><td style="background:#0a7ea4;padding:24px 28px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">New Booking Alert</h1>
          <p style="margin:4px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">Luxury Wash On Wheels</p>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <p style="margin:0 0 16px;color:#374151;font-size:15px;">A new booking has been confirmed through the customer portal.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:16px;">
            <tr><td style="padding:4px 0;color:#6B7280;font-size:13px;width:140px;">Customer</td><td style="padding:4px 0;color:#111827;font-size:13px;font-weight:600;">${opts.customerName}</td></tr>
            <tr><td style="padding:4px 0;color:#6B7280;font-size:13px;">Email</td><td style="padding:4px 0;color:#111827;font-size:13px;">${opts.customerEmail}</td></tr>
            <tr><td style="padding:4px 0;color:#6B7280;font-size:13px;">Booking Ref</td><td style="padding:4px 0;color:#111827;font-size:13px;font-weight:600;">${opts.bookingRef}</td></tr>
            <tr><td style="padding:4px 0;color:#6B7280;font-size:13px;">Package</td><td style="padding:4px 0;color:#111827;font-size:13px;">${opts.packageName}</td></tr>
            <tr><td style="padding:4px 0;color:#6B7280;font-size:13px;">Vehicle</td><td style="padding:4px 0;color:#111827;font-size:13px;">${opts.vehicleLabel}</td></tr>
            <tr><td style="padding:4px 0;color:#6B7280;font-size:13px;">Date</td><td style="padding:4px 0;color:#111827;font-size:13px;">${opts.scheduledDate}</td></tr>
            <tr><td style="padding:4px 0;color:#6B7280;font-size:13px;">Time</td><td style="padding:4px 0;color:#111827;font-size:13px;">${opts.scheduledTime}</td></tr>
            <tr><td style="padding:4px 0;color:#6B7280;font-size:13px;">City</td><td style="padding:4px 0;color:#111827;font-size:13px;">${opts.city}</td></tr>
            ${opts.addressLabel ? `<tr><td style="padding:4px 0;color:#6B7280;font-size:13px;">Address</td><td style="padding:4px 0;color:#111827;font-size:13px;">${opts.addressLabel}</td></tr>` : ""}
            <tr><td style="padding:4px 0;color:#6B7280;font-size:13px;">Total</td><td style="padding:4px 0;color:#111827;font-size:13px;font-weight:700;">$${opts.total.toFixed(2)}</td></tr>
            ${opts.assignedDetailer ? `<tr><td style="padding:4px 0;color:#6B7280;font-size:13px;">Assigned To</td><td style="padding:4px 0;color:#0a7ea4;font-size:13px;font-weight:600;">${opts.assignedDetailer}</td></tr>` : ""}
          </table>
          <p style="margin:0;color:#9CA3AF;font-size:12px;">Luxury Wash On Wheels · Automated Booking Alert</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, html };
}

// ─── Admin Booking Change Alert (cancel / reschedule) ─────────────────────
export function buildAdminBookingChangeEmail(opts: {
  changeType: "cancellation" | "reschedule";
  customerName: string;
  customerEmail: string;
  bookingRef: string;
  packageName: string;
  vehicleLabel: string;
  originalDate: string;
  originalTime: string;
  newDate?: string;
  newTime?: string;
  city: string;
}) {
  const isCancel = opts.changeType === "cancellation";
  const subject = isCancel
    ? `Booking Cancelled: ${opts.customerName} — ${opts.bookingRef}`
    : `Booking Rescheduled: ${opts.customerName} — ${opts.bookingRef}`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <tr><td style="background:${isCancel ? "#EF4444" : "#F59E0B"};padding:24px 28px;">
          <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">${isCancel ? "Booking Cancelled" : "Booking Rescheduled"}</h1>
          <p style="margin:4px 0 0;color:rgba(255,255,255,0.85);font-size:13px;">Luxury Wash On Wheels · Customer Portal</p>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <p style="margin:0 0 16px;color:#374151;font-size:15px;">A customer has ${isCancel ? "cancelled" : "rescheduled"} their booking.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;padding:16px;margin-bottom:16px;">
            <tr><td style="padding:4px 0;color:#6B7280;font-size:13px;width:140px;">Customer</td><td style="padding:4px 0;color:#111827;font-size:13px;font-weight:600;">${opts.customerName}</td></tr>
            <tr><td style="padding:4px 0;color:#6B7280;font-size:13px;">Email</td><td style="padding:4px 0;color:#111827;font-size:13px;">${opts.customerEmail}</td></tr>
            <tr><td style="padding:4px 0;color:#6B7280;font-size:13px;">Booking Ref</td><td style="padding:4px 0;color:#111827;font-size:13px;font-weight:600;">${opts.bookingRef}</td></tr>
            <tr><td style="padding:4px 0;color:#6B7280;font-size:13px;">Package</td><td style="padding:4px 0;color:#111827;font-size:13px;">${opts.packageName}</td></tr>
            <tr><td style="padding:4px 0;color:#6B7280;font-size:13px;">Vehicle</td><td style="padding:4px 0;color:#111827;font-size:13px;">${opts.vehicleLabel}</td></tr>
            <tr><td style="padding:4px 0;color:#6B7280;font-size:13px;">Original Date</td><td style="padding:4px 0;color:${isCancel ? "#EF4444" : "#6B7280"};font-size:13px;${isCancel ? "text-decoration:line-through;" : ""}">${opts.originalDate} · ${opts.originalTime}</td></tr>
            ${opts.newDate ? `<tr><td style="padding:4px 0;color:#6B7280;font-size:13px;">New Date</td><td style="padding:4px 0;color:#0a7ea4;font-size:13px;font-weight:600;">${opts.newDate} · ${opts.newTime ?? ""}</td></tr>` : ""}
            <tr><td style="padding:4px 0;color:#6B7280;font-size:13px;">City</td><td style="padding:4px 0;color:#111827;font-size:13px;">${opts.city}</td></tr>
          </table>
          <p style="margin:0;color:#9CA3AF;font-size:12px;">Luxury Wash On Wheels · Automated Booking Alert</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, html };
}

/**
 * Builds an urgent "please confirm NOW" email for the 4-7 hour no-response window.
 */
export function buildUrgentConfirmationEmail(opts: {
  firstName: string;
  date: string;
  time: string;
  packageType?: string | null;
  vehicleType?: string | null;
  address?: string | null;
  city?: string | null;
  location?: string | null;  // city slug fallback e.g. "destin"
  confirmUrl: string;
}): { subject: string; html: string } {
  // Determine if the appointment is today or tomorrow (CST)
  const nowCST = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const todayStr = `${nowCST.getFullYear()}-${String(nowCST.getMonth()+1).padStart(2,"0")}-${String(nowCST.getDate()).padStart(2,"0")}`;
  const tomorrowCST = new Date(nowCST);
  tomorrowCST.setDate(tomorrowCST.getDate() + 1);
  const tomorrowStr = `${tomorrowCST.getFullYear()}-${String(tomorrowCST.getMonth()+1).padStart(2,"0")}-${String(tomorrowCST.getDate()).padStart(2,"0")}`;
  // opts.date may be formatted (e.g. "2026-06-03") or human-readable — try to parse it
  const apptDateRaw = opts.date.trim();
  const isTomorrow = apptDateRaw === tomorrowStr || apptDateRaw.startsWith(tomorrowStr);
  const isToday = apptDateRaw === todayStr || apptDateRaw.startsWith(todayStr);

  // Calculate hours until appointment for dynamic time label
  let hoursUntilAppt: number | null = null;
  if (isToday && opts.time) {
    try {
      // Parse time like "10:00 AM" or "10:00"
      const timeMatch = opts.time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (timeMatch) {
        let apptHour = parseInt(timeMatch[1], 10);
        const apptMin = parseInt(timeMatch[2], 10);
        const meridiem = (timeMatch[3] ?? "").toUpperCase();
        if (meridiem === "PM" && apptHour < 12) apptHour += 12;
        if (meridiem === "AM" && apptHour === 12) apptHour = 0;
        const apptMinutes = apptHour * 60 + apptMin;
        const nowMinutes = nowCST.getHours() * 60 + nowCST.getMinutes();
        const diffMins = apptMinutes - nowMinutes;
        if (diffMins > 0) hoursUntilAppt = Math.round(diffMins / 60);
      }
    } catch (_) {}
  }

  // Build the time phrase shown in the header and body
  let whenLabel: string;
  let whenBody: string;
  let headerSubLabel: string;
  if (isToday && hoursUntilAppt !== null && hoursUntilAppt > 0) {
    const hrWord = hoursUntilAppt === 1 ? "1 hour" : `${hoursUntilAppt} hours`;
    whenLabel = `IN ${hrWord.toUpperCase()}`;
    whenBody = `in <strong>${hrWord}</strong>`;
    headerSubLabel = `Your appointment starts in ${hrWord} — please confirm using the link below`;
  } else if (isToday) {
    whenLabel = "TODAY";
    whenBody = "today";
    headerSubLabel = "Your appointment is today — please confirm using the link below";
  } else if (isTomorrow) {
    whenLabel = "TOMORROW";
    whenBody = "tomorrow";
    headerSubLabel = "Your appointment is tomorrow — please confirm using the link below";
  } else {
    whenLabel = "SOON";
    whenBody = "soon";
    headerSubLabel = "Your appointment is coming up — please confirm using the link below";
  }

  const subject = `⚠️ URGENT: Please Confirm Your Appointment ${whenLabel}`;
  const serviceDesc = [opts.vehicleType, opts.packageType].filter(Boolean).join(" — ");
  // Build a human-readable city label from slug (e.g. "fort_walton_beach" → "Fort Walton Beach, FL")
  const citySlug = opts.city || opts.location || null;
  const cityLabel = citySlug
    ? citySlug.split(/[_\s]+/).map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') + ', FL'
    : null;
  const addressLine = opts.address
    ? [opts.address, cityLabel].filter(Boolean).join(', ')
    : cityLabel;

  const serviceRow = serviceDesc
    ? "<tr><td style=\"color:#64748b;font-size:13px;width:120px;padding-bottom:10px;\">\ud83d\ude97 Service</td>" +
      "<td style=\"color:#111827;font-size:14px;padding-bottom:10px;\">" + serviceDesc + "</td></tr>"
    : "";
  const locationRow = addressLine
    ? "<tr><td style=\"color:#64748b;font-size:13px;\">\ud83d\udccd Location</td>" +
      "<td style=\"color:#111827;font-size:14px;\">" + addressLine + "</td></tr>"
    : "";

  const html =
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head>" +
    "<body style=\"margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;\">" +
    "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#f3f4f6;padding:32px 16px;\">" +
    "<tr><td align=\"center\">" +
    "<table width=\"100%\" style=\"max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.10);\">" +
    "<tr><td style=\"background:linear-gradient(135deg,#dc2626 0%,#b91c1c 100%);padding:32px 28px;text-align:center;\">" +
    "<div style=\"font-size:48px;margin-bottom:12px;\">\u26a0\ufe0f</div>" +
    "<h1 style=\"margin:0;color:#ffffff;font-size:24px;font-weight:800;\">Action Required</h1>" +
    "<p style=\"margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;\">" + headerSubLabel + "</p>" +
    "</td></tr>" +
    "<tr><td style=\"padding:28px;\">" +
    "<p style=\"margin:0 0 16px;color:#374151;font-size:16px;line-height:1.6;\">Hi <strong>" + opts.firstName + "</strong>,</p>" +
    "<p style=\"margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;\">We still haven't received your confirmation for your appointment " + whenBody + ". Please confirm using the link below so we can keep your detailer on schedule.</p>" +
    "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#fef2f2;border-radius:12px;padding:20px;margin-bottom:24px;border:1px solid #fecaca;\">" +
    "<tr><td><table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\">" +
    "<tr><td style=\"color:#64748b;font-size:13px;width:120px;padding-bottom:10px;\">\ud83d\udcc5 Date</td>" +
    "<td style=\"color:#111827;font-size:14px;font-weight:700;padding-bottom:10px;\">" + opts.date + "</td></tr>" +
    "<tr><td style=\"color:#64748b;font-size:13px;padding-bottom:10px;\">\u23f0 Time</td>" +
    "<td style=\"color:#111827;font-size:14px;font-weight:700;padding-bottom:10px;\">" + opts.time + "</td></tr>" +
    serviceRow + locationRow +
    "</table></td></tr></table>" +
    "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin-bottom:24px;\">" +
    "<tr><td align=\"center\">" +
    "<a href=\"" + opts.confirmUrl + "\" style=\"display:inline-block;background:#dc2626;color:#ffffff;font-size:17px;font-weight:800;text-decoration:none;padding:16px 40px;border-radius:50px;letter-spacing:0.3px;box-shadow:0 4px 12px rgba(220,38,38,0.35);\">\u2705 Confirm My Appointment Now</a>" +
    "</td></tr></table>" +
    "<p style=\"margin:0 0 8px;color:#6b7280;font-size:13px;text-align:center;\">Button not working? <a href=\"" + opts.confirmUrl + "\" style=\"color:#dc2626;\">Click here to confirm</a></p>" +
    "<p style=\"margin:0 0 24px;color:#6b7280;font-size:13px;text-align:center;\">Need to reschedule? Call or text us immediately at <strong>850-517-7874</strong></p>" +
    "<hr style=\"border:none;border-top:1px solid #e5e7eb;margin:0 0 16px;\">" +
    "<p style=\"margin:0;color:#9ca3af;font-size:12px;text-align:center;\">Luxury Wash On Wheels \u00b7 Automated Appointment Reminder<br>If you do not confirm, we may need to reassign your detailer.</p>" +
    "</td></tr></table></td></tr></table></body></html>";

  return { subject, html };
}

/**
 * Builds an "On My Way" email with a live tracking link for the customer.
 */
export function buildOnTheWayEmail(opts: {
  customerFirstName: string;
  detailerFirstName: string;
  trackUrl: string;
  phone: string;
}): { subject: string; html: string } {
  const subject = `🚗 Your detailer ${opts.detailerFirstName} is on the way!`;

  const html =
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"></head>" +
    "<body style=\"margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;\">" +
    "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#f3f4f6;padding:32px 16px;\">" +
    "<tr><td align=\"center\">" +
    "<table width=\"100%\" style=\"max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.10);\">" +
    "<tr><td style=\"background:linear-gradient(135deg,#0057FF 0%,#0041CC 100%);padding:32px 28px;text-align:center;\">" +
    "<div style=\"font-size:48px;margin-bottom:12px;\">🚗</div>" +
    "<h1 style=\"margin:0;color:#ffffff;font-size:24px;font-weight:800;\">Your Detailer Is On The Way!</h1>" +
    "<p style=\"margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;\">Track their live location below</p>" +
    "</td></tr>" +
    "<tr><td style=\"padding:28px;\">" +
    "<p style=\"margin:0 0 16px;color:#374151;font-size:16px;line-height:1.6;\">Hi <strong>" + opts.customerFirstName + "</strong>,</p>" +
    "<p style=\"margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;\"><strong>" + opts.detailerFirstName + "</strong> is on their way to you right now. You can track their live location using the button below.</p>" +
    "<table width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"margin-bottom:24px;\">" +
    "<tr><td align=\"center\">" +
    "<a href=\"" + opts.trackUrl + "\" style=\"display:inline-block;background:#0057FF;color:#ffffff;font-size:17px;font-weight:800;text-decoration:none;padding:16px 40px;border-radius:50px;letter-spacing:0.3px;box-shadow:0 4px 12px rgba(0,87,255,0.35);\">📍 Track Live Location</a>" +
    "</td></tr></table>" +
    "<p style=\"margin:0 0 8px;color:#6b7280;font-size:13px;text-align:center;\">Button not working? <a href=\"" + opts.trackUrl + "\" style=\"color:#0057FF;\">Click here to track</a></p>" +
    "<p style=\"margin:0 0 24px;color:#6b7280;font-size:13px;text-align:center;\">Questions? Call or text us at <strong>850-517-7874</strong></p>" +
    "<hr style=\"border:none;border-top:1px solid #e5e7eb;margin:0 0 16px;\">" +
    "<p style=\"margin:0;color:#9ca3af;font-size:12px;text-align:center;\">Luxury Wash On Wheels &middot; We'll see you soon!</p>" +
    "</td></tr></table></td></tr></table></body></html>";

  return { subject, html };
}

/**
 * Builds a branded abandoned cart recovery email.
 * Sent 30 minutes after a visitor fills in personal info but never completes booking.
 * Includes a direct link back to the city-specific booking page.
 */
export function buildAbandonedCartRecoveryEmail(opts: {
  firstName: string;
  lastName: string;
  vehicleType?: string | null;
  packageType?: string | null;
  cityBookingUrl: string;
  cityLabel: string;
}): { subject: string; html: string } {
  const name = opts.firstName;
  const serviceHint = opts.packageType
    ? `your <strong>${opts.packageType}</strong> quote`
    : "your detail quote";
  const vehicleHint = opts.vehicleType ? ` for your <strong>${opts.vehicleType}</strong>` : "";
  const subject = `${name}, you left something behind 🚗 — your spot is still open!`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#0A0A0A;padding:20px 28px;">
            <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">Luxury Wash On Wheels</p>
            <p style="margin:4px 0 0;color:#9CA3AF;font-size:12px;">Mobile Detailing — We Come To You</p>
          </td>
        </tr>
        <!-- Emoji hero -->
        <tr>
          <td style="padding:32px 28px 0;text-align:center;">
            <div style="font-size:52px;line-height:1;">🚐✨</div>
          </td>
        </tr>
        <!-- Greeting -->
        <tr>
          <td style="padding:16px 28px 0;">
            <h2 style="margin:0;color:#111827;font-size:22px;font-weight:700;line-height:1.3;">Hey ${name}, your spot is still available!</h2>
            <p style="margin:10px 0 0;color:#6B7280;font-size:15px;line-height:1.7;">
              We noticed you started ${serviceHint}${vehicleHint} in <strong>${opts.cityLabel}</strong> but didn't finish your booking.
              No worries — we saved your info and your spot is still open.
            </p>
          </td>
        </tr>
        <!-- CTA button -->
        <tr>
          <td style="padding:28px 28px 8px;text-align:center;">
            <a href="${opts.cityBookingUrl}"
               style="display:inline-block;background:#0A7EA4;color:#ffffff;font-size:16px;font-weight:700;padding:16px 36px;border-radius:10px;text-decoration:none;letter-spacing:-0.2px;">
              Complete My Booking →
            </a>
          </td>
        </tr>
        <!-- Reassurance -->
        <tr>
          <td style="padding:16px 28px 28px;">
            <p style="margin:0;color:#9CA3AF;font-size:13px;text-align:center;line-height:1.6;">
              Takes less than 2 minutes. We come to you — no drop-off needed.<br>
              Questions? Call or text <strong>850-517-7874</strong>
            </p>
            <p style="margin:24px 0 0;color:#D1D5DB;font-size:11px;text-align:center;">
              Luxury Wash On Wheels &nbsp;·&nbsp; luxurywashonwheels.com<br>
              You're receiving this because you started a booking on our website.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, html };
}

/**
 * Builds a late arrival notification email for customers.
 * Sent when a detailer taps "Running Late" on their schedule screen.
 */
export function buildLateArrivalEmail(opts: {
  customerFirstName: string;
  detailerName: string;
  delayMinutes: number;
  newEta: string;
  phone: string;
}): { subject: string; html: string } {
  const subject = `⏰ Update: Your Detailer is Running a Little Late — Luxury Wash On Wheels`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#0A0A0A;padding:20px 28px;">
            <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">Luxury Wash On Wheels</p>
            <p style="margin:4px 0 0;color:#9CA3AF;font-size:12px;">Mobile Detailing — We Come To You</p>
          </td>
        </tr>
        <!-- Amber banner -->
        <tr>
          <td style="background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);padding:28px;text-align:center;">
            <div style="font-size:48px;margin-bottom:10px;">⏰</div>
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;">Running a Little Late</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.9);font-size:14px;">We appreciate your patience</p>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:28px;">
            <p style="margin:0 0 16px;color:#374151;font-size:16px;line-height:1.6;">Hi <strong>${opts.customerFirstName}</strong>,</p>
            <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
              Your Luxury Wash On Wheels detailer <strong>${opts.detailerName.split(" ")[0]}</strong> is running approximately <strong>${opts.delayMinutes} minutes</strong> behind schedule.
            </p>
            <!-- ETA card -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef3c7;border-radius:10px;padding:20px;margin-bottom:24px;border:1px solid #fde68a;">
              <tr><td>
                <table width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="color:#92400e;font-size:13px;width:140px;padding-bottom:10px;">⏱ Delay</td>
                    <td style="color:#78350f;font-size:15px;font-weight:700;padding-bottom:10px;">~${opts.delayMinutes} minutes</td>
                  </tr>
                  <tr>
                    <td style="color:#92400e;font-size:13px;">🕐 New ETA</td>
                    <td style="color:#78350f;font-size:15px;font-weight:700;">${opts.newEta}</td>
                  </tr>
                </table>
              </td></tr>
            </table>
            <p style="margin:0 0 24px;color:#374151;font-size:14px;line-height:1.6;text-align:center;">
              We sincerely apologize for the inconvenience and truly appreciate your patience!
            </p>
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px;">
            <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-align:center;">Questions? Call or text us at <strong>850-517-7874</strong></p>
            <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">Luxury Wash On Wheels &nbsp;·&nbsp; We'll be there soon!</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, html };
}

/**
 * Builds a job site inspection report email sent to the detailer after an inspection is submitted.
 */
export function buildInspectionReportEmail(opts: {
  detailerName: string;
  opsManagerName: string;
  inspectedAt: string;
  jobAddress?: string;
  overallPass: boolean;
  notes?: string;
  items: Array<{ checkLabel: string; passed: boolean; notes?: string }>;
}): { subject: string; html: string } {
  const passCount = opts.items.filter((i) => i.passed).length;
  const failCount = opts.items.length - passCount;
  const statusColor = opts.overallPass ? "#16A34A" : "#DC2626";
  const statusBg = opts.overallPass ? "#F0FDF4" : "#FEF2F2";
  const statusIcon = opts.overallPass ? "✅" : "⚠️";
  const statusText = opts.overallPass ? "Inspection Passed" : `${failCount} Item${failCount !== 1 ? "s" : ""} Failed`;

  const failedItems = opts.items.filter((i) => !i.passed);

  const subject = `${statusIcon} Job Site Inspection Report — ${opts.detailerName} — ${new Date(opts.inspectedAt).toLocaleDateString()}`;

  const itemRows = opts.items.map((item) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:13px;">${item.checkLabel}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:700;color:${item.passed ? "#16A34A" : "#DC2626"};font-size:13px;">${item.passed ? "✓ Pass" : "✗ Fail"}</td>
    </tr>
    ${!item.passed && item.notes ? `<tr><td colspan="2" style="padding:6px 12px 10px;border-bottom:1px solid #e5e7eb;background:#FEF2F2;color:#DC2626;font-size:12px;font-style:italic;">↳ ${item.notes}</td></tr>` : ""}
  `).join("");

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:580px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#0A0A0A;padding:20px 28px;">
            <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;">Luxury Wash On Wheels</p>
            <p style="margin:4px 0 0;color:#9CA3AF;font-size:12px;">Job Site Inspection Report</p>
          </td>
        </tr>
        <!-- Status banner -->
        <tr>
          <td style="background:${statusBg};padding:24px 28px;text-align:center;border-bottom:2px solid ${statusColor}20;">
            <div style="font-size:40px;margin-bottom:8px;">${statusIcon}</div>
            <h1 style="margin:0;color:${statusColor};font-size:22px;font-weight:800;">${statusText}</h1>
            <p style="margin:6px 0 0;color:#6B7280;font-size:14px;">${new Date(opts.inspectedAt).toLocaleString()}</p>
          </td>
        </tr>
        <!-- Details -->
        <tr>
          <td style="padding:24px 28px;">
            <p style="margin:0 0 4px;color:#374151;font-size:15px;">Hi <strong>${opts.detailerName.split(" ")[0]}</strong>,</p>
            <p style="margin:0 0 20px;color:#6B7280;font-size:14px;line-height:1.6;">
              Here is your job site inspection report submitted by <strong>${opts.opsManagerName}</strong>.
              ${opts.jobAddress ? `Location: <strong>${opts.jobAddress}</strong>.` : ""}
            </p>
            <!-- Summary row -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border-radius:10px;padding:16px;margin-bottom:24px;border:1px solid #E5E7EB;">
              <tr>
                <td style="text-align:center;padding:0 12px;">
                  <div style="font-size:22px;font-weight:800;color:#374151;">${opts.items.length}</div>
                  <div style="font-size:11px;color:#9CA3AF;margin-top:2px;">Total Items</div>
                </td>
                <td style="text-align:center;padding:0 12px;border-left:1px solid #E5E7EB;">
                  <div style="font-size:22px;font-weight:800;color:#16A34A;">${passCount}</div>
                  <div style="font-size:11px;color:#9CA3AF;margin-top:2px;">Passed</div>
                </td>
                <td style="text-align:center;padding:0 12px;border-left:1px solid #E5E7EB;">
                  <div style="font-size:22px;font-weight:800;color:${failCount > 0 ? "#DC2626" : "#9CA3AF"};">${failCount}</div>
                  <div style="font-size:11px;color:#9CA3AF;margin-top:2px;">Failed</div>
                </td>
              </tr>
            </table>
            <!-- Checklist table -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB;border-radius:10px;overflow:hidden;margin-bottom:20px;">
              <tr style="background:#F9FAFB;">
                <th style="padding:10px 12px;text-align:left;color:#6B7280;font-size:12px;font-weight:600;border-bottom:1px solid #E5E7EB;">Checklist Item</th>
                <th style="padding:10px 12px;text-align:center;color:#6B7280;font-size:12px;font-weight:600;border-bottom:1px solid #E5E7EB;width:90px;">Result</th>
              </tr>
              ${itemRows}
            </table>
            ${opts.notes ? `<div style="background:#F9FAFB;border-radius:10px;padding:14px;border:1px solid #E5E7EB;margin-bottom:20px;"><p style="margin:0 0 4px;color:#374151;font-size:13px;font-weight:600;">Additional Notes</p><p style="margin:0;color:#6B7280;font-size:13px;line-height:1.5;">${opts.notes}</p></div>` : ""}
            ${failedItems.length > 0 ? `<div style="background:#FEF2F2;border-radius:10px;padding:14px;border:1px solid #FECACA;margin-bottom:20px;"><p style="margin:0 0 8px;color:#DC2626;font-size:13px;font-weight:700;">⚠️ Items Requiring Attention</p>${failedItems.map((i) => `<p style="margin:0 0 4px;color:#DC2626;font-size:13px;">• ${i.checkLabel}${i.notes ? `: ${i.notes}` : ""}</p>`).join("")}</div>` : ""}
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px;">
            <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">Luxury Wash On Wheels &nbsp;·&nbsp; Job Site Inspection System</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

// ─── City → Google Review Link Map ───────────────────────────────────────────
export const CITY_REVIEW_LINKS: Record<string, string> = {
  "crestview":        "https://search.google.com/local/writereview?placeid=ChIJ03fG3g1zkYgRN-BztFseQjs&source=g.page.m.nr._&laa=nmx-review-solicitation-recommendation-card",
  "destin":           "https://search.google.com/local/writereview?placeid=ChIJmRYS9IhDkYgRJr2ZnvdfM4o&source=g.page.m.nr._&laa=nmx-review-solicitation-recommendation-card",
  "fort walton beach":"https://search.google.com/local/writereview?placeid=ChIJe2R3X1eZCwMRylxFjIm-WiM&source=g.page.m.nr._&laa=nmx-review-solicitation-recommendation-card",
  "fwb":              "https://search.google.com/local/writereview?placeid=ChIJe2R3X1eZCwMRylxFjIm-WiM&source=g.page.m.nr._&laa=nmx-review-solicitation-recommendation-card",
  "niceville":        "https://search.google.com/local/writereview?placeid=ChIJ6TIb439pkYgRSJD2B2z-p3c&source=g.page.m.nr._&laa=nmx-review-solicitation-recommendation-card",
  "pensacola":        "https://search.google.com/local/writereview?placeid=ChIJqeErDLkNkYgRY3GW05fBktM&source=g.page.m.np._&laa=nmx-review-solicitation-promoted-recommendation-card",
};

/**
 * Returns the Google review link for the given city (case-insensitive).
 * Falls back to the Crestview link if city is unknown.
 */
export function getReviewLinkForCity(city?: string | null): string {
  const key = (city ?? "").toLowerCase().trim();
  return CITY_REVIEW_LINKS[key] ?? CITY_REVIEW_LINKS["crestview"];
}

/**
 * Builds a branded review request email sent 1 hour after job completion.
 */
export function buildReviewRequestEmail(opts: {
  customerName: string;
  detailerFirstName: string;
  serviceType: string;
  city: string;
  reviewLink: string;
}): { subject: string; html: string } {
  const firstName = opts.customerName.split(" ")[0] || opts.customerName;
  const subject = `How was your detail, ${firstName}? Leave us a quick review ⭐`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#0A0A0A;padding:24px 32px;text-align:center;">
            <p style="margin:0;color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-0.3px;">Luxury Wash On Wheels</p>
            <p style="margin:4px 0 0;color:#9CA3AF;font-size:13px;">Premium Mobile Detailing</p>
          </td>
        </tr>
        <!-- Star banner -->
        <tr>
          <td style="background:#FFFBEB;padding:28px 32px;text-align:center;border-bottom:2px solid #FDE68A;">
            <div style="font-size:44px;margin-bottom:8px;">⭐⭐⭐⭐⭐</div>
            <h1 style="margin:0;color:#92400E;font-size:22px;font-weight:800;">How was your detail?</h1>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px 32px 24px;">
            <p style="margin:0 0 16px;color:#111827;font-size:16px;line-height:1.6;">
              Hi <strong>${firstName}</strong>,
            </p>
            <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.7;">
              Thank you for choosing Luxury Wash On Wheels for your <strong>${opts.serviceType}</strong> today in <strong>${opts.city}</strong>. We hope ${opts.detailerFirstName} took great care of your vehicle!
            </p>
            <p style="margin:0 0 28px;color:#374151;font-size:15px;line-height:1.7;">
              If you had a great experience, we'd love it if you could take 30 seconds to leave us a Google review. It means the world to our team and helps other customers find us.
            </p>
            <!-- Video thumbnail (links to the follow-up video) -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
              <tr>
                <td align="center">
                  <a href="https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/yZPWjzzAkKdwFsJe.mp4" style="display:block;text-decoration:none;">
                    <div style="position:relative;background:#0A0A0A;border-radius:12px;overflow:hidden;max-width:460px;margin:0 auto;">
                      <img src="https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/yZPWjzzAkKdwFsJe.mp4" alt="Watch our message" width="460" style="display:block;width:100%;height:auto;opacity:0;" />
                      <div style="background:#0A0A0A;border-radius:12px;padding:32px 24px;text-align:center;border:2px solid #F5C518;">
                        <div style="font-size:48px;margin-bottom:8px;">▶️</div>
                        <p style="margin:0;color:#F5C518;font-size:16px;font-weight:800;">Watch Our Thank You Message</p>
                        <p style="margin:6px 0 0;color:rgba(255,255,255,0.6);font-size:13px;">A personal message from the Luxury Wash On Wheels team</p>
                      </div>
                    </div>
                  </a>
                </td>
              </tr>
            </table>
            <!-- CTA Button -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center">
                  <a href="${opts.reviewLink}"
                     style="display:inline-block;background:#0A0A0A;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:16px 40px;border-radius:50px;letter-spacing:0.2px;">
                    ⭐ Leave a Google Review
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:24px 0 0;color:#9CA3AF;font-size:13px;text-align:center;line-height:1.6;">
              It only takes 30 seconds and helps us grow our small business.<br>
              Thank you so much — we appreciate your support! 🙏
            </p>
            <!-- Copy-paste review section -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px;">
              <tr>
                <td style="background:#FFFBEB;border-radius:12px;padding:20px 24px;border:1px solid #FDE68A;">
                  <p style="margin:0 0 8px;color:#92400E;font-size:14px;font-weight:800;text-align:center;">Don't have time to write your own review?</p>
                  <p style="margin:0 0 14px;color:#78350F;font-size:13px;text-align:center;line-height:1.6;">Copy and paste the text below directly into Google — it's ready to go!</p>
                  <div style="background:#ffffff;border-radius:8px;padding:14px 16px;border:1px solid #FDE68A;">
                    <p style="margin:0;color:#374151;font-size:13px;line-height:1.7;font-style:italic;">
                      &ldquo;I just had an amazing mobile detailing experience with Luxury Wash On Wheels in ${opts.city ? opts.city.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : 'my area'}! ${opts.detailerFirstName} did a fantastic job — my car looks brand new. If you&rsquo;re looking for professional mobile detailing in ${opts.city ? opts.city.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : 'my area'}, I highly recommend them. 5 stars all the way! ⭐⭐⭐⭐⭐&rdquo;
                    </p>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#F9FAFB;padding:16px 32px;border-top:1px solid #E5E7EB;text-align:center;">
            <p style="margin:0;color:#9CA3AF;font-size:12px;">
              Luxury Wash On Wheels &nbsp;·&nbsp; ${opts.city} &nbsp;·&nbsp; <a href="https://luxurywashonwheels.app" style="color:#6B7280;text-decoration:none;">luxurywashonwheels.app</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html };
}

export function buildTipRequestEmail(opts: {
  customerFirstName: string;
  detailerName: string;
  serviceTitle: string;
  serviceTotal: string;
  cardBrand: string;
  cardLast4: string;
  tipUrl: string;
}): { subject: string; html: string } {
  const subject = `Leave a Tip for Your Detailer — Luxury Wash On Wheels`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;"><tr><td align="center"><table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);"><tr><td style="background:#0A0A0A;padding:20px 28px;"><p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;">Luxury Wash On Wheels</p><p style="margin:4px 0 0;color:#9CA3AF;font-size:12px;">Mobile Detailing</p></td></tr><tr><td style="background:linear-gradient(135deg,#059669 0%,#047857 100%);padding:28px;text-align:center;"><div style="font-size:48px;margin-bottom:10px;">✨</div><h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;">Your Service is Complete!</h1><p style="margin:6px 0 0;color:rgba(255,255,255,0.9);font-size:14px;">Would you like to leave a tip for ${opts.detailerName.split(' ')[0]}?</p></td></tr><tr><td style="padding:28px;"><p style="margin:0 0 16px;color:#374151;font-size:16px;line-height:1.6;">Hi <strong>${opts.customerFirstName}</strong>,</p><p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">Your <strong>${opts.serviceTitle}</strong> has been completed and <strong>$${opts.serviceTotal}</strong> has been charged to your ${opts.cardBrand} card ending in <strong>${opts.cardLast4}</strong>.</p><p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">If you'd like to show your appreciation, you can leave a tip for your detailer directly from your phone — it only takes a few seconds!</p><table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td align="center"><a href="${opts.tipUrl}" style="display:inline-block;background:#059669;color:#ffffff;font-size:16px;font-weight:700;padding:14px 36px;border-radius:10px;text-decoration:none;">Leave a Tip</a></td></tr></table><p style="margin:0 0 8px;color:#9ca3af;font-size:12px;text-align:center;">This link expires in 48 hours. Tipping is completely optional.</p><hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0 16px;"><p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">Luxury Wash On Wheels · Thank you for choosing us!</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, html };
}


// ─── Customer Portal Access / Password Reset Email ────────────────────────────
export function buildPortalAccessEmail(opts: {
  customerFirstName: string;
  resetLink: string;
  isNewSetup: boolean; // true = first-time setup, false = password reset
}): { subject: string; html: string } {
  const subject = opts.isNewSetup
    ? `Set Up Your Luxury Wash On Wheels Portal Account`
    : `Reset Your Luxury Wash On Wheels Password`;
  const headline = opts.isNewSetup ? `Welcome to Your Portal!` : `Reset Your Password`;
  const bodyText = opts.isNewSetup
    ? `You've been invited to set up your customer portal account with Luxury Wash On Wheels. Click the button below to create your password and get access to your bookings, vehicle history, and more.`
    : `We received a request to reset your password. Click the button below to choose a new password.`;
  const btnText = opts.isNewSetup ? `Set Up My Account` : `Reset My Password`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;"><table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;"><tr><td align="center"><table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);"><tr><td style="background:#0A0A0A;padding:20px 28px;"><p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;">Luxury Wash On Wheels</p><p style="margin:4px 0 0;color:#9CA3AF;font-size:12px;">Mobile Detailing</p></td></tr><tr><td style="background:linear-gradient(135deg,#0a7ea4 0%,#065f7a 100%);padding:28px;text-align:center;"><div style="font-size:48px;margin-bottom:10px;">🔑</div><h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:800;">${headline}</h1><p style="margin:6px 0 0;color:rgba(255,255,255,0.9);font-size:14px;">Hi ${opts.customerFirstName}!</p></td></tr><tr><td style="padding:28px;"><p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">${bodyText}</p><table width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td align="center"><a href="${opts.resetLink}" style="display:inline-block;background:#0a7ea4;color:#ffffff;font-size:16px;font-weight:700;padding:14px 36px;border-radius:10px;text-decoration:none;">${btnText}</a></td></tr></table><p style="margin:0 0 8px;color:#9ca3af;font-size:12px;text-align:center;">This link expires in 24 hours. If you didn't request this, you can safely ignore this email.</p><hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0 16px;"><p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">Luxury Wash On Wheels · Mobile Detailing</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, html };
}

// ─── Team Member Welcome Email ────────────────────────────────────────────────
export function buildTeamMemberWelcomeEmail(opts: {
  fullName: string;
  employeeId: string;
  pin: string;
  role: string;
  hireDate?: string;
  city?: string;
}): { subject: string; html: string } {
  const firstName = opts.fullName.split(' ')[0];

  // Human-readable role label
  const roleLabels: Record<string, string> = {
    detailer: 'Detailer',
    admin: 'Admin',
    office: 'Office',
    operations_manager: 'Operations Manager',
    door_hanger_rep: 'Door Hanger Rep',
    sales: 'Sales',
  };
  const roleLabel = roleLabels[opts.role] ?? opts.role;

  // Format start date
  let startDateDisplay = 'To be confirmed';
  if (opts.hireDate) {
    try {
      const d = new Date(opts.hireDate + 'T12:00:00');
      startDateDisplay = d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    } catch { /* keep default */ }
  }

  const cityDisplay = opts.city ? opts.city.charAt(0).toUpperCase() + opts.city.slice(1) : 'Your Location';

  const subject = `Welcome to the Team, ${firstName}! 🎉 Your Login Details Inside`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" style="max-width:580px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.10);">

      <!-- Header bar -->
      <tr><td style="background:#0A0A0A;padding:20px 28px;">
        <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">Luxury Wash On Wheels</p>
        <p style="margin:4px 0 0;color:#9CA3AF;font-size:12px;">Mobile Detailing · Team App</p>
      </td></tr>

      <!-- Hero gradient -->
      <tr><td style="background:linear-gradient(135deg,#0a7ea4 0%,#065f7a 100%);padding:36px 28px;text-align:center;">
        <div style="font-size:56px;margin-bottom:12px;">🎉</div>
        <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:800;letter-spacing:-0.5px;">Welcome to the Team!</h1>
        <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:16px;">Hey ${firstName}, we're pumped to have you with us.</p>
      </td></tr>

      <!-- Intro -->
      <tr><td style="padding:28px 28px 0;">
        <p style="margin:0;color:#374151;font-size:15px;line-height:1.7;">
          Your account is all set up and ready to go. Below are your login credentials for the
          <strong>Luxury Wash On Wheels Team App</strong>. Keep these safe — you'll use them every time you log in.
        </p>
      </td></tr>

      <!-- Credentials card -->
      <tr><td style="padding:20px 28px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F9FF;border:1.5px solid #BAE6FD;border-radius:12px;overflow:hidden;">
          <tr><td style="background:#0a7ea4;padding:12px 20px;">
            <p style="margin:0;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">Your Login Credentials</p>
          </td></tr>
          <tr><td style="padding:20px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="padding:10px 0;border-bottom:1px solid #e0f2fe;">
                  <p style="margin:0;color:#6B7280;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Team ID</p>
                  <p style="margin:4px 0 0;color:#0A0A0A;font-size:22px;font-weight:800;font-family:'Courier New',monospace;letter-spacing:1px;">${opts.employeeId}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:10px 0;">
                  <p style="margin:0;color:#6B7280;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">PIN</p>
                  <p style="margin:4px 0 0;color:#0A0A0A;font-size:28px;font-weight:800;font-family:'Courier New',monospace;letter-spacing:6px;">${opts.pin}</p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </td></tr>

      <!-- Position details card -->
      <tr><td style="padding:0 28px 20px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;overflow:hidden;">
          <tr><td style="background:#1F2937;padding:12px 20px;">
            <p style="margin:0;color:#ffffff;font-size:13px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">Your Position Details</p>
          </td></tr>
          <tr><td style="padding:20px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="50%" style="padding:8px 12px 8px 0;border-bottom:1px solid #E5E7EB;vertical-align:top;">
                  <p style="margin:0;color:#6B7280;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Position</p>
                  <p style="margin:4px 0 0;color:#111827;font-size:16px;font-weight:700;">${roleLabel}</p>
                </td>
                <td width="50%" style="padding:8px 0 8px 12px;border-bottom:1px solid #E5E7EB;vertical-align:top;">
                  <p style="margin:0;color:#6B7280;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Location</p>
                  <p style="margin:4px 0 0;color:#111827;font-size:16px;font-weight:700;">${cityDisplay}</p>
                </td>
              </tr>
              <tr>
                <td colspan="2" style="padding:10px 0 0;">
                  <p style="margin:0;color:#6B7280;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">Start Date</p>
                  <p style="margin:4px 0 0;color:#111827;font-size:15px;font-weight:600;">${startDateDisplay}</p>
                </td>
              </tr>
            </table>
          </td></tr>
        </table>
      </td></tr>

      <!-- Download CTA -->
      <tr><td style="padding:0 28px 28px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#0a7ea4 0%,#065f7a 100%);border-radius:12px;">
          <tr><td style="padding:24px;text-align:center;">
            <p style="margin:0 0 4px;color:#ffffff;font-size:17px;font-weight:800;">Download the Team App</p>
            <p style="margin:0 0 16px;color:rgba(255,255,255,0.85);font-size:13px;">Available on iPhone — log in with your Team ID &amp; PIN above</p>
            <a href="https://apps.apple.com/us/app/luxury-wash-on-wheels/id6768833519"
               style="display:inline-block;background:#ffffff;color:#0a7ea4;font-size:15px;font-weight:800;padding:13px 32px;border-radius:50px;text-decoration:none;letter-spacing:-0.2px;">
              📱 Download on the App Store
            </a>
          </td></tr>
        </table>
      </td></tr>

      <!-- How to log in steps -->
      <tr><td style="padding:0 28px 28px;">
        <p style="margin:0 0 14px;color:#111827;font-size:15px;font-weight:700;">How to Log In</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="32" valign="top" style="padding-right:12px;padding-bottom:12px;">
              <div style="width:28px;height:28px;background:#0a7ea4;border-radius:50%;text-align:center;line-height:28px;color:#fff;font-size:13px;font-weight:800;">1</div>
            </td>
            <td style="padding-bottom:12px;color:#374151;font-size:14px;line-height:1.5;">Download the app from the App Store link above</td>
          </tr>
          <tr>
            <td width="32" valign="top" style="padding-right:12px;padding-bottom:12px;">
              <div style="width:28px;height:28px;background:#0a7ea4;border-radius:50%;text-align:center;line-height:28px;color:#fff;font-size:13px;font-weight:800;">2</div>
            </td>
            <td style="padding-bottom:12px;color:#374151;font-size:14px;line-height:1.5;">Open the app and tap <strong>Team Login</strong></td>
          </tr>
          <tr>
            <td width="32" valign="top" style="padding-right:12px;">
              <div style="width:28px;height:28px;background:#0a7ea4;border-radius:50%;text-align:center;line-height:28px;color:#fff;font-size:13px;font-weight:800;">3</div>
            </td>
            <td style="color:#374151;font-size:14px;line-height:1.5;">Enter your <strong>Team ID</strong> and <strong>PIN</strong> from above</td>
          </tr>
        </table>
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#F9FAFB;border-top:1px solid #E5E7EB;padding:20px 28px;text-align:center;">
        <p style="margin:0 0 4px;color:#6B7280;font-size:12px;">Questions? Reach out to your manager or reply to this email.</p>
        <p style="margin:0;color:#9CA3AF;font-size:11px;">Luxury Wash On Wheels · Mobile Detailing</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

  return { subject, html };
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT RECEIPT EMAIL
// ─────────────────────────────────────────────────────────────────────────────
export function buildPaymentReceiptEmail(opts: {
  customerName: string;
  jobId: string | number;
  serviceDate: string;
  packageName: string;
  vehicleInfo: string;
  serviceAddress: string;
  paymentMethod: string;
  subtotal: number;
  tip: number;
  total: number;
  paidAt: string;
  detailerName?: string;
  referenceNote?: string;
}): { subject: string; html: string } {
  const {
    customerName, jobId, serviceDate, packageName, vehicleInfo,
    serviceAddress, paymentMethod, subtotal, tip, total, paidAt,
    detailerName, referenceNote,
  } = opts;

  const methodLabels: Record<string, string> = {
    credit_debit: "Credit / Debit Card",
    cash: "Cash",
    check: "Check",
    tap_to_pay: "Tap to Pay",
    apple_pay: "Apple Pay",
    other: "Other",
  };
  const methodLabel = methodLabels[paymentMethod] ?? paymentMethod;

  const tipRow = tip > 0
    ? `<tr><td style="padding:7px 0;color:#6B7280;font-size:14px;">Tip</td><td style="padding:7px 0;color:#16a34a;font-size:14px;font-weight:600;text-align:right;">+$${tip.toFixed(2)}</td></tr>`
    : "";

  const firstNameOnly = detailerName ? detailerName.split(' ')[0] : '';
  const detailerRow = firstNameOnly
    ? `<tr><td style="padding:7px 0;color:#6B7280;font-size:14px;">Detailer</td><td style="padding:7px 0;color:#111827;font-size:14px;text-align:right;">${firstNameOnly}</td></tr>`
    : "";

  const refRow = referenceNote
    ? `<tr><td style="padding:7px 0;color:#6B7280;font-size:14px;">Reference</td><td style="padding:7px 0;color:#111827;font-size:14px;text-align:right;">${referenceNote}</td></tr>`
    : "";

  const subject = `Your Receipt — $${total.toFixed(2)} · Luxury Wash On Wheels`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>Payment Receipt</title></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

      <!-- Header -->
      <tr><td style="background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);padding:28px 32px;text-align:center;">
        <p style="margin:0 0 6px;font-size:36px;line-height:1;">✅</p>
        <h1 style="margin:0 0 6px;color:#ffffff;font-size:22px;font-weight:800;letter-spacing:-0.3px;">Payment Received</h1>
        <p style="margin:0;color:rgba(255,255,255,0.85);font-size:14px;">Thank you, ${customerName}!</p>
      </td></tr>

      <!-- Amount hero -->
      <tr><td style="padding:28px 32px 0;text-align:center;">
        <p style="margin:0 0 4px;color:#6B7280;font-size:12px;font-weight:600;letter-spacing:0.8px;text-transform:uppercase;">Total Paid</p>
        <p style="margin:0;color:#111827;font-size:52px;font-weight:900;letter-spacing:-2px;line-height:1;">$${total.toFixed(2)}</p>
        <p style="margin:8px 0 0;color:#6B7280;font-size:13px;">${paidAt} &bull; ${methodLabel}</p>
      </td></tr>

      <!-- Divider -->
      <tr><td style="padding:20px 32px 0;"><div style="height:1px;background:#E5E7EB;"></div></td></tr>

      <!-- Receipt details -->
      <tr><td style="padding:20px 32px;">
        <p style="margin:0 0 14px;color:#111827;font-size:15px;font-weight:700;">Receipt Details</p>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="padding:7px 0;color:#6B7280;font-size:14px;">Service Date</td><td style="padding:7px 0;color:#111827;font-size:14px;text-align:right;">${serviceDate}</td></tr>
          <tr><td style="padding:7px 0;color:#6B7280;font-size:14px;">Service</td><td style="padding:7px 0;color:#111827;font-size:14px;text-align:right;">${packageName}</td></tr>
          <tr><td style="padding:7px 0;color:#6B7280;font-size:14px;">Vehicle</td><td style="padding:7px 0;color:#111827;font-size:14px;text-align:right;">${vehicleInfo}</td></tr>
          <tr><td style="padding:7px 0;color:#6B7280;font-size:14px;">Location</td><td style="padding:7px 0;color:#111827;font-size:14px;text-align:right;">${serviceAddress}</td></tr>
          ${detailerRow}
          <tr style="border-top:1px solid #F3F4F6;"><td style="padding:10px 0 7px;color:#6B7280;font-size:14px;">Subtotal</td><td style="padding:10px 0 7px;color:#111827;font-size:14px;text-align:right;">$${subtotal.toFixed(2)}</td></tr>
          ${tipRow}
          <tr style="border-top:1px solid #E5E7EB;"><td style="padding:10px 0 5px;color:#111827;font-size:16px;font-weight:800;">Total</td><td style="padding:10px 0 5px;color:#16a34a;font-size:20px;font-weight:900;text-align:right;">$${total.toFixed(2)}</td></tr>
          <tr><td style="padding:5px 0;color:#6B7280;font-size:13px;">Payment Method</td><td style="padding:5px 0;color:#111827;font-size:13px;text-align:right;">${methodLabel}</td></tr>
          ${refRow}
        </table>
      </td></tr>

      <!-- Divider -->
      <tr><td style="padding:0 32px;"><div style="height:1px;background:#E5E7EB;"></div></td></tr>

      <!-- Thank you message -->
      <tr><td style="padding:24px 32px;text-align:center;">
        <p style="margin:0 0 8px;color:#111827;font-size:16px;font-weight:700;">Thanks for choosing Luxury Wash On Wheels!</p>
        <p style="margin:0;color:#6B7280;font-size:14px;line-height:1.6;">Questions about this receipt? Contact us at <a href="mailto:Info@luxurywashonwheels.com" style="color:#0a7ea4;text-decoration:none;">Info@luxurywashonwheels.com</a> or <a href="tel:8505177874" style="color:#0a7ea4;text-decoration:none;">(850) 517-7874</a>.</p>
      </td></tr>

      <!-- App CTA -->
      <tr><td style="padding:0 32px 28px;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(135deg,#0a7ea4 0%,#065f7a 100%);border-radius:12px;">
          <tr><td style="padding:20px 24px;text-align:center;">
            <p style="margin:0 0 4px;color:#ffffff;font-size:15px;font-weight:800;">Book Your Next Detail</p>
            <p style="margin:0 0 14px;color:rgba(255,255,255,0.85);font-size:13px;">Download our app and track your detailer in real time</p>
            <a href="https://apps.apple.com/us/app/luxury-wash-on-wheels/id6768833519" style="display:inline-block;background:#ffffff;color:#0a7ea4;font-size:14px;font-weight:800;padding:11px 28px;border-radius:50px;text-decoration:none;">📱 Download on the App Store</a>
          </td></tr>
        </table>
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#F9FAFB;border-top:1px solid #E5E7EB;padding:18px 32px;text-align:center;">
        <p style="margin:0 0 4px;color:#9CA3AF;font-size:12px;">Luxury Wash On Wheels &bull; Mobile Detailing</p>
        <p style="margin:0;color:#9CA3AF;font-size:11px;">Serving Crestview &bull; Niceville &bull; Fort Walton Beach &bull; Destin &bull; Pensacola</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

  return { subject, html };
}
