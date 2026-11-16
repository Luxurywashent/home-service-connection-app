import React, { act, useLayoutEffect } from "react";
import { createRequire } from "node:module";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM } from "./helpers/company-photo-test-dom";
import { useCompanyScheduleBlocks } from "../hooks/use-company-schedule-blocks";
import type { JobSyncNativeSession, JobSyncCompanyScheduleBlock } from "../lib/jobsync-mobile-api";
import type { CompanyScheduleBlockScope } from "../lib/company-schedule-blocks";
const mocks = vi.hoisted(() => ({ session: vi.fn(), members: vi.fn(), list: vi.fn(), create: vi.fn(), remove: vi.fn() }));
vi.mock("../lib/jobsync-mobile-api", async (original) => ({
  ...await original<typeof import("../lib/jobsync-mobile-api")>(), getJobSyncMobileSession: mocks.session,
  getJobSyncCompanyMembers: mocks.members, getJobSyncCompanyScheduleBlocks: mocks.list,
  createJobSyncCompanyScheduleBlock: mocks.create, deleteJobSyncCompanyScheduleBlock: mocks.remove,
}));
const actor = (): JobSyncNativeSession => ({ token: "mock-hook-native", portal: "company",
  user: { id: 40, name: "Nonfield manager", email: null, role: "dispatcher", calendarEligible: false },
  company: { id: 9, name: "Fixture", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } });
const scope = (): CompanyScheduleBlockScope => ({ session: actor(), focused: true, enabled: true, date: "2026-11-16", boundary: "selected-day" });
const row = (): JobSyncCompanyScheduleBlock => ({ id: 11, employeeUserId: 60, employeeLabel: "Tech", date: "2026-11-16",
  startHour: 0, endHour: 24, blockType: "day_off", title: "Day Off", notes: null });
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
let root: ReturnType<typeof createRoot>;
let latest: ReturnType<typeof useCompanyScheduleBlocks>;
type BlockView = ReturnType<typeof useCompanyScheduleBlocks>;
function CommitProbe({ value, observe }: { value: BlockView; observe: (value: BlockView) => void }) {
  useLayoutEffect(() => { observe(value); }, [value, observe]);
  return null;
}
function Harness({ input, refresh = 0, observe }: { input: CompanyScheduleBlockScope; refresh?: number; observe?: (value: BlockView) => void }) {
  const value = useCompanyScheduleBlocks(input, refresh);
  useLayoutEffect(() => { latest = value; }, [value]);
  return <div>{value.rows.map((entry) => entry.id).join(",")}{observe ? <CommitProbe value={value} observe={observe} /> : null}</div>;
}
async function render(input = scope(), refresh = 0) { await act(async () => root.render(<Harness input={input} refresh={refresh} />)); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.session.mockResolvedValue(actor()); mocks.members.mockResolvedValue({ company: { id: 9, name: "Fixture" }, members: [{ id: 60, name: "Tech", isActive: true, role: "technician", calendarEligible: true }] });
  mocks.list.mockResolvedValue([row()]); mocks.remove.mockResolvedValue({ companyId: 9, success: true });
  root = createRoot(installPhotoTestDOM().body);
});
afterEach(async () => { await act(async () => root.unmount()); });
describe("Company blocker hook — actual React lifecycle with mocked APIs", () => {
  it("nonfield dispatcher manages Company blocks without a personal lane", async () => {
    await render(); expect(latest.rows).toEqual([row()]); expect(latest.readVerified).toBe(true);
    expect(mocks.list).toHaveBeenCalledWith("mock-hook-native", 9, "2026-11-16");
  });
  it("clears rows synchronously on blur and rejects retained handlers", async () => {
    await render(); const old = latest;
    await render({ ...scope(), focused: false }); expect(latest.rows).toEqual([]); expect(latest.current()).toBe(false);
    await act(async () => { expect(await old.remove(11)).toBe(false); }); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it.each(["token", "company", "role", "date", "week"])("ignores old deferred Company list on %s change", async (change) => {
    const delayed = deferred<JobSyncCompanyScheduleBlock[]>(); mocks.list.mockReturnValueOnce(delayed.promise); await render();
    const next = scope();
    if (change === "token") next.session!.token = "mock-rotated";
    if (change === "company") next.session!.company!.id = 10;
    if (change === "role") next.session!.user.role = "owner";
    if (change === "date") next.date = "2026-11-17";
    if (change === "week") next.boundary = "next-week";
    mocks.session.mockResolvedValue(next.session); mocks.list.mockResolvedValue([]); await render(next);
    await act(async () => delayed.resolve([row()])); expect(latest.rows).toEqual([]); expect(latest.error).toBeNull();
  });
  it("failed refresh clears cards and exposes error; writes remain disabled", async () => {
    await render(); mocks.list.mockRejectedValue(new Error("native 404 unpublished")); await render(scope(), 1);
    expect(latest.rows).toEqual([]); expect(latest.readVerified).toBe(false); expect(latest.error).toContain("native 404");
    await act(async () => { expect(await latest.remove(11)).toBe(false); }); expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("no-session lifecycle never loads legacy or native management records", async () => {
    await render({ ...scope(), session: null }); expect(latest.rows).toEqual([]); expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it("ignores old read after unmount", async () => {
    const delayed = deferred<JobSyncCompanyScheduleBlock[]>(); mocks.list.mockReturnValueOnce(delayed.promise); await render();
    const old = latest; await act(async () => root.unmount()); await act(async () => delayed.resolve([row()]));
    expect(old.current()).toBe(false);
    root = createRoot(installPhotoTestDOM().body);
  });
  it("masks old Company rows and actions in the switch render before the parent layout binding", async () => {
    await render();
    const next = scope(); next.session!.company!.id = 10; next.session!.token = "mock-next-company";
    mocks.session.mockResolvedValue(next.session); mocks.list.mockResolvedValue([]);
    const observed: BlockView[] = [];
    const observe = (value: BlockView) => { observed.push(value); };
    await act(async () => root.render(<Harness input={next} observe={observe} />));
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every((value) => value.rows.length === 0)).toBe(true);
    expect(observed[0].current()).toBe(false);
    await act(async () => { expect(await observed[0].remove(11)).toBe(false); });
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("does not revive retained actions when the same scope returns after a committed switch", async () => {
    await render(); const old = latest;
    await render({ ...scope(), focused: false }); await render();
    expect(latest.current()).toBe(true); expect(old.current()).toBe(false);
    await act(async () => { expect(await old.remove(11)).toBe(false); });
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("rejects create dispatch when the Company changes during fresh member verification", async () => {
    await render(); const old = latest;
    const roster = deferred<{ company: { id: number; name: string }; members: { id: number; name: string; isActive: boolean; role: string; calendarEligible: boolean }[] }>();
    mocks.members.mockReturnValueOnce(roster.promise);
    let creating!: Promise<boolean>;
    await act(async () => { creating = old.create({ employeeId: "60", date: "2026-11-16", allDay: true, startHour: 8, endHour: 17, title: "Day Off" }); });
    expect(mocks.members).toHaveBeenCalledTimes(1);
    const next = scope(); next.session!.company!.id = 10;
    mocks.session.mockResolvedValue(next.session); mocks.list.mockResolvedValue([]); await render(next);
    await act(async () => {
      roster.resolve({ company: { id: 9, name: "Fixture" }, members: [{ id: 60, name: "Tech", isActive: true, role: "technician", calendarEligible: true }] });
      expect(await creating).toBe(false);
    });
    expect(mocks.create).not.toHaveBeenCalled(); expect(latest.rows).toEqual([]); expect(latest.error).toBeNull();
  });
  it("rebinds captured actions after StrictMode layout cleanup/replay without a refresh loop", async () => {
    await act(async () => root.render(<React.StrictMode><Harness input={scope()} /></React.StrictMode>));
    expect(latest.current()).toBe(true); expect(latest.rows).toEqual([row()]);
    const calls = mocks.list.mock.calls.length;
    await act(async () => root.render(<React.StrictMode><Harness input={scope()} /></React.StrictMode>));
    expect(mocks.list).toHaveBeenCalledTimes(calls); expect(latest.readVerified).toBe(true);
  });
});
