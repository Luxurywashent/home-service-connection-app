import { describe, it, expect } from "vitest";

describe("GHL Webhook URL", () => {
  it("GHL_WEBHOOK_URL env var is set", () => {
    // In CI/test env the secret is injected; verify it's a non-empty string
    const url = process.env.GHL_WEBHOOK_URL;
    expect(url).toBeTruthy();
    expect(typeof url).toBe("string");
    expect(url!.startsWith("https://")).toBe(true);
  });

  it("GHL webhook endpoint returns 200 on POST", async () => {
    const url = process.env.GHL_WEBHOOK_URL;
    if (!url) {
      console.warn("GHL_WEBHOOK_URL not set — skipping live test");
      return;
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        test: true,
        source: "vitest-validation",
        callback_id: "TEST_VALIDATION",
        first_name: "Test",
        phone: "+10000000000",
        scheduled_date: "Monday, April 7",
        scheduled_time: "12:00 PM",
        scheduled_iso: new Date().toISOString(),
        timezone: "America/Chicago",
        sms_message: "Test validation message — please ignore.",
      }),
    });
    expect(response.status).toBe(200);
  });
});
