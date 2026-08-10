// Sends a real test confirmation email with a token stored in the DB
const mysql = require("mysql2/promise");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const BASE_URL = "https://luxwashapp-n2wveyqg.manus.space";
const TEST_EMAIL = "adrian@luxurywashonwheels.com";

async function run() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // Find the most recent job that has an email
  const [jobs] = await conn.execute(
    `SELECT job_id, customer_name, customer_email, date, time_slot, package_type, vehicle_type, customer_address, location
     FROM schedule_jobs
     WHERE customer_email IS NOT NULL AND customer_email != ''
     ORDER BY date DESC LIMIT 10`
  );

  if (!jobs.length) {
    console.error("No jobs with email found in database");
    await conn.end();
    return;
  }

  // Use the first job but override the email to Adrian's for testing
  const job = jobs[0];
  const token = crypto.randomBytes(32).toString("hex");

  // Store the token in the DB
  await conn.execute(
    `UPDATE schedule_jobs SET appt_confirm_token = ?, appt_confirmation_status = 'pending', appt_reminder_sent_at = NOW() WHERE job_id = ?`,
    [token, job.job_id]
  );

  console.log(`Token stored for job_id: ${job.job_id}, customer: ${job.customer_name}`);

  const confirmUrl = `${BASE_URL}/api/confirm/${token}`;
  const firstName = (job.customer_name || "").split(" ")[0] || "Adrian";
  const dateStr = job.date ? new Date(job.date).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : "Tomorrow";
  const timeStr = job.time_slot || "9:00 AM";
  const serviceDesc = [job.vehicle_type, job.package_type].filter(Boolean).join(" — ") || "Luxury Detail";
  const addressLine = [job.customer_address, job.location].filter(Boolean).join(", ") || "Crestview, FL";

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
          <p style="margin:0 0 20px;color:#374151;font-size:16px;line-height:1.6;">Hi <strong>${firstName}</strong>,</p>
          <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
            Your appointment is scheduled for <strong>tomorrow</strong>. Please confirm so we can have your detailer ready to go!
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border-radius:12px;padding:20px;margin-bottom:24px;border:1px solid #e2e8f0;">
            <tr><td>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="color:#64748b;font-size:13px;width:120px;padding-bottom:10px;">📅 Date</td>
                  <td style="color:#111827;font-size:14px;font-weight:700;padding-bottom:10px;">${dateStr}</td>
                </tr>
                <tr>
                  <td style="color:#64748b;font-size:13px;padding-bottom:10px;">⏰ Time</td>
                  <td style="color:#111827;font-size:14px;font-weight:700;padding-bottom:10px;">${timeStr}</td>
                </tr>
                <tr>
                  <td style="color:#64748b;font-size:13px;padding-bottom:10px;">🚗 Service</td>
                  <td style="color:#111827;font-size:14px;padding-bottom:10px;">${serviceDesc}</td>
                </tr>
                <tr>
                  <td style="color:#64748b;font-size:13px;">📍 Location</td>
                  <td style="color:#111827;font-size:14px;">${addressLine}</td>
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
          <p style="margin:4px 0 0;color:#d1d5db;font-size:11px;">⚠️ This is a TEST email</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
  });

  const info = await transporter.sendMail({
    from: `"Luxury Wash On Wheels" <${process.env.GMAIL_USER}>`,
    to: TEST_EMAIL,
    subject,
    html,
  });

  console.log("✅ Email sent! Message ID:", info.messageId);
  console.log("Confirm URL:", confirmUrl);
  await conn.end();
}

run().catch(console.error);
