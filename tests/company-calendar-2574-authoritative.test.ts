import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  companyJobScheduleInstant, companyJobScheduleWriteBlocked,
  createCompanyJobScheduleUpdateController, verifyCompanyJobScheduleAck,
  type CompanyJobScheduleMutation, type CompanyJobScheduleSnapshot,
} from "../lib/company-job-schedule-update";
import { normalizeJobSyncCompanyJobDetail, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";

const BACK = "/home/ubuntu/hsc-authoritative-mobile-reconciliation-20261117/backend-source-2574fb8d";
const MOBILE = "/home/ubuntu/home-service-connection-app";
const sourceHashes = new Map<string, string>();
type Row = Record<string, any>;
type Callable = (...args: any[]) => any;
/** Extract exact named declarations only; never import/bootstrap the backend or open a socket. */
function load(path: string, names: string[], injected: Row = {}): Row {
  const source = readFileSync(path, "utf8");
  sourceHashes.set(path, createHash("sha256").update(source).digest("hex"));
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const chunks: string[] = [];
  const found: string[] = [];
  for (const node of tree.statements) {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name && names.includes(node.name.text)) {
      chunks.push(node.getText(tree).replace(/^export /, "")); found.push(node.name.text);
    } else if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && names.includes(declaration.name.text)) {
          chunks.push(`const ${declaration.getText(tree)};`); found.push(declaration.name.text);
        }
      }
    }
  }
  if (names.some((name) => !found.includes(name))) throw new Error(`Missing exact declaration in ${path}: ${names.filter((name) => !found.includes(name))}`);
  const deny = () => { throw new Error("Unmocked import/network/provider forbidden"); };
  const context = vm.createContext({ ...injected, Date, Intl, Number, String, Map, Set, JSON, Object, Array, Error, Promise,
    process: { env: Object.freeze({}) }, require: deny, fetch: deny, console: { log: deny } });
  const code = ts.transpileModule(chunks.join("\n") + `\nglobalThis.actual = {${names.join(",")}};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInContext(code, context, { timeout: 1000 });
  return context.actual;
}
const server = (file: string, names: string[], injected: Row = {}) => load(`${BACK}/server/${file}`, names, injected);
const domain = server("domainErrors.ts", ["DomainError", "domainHttpStatus", "domainMobileCode"]);
const zones = load(`${BACK}/shared/companyTimezones.ts`, ["COMPANY_TIMEZONE_OPTIONS", "isSupportedCompanyTimezone"]);
const context = server("companyContext.ts", ["DEFAULT_COMPANY_TIMEZONE", "isCompanyRole", "isManagerRole", "permissionsForRole", "normalizeCompanyTimezone", "createCompanyContext", "companyContextFromMobile", "loadCompanyTimezone", "requireManager", "technicianScopeSql"], { ...domain, ...zones });
const timezone = server("companyTimezoneModel.ts", ["part", "companyLocalParts", "companyLocalDate", "companyLocalDateTime", "isBusinessDate", "timezoneOffsetMs", "companyLocalWallTimeToUtc"], { ...context, DATE_ONLY: /^\d{4}-\d{2}-\d{2}$/ });
const timeOff = load(`${BACK}/shared/timeOffAuthority.ts`, ["TIME_OFF_STAFF_LOCK_SQL", "TIME_OFF_APPROVED_AVAILABILITY_SQL", "TIME_OFF_APPROVED_UNAVAILABLE_MESSAGE"]);
const availability = server("staffAvailability.ts", ["scheduledInstant", "addLocalDate", "localSeconds", "foldBoundary", "companyLocalIntervalSegments", "companyTimezoneForAvailability", "lockCompanyUserForSchedule", "assertStaffAvailableForScheduledStart"], { ...domain, ...context, ...timezone, ...timeOff });
const appointment = server("appointmentConfirmation.ts", ["appointmentStartUnix", "sameAppointmentStart", "isAppointmentConfirmed", "confirmationStatusFromJob", "confirmationProjection"]);
const dto = server("mobileCompanyJobDto.ts", ["asNumber", "asNullableInt", "asIso", "firstNonEmptyString", "projectMobileCompanyJob"]);
class MobileAuthError extends Error { constructor(public status: number, message: string) { super(message); } }
const errors = server("mobileOperations.ts", ["mobileErrorStatus", "mobileTrpcError", "operationalError"], { ...domain, z });

let nextJob = 257400;
function fixture(options: { zone?: string; role?: string; failAt?: string; affectedRows?: number } = {}) {
  const id = ++nextJob;
  let state: Row = {
    job: { id, company_id: 9, customer_id: 7, assigned_user_id: 50, title: "Calendar fixture", service_name: "Test service", status: "scheduled",
      scheduled_start_at: new Date("2026-12-01T15:00:00Z"), scheduled_end_at: new Date("2026-12-01T17:00:00Z"), updated_at: new Date("2026-11-17T15:00:00Z"),
      amount: 100, subtotal_amount: 100, discount_amount: 0, tax_amount: 0, tax_rate_bps: 0, address_line1: "Fixture street", customer_name: "Fixture", customer_notification_enabled: 0 },
    assignments: [{ company_id: 9, job_id: id, user_id: 50, unassigned_at: null }], events: [], alerts: [], invalidations: [],
  };
  let snapshot: Row | null = null;
  const calls: { sql: string; params: any[] }[] = [], order: string[] = [];
  let commits = 0, rollbacks = 0;
  const blocks: Row[] = [], requests: Row[] = [];
  let claims: Row = { accountType: "company", accountId: 40, companyId: 9, role: "owner", name: "Fixture" };
  let liveRole = options.role ?? "owner", active = true;
  const members: Row[] = [
    { id: 40, company_id: 9, is_active: 1 }, { id: 50, company_id: 9, is_active: 1, eligible: true },
    { id: 60, company_id: 9, is_active: 1, eligible: true }, { id: 61, company_id: 9, is_active: 0, eligible: true },
    { id: 62, company_id: 9, is_active: 1, eligible: false }, { id: 70, company_id: 10, is_active: 1, eligible: true },
  ];
  const db = {
    async getConnection() { return db; },
    async beginTransaction() { snapshot = structuredClone(state); order.push("begin"); },
    async commit() { commits++; snapshot = null; order.push("commit"); },
    async rollback() { rollbacks++; if (snapshot) state = snapshot; snapshot = null; order.push("rollback"); },
    release() { order.push("release"); },
    async execute(sql: string, params: any[] = []): Promise<any> {
      calls.push({ sql, params });
      if (options.failAt && sql.includes(options.failAt)) throw new Error("Isolated transactional SQL failure");
      if (sql.includes("FROM company_users cu JOIN companies c")) {
        const member = members.find((row) => row.id === params[0] && row.company_id === params[1]);
        return [[...(active && member ? [{ ...member, role: liveRole, member_id: "fixture", company_name: "Fixture", company_slug: "fixture" }] : [])], []];
      }
      if (sql === "SELECT timezone FROM companies WHERE id = ? LIMIT 1") return [[{ timezone: params[0] === 9 ? options.zone ?? "America/Chicago" : "America/New_York" }], []];
      if (sql === timeOff.TIME_OFF_STAFF_LOCK_SQL) return [members.filter((row) => row.company_id === params[0] && row.id === params[1]), []];
      if (sql === timeOff.TIME_OFF_APPROVED_AVAILABILITY_SQL) return [requests.filter((row) => row.company_id === params[0] && row.user_id === params[1] && row.request_status === "approved" && row.start_date <= params[2] && row.end_date >= params[3]).slice(0, 1), []];
      if (sql.includes("FROM fs_schedule_blocks")) return [blocks.filter((row) => row.company_id === params[0] && row.employee_user_id === params[1] && row.block_date === params[2]), []];
      if (sql.startsWith("SELECT users.id")) return [members.filter((row) => row.id === params[0] && row.company_id === params[1] && row.is_active === 1 && row.eligible), []];
      if (sql.startsWith("INSERT IGNORE INTO company_team_positions") || sql.startsWith("UPDATE company_users users")) return [{ affectedRows: 0 }, []];
      if (sql.startsWith("SELECT id, customer_id") || sql.includes("SELECT j.*, CONCAT(c.first_name")) return [[...(state.job.id === params[0] && state.job.company_id === params[1] ? [structuredClone(state.job)] : [])], []];
      if (sql.startsWith("UPDATE fs_jobs SET scheduled")) {
        const assign = sql.includes("assigned_user_id = ?"), offset = assign ? 3 : 2;
        const matches = state.job.id === params[offset] && state.job.company_id === params[offset + 1]
          && (!sql.includes("AND updated_at = ?") || state.job.updated_at.getTime() === params.at(-1).getTime());
        const affected = matches && options.affectedRows !== 0;
        if (affected) {
          state.job.scheduled_start_at = params[0]; state.job.scheduled_end_at = params[1];
          if (assign) state.job.assigned_user_id = params[2];
          state.job.updated_at = new Date("2026-11-17T15:01:00Z");
        }
        return [{ affectedRows: affected ? 1 : 0 }, []];
      }
      if (sql.startsWith("UPDATE fs_job_assignments")) { state.assignments.forEach((row: Row) => { if (row.company_id === params[0] && row.job_id === params[1] && row.unassigned_at === null) row.unassigned_at = "closed"; }); return [{ affectedRows: 1 }, []]; }
      if (sql.startsWith("INSERT INTO fs_job_assignments")) { state.assignments.push({ company_id: params[0], job_id: params[1], user_id: params[2], unassigned_at: null }); return [{ insertId: 2 }, []]; }
      if (sql.startsWith("INSERT INTO fs_alerts")) { state.alerts.push(params); return [{ insertId: 1 }, []]; }
      if (sql.startsWith("INSERT INTO fs_job_events")) { state.events.push(params); return [{ insertId: 1 }, []]; }
      // Unrelated canonical-detail projections are empty, never real SQL/providers.
      if (sql.includes("FROM fs_job_events") || sql.includes("FROM fs_job_payments") || sql.includes("FROM fs_inventory_transactions") || sql.includes("FROM fs_job_photos") || sql.includes("FROM fs_job_site_inspections") || sql.includes("FROM fs_job_line_items") || sql.includes("FROM fs_company_email_deliveries")) return [[], []];
      throw new Error(`Unexpected SQL denied: ${sql}`);
    },
  };
  const postCommit = vi.fn(async () => { order.push("fake booking after commit"); });
  const service = server("jobService.ts", ["withTransaction", "ensureCompanyTeamPositions", "createAlert", "insertJobEvent", "optimisticClause", "optimisticParams", "concurrencyMessage", "requireOwnedJob", "requireCalendarEligibleMember", "iso", "toNumber", "formatScheduledTime", "closeOpenJobAssignments", "rescheduleJob", "getJob", "getJobDetail", "mapListedJob"], {
    ...domain, ...context, ...availability, ...appointment,
    invalidateAppointmentConfirmation: async (_db: unknown, _company: unknown, jobId: number) => { state.invalidations.push(jobId); },
    attemptBookingConfirmationAfterCommit: postCommit, recurrenceLabelFromParts: () => null,
    latestBookingCommunicationOutcome: async () => ({ status: "suppressed" }),
    getJobPaymentBalance: async () => ({ jobTotal: 100, paid: 0, refundTotal: 0, appliedEstimateCredit: 0, balance: 100, paymentStatus: "unpaid" }),
    firstLifecycleTimestamps: () => ({}), effectiveLifecycleTimestamps: () => ({}), lifecycleTimingOverrideForJob: async () => null,
    formatServiceName: (value: string) => value,
  });
  const auth = server("mobileAuth.ts", ["mobileBearerToken", "withLiveMembershipRole", "companyProfile", "requireMobileCompany"], {
    MobileAuthError, getDb: async () => db, verifyMobileAccessToken: async (token: string) => { if (token !== "isolated-calendar-token") throw new MobileAuthError(401, "Invalid test bearer"); return structuredClone(claims); },
    mobileDate: () => null, signedStorageUrlFromStoredUrl: () => null,
  });
  const handlers = server("mobileOperations.ts", ["mobileCompany", "rescheduleJob", "jobDetail", "iso"], { ...context, ...errors, ...dto, ...domain, z,
    requireMobileCompany: auth.requireMobileCompany, rescheduleCompanyJob: service.rescheduleJob, getJobDetail: service.getJobDetail, signedStorageUrlFromStoredUrl: () => null });
  async function request(handler: Callable, body?: unknown, bearer = "Bearer isolated-calendar-token") {
    let status = 200, payload: any;
    const res = { status(value: number) { status = value; return res; }, json(value: unknown) { payload = value; return value; } };
    await handler({ params: { jobId: String(id) }, body, header: () => bearer }, res);
    return { status, payload };
  }
  const writer = load(`${MOBILE}/lib/jobsync-mobile-api.ts`, ["updateJobSyncCompanyJobSchedule", "validCompanyJobId", "requireJobSyncMutationToken", "serverInstant", "positiveJobSyncId", "createJobSyncBearerHeaders"], {
    COMPANY_JOBS_PATH: "/api/mobile/v1/company/jobs",
    requestJson: async (path: string, init: Row) => {
      expect(path).toBe(`/api/mobile/v1/company/jobs/${id}/schedule`); expect(init.method).toBe("PATCH");
      const result = await request(handlers.rescheduleJob, JSON.parse(init.body), init.headers.Authorization);
      if (result.status !== 200) throw Object.assign(new Error(result.payload.error.message), result.payload.error);
      return result.payload;
    },
  }).updateJobSyncCompanyJobSchedule;
  const company = context.createCompanyContext({ companyId: 9, userId: 40, role: liveRole, timezone: options.zone });
  return { id, db, blocks, requests, members, calls, order, service, company, handlers, request, writer, postCommit,
    state: () => state, commits: () => commits, rollbacks: () => rollbacks,
    setClaims: (patch: Row) => { claims = { ...claims, ...patch }; }, setRole: (role: string) => { liveRole = role; }, setActive: (value: boolean) => { active = value; },
    check: (start: string, end: string, member = 50) => availability.assertStaffAvailableForScheduledStart(db, company, member, start, { scheduledEndAt: end }),
    block: (date: string, startHour = 0, endHour = 24, companyId = 9, member = 50) => blocks.push({ company_id: companyId, employee_user_id: member, block_date: date, start_hour: startHour, end_hour: endHour }),
    off: (date: string, status = "approved", companyId = 9, member = 50) => requests.push({ company_id: companyId, user_id: member, start_date: date, end_date: date, request_status: status }),
    detail: async () => {
      const result = await request(handlers.jobDetail);
      if (result.status !== 200) throw new Error("Canonical GET rejected");
      // Express JSON -> requestJson has a serialization boundary; VM prototypes are not wire data.
      const value = normalizeJobSyncCompanyJobDetail(JSON.parse(JSON.stringify(result.payload)), id, 9);
      if (!value) throw new Error("Canonical mobile normalization failed");
      return value;
    },
  };
}
const mutation = (assignedUserId: number | null = 60): CompanyJobScheduleMutation => ({ scheduledStartAt: "2026-12-01T16:00:00.000Z", scheduledEndAt: "2026-12-01T18:00:00.000Z", assignedUserId, expectedUpdatedAt: "2026-11-17T15:00:00.000Z" });
beforeEach(() => { vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Real HTTP forbidden")); });
afterEach(() => { vi.restoreAllMocks(); });

describe("2574 actual multi-date availability acceptance (failures remain requirements)", () => {
  it("closes historical midnight-ending all-day bypass", async () => {
    const h = fixture(); h.block("2026-12-01");
    await expect(h.check("2026-12-02T05:00:00Z", "2026-12-02T06:00:00Z")).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it.each(["2026-12-01", "2026-12-02"])("midnight-spanning block on %s rejects", async (date) => {
    const h = fixture(); h.block(date);
    await expect(h.check("2026-12-02T05:00:00Z", "2026-12-02T07:00:00Z")).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it.each(["2026-12-01", "2026-12-02"])("approved time off on %s rejects spanning appointment", async (date) => {
    const h = fixture(); h.off(date);
    await expect(h.check("2026-12-02T05:00:00Z", "2026-12-02T07:00:00Z")).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("midnight-start checks next local date only", async () => {
    const h = fixture(); h.block("2026-12-01"); await h.check("2026-12-02T06:00:00Z", "2026-12-02T07:00:00Z");
    expect(h.calls.filter((call) => call.sql.includes("FROM fs_schedule_blocks")).map((call) => call.params[2])).toEqual(["2026-12-02"]);
    h.block("2026-12-02"); await expect(h.check("2026-12-02T06:00:00Z", "2026-12-02T07:00:00Z")).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("exclusive midnight end does not query next date", async () => {
    const h = fixture(); h.off("2026-12-02"); h.block("2026-12-02");
    await h.check("2026-12-02T05:00:00Z", "2026-12-02T06:00:00Z");
    expect(h.calls.filter((call) => call.sql === timeOff.TIME_OFF_APPROVED_AVAILABILITY_SQL).map((call) => call.params[2])).toEqual(["2026-12-01"]);
  });
  it("enumerates every intersected local date including intermediate all-day date", async () => {
    const h = fixture(); await h.check("2026-12-02T05:00:00Z", "2026-12-04T07:00:00Z");
    expect(h.calls.filter((call) => call.sql.includes("FROM fs_schedule_blocks")).map((call) => call.params[2])).toEqual(["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"]);
    h.block("2026-12-03", 13, 14); await expect(h.check("2026-12-02T05:00:00Z", "2026-12-04T07:00:00Z")).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it.each([[8, 9, false], [11, 12, false], [9, 10, true], [10.99, 12, true], [0, 24, true]])("block %s-%s positive overlap=%s", async (start, end, overlaps) => {
    const h = fixture(); h.block("2026-12-01", start as number, end as number);
    const call = h.check("2026-12-01T15:00:00Z", "2026-12-01T17:00:00Z");
    if (overlaps) await expect(call).rejects.toMatchObject({ code: "CONFLICT" }); else await expect(call).resolves.toBeUndefined();
  });
  it.each(["pending", "denied"])("%s time off is not scheduling unavailability", async (status) => {
    const h = fixture(); h.off("2026-12-02", status); await h.check("2026-12-02T05:00:00Z", "2026-12-02T07:00:00Z");
  });
  it.each([[10, 50], [9, 60]])("blocks/time off Company %s member %s cannot leak", async (companyId, member) => {
    const h = fixture(); h.block("2026-12-02", 0, 24, companyId, member); h.off("2026-12-02", "approved", companyId, member);
    await h.check("2026-12-02T05:00:00Z", "2026-12-02T07:00:00Z");
    expect(h.calls.find((call) => call.sql === timeOff.TIME_OFF_STAFF_LOCK_SQL)?.params).toEqual([9, 50]);
    for (const call of h.calls.filter((value) => value.sql.includes("FROM fs_schedule_blocks") || value.sql === timeOff.TIME_OFF_APPROVED_AVAILABILITY_SQL)) expect(call.params.slice(0, 2)).toEqual([9, 50]);
  });
  it.each([["2026-03-08T06:00:00Z", "2026-03-09T05:00:00Z", "2026-03-08", 23], ["2026-11-01T05:00:00Z", "2026-11-02T06:00:00Z", "2026-11-01", 25]])("Company DST day %s-%s checks full local day", async (start, end, date, hours) => {
    const h = fixture(); expect((Date.parse(end as string) - Date.parse(start as string)) / 3_600_000).toBe(hours);
    h.block(date as string, 23, 24); await expect(h.check(start as string, end as string)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("America/New_York Company date is not phone or Chicago date", async () => {
    const h = fixture({ zone: "America/New_York" }); h.block("2026-12-02", 0, 1);
    await expect(h.check("2026-12-02T05:00:00Z", "2026-12-02T06:00:00Z")).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it.each([["bad", "2026-12-01T17:00:00Z"], ["2026-12-01T17:00:00Z", "2026-12-01T17:00:00Z"], ["2026-12-01T18:00:00Z", "2026-12-01T17:00:00Z"]])("invalid/nonpositive interval %s-%s rejects", async (start, end) => {
    const h = fixture(); await expect(h.check(start, end)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("REQUIREMENT: fall-fold decreasing wall times still reject all-day block", async () => {
    const h = fixture(); h.block("2026-11-01");
    await expect(h.check("2026-11-01T06:50:00Z", "2026-11-01T07:10:00Z")).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("REQUIREMENT: fall-fold decreasing wall times still check approved time off", async () => {
    const h = fixture(); h.off("2026-11-01");
    await expect(h.check("2026-11-01T06:50:00Z", "2026-11-01T07:10:00Z")).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("REQUIREMENT: fold traversal includes wall minutes outside endpoint envelope", async () => {
    const h = fixture(); h.block("2026-11-01", 1.8, 1.9);
    await expect(h.check("2026-11-01T06:15:00Z", "2026-11-01T07:45:00Z")).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("REQUIREMENT: end 30 seconds after midnight intersects next time-off date", async () => {
    const h = fixture(); h.off("2026-12-02");
    await expect(h.check("2026-12-02T05:00:00Z", "2026-12-02T06:00:30Z")).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("REQUIREMENT: seconds of positive overlap cannot be discarded at block boundary", async () => {
    const h = fixture(); h.block("2026-12-01", 10, 11);
    await expect(h.check("2026-12-01T15:59:30Z", "2026-12-01T16:00:30Z")).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("2574 atomic mobile handler/service acknowledgment and authority", () => {
  it.each(["owner", "dispatcher"])("fresh live %s commits time/lane/version/history/event once", async (role) => {
    const h = fixture({ role }); const input = mutation();
    const result = await h.request(h.handlers.rescheduleJob, input);
    expect(result.status).toBe(200); expect(verifyCompanyJobScheduleAck(result.payload, h.id, input)).toBe(true);
    expect(Object.keys(result.payload).sort()).toEqual(["success", "jobId", "assignedUserId", "scheduledStartAt", "scheduledEndAt"].sort());
    const updates = h.calls.filter((call) => call.sql.startsWith("UPDATE fs_jobs SET scheduled"));
    expect(updates).toHaveLength(1); expect(updates[0].sql).toContain("assigned_user_id = ?"); expect(updates[0].sql).toContain("AND updated_at = ?");
    expect(updates[0].params.at(-1).toISOString()).toBe(input.expectedUpdatedAt);
    expect(h.state().job.assigned_user_id).toBe(60); expect(h.commits()).toBe(1); expect(h.state().assignments).toHaveLength(2);
    expect(h.state().alerts).toHaveLength(1); expect(h.state().events).toHaveLength(1);
    expect(h.order.indexOf("commit")).toBeLessThan(h.order.indexOf("fake booking after commit"));
    const detail = await h.detail(); expect(detail.assignedUserId).toBe(60); expect(detail.updatedAt).toBe("2026-11-17T15:01:00.000Z");
    expect(detail.scheduledEndAt).toBe(input.scheduledEndAt);
    const listed = dto.projectMobileCompanyJob(h.service.mapListedJob(h.state().job));
    for (const field of ["id", "assignedUserId", "scheduledStartAt", "scheduledEndAt", "updatedAt"])
      expect(listed[field]).toBe((detail as unknown as Row)[field]);
  });
  it.each([50, null])("unchanged/explicit-null lane %s remains canonical", async (member) => {
    const h = fixture(); const input = mutation(member); const result = await h.request(h.handlers.rescheduleJob, input);
    expect(result.status).toBe(200); expect(verifyCompanyJobScheduleAck(result.payload, h.id, input)).toBe(true);
    expect(h.state().job.assigned_user_id).toBe(member); expect(h.state().alerts).toHaveLength(0);
    expect((await h.detail()).assignedUserId).toBe(member);
  });
  it("stale version changes neither time/lane/version/history/event/alerts", async () => {
    const h = fixture(); const before = structuredClone(h.state());
    const result = await h.request(h.handlers.rescheduleJob, { ...mutation(), expectedUpdatedAt: "2026-11-17T14:00:00Z" });
    expect(result.status).toBe(409); expect(result.payload.error.code).toBe("CONFLICT"); expect(h.state()).toEqual(before);
    expect(h.rollbacks()).toBe(1); expect(h.commits()).toBe(0); expect(h.postCommit).not.toHaveBeenCalled();
  });
  it.each(["block", "off"])("new-assignee second-date %s conflict is atomic", async (kind) => {
    const h = fixture(); if (kind === "block") h.block("2026-12-02", 0, 24, 9, 60); else h.off("2026-12-02", "approved", 9, 60);
    const before = structuredClone(h.state()); const result = await h.request(h.handlers.rescheduleJob, { ...mutation(), scheduledStartAt: "2026-12-02T05:00:00Z", scheduledEndAt: "2026-12-02T07:00:00Z" });
    expect(result.status).toBe(409); expect(h.state()).toEqual(before); expect(h.commits()).toBe(0); expect(h.postCommit).not.toHaveBeenCalled();
  });
  it.each(["INSERT INTO fs_job_assignments", "INSERT INTO fs_alerts", "INSERT INTO fs_job_events"])("failure at %s rolls back the whole combined edit", async (failAt) => {
    const h = fixture({ failAt }); const before = structuredClone(h.state());
    const result = await h.request(h.handlers.rescheduleJob, mutation());
    expect(result.status).not.toBe(200); expect(h.state()).toEqual(before); expect(h.rollbacks()).toBe(1); expect(h.commits()).toBe(0); expect(h.postCommit).not.toHaveBeenCalled();
  });
  it("live technician role overrides owner JWT and denies before Job SQL", async () => {
    const h = fixture({ role: "technician" }); const before = structuredClone(h.state());
    const result = await h.request(h.handlers.rescheduleJob, mutation());
    expect(result.status).toBe(403); expect(h.state()).toEqual(before); expect(h.calls.filter((call) => call.sql.includes("fs_jobs"))).toHaveLength(0);
  });
  it("live owner role overrides technician JWT", async () => {
    const h = fixture(); h.setClaims({ role: "technician" }); expect((await h.request(h.handlers.rescheduleJob, mutation())).status).toBe(200);
  });
  it.each(["missingBearer", "inactive", "crossMembership", "platform"])("%s cannot mutate", async (kind) => {
    const h = fixture(); const before = structuredClone(h.state());
    if (kind === "inactive") h.setActive(false); if (kind === "crossMembership") h.setClaims({ companyId: 10 }); if (kind === "platform") h.setClaims({ accountType: "platform_admin" });
    const result = await h.request(h.handlers.rescheduleJob, mutation(), kind === "missingBearer" ? "" : undefined);
    expect([401, 403]).toContain(result.status); expect(h.state()).toEqual(before); expect(h.commits()).toBe(0);
  });
  it("tenant-owned actor cannot update another Company's Job", async () => {
    const h = fixture(); h.state().job.company_id = 10; const before = structuredClone(h.state());
    expect((await h.request(h.handlers.rescheduleJob, mutation())).status).toBe(404); expect(h.state()).toEqual(before);
  });
  it.each([61, 62, 70])("inactive/ineligible/foreign member %s is refused atomically", async (member) => {
    const h = fixture(); const before = structuredClone(h.state());
    expect((await h.request(h.handlers.rescheduleJob, mutation(member))).status).toBe(404); expect(h.state()).toEqual(before); expect(h.commits()).toBe(0);
  });
  it.each([{ scheduledStartAt: "bad" }, { expectedUpdatedAt: "bad" }, { assignedUserId: "60" }, { assignedUserId: -1 }, { scheduledEndAt: "2026-12-01T15:00:00Z" }])("actual schema rejects %j without commit", async (patch) => {
    const h = fixture(); const before = structuredClone(h.state()); expect((await h.request(h.handlers.rescheduleJob, { ...mutation(), ...patch })).status).toBe(400); expect(h.state()).toEqual(before);
  });
  it("omitted end differs from null; omitted assignment ack cannot establish full mobile intent", async () => {
    const h = fixture(); const result = await h.request(h.handlers.rescheduleJob, { scheduledStartAt: mutation().scheduledStartAt, expectedUpdatedAt: mutation().expectedUpdatedAt });
    expect(result.status).toBe(200); expect(result.payload.scheduledEndAt).toBe("2026-12-01T18:00:00.000Z"); expect(result.payload.assignedUserId).toBeUndefined(); expect(h.state().job.assigned_user_id).toBe(50);
    expect(verifyCompanyJobScheduleAck(result.payload, h.id, mutation(50))).toBe(false);
    const n = fixture(); const nullable = await n.request(n.handlers.rescheduleJob, { ...mutation(50), scheduledEndAt: null });
    expect(nullable.status).toBe(200); expect(n.state().job.scheduled_end_at).toBeNull();
  });
  it("actual supported zones exclude Lord Howe; normalize would silently choose Chicago", () => {
    expect(zones.isSupportedCompanyTimezone("Australia/Lord_Howe")).toBe(false); expect(context.normalizeCompanyTimezone("Australia/Lord_Howe")).toBe("America/Chicago");
  });
  it("REQUIREMENT: atomic handler must not acknowledge a fold-overlapping unavailable assignment", async () => {
    const h = fixture(); h.block("2026-11-01", 0, 24, 9, 60); const before = structuredClone(h.state());
    const result = await h.request(h.handlers.rescheduleJob, { ...mutation(), scheduledStartAt: "2026-11-01T06:50:00Z", scheduledEndAt: "2026-11-01T07:10:00Z" });
    expect(result.status).toBe(409); expect(h.state()).toEqual(before); expect(h.commits()).toBe(0);
  });
});

function controllerFixture(role = "owner") {
  const h = fixture({ role }); let current = true;
  const session: JobSyncNativeSession = { token: "isolated-calendar-token", portal: "company", user: { id: 40, role: role as "owner", name: "Fixture", email: null }, company: { id: 9, name: "Fixture", slug: "fixture", logoUrl: null, primaryColor: null, accentColor: null } };
  const baseline: CompanyJobScheduleSnapshot = { id: h.id, companyId: 9, assignedUserId: 50, updatedAt: mutation().expectedUpdatedAt, date: "2026-12-01", startHour: 9, endHour: 11 };
  const api = { session: vi.fn(async () => structuredClone(session)), detail: vi.fn(h.detail), settings: vi.fn(async () => ({ id: 9, name: "Fixture", timezone: "America/Chicago" })) };
  const write = vi.fn(h.writer), onVerified = vi.fn(async (detail) => { const canonical = await h.detail(); return canonical.updatedAt === detail.updatedAt && canonical.assignedUserId === detail.assignedUserId; });
  const options = { session, baseline, isCurrent: () => current, verifyAssignment: vi.fn(async () => true), write, api, onVerified };
  return { ...h, api, write, onVerified, session, options, controller: () => createCompanyJobScheduleUpdateController(options), setCurrent: (value: boolean) => { current = value; } };
}
const draft = () => ({ date: "2026-12-01", startHour: 10, endHour: 12, assignedUserId: 60 });
describe("actual mobile helper + existing adapter + 2574 handler/service", () => {
  it.each(["owner", "dispatcher"])("%s verified canonical detail and parent readback precede saved", async (role) => {
    const h = controllerFixture(role); expect((await h.controller().save(draft())).status).toBe("saved"); expect(h.write).toHaveBeenCalledTimes(1); expect(h.onVerified).toHaveBeenCalledTimes(1); expect(h.api.detail).toHaveBeenCalledTimes(2);
  });
  it.each(["missingAck", "lostResponse", "listFailure", "GETFailure"])("%s is uncertain and explicit review is GET-only", async (failure) => {
    const h = controllerFixture(), writer = h.write.getMockImplementation()!;
    if (failure === "missingAck" || failure === "lostResponse") h.write.mockImplementation(async (...args: any[]) => { await writer(...args); if (failure === "lostResponse") throw new Error("Lost after commit"); return {}; });
    if (failure === "listFailure") h.onVerified.mockResolvedValue(false);
    if (failure === "GETFailure") h.api.detail.mockImplementationOnce(h.detail).mockRejectedValueOnce(new Error("GET failed"));
    const c = h.controller(); expect((await c.save(draft())).status).toBe("uncertain"); expect(h.write).toHaveBeenCalledTimes(1); expect(h.commits()).toBe(1);
    expect(companyJobScheduleWriteBlocked(h.session, h.id)).toBe(true); expect((await h.controller().save(draft())).status).toBe("blocked");
    h.onVerified.mockResolvedValue(true); expect(await c.refresh()).not.toBeNull(); expect(h.write).toHaveBeenCalledTimes(1); expect((await c.save(draft())).status).toBe("blocked");
  });
  it("scope interruption after commit never acknowledges saved; review never resends", async () => {
    const h = controllerFixture(), writer = h.write.getMockImplementation()!;
    h.write.mockImplementation(async (...args: any[]) => { const ack = await writer(...args); h.setCurrent(false); return ack; });
    const c = h.controller(); expect((await c.save(draft())).status).toBe("stale"); expect(h.write).toHaveBeenCalledTimes(1); expect(h.commits()).toBe(1);
    h.setCurrent(true); expect(await c.refresh()).not.toBeNull(); expect(h.write).toHaveBeenCalledTimes(1);
  });
  it("operation-lifetime Job lock blocks duplicate controller before first await", async () => {
    const h = controllerFixture(); let release!: () => void;
    h.api.session.mockImplementationOnce(async () => { await new Promise<void>((resolve) => { release = resolve; }); return h.session; });
    const saving = h.controller().save(draft()); expect((await h.controller().save(draft())).status).toBe("blocked"); release(); expect((await saving).status).toBe("saved"); expect(h.write).toHaveBeenCalledTimes(1);
  });
  it.each([["2026-03-08", 2.5, "America/Chicago", /does not exist/], ["2026-11-01", 1.5, "America/Chicago", /repeats/], ["2026-04-05", 1.75, "Australia/Lord_Howe", /repeats/], ["2026-10-04", 2.25, "Australia/Lord_Howe", /does not exist/]])("mobile strict date %s/%s %s rejects ambiguous or absent times (not supported backend zone evidence)", (date, hour, zone, error) => {
    expect(() => companyJobScheduleInstant(date as string, hour as number, zone as string)).toThrow(error as RegExp);
  });
  it("records exact source provenance and never uses global HTTP", () => {
    expect(sourceHashes.has(`${BACK}/server/staffAvailability.ts`)).toBe(true); expect(sourceHashes.has(`${BACK}/server/jobService.ts`)).toBe(true); expect(sourceHashes.has(`${BACK}/server/mobileOperations.ts`)).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("2574 authoritative boundary gates beyond the endpoint-envelope repair", () => {
  it("pins exact target source identities", () => {
    const revision = JSON.parse(readFileSync(`${BACK}/../backend-revision.json`, "utf8"));
    expect(revision.sha).toBe("2574fb8df702cb57bdb2e9317aba7b7fe7fe5e77");
    expect(sourceHashes.get(`${BACK}/server/staffAvailability.ts`)).toBe("3c4cf10851200c4af326b9af7c985294275b5ec71d163c501c7bbf829603de2b");
    expect(sourceHashes.get(`${BACK}/server/jobService.ts`)).toBe("66df430fbd54c15680d519f1c42ad99bb9e75540e010ff1eca00fde9d53c60d7");
    expect(sourceHashes.get(`${BACK}/server/mobileOperations.ts`)).toBe("aa01500ab18c399be345e53d8ec56b72b52ba6bc8e046c66268ba2d8d2e869fc");
  });
  it("REQUIREMENT: positive equal-clock fold interval still checks approved time off", async () => {
    const h = fixture(); h.off("2026-11-01");
    await expect(h.check("2026-11-01T06:30:00Z", "2026-11-01T07:30:00Z")).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("REQUIREMENT: fractional-second positive interval cannot bypass an all-day block", async () => {
    const h = fixture(); h.block("2026-12-01");
    await expect(h.check("2026-12-01T15:00:00.100Z", "2026-12-01T15:00:00.900Z")).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("REQUIREMENT: atomic reschedule cannot commit a blocked portion outside the fold endpoint envelope", async () => {
    const h = fixture(); h.block("2026-11-01", 1.8, 1.9, 9, 60); const before = structuredClone(h.state());
    const result = await h.request(h.handlers.rescheduleJob, { ...mutation(), scheduledStartAt: "2026-11-01T06:15:00Z", scheduledEndAt: "2026-11-01T07:45:00Z" });
    expect(result.status).toBe(409); expect(h.state()).toEqual(before); expect(h.commits()).toBe(0);
  });
});
