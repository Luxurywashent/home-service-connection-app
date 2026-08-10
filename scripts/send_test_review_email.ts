import "./load-env.js";
import { sendEmail, buildReviewRequestEmail, getReviewLinkForCity } from "../server/email";

const city = "Pensacola";
const reviewLink = getReviewLinkForCity(city);
const { subject, html } = buildReviewRequestEmail({
  customerName: "Adrian",
  detailerFirstName: "Adrian",
  serviceType: "Full Detail",
  city,
  reviewLink,
});

sendEmail({
  to: "adrian@luxurywashonwheels.com",
  subject,
  html,
  type: "other",
  customerName: "Adrian",
})
  .then(() => {
    console.log("✅ Review email sent successfully to adrian@luxurywashonwheels.com");
  })
  .catch((err: unknown) => {
    console.error("❌ Failed to send email:", err);
    process.exit(1);
  });
