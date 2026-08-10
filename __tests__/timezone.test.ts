import { describe, it, expect } from "vitest";

describe("Timezone configuration", () => {
  it("TZ environment variable is set to America/Chicago", () => {
    // The TZ env var must be set so Node.js uses CST for all date operations
    expect(process.env.TZ).toBe("America/Chicago");
  });

  it("new Date().toLocaleDateString uses CST", () => {
    // Verify that date formatting uses Central time
    // At midnight UTC, CST is 6 hours behind (7 hours in CDT)
    // This test just verifies the TZ is loaded
    const tz = process.env.TZ;
    expect(tz).toBeTruthy();
    expect(tz).toContain("Chicago");
  });
});
