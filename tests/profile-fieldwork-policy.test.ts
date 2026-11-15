import { describe, expect, it } from "vitest";
import type { JobSyncCompanyMember, JobSyncNativeSession } from "../lib/jobsync-mobile-api";
import {
  canEditCompanyMemberProfile, canUpdateCompanyMemberFieldwork, companyProfileSessionKey,
  getCompanyAdminFieldworkPolicy, getCompanySelfFieldworkStatus, isCompanyProfileManagementSession,
  isFreshCompanyProfileSession, verifyCompanyProfileSession, PROFILE_FIELDWORK_LABEL,
  PROFILE_FIELDWORK_OWNER_BLOCKED_DESCRIPTION, COMPANY_PROFILE_SESSION_MAX_AGE_MS,
} from "../lib/profile-fieldwork-policy";

function session(role: JobSyncNativeSession["user"]["role"] = "owner"): JobSyncNativeSession {
  return { token: "test-only-no-live-use", portal: "company",
    company: { id: 30001, name: "Fixture Company", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null },
    user: { id: 17, name: "Manager", email: null, role } };
}
function member(role = "owner"): JobSyncCompanyMember { return { id: 18, name: "Existing Member", role, isActive: true }; }
function live(value: unknown, present = true) {
  const result = session();
  if (present) Object.assign(result.user, { calendarEligible: value });
  return result;
}

describe("strict Company profile fieldwork policy", () => {
  it("uses exact product label and truthful owner-target blocker", () => {
    expect(PROFILE_FIELDWORK_LABEL).toBe("Available for Field Jobs");
    expect(PROFILE_FIELDWORK_OWNER_BLOCKED_DESCRIPTION).toContain("rejects every owner target");
    expect(PROFILE_FIELDWORK_OWNER_BLOCKED_DESCRIPTION).toContain("403");
  });
  it.each([
    ["owner", "owner", false], ["owner", "admin", false], ["owner", "dispatcher", true],
    ["owner", "technician", true], ["owner", "detailer", true],
    ["dispatcher", "owner", false], ["dispatcher", "dispatcher", false],
    ["dispatcher", "technician", true], ["dispatcher", "detailer", true],
    ["technician", "technician", false], ["developer", "technician", false],
  ] as const)("actor %s -> target %s: %s", (actorRole, targetRole, allowed) => {
    const actor = session(actorRole); const target = member(targetRole);
    expect(canEditCompanyMemberProfile(actor, target)).toBe(allowed);
    expect(canUpdateCompanyMemberFieldwork(actor, target, 30001)).toBe(allowed);
  });
  it("requires explicit tenant scope for capability writes, retaining legacy broad editor signature", () => {
    expect(canUpdateCompanyMemberFieldwork(session(), member("dispatcher"), undefined)).toBe(false);
    expect(canUpdateCompanyMemberFieldwork(session(), member("dispatcher"), null)).toBe(false);
    expect(canUpdateCompanyMemberFieldwork(session(), member("dispatcher"), 999)).toBe(false);
    expect(canUpdateCompanyMemberFieldwork(session(), { ...member("dispatcher"), companyId: 999 }, 30001)).toBe(false);
    expect(canEditCompanyMemberProfile(session(), member("technician"), 999)).toBe(false);
  });
  it("fails closed for missing/null/malformed actor and target without throwing", () => {
    const malformedActors: unknown[] = [null, undefined, {}, [], "owner", { ...session(), user: null },
      { ...session(), company: null }, { ...session(), token: " " }, { ...session(), portal: "platform" },
      { ...session(), user: { ...session().user, id: "17" } },
      { ...session(), company: { ...session().company, id: NaN } }];
    for (const actor of malformedActors) {
      expect(isCompanyProfileManagementSession(actor as JobSyncNativeSession)).toBe(false);
      expect(canEditCompanyMemberProfile(actor as JobSyncNativeSession, member("technician"))).toBe(false);
      expect(getCompanyAdminFieldworkPolicy(actor as JobSyncNativeSession, member()).visible).toBe(false);
    }
    for (const target of [null, undefined, {}, [], { ...member(), role: null }, { ...member(), role: 1 },
      { ...member("technician"), isActive: null }, { ...member("technician"), isActive: false },
      { ...member("technician"), id: "18" }, { ...member("technician"), id: Infinity }]) {
      expect(canEditCompanyMemberProfile(session(), target as JobSyncCompanyMember)).toBe(false);
      expect(getCompanyAdminFieldworkPolicy(session(), target as JobSyncCompanyMember).visible).toBe(false);
    }
  });
  it("shows dispatcher/owner unknown status without trusting broken roster/detail flags", () => {
    for (const role of ["owner", "admin", "dispatcher"]) {
      for (const calendarEligible of [undefined, null, false, true]) {
        const target = { ...member(role), calendarEligible, calendarEligibleOverride: true } as JobSyncCompanyMember;
        const policy = getCompanyAdminFieldworkPolicy(session(), target, 30001);
        expect(policy).toEqual({ visible: true, canEdit: role === "dispatcher", status: "unavailable", value: null, defaultValue: false });
      }
    }
    expect(getCompanyAdminFieldworkPolicy(session("dispatcher"), member("dispatcher"), 30001).canEdit).toBe(false);
    expect(getCompanyAdminFieldworkPolicy(session(), member("technician"), 30001).visible).toBe(false);
  });
  it.each([[true, "on", true], [false, "off", false], [null, "off", false],
    [undefined, "unknown", null], ["true", "unknown", null], [1, "unknown", null], [{}, "unknown", null]] as const)(
    "signed self raw %j produces %s rather than coercion", (value, status, expectedValue) => {
      const actor = session(); const verified = verifyCompanyProfileSession(actor, live(value), 100);
      expect(getCompanySelfFieldworkStatus(actor, verified, 101)).toMatchObject({ status, value: expectedValue });
    });
  it("missing differs from false and explicit null/default OFF", () => {
    const actor = session();
    const missing = getCompanySelfFieldworkStatus(actor, verifyCompanyProfileSession(actor, live(undefined, false), 100), 101);
    const off = getCompanySelfFieldworkStatus(actor, verifyCompanyProfileSession(actor, live(false), 100), 101);
    const inherited = getCompanySelfFieldworkStatus(actor, verifyCompanyProfileSession(actor, live(null), 100), 101);
    expect(missing.status).toBe("unknown"); expect(off.reason).toContain("FALSE"); expect(inherited.reason).toContain("NULL");
    expect(getCompanySelfFieldworkStatus(actor, null, 101).status).toBe("unknown");
  });
  it("rejects tenant, user, token, portal and live management-role changes", () => {
    const actor = session();
    for (const changed of [{ ...live(true), token: "rotated" }, { ...live(true), portal: "platform" },
      { ...live(true), company: { ...actor.company!, id: 999 } },
      { ...live(true), user: { ...actor.user, id: 999 } }, live(true), session("dispatcher"), session("technician")]) {
      if (changed.user.id === actor.user.id && changed.user.role === actor.user.role && changed.token === actor.token && changed.portal === "company" && changed.company?.id === actor.company?.id) continue;
      expect(verifyCompanyProfileSession(actor, changed as JobSyncNativeSession, 100)).toBeNull();
    }
    const verified = verifyCompanyProfileSession(actor, live(true), 100)!;
    expect(getCompanySelfFieldworkStatus({ ...actor, token: "rotated" }, verified, 101).status).toBe("unknown");
    expect(getCompanySelfFieldworkStatus({ ...actor, user: { ...actor.user, calendarEligible: false } } as JobSyncNativeSession, verified, 101).status).toBe("unknown");
    expect(isFreshCompanyProfileSession(actor, { ...verified, source: "cached-login" } as never, 101)).toBe(false);
  });
  it("requires recent non-future evidence and snapshots transport data", () => {
    const actor = session(); const response = live(true); const verified = verifyCompanyProfileSession(actor, response, 100)!;
    Object.assign(response.user, { calendarEligible: false });
    expect(getCompanySelfFieldworkStatus(actor, verified, 101).status).toBe("on");
    expect(getCompanySelfFieldworkStatus(actor, verified, 99).status).toBe("unknown");
    expect(getCompanySelfFieldworkStatus(actor, verified, 100 + COMPANY_PROFILE_SESSION_MAX_AGE_MS).status).toBe("unknown");
    expect(getCompanySelfFieldworkStatus(actor, verified, NaN).status).toBe("unknown");
    expect(companyProfileSessionKey({ ...actor, user: { ...actor.user, calendarEligible: true } } as JobSyncNativeSession)).not.toBe(companyProfileSessionKey(actor));
  });
  it("never changes roles or identities", () => {
    const actor = session(); const target = member("dispatcher"); const before = JSON.stringify({ actor, target });
    getCompanyAdminFieldworkPolicy(actor, target, 30001); canUpdateCompanyMemberFieldwork(actor, target, 30001);
    verifyCompanyProfileSession(actor, live(true), 100);
    expect(JSON.stringify({ actor, target })).toBe(before);
  });
});
