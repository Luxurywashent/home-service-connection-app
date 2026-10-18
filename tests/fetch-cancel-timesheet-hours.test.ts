import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { reconcileClockAction } from "../lib/company-clock-reconcile";
import { publishCompanyClockNotice, subscribeCompanyClockNotice } from "../lib/company-clock-notice";
import { describeCompanyShift } from "../lib/company-shift-display";
import { companyReadFailure, companyWriteFailure } from "../lib/jobsync-company-authority";
import {
  COMPANY_TIME_REQUEST_TIMEOUT_MS,
  JobSyncRequestCanceledError,
  getHomeServiceConnectedTimeState,
  isRequestCancellation,
  sumHomeServiceConnectedTimesheetHours,
  type HomeServiceConnectedTimesheetRecord,
} from "../lib/jobsync-mobile-api";

const clockSource = readFileSync(new URL("../components/company-clock-status.tsx", import.meta.url), "utf8");
const navSource = readFileSync(new URL("../components/ui/top-nav-menu.tsx", import.meta.url), "utf8");
const timesheetSource = readFileSync(new URL("../components/company-timesheet-panel.tsx", import.meta.url), "utf8");
const paymentSource = readFileSync(new URL("../components/company-collect-payment.tsx", import.meta.url), "utf8");
const locationSource = readFileSync(new URL("../components/company-location-publisher.tsx", import.meta.url), "utf8");

const EXPO_CANCEL = "fetch failed: FetchRequestCanceledException: Fetch request has been canceled (at Expo/NativeResponse.swift:63)";
const CHICAGO = "America/Chicago";
const clockedIn = { isClockedIn: true, clockInAt: "2026-10-18T00:42:00.000Z", activeBreak: null };

function canceledError() {
  return new Error(EXPO_CANCEL);
}

describe("fetch cancellation", () => {
  it("recognizes Expo URLSession cancellation without treating every error as canceled", () => {
    expect(isRequestCancellation(canceledError())).toBe(true);
    expect(isRequestCancellation(new JobSyncRequestCanceledError())).toBe(true);
    expect(isRequestCancellation(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
    expect(isRequestCancellation(new Error("No connection to Home Service Connected. Check your network and try again."))).toBe(false);
    expect(isRequestCancellation(new Error("Home Service Connected took too long to respond. Check your connection and try again."))).toBe(false);
    expect(companyReadFailure(canceledError())).toBeNull();
    expect(companyReadFailure(new Error("Company timesheets are unavailable."))).toBe("Company timesheets are unavailable.");
    expect(companyWriteFailure(canceledError(), "Payment could not be recorded.")).toBe(
      "Home Service Connected did not confirm this change. Check the saved result before trying again.",
    );
    expect(companyWriteFailure(new Error("Payment could not be recorded."))).toBe("Payment could not be recorded.");
  });

  it("turns an Expo cancel caused by the client timeout into a connection timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(canceledError());
      });
    }));
    try {
      const pending = getHomeServiceConnectedTimeState("company-token");
      const assertion = expect(pending).rejects.toThrow("Home Service Connected took too long to respond. Check your connection and try again.");
      await vi.advanceTimersByTimeAsync(COMPANY_TIME_REQUEST_TIMEOUT_MS);
      await assertion;
    } finally {
      fetchMock.mockRestore();
      vi.useRealTimers();
    }
  });

  it("classifies a spontaneous Expo cancel as cancellation rather than a failed status read", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(canceledError());
    try {
      await expect(getHomeServiceConnectedTimeState("company-token")).rejects.toBeInstanceOf(JobSyncRequestCanceledError);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("keeps a caller-aborted status read from becoming a timeout", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(canceledError());
      });
    }));
    try {
      const controller = new AbortController();
      const pending = getHomeServiceConnectedTimeState("company-token", { signal: controller.signal });
      controller.abort();
      await expect(pending).rejects.toBeInstanceOf(JobSyncRequestCanceledError);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("reports a real network failure without the raw transport string", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Network request failed"));
    try {
      await expect(getHomeServiceConnectedTimeState("company-token")).rejects.toThrow(
        "No connection to Home Service Connected. Check your network and try again.",
      );
    } finally {
      fetchMock.mockRestore();
    }
  });

  it("does not treat a canceled clock read as a failed clock-in or clock-out", () => {
    const canceled = canceledError();
    expect(reconcileClockAction("clock-in", clockedIn, canceled).status).toBe("confirmed");
    expect(reconcileClockAction("clock-out", { ...clockedIn, isClockedIn: false, clockInAt: null }, canceled).status).toBe("confirmed");
    const unconfirmed = reconcileClockAction("clock-in", null, canceled);
    expect(unconfirmed.status).toBe("unknown");
    expect(unconfirmed.status === "unknown" ? unconfirmed.message : "").not.toContain("FetchRequestCanceledException");
    expect(unconfirmed.status === "unknown" ? unconfirmed.message : "").not.toContain("did not start");
    const stillOnShift = reconcileClockAction("clock-out", clockedIn, canceled);
    expect(stillOnShift.status).toBe("rejected");
    expect(stillOnShift.status === "rejected" ? stillOnShift.message : "").not.toContain("FetchRequestCanceledException");
  });

  it("keeps the header clock control free of the raw cancellation text", () => {
    expect(clockSource).toContain("isRequestCancellation");
    expect(clockSource).toContain("AppState");
    expect(clockSource).toContain("Clock In");
    expect(clockSource.match(/await action\(\)/g)).toHaveLength(1);
    expect(clockSource).not.toContain("FetchRequestCanceledException");
    expect(clockSource).not.toContain("maxWidth: 220");
    expect(locationSource).toContain("isRequestCancellation");
    expect(locationSource).toContain("AppState.currentState !== \"active\"");
    const clockIndex = navSource.indexOf("<HeaderClockStatus />");
    const menuIndex = navSource.indexOf("☰");
    const noticeIndex = navSource.indexOf("<CompanyClockNotice />");
    expect(clockIndex).toBeGreaterThan(-1);
    expect(menuIndex).toBeGreaterThan(clockIndex);
    expect(noticeIndex).toBeGreaterThan(menuIndex);
    expect(paymentSource).toContain("companyWriteFailure");
    const recordCalls = paymentSource.match(/recordJobSyncCompanyJobPayment\(/g) ?? [];
    expect(recordCalls).toHaveLength(1);
  });

  it("publishes one clock notice until the message changes", () => {
    const seen: Array<string | null> = [];
    const unsubscribe = subscribeCompanyClockNotice((value) => seen.push(value));
    publishCompanyClockNotice("No connection to Home Service Connected. Check your network and try again.");
    publishCompanyClockNotice("No connection to Home Service Connected. Check your network and try again.");
    publishCompanyClockNotice(null);
    unsubscribe();
    expect(seen.filter((value) => value !== null)).toEqual([
      "No connection to Home Service Connected. Check your network and try again.",
    ]);
  });
});

describe("timesheet shift hours", () => {
  it("shows a same-evening 7:42 PM to 9:57 PM shift as 2.25 hours", () => {
    const shift = describeCompanyShift({
      clockIn: "2026-10-18T00:42:00.000Z",
      clockOut: "2026-10-18T02:57:00.000Z",
      totalHours: 2.25,
      timeZone: CHICAGO,
    });
    expect(shift.elapsedHours).toBe(2.25);
    expect(shift.paidHoursFromTimestamps).toBe(2.25);
    expect(shift.spansCalendarDays).toBe(false);
    expect(shift.recordedHoursMatchTimestamps).toBe(true);
    expect(shift.clockInLabel).toBe("7:42 PM");
    expect(shift.clockOutLabel).toBe("9:57 PM");
  });

  it("shows both dates when 7:42 PM and 9:57 PM are 26.25 hours apart", () => {
    const shift = describeCompanyShift({
      clockIn: "2026-10-18T00:42:00.000Z",
      clockOut: "2026-10-19T02:57:00.000Z",
      totalHours: 26.25,
      timeZone: CHICAGO,
    });
    expect(shift.elapsedHours).toBe(26.25);
    expect(shift.paidHoursFromTimestamps).toBe(26.25);
    expect(shift.spansCalendarDays).toBe(true);
    expect(shift.recordedHoursMatchTimestamps).toBe(true);
    expect(shift.clockInLabel).toContain("Oct 17");
    expect(shift.clockInLabel).toContain("7:42 PM");
    expect(shift.clockOutLabel).toContain("Oct 18");
    expect(shift.clockOutLabel).toContain("9:57 PM");
    const records: HomeServiceConnectedTimesheetRecord[] = [{
      id: 1,
      memberUserId: 41,
      memberName: "Alex Tech",
      date: "2026-10-17",
      clockIn: "2026-10-18T00:42:00.000Z",
      clockOut: "2026-10-19T02:57:00.000Z",
      breakStart: null,
      breakEnd: null,
      totalHours: 26.25,
      approvalStatus: "pending",
      reviewedAt: null,
      reviewerNote: null,
    }];
    expect(sumHomeServiceConnectedTimesheetHours(records)).toBe(26.25);
  });

  it("flags a stored 26.25 hour total that does not match a 2.25 hour timestamp span", () => {
    const shift = describeCompanyShift({
      clockIn: "2026-10-18T00:42:00.000Z",
      clockOut: "2026-10-18T02:57:00.000Z",
      totalHours: 26.25,
      timeZone: CHICAGO,
    });
    expect(shift.paidHoursFromTimestamps).toBe(2.25);
    expect(shift.recordedHoursMatchTimestamps).toBe(false);
    expect(shift.spansCalendarDays).toBe(false);
  });

  it("subtracts a break before comparing recorded hours", () => {
    const shift = describeCompanyShift({
      clockIn: "2026-10-18T00:42:00.000Z",
      clockOut: "2026-10-18T02:57:00.000Z",
      breakStart: "2026-10-18T01:00:00.000Z",
      breakEnd: "2026-10-18T01:15:00.000Z",
      totalHours: 2,
      timeZone: CHICAGO,
    });
    expect(shift.elapsedHours).toBe(2.25);
    expect(shift.paidHoursFromTimestamps).toBe(2);
    expect(shift.recordedHoursMatchTimestamps).toBe(true);
  });

  it("keeps the timesheet screen on stored hours and ignores canceled reads", () => {
    expect(timesheetSource).toContain("describeCompanyShift");
    expect(timesheetSource).toContain("sumHomeServiceConnectedTimesheetHours");
    expect(timesheetSource).toContain("(record.totalHours ?? 0).toFixed(2)");
    expect(timesheetSource).toContain("The stored clock record was not changed.");
    expect(timesheetSource).toContain("companyReadFailure");
    expect(timesheetSource).not.toContain("formatClockTime");
  });
});
