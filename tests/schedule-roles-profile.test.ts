import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminSchedule = readFileSync(new URL("../app/(tabs)/admin-schedule.tsx", import.meta.url), "utf8");
const schedule = readFileSync(new URL("../app/(tabs)/schedule.tsx", import.meta.url), "utf8");
const addJob = readFileSync(new URL("../components/add-job-modal.tsx", import.meta.url), "utf8");
const profile = readFileSync(new URL("../app/(tabs)/profile.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/(tabs)/_layout.tsx", import.meta.url), "utf8");

describe("schedule columns and profile editing", () => {
  it("filters every JobSync calendar and assignment list with the same fieldwork rule", () => {
    expect(adminSchedule).toContain("roster.members.filter(isCompanyScheduleColumnMember)");
    expect(adminSchedule).not.toContain("roster.members.map((member, index)");
    expect(schedule).toContain(".filter(isCompanyScheduleColumnMember)");
    expect(addJob).toContain(".filter(isCompanyScheduleColumnMember)");
  });

  it("offers Edit Profile for permitted personal fields and keeps email read-only", () => {
    expect(profile).toContain("Edit Profile");
    expect(profile).toContain("updateJobSyncOwnProfile");
    expect(profile).toContain("Email stays read-only");
    expect(profile).toContain("verified email update");
    expect(profile).toContain("phone: profilePhone");
    expect(profile).toContain("city: profileCity");
    expect(profile).not.toContain("email: profile");
    expect(profile).not.toContain("hireDate: profile");
    expect(profile).not.toContain("role: profile");
    expect(layout).toContain("employee.phoneNumber === nativeJobSyncEmployee.phoneNumber");
    expect(layout).toContain("employee.city === nativeJobSyncEmployee.city");
    expect(layout).toContain("employee.hireDate === nativeJobSyncEmployee.hireDate");
  });
});
