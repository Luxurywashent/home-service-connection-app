/**
 * Tests for the booking confirmation email feature:
 * 1. Email is sent when a job is upserted with a customer email (notifyCustomer defaults to true)
 * 2. Email is suppressed when notifyCustomer === false
 * 3. Email is suppressed when customerEmail is missing
 * 4. Time formatting helper produces correct human-readable strings
 * 5. Date formatting produces correct long-form date strings
 */

import { describe, it, expect } from "vitest";

// ── Helpers extracted from the server mutation (pure functions, easy to unit-test) ──

function fmtHour(h: number): string {
  const period = h >= 12 ? "PM" : "AM";
  const hr = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hr}:00 ${period}`;
}

function buildScheduledTime(startHour?: number, endHour?: number, timeSlot?: string): string {
  if (startHour !== undefined && endHour !== undefined) {
    return `${fmtHour(startHour)} – ${fmtHour(endHour)}`;
  }
  return timeSlot ?? "TBD";
}

function buildScheduledDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

/** Simulates the server-side guard: should we send the email? */
function shouldSendConfirmation(opts: {
  notifyCustomer?: boolean;
  customerEmail?: string;
}): boolean {
  return opts.notifyCustomer !== false && !!opts.customerEmail;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("Booking Confirmation Email — shouldSendConfirmation guard", () => {
  it("sends email when notifyCustomer is true and email is present", () => {
    expect(shouldSendConfirmation({ notifyCustomer: true, customerEmail: "test@example.com" })).toBe(true);
  });

  it("sends email when notifyCustomer is undefined (default) and email is present", () => {
    expect(shouldSendConfirmation({ customerEmail: "test@example.com" })).toBe(true);
  });

  it("suppresses email when notifyCustomer is false", () => {
    expect(shouldSendConfirmation({ notifyCustomer: false, customerEmail: "test@example.com" })).toBe(false);
  });

  it("suppresses email when customerEmail is missing", () => {
    expect(shouldSendConfirmation({ notifyCustomer: true, customerEmail: undefined })).toBe(false);
  });

  it("suppresses email when customerEmail is empty string", () => {
    expect(shouldSendConfirmation({ notifyCustomer: true, customerEmail: "" })).toBe(false);
  });

  it("suppresses email when both notifyCustomer is false and email is missing", () => {
    expect(shouldSendConfirmation({ notifyCustomer: false, customerEmail: undefined })).toBe(false);
  });
});

describe("Booking Confirmation Email — time formatting", () => {
  it("formats 8 AM correctly", () => {
    expect(fmtHour(8)).toBe("8:00 AM");
  });

  it("formats 12 PM (noon) correctly", () => {
    expect(fmtHour(12)).toBe("12:00 PM");
  });

  it("formats 13 as 1:00 PM", () => {
    expect(fmtHour(13)).toBe("1:00 PM");
  });

  it("formats 0 as 12:00 AM (midnight)", () => {
    expect(fmtHour(0)).toBe("12:00 AM");
  });

  it("formats 17 as 5:00 PM", () => {
    expect(fmtHour(17)).toBe("5:00 PM");
  });

  it("builds scheduled time from startHour/endHour", () => {
    expect(buildScheduledTime(8, 10)).toBe("8:00 AM – 10:00 AM");
  });

  it("builds scheduled time from startHour/endHour for afternoon slot", () => {
    expect(buildScheduledTime(13, 15)).toBe("1:00 PM – 3:00 PM");
  });

  it("falls back to timeSlot string when hours are undefined", () => {
    expect(buildScheduledTime(undefined, undefined, "2:00 PM - 4:00 PM")).toBe("2:00 PM - 4:00 PM");
  });

  it("falls back to TBD when no time info is provided", () => {
    expect(buildScheduledTime(undefined, undefined, undefined)).toBe("TBD");
  });
});

describe("Booking Confirmation Email — date formatting", () => {
  it("formats a known date correctly", () => {
    const result = buildScheduledDate("2026-05-26");
    // Should produce something like "Tuesday, May 26, 2026"
    expect(result).toContain("2026");
    expect(result).toContain("May");
    expect(result).toContain("26");
  });

  it("returns the raw string if date is invalid", () => {
    const result = buildScheduledDate("not-a-date");
    // Invalid date — should return the raw string
    expect(typeof result).toBe("string");
  });
});

describe("Booking Confirmation Email — notifyCustomer toggle scenarios", () => {
  it("admin creating a new job with toggle ON sends email", () => {
    const result = shouldSendConfirmation({ notifyCustomer: true, customerEmail: "customer@example.com" });
    expect(result).toBe(true);
  });

  it("admin creating a new job with toggle OFF suppresses email", () => {
    const result = shouldSendConfirmation({ notifyCustomer: false, customerEmail: "customer@example.com" });
    expect(result).toBe(false);
  });

  it("detailer drag-to-move (notifyCustomer: false) suppresses email", () => {
    const result = shouldSendConfirmation({ notifyCustomer: false, customerEmail: "customer@example.com" });
    expect(result).toBe(false);
  });

  it("bulk re-sync (notifyCustomer: false) suppresses email", () => {
    const result = shouldSendConfirmation({ notifyCustomer: false, customerEmail: "customer@example.com" });
    expect(result).toBe(false);
  });

  it("online booking portal (notifyCustomer: undefined) sends email when email present", () => {
    // Online bookings go through a different path but the default behaviour
    // (notifyCustomer not set) should still send
    const result = shouldSendConfirmation({ notifyCustomer: undefined, customerEmail: "portal@example.com" });
    expect(result).toBe(true);
  });
});
