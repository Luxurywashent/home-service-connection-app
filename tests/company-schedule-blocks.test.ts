import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  CompanyScheduleBlocksLifecycle, companyScheduleBlockDay, companyScheduleBlockInput,
  isCompanyScheduleBlockAllDay, companyScheduleBlockMember,
  type CompanyScheduleBlockForm, type CompanyScheduleBlockScope,
} from "../lib/company-schedule-blocks";
import { JobSyncApiError, type JobSyncCompanyScheduleBlock, type JobSyncNativeSession, type JobSyncCompanyRoster } from "../lib/jobsync-mobile-api";
const mocks = vi.hoisted(() => ({ session: vi.fn(), members: vi.fn(), list: vi.fn(), create: vi.fn(), remove: vi.fn() }));
vi.mock("../lib/jobsync-mobile-api", async (original) => ({
  ...await original<typeof import("../lib/jobsync-mobile-api")>(),
  getJobSyncMobileSession: mocks.session, getJobSyncCompanyMembers: mocks.members,
  getJobSyncCompanyScheduleBlocks: mocks.list, createJobSyncCompanyScheduleBlock: mocks.create,
  deleteJobSyncCompanyScheduleBlock: mocks.remove,
}));
const actor = (): JobSyncNativeSession => ({ token: "mock-native-only", portal: "company",
  user: { id: 40, name: "Manager", email: null, role: "owner", calendarEligible: false },
  company: { id: 9, name: "Fixture", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } });
const team = (): JobSyncCompanyRoster => ({ company: { id: 9, name: "Fixture" }, members: [
  { id: 50, name: "Same Name", role: "technician", isActive: true, calendarEligible: true },
  { id: 60, name: "Same Name", role: "technician", isActive: true, calendarEligible: true },
] });
const form = (): CompanyScheduleBlockForm => ({ employeeId: "60", date: "2026-11-16", allDay: true, startHour: 8, endHour: 17, title: "Day Off" });
const row = (id = 11): JobSyncCompanyScheduleBlock => ({ id, employeeUserId: 60, employeeLabel: "Same Name", date: "2026-11-16", startHour: 0, endHour: 24, blockType: "day_off", title: "Day Off", notes: null });
const scope = (): CompanyScheduleBlockScope => ({ session: actor(), focused: true, enabled: true, date: "2026-11-16", boundary: "week0:day0" });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
let lifecycle: CompanyScheduleBlocksLifecycle;
let rows: JobSyncCompanyScheduleBlock[];
beforeEach(() => {
  rows = [];
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.session.mockResolvedValue(actor()); mocks.members.mockResolvedValue(team());
  mocks.list.mockImplementation(async () => rows.map((entry) => ({ ...entry })));
  mocks.create.mockImplementation(async () => { rows.push(row()); return { companyId: 9, count: 1 }; });
  mocks.remove.mockImplementation(async (_token, _company, id) => { rows = rows.filter((entry) => entry.id !== id); return { companyId: 9, success: true }; });
  lifecycle = new CompanyScheduleBlocksLifecycle(); lifecycle.bind(scope());
});
async function ready() { expect(await lifecycle.capture().refresh()).toBe(true); return lifecycle.capture(); }

describe("actual extracted Company blocker lifecycle; all APIs and sessions mocked", () => {
  it("uses the captured native bearer and numeric member ID despite duplicate labels; manager needs no personal lane", async () => {
    const actions = await ready();
    expect(await actions.create(form())).toBe(true);
    expect(mocks.create).toHaveBeenCalledWith("mock-native-only", 9, {
      startDate: "2026-11-16", endDate: "2026-11-16", employeeId: "60", employeeName: "Same Name",
      startHour: 0, endHour: 24, blockType: "day_off", title: "Day Off",
    });
    expect(mocks.session).toHaveBeenCalledWith("mock-native-only");
    expect(mocks.members).toHaveBeenCalledWith("mock-native-only", 9);
    expect(lifecycle.state.rows).toEqual([row()]);
    expect(mocks.list.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  it("preserves fractional wall hours and uses exact selected Company DATE", async () => {
    const actions = await ready(); const input = { ...form(), allDay: false, startHour: 9.5, endHour: 11, title: "Sick" };
    mocks.create.mockImplementation(async () => { rows = [{ ...row(), startHour: 9.5, endHour: 11, title: "Sick", blockType: "sick_day" }]; return { companyId: 9, count: 1 }; });
    expect(await actions.create(input)).toBe(true);
    expect(mocks.create.mock.calls[0][2]).toMatchObject({ startHour: 9.5, endHour: 11, startDate: input.date, endDate: input.date, blockType: "sick_day" });
  });
  it("requires successful signed list before writes and clears stale cards on failed refresh", async () => {
    expect(await lifecycle.capture().create(form())).toBe(false); expect(mocks.create).not.toHaveBeenCalled();
    rows = [row()]; await ready(); mocks.list.mockRejectedValue(new Error("404 native unpublished"));
    expect(await lifecycle.capture().refresh()).toBe(false);
    expect(lifecycle.state.rows).toEqual([]); expect(lifecycle.state.readVerified).toBe(false);
    expect(lifecycle.state.error).toContain("404 native unpublished");
    expect(await lifecycle.capture().create(form())).toBe(false); expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(["technician", "platform", "absent", "disabled"])("never enters native management or legacy fallback for %s session", async (kind) => {
    const input = scope();
    if (kind === "technician") input.session!.user.role = "technician";
    if (kind === "platform") input.session!.portal = "platform";
    if (kind === "absent") input.session = null;
    if (kind === "disabled") input.enabled = false;
    lifecycle.bind(input);
    expect(await lifecycle.capture().refresh()).toBe(false);
    expect(await lifecycle.capture().create(form())).toBe(false);
    expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
  });
  it.each(["company", "role", "token", "user"])("rechecks signed %s identity immediately before writes", async (field) => {
    const actions = await ready(); const changed = actor();
    if (field === "company") changed.company!.id = 10;
    if (field === "role") changed.user.role = "technician";
    if (field === "token") changed.token = "mock-rotated";
    if (field === "user") changed.user.id = 41;
    mocks.session.mockResolvedValue(changed);
    expect(await actions.create(form())).toBe(false); expect(mocks.create).not.toHaveBeenCalled();
    expect(lifecycle.state.rows).toEqual([]); expect(lifecycle.state.error).toBeTruthy();
  });
  it.each(["inactive", "other-company", "missing", "duplicate-ID"])("rejects stale target %s before POST", async (kind) => {
    const actions = await ready(); const roster = team();
    if (kind === "inactive") roster.members[1].isActive = false;
    if (kind === "other-company") roster.company.id = 10;
    if (kind === "missing") roster.members.pop();
    if (kind === "duplicate-ID") roster.members.push({ ...roster.members[1] });
    mocks.members.mockResolvedValue(roster);
    expect(await actions.create(form())).toBe(false); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("preserves ordinary validation input and lets corrected form retry without clearing verified list", async () => {
    const actions = await ready(); const input = { ...form(), title: "  " };
    expect(await actions.create(input)).toBe(false); expect(input.title).toBe("  ");
    expect(lifecycle.state.readVerified).toBe(true); expect(lifecycle.state.createHeld).toBe(false);
    expect(await actions.create({ ...input, title: "Day Off" })).toBe(true);
  });
  it("has synchronous double-tap lock before authorization awaits", async () => {
    const actions = await ready(); const delayed = deferred<JobSyncNativeSession>();
    mocks.session.mockReturnValueOnce(delayed.promise);
    const first = actions.create(form()); expect(await actions.create(form())).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled(); delayed.resolve(actor()); expect(await first).toBe(true);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it.each(["company", "token", "role", "user", "date", "week", "blur", "logout"])("ignores deferred read and old retained handlers after %s", async (change) => {
    const delayed = deferred<JobSyncCompanyScheduleBlock[]>(); mocks.list.mockReturnValueOnce(delayed.promise);
    const old = lifecycle.capture(); const pending = old.refresh();
    await Promise.resolve(); await Promise.resolve(); const next = scope();
    if (change === "company") next.session!.company!.id = 10;
    if (change === "token") next.session!.token = "mock-other";
    if (change === "role") next.session!.user.role = "dispatcher";
    if (change === "user") next.session!.user.id = 41;
    if (change === "date") next.date = "2026-11-17";
    if (change === "week") next.boundary = "week1";
    if (change === "blur") next.focused = false;
    if (change === "logout") next.session = null;
    lifecycle.bind(next); delayed.resolve([row()]); await pending;
    expect(lifecycle.state.rows).toEqual([]); expect(lifecycle.state.error).toBeNull();
    expect(await old.create(form())).toBe(false); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("ignores deferred create acknowledgment on scope change and holds original actor request on return", async () => {
    const actions = await ready(); const delayed = deferred<{ companyId: number; count: number }>();
    mocks.create.mockReturnValueOnce(delayed.promise); const creating = actions.create(form());
    await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    lifecycle.bind({ ...scope(), focused: false }); delayed.resolve({ companyId: 9, count: 1 });
    expect(await creating).toBe(false); expect(lifecycle.state.rows).toEqual([]); expect(lifecycle.state.error).toBeNull();
    lifecycle.bind(scope()); expect(lifecycle.state.createHeld).toBe(true);
    await lifecycle.capture().refresh(); expect(await lifecycle.capture().create(form())).toBe(false);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("does not retry unknown POST after empty read-back, modal cancellation or day/token switch", async () => {
    const actions = await ready(); mocks.create.mockRejectedValue(new JobSyncApiError("timeout", null, "TIMEOUT"));
    expect(await actions.create(form())).toBe(false); expect(lifecycle.state.createHeld).toBe(true);
    expect(lifecycle.state.error).toContain("empty list does not prove");
    expect(await actions.create(form())).toBe(false);
    const next = scope(); next.date = "2026-11-17"; next.session!.token = "mock-rotated";
    mocks.session.mockResolvedValue(next.session); lifecycle.bind(next); await lifecycle.capture().refresh();
    expect(lifecycle.state.createHeld).toBe(true); expect(await lifecycle.capture().create({ ...form(), date: next.date })).toBe(false);
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("reconciles uncertain POST only against sole exact new ID, not a baseline same-field block", async () => {
    rows = [row(10)]; const actions = await ready();
    mocks.create.mockImplementation(async () => { rows.push(row(12)); throw new JobSyncApiError("timeout", null, "TIMEOUT"); });
    expect(await actions.create(form())).toBe(true); expect(lifecycle.state.rows.map((entry) => entry.id)).toEqual([10, 12]);
    expect(lifecycle.state.createHeld).toBe(false); expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it.each(["baseline-only", "multiple-exact", "different-target", "invalid-ack"])("does not falsely confirm unknown or invalid result %s", async (kind) => {
    rows = [row(10)]; const actions = await ready();
    mocks.create.mockImplementation(async () => {
      if (kind === "multiple-exact") rows.push(row(11), row(12));
      if (kind === "different-target") rows.push({ ...row(11), employeeUserId: 50 });
      if (kind === "invalid-ack") { rows.push(row(11)); return { companyId: 10, count: 1 }; }
      throw new JobSyncApiError("timeout", null, "TIMEOUT");
    });
    expect(await actions.create(form())).toBe(false); expect(lifecycle.state.createHeld).toBe(true);
    expect(lifecycle.state.rows).toEqual([]); expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("acknowledged create without authoritative reread is held, not optimistically saved", async () => {
    const actions = await ready(); mocks.create.mockImplementation(async () => { mocks.list.mockRejectedValue(new Error("offline reread")); return { companyId: 9, count: 1 }; });
    expect(await actions.create(form())).toBe(false); expect(lifecycle.state.createHeld).toBe(true); expect(lifecycle.state.rows).toEqual([]);
  });
  it("explicit native refusal does not fallback and still requires successful reread before another save", async () => {
    const actions = await ready(); mocks.create.mockRejectedValue(new JobSyncApiError("forbidden", 403, "FORBIDDEN"));
    expect(await actions.create(form())).toBe(false); expect(lifecycle.state.createHeld).toBe(false); expect(lifecycle.state.readVerified).toBe(false);
    expect(await actions.create(form())).toBe(false); expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it("authoritatively removes numeric block under fresh member and signed management scope", async () => {
    rows = [row()]; const actions = await ready(); expect(await actions.remove(11)).toBe(true);
    expect(mocks.remove).toHaveBeenCalledWith("mock-native-only", 9, 11); expect(lifecycle.state.rows).toEqual([]);
  });
  it("no removal success when reread still contains block; no optimistic removal", async () => {
    rows = [row()]; const actions = await ready(); mocks.remove.mockResolvedValue({ companyId: 9, success: true });
    expect(await actions.remove(11)).toBe(false); expect(lifecycle.state.error).toContain("still present"); expect(lifecycle.state.readVerified).toBe(false);
  });
  it("rejects cross-Company removal and inactive member before DELETE", async () => {
    rows = [row()]; const actions = await ready(); const other = team(); other.company.id = 10; mocks.members.mockResolvedValue(other);
    expect(await actions.remove(11)).toBe(false); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("ignores deferred DELETE acknowledgment on blur and rejects a stale selected callback", async () => {
    rows = [row()]; const actions = await ready(); const delayed = deferred<{ companyId: number; success: true }>();
    mocks.remove.mockReturnValueOnce(delayed.promise); const deleting = actions.remove(11);
    await vi.waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(1)); lifecycle.bind({ ...scope(), focused: false });
    delayed.resolve({ companyId: 9, success: true }); expect(await deleting).toBe(false); expect(lifecycle.state.rows).toEqual([]); expect(lifecycle.state.error).toBeNull();
  });
  it("captured modal origin prevents dispatch after close during member check", async () => {
    const actions = await ready(); const delayed = deferred<JobSyncCompanyRoster>(); mocks.members.mockReturnValueOnce(delayed.promise);
    let modalOpen = true; const creating = actions.create(form(), () => modalOpen);
    await vi.waitFor(() => expect(mocks.members).toHaveBeenCalled()); modalOpen = false; delayed.resolve(team());
    expect(await creating).toBe(false); expect(mocks.create).not.toHaveBeenCalled();
  });
  it("can refresh the new Company while an old Company POST is still pending, without releasing write lock", async () => {
    const actions = await ready(); const delayed = deferred<{ companyId: number; count: number }>();
    mocks.create.mockReturnValueOnce(delayed.promise); const creating = actions.create(form());
    await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    const next = scope(); next.session!.company!.id = 10; next.session!.token = "mock-company-10";
    mocks.session.mockResolvedValue(next.session); mocks.list.mockResolvedValue([]); lifecycle.bind(next);
    expect(await lifecycle.capture().refresh()).toBe(true); expect(lifecycle.state.loading).toBe(false);
    expect(lifecycle.state.readVerified).toBe(true); expect(await lifecycle.capture().create(form())).toBe(false);
    delayed.resolve({ companyId: 9, count: 1 }); expect(await creating).toBe(false);
    expect(lifecycle.state.rows).toEqual([]); expect(lifecycle.state.error).toBeNull();
  });
  it("closing the modal after POST dispatch retains visible hold and cannot reopen a blind retry", async () => {
    const actions = await ready(); const delayed = deferred<{ companyId: number; count: number }>();
    mocks.create.mockReturnValueOnce(delayed.promise); let open = true;
    const creating = actions.create(form(), () => open);
    await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1)); open = false;
    delayed.resolve({ companyId: 9, count: 1 }); expect(await creating).toBe(false);
    expect(lifecycle.state.createHeld).toBe(true); expect(lifecycle.state.error).toContain("Do not save again");
    await lifecycle.capture().refresh(); expect(lifecycle.state.createHeld).toBe(true);
    expect(await lifecycle.capture().create(form())).toBe(false); expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});

describe("wall-clock validation and unchanged screen integration", () => {
  it("uses Company-local week even when the device instant belongs to another week", () => {
    const now = new Date("2026-11-16T00:30:00Z");
    expect(companyScheduleBlockDay(0, 0, "America/Chicago", now)).toBe("2026-11-09");
    expect(companyScheduleBlockDay(0, 0, "Asia/Tokyo", now)).toBe("2026-11-16");
    expect(companyScheduleBlockDay(0, 0, null, now)).toBeNull();
    expect(companyScheduleBlockDay(0, 0, "not-a-zone", now)).toBeNull();
    expect(isCompanyScheduleBlockAllDay(row())).toBe(true);
    expect(isCompanyScheduleBlockAllDay({ startHour: 8, endHour: 17 })).toBe(false);
  });
  it.each(["jobsync-60", "Same Name", "060", "60x", "0", "9007199254740993"])("does not select canonical user by invalid ID %s", (id) => {
    expect(companyScheduleBlockMember(team(), 9, id)).toBeNull();
  });
  it.each([
    { date: "2026-02-30" }, { date: "2026-11-16T09:00:00Z" }, { title: "x".repeat(256) },
    { allDay: false, startHour: 11, endHour: 11 }, { allDay: false, startHour: -1 },
    { allDay: false, endHour: 25 }, { allDay: false, startHour: NaN },
  ])("validates real DATE/title/hours locally %o", (invalid) => {
    expect(() => companyScheduleBlockInput({ ...form(), ...invalid }, team(), 9)).toThrow();
  });
  it.each(["Event", "Personal", "Vacation", "Training", "Custom reason"])("preserves %s as title without PTO writes", (title) => {
    expect(companyScheduleBlockInput({ ...form(), title }, team(), 9)).toMatchObject({ blockType: "other", title });
  });
  it("only edits blocker UI callsites, preserves modal and excludes technician additions and legacy fallback", () => {
    const source = readFileSync(new URL("../app/(tabs)/admin-schedule.tsx", import.meta.url), "utf8");
    expect(source).toContain("useCompanyScheduleBlocks({ session: jobSyncSession");
    expect(source).toContain("companyBlocks.readVerified");
    expect(source).toContain("const value = isJobSyncCompany ? det.employeeId : det.name");
    expect(source).toContain("return; // A failing Company call must never enter generic tRPC.");
    expect(source).toContain("if (companyJobMode || !current()) return;");
    const modal = source.slice(source.indexOf("{/* ─── Add Blocker Modal"), source.indexOf("{/* ─── Charge Card on File Modal"));
    expect(modal).toContain("<CalendarPicker"); expect(modal).toContain("<Switch"); expect(modal).toContain("<DragTimePicker");
    expect(modal).toContain('["Day Off", "Event", "Personal", "Sick", "Vacation"]');
    expect(modal).toContain("Any existing jobs are not affected."); expect(modal).not.toContain("blockerCreateMutation.mutate(");
    expect(readFileSync(new URL("../app/(tabs)/schedule.tsx", import.meta.url), "utf8")).not.toContain("useCompanyScheduleBlocks");
    const helper = readFileSync(new URL("../lib/company-schedule-blocks.ts", import.meta.url), "utf8");
    expect(helper).not.toContain("trpc"); expect(helper).not.toContain("LegacyAuth"); expect(helper).not.toContain("timeOff");
  });
});
