import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(new URL("../app/(tabs)/admin-dashboard.tsx", import.meta.url), "utf8");
const home = readFileSync(new URL("../app/(tabs)/index.tsx", import.meta.url), "utf8");
const employees = readFileSync(new URL("../app/(tabs)/admin-employees.tsx", import.meta.url), "utf8");
const customerProfile = readFileSync(new URL("../components/company-customer-profile-panel.tsx", import.meta.url), "utf8");
const customers = readFileSync(new URL("../components/company-customers-panel.tsx", import.meta.url), "utf8");
const finance = readFileSync(new URL("../components/company-finance-panel.tsx", import.meta.url), "utf8");
const adminSchedule = readFileSync(new URL("../app/(tabs)/admin-schedule.tsx", import.meta.url), "utf8");
const schedule = readFileSync(new URL("../app/(tabs)/schedule.tsx", import.meta.url), "utf8");

describe("Company canonical cross-screen refresh", () => {
  it("publishes canonical customer and roster writes through the shared revision", () => {
    expect(customerProfile).toContain("invalidateCanonicalSurfaces");
    expect(customerProfile).toContain("invalidateCanonicalSurfaces();");
    expect(employees).toContain("invalidateCanonicalSurfaces");
    expect(employees).toContain("invalidateCanonicalSurfaces();");
  });

  it("makes every related mounted Company surface consume the shared revision", () => {
    expect(dashboard).toContain("useJobSyncSync");
    expect(dashboard).toContain("revision: companySyncRevision");
    expect(dashboard).toContain("companyOperationsRequest");
    expect(dashboard).toContain("companySyncRevision");
    expect(dashboard).toContain("companyRequestValue(companyOperationsRequest?.key ?? null, companySummaryResource)");
    expect(dashboard).toContain("companyRequestValue(companyOperationsRequest?.key ?? null, companyLocationsResource)");
    expect(dashboard).toContain("companyRequestValue(companyOperationsRequest?.sessionPeriodKey ?? null, lastCompanySummaryResource)");
    expect(dashboard).toContain("getJobSyncCompanyDashboardSummary(request.token, { period: request.period })");
    expect(dashboard).toContain("getJobSyncCompanyDispatchBoard(request.token, { date: request.today })");
    expect(dashboard).toContain("if (!message) return;");
    expect(employees).toContain("revision: companySyncRevision");
    expect(employees).toContain("companyRosterRequest");
    expect(employees).toContain("companyMemberDetailRequest");
    expect(employees).toContain("companyRequestValue");
    expect(customerProfile).toContain("customerRequest");
    expect(customers).toContain("[revision, token]");
    expect(finance).toContain("[revision, token]");
  });

  it("gates Company home and schedule writes after a request is cancelled or superseded", () => {
    expect(home).toContain("companyHoursResource");
    expect(home).toContain("companyRequestValue(companyHoursRequestKey, companyHoursResource)");
    expect(home).toContain("${jobSyncSession.token}:${view}:${weekRange.start}:${weekRange.end}:${weekRange.today}:${companySyncRevision}");
    expect(home).toContain("if (cancelled) return;");
    expect(home).toContain("if (!message) return;");
    expect(adminSchedule).toContain("let cancelled = false;");
    expect(adminSchedule).toContain("if (cancelled) return;");
  });

  it("uses Company-local week headers and today selection only after the matching session timezone loads", () => {
    for (const source of [adminSchedule, schedule]) {
      expect(source).toContain("companyCalendarDisplayWeekDates(offset, companyTimezone)");
      expect(source).toContain("companyCalendarTodayDayIndex(companyTimezone)");
      expect(source).toContain("companyTimezoneResource?.token === jobSyncSession?.token");
      expect(source).toContain("if (isJobSyncCompany && !companyTimezoneReady)");
      expect(source).toContain("lastCalendarSelectionKey !== calendarSelectionKey");
      expect(source).not.toContain('.catch(() => ({ timezone: "America/Chicago" }))');
    }
  });

  it("refreshes technician Company data when the canonical session or revision changes", () => {
    expect(schedule).toContain("[allowLegacyJobAuthority, authLoading, employee, isJobSyncCompany, jobSyncRevision, jobSyncSession?.token, selectedLocation]");
    expect(schedule).toContain("mapCanonicalJobToScheduleFields(canonical, fallbackLocation, companyTimezone)");
    expect(schedule).toContain("if (cancelled) return;");
  });
});
