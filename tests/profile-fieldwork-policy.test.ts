import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { JobSyncCompanyMember, JobSyncNativeSession } from "../lib/jobsync-mobile-api";
import {
  canEditCompanyMemberProfile,
  getCompanyAdminFieldworkPolicy,
  isCompanyProfileManagementSession,
  PROFILE_FIELDWORK_LABEL,
  PROFILE_FIELDWORK_DESCRIPTION,
  PROFILE_FIELDWORK_PENDING_DESCRIPTION,
} from "../lib/profile-fieldwork-policy";

function session(role: JobSyncNativeSession["user"]["role"] = "owner"): JobSyncNativeSession {
  return {
    token: "unit-test-token-no-live-use",
    portal: "company",
    company: { id: 30001, name: "Unit Test Company", slug: "unit-test", logoUrl: null, primaryColor: null, accentColor: null },
    user: { id: 17, name: "Company Manager", email: null, role },
  };
}

function member(role = "owner"): JobSyncCompanyMember {
  return { id: 18, name: "Existing Member", role, isActive: true };
}

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("Company Admin profile fieldwork policy — backend pending", () => {
  it("uses the requested copy and distinguishes product default OFF from current unknown state", () => {
    expect(PROFILE_FIELDWORK_LABEL).toBe("Available for Field Jobs");
    expect(PROFILE_FIELDWORK_DESCRIPTION).toBe("Allow this Team Member to receive scheduled Jobs while keeping their Admin permissions.");
    expect(PROFILE_FIELDWORK_PENDING_DESCRIPTION).toContain("Admin defaults to OFF");
    expect(PROFILE_FIELDWORK_PENDING_DESCRIPTION).toContain("keeps the Admin role");
    expect(PROFILE_FIELDWORK_PENDING_DESCRIPTION).toContain("Backend connection pending");
    expect(getCompanyAdminFieldworkPolicy(session(), member())).toEqual({
      visible: true, canEdit: false, status: "unavailable", value: null, defaultValue: false,
    });
  });

  it.each(["owner", "dispatcher"] as const)("allows only a Company management viewer (%s) to see the read-only owner capability", (role) => {
    expect(isCompanyProfileManagementSession(session(role))).toBe(true);
    expect(getCompanyAdminFieldworkPolicy(session(role), member()).visible).toBe(true);
    expect(getCompanyAdminFieldworkPolicy(session(role), member()).canEdit).toBe(false);
  });

  it("fails closed for technician, platform, unauthenticated, missing Company and invalid identities", () => {
    const unsigned = session();
    unsigned.token = "  ";
    const platform = session();
    platform.portal = "platform";
    const noCompany = session();
    delete noCompany.company;
    const invalidCompany = session();
    invalidCompany.company!.id = 0;
    const invalidUser = session();
    invalidUser.user.id = 0;
    for (const actor of [null, undefined, session("technician"), session("developer"), unsigned, platform, noCompany, invalidCompany, invalidUser]) {
      expect(isCompanyProfileManagementSession(actor)).toBe(false);
      expect(getCompanyAdminFieldworkPolicy(actor, member()).visible).toBe(false);
      expect(getCompanyAdminFieldworkPolicy(actor, member()).canEdit).toBe(false);
      expect(canEditCompanyMemberProfile(actor, member("technician"))).toBe(false);
    }
  });

  it("does not expose a fieldwork control for technicians, dispatchers, legacy fieldworkers or absent/inactive targets", () => {
    for (const target of [null, undefined, member("technician"), member("detailer"), member("dispatcher"), { ...member(), isActive: false }, { ...member(), id: 0 }]) {
      const policy = getCompanyAdminFieldworkPolicy(session(), target);
      expect(policy.visible).toBe(false);
      expect(policy.canEdit).toBe(false);
      expect(policy.value).toBeNull();
    }
  });

  it("does not infer OFF or ON from unreliable roster flags, attempted override values, workdays or availability", () => {
    for (const calendarEligible of [undefined, false, true]) {
      for (const calendarEligibleOverride of [undefined, null, false, true]) {
        const target = { ...member(), calendarEligible, calendarEligibleOverride, availability: "available", workDays: ["mon"] };
        const policy = getCompanyAdminFieldworkPolicy(session(), target);
        expect(policy.visible).toBe(true);
        expect(policy.status).toBe("unavailable");
        expect(policy.value).toBeNull();
        expect(policy.canEdit).toBe(false);
      }
    }
  });

  it("preserves role, identity and Company session without mutating either", () => {
    const actor = session();
    const target = member();
    const before = JSON.stringify({ actor, target });
    getCompanyAdminFieldworkPolicy(actor, target);
    canEditCompanyMemberProfile(actor, target);
    expect(JSON.stringify({ actor, target })).toBe(before);
    expect(actor.user.role).toBe("owner");
    expect(target.role).toBe("owner");
    expect(target.id).toBe(18);
  });

  it("does not offer the known-rejected owner PATCH, while retaining management editing for supported non-owner profiles", () => {
    for (const actor of [session("owner"), session("dispatcher")]) {
      expect(canEditCompanyMemberProfile(actor, member())).toBe(false);
      expect(canEditCompanyMemberProfile(actor, member("admin"))).toBe(false);
      expect(canEditCompanyMemberProfile(actor, member("technician"))).toBe(true);
      expect(canEditCompanyMemberProfile(actor, member("dispatcher"))).toBe(true);
      expect(canEditCompanyMemberProfile(actor, { ...member("technician"), isActive: false })).toBe(false);
      expect(canEditCompanyMemberProfile(actor, member("unknown-role"))).toBe(false);
      expect(canEditCompanyMemberProfile(actor, undefined)).toBe(false);
    }
  });

  it("places the read-only notice only at the existing Company role/work-day profile area", () => {
    const management = source("app/(tabs)/admin-employees.tsx");
    expect(management).toContain('companyMembers.find((member) => member.id === selectedEmp.jobSyncMemberId)');
    expect(management).toContain("getCompanyAdminFieldworkPolicy(jobSyncSession, selectedCompanyMember)");
    expect(management).toContain("canEditCompanyMemberProfile(jobSyncSession, selectedCompanyMember)");
    expect(management).toContain('!editMode && canEditSelectedProfile');
    expect(management).toContain('if (!selectedEmp || !canEditSelectedProfile) return;');
    expect(management).toMatch(/const handleSaveEdit = async \(\) => \{\s+if \(!canEditSelectedProfile\)/);
    expect(management).toContain('disabled={editSaving || !canEditSelectedProfile}');
    const beforeWorkDays = management.indexOf("{/* Custom Work Days");
    const editNotice = management.indexOf("{fieldworkPolicy.visible && <CompanyAdminFieldworkNotice");
    const roleSelector = management.lastIndexOf(">Role</Text>", beforeWorkDays);
    expect(editNotice).toBeGreaterThan(roleSelector);
    expect(editNotice).toBeLessThan(beforeWorkDays);
    expect(management).toMatch(/<InfoRow label="Availability"[^\n]*\n\s+\{fieldworkPolicy.visible && <CompanyAdminFieldworkNotice[^\n]*\n\s+<InfoRow label="Work Days"/);
    expect(source("app/(tabs)/profile.tsx")).not.toContain("CompanyAdminFieldworkNotice");
  });

  it("contains no interactive fieldwork mutation, local persistence, new endpoint or optimistic value", () => {
    const management = source("app/(tabs)/admin-employees.tsx");
    const notice = management.slice(management.indexOf("function CompanyAdminFieldworkNotice"), management.indexOf("function AddTeamMemberModal"));
    expect(notice).toContain('accessibilityState={{ disabled: true }}');
    expect(notice).toContain("Unavailable · read-only");
    expect(notice).toContain("PROFILE_FIELDWORK_LABEL");
    expect(notice).toContain("PROFILE_FIELDWORK_DESCRIPTION");
    expect(notice).toContain("PROFILE_FIELDWORK_PENDING_DESCRIPTION");
    for (const forbidden of ["Switch", "TouchableOpacity", "onPress", "onValueChange", "setEditData", "mutate", "fetch(", "AsyncStorage", "localStorage", "calendarEligibleOverride"]) {
      expect(notice).not.toContain(forbidden);
    }
    const helper = source("lib/profile-fieldwork-policy.ts");
    expect(helper).not.toMatch(/(?:fetch\(|AsyncStorage|localStorage|\/api\/|mutateAsync)/);
    const save = management.slice(management.indexOf("const handleSaveEdit"), management.indexOf("const roles:", management.indexOf("const handleSaveEdit")));
    expect(save).not.toContain("calendarEligibleOverride");
    expect(save).not.toContain("availableForFieldJobs");
    expect(save).not.toContain("fieldwork");
  });
});
