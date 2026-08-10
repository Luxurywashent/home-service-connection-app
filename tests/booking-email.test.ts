import { describe, it, expect } from "vitest";
import { sendEmail, buildBookingConfirmationEmail } from "../server/email";

describe("Booking confirmation email", () => {
  it("should send a booking confirmation email to test address", async () => {
    const { subject, html } = buildBookingConfirmationEmail({
      customerName: "Adrian Test",
      bookingRef: "bk_test_001",
      packageName: "Full Detail — Interior + Exterior",
      vehicleLabel: "2022 Toyota Camry (Black)",
      scheduledDate: "Saturday, May 10, 2026",
      scheduledTime: "10:00 AM",
      addressLabel: "123 Main St, Pensacola FL 32501",
      addons: ["Ceramic Coating", "Odor Elimination"],
      total: 249.00,
      notes: "Please use the side gate entrance.",
    });

    expect(subject).toContain("Booking Confirmed");
    expect(html).toContain("Adrian");
    expect(html).toContain("bk_test_001");
    expect(html).toContain("$249.00");

    const sent = await sendEmail({
      to: "adrian@luxurywashonwheels.com",
      subject,
      html,
      type: "booking_confirmation",
      customerName: "Adrian Test",
      bookingRef: "bk_test_001",
    });
    expect(sent).toBe(true);
  }, 20000);
});
