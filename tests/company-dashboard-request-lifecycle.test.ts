import { describe, expect, it } from "vitest";

import {
  companyRequestLoading,
  companyRequestValue,
  type CompanyRequestResource,
} from "../lib/company-request-resource";

type Summary = { bookedRevenue: number; timezone: string };
type SummaryResponse = { summary: Summary | null; error: string | null };
type DispatchResponse = { locations: string[] | null; error: string | null };
type DashboardRequest = { key: string; sessionPeriodKey: string };

function displayedSummary(
  request: DashboardRequest,
  response: CompanyRequestResource<SummaryResponse> | null,
  lastSuccess: CompanyRequestResource<Summary> | null,
) {
  return companyRequestValue(request.key, response)?.summary
    ?? companyRequestValue(request.sessionPeriodKey, lastSuccess);
}

describe("Company dashboard request lifecycle", () => {
  it("never exposes an old account's summary or dispatch while a new account request is pending", () => {
    const accountA: DashboardRequest = {
      key: "token-a:day:2026-10-18:4:0",
      sessionPeriodKey: "token-a:day:2026-10-18",
    };
    const accountB: DashboardRequest = {
      key: "token-b:day:2026-10-18:4:0",
      sessionPeriodKey: "token-b:day:2026-10-18",
    };
    const accountASummary: CompanyRequestResource<SummaryResponse> = {
      requestKey: accountA.key,
      data: { summary: { bookedRevenue: 125, timezone: "America/Chicago" }, error: null },
    };
    const accountADispatch: CompanyRequestResource<DispatchResponse> = {
      requestKey: accountA.key,
      data: { locations: ["Alex"], error: null },
    };
    const accountALastSuccess: CompanyRequestResource<Summary> = {
      requestKey: accountA.sessionPeriodKey,
      data: { bookedRevenue: 125, timezone: "America/Chicago" },
    };

    expect(displayedSummary(accountB, accountASummary, accountALastSuccess)).toBeNull();
    expect(companyRequestValue(accountB.key, accountADispatch)).toBeNull();
    expect(companyRequestLoading(accountB.key, accountASummary)).toBe(true);
    expect(companyRequestLoading(accountB.key, accountADispatch)).toBe(true);
  });

  it("does not reuse a daily summary for a different period, but can show the last success after a same-period refresh failure", () => {
    const day: DashboardRequest = {
      key: "token-a:day:2026-10-18:4:0",
      sessionPeriodKey: "token-a:day:2026-10-18",
    };
    const week: DashboardRequest = {
      key: "token-a:week:2026-10-18:4:0",
      sessionPeriodKey: "token-a:week:2026-10-18",
    };
    const refreshedDay: DashboardRequest = {
      key: "token-a:day:2026-10-18:5:0",
      sessionPeriodKey: day.sessionPeriodKey,
    };
    const lastDaySuccess: CompanyRequestResource<Summary> = {
      requestKey: day.sessionPeriodKey,
      data: { bookedRevenue: 125, timezone: "America/Chicago" },
    };
    const refreshFailure: CompanyRequestResource<SummaryResponse> = {
      requestKey: refreshedDay.key,
      data: { summary: null, error: "Revenue summary unavailable" },
    };

    expect(displayedSummary(week, null, lastDaySuccess)).toBeNull();
    expect(displayedSummary(refreshedDay, refreshFailure, lastDaySuccess)).toEqual({
      bookedRevenue: 125,
      timezone: "America/Chicago",
    });
    expect(companyRequestLoading(refreshedDay.key, refreshFailure)).toBe(false);
  });

  it("distinguishes a confirmed empty dispatch board from a cancelled or unanswered request", () => {
    const request: DashboardRequest = {
      key: "token-a:day:2026-10-18:4:1",
      sessionPeriodKey: "token-a:day:2026-10-18",
    };
    const confirmedEmpty: CompanyRequestResource<DispatchResponse> = {
      requestKey: request.key,
      data: { locations: [], error: null },
    };
    const priorAttempt: CompanyRequestResource<DispatchResponse> = {
      requestKey: "token-a:day:2026-10-18:4:0",
      data: { locations: ["Alex"], error: null },
    };

    expect(companyRequestValue(request.key, confirmedEmpty)?.locations).toEqual([]);
    expect(companyRequestValue(request.key, priorAttempt)).toBeNull();
    expect(companyRequestLoading(request.key, priorAttempt)).toBe(true);
  });
});
