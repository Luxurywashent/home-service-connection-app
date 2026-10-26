import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readProjectSource(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

describe("Company calendar and customer navigation", () => {
  it("removes the legacy city-transfer control from the Company calendar job detail", () => {
    const adminSchedule = readProjectSource("app/(tabs)/admin-schedule.tsx");

    expect(adminSchedule).not.toContain("Move to City");
    expect(adminSchedule).not.toContain("showMoveCityPicker");
    expect(adminSchedule).not.toContain("movingToCity");
  });

  it("returns customer details to the existing customer list instead of replacing it", () => {
    const profile = readProjectSource("app/(tabs)/admin-customer-profile.tsx");
    const handleBack = profile.slice(
      profile.indexOf("const handleBack"),
      profile.indexOf("const handleTab"),
    );

    expect(handleBack).toContain("router.back();");
    expect(handleBack).not.toContain("router.replace");
  });

  it("never replays local schedule cache for a Company session", () => {
    const adminSchedule = readProjectSource("app/(tabs)/admin-schedule.tsx");
    const technicianSchedule = readProjectSource("app/(tabs)/schedule.tsx");

    expect(adminSchedule).toContain('sessionSource === "jobsync"');
    expect(adminSchedule).toContain("authoritative mobile endpoint");
    expect(adminSchedule).toContain("setJobs([]);");
    expect(technicianSchedule).toContain('sessionSource === "jobsync"');
    expect(technicianSchedule).toContain("Do not hydrate");
    expect(technicianSchedule).toContain("setJobs([]);");
  });

  it("uses only the authoritative Company API and configured Company timezone", () => {
    const mobileApi = readProjectSource("lib/jobsync-mobile-api.ts");
    const eas = readProjectSource("eas.json");

    expect(mobileApi).toContain('DEFAULT_JOBSYNC_BASE_URL = "https://www.homeserviceconnected.com"');
    expect(mobileApi).toContain('cache: "no-store"');
    expect(eas).toContain('"EXPO_PUBLIC_JOBSYNC_API_BASE_URL": "https://jobwash-veysiubh.manus.space"');
    expect(eas).toContain('"EXPO_PUBLIC_API_BASE_URL": "https://jobwash-veysiubh.manus.space"');
  });

  it("refreshes an open Company calendar from the authoritative API", () => {
    const adminSchedule = readProjectSource("app/(tabs)/admin-schedule.tsx");

    expect(adminSchedule).toContain("Keep the open Company calendar converged with dispatcher-side changes.");
    expect(adminSchedule).toContain("setInterval(() => {");
    expect(adminSchedule).toContain("}, 30 * 1000);");
    expect(adminSchedule).toContain("return () => clearInterval(refreshInterval);");
  });

  it("uses the bearer-scoped Company Jobs API for detail-panel reassignment", () => {
    const adminSchedule = readProjectSource("app/(tabs)/admin-schedule.tsx");
    const picker = adminSchedule.slice(
      adminSchedule.indexOf("Reassign to:"),
      adminSchedule.indexOf("</View>{/* end paddingHorizontal wrapper */}"),
    );

    expect(picker).toContain("assignedTo: d.employeeId");
    expect(picker).toContain("if (isJobSyncCompany)");
    expect(picker).toContain("saveCompanyCalendarChange(previous, next)");
    expect(picker.indexOf("saveCompanyCalendarChange(previous, next)")).toBeLessThan(picker.indexOf("jobReassignMutation.mutateAsync"));
  });
});
