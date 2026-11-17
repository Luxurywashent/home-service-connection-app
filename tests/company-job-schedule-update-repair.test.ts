import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  companyJobScheduleInstant, companyJobScheduleScope, companyJobScheduleWriteBlocked,
  createCompanyJobScheduleUpdateController, verifyCompanyJobScheduleAck,
  type CompanyJobScheduleDraft, type CompanyJobScheduleMutation, type CompanyJobScheduleSnapshot,
} from "../lib/company-job-schedule-update";
import type { JobSyncCompanyJobDetail, JobSyncCompanySettings, JobSyncNativeSession } from "../lib/jobsync-mobile-api";

const BACK = "/home/ubuntu/hsc-mobile-release-readiness-20261117/backend-source-66141c98";
let nextJob = 94000;
const session = (): JobSyncNativeSession => ({ token: "isolated-calendar-token", portal: "company",
  user: { id: 40, role: "owner", name: "Fixture", email: null },
  company: { id: 9, name: "Fixture", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } });
const draft = (): CompanyJobScheduleDraft => ({ date: "2026-12-01", startHour: 10, endHour: 12, assignedUserId: 60 });
function fixture() {
  const actor = session();
  const baseline: CompanyJobScheduleSnapshot = { id: ++nextJob, companyId: 9, updatedAt: "2026-11-17T15:00:00.000Z",
    assignedUserId: 50, date: "2026-12-01", startHour: 9, endHour: 11 };
  let canonical = { id: baseline.id, companyId: 9, customerId: 7, assignedUserId: 50, updatedAt: baseline.updatedAt,
    scheduledStartAt: "2026-12-01T15:00:00.000Z", scheduledEndAt: "2026-12-01T17:00:00.000Z", status: "scheduled", photos: [] } as unknown as JobSyncCompanyJobDetail;
  let current = true;
  const events: string[] = [];
  const api = {
    session: vi.fn(async () => { events.push("session"); return structuredClone(actor); }),
    detail: vi.fn(async () => { events.push("GET detail"); return structuredClone(canonical); }),
    settings: vi.fn(async (): Promise<JobSyncCompanySettings> => { events.push("settings"); return { id: 9, name: "Fixture", timezone: "America/Chicago" }; }),
  };
  const write = vi.fn(async (_token: string, jobId: number, body: CompanyJobScheduleMutation): Promise<unknown> => {
    events.push("PATCH schedule");
    canonical = { ...canonical, ...body, updatedAt: "2026-11-17T15:01:00.000Z" };
    return { success: true, jobId, assignedUserId: body.assignedUserId, scheduledStartAt: body.scheduledStartAt, scheduledEndAt: body.scheduledEndAt };
  });
  const verifyAssignment = vi.fn(async () => true);
  const onVerified = vi.fn(async () => { events.push("calendar readback"); return true; });
  const options = { session: actor, baseline, isCurrent: () => current, verifyAssignment, write, api, onVerified };
  return { actor, baseline, api, write, verifyAssignment, onVerified, events, options,
    controller: () => createCompanyJobScheduleUpdateController(options),
    setCurrent: (value: boolean) => { current = value; },
    setCanonical: (patch: Partial<JobSyncCompanyJobDetail>) => { canonical = { ...canonical, ...patch }; },
    getCanonical: () => canonical,
  };
}
beforeEach(() => { vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Live HTTP forbidden")); });
afterEach(() => { vi.restoreAllMocks(); });

 describe("strict Company calendar wall time", () => {
  it.each([
    ["America/Chicago", "2026-12-01", 9, "2026-12-01T15:00:00.000Z"],
    ["America/Chicago", "2026-10-14", 9, "2026-10-14T14:00:00.000Z"],
    ["America/Chicago", "2026-12-01", 24, "2026-12-02T06:00:00.000Z"],
    ["Asia/Kathmandu", "2026-12-01", 9.5, "2026-12-01T03:45:00.000Z"],
    ["UTC", "2028-02-29", 0, "2028-02-29T00:00:00.000Z"],
  ])("uses explicit %s Company zone for %s/%s, independent of phone", (zone, date, hour, expected) => {
    expect(companyJobScheduleInstant(date as string, hour as number, zone as string)).toBe(expected);
  });
  it.each([
    ["2026-03-08", 2.5, "America/Chicago", /does not exist/],
    ["2026-11-01", 1.5, "America/Chicago", /repeats/],
    ["2026-04-05", 1.75, "Australia/Lord_Howe", /repeats/],
    ["2026-10-04", 2.25, "Australia/Lord_Howe", /does not exist/],
    ["2026-02-30", 9, "UTC", /real Company/],
    ["2026-13-01", 9, "UTC", /real Company/],
    ["2026-2-01", 9, "UTC", /valid Company/],
    ["1999-12-01", 9, "UTC", /real Company/],
    ["2026-12-01", -1, "UTC", /valid Company/],
    ["2026-12-01", 25, "UTC", /valid Company/],
    ["2026-12-01", 9.00001, "UTC", /minute-aligned/],
    ["2026-12-01", NaN, "UTC", /valid Company/],
    ["2026-12-01", 9, "", /unavailable/],
    ["2026-12-01", 9, "Invented/Zone", /invalid/],
  ])("rejects %s/%s/%s without normalization", (date, hour, zone, message) => {
    expect(() => companyJobScheduleInstant(date as string, hour as number, zone as string)).toThrow(message as RegExp);
  });
});

describe("atomic guarded Company schedule controller", () => {
  it.each(["owner", "dispatcher"] as const)("%s combines time/lane/fresh version and waits for GET plus calendar", async (role) => {
    const h = fixture(); h.actor.user.role = role;
    const result = await h.controller().save(draft());
    expect(result.status).toBe("saved"); expect(result.detail?.assignedUserId).toBe(60);
    expect(h.write).toHaveBeenCalledTimes(1);
    expect(h.write).toHaveBeenCalledWith(h.actor.token, h.baseline.id, {
      scheduledStartAt: "2026-12-01T16:00:00.000Z", scheduledEndAt: "2026-12-01T18:00:00.000Z",
      assignedUserId: 60, expectedUpdatedAt: h.baseline.updatedAt,
    });
    expect(h.api.detail).toHaveBeenCalledTimes(2); expect(h.onVerified).toHaveBeenCalledTimes(1);
    expect(h.events.indexOf("PATCH schedule")).toBeLessThan(h.events.lastIndexOf("GET detail"));
    expect(h.events.at(-1)).toBe("calendar readback");
    expect(h.verifyAssignment).toHaveBeenCalledWith("jobsync-60");
    expect(companyJobScheduleWriteBlocked(h.actor, h.baseline.id)).toBe(false);
  });
  it.each([50, null])("preserves existing assignment or explicit unassignment %s in one PATCH", async (assignedUserId) => {
    const h = fixture(); expect((await h.controller().save({ ...draft(), assignedUserId })).status).toBe("saved");
    expect(h.write.mock.calls[0][2].assignedUserId).toBe(assignedUserId); expect(h.verifyAssignment).not.toHaveBeenCalled();
  });
  it("lane-only edit also sends complete time/end/version once", async () => {
    const h = fixture(); expect((await h.controller().save({ ...draft(), startHour: 9, endHour: 11 })).status).toBe("saved");
    expect(h.write.mock.calls[0][2].scheduledStartAt).toBe("2026-12-01T15:00:00.000Z"); expect(h.write).toHaveBeenCalledTimes(1);
  });
  it("captures immutable intent and does not clear consumed guard after success", async () => {
    const h = fixture(), controller = h.controller(), intent = draft();
    const save = controller.save(intent); intent.assignedUserId = 999; intent.startHour = 16;
    expect((await save).status).toBe("saved"); expect(h.write.mock.calls[0][2].assignedUserId).toBe(60);
    expect(Object.isFrozen(h.write.mock.calls[0][2])).toBe(true);
    expect((await controller.save(draft())).status).toBe("blocked"); expect(h.write).toHaveBeenCalledTimes(1);
  });
  it("locks duplicate controllers/other manager/token before first await", async () => {
    const h = fixture(); let release!: () => void;
    h.api.session.mockImplementationOnce(async () => { await new Promise<void>((resolve) => { release = resolve; }); return h.actor; });
    const saving = h.controller().save(draft());
    const otherActor = { ...h.actor, token: "different-signed-token", user: { ...h.actor.user, id: 41 } };
    const other = createCompanyJobScheduleUpdateController({ ...h.options, session: otherActor });
    expect(companyJobScheduleWriteBlocked(otherActor, h.baseline.id)).toBe(true);
    expect((await other.save(draft())).status).toBe("blocked"); release(); await saving;
    expect(h.write).toHaveBeenCalledTimes(1);
  });
  it("read-only review holds the same Job lock so no new controller can write during its GET", async () => {
    const h = fixture(); let release!: () => void;
    h.api.session.mockImplementationOnce(async () => { await new Promise<void>((resolve) => { release = resolve; }); return h.actor; });
    const reviewing = h.controller().refresh();
    expect(companyJobScheduleWriteBlocked(h.actor, h.baseline.id)).toBe(true);
    expect((await h.controller().save(draft())).status).toBe("blocked");
    release(); expect(await reviewing).not.toBeNull();
    expect(companyJobScheduleWriteBlocked(h.actor, h.baseline.id)).toBe(false);
    expect(h.write).not.toHaveBeenCalled();
  });
  it("explicit parent review can read with unavailable edit baseline but cannot save", async () => {
    const h = fixture();
    const controller = createCompanyJobScheduleUpdateController({ ...h.options,
      baseline: { ...h.baseline, updatedAt: null, date: "", startHour: 0, endHour: 0, assignedUserId: null } });
    expect((await controller.save(draft())).status).toBe("blocked");
    expect(await controller.refresh()).not.toBeNull(); expect(h.write).not.toHaveBeenCalled();
  });
  it.each([
    { updatedAt: "2026-11-17T15:00:01.000Z" }, { assignedUserId: 51 },
    { scheduledStartAt: "2026-12-01T14:00:00.000Z" }, { scheduledEndAt: "2026-12-01T18:00:00.000Z" },
  ])("fresh baseline mismatch %j conflicts without PATCH", async (patch) => {
    const h = fixture(); h.setCanonical(patch);
    expect((await h.controller().save(draft())).status).toBe("conflict"); expect(h.write).not.toHaveBeenCalled();
  });
  it.each([
    { companyId: 10 }, { id: 1 }, { updatedAt: null }, { customerId: NaN },
    { scheduledStartAt: null }, { scheduledEndAt: null }, { assignedUserId: -1 }, { status: "cancelled" },
  ])("unverified canonical provenance/version/lifecycle %j blocks", async (patch) => {
    const h = fixture(); h.setCanonical(patch);
    expect((await h.controller().save(draft())).status).toBe("blocked"); expect(h.write).not.toHaveBeenCalled();
  });
  it.each(["technician", "developer"] as const)("never grants %s manager schedule editing", async (role) => {
    const h = fixture(); h.actor.user.role = role;
    expect(companyJobScheduleScope(h.actor)).toBeNull(); expect((await h.controller().save(draft())).status).toBe("blocked");
    expect(h.api.session).not.toHaveBeenCalled(); expect(h.write).not.toHaveBeenCalled();
  });
  it.each(["role", "tenant", "token", "actor"])("fresh signed %s change blocks without mutation", async (change) => {
    const h = fixture(), fresh = structuredClone(h.actor);
    if (change === "role") fresh.user.role = "technician";
    if (change === "tenant") fresh.company!.id = 10;
    if (change === "token") fresh.token = "changed-token";
    if (change === "actor") fresh.user.id = 41;
    h.api.session.mockResolvedValue(fresh);
    expect((await h.controller().save(draft())).status).toBe("blocked"); expect(h.write).not.toHaveBeenCalled();
  });
  it("rechecks signed role immediately before PATCH, after candidate verification", async () => {
    const h = fixture(); let checks = 0;
    h.api.session.mockImplementation(async () => { checks++; return checks === 3 ? { ...h.actor, user: { ...h.actor.user, role: "technician" } } : structuredClone(h.actor); });
    expect((await h.controller().save(draft())).status).toBe("blocked"); expect(h.write).not.toHaveBeenCalled();
  });
  it.each([
    { id: 10, timezone: "America/Chicago" }, { id: 9, timezone: "" }, { id: 9, timezone: "Invented/Zone" },
  ])("strict Company settings %j cannot fall back", async (settings) => {
    const h = fixture(); h.api.settings.mockResolvedValue({ ...settings, name: "Fixture" });
    expect((await h.controller().save(draft())).status).toBe("blocked"); expect(h.write).not.toHaveBeenCalled();
  });
  it.each([
    { date: "2026-03-08", startHour: 2.5 }, { date: "2026-11-01", startHour: 1.5 },
    { startHour: 24, endHour: 24 }, { startHour: 12, endHour: 11 }, { assignedUserId: 0 },
  ])("invalid intended calendar slot %j never writes", async (patch) => {
    const h = fixture(); expect((await h.controller().save({ ...draft(), ...patch })).status).toBe("blocked"); expect(h.write).not.toHaveBeenCalled();
  });
  it("fresh assignment refusal never attempts either time or lane write", async () => {
    const h = fixture(); h.verifyAssignment.mockResolvedValue(false);
    expect((await h.controller().save(draft())).status).toBe("blocked"); expect(h.write).not.toHaveBeenCalled();
  });
  it.each(["session", "detail", "settings", "assignment", "write", "list"])("scope/focus/generation invalidation at %s suppresses later writes/success", async (stage) => {
    const h = fixture();
    if (stage === "session") h.api.session.mockImplementationOnce(async () => { h.setCurrent(false); return h.actor; });
    if (stage === "detail") h.api.detail.mockImplementationOnce(async () => { h.setCurrent(false); return h.getCanonical(); });
    if (stage === "settings") h.api.settings.mockImplementationOnce(async () => { h.setCurrent(false); return { id: 9, name: "Fixture", timezone: "America/Chicago" }; });
    if (stage === "assignment") h.verifyAssignment.mockImplementation(async () => { h.setCurrent(false); return true; });
    if (stage === "write") h.write.mockImplementation(async () => { h.setCurrent(false); return {}; });
    if (stage === "list") h.onVerified.mockImplementation(async () => { h.setCurrent(false); return true; });
    expect((await h.controller().save(draft())).status).toBe("stale");
    expect(h.write).toHaveBeenCalledTimes(["write", "list"].includes(stage) ? 1 : 0);
    if (stage !== "list") expect(h.onVerified).not.toHaveBeenCalled();
  });
  it("tracks live captured session mutation instead of relying on copied identity", async () => {
    const h = fixture(); h.verifyAssignment.mockImplementation(async () => { h.actor.token = "replaced-token"; return true; });
    expect((await h.controller().save(draft())).status).toBe("stale"); expect(h.write).not.toHaveBeenCalled();
  });
  it.each(["missingAck", "networkAfterCommit", "wrongLane", "wrongTime", "failedGET", "listNotVisible"])("%s stays uncertain, reads without blind retry, requires explicit review", async (failure) => {
    const h = fixture(), original = h.write.getMockImplementation()!;
    if (["missingAck", "networkAfterCommit"].includes(failure)) h.write.mockImplementation(async (...args) => {
      await original(...args); if (failure === "networkAfterCommit") throw new Error("socket gone after commit"); return { unexpected: true };
    });
    if (failure === "wrongLane") h.write.mockImplementation(async (...args) => { const ack = await original(...args); h.setCanonical({ assignedUserId: 50 }); return ack; });
    if (failure === "wrongTime") h.write.mockImplementation(async (...args) => { const ack = await original(...args); h.setCanonical({ scheduledStartAt: "2026-12-01T17:00:00.000Z" }); return ack; });
    if (failure === "failedGET") h.api.detail.mockImplementationOnce(async () => h.getCanonical()).mockRejectedValueOnce(new Error("GET unavailable"));
    if (failure === "listNotVisible") h.onVerified.mockResolvedValue(false);
    const controller = h.controller(); expect((await controller.save(draft())).status).toBe("uncertain");
    expect(h.write).toHaveBeenCalledTimes(1); expect(h.api.detail).toHaveBeenCalledTimes(2);
    expect((await h.controller().save(draft())).status).toBe("blocked");
    expect(companyJobScheduleWriteBlocked(h.actor, h.baseline.id)).toBe(true);
    h.onVerified.mockResolvedValue(true); expect(await controller.refresh()).not.toBeNull();
    expect(companyJobScheduleWriteBlocked(h.actor, h.baseline.id)).toBe(false);
    expect((await controller.save(draft())).status).toBe("blocked"); expect(h.write).toHaveBeenCalledTimes(1);
  });
  it("failed explicit review never unlocks unresolved Job", async () => {
    const h = fixture(); h.write.mockRejectedValue(new Error("unknown"));
    const controller = h.controller(); await controller.save(draft()); h.api.session.mockRejectedValue(new Error("unauthorized"));
    expect(await controller.refresh()).toBeNull(); expect(companyJobScheduleWriteBlocked(h.actor, h.baseline.id)).toBe(true);
  });
});

describe("exact acknowledgment binding", () => {
  const mutation: CompanyJobScheduleMutation = { scheduledStartAt: "2026-12-01T16:00:00.000Z", scheduledEndAt: "2026-12-01T18:00:00.000Z", assignedUserId: null, expectedUpdatedAt: "2026-11-17T15:00:00.000Z" };
  const ack = () => ({ success: true, jobId: 84, assignedUserId: null, scheduledStartAt: mutation.scheduledStartAt, scheduledEndAt: mutation.scheduledEndAt });
  it("accepts actual 66141 fields without fabricated version/Company aliases", () => { expect(verifyCompanyJobScheduleAck(ack(), 84, mutation)).toBe(true); });
  it.each([null, [], {}, { success: true }, { ...ack(), success: 1 }, { ...ack(), jobId: "84" }, { ...ack(), assignedUserId: undefined },
    { ...ack(), assignedUserId: 60 }, { ...ack(), scheduledEndAt: null }, { ...ack(), scheduledStartAt: "2026-12-01T17:00:00Z" },
    { success: true, job_id: 84, assigned_user_id: null, scheduled_start_at: mutation.scheduledStartAt, scheduled_end_at: mutation.scheduledEndAt },
  ])("rejects malformed or unbound payload %j", (payload) => { expect(verifyCompanyJobScheduleAck(payload, 84, mutation)).toBe(false); });
});

// Execute only named declarations from exact supplied source with deny-by-default imports/HTTP/providers.
function load<T>(file: string, names: string[], injected: Record<string, unknown>): T {
  const path = `${BACK}/server/${file}`, source = readFileSync(path, "utf8");
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const declarations = tree.statements.filter((node) => ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.getText(tree)));
  expect(declarations).toHaveLength(names.length);
  const code = ts.transpileModule(declarations.map((node) => node.getText(tree).replace(/^export /, "")).join("\n")
    + `\nglobalThis.actual = {${names.join(",")}};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const denied = () => { throw new Error("Unmocked import/network/provider forbidden"); };
  const context = vm.createContext({ ...injected, Date, Intl, Number, String, Map, Set, JSON, Object, Array, Error, Promise,
    process: { env: Object.freeze({}) }, require: denied, fetch: denied, console: { log: denied } });
  vm.runInContext(code, context, { timeout: 1000 }); return context.actual;
}
class DomainError extends Error { constructor(public code: string, message: string) { super(message); } }
const company = { companyId: 9, userId: 40, role: "owner", timezone: "America/Chicago", permissions: { canManageJobs: true } };
function backendFixture(affectedRows = 1) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const row = { id: 84, customer_id: 7, assigned_user_id: 50, title: "Fixture", status: "scheduled",
    scheduled_start_at: new Date("2026-12-01T15:00:00Z"), scheduled_end_at: new Date("2026-12-01T17:00:00Z"), updated_at: new Date("2026-11-17T15:00:00Z") };
  let commits = 0, rollbacks = 0;
  const db = { async beginTransaction() {}, async commit() { commits++; }, async rollback() { rollbacks++; }, release() {}, async getConnection() { return db; },
    async execute(sql: string, params: unknown[]) {
      calls.push({ sql, params });
      if (sql.startsWith("SELECT id, customer_id")) return [[{ ...row }], []];
      if (sql.startsWith("SELECT users.id")) return [[{ id: params[0] }], []];
      if (sql.startsWith("UPDATE fs_jobs SET scheduled")) {
        if (affectedRows) { row.scheduled_start_at = params[0] as Date; row.scheduled_end_at = params[1] as Date; if (sql.includes("assigned_user_id = ?")) row.assigned_user_id = params[2] as number; }
        return [{ affectedRows }, []];
      }
      if (/^(INSERT|UPDATE)/.test(sql)) return [{ affectedRows: 1, insertId: 1 }, []];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const manager = load<{ requireManager: (...args: unknown[]) => void }>("companyContext.ts", ["requireManager"], { DomainError }).requireManager;
  const service = load<{ rescheduleJob: (...args: unknown[]) => Promise<Record<string, unknown>> }>("jobService.ts",
    ["withTransaction", "ensureCompanyTeamPositions", "createAlert", "insertJobEvent", "optimisticClause", "optimisticParams", "concurrencyMessage", "requireOwnedJob", "requireCalendarEligibleMember", "iso", "closeOpenJobAssignments", "rescheduleJob"],
    { DomainError, requireManager: manager, lockCompanyUserForSchedule: async () => {}, assertStaffAvailableForScheduledStart: async () => {},
      sameAppointmentStart: (a: string, b: string) => Date.parse(a) === Date.parse(b), invalidateAppointmentConfirmation: async () => {}, attemptBookingConfirmationAfterCommit: async () => {}, formatScheduledTime: (value: string) => value }).rescheduleJob;
  return { db, service, calls, row, commits: () => commits, rollbacks: () => rollbacks };
}

describe("read-only exact 66141 contract/source fixtures", () => {
  const mutation = { scheduledStartAt: "2026-12-01T16:00:00.000Z", scheduledEndAt: "2026-12-01T18:00:00.000Z", assignedUserId: 60, expectedUpdatedAt: "2026-11-17T15:00:00.000Z" };
  it("actual REST handler forwards all four fields and its real acknowledgment passes helper", async () => {
    const h = backendFixture(); let ack: unknown;
    const handler = load<{ rescheduleJob: (...args: unknown[]) => Promise<unknown> }>("mobileOperations.ts", ["rescheduleJob"], {
      z, mobileCompany: async () => ({ company, db: h.db }), rescheduleCompanyJob: h.service, operationalError: (_res: unknown, error: unknown) => { throw error; },
    }).rescheduleJob;
    await handler({ params: { jobId: "84" }, body: mutation }, { json: (value: unknown) => { ack = value; } });
    expect(verifyCompanyJobScheduleAck(ack, 84, mutation)).toBe(true);
    const updates = h.calls.filter((call) => call.sql.startsWith("UPDATE fs_jobs SET scheduled"));
    expect(updates).toHaveLength(1); expect(updates[0].sql).toContain("assigned_user_id = ?"); expect(updates[0].sql).toContain("AND updated_at = ?");
    expect((updates[0].params.at(-1) as Date).toISOString()).toBe(mutation.expectedUpdatedAt);
    expect(h.commits()).toBe(1); expect(h.row.assigned_user_id).toBe(60);
  });
  it("actual service stale version rolls back combined request without successful commit", async () => {
    const h = backendFixture(0); await expect(h.service(h.db, company, { jobId: 84, ...mutation })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.commits()).toBe(0); expect(h.rollbacks()).toBe(1); expect(h.row.assigned_user_id).toBe(50);
  });
  it("actual service rejects technician manager edits before any SQL", async () => {
    const h = backendFixture(); await expect(h.service(h.db, { ...company, role: "technician", permissions: { canManageJobs: false } }, { jobId: 84, ...mutation })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.calls).toHaveLength(0);
  });
  function availability(blocks: { start_hour: number; end_hour: number }[]) {
    const calls: { sql: string; params: unknown[] }[] = [];
    const db = { execute: async (sql: string, params: unknown[]) => { calls.push({ sql, params }); return [sql.includes("FROM fs_schedule_blocks") ? blocks : [], []]; } };
    const local = (date: Date, zone: string) => {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
      const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
      return `${read("year")}-${read("month")}-${read("day")}T${read("hour")}:${read("minute")}:00`;
    };
    const checker = load<{ assertStaffAvailableForScheduledStart: (...args: unknown[]) => Promise<unknown> }>("staffAvailability.ts",
      ["scheduledInstant", "companyTimezoneForAvailability", "assertStaffAvailableForScheduledStart"], { DomainError,
        loadCompanyTimezone: async () => "America/Chicago", lockCompanyUserForSchedule: async () => {}, TIME_OFF_APPROVED_AVAILABILITY_SQL: "fixture-time-off",
        TIME_OFF_APPROVED_UNAVAILABLE_MESSAGE: "Fixture time off", companyLocalDate: (date: Date, zone: string) => local(date, zone).slice(0, 10), companyLocalDateTime: local }).assertStaffAvailableForScheduledStart;
    return { db, checker, calls };
  }
  it("actual backend daytime all-day blocker remains enforced", async () => {
    const h = availability([{ start_hour: 0, end_hour: 24 }]); await expect(h.checker(h.db, company, 50, "2026-12-01T15:00:00.000Z", { lockStaff: false, scheduledEndAt: "2026-12-01T17:00:00.000Z" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("BACKEND BLOCKER reproduced: all-day row is bypassed when interval ends at Company midnight (not fixed)", async () => {
    const h = availability([{ start_hour: 0, end_hour: 24 }]); await h.checker(h.db, company, 50, "2026-12-02T05:00:00.000Z", { lockStaff: false, scheduledEndAt: "2026-12-02T06:00:00.000Z" });
    expect(h.calls.find((call) => call.sql.includes("FROM fs_schedule_blocks"))?.params[2]).toBe("2026-12-01");
  });
});
