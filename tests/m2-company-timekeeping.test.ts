import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  COMPANY_TIMEKEEPING_LEGACY_FALLTHROUGH_BLOCKED,
  COMPANY_TIME_OFF_LEGACY_FALLTHROUGH_BLOCKED,
  allowsLegacyTimeOffAuthority,
  allowsLegacyTimekeepingAuthority,
  companyCanonicalListState,
  companyClockUsesCanonicalAuthority,
  companyTimeOffDuplicatesScheduleConflictLogic,
  companyTimeOffWritesLocalRecord,
  companyTimesheetsWriteLocalLedger,
  forbidLegacyCompanyTimeOff,
  forbidLegacyCompanyTimekeeping,
  resolveCompanyTimeOffAuthority,
  resolveCompanyTimekeepingAuthority,
  usesCompanyTimeOffAuthority,
  usesCompanyTimekeepingAuthority,
} from "../lib/jobsync-company-authority";
import {
  clockInHomeServiceConnected,
  clockOutHomeServiceConnected,
  createHomeServiceConnectedTimeOff,
  getHomeServiceConnectedTeamTimeSummary,
  getHomeServiceConnectedTimeOff,
  getHomeServiceConnectedTimesheets,
  normalizeHomeServiceConnectedTimeOffList,
  normalizeHomeServiceConnectedTimesheets,
  reviewHomeServiceConnectedTimeOff,
  sanitizeCompanyMutationBody,
  sanitizeCompanyTimeMutationBody,
  sumHomeServiceConnectedTimesheetHours,
} from "../lib/jobsync-mobile-api";

const apiSource = readFileSync(new URL("../lib/jobsync-mobile-api.ts", import.meta.url), "utf8");
const clockHeaderSource = readFileSync(new URL("../components/header-clock-status.tsx", import.meta.url), "utf8");
const companyClockSource = readFileSync(new URL("../components/company-clock-status.tsx", import.meta.url), "utf8");
const timesheetSource = readFileSync(new URL("../app/(tabs)/timesheet.tsx", import.meta.url), "utf8");
const adminTimesheetSource = readFileSync(new URL("../app/(tabs)/admin-timesheet.tsx", import.meta.url), "utf8");
const salesTimesheetSource = readFileSync(new URL("../app/(sales)/timesheet.tsx", import.meta.url), "utf8");
const requestOffSource = readFileSync(new URL("../app/(tabs)/request-off.tsx", import.meta.url), "utf8");
const adminTimeOffSource = readFileSync(new URL("../app/(tabs)/admin-timeoff.tsx", import.meta.url), "utf8");
const timesheetPanelSource = readFileSync(new URL("../components/company-timesheet-panel.tsx", import.meta.url), "utf8");
const timeOffPanelSource = readFileSync(new URL("../components/company-time-off-panel.tsx", import.meta.url), "utf8");
const scheduleSource = readFileSync(new URL("../app/(tabs)/schedule.tsx", import.meta.url), "utf8");
const unpaidSource = readFileSync(new URL("../app/(tabs)/admin-unpaid-jobs.tsx", import.meta.url), "utf8");
const invoicesSource = readFileSync(new URL("../app/(tabs)/admin-invoices.tsx", import.meta.url), "utf8");
const homeSource = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");

const companySession = {
  token: "company-token",
  portal: "company" as const,
  user: { id: 42, name: "Alex Tech", email: "alex@example.com", role: "technician" as const },
};

function mockOk(body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    json: async () => body,
  } as Response);
}

describe("M2 Company Clock / Timesheets / Time Off", () => {
  it("uses canonical JobSync clock-in and clock-out bearer paths without client identity", async () => {
    const fetchMock = mockOk({ entry: { id: 11, clockIn: "2026-09-19T13:00:00.000Z" } });
    try {
      await clockInHomeServiceConnected("company-token");
      await clockOutHomeServiceConnected("company-token");
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/time/clock-in");
      expect(String(fetchMock.mock.calls[1][0])).toContain("/api/mobile/v1/time/clock-out");
      expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "POST" }));
      expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBeUndefined();
      expect((fetchMock.mock.calls[1][1] as RequestInit).body).toBeUndefined();
    } finally {
      fetchMock.mockRestore();
    }
    expect(companyClockSource).toContain("clockInHomeServiceConnected");
    expect(companyClockSource).toContain("clockOutHomeServiceConnected");
    expect(companyClockUsesCanonicalAuthority()).toBe(true);
    expect(apiSource).toContain("TIME_CLOCK_IN_PATH = \"/api/mobile/v1/time/clock-in\"");
    expect(apiSource).toContain("TIME_CLOCK_OUT_PATH = \"/api/mobile/v1/time/clock-out\"");
  });

  it("derives Company and member identity on the server for Clock mutations", () => {
    expect(() => sanitizeCompanyTimeMutationBody({ status: "approved", companyId: 9 })).toThrow(
      "Company identity must come from the authenticated Home Service Connected session.",
    );
    expect(() => sanitizeCompanyTimeMutationBody({ startDate: "2026-09-20", employeeId: "jobsync-9-42" })).toThrow(
      "Company identity must come from the authenticated Home Service Connected session.",
    );
    expect(() => sanitizeCompanyTimeMutationBody({ status: "approved", userId: 42 })).toThrow(
      "Company identity must come from the authenticated Home Service Connected session.",
    );
    expect(sanitizeCompanyTimeMutationBody({ status: "approved" })).toEqual({ status: "approved" });
    expect(companyClockSource).not.toContain("companyId");
    expect(companyClockSource).not.toContain("employeeId");
  });

  it("treats duplicate active clock-in as a canonical server conflict", () => {
    expect(companyClockSource).toContain("already\\s+(?:clocked\\s+)?in");
    expect(companyClockSource).toContain("activeShiftRecovery");
    expect(apiSource).toContain("/api/mobile/v1/time/current");
  });

  it("does not let unknown auth fall into legacy Clock", () => {
    const loading = resolveCompanyTimekeepingAuthority({ session: null, sessionLoading: true });
    expect(loading).toBe("unknown");
    expect(allowsLegacyTimekeepingAuthority(loading)).toBe(false);
    expect(usesCompanyTimekeepingAuthority(loading)).toBe(false);
    expect(usesCompanyTimekeepingAuthority(resolveCompanyTimekeepingAuthority({ session: companySession, sessionLoading: false }))).toBe(true);
    expect(clockHeaderSource).toContain("resolveCompanyTimekeepingAuthority");
    expect(clockHeaderSource).toContain("allowsLegacyTimekeepingAuthority");
    expect(clockHeaderSource).toContain("CompanyClockStatus");
    expect(clockHeaderSource).not.toMatch(/if \(session\?\.portal === "company"\) \{\s*return <CompanyClockStatus/);
  });

  it("reads Company Timesheets from canonical clock records and does not write a second ledger", async () => {
    const fetchMock = mockOk({
      records: [
        { id: 88, memberName: "Alex Tech", date: "2026-09-19", clockIn: "2026-09-19T13:00:00.000Z", clockOut: "2026-09-19T21:00:00.000Z", totalHours: 7.5 },
      ],
    });
    try {
      const records = await getHomeServiceConnectedTimesheets("company-token", { start: "2026-09-14", end: "2026-09-20" });
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/time/timesheets?start=2026-09-14&end=2026-09-20");
      expect(records).toEqual([expect.objectContaining({ id: 88, totalHours: 7.5, date: "2026-09-19" })]);
      expect(sumHomeServiceConnectedTimesheetHours(records)).toBe(7.5);
    } finally {
      fetchMock.mockRestore();
    }
    expect(companyTimesheetsWriteLocalLedger()).toBe(false);
    expect(timesheetSource).toContain("CompanyTimesheetPanel");
    expect(adminTimesheetSource).toContain("CompanyTimesheetPanel");
    expect(salesTimesheetSource).toContain("CompanyTimesheetPanel");
    expect(timesheetPanelSource).toContain("getHomeServiceConnectedTimesheets");
    expect(timesheetPanelSource).not.toContain("trpc.timesheet");
    expect(timesheetPanelSource).toContain("does not keep a second timesheet ledger");
  });

  it("represents the same underlying fs_clock_records as web Timesheets", () => {
    const records = normalizeHomeServiceConnectedTimesheets({
      records: [{ id: 88, memberName: "Alex Tech", date: "2026-09-19", clockIn: "2026-09-19T13:00:00.000Z", clockOut: null, totalHours: null }],
    });
    expect(records[0]?.id).toBe(88);
    expect(apiSource).toContain("/api/mobile/v1/time/timesheets");
    expect(timesheetPanelSource).toContain("canonical clock records");
  });

  it("keeps manager timesheet edits on canonical authority and does not add mobile-only edit rules", async () => {
    const fetchMock = mockOk({ members: [{ id: 41, name: "Alex Tech", clockedIn: true, todayHours: 3 }] });
    try {
      const team = await getHomeServiceConnectedTeamTimeSummary("company-token");
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/time/team-summary");
      expect(team[0]).toMatchObject({ id: 41, clockedIn: true, todayHours: 3 });
    } finally {
      fetchMock.mockRestore();
    }
    expect(timesheetPanelSource).toContain("Time edits and approvals stay on the Home Service Connected Timesheets screen");
    expect(timesheetPanelSource).not.toContain("updateClockInTime");
    expect(adminTimesheetSource).toContain("showTeam");
    expect(salesTimesheetSource).toContain("LegacySalesTimesheetScreen");
  });

  it("does not treat a Company timesheet API failure as a legitimate empty week", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: { message: "Home Service Connected operations are temporarily unavailable." } }),
    } as Response);
    try {
      await expect(getHomeServiceConnectedTimesheets("company-token")).rejects.toThrow(
        "Home Service Connected operations are temporarily unavailable.",
      );
    } finally {
      fetchMock.mockRestore();
    }
    expect(companyCanonicalListState({ loading: false, error: "Home Service Connected operations are temporarily unavailable.", itemCount: 0 })).toBe("error");
    expect(timesheetPanelSource).toContain("companyTimeListState");
    expect(timesheetPanelSource).toContain("Company timesheets are unavailable");
  });

  it("uses canonical Time Off request, approval, and denial authority", async () => {
    const fetchMock = mockOk({
      success: true,
      requestId: 17,
      status: "approved",
      approved: true,
      coveredJobIds: [44],
      inFieldJobIds: [51],
      coveredCount: 1,
      inFieldCount: 1,
    });
    try {
      await createHomeServiceConnectedTimeOff("company-token", {
        startDate: "2026-09-22",
        endDate: "2026-09-23",
        hoursRequested: 16,
        requestType: "vacation",
        reason: "Family",
      });
      const review = await reviewHomeServiceConnectedTimeOff("company-token", 17, { status: "approved", reviewerNote: "Covered" });
      expect(String(fetchMock.mock.calls[0][0])).toContain("/api/mobile/v1/time-off");
      expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "POST" }));
      expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
        startDate: "2026-09-22",
        endDate: "2026-09-23",
        hoursRequested: 16,
        requestType: "vacation",
        reason: "Family",
      });
      expect(String(fetchMock.mock.calls[1][0])).toContain("/api/mobile/v1/time-off/17/review");
      expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({ method: "PATCH" }));
      expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({
        status: "approved",
        reviewerNote: "Covered",
      });
      expect(review).toMatchObject({ approved: true, coveredJobIds: [44], inFieldJobIds: [51] });
    } finally {
      fetchMock.mockRestore();
    }
    const denyMock = mockOk({ success: true, requestId: 17, status: "denied", approved: false, coveredJobIds: [], inFieldJobIds: [] });
    try {
      await reviewHomeServiceConnectedTimeOff("company-token", 17, { status: "denied" });
      expect(JSON.parse(String((denyMock.mock.calls[0][1] as RequestInit).body))).toEqual({ status: "denied" });
    } finally {
      denyMock.mockRestore();
    }
    expect(requestOffSource).toContain("CompanyTimeOffPanel");
    expect(adminTimeOffSource).toContain("mode=\"review\"");
    expect(timeOffPanelSource).toContain("createHomeServiceConnectedTimeOff");
    expect(timeOffPanelSource).toContain("reviewHomeServiceConnectedTimeOff");
    expect(companyTimeOffWritesLocalRecord()).toBe(false);
  });

  it("enforces server ownership and does not duplicate Phase 5E.3 coverage logic", async () => {
    const list = normalizeHomeServiceConnectedTimeOffList({
      canReview: false,
      requests: [{ id: 17, userId: 42, memberName: "Alex Tech", startDate: "2026-09-22", endDate: "2026-09-23", hoursRequested: 16, requestType: "vacation", status: "pending" }],
    });
    expect(list.canReview).toBe(false);
    expect(list.requests[0]?.userId).toBe(42);
    expect(companyTimeOffDuplicatesScheduleConflictLogic()).toBe(false);
    expect(timeOffPanelSource).toContain("overlap and coverage are enforced by the server");
    expect(timeOffPanelSource).toContain("Mobile does not calculate schedule conflicts");
    expect(timeOffPanelSource).toContain("coveredCount");
    expect(apiSource).not.toContain("TIME_OFF_COVERAGE_JOBS_SQL");
    await expect(reviewHomeServiceConnectedTimeOff("company-token", 0, { status: "approved" })).rejects.toThrow(
      "A valid Company Time Off request ID is required.",
    );
  });

  it("blocks unknown auth from falling into legacy Time Off and blocks Company fallthrough", () => {
    const loading = resolveCompanyTimeOffAuthority({ session: null, sessionLoading: true });
    expect(loading).toBe("unknown");
    expect(allowsLegacyTimeOffAuthority(loading)).toBe(false);
    expect(usesCompanyTimeOffAuthority(loading)).toBe(false);
    expect(requestOffSource).toContain("resolveCompanyTimeOffAuthority");
    expect(adminTimeOffSource).toContain("allowsLegacyTimeOffAuthority");
    expect(() => forbidLegacyCompanyTimeOff(true, "create")).toThrow(COMPANY_TIME_OFF_LEGACY_FALLTHROUGH_BLOCKED);
    expect(() => forbidLegacyCompanyTimekeeping(true, "clockIn")).toThrow(COMPANY_TIMEKEEPING_LEGACY_FALLTHROUGH_BLOCKED);
    expect(() => forbidLegacyCompanyTimeOff(false, "create")).not.toThrow();
  });

  it("does not convert a Company Time Off API failure into an empty local list", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: { message: "Home Service Connected operations are temporarily unavailable." } }),
    } as Response);
    try {
      await expect(getHomeServiceConnectedTimeOff("company-token")).rejects.toThrow(
        "Home Service Connected operations are temporarily unavailable.",
      );
    } finally {
      fetchMock.mockRestore();
    }
    expect(timeOffPanelSource).toContain("Company Time Off is unavailable");
    expect(companyCanonicalListState({ loading: false, error: "canonical unavailable", itemCount: 0 })).not.toBe("empty");
  });

  it("preserves M1 Jobs, Schedule, invoices, unpaid, chat, roster, and Price Book contracts", () => {
    expect(scheduleSource).toContain("getJobSyncCompanyJobs");
    expect(scheduleSource).toContain("resolveCompanyJobAuthority");
    expect(invoicesSource).toContain("getJobSyncCompanyInvoices");
    expect(unpaidSource).toContain("getJobSyncCompanyUnpaidJobs");
    expect(apiSource).toContain("/api/mobile/v1/company/jobs");
    expect(apiSource).toContain("/api/mobile/v1/company/chat/groups");
    expect(apiSource).toContain("/api/mobile/v1/company/team-members");
    expect(apiSource).toContain("/api/mobile/v1/price-book");
    expect(homeSource).toContain("allowLegacyTimekeeping");
    expect(sanitizeCompanyMutationBody({ status: "en_route" })).toEqual({ status: "en_route" });
  });
});
