import React, { act } from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM } from "./helpers/company-photo-test-dom";
import type { JobSyncCompanyRoster, JobSyncNativeSession } from "../lib/jobsync-mobile-api";
import { useCompanyFieldworkCalendar } from "../hooks/use-company-fieldwork-calendar";

const mocks = vi.hoisted(() => ({ focused: true, roster: vi.fn(), session: vi.fn() }));
vi.mock("expo-router", () => ({ useIsFocused: () => mocks.focused }));
vi.mock("../lib/jobsync-mobile-api", async (original) => ({
  ...await original<typeof import("../lib/jobsync-mobile-api")>(),
  getJobSyncCompanyMembers: mocks.roster,
  getJobSyncMobileSession: mocks.session,
}));
const { createRoot } = createRequire(import.meta.url)("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
const fixture = (override: boolean | null | undefined = true): JobSyncNativeSession => ({
  token: "mock-only-owner-token", portal: "company",
  user: { id: 40, name: "Fixture Owner", email: null, role: "owner", ...(override === undefined ? {} : { calendarEligible: override }) },
  company: { id: 9, name: "Fixture Company", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null },
});
const roster = (): JobSyncCompanyRoster => ({
  company: { id: 9, name: "Fixture Company" },
  members: [
    { id: 40, name: "Fixture Owner", role: "owner", isActive: true, calendarEligible: true },
    { id: 50, name: "Fixture Technician", role: "technician", isActive: true, calendarEligible: true },
  ],
});
let root: ReturnType<typeof createRoot>;
let latest: ReturnType<typeof useCompanyFieldworkCalendar>;
function Harness({ session, refresh = 0 }: { session: JobSyncNativeSession | null; refresh?: number }) {
  latest = useCompanyFieldworkCalendar(session, refresh);
  return <div>{latest.members.map((member) => member.employeeId).join(",")}</div>;
}
async function render(session: JobSyncNativeSession | null = fixture(), refresh = 0) {
  await act(async () => { root.render(<Harness session={session} refresh={refresh} />); });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-15T06:00:00Z"));
  mocks.focused = true;
  mocks.roster.mockReset().mockResolvedValue(roster());
  mocks.session.mockReset().mockResolvedValue(fixture());
  const doc = installPhotoTestDOM();
  root = createRoot(doc.body);
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); });

describe("Company fieldwork calendar hook — mocked signed reads, real React lifecycle", () => {
  it("uses signed roster plus current self override without a duplicate member identity", async () => {
    await render();
    expect(latest.members.map((member) => member.employeeId)).toEqual(["jobsync-40", "jobsync-50"]);
    expect(mocks.roster).toHaveBeenCalledWith("mock-only-owner-token", 9);
    expect(mocks.session).toHaveBeenCalledWith("mock-only-owner-token");
  });
  it.each([false, null, undefined])("does not infer owner candidacy from position-only roster when signed override is %s", async (value) => {
    const live = fixture(value);
    if (value === undefined) delete live.user.calendarEligible;
    mocks.session.mockResolvedValue(live);
    await render();
    expect(latest.members.map((member) => member.id)).toEqual([50]);
  });
  it("retains ordinary technicians but not owner on a signed-session refusal", async () => {
    mocks.session.mockRejectedValue(new Error("401"));
    await render();
    expect(latest.members.map((member) => member.id)).toEqual([50]);
  });
  it("clears prior lanes on roster failure rather than preserving stale owner opt-in", async () => {
    await render();
    mocks.roster.mockRejectedValue(new Error("offline"));
    await render(fixture(), 1);
    expect(latest.members).toEqual([]);
    expect(latest.error).toContain("Existing Job assignments were not changed");
  });
  it("removes the owner on evidence expiry without inventing an unassignment", async () => {
    await render();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(latest.members.map((member) => member.id)).toEqual([50]);
  });
  it("clears candidacy synchronously when the screen blurs", async () => {
    await render();
    mocks.focused = false;
    await render();
    expect(latest.members).toEqual([]);
    expect(await latest.verifyAssignment("jobsync-40")).toBe(false);
  });
  it("does not apply late old-Company roster results", async () => {
    const old = deferred<JobSyncCompanyRoster>();
    mocks.roster.mockReturnValueOnce(old.promise);
    await render();
    const next = fixture();
    next.company = { ...next.company!, id: 10 };
    next.token = "mock-only-new-company-token";
    mocks.roster.mockResolvedValue({ company: { id: 10, name: "Other fixture" }, members: [] });
    mocks.session.mockResolvedValue(next);
    await render(next);
    await act(async () => old.resolve(roster()));
    expect(latest.members).toEqual([]);
  });
  it("rejects exact-owner role disagreement in a fresh signed session", async () => {
    const changed = fixture(); changed.user.role = "dispatcher";
    mocks.session.mockResolvedValue(changed);
    await render();
    expect(latest.members.map((member) => member.id)).toEqual([50]);
  });
  it("re-reads assignment candidates and denies a remote owner opt-out before assignment", async () => {
    await render();
    mocks.session.mockResolvedValue(fixture(false));
    expect(await latest.verifyAssignment("jobsync-40")).toBe(false);
    expect(mocks.session).toHaveBeenCalledTimes(2);
  });
  it("verifies an exact current eligible Technician through the same existing roster", async () => {
    await render();
    expect(await latest.verifyAssignment("jobsync-50")).toBe(true);
    expect(await latest.verifyAssignment("jobsync-999")).toBe(false);
  });
  it("rejects assignment verification that finishes after blur", async () => {
    await render();
    const delayed = deferred<JobSyncCompanyRoster>();
    mocks.roster.mockReturnValueOnce(delayed.promise);
    const old = latest.verifyAssignment("jobsync-40");
    mocks.focused = false; await render();
    await act(async () => delayed.resolve(roster()));
    expect(await old).toBe(false);
  });
  it("never reads a legacy or absent session as Company calendar evidence", async () => {
    await render(null);
    expect(latest.members).toEqual([]);
    expect(mocks.roster).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  });
});

describe("screen integration safeguards", () => {
  it.each(["schedule", "admin-schedule", "admin-customer-profile"])("%s uses signed scope and exact Company Job provenance for preview and refresh", (name) => {
    const source = readFileSync(new URL(`../app/(tabs)/${name}.tsx`, import.meta.url), "utf8");
    expect(source).toContain("useState<CompanyPhotoSelection | null>");
    expect(source).toContain("const companyPhotoJobId = selectedJob?.companyId === jobSyncSession?.company?.id");
    expect(source).toContain("<CompanyJobPhotos session={jobSyncSession} jobId={companyPhotoJobId}");
    expect(source).toContain("<CompanyJobPhotoPreview session={jobSyncSession} jobId={companyPhotoJobId}");
    expect(source).toContain("onRefresh={refreshCompanyJob}");
    expect(source).toMatch(/const refreshCompanyJob = async \(\) => \{\s*setCompanyPhotoPreview\(null\);\s*await companyJob.refresh\(\)/);
    expect(source).not.toContain("<CompanyJobPhotoPreview url=");
  });
  it("retains canonical assignments in a visible fallback and verifies every new calendar assignment", () => {
    const source = readFileSync(new URL("../app/(tabs)/admin-schedule.tsx", import.meta.url), "utf8");
    expect(source).toContain("useCompanyFieldworkCalendar(jobSyncSession, syncKey)");
    expect(source).toContain("!await boundary.verifyAssignment(`jobsync-${nextAssignee}`)");
    expect(source).toContain("cityConfig.detailers.length === 0 && dayJobs.length === 0");
    expect(source).toContain('"Other / Unassigned"');
    expect(source).toContain("member.employeeId === job.assignedTo");
  });
});

describe("exact-self dispatcher calendar lifecycle", () => {
  function dispatcher(value?: boolean | null) {
    const actor = fixture(value); actor.user.role = "dispatcher";
    if (arguments.length === 0) actor.user.calendarEligible = true;
    else if (value === undefined) delete actor.user.calendarEligible;
    return actor;
  }
  function dispatcherRoster() {
    const rows = roster(); rows.members[0].role = "dispatcher";
    rows.members.push({ id: 60, name: "Other Dispatcher", role: "dispatcher", isActive: true, calendarEligible: true });
    return rows;
  }
  it("reads exact-self dispatcher ON on focus and denies other position-enabled managers", async () => {
    mocks.roster.mockResolvedValue(dispatcherRoster()); mocks.session.mockResolvedValue(dispatcher());
    await render(dispatcher());
    expect(latest.members.map((row) => row.employeeId)).toEqual(["jobsync-40", "jobsync-50"]);
    expect(latest.members[0].fieldworkSource).toBe("signed-self-dispatcher");
    expect(mocks.session).toHaveBeenCalledTimes(1);
    expect(await latest.verifyAssignment("jobsync-40")).toBe(true);
    expect(mocks.session).toHaveBeenCalledTimes(2);
    mocks.session.mockResolvedValue(dispatcher(false));
    expect(await latest.verifyAssignment("jobsync-40")).toBe(false);
  });
  it.each([false, null, undefined])("removes dispatcher candidate after fresh %s override", async (value) => {
    mocks.roster.mockResolvedValue(dispatcherRoster()); mocks.session.mockResolvedValue(dispatcher());
    await render(dispatcher()); mocks.session.mockResolvedValue(dispatcher(value)); await render(dispatcher(value));
    expect(latest.members.map((row) => row.id)).toEqual([50]);
  });
  it("expiry, blur, demotion and signed refusal never retain dispatcher candidacy", async () => {
    mocks.roster.mockResolvedValue(dispatcherRoster()); mocks.session.mockResolvedValue(dispatcher()); await render(dispatcher());
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(latest.members.map((row) => row.id)).toEqual([50]);
    await render(dispatcher(), 1); mocks.focused = false; await render(dispatcher()); expect(latest.members).toEqual([]);
    mocks.focused = true; mocks.session.mockRejectedValue(new Error("Fixture refusal")); await render(dispatcher());
    expect(latest.members.map((row) => row.id)).toEqual([50]);
    const demoted = dispatcher(); demoted.user.role = "technician"; mocks.session.mockResolvedValue(demoted); await render(dispatcher(), 2);
    expect(latest.members.map((row) => row.id)).toEqual([50]);
  });
  it.each(["token", "company", "user"])("rejects late dispatcher signed evidence after %s changes", async (change) => {
    const old = deferred<JobSyncNativeSession>(); mocks.roster.mockResolvedValue(dispatcherRoster()); mocks.session.mockReturnValueOnce(old.promise);
    await render(dispatcher()); const next = dispatcher();
    if (change === "token") next.token = "fixture-rotated";
    if (change === "company") next.company = { ...next.company!, id: 10 };
    if (change === "user") next.user.id = 41;
    mocks.session.mockResolvedValue(next);
    mocks.roster.mockResolvedValue({ company: { id: next.company!.id, name: "Fixture" }, members: [roster().members[1]] });
    await render(next); await act(async () => { old.resolve(dispatcher()); });
    expect(latest.members.map((row) => row.id)).toEqual([50]);
  });
});
