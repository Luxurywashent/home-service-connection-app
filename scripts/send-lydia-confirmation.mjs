/**
 * One-time script: send booking confirmation email to Lydia Birka
 * Job ID: 9000003 | Date: 2026-07-06 | Time: Noon - 2:30 PM | Package: Full Detail | $250
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);

// Load env
const dotenv = require("dotenv");
dotenv.config({ path: new URL("../.env", import.meta.url).pathname });

// Dynamically import the compiled email module
const { sendEmail, buildBookingConfirmationEmail } = await import("../server/email.ts").catch(async () => {
  // fallback: use tsx to run
  throw new Error("Use tsx to run this script");
});

const email = buildBookingConfirmationEmail({
  customerName: "Lydia Birka",
  bookingRef: "1783348271545",
  packageName: "Full Detail",
  vehicleLabel: "SUV",
  scheduledDate: "Monday, July 6, 2026",
  scheduledTime: "Noon - 2:30 PM",
  addressLabel: "1205 Northview Drive, Crestview, FL",
  total: 250,
});

const result = await sendEmail({
  to: "lrbirka@gmail.com",
  subject: email.subject,
  html: email.html,
  type: "other",
  customerName: "Lydia Birka",
  urgent: true,
});

console.log("Email sent:", JSON.stringify(result, null, 2));
