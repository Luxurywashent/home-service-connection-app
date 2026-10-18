import { describe, expect, it } from "vitest";

import {
  companyCalendarInstant,
  companyCalendarSlot,
  companyCalendarWeekDate,
  companyCalendarWeekPosition,
} from "../lib/company-calendar";
import { companyScheduleDateTime, mapCanonicalJobToScheduleFields } from "../lib/jobsync-company-authority";

describe("Company calendar timezone", () => {
  it("keeps a Central 9 AM appointment at 9 AM instead of reading it in the device timezone", () => {
    const slot = companyCalendarSlot(
      "2026-01-15T15:00:00.000Z",
      "2026-01-15T17:00:00.000Z",
      "America/Chicago",
    );

    expect(slot).toEqual({ date: "2026-01-15", startHour: 9, endHour: 11 });
    // The same instant is 7 AM Pacific, proving this assertion is Company-zone based.
    expect(companyCalendarSlot("2026-01-15T15:00:00.000Z", "2026-01-15T17:00:00.000Z", "America/Los_Angeles"))
      .toMatchObject({ startHour: 7 });
  });

  it("maps canonical job columns and week position using the Company timezone", () => {
    const mapped = mapCanonicalJobToScheduleFields({
      id: 44,
      customerId: 8,
      assignedUserId: 41,
      title: "Window Cleaning",
      serviceName: "Window Cleaning",
      status: "scheduled",
      scheduledStartAt: "2026-01-15T15:00:00.000Z",
      scheduledEndAt: "2026-01-15T17:00:00.000Z",
      updatedAt: "2026-01-14T15:00:00.000Z",
      addressLine1: "1 Main St",
      city: "Pensacola",
      amount: 249.5,
      paidTotal: 0,
      refundTotal: 0,
      appliedEstimateCredit: 0,
      balance: 249.5,
      paymentStatus: "unpaid",
      customerName: "Casey Owner",
      assignedName: "Alex Tech",
    }, "", "America/Chicago");

    expect(mapped).toMatchObject({ startHour: 9, endHour: 11, dayIndex: 3 });
    expect(companyCalendarWeekPosition("2026-01-15", new Date("2026-01-14T23:30:00.000Z"), "America/Chicago"))
      .toEqual({ dayIndex: 3, weekOffset: 0 });
  });

  it("converts Company wall-clock reschedules to UTC across standard and daylight-saving time", () => {
    expect(companyCalendarInstant("2026-01-15", 9, "America/Chicago")).toBe("2026-01-15T15:00:00.000Z");
    expect(companyCalendarInstant("2026-07-15", 9, "America/Chicago")).toBe("2026-07-15T14:00:00.000Z");
  });

  it("rejects a daylight-saving gap instead of coercing the Company-local appointment", () => {
    expect(companyCalendarInstant("2026-03-08", 2.5, "America/Chicago")).toBeNull();
    expect(() => companyScheduleDateTime("2026-03-08", 2.5, "America/Chicago"))
      .toThrow("The selected Company calendar time is invalid or does not exist.");
  });

  it("rejects invalid Company timezones for writes while retaining Company-local week dates", () => {
    const now = new Date("2026-01-15T01:00:00.000Z");
    expect(companyCalendarWeekDate(2, 0, "America/Chicago", now)).toBe("2026-01-14");
    expect(companyCalendarInstant("2026-01-15", 9, "Invalid/Timezone")).toBeNull();
    expect(() => companyScheduleDateTime("2026-01-15", 9, "Invalid/Timezone"))
      .toThrow("The selected Company calendar time is invalid or does not exist.");
  });
});
