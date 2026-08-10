/**
 * Send a $10 live test invoice to Adrian
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("./load-env.js");

import crypto from "crypto";
import nodemailer from "nodemailer";
import mysql from "mysql2/promise";

const TO_EMAIL = "adrian@luxurywashonwheels.com";
const BASE_URL = "https://www.luxurywashonwheels.app";

async function main() {
  const db = await mysql.createConnection(process.env.DATABASE_URL);

  // Generate a fresh invoice token for $10
  const token = crypto.randomBytes(32).toString("hex");

  // Save the token to the existing test job with $10 override
  await db.execute(
    `UPDATE schedule_jobs SET invoice_token = ?, total_price = '10.00', upsell_total = '0.00', tax_amount = '0.00', discount_amount = '0.00', deposit_amount = '0.00', invoice_paid_at = NULL WHERE job_id = 'vip-4-v12-1778440694280'`,
    [token]
  );

  await db.end();

  const paymentUrl = `${BASE_URL}/api/invoice/pay/${token}`;

  // Build invoice email
  const subject = `Your Invoice from Luxury Wash On Wheels — $10.00 Due`;
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Invoice from Luxury Wash On Wheels</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
    <div style="background: #0a7ea4; padding: 28px 32px; text-align: center;">
      <h1 style="color: #fff; margin: 0; font-size: 22px; font-weight: 700;">🚗 Luxury Wash On Wheels</h1>
      <p style="color: rgba(255,255,255,0.85); margin: 6px 0 0; font-size: 14px;">Invoice &amp; Payment Request</p>
    </div>
    <div style="padding: 28px 32px;">
      <p style="color: #333; font-size: 16px; margin: 0 0 20px;">Hi Adrian,</p>
      <p style="color: #555; font-size: 15px; margin: 0 0 24px; line-height: 1.5;">
        Thank you for choosing Luxury Wash On Wheels! Your invoice is ready. Please review the details below and click <strong>Pay Now</strong> to complete your payment.
      </p>
      <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 20px; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="color: #888; font-size: 13px; padding: 4px 0;">Service</td>
            <td style="color: #111; font-size: 13px; font-weight: 600; text-align: right;">Full Detail — Test</td>
          </tr>
          <tr>
            <td style="color: #888; font-size: 13px; padding: 4px 0;">Vehicle</td>
            <td style="color: #111; font-size: 13px; text-align: right;">2022 BMW X5</td>
          </tr>
          <tr>
            <td style="color: #888; font-size: 13px; padding: 4px 0;">Date</td>
            <td style="color: #111; font-size: 13px; text-align: right;">May 15, 2026</td>
          </tr>
          <tr>
            <td colspan="2" style="border-top: 1px solid #e5e7eb; padding-top: 12px; margin-top: 8px;"></td>
          </tr>
          <tr>
            <td style="color: #111; font-size: 16px; font-weight: 700; padding: 4px 0;">Amount Due</td>
            <td style="color: #0a7ea4; font-size: 20px; font-weight: 800; text-align: right;">$10.00</td>
          </tr>
        </table>
      </div>
      <div style="text-align: center; margin-bottom: 24px;">
        <a href="${paymentUrl}" style="display: inline-block; background: #0a7ea4; color: #fff; text-decoration: none; padding: 14px 40px; border-radius: 50px; font-size: 16px; font-weight: 700; letter-spacing: 0.3px;">
          💳 Pay Now — $10.00
        </a>
      </div>
      <p style="color: #888; font-size: 12px; text-align: center; margin: 0;">
        This link is secure and unique to your invoice. Questions? Call us at (850) 367-8586.
      </p>
    </div>
    <div style="background: #f9fafb; border-top: 1px solid #e5e7eb; padding: 16px 32px; text-align: center;">
      <p style="color: #aaa; font-size: 12px; margin: 0;">Luxury Wash On Wheels · Serving NW Florida</p>
    </div>
  </div>
</body>
</html>`;

  // Send via Gmail
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  await transporter.sendMail({
    from: `"Luxury Wash On Wheels" <${process.env.GMAIL_USER}>`,
    to: TO_EMAIL,
    subject,
    html,
  });

  console.log(`✅ $10 invoice email sent to ${TO_EMAIL}`);
  console.log(`💳 Pay Now link: ${paymentUrl}`);
}

main().catch(console.error);
