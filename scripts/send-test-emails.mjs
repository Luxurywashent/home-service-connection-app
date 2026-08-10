/**
 * Test email sender — sends all 4 customer-facing emails:
 * 1. Booking Confirmation
 * 2. Appointment Confirmation Reminder (2 days in advance, with confirm button)
 * 3. Detailer On The Way (with live tracking link)
 * 4. Invoice (with real payment link using a real job token)
 */

// Load env first
await import("../scripts/load-env.js");

import nodemailer from "nodemailer";
import mysql from "mysql2/promise";
import crypto from "crypto";

const TO = process.argv[2] || "adrian@luxurywashonwheels.com";
// Always use the production domain for test emails — never the sandbox URL
const BASE_URL = "https://www.luxurywashonwheels.app";

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;

if (!GMAIL_USER || !GMAIL_PASS) {
  console.error("❌ Gmail credentials not set");
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: GMAIL_USER, pass: GMAIL_PASS },
});

async function send(subject, html, label) {
  try {
    await transporter.sendMail({
      from: `"Luxury Wash On Wheels" <${GMAIL_USER}>`,
      to: TO,
      subject,
      html,
      text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    });
    console.log(`✅ Sent: ${label}`);
  } catch (e) {
    console.error(`❌ Failed: ${label} — ${e.message}`);
  }
}

// ── Get a real job to use for invoice test ────────────────────────────────────
let realJobId = null;
let invoiceToken = null;
let invoicePayUrl = `${BASE_URL}/api/invoice/pay/test_preview`;

try {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  // Find a real job with a price > 0 and email
  const [rows] = await conn.execute(
    `SELECT job_id, customer_name, customer_email, package_type, vehicle_year, vehicle_make, vehicle_model,
            date, total_price, invoice_token
     FROM schedule_jobs
     WHERE customer_email IS NOT NULL AND customer_email != ''
       AND total_price > 0
       AND status NOT IN ('cancelled')
     ORDER BY date DESC LIMIT 10`
  );
  // Pick first job that has a real price
  const job = rows.find(j => parseFloat(j.total_price) > 0);
  if (job) {
    realJobId = job.job_id;
    // Generate or reuse invoice token
    if (!job.invoice_token) {
      invoiceToken = crypto.randomBytes(32).toString("hex");
      await conn.execute(
        "UPDATE schedule_jobs SET invoice_token = ? WHERE job_id = ?",
        [invoiceToken, realJobId]
      );
    } else {
      invoiceToken = job.invoice_token;
    }
    invoicePayUrl = `${BASE_URL}/api/invoice/pay/${invoiceToken}`;
    console.log(`📋 Using real job: ${realJobId} | ${job.customer_name} | $${job.total_price}`);
  }
  await conn.end();
} catch (e) {
  console.warn("⚠️  Could not fetch real job for invoice test:", e.message);
}

// ── Generate a confirm token and SAVE it to a real job so the link works ────
const confirmToken = crypto.randomBytes(32).toString("hex");
const confirmUrl = `${BASE_URL}/api/confirm/${confirmToken}`;

// Save the confirm token to the same real job so clicking the link works
try {
  const conn2 = await mysql.createConnection(process.env.DATABASE_URL);
  if (realJobId) {
    await conn2.execute(
      "UPDATE schedule_jobs SET appt_confirm_token = ?, appt_reminder_sent = 1, appt_confirmation_status = 'pending' WHERE job_id = ?",
      [confirmToken, realJobId]
    );
    console.log(`🔑 Confirm token saved to job: ${realJobId}`);
  } else {
    // No real job found — find any job and use it
    const [anyJobs] = await conn2.execute(
      "SELECT job_id FROM schedule_jobs WHERE status NOT IN ('cancelled') ORDER BY date DESC LIMIT 1"
    );
    if (anyJobs.length > 0) {
      await conn2.execute(
        "UPDATE schedule_jobs SET appt_confirm_token = ?, appt_reminder_sent = 1, appt_confirmation_status = 'pending' WHERE job_id = ?",
        [confirmToken, anyJobs[0].job_id]
      );
      console.log(`🔑 Confirm token saved to job: ${anyJobs[0].job_id}`);
    }
  }
  await conn2.end();
} catch (e) {
  console.warn("⚠️  Could not save confirm token to DB:", e.message);
}
const trackToken = crypto.randomBytes(16).toString("hex");
const trackUrl = `${BASE_URL}/track/${trackToken}`;

// ── 1. BOOKING CONFIRMATION ───────────────────────────────────────────────────
const confirmationHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <tr><td style="background:#0A0A0A;padding:20px 28px;">
          <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">Luxury Wash On Wheels</p>
          <p style="margin:4px 0 0;color:#9CA3AF;font-size:12px;">Mobile Detailing — We Come To You</p>
        </td></tr>
        <tr><td style="padding:24px 28px 0;">
          <div style="display:inline-block;background:#DCFCE7;color:#16A34A;font-size:13px;font-weight:700;padding:6px 14px;border-radius:20px;">✓ &nbsp;Booking Confirmed</div>
        </td></tr>
        <tr><td style="padding:16px 28px 0;">
          <h2 style="margin:0;color:#111827;font-size:22px;font-weight:700;line-height:1.3;">You're all set, Adrian!</h2>
          <p style="margin:8px 0 0;color:#6B7280;font-size:14px;line-height:1.6;">Your mobile detail has been booked. Here's a summary of your appointment.</p>
        </td></tr>
        <tr><td style="padding:20px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border-radius:10px;padding:16px;border:1px solid #E5E7EB;">
            <tr><td style="padding:0 0 12px;color:#374151;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Booking Details</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Ref #</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #F3F4F6;">BK-TEST-001</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Service</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">Luxury Detail Package</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Vehicle</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">2022 BMW X5 (Black)</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Date</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">Saturday, May 17, 2026</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Time</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">9:00 AM – 12:00 PM</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Location</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">4733 Live Oak Church Rd, Crestview, FL</td></tr>
            <tr><td style="padding:12px 0 0;color:#111827;font-size:15px;font-weight:700;">Total</td><td style="padding:12px 0 0;color:#0057FF;font-size:16px;font-weight:800;text-align:right;">$450.00</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 28px 28px;">
          <p style="margin:0 0 8px;color:#374151;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">What to Expect</p>
          <p style="margin:0;color:#6B7280;font-size:14px;line-height:1.7;">Our team will reach out to confirm your appointment. Please ensure your vehicle is accessible at the scheduled time. If you need to make any changes, reply to this email or contact us directly.</p>
          <p style="margin:16px 0 0;color:#9CA3AF;font-size:12px;">Luxury Wash On Wheels &nbsp;·&nbsp; luxurywashonwheels.com</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

// ── 2. APPOINTMENT CONFIRMATION REMINDER (2 days in advance) ─────────────────
const apptConfirmHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.10);">
        <tr><td style="background:linear-gradient(135deg,#0a7ea4 0%,#0369a1 100%);padding:32px 28px;text-align:center;">
          <div style="font-size:48px;margin-bottom:12px;">🚐</div>
          <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:800;">Your Appointment is in 2 Days!</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Luxury Wash On Wheels</p>
        </td></tr>
        <tr><td style="padding:28px;">
          <p style="margin:0 0 20px;color:#374151;font-size:16px;line-height:1.6;">Hi <strong>Adrian</strong>,</p>
          <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
            Your appointment is coming up in <strong>2 days</strong>. Please confirm your appointment so we can have your detailer ready to go!
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;padding:20px;margin-bottom:24px;border:1px solid #e2e8f0;">
            <tr><td style="padding:6px 0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="color:#64748b;font-size:13px;width:120px;padding-bottom:10px;">📅 Date</td>
                  <td style="color:#111827;font-size:14px;font-weight:700;padding-bottom:10px;">Saturday, May 17, 2026</td>
                </tr>
                <tr>
                  <td style="color:#64748b;font-size:13px;padding-bottom:10px;">⏰ Time</td>
                  <td style="color:#111827;font-size:14px;font-weight:700;padding-bottom:10px;">9:00 AM</td>
                </tr>
                <tr>
                  <td style="color:#64748b;font-size:13px;padding-bottom:10px;">🚗 Service</td>
                  <td style="color:#111827;font-size:14px;padding-bottom:10px;">SUV — Luxury Detail Package</td>
                </tr>
                <tr>
                  <td style="color:#64748b;font-size:13px;">📍 Location</td>
                  <td style="color:#111827;font-size:14px;">4733 Live Oak Church Rd, Crestview</td>
                </tr>
              </table>
            </td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td align="center">
              <a href="${confirmUrl}"
                 style="display:inline-block;background:#22c55e;color:#ffffff;font-size:17px;font-weight:800;text-decoration:none;padding:16px 40px;border-radius:50px;letter-spacing:0.3px;box-shadow:0 4px 12px rgba(34,197,94,0.35);">
                ✅ Confirm My Appointment
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-align:center;">
            Button not working? <a href="${confirmUrl}" style="color:#0a7ea4;">Click here to confirm</a>
          </p>
          <p style="margin:0 0 24px;color:#6b7280;font-size:13px;text-align:center;">
            Questions? Call or text us at <strong>(850) 367-8586</strong>
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

// ── 3. DETAILER ON THE WAY (TRACKING) ────────────────────────────────────────
const trackHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <tr><td style="background:#0A0A0A;padding:20px 28px;">
          <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;">Luxury Wash On Wheels</p>
          <p style="margin:4px 0 0;color:#9CA3AF;font-size:12px;">Mobile Detailing — We Come To You</p>
        </td></tr>
        <tr><td style="padding:28px 28px 0;">
          <div style="background:#EFF6FF;border-radius:10px;padding:20px;text-align:center;">
            <div style="font-size:40px;margin-bottom:8px;">🚐</div>
            <h2 style="margin:0;color:#1D4ED8;font-size:20px;font-weight:700;">Your Detailer Is On The Way!</h2>
            <p style="margin:8px 0 0;color:#3B82F6;font-size:14px;">Casey is heading to your location now</p>
          </div>
        </td></tr>
        <tr><td style="padding:20px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border-radius:10px;padding:16px;border:1px solid #E5E7EB;">
            <tr><td style="padding:0 0 12px;color:#374151;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Appointment Info</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Detailer</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">Casey</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Service</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">Luxury Detail Package</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;">ETA</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:700;text-align:right;">~15 minutes</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 28px 28px;text-align:center;">
          <a href="${trackUrl}" style="display:inline-block;background:#1D4ED8;color:#ffffff;font-size:15px;font-weight:700;padding:14px 32px;border-radius:10px;text-decoration:none;">📍 Track Live Location</a>
          <p style="margin:16px 0 0;color:#9CA3AF;font-size:12px;">Luxury Wash On Wheels &nbsp;·&nbsp; luxurywashonwheels.com</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

// ── 4. INVOICE ────────────────────────────────────────────────────────────────
const invoiceHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <tr><td style="background:#0A0A0A;padding:20px 28px;">
          <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;">Luxury Wash On Wheels</p>
          <p style="margin:4px 0 0;color:#9CA3AF;font-size:12px;">Mobile Detailing — We Come To You</p>
        </td></tr>
        <tr><td style="padding:24px 28px 0;">
          <div style="background:#FEF3C7;color:#92400E;font-size:13px;font-weight:700;padding:6px 14px;border-radius:20px;display:inline-block;">💳 Invoice Ready</div>
        </td></tr>
        <tr><td style="padding:16px 28px 0;">
          <h2 style="margin:0;color:#111827;font-size:22px;font-weight:700;">Your invoice is ready, Adrian</h2>
          <p style="margin:8px 0 0;color:#6B7280;font-size:14px;line-height:1.6;">Thank you for choosing Luxury Wash On Wheels. Please review and pay your invoice below.</p>
        </td></tr>
        <tr><td style="padding:20px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;border-radius:10px;padding:16px;border:1px solid #E5E7EB;">
            <tr><td style="padding:0 0 12px;color:#374151;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Invoice Summary</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Service</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">Luxury Detail Package</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Vehicle</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">2022 BMW X5</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Date</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">May 17, 2026</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Subtotal</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">$450.00</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Tax (7%)</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">$31.50</td></tr>
            <tr><td style="padding:12px 0 0;color:#111827;font-size:15px;font-weight:700;">Total Due</td><td style="padding:12px 0 0;color:#0057FF;font-size:18px;font-weight:800;text-align:right;">$481.50</td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 28px 28px;text-align:center;">
          <a href="${invoicePayUrl}" style="display:inline-block;background:#0057FF;color:#ffffff;font-size:15px;font-weight:700;padding:14px 40px;border-radius:10px;text-decoration:none;">Pay Now — $481.50</a>
          <p style="margin:12px 0 4px;color:#6B7280;font-size:12px;">Payment link: <a href="${invoicePayUrl}" style="color:#0057FF;">${invoicePayUrl}</a></p>
          <p style="margin:8px 0 0;color:#9CA3AF;font-size:12px;">Secure payment powered by Stripe &nbsp;·&nbsp; luxurywashonwheels.com</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

// ── SEND ALL FOUR ─────────────────────────────────────────────────────────────
console.log(`\nSending 4 test emails to: ${TO}\n`);
await send("✅ Booking Confirmed — Luxury Wash On Wheels (TEST)", confirmationHtml, "1. Booking Confirmation");
await send("⏰ Confirm Your Appointment in 2 Days — Luxury Wash On Wheels (TEST)", apptConfirmHtml, "2. Appointment Confirmation Reminder");
await send("🚐 Your Detailer Is On The Way! — Luxury Wash On Wheels (TEST)", trackHtml, "3. Detailer On The Way / Tracking");
await send("💳 Your Invoice Is Ready — Luxury Wash On Wheels (TEST)", invoiceHtml, "4. Invoice");
console.log(`\nDone! Invoice pay link: ${invoicePayUrl}\nConfirm link: ${confirmUrl}\nTrack link: ${trackUrl}\n`);
