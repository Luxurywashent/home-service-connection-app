// Test script: sends a sample appointment confirmation email
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const path = require("path");

// Load env from project .env
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const BASE_URL = "https://luxwashapp-n2wveyqg.manus.space";

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error("❌ GMAIL_USER or GMAIL_APP_PASSWORD not set");
  process.exit(1);
}

const token = crypto.randomBytes(32).toString("hex");
const confirmUrl = `${BASE_URL}/api/confirm/${token}`;

const subject = `⏰ Confirm Your Appointment Tomorrow — Luxury Wash On Wheels`;
const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.10);">
        <tr><td style="background:linear-gradient(135deg,#0a7ea4 0%,#0369a1 100%);padding:32px 28px;text-align:center;">
          <div style="font-size:48px;margin-bottom:12px;">🚐</div>
          <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:800;">Your Appointment is Tomorrow!</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px;">Luxury Wash On Wheels</p>
        </td></tr>
        <tr><td style="padding:28px;">
          <p style="margin:0 0 20px;color:#374151;font-size:16px;line-height:1.6;">Hi <strong>Adrian</strong>,</p>
          <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
            Your appointment is scheduled for <strong>tomorrow</strong>. Please confirm so we can have your detailer ready to go!
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;padding:20px;margin-bottom:24px;border:1px solid #e2e8f0;">
            <tr><td>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="color:#64748b;font-size:13px;width:120px;padding-bottom:10px;">📅 Date</td>
                  <td style="color:#111827;font-size:14px;font-weight:700;padding-bottom:10px;">Wednesday, May 7, 2026</td>
                </tr>
                <tr>
                  <td style="color:#64748b;font-size:13px;padding-bottom:10px;">⏰ Time</td>
                  <td style="color:#111827;font-size:14px;font-weight:700;padding-bottom:10px;">9:00 AM</td>
                </tr>
                <tr>
                  <td style="color:#64748b;font-size:13px;padding-bottom:10px;">🚗 Service</td>
                  <td style="color:#111827;font-size:14px;padding-bottom:10px;">SUV — Luxury Detail (TEST)</td>
                </tr>
                <tr>
                  <td style="color:#64748b;font-size:13px;">📍 Location</td>
                  <td style="color:#111827;font-size:14px;">123 Test St, Crestview, FL</td>
                </tr>
              </table>
            </td></tr>
          </table>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td align="center">
              <a href="${confirmUrl}"
                 style="display:inline-block;background:linear-gradient(135deg,#0a7ea4,#0369a1);color:#ffffff;font-size:18px;font-weight:800;text-decoration:none;padding:18px 48px;border-radius:50px;box-shadow:0 4px 15px rgba(10,126,164,0.4);">
                ✅ Confirm My Appointment
              </a>
            </td></tr>
          </table>
          <p style="margin:0 0 12px;color:#6b7280;font-size:13px;text-align:center;">
            Or reply <strong>C</strong> to the text message we sent you.
          </p>
          <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;line-height:1.5;">
            Questions? Call us at <strong>(850) 367-8586</strong>
          </p>
        </td></tr>
        <tr><td style="background:#f8fafc;padding:20px 28px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#9ca3af;font-size:12px;">Luxury Wash On Wheels · Crestview, FL</p>
          <p style="margin:4px 0 0;color:#d1d5db;font-size:11px;">⚠️ This is a TEST email — no real appointment</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_APP_PASSWORD,
  },
});

transporter.sendMail({
  from: `"Luxury Wash On Wheels" <${GMAIL_USER}>`,
  to: "adrian@luxurywashonwheels.com",
  subject,
  html,
}, (err, info) => {
  if (err) {
    console.error("❌ Failed to send email:", err.message);
  } else {
    console.log("✅ Test email sent successfully!");
    console.log("Message ID:", info.messageId);
    console.log("Confirm URL:", confirmUrl);
  }
});
