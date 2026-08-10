import nodemailer from "nodemailer";

const GMAIL_USER = process.env.GMAIL_USER ?? "";
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD ?? "";

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error("Gmail credentials not found in environment");
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: GMAIL_USER,
    pass: GMAIL_APP_PASSWORD,
  },
});

const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Booking Confirmed</title></head>
<body style="margin:0;padding:0;background:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#1a1a2e;padding:32px 40px;text-align:center;">
            <div style="font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">Luxury Wash On Wheels</div>
            <div style="font-size:14px;color:#94A3B8;margin-top:4px;">Mobile Detailing</div>
          </td>
        </tr>
        <tr>
          <td style="background:#ECFDF5;padding:20px 40px;text-align:center;border-bottom:1px solid #D1FAE5;">
            <div style="font-size:32px;margin-bottom:8px;">✅</div>
            <div style="font-size:20px;font-weight:700;color:#065F46;">Booking Confirmed!</div>
            <div style="font-size:14px;color:#059669;margin-top:4px;">Your appointment has been scheduled.</div>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 40px;">
            <p style="margin:0 0 24px;font-size:16px;color:#374151;">Hi <strong>Adrian</strong>, thanks for booking with us! Here are your appointment details:</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #F3F4F6;">
              <tr>
                <td style="padding:12px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Service</td>
                <td style="padding:12px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #F3F4F6;">Luxury Detail</td>
              </tr>
              <tr>
                <td style="padding:12px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Vehicle</td>
                <td style="padding:12px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">SUV</td>
              </tr>
              <tr>
                <td style="padding:12px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Date</td>
                <td style="padding:12px 0;color:#111827;font-size:14px;font-weight:600;text-align:right;border-bottom:1px solid #F3F4F6;">Tuesday, May 12, 2026</td>
              </tr>
              <tr>
                <td style="padding:12px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Time</td>
                <td style="padding:12px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">10:00 AM – 12:00 PM</td>
              </tr>
              <tr>
                <td style="padding:12px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Location</td>
                <td style="padding:12px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">422 Swift Fox Run, Crestview, FL 32539</td>
              </tr>
              <tr>
                <td style="padding:12px 0;color:#6B7280;font-size:14px;border-bottom:1px solid #F3F4F6;">Booking Ref</td>
                <td style="padding:12px 0;color:#111827;font-size:14px;text-align:right;border-bottom:1px solid #F3F4F6;">#LW-TEST-001</td>
              </tr>
              <tr>
                <td style="padding:12px 0;color:#6B7280;font-size:14px;">Total</td>
                <td style="padding:12px 0;color:#111827;font-size:18px;font-weight:700;text-align:right;">$325.00</td>
              </tr>
            </table>
            <div style="background:#F0F9FF;border-radius:8px;padding:16px;margin-top:24px;">
              <div style="font-size:13px;color:#0369A1;font-weight:600;margin-bottom:4px;">📱 What happens next?</div>
              <div style="font-size:13px;color:#0369A1;">You'll receive a reminder the day before your appointment with a confirmation link. Our team will arrive at your location at the scheduled time.</div>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#F9FAFB;padding:24px 40px;text-align:center;border-top:1px solid #F3F4F6;">
            <div style="font-size:13px;color:#9CA3AF;">Questions? Call or text us at <a href="tel:+18503678586" style="color:#1a1a2e;font-weight:600;">(850) 367-8586</a></div>
            <div style="font-size:12px;color:#D1D5DB;margin-top:8px;">Luxury Wash On Wheels · Crestview, FL</div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

async function main() {
try {
  const result = await transporter.sendMail({
    from: `"Luxury Wash On Wheels" <${GMAIL_USER}>`,
    to: "Adrian@luxurywashonwheels.com",
    subject: "Booking Confirmed — Luxury Detail on Tuesday, May 12",
    html,
    text: "Hi Adrian, your Luxury Detail appointment is confirmed for Tuesday, May 12, 2026 at 10:00 AM at 422 Swift Fox Run, Crestview, FL 32539. Total: $325.00. Questions? Call (850) 367-8586.",
  });
  console.log("✅ Email sent! Message ID:", result.messageId);
} catch (err: any) {
  console.error("❌ Failed:", err.message);
  process.exit(1);
}
}
main();
