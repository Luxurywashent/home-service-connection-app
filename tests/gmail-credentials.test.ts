import { describe, it, expect } from "vitest";
import nodemailer from "nodemailer";

describe("Gmail SMTP credentials", () => {
  it("should verify Gmail transporter with provided credentials", async () => {
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;

    expect(user, "GMAIL_USER must be set").toBeTruthy();
    expect(pass, "GMAIL_APP_PASSWORD must be set").toBeTruthy();

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });

    // verify() checks SMTP connection and auth without sending an email
    await expect(transporter.verify()).resolves.toBe(true);
  }, 15000);
});
