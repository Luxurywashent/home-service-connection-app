/**
 * Test email sender — sends all customer-facing email types to a test address
 * Run with: node server/send-test-emails.mjs
 */
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env") });

const TO = "adrian@luxurywashonwheels.com";
const BASE_URL = "https://www.luxurywashonwheels.app";
const TEST_TOKEN = "TEST_TOKEN_123";

function createTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    console.error("❌ GMAIL_USER or GMAIL_APP_PASSWORD not set in .env");
    return null;
  }
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

async function send(transporter, subject, html) {
  const user = process.env.GMAIL_USER;
  await transporter.sendMail({
    from: `"Luxury Wash On Wheels" <${user}>`,
    to: TO,
    subject,
    html,
  });
  console.log(`✅ Sent: ${subject}`);
}

async function main() {
  const transporter = createTransporter();
  if (!transporter) process.exit(1);

  // ── 1. Booking Confirmation Email ──────────────────────────────────────────
  const confirmUrl = `${BASE_URL}/confirm/${TEST_TOKEN}`;
  await send(transporter, "Booking Confirmed — Full Detail on Saturday, May 16", `
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
        <tr><td style="background:#0A0A0A;padding:20px 28px;">
          <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;">Luxury Wash On Wheels</p>
          <p style="margin:4px 0 0;color:#9CA3AF;font-size:12px;">Mobile Detailing — We Come To You</p>
        </td></tr>
        <tr><td style="padding:28px;">
          <p style="margin:0 0 4px;font-size:13px;color:#6B7280;text-transform:uppercase;letter-spacing:0.5px;">Booking Confirmed</p>
          <h1 style="margin:0 0 20px;font-size:22px;color:#111827;">Hi Adrian, you're all set! 🎉</h1>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #F3F4F6;">
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Package</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">Full Detail</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Date</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">Saturday, May 16, 2026</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Time</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">9:00 AM – 11:00 AM</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Vehicle</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">2022 BMW 5 Series</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Location</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">123 Main St, Crestview FL</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;">Total</td><td style="padding:8px 0;color:#111827;font-size:14px;font-weight:700;text-align:right;">$275.00</td></tr>
          </table>
          <div style="margin:24px 0;text-align:center;">
            <a href="${confirmUrl}" style="display:inline-block;background:#0A0A0A;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">✅ Confirm My Appointment</a>
          </div>
          <p style="margin:0;color:#6B7280;font-size:13px;text-align:center;">Questions? Call us at <strong>850-517-7874</strong></p>
        </td></tr>
        <tr><td style="padding:16px 28px;background:#F9FAFB;border-top:1px solid #F3F4F6;">
          <p style="margin:0;color:#9CA3AF;font-size:12px;text-align:center;">Luxury Wash On Wheels · www.luxurywashonwheels.app</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`);

  // ── 2. Appointment Reminder / Urgent Confirmation ──────────────────────────
  await send(transporter, "⏰ Reminder: Your appointment is tomorrow — please confirm", `
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#0A0A0A;padding:20px 28px;">
          <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;">Luxury Wash On Wheels</p>
          <p style="margin:4px 0 0;color:#9CA3AF;font-size:12px;">Mobile Detailing — We Come To You</p>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 12px;font-size:20px;color:#111827;">Hi Adrian — your appointment is tomorrow!</h1>
          <p style="margin:0 0 20px;color:#6B7280;font-size:14px;line-height:1.6;">Please confirm your appointment so we can have your detailer ready to go.</p>
          <p style="margin:0 0 8px;font-size:14px;color:#111827;"><strong>📅 Sunday, May 17, 2026 at 10:00 AM</strong></p>
          <p style="margin:0 0 24px;font-size:14px;color:#111827;">Full Detail · 2022 BMW 5 Series</p>
          <div style="text-align:center;">
            <a href="${confirmUrl}" style="display:inline-block;background:#16A34A;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">✅ Yes, I'll be there!</a>
          </div>
          <p style="margin:20px 0 0;color:#6B7280;font-size:13px;text-align:center;">Need to reschedule? Call <strong>850-517-7874</strong></p>
        </td></tr>
        <tr><td style="padding:16px 28px;background:#F9FAFB;border-top:1px solid #F3F4F6;">
          <p style="margin:0;color:#9CA3AF;font-size:12px;text-align:center;">Luxury Wash On Wheels · www.luxurywashonwheels.app</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`);

  // ── 3. Invoice Email ───────────────────────────────────────────────────────
  const invoiceUrl = `${BASE_URL}/invoice/${TEST_TOKEN}`;
  await send(transporter, "Your Invoice — Luxury Wash On Wheels", `
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#0A0A0A;padding:20px 28px;">
          <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;">Luxury Wash On Wheels</p>
          <p style="margin:4px 0 0;color:#9CA3AF;font-size:12px;">Invoice</p>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="margin:0 0 4px;font-size:20px;color:#111827;">Thank you, Adrian!</h1>
          <p style="margin:0 0 24px;color:#6B7280;font-size:14px;">Here's your invoice for today's service.</p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #F3F4F6;">
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Service</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">Full Detail</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Add-ons</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">Ceramic Coating, Engine Bay</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Subtotal</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">$350.00</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Tax (7%)</td><td style="padding:8px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">$24.50</td></tr>
            <tr><td style="padding:8px 0;color:#6B7280;font-size:14px;">Total</td><td style="padding:8px 0;color:#111827;font-size:16px;font-weight:700;text-align:right;">$374.50</td></tr>
          </table>
          <div style="margin:24px 0;text-align:center;">
            <a href="${invoiceUrl}" style="display:inline-block;background:#0A0A0A;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">View Full Invoice</a>
          </div>
          <p style="margin:0;color:#6B7280;font-size:13px;text-align:center;">Questions? Call <strong>850-517-7874</strong></p>
        </td></tr>
        <tr><td style="padding:16px 28px;background:#F9FAFB;border-top:1px solid #F3F4F6;">
          <p style="margin:0;color:#9CA3AF;font-size:12px;text-align:center;">Luxury Wash On Wheels · www.luxurywashonwheels.app</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`);

  // ── 4. Detailer On The Way (Tracking) Email ────────────────────────────────
  const trackUrl = `${BASE_URL}/track/${TEST_TOKEN}`;
  await send(transporter, "🚐 Your detailer is on the way!", `
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#0A0A0A;padding:20px 28px;">
          <p style="margin:0;color:#ffffff;font-size:18px;font-weight:700;">Luxury Wash On Wheels</p>
          <p style="margin:4px 0 0;color:#9CA3AF;font-size:12px;">Your detailer is on the way</p>
        </td></tr>
        <tr><td style="padding:28px;text-align:center;">
          <div style="font-size:48px;margin-bottom:16px;">🚐</div>
          <h1 style="margin:0 0 8px;font-size:22px;color:#111827;">Elijah is heading your way!</h1>
          <p style="margin:0 0 24px;color:#6B7280;font-size:14px;line-height:1.6;">Your detailer is on the way. Track their live location below.</p>
          <a href="${trackUrl}" style="display:inline-block;background:#0A0A0A;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;">📍 Track Live Location</a>
          <p style="margin:20px 0 0;color:#6B7280;font-size:13px;">Questions? Call <strong>850-517-7874</strong></p>
        </td></tr>
        <tr><td style="padding:16px 28px;background:#F9FAFB;border-top:1px solid #F3F4F6;">
          <p style="margin:0;color:#9CA3AF;font-size:12px;text-align:center;">Luxury Wash On Wheels · www.luxurywashonwheels.app</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`);

  console.log("\n🎉 All 4 test emails sent to", TO);
}

main().catch(console.error);
