const nodemailer = require("nodemailer");

const gmailUser = process.env.GMAIL_USER;
const gmailPass = process.env.GMAIL_APP_PASSWORD;

console.log("Gmail user:", gmailUser);
console.log("Gmail pass set:", !!gmailPass);

if (!gmailUser || !gmailPass) {
  console.error("Missing Gmail credentials");
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: gmailUser,
    pass: gmailPass,
  },
});

const html = `<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;padding:20px;">
  <h2>⏰ Test: Running Late Email</h2>
  <p>Hi <strong>Adrian</strong>,</p>
  <p>This is a test of the late arrival notification email from <strong>Luxury Wash On Wheels</strong>.</p>
  <table style="background:#fef3c7;border-radius:10px;padding:20px;border:1px solid #fde68a;width:100%;">
    <tr><td style="color:#92400e;">⏱ Delay</td><td style="color:#78350f;font-weight:700;">~20 minutes</td></tr>
    <tr><td style="color:#92400e;">🕐 New ETA</td><td style="color:#78350f;font-weight:700;">10:20 AM</td></tr>
  </table>
  <p>We sincerely apologize for the inconvenience!</p>
  <p>— Luxury Wash On Wheels Team</p>
</body>
</html>`;

transporter.sendMail({
  from: `"Luxury Wash On Wheels" <${gmailUser}>`,
  to: "luxurywashonwheels@gmail.com",
  subject: "⏰ Test: Running Late Email — Luxury Wash On Wheels",
  html,
  text: "Test late arrival email from Luxury Wash On Wheels.",
}, (err, info) => {
  if (err) {
    console.error("❌ Failed to send email:", err.message);
    console.error(err);
  } else {
    console.log("✅ Email sent! Message ID:", info.messageId);
    console.log("Response:", info.response);
  }
});
