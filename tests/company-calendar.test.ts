import { describe, expect, it } from "vitest";

import {
  companyCalendarDisplayWeekDates,
  companyCalendarInstant,
  companyCalendarSlot,
  companyCalendarTodayDayIndex,
  companyCalendarWeekDate,
  companyCalendarWeekPosition,
} from "../lib/company-calendar";
import {
  companyScheduleDateTime,
  mapCanonicalJobToScheduleFields,
} from "../lib/jobsync-company-authority";

function deviceCalendarDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

describe("Company calendar timezone", () => {
  it("keeps a Central 9 AM appointment at 9 AM instead of reading it in the device timezone", () => {
    const slot = companyCalendarSlot(
      "2026-01-15T15:00:00.000Z",
      "2026-01-15T17:00:00.000Z",
      "America/Chicago",
    );

    expect(slot).toEqual({ date: "2026-01-15", startHour: 9, endHour: 11 });
    // The same instant is 7 AM Pacific, proving this assertion is Company-zone based.
    expect(
      companyCalendarSlot(
        "2026-01-15T15:00:00.000Z",
        "2026-01-15T17:00:00.000Z",
        "America/Los_Angeles",
      ),
    ).toMatchObject({ startHour: 7 });
  });

  it("maps canonical job columns and week position using the Company timezone", () => {
    const mapped = mapCanonicalJobToScheduleFields(
      {
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
      },
      "",
      "America/Chicago",
    );

    expect(mapped).toMatchObject({ startHour: 9, endHour: 11, dayIndex: 3 });
    expect(
      companyCalendarWeekPosition(
        "2026-01-15",
        new Date("2026-01-14T23:30:00.000Z"),
        "America/Chicago",
      ),
    ).toEqual({ dayIndex: 3, weekOffset: 0 });
  });

  it("converts Company wall-clock reschedules to UTC across standard and daylight-saving time", () => {
    expect(companyCalendarInstant("2026-01-15", 9, "America/Chicago")).toBe(
      "2026-01-15T15:00:00.000Z",
    );
    expect(companyCalendarInstant("2026-07-15", 9, "America/Chicago")).toBe(
      "2026-07-15T14:00:00.000Z",
    );
  });

  it("rejects a daylight-saving gap instead of coercing the Company-local appointment", () => {
    expect(
      companyCalendarInstant("2026-03-08", 2.5, "America/Chicago"),
    ).toBeNull();
    expect(() =>
      companyScheduleDateTime("2026-03-08", 2.5, "America/Chicago"),
    ).toThrow(
      "The selected Company calendar time is invalid or does not exist.",
    );
  });

  it("rejects invalid Company timezones for writes while retaining Company-local week dates", () => {
    const now = new Date("2026-01-15T01:00:00.000Z");
    expect(companyCalendarWeekDate(2, 0, "America/Chicago", now)).toBe(
      "2026-01-14",
    );
    expect(
      companyCalendarInstant("2026-01-15", 9, "Invalid/Timezone"),
    ).toBeNull();
    expect(() =>
      companyScheduleDateTime("2026-01-15", 9, "Invalid/Timezone"),
    ).toThrow(
      "The selected Company calendar time is invalid or does not exist.",
    );
  });

  it("uses the Company, not device, calendar when Pacific is Sunday and Chicago is Monday", () => {
    const now = new Date("2026-01-12T07:30:00.000Z");
    const pacificDates = companyCalendarDisplayWeekDates(
      0,
      "America/Los_Angeles",
      now,
    );
    const chicagoDates = companyCalendarDisplayWeekDates(
      0,
      "America/Chicago",
      now,
    );

    expect(companyCalendarTodayDayIndex("America/Los_Angeles", now)).toBe(6);
    expect(companyCalendarTodayDayIndex("America/Chicago", now)).toBe(0);
    expect(pacificDates.map(deviceCalendarDate)).toEqual([
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
      "2026-01-08",
      "2026-01-09",
      "2026-01-10",
      "2026-01-11",
    ]);
    expect(chicagoDates.map(deviceCalendarDate)).toEqual([
      "2026-01-12",
      "2026-01-13",
      "2026-01-14",
      "2026-01-15",
      "2026-01-16",
      "2026-01-17",
      "2026-01-18",
    ]);
    expect(
      pacificDates.every(
        (date) => date.getHours() === 12 && date.getMinutes() === 0,
      ),
    ).toBe(true);
    expect(pacificDates.map((date) => date.getDay())).toEqual([
      1, 2, 3, 4, 5, 6, 0,
    ]);
  });

  it("preserves Company year-boundary weeks for a daylight-saving Auckland calendar", () => {
    const now = new Date("2026-01-04T11:30:00.000Z");
    const aucklandDates = companyCalendarDisplayWeekDates(
      0,
      "Pacific/Auckland",
      now,
    );
    const chicagoDates = companyCalendarDisplayWeekDates(
      0,
      "America/Chicago",
      now,
    );

    expect(companyCalendarTodayDayIndex("Pacific/Auckland", now)).toBe(0);
    expect(companyCalendarTodayDayIndex("America/Chicago", now)).toBe(6);
    expect(aucklandDates.map(deviceCalendarDate)).toEqual([
      "2026-01-05",
      "2026-01-06",
      "2026-01-07",
      "2026-01-08",
      "2026-01-09",
      "2026-01-10",
      "2026-01-11",
    ]);
    expect(chicagoDates.map(deviceCalendarDate)).toEqual([
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ]);
  });

  it("keeps the Sunday-to-Monday Company split across the US daylight-saving transition", () => {
    const now = new Date("2026-03-09T06:30:00.000Z");

    expect(companyCalendarTodayDayIndex("America/Los_Angeles", now)).toBe(6);
    expect(companyCalendarTodayDayIndex("America/Chicago", now)).toBe(0);
    expect(
      companyCalendarDisplayWeekDates(0, "America/Los_Angeles", now).map(
        deviceCalendarDate,
      )[0],
    ).toBe("2026-03-02");
    expect(
      companyCalendarDisplayWeekDates(0, "America/Chicago", now).map(
        deviceCalendarDate,
      )[0],
    ).toBe("2026-03-09");
  });
});
