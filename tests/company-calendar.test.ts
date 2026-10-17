import { describe, expect, it } from "vitest";

import { companyCalendarInstant, companyCalendarSlot, companyCalendarWeekPosition } from "../lib/company-calendar";

describe("Company calendar timezone adapter", () => {
  it("keeps a 9 AM–11 AM Central Company job at the same wall-clock time", () => {
    const slot = companyCalendarSlot(
      "2026-10-14T14:00:00.000Z",
      "2026-10-14T16:00:00.000Z",
      "America/Chicago",
    );

    expect(slot).toEqual({ date: "2026-10-14", startHour: 9, endHour: 11 });
  });

  it("does not use the device timezone to choose the Company calendar date", () => {
    const slot = companyCalendarSlot(
      "2026-10-14T00:30:00.000Z",
      "2026-10-14T01:30:00.000Z",
      "America/Chicago",
    );

    expect(slot).toEqual({ date: "2026-10-13", startHour: 19.5, endHour: 20.5 });
    expect(companyCalendarWeekPosition(slot!.date, new Date("2026-10-14T14:00:00.000Z"), "America/Chicago"))
      .toEqual({ dayIndex: 1, weekOffset: 0 });
  });

  it("writes a Company-local 9 AM–11 AM slot back as Central instants", () => {
    expect(companyCalendarInstant("2026-10-14", 9, "America/Chicago"))
      .toBe("2026-10-14T14:00:00.000Z");
    expect(companyCalendarInstant("2026-10-14", 11, "America/Chicago"))
      .toBe("2026-10-14T16:00:00.000Z");
  });
});
