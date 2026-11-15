import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getCompanyTeamMemberDisplayId } from "../lib/company-team-member-display-id";
import { getNativeEmployeeSession, type JobSyncCompanySession } from "../lib/jobsync-role-map";

function session(name = "lawn sharks", memberId?: string): JobSyncCompanySession {
  return {
    portal: "company",
    company: { id: 30001, name },
    user: { id: 3720741, name: "Test Team Member", email: null, role: "technician", memberId },
  };
}

describe("Company-prefixed Team Member display ID", () => {
  it("shows the company name prefix instead of the internal mobile session ID", () => {
    expect(getCompanyTeamMemberDisplayId(session())).toBe("LAWN-SHARKS-3720741");
  });

  it("uses the backend Team Member code when supplied", () => {
    expect(getCompanyTeamMemberDisplayId(session("lawn sharks", " TM007 "))).toBe("LAWN-SHARKS-TM007");
  });

  it("does not duplicate an already company-prefixed backend code", () => {
    expect(getCompanyTeamMemberDisplayId(session("lawn sharks", "LAWN-SHARKS-007"))).toBe("LAWN-SHARKS-007");
    expect(getCompanyTeamMemberDisplayId(session("lawn sharks", "lawn-sharks-007"))).toBe("lawn-sharks-007");
  });

  it("normalizes spaces, accents and punctuation without hardcoding a company", () => {
    expect(getCompanyTeamMemberDisplayId(session("  José's   Home & Lawn  "))).toBe("JOSE-S-HOME-LAWN-3720741");
    expect(getCompanyTeamMemberDisplayId(session("庭園サービス"))).toBe("庭園サービス-3720741");
  });

  it("falls back to the numeric Company prefix when no usable company name exists", () => {
    for (const name of ["", "  ", "!!!", "Company workspace"]) {
      expect(getCompanyTeamMemberDisplayId(session(name))).toBe("COMPANY-30001-3720741");
    }
  });

  it("never exposes a backend value that contains the internal bridge prefix", () => {
    expect(getCompanyTeamMemberDisplayId(session("lawn sharks", "jobsync-30001-3720741"))).toBe("LAWN-SHARKS-3720741");
    expect(getCompanyTeamMemberDisplayId(session("lawn sharks", ""))).toBe("LAWN-SHARKS-3720741");
  });

  it("uses only the current authenticated Company and account", () => {
    const first = session();
    const second = session("River Services", "TM009");
    second.company!.id = 90001;
    second.user.id = 18;
    expect(getCompanyTeamMemberDisplayId(first)).toBe("LAWN-SHARKS-3720741");
    expect(getCompanyTeamMemberDisplayId(second)).toBe("RIVER-SERVICES-TM009");
    expect(getCompanyTeamMemberDisplayId(first)).toBe("LAWN-SHARKS-3720741");
    first.company!.name = "Lawn Sharks Services";
    expect(getCompanyTeamMemberDisplayId(first)).toBe("LAWN-SHARKS-SERVICES-3720741");
  });

  it("does not invent Company identities for platform, missing, or invalid sessions", () => {
    expect(getCompanyTeamMemberDisplayId(null)).toBeNull();
    expect(getCompanyTeamMemberDisplayId(undefined)).toBeNull();
    expect(getCompanyTeamMemberDisplayId({ ...session(), portal: "platform" })).toBeNull();
    expect(getCompanyTeamMemberDisplayId({ ...session(), company: undefined })).toBeNull();
    const invalid = session();
    invalid.user.id = 0;
    expect(getCompanyTeamMemberDisplayId(invalid)).toBeNull();
  });

  it("leaves the backend identifiers and login/timesheet bridge unchanged", () => {
    const current = session("lawn sharks", "TM007");
    const before = JSON.stringify(current);
    const nativeBefore = getNativeEmployeeSession(current);
    getCompanyTeamMemberDisplayId(current);
    expect(JSON.stringify(current)).toBe(before);
    expect(getNativeEmployeeSession(current)).toEqual(nativeBefore);
    expect(nativeBefore?.employeeId).toBe("jobsync-30001-3720741");
    expect(nativeBefore?.jobSyncMemberId).toBe("TM007");
  });

  it("removes the shared Settings ID row without replacing action identifiers", () => {
    const source = readFileSync(new URL("../app/(tabs)/profile.tsx", import.meta.url), "utf8");
    expect(source).not.toContain('label="Team Member ID"');
    expect(source).not.toContain("teamMemberDisplayId");
    expect(source).not.toContain("getCompanyTeamMemberDisplayId");
    expect(source).toContain('{ employeeId: employee?.employeeId ?? "" }');
    expect(source).toContain('await resetPinMutation.mutateAsync({ employeeId: employee?.employeeId ?? "", newPin });');
    expect(source).toContain("const token = jobSyncSession?.token;");
    expect(source).toContain("await deleteJobSyncMobileAccount(token)");
    expect(source).toContain("await Promise.all([logoutJobSync(), logout()]);");
  });

  it.each(["owner", "dispatcher", "technician"])("preserves authenticated Company identifiers for %s", (role) => {
    const current = session("lawn sharks", "TM007");
    current.user.role = role;
    const before = JSON.stringify(current);
    const nativeBefore = getNativeEmployeeSession(current);
    expect(getCompanyTeamMemberDisplayId(current)).toBe("LAWN-SHARKS-TM007");
    expect(JSON.stringify(current)).toBe(before);
    expect(getNativeEmployeeSession(current)).toEqual(nativeBefore);
    expect(nativeBefore?.employeeId).toBe("jobsync-30001-3720741");
    expect(nativeBefore?.companyId).toBe(30001);
    expect(nativeBefore?.jobSyncMemberId).toBe("TM007");
  });

  it("preserves management member references and the Add Team Member identity workflow", () => {
    const source = readFileSync(new URL("../app/(tabs)/admin-employees.tsx", import.meta.url), "utf8");
    expect(source).toContain('employeeId: `jobsync-${member.id}`');
    expect(source).toContain("jobSyncMemberId: member.id");
    expect(source).toContain('employeeId: memberId.trim().toUpperCase()');
    expect(source).toContain('setError("Team Member ID is required")');
    expect(source).toContain('<FormField label="Team Member ID" value={memberId}');
    expect(source).toContain('<InfoRow label="Team Member ID"');
  });
});
