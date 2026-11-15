import { describe, expect, it } from "vitest";
import { composeCompanyFieldworkCalendarMembers } from "../lib/company-fieldwork-calendar";
import { verifyCompanyProfileSession, COMPANY_PROFILE_SESSION_MAX_AGE_MS } from "../lib/profile-fieldwork-policy";
import type { JobSyncCompanyMember, JobSyncCompanyRoster, JobSyncNativeSession } from "../lib/jobsync-mobile-api";

const session: JobSyncNativeSession = { token: "test-only-no-live-use", portal: "company",
  company: { id: 42, name: "Fixture", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null },
  user: { id: 17, name: "Exact Owner", email: null, role: "owner" } };
const members: JobSyncCompanyMember[] = [
  { id: 17, name: "Exact Owner", role: "owner", isActive: true, calendarEligible: false },
  { id: 18, name: "Other Owner", role: "owner", isActive: true, calendarEligible: true },
  { id: 19, name: "Dispatcher", role: "dispatcher", isActive: true, calendarEligible: true },
  { id: 20, name: "Technician", role: "technician", isActive: true, calendarEligible: true },
  { id: 21, name: "Legacy Technician", role: "detailer", isActive: true, calendarEligible: true },
  { id: 22, name: "Tech OFF", role: "technician", isActive: true, calendarEligible: false },
  { id: 23, name: "Tech Missing", role: "technician", isActive: true },
  { id: 24, name: "Inactive", role: "technician", isActive: false, calendarEligible: true },
];
const roster: JobSyncCompanyRoster = { company: { id: 42, name: "Fixture" }, members };
function verified(value: unknown) { return verifyCompanyProfileSession(session,
  { ...session, user: { ...session.user, calendarEligible: value } } as JobSyncNativeSession, 100); }
const compose = (value: unknown, rows = roster, now = 101) => composeCompanyFieldworkCalendarMembers({ session, roster: rows, verifiedSelf: verified(value), now });

describe("limited exact-self owner calendar composition", () => {
  it("includes only raw opted-in exact self owner plus ordinary eligible technicians, preserving numeric identity", () => {
    const result = compose(true);
    expect(result.map((lane) => lane.id)).toEqual([17, 20, 21]);
    expect(result.map((lane) => lane.employeeId)).toEqual(["jobsync-17", "jobsync-20", "jobsync-21"]);
    expect(result[0].fieldworkSource).toBe("signed-self-owner");
    expect(result[0].role).toBe("owner");
    expect(result[1].fieldworkSource).toBe("roster-technician");
  });
  it.each([false, null, undefined, "true", 1, {}])("denies owner opt-in for %j without trusting its position-only roster", (value) => {
    const rows = { ...roster, members: [{ ...members[0], calendarEligible: true }, ...members.slice(1)] };
    expect(compose(value, rows).map((lane) => lane.id)).toEqual([20, 21]);
  });
  it("requires fresh signed-session provenance; cached login, missing, expired/future evidence all deny owner", () => {
    for (const verifiedSelf of [null, undefined, { ...verified(true)!, source: "cached-login" } as never]) {
      expect(composeCompanyFieldworkCalendarMembers({ session, roster, verifiedSelf, now: 101 }).map((lane) => lane.id)).toEqual([20, 21]);
    }
    expect(compose(true, roster, 100 + COMPANY_PROFILE_SESSION_MAX_AGE_MS).map((lane) => lane.id)).toEqual([20, 21]);
    expect(compose(true, roster, 99).map((lane) => lane.id)).toEqual([20, 21]);
  });
  it("requires known active exact owner row and does not use aliases/position title as owner proof", () => {
    for (const first of [{ ...members[0], isActive: false }, { ...members[0], role: "technician", calendarEligible: true },
      { ...members[0], role: "admin" }, { ...members[0], role: "Owner" }, { ...members[0], id: 99 },
      { ...members[0], name: "" }]) {
      expect(compose(true, { ...roster, members: [first, ...members.slice(1)] }).map((lane) => lane.id)).toEqual([20, 21]);
    }
    expect(compose(true, { ...roster, members: members.slice(1) }).map((lane) => lane.id)).toEqual([20, 21]);
  });
  it("does not create duplicate owner or technician ids or accept malformed ids/roles", () => {
    const rows = { ...roster, members: [...members, members[3], { ...members[3], id: 0 },
      { ...members[3], id: "70" } as never, { ...members[3], id: 70, role: null } as never] };
    expect(compose(true, rows).map((lane) => lane.id)).toEqual([17, 20, 21]);
    const ambiguousOwner = { ...roster, members: [...members, members[0]] };
    expect(compose(true, ambiguousOwner).map((lane) => lane.id)).toEqual([20, 21]);
  });
  it("invalidates owner provenance after tenant/user/token/role/opt-in changes", () => {
    const evidence = verified(true);
    for (const current of [{ ...session, token: "rotated" }, { ...session, user: { ...session.user, id: 18 } },
      { ...session, user: { ...session.user, role: "dispatcher" } } as JobSyncNativeSession,
      { ...session, user: { ...session.user, calendarEligible: false } } as JobSyncNativeSession]) {
      expect(composeCompanyFieldworkCalendarMembers({ session: current, roster, verifiedSelf: evidence, now: 101 }).map((lane) => lane.id)).toEqual([20, 21]);
    }
    const newTenant = { ...session, company: { ...session.company!, id: 99 } };
    expect(composeCompanyFieldworkCalendarMembers({ session: newTenant, roster, verifiedSelf: evidence, now: 101 })).toEqual([]);
    expect(composeCompanyFieldworkCalendarMembers({ session: newTenant, roster: { ...roster, company: { ...roster.company, id: 99 } }, verifiedSelf: evidence, now: 101 }).map((lane) => lane.id)).toEqual([20, 21]);
  });
  it("grants only exact-self dispatcher candidate from signed true without claiming position/booking parity", () => {
    const dispatcher = { ...session, user: { ...session.user, id: 19, role: "dispatcher" } } as JobSyncNativeSession;
    const evidence = verifyCompanyProfileSession(dispatcher, { ...dispatcher, user: { ...dispatcher.user, calendarEligible: true } } as JobSyncNativeSession, 100);
    const result = composeCompanyFieldworkCalendarMembers({ session: dispatcher, roster, verifiedSelf: evidence, now: 101 });
    expect(result.map((lane) => lane.id)).toEqual([19, 20, 21]);
    expect(result[0]).toMatchObject({ employeeId: "jobsync-19", role: "dispatcher", fieldworkSource: "signed-self-dispatcher" });
    for (const value of [false, null, undefined]) {
      const verifiedSelf = verifyCompanyProfileSession(dispatcher, { ...dispatcher, user: { ...dispatcher.user, calendarEligible: value } }, 100);
      expect(composeCompanyFieldworkCalendarMembers({ session: dispatcher, roster, verifiedSelf, now: 101 }).map((lane) => lane.id)).toEqual([20, 21]);
    }
    for (const self of [{ ...members[2], isActive: false }, { ...members[2], role: "technician" }, { ...members[2], role: "admin" }]) {
      const rows = { ...roster, members: [self, members[3], members[4]] };
      expect(composeCompanyFieldworkCalendarMembers({ session: dispatcher, roster: rows, verifiedSelf: evidence, now: 101 }).map((lane) => lane.id)).toEqual([20, 21]);
    }
    expect(composeCompanyFieldworkCalendarMembers({ session: dispatcher, roster, verifiedSelf: evidence, now: 60_100 }).map((lane) => lane.id)).toEqual([20, 21]);
  });
  it("does not mutate roster/session or silently reassign existing Jobs when opt-in turns OFF", () => {
    const assignedJob = { id: 1, assignedUserId: 17, assignedTo: "jobsync-17" };
    const before = JSON.stringify({ session, roster, assignedJob });
    compose(true); compose(false);
    expect(JSON.stringify({ session, roster, assignedJob })).toBe(before);
    expect(assignedJob.assignedUserId).toBe(17);
  });
  it("fails closed for missing/unsigned/malformed Company contexts", () => {
    for (const current of [null, undefined, { ...session, token: " " }, { ...session, user: null },
      { ...session, company: null }, { ...session, portal: "platform" }]) {
      expect(composeCompanyFieldworkCalendarMembers({ session: current as JobSyncNativeSession, roster, verifiedSelf: verified(true), now: 101 })).toEqual([]);
    }
  });
});
