import { afterEach, describe, expect, it, vi } from "vitest";
import type { JobSyncNativeSession } from "../lib/jobsync-mobile-api";
import { refreshCompanyProfileSession, updateCompanyMemberFieldwork, validateCompanyFieldworkUpdateAcknowledgment } from "../lib/profile-fieldwork-update";
import { getCompanySelfFieldworkStatus } from "../lib/profile-fieldwork-policy";

const session: JobSyncNativeSession = { token: "fixture-bearer-no-live-use", portal: "company",
  company: { id: 42, name: "Fixture", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null },
  user: { id: 17, name: "Owner", email: null, role: "owner" } };
const target = { id: 19, name: "Dispatcher", role: "dispatcher", isActive: true };
const response = (value: unknown = true) => ({ ...session, user: { ...session.user, calendarEligible: value } }) as JobSyncNativeSession;
const wireSession = (value?: unknown, present = true) => ({ accountType: "company",
  company: session.company, user: { ...session.user, ...(present ? { calendarEligible: value } : {}) } });
const fetchResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const acknowledgment = (value = true) => ({ member: { id: 19, role: "dispatcher", isActive: true, calendarEligible: value } });
function setup() {
  const readSession = vi.fn().mockResolvedValue(response());
  const update = vi.fn().mockResolvedValue(acknowledgment());
  const refresh = vi.fn().mockResolvedValue(undefined);
  return { readSession, update, refresh, input: { session, target, targetCompanyId: 42, value: true,
    isCurrent: () => true, refresh, api: { readSession, update } } };
}
afterEach(() => vi.unstubAllGlobals());

describe("signed self-session status requests", () => {
  it("uses only existing GET auth/session with bearer and no-store; never a cached context", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fetchResponse(wireSession(true)));
    vi.stubGlobal("fetch", fetchMock);
    const verified = await refreshCompanyProfileSession({ session, isCurrent: () => true, now: () => 100 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/mobile\/v1\/auth\/session$/);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "GET", cache: "no-store", headers: { Authorization: `Bearer ${session.token}` } });
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
    expect(getCompanySelfFieldworkStatus(session, verified, 101).status).toBe("on");
  });
  it.each([[false, true, "off"], [null, true, "off"], [undefined, false, "unknown"]] as const)(
    "wire value %j present %s becomes %s", async (value, present, status) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fetchResponse(wireSession(value, present))));
      const verified = await refreshCompanyProfileSession({ session, isCurrent: () => true, now: () => 100 });
      expect(getCompanySelfFieldworkStatus(session, verified, 101).status).toBe(status);
    });
  it("refuses malformed signed capability values without returning any ON evidence", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fetchResponse(wireSession("true"))));
    await expect(refreshCompanyProfileSession({ session, isCurrent: () => true, now: () => 100 })).rejects.toThrow("unsupported mobile session");
    expect(getCompanySelfFieldworkStatus(session, null, 101).status).toBe("unknown");
  });
  it("refuses an invalid/unsigned session before transport", async () => {
    const readSession = vi.fn();
    for (const invalid of [{ ...session, token: " " }, { ...session, company: undefined },
      { ...session, user: { ...session.user, role: "technician" } }]) {
      await expect(refreshCompanyProfileSession({ session: invalid as JobSyncNativeSession, isCurrent: () => true, readSession })).rejects.toThrow("management session");
    }
    expect(readSession).not.toHaveBeenCalled();
  });
  it.each([401, 403, 503])("does not promote stale context TRUE after HTTP %s refusal", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fetchResponse({ error: { message: "Refused" } }, status)));
    await expect(refreshCompanyProfileSession({ session: response(true), isCurrent: () => true })).rejects.toThrow("Refused");
  });
  it("discards a late signed response after tenant/identity switch", async () => {
    let current = true;
    let resolve!: (value: JobSyncNativeSession) => void;
    const readSession = vi.fn(() => new Promise<JobSyncNativeSession>((done) => { resolve = done; }));
    const pending = refreshCompanyProfileSession({ session, isCurrent: () => current, readSession });
    current = false; resolve(response(true));
    await expect(pending).rejects.toThrow("identity changed");
  });
  it("snapshots the signed request and rejects caller identity mutation while awaiting it", async () => {
    const current = { ...session, company: { ...session.company! }, user: { ...session.user } };
    let resolve!: (value: JobSyncNativeSession) => void;
    const pending = refreshCompanyProfileSession({ session: current, isCurrent: () => true,
      readSession: () => new Promise<JobSyncNativeSession>((done) => { resolve = done; }) });
    current.company.id = 99;
    resolve({ ...current, user: { ...current.user, calendarEligible: true } });
    await expect(pending).rejects.toThrow("identity changed");
  });
  it("rejects mismatched live token/company/user/manager role before using response capability", async () => {
    for (const live of [{ ...response(), token: "rotated" }, { ...response(), company: { ...session.company!, id: 99 } },
      { ...response(), user: { ...session.user, id: 99 } }, { ...response(), user: { ...session.user, role: "technician" } },
      { ...response(), user: { ...session.user, role: "dispatcher" } }]) {
      await expect(refreshCompanyProfileSession({ session, isCurrent: () => true,
        readSession: vi.fn().mockResolvedValue(live) })).rejects.toThrow("live management role");
    }
  });
});

describe("capability-only Team Member updates", () => {
  it.each([true, false])("sends exactly override %s with no role, name, position, credentials or null", async (value) => {
    const { input, update, readSession, refresh } = setup();
    update.mockResolvedValue(acknowledgment(value));
    const result = await updateCompanyMemberFieldwork({ ...input, value });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(session.token, target.id, { calendarEligibleOverride: value });
    expect(result).toMatchObject({ id: target.id, role: "dispatcher", calendarEligibleOverride: value });
    expect(result.message).toContain("remain unverified");
    expect(readSession).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(session.user.role).toBe("owner"); expect(target.role).toBe("dispatcher");
  });
  it("uses the existing API PATCH adapter with a capability-only body", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fetchResponse(wireSession(null)))
      .mockResolvedValueOnce(fetchResponse(acknowledgment(false)))
      .mockResolvedValueOnce(fetchResponse(wireSession(null)));
    vi.stubGlobal("fetch", fetchMock);
    await updateCompanyMemberFieldwork({ session, target, targetCompanyId: 42, value: false,
      isCurrent: () => true, refresh: async () => {} });
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/api\/mobile\/v1\/company\/team-members\/19$/);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "PATCH", cache: "no-store",
      headers: { Authorization: `Bearer ${session.token}` }, body: '{"calendarEligibleOverride":false}' });
  });
  it("rejects owner targets, dispatcher->dispatcher, inactive/cross-tenant targets and null value before requests", async () => {
    const { input, update, readSession } = setup();
    for (const invalid of [{ target: { ...target, role: "owner" } }, { session: { ...session, user: { ...session.user, role: "dispatcher" } } },
      { target: { ...target, isActive: false } }, { targetCompanyId: 99 }, { value: null }]) {
      await expect(updateCompanyMemberFieldwork({ ...input, ...invalid } as never)).rejects.toThrow("does not permit");
    }
    expect(readSession).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
  });
  it("denies a live-role demotion without sending a PATCH", async () => {
    const { input, update, readSession } = setup();
    readSession.mockResolvedValue({ ...response(), user: { ...session.user, role: "dispatcher" } });
    await expect(updateCompanyMemberFieldwork(input)).rejects.toThrow("live management role");
    expect(update).not.toHaveBeenCalled();
  });
  it("requires exact acknowledgment id/role/override and never coerces missing/null/string values", () => {
    for (const member of [{ id: 99, role: "dispatcher", calendarEligible: true },
      { id: 19, role: "technician", calendarEligible: true },
      { id: "19", role: "dispatcher", calendarEligible: true },
      ...[undefined, null, false, "true", 1].map((calendarEligible) => ({ id: 19, role: "dispatcher", calendarEligible })),
      { id: 19, role: "dispatcher", calendarEligibleOverride: false, calendarEligible: true },
      { id: 19, role: "dispatcher", calendarEligible: true, isActive: false }]) {
      expect(validateCompanyFieldworkUpdateAcknowledgment({ member }, target, true)).toBeNull();
    }
    expect(validateCompanyFieldworkUpdateAcknowledgment({ member: { id: 19, role: "dispatcher", calendarEligibleOverride: true } }, target, true)).not.toBeNull();
  });
  it.each(["denial", "offline", "ambiguous"])("refreshes after %s without claiming success", async (failure) => {
    const { input, update, refresh } = setup();
    if (failure === "ambiguous") update.mockResolvedValue({ member: { id: 19, role: "dispatcher", calendarEligible: null } });
    else update.mockRejectedValue(new Error(failure));
    await expect(updateCompanyMemberFieldwork(input)).rejects.toThrow();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("requires successful reconciliation and post-write signed live-role verification", async () => {
    const first = setup(); first.refresh.mockRejectedValue(new Error("offline"));
    await expect(updateCompanyMemberFieldwork(first.input)).rejects.toThrow("UNKNOWN");
    const second = setup(); second.readSession.mockResolvedValueOnce(response()).mockResolvedValueOnce({ ...response(), user: { ...session.user, role: "technician" } });
    await expect(updateCompanyMemberFieldwork(second.input)).rejects.toThrow("live management role");
    expect(second.refresh).toHaveBeenCalledTimes(1);
  });
  it("discard results and do not refresh the wrong account after target/session switches", async () => {
    const { input, update, refresh } = setup(); let current = true;
    update.mockImplementation(async () => { current = false; return acknowledgment(); });
    await expect(updateCompanyMemberFieldwork({ ...input, isCurrent: () => current })).rejects.toThrow("Company or target changed");
    expect(refresh).not.toHaveBeenCalled();
  });
});
