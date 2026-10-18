import { describe, expect, it, vi } from "vitest";

import { reconcileClockAction } from "../lib/company-clock-reconcile";
import { shouldPublishCompanyLocation, shouldUseBackgroundCompanyLocation } from "../lib/company-location-policy";
import {
  getJobSyncCompanyDashboardSummary,
  isCompanyLocationStale,
  normalizeHomeServiceConnectedTimesheetPage,
  normalizeJobSyncCompanyDashboardSummary,
  normalizeJobSyncCompanyDispatchBoard,
} from "../lib/jobsync-mobile-api";

const clockedIn = {
  isClockedIn: true,
  clockInAt: "2026-10-17T13:00:00.000Z",
  activeBreak: null,
};

describe("Phase 1 company repairs", () => {
  it("does not treat a failed revenue summary as zero dollars", () => {
    expect(() => normalizeJobSyncCompanyDashboardSummary({ ok: true })).toThrow(/revenue summary/);
    expect(() => normalizeJobSyncCompanyDashboardSummary({
      timezone: "America/Chicago",
      generatedAt: "2026-10-17T18:00:00.000Z",
      collected: 10,
    })).toThrow(/booked revenue/);
    const summary = normalizeJobSyncCompanyDashboardSummary({
      period: "week",
      timezone: "America/Chicago",
      generatedAt: "2026-10-17T18:00:00.000Z",
      bookedRevenue: 0,
      scheduledRevenue: 0,
      completedJobValue: 0,
      collected: 25,
      outstandingBalance: 5,
      jobsBooked: 0,
      jobsCompleted: 0,
      upsellRevenue: null,
      discountTotal: null,
    });
    expect(summary.bookedRevenue).toBe(0);
    expect(summary.collected).toBe(25);
    expect(summary.upsellRevenue).toBeNull();
    expect(summary.discountTotal).toBeNull();
  });

  it("confirms a timed-out clock-in from the server shift and does not invent one", () => {
    expect(reconcileClockAction("clock-in", clockedIn, new Error("Home Service Connected took too long to respond. Check your connection and try again.")).status).toBe("confirmed");
    expect(reconcileClockAction("clock-in", { ...clockedIn, isClockedIn: false, clockInAt: null }, new Error("You are already clocked in.")).status).toBe("rejected");
    expect(reconcileClockAction("clock-in", null, new Error("Home Service Connected took too long to respond.")).status).toBe("unknown");
    expect(reconcileClockAction("clock-out", { ...clockedIn, isClockedIn: false, clockInAt: null }, new Error("timed out")).status).toBe("confirmed");
    expect(reconcileClockAction("clock-out", clockedIn, new Error("timed out")).status).toBe("rejected");
  });

  it("keeps approval data and company week bounds on timesheet pages", () => {
    const page = normalizeHomeServiceConnectedTimesheetPage({
      timezone: "America/Chicago",
      weekStart: "2026-10-12",
      weekEnd: "2026-10-18",
      records: [{
        id: 9,
        memberUserId: 41,
        memberName: "Alex Tech",
        date: "2026-10-15",
        clockIn: "2026-10-15T13:00:00.000Z",
        clockOut: null,
        totalHours: null,
        approvalStatus: "approved",
        reviewerNote: "Reviewed",
      }],
    });
    expect(page.timezone).toBe("America/Chicago");
    expect(page.weekStart).toBe("2026-10-12");
    expect(page.records[0]).toMatchObject({ approvalStatus: "approved", reviewerNote: "Reviewed", date: "2026-10-15" });
  });

  it("hides stale technician locations and publishes only for a clocked-in technician", () => {
    const now = Date.now();
    const board = normalizeJobSyncCompanyDispatchBoard({
      locations: [
        { userId: 4, name: "Alex", latitude: 30.1, longitude: -97.1, recordedAt: new Date(now - 60_000).toISOString(), stale: false },
        { userId: 5, name: "Blair", latitude: 30.2, longitude: -97.2, recordedAt: new Date(now - 20 * 60_000).toISOString(), stale: true },
      ],
    });
    expect(board.locations.map((location) => [location.userId, isCompanyLocationStale(location, now)])).toEqual([[4, false], [5, true]]);
    expect(shouldPublishCompanyLocation({ role: "technician", clockedIn: true, disclosureAccepted: true, foregroundGranted: true, appActive: true })).toBe(true);
    expect(shouldPublishCompanyLocation({ role: "owner", clockedIn: true, disclosureAccepted: true, foregroundGranted: true, appActive: true })).toBe(false);
    expect(shouldPublishCompanyLocation({ role: "technician", clockedIn: false, disclosureAccepted: true, foregroundGranted: true, appActive: true })).toBe(false);
    expect(shouldPublishCompanyLocation({ role: "technician", clockedIn: true, disclosureAccepted: false, foregroundGranted: true, appActive: true })).toBe(false);
    expect(shouldUseBackgroundCompanyLocation({ role: "technician", clockedIn: true, disclosureAccepted: true, backgroundAlreadyGranted: false })).toBe(false);
    expect(shouldUseBackgroundCompanyLocation({ role: "technician", clockedIn: true, disclosureAccepted: true, backgroundAlreadyGranted: true })).toBe(true);
  });

  it("requests the Company dashboard summary and rejects an empty success body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ period: "day" }),
    } as Response);
    try {
      await expect(getJobSyncCompanyDashboardSummary("company-token", { period: "week" })).rejects.toThrow(/revenue summary/);
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/dashboard/summary?period=week");
    } finally {
      fetchMock.mockRestore();
    }
  });
});
