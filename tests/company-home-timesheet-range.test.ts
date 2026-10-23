import { describe, expect, it, vi } from "vitest";
import { companyHomeTimesheetRange } from "../lib/company-home-timesheet-range";
import { getHomeServiceConnectedTimesheets } from "../lib/jobsync-mobile-api";

describe("Company-local home timesheet filters", () => {
  it.each([
    ["today", { today: true }, "today=1"],
    ["week", { weekOffset: 0 }, "weekOffset=0"],
    ["all", { start: "2020-01-01" }, "start=2020-01-01"],
  ] as const)("uses canonical relative bounds for %s", async (view, expected, query) => {
    expect(companyHomeTimesheetRange(view)).toEqual(expected);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ timezone: "Pacific/Auckland", records: [] }),
    } as Response);
    try {
      await getHomeServiceConnectedTimesheets("test-company-token", companyHomeTimesheetRange(view));
      expect(String(fetchMock.mock.calls[0][0])).toContain(`/time/timesheets?${query}`);
      expect(String(fetchMock.mock.calls[0][0])).not.toContain("end=");
    } finally {
      fetchMock.mockRestore();
    }
  });
});
