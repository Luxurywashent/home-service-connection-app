import { describe, it, expect } from "vitest";

describe("Twilio credentials", () => {
  it("should have TWILIO_ACCOUNT_SID set and valid format", () => {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    expect(sid).toBeDefined();
    expect(sid).toMatch(/^AC[a-f0-9]{32}$/);
  });

  it("should have TWILIO_AUTH_TOKEN set", () => {
    const token = process.env.TWILIO_AUTH_TOKEN;
    expect(token).toBeDefined();
    expect(token!.length).toBeGreaterThan(10);
  });

  it("should have TWILIO_PHONE_NUMBER set and valid format", () => {
    const phone = process.env.TWILIO_PHONE_NUMBER;
    expect(phone).toBeDefined();
    expect(phone).toMatch(/^\+1\d{10}$/);
  });

  it("should be able to reach Twilio API with the credentials", async () => {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const token = process.env.TWILIO_AUTH_TOKEN!;
    const credentials = Buffer.from(`${sid}:${token}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
      headers: { Authorization: `Basic ${credentials}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.sid).toBe(sid);
  });
});
