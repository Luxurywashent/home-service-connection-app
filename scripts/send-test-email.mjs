/**
 * Test script: Send a booking confirmation email for a VIP package
 * Usage: node scripts/send-test-email.mjs
 */
import "./load-env.js";
import { createTransport } from "nodemailer";
import { fileURLToPath } from "url";
import path from "path";

// Load env
const gmailUser = process.env.GMAIL_USER;
const gmailPass = process.env.GMAIL_APP_PASSWORD;

if (!gmailUser || !gmailPass) {
  console.error("Missing GMAIL_USER or GMAIL_APP_PASSWORD env vars");
  process.exit(1);
}

const transporter = createTransport({
  service: "gmail",
  auth: { user: gmailUser, pass: gmailPass },
});

// Build a test booking confirmation email HTML
const customerName = "Adrian";
const bookingRef = "TEST-VIP-001";
const packageName = "VIP Detail";
const vehicleLabel = "Truck";
const scheduledDate = "Monday, June 2, 2026";
const scheduledTime = "9:00 AM – 12:00 PM";
const addressLabel = "8310 Creston Barrow Rd, Baker, FL 32531";
const total = 299.00;

const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.10);">
        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#0a7ea4 0%,#0369a1 100%);padding:32px 28px;text-align:center;">
          <div style="font-size:48px;margin-bottom:12px;">✅</div>
          <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:800;">Booking Confirmed</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Luxury Wash On Wheels · Mobile Detailing</p>
        </td></tr>
        <!-- Greeting -->
        <tr><td style="padding:28px 28px 0;">
          <h2 style="margin:0 0 8px;color:#111827;font-size:20px;font-weight:700;">You're all set, ${customerName}!</h2>
          <p style="margin:0;color:#6b7280;font-size:15px;line-height:1.5;">Your mobile detail has been booked. Here's a summary of your appointment.</p>
        </td></tr>
        <!-- Details Card -->
        <tr><td style="padding:20px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb;padding:20px;border-spacing:0;">
            <tr><td colspan="2" style="padding-bottom:12px;border-bottom:1px solid #e5e7eb;">
              <span style="font-size:11px;font-weight:700;letter-spacing:0.08em;color:#6b7280;text-transform:uppercase;">Booking Details</span>
            </td></tr>
            <tr>
              <td style="padding:10px 0 4px;color:#6b7280;font-size:13px;">Ref #</td>
              <td style="padding:10px 0 4px;color:#111827;font-size:13px;font-weight:600;text-align:right;">${bookingRef}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6b7280;font-size:13px;">Service</td>
              <td style="padding:4px 0;color:#111827;font-size:13px;font-weight:600;text-align:right;">${packageName}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6b7280;font-size:13px;">Vehicle</td>
              <td style="padding:4px 0;color:#111827;font-size:13px;text-align:right;">${vehicleLabel}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6b7280;font-size:13px;">Date</td>
              <td style="padding:4px 0;color:#111827;font-size:13px;text-align:right;">${scheduledDate}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6b7280;font-size:13px;">Time</td>
              <td style="padding:4px 0;color:#111827;font-size:13px;text-align:right;">${scheduledTime}</td>
            </tr>
            <tr>
              <td style="padding:4px 0;color:#6b7280;font-size:13px;">Location</td>
              <td style="padding:4px 0;color:#111827;font-size:13px;text-align:right;">${addressLabel}</td>
            </tr>
            <tr style="border-top:1px solid #e5e7eb;">
              <td style="padding:12px 0 4px;color:#111827;font-size:15px;font-weight:700;">Total</td>
              <td style="padding:12px 0 4px;color:#0a7ea4;font-size:18px;font-weight:800;text-align:right;">$${total.toFixed(2)}</td>
            </tr>
          </table>
        </td></tr>
        <!-- What to expect -->
        <tr><td style="padding:0 28px 28px;">
          <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.08em;color:#6b7280;text-transform:uppercase;">What to Expect</p>
          <p style="margin:0;color:#374151;font-size:14px;line-height:1.6;">Our team will reach out to confirm your appointment. Please ensure your vehicle is accessible at the scheduled time. If you need to make any changes, reply to this email or contact us directly.</p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 28px;text-align:center;">
          <p style="margin:0;color:#9ca3af;font-size:12px;">Luxury Wash On Wheels · <a href="https://luxurywashonwheels.com" style="color:#0a7ea4;text-decoration:none;">luxurywashonwheels.com</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const subject = `Booking Confirmed — VIP Detail on ${scheduledDate}`;

try {
  const info = await transporter.sendMail({
    from: `"Luxury Wash On Wheels" <${gmailUser}>`,
    to: "adrian@luxurywashonwheels.com",
    subject,
    html,
  });
  console.log("✅ Test email sent successfully!");
  console.log("Message ID:", info.messageId);
  console.log("To: adrian@luxurywashonwheels.com");
  console.log("Subject:", subject);
} catch (err) {
  console.error("❌ Failed to send email:", err.message);
  process.exit(1);
}
