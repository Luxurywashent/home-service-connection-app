import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

export const BACK = "/home/ubuntu/hsc-mobile-752ccca3-compatibility-20261117/backend-source-752ccca3";
export const REVISION = "752ccca3edf69ef35ca7b1a470484f3f204f4568";
export const sourceHashes = new Map<string, string>();
export type Row = Record<string, any>;
type Callable = (...args: any[]) => any;

/** Execute only named actual declarations. Backend bootstrap/imports and all I/O are forbidden. */
export function load(path: string, names: string[], injected: Row = {}): Row {
  const source = readFileSync(path, "utf8");
  sourceHashes.set(path, createHash("sha256").update(source).digest("hex"));
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const chunks: string[] = [], found: string[] = [];
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
  if (names.some((name) => !found.includes(name))) throw new Error(`Missing exact declaration: ${path}: ${names.filter((name) => !found.includes(name))}`);
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
export const zones = load(`${BACK}/shared/companyTimezones.ts`, ["COMPANY_TIMEZONE_OPTIONS", "isSupportedCompanyTimezone"]);
export const context = server("companyContext.ts", ["DEFAULT_COMPANY_TIMEZONE", "isCompanyRole", "isManagerRole", "permissionsForRole", "normalizeCompanyTimezone", "createCompanyContext", "companyContextFromMobile", "loadCompanyTimezone", "requireManager"], { ...domain, ...zones });
const timezone = server("companyTimezoneModel.ts", ["part", "companyLocalParts", "companyLocalDate", "companyLocalDateTime", "isBusinessDate", "timezoneOffsetMs", "companyLocalWallTimeToUtc"], { ...context, DATE_ONLY: /^\d{4}-\d{2}-\d{2}$/ });
export const timeOff = load(`${BACK}/shared/timeOffAuthority.ts`, ["TIME_OFF_STAFF_LOCK_SQL", "TIME_OFF_APPROVED_AVAILABILITY_SQL", "TIME_OFF_APPROVED_UNAVAILABLE_MESSAGE"]);
export const availability = server("staffAvailability.ts", ["scheduledInstant", "addLocalDate", "localSeconds", "foldBoundary", "companyLocalIntervalSegments", "companyTimezoneForAvailability", "lockCompanyUserForSchedule", "assertStaffAvailableForScheduledStart"], { ...domain, ...context, ...timezone, ...timeOff });
const appointment = server("appointmentConfirmation.ts", ["APPOINTMENT_PURPOSES", "appointmentStartUnix", "sameAppointmentStart", "resolveUnconfirmedAppointmentAlerts", "cancelStaleQueuedAppointmentCommunications", "invalidateAppointmentConfirmation"]);
class MobileAuthError extends Error { constructor(public status: number, message: string) { super(message); } }
const errors = server("mobileOperations.ts", ["mobileErrorStatus", "mobileTrpcError", "operationalError"], { ...domain, z });

let nextJob = 752000;
export const fixtures: { evidence: () => Row }[] = [];
export function fixture(options: { zone?: string; role?: string; failAt?: string; affectedRows?: number } = {}) {
  const id = ++nextJob;
  let state: Row = {
    job: { id, company_id: 9, customer_id: 7, assigned_user_id: 50, title: "Calendar fixture", service_name: "Test service", status: "scheduled",
      scheduled_start_at: new Date("2026-12-01T15:00:00Z"), scheduled_end_at: new Date("2026-12-01T17:00:00Z"), updated_at: new Date("2026-11-17T15:00:00Z"),
      amount: 100, subtotal_amount: 100, discount_amount: 0, customer_confirmed_at: null, customer_confirmed_for_start_at: null },
    assignments: [{ company_id: 9, job_id: id, user_id: 50, unassigned_at: null }], events: [], alerts: [], invalidations: [], directoryWrites: [],
  };
  const original = structuredClone(state);
  let snapshot: Row | null = null;
  const calls: { sql: string; params: any[] }[] = [], order: string[] = [], outcomes: Row[] = [];
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
      if (options.failAt && sql.startsWith(options.failAt)) throw new Error("Isolated transactional SQL failure");
      if (sql.includes("FROM company_users cu JOIN companies c")) {
        const member = members.find((row) => row.id === params[0] && row.company_id === params[1]);
        return [[...(active && member ? [{ ...member, role: liveRole, member_id: "fixture", company_name: "Fixture", company_slug: "fixture" }] : [])], []];
      }
      if (sql === "SELECT timezone FROM companies WHERE id = ? LIMIT 1") return [[{ timezone: params[0] === 9 ? options.zone ?? "America/Chicago" : "America/New_York" }], []];
      if (sql === timeOff.TIME_OFF_STAFF_LOCK_SQL) return [members.filter((row) => row.company_id === params[0] && row.id === params[1]), []];
      if (sql === timeOff.TIME_OFF_APPROVED_AVAILABILITY_SQL) return [requests.filter((row) => row.company_id === params[0] && row.user_id === params[1] && row.request_status === "approved" && row.start_date <= params[2] && row.end_date >= params[3]).slice(0, 1), []];
      if (sql.includes("FROM fs_schedule_blocks")) return [blocks.filter((row) => row.company_id === params[0] && row.employee_user_id === params[1] && row.block_date === params[2]), []];
      if (sql.startsWith("SELECT users.id")) return [members.filter((row) => row.id === params[0] && row.company_id === params[1] && row.is_active === 1 && row.eligible), []];
      if (sql.startsWith("INSERT IGNORE INTO company_team_positions") || sql.startsWith("UPDATE company_users users")) { state.directoryWrites.push({ sql, params }); return [{ affectedRows: 0 }, []]; }
      if (sql.startsWith("SELECT id, customer_id")) return [[...(state.job.id === params[0] && state.job.company_id === params[1] ? [structuredClone(state.job)] : [])], []];
      if (sql.startsWith("UPDATE fs_jobs SET scheduled")) {
        const assign = sql.includes("assigned_user_id = ?"), offset = assign ? 3 : 2;
        const matches = state.job.id === params[offset] && state.job.company_id === params[offset + 1]
          && (!sql.includes("AND updated_at = ?") || state.job.updated_at.getTime() === params.at(-1).getTime());
        const affected = matches && options.affectedRows !== 0;
        if (affected) {
          state.job.scheduled_start_at = params[0]; state.job.scheduled_end_at = params[1];
          if (assign) state.job.assigned_user_id = params[2];
          // Emulate the existing fs_jobs timestamp update, not a mobile-generated version.
          state.job.updated_at = new Date("2026-11-17T15:01:00Z");
        }
        return [{ affectedRows: affected ? 1 : 0 }, []];
      }
      if (sql.startsWith("UPDATE fs_jobs\n") && sql.includes("SET customer_confirmed_at = NULL")) {
        const affected = state.job.id === params[0] && state.job.company_id === params[1] && (state.job.customer_confirmed_at || state.job.customer_confirmed_for_start_at);
        state.invalidations.push(params[0]);
        if (affected) { state.job.customer_confirmed_at = null; state.job.customer_confirmed_for_start_at = null; }
        return [{ affectedRows: affected ? 1 : 0 }, []];
      }
      if (sql.startsWith("UPDATE fs_alerts SET read_at") || sql.startsWith("UPDATE fs_company_communications\n")) return [{ affectedRows: 0 }, []];
      if (sql.startsWith("UPDATE fs_job_assignments")) { state.assignments.forEach((row: Row) => { if (row.company_id === params[0] && row.job_id === params[1] && row.unassigned_at === null) row.unassigned_at = "closed"; }); return [{ affectedRows: 1 }, []]; }
      if (sql.startsWith("INSERT INTO fs_job_assignments")) { state.assignments.push({ company_id: params[0], job_id: params[1], user_id: params[2], unassigned_at: null }); return [{ insertId: 2 }, []]; }
      if (sql.startsWith("INSERT INTO fs_alerts")) { state.alerts.push(params); return [{ insertId: 1 }, []]; }
      if (sql.startsWith("INSERT INTO fs_job_events")) { state.events.push(params); return [{ insertId: 1 }, []]; }
      throw new Error(`Unexpected SQL denied: ${sql}`);
    },
  };
  const postCommit = vi.fn(async () => { order.push("fake booking after commit"); });
  const service = server("jobService.ts", ["withTransaction", "ensureCompanyTeamPositions", "createAlert", "insertJobEvent", "optimisticClause", "optimisticParams", "concurrencyMessage", "requireOwnedJob", "requireCalendarEligibleMember", "iso", "formatScheduledTime", "closeOpenJobAssignments", "rescheduleJob"], {
    ...domain, ...context, ...availability, ...appointment, attemptBookingConfirmationAfterCommit: postCommit,
  });
  const auth = server("mobileAuth.ts", ["mobileBearerToken", "withLiveMembershipRole", "companyProfile", "requireMobileCompany"], {
    MobileAuthError, getDb: async () => db, verifyMobileAccessToken: async (token: string) => { if (token !== "isolated-calendar-token") throw new MobileAuthError(401, "Invalid test bearer"); return structuredClone(claims); },
    mobileDate: () => null, signedStorageUrlFromStoredUrl: () => null,
  });
  const handlers = server("mobileOperations.ts", ["mobileCompany", "rescheduleJob"], { ...context, ...errors, ...domain, z,
    requireMobileCompany: auth.requireMobileCompany, rescheduleCompanyJob: service.rescheduleJob });
  async function request(handler: Callable, body?: unknown, bearer = "Bearer isolated-calendar-token") {
    let status = 200, payload: any;
    const res = { status(value: number) { status = value; return res; }, json(value: unknown) { payload = value; return value; } };
    await handler({ params: { jobId: String(id) }, body, header: () => bearer }, res);
    const result = { status, payload: JSON.parse(JSON.stringify(payload)) };
    outcomes.push({ kind: "PATCH", body, ...result });
    return result;
  }
  const company = context.createCompanyContext({ companyId: 9, userId: 40, role: liveRole, timezone: options.zone });
  const result = { id, db, blocks, requests, members, calls, order, service, company, handlers, request, postCommit,
    state: () => state, commits: () => commits, rollbacks: () => rollbacks,
    setClaims: (patch: Row) => { claims = { ...claims, ...patch }; }, setRole: (role: string) => { liveRole = role; }, setActive: (value: boolean) => { active = value; },
    check: async (start: string, end: string, member = 50) => {
      try { const value = await availability.assertStaffAvailableForScheduledStart(db, company, member, start, { scheduledEndAt: end }); outcomes.push({ kind: "availability", start, end, member, accepted: true }); return value; }
      catch (error) { outcomes.push({ kind: "availability", start, end, member, accepted: false, code: (error as Row).code, message: (error as Error).message }); throw error; }
    },
    block: (date: string, startHour = 0, endHour = 24, companyId = 9, member = 50) => blocks.push({ company_id: companyId, employee_user_id: member, block_date: date, start_hour: startHour, end_hour: endHour }),
    off: (date: string, status = "approved", companyId = 9, member = 50) => requests.push({ company_id: companyId, user_id: member, start_date: date, end_date: date, request_status: status }),
    evidence: () => ({ id, options, original, state: structuredClone(state), outcomes, blocks, requests, calls, order, commits, rollbacks, postCommitCalls: postCommit.mock.calls.length }),
  };
  fixtures.push(result);
  return result;
}
export const mutation = (assignedUserId: number | null = 60) => ({ scheduledStartAt: "2026-12-01T16:00:00.000Z", scheduledEndAt: "2026-12-01T18:00:00.000Z", assignedUserId, expectedUpdatedAt: "2026-11-17T15:00:00.000Z" });

// The four prior failed assertion calls are copied byte-for-byte, without skipped or softened expectations.
describe("752 unchanged four prior failing calendar REQUIREMENTS", () => {
  it("REQUIREMENT: fold traversal includes wall minutes outside endpoint envelope", async () => {
    const h = fixture(); h.block("2026-11-01", 1.8, 1.9);
    await expect(h.check("2026-11-01T06:15:00Z", "2026-11-01T07:45:00Z")).rejects.toMatchObject({ code: "CONFLICT" });
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

const OUT = "/home/ubuntu/hsc-mobile-752ccca3-compatibility-20261117/calendar-fixtures";
const ORIGINAL = "/home/ubuntu/home-service-connection-app/tests/company-calendar-2574-authoritative.test.ts";
const requiredNames = [
  "REQUIREMENT: fold traversal includes wall minutes outside endpoint envelope",
  "REQUIREMENT: positive equal-clock fold interval still checks approved time off",
  "REQUIREMENT: fractional-second positive interval cannot bypass an all-day block",
  "REQUIREMENT: atomic reschedule cannot commit a blocked portion outside the fold endpoint envelope",
];
const evidence: Row[] = [];
function requirementBodies(path: string) {
  const source = readFileSync(path, "utf8");
  const tree = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const found = new Map<string, { body: string; bodySha256: string; assertionSha256: string }>();
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === "it" && node.arguments.length >= 2
      && ts.isStringLiteral(node.arguments[0]) && requiredNames.includes(node.arguments[0].text)) {
      const callback = node.arguments[1];
      if (!ts.isArrowFunction(callback)) throw new Error("Historical assertion must remain an arrow function");
      const body = callback.body.getText(tree);
      found.set(node.arguments[0].text, { body, bodySha256: createHash("sha256").update(body).digest("hex"),
        assertionSha256: createHash("sha256").update(node.getText(tree)).digest("hex") });
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return found;
}
beforeEach(() => {
  fixtures.length = 0;
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Real HTTP forbidden"));
});
afterEach(() => {
  evidence.push({ test: expect.getState().currentTestName, fixtures: fixtures.map((h) => h.evidence()) });
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});
afterAll(() => {
  writeFileSync(`${OUT}/runtime-evidence.json`, JSON.stringify({ revision: REVISION, sourceHashes: Object.fromEntries(sourceHashes), tests: evidence }, null, 2) + "\n");
});

describe("752 exact calendar source and unchanged-body provenance", () => {
  it("pins revision and exact loaded availability/schedule/handler source hashes", () => {
    const revision = JSON.parse(readFileSync(`${BACK}/../backend-revision.json`, "utf8"));
    expect(revision.sha).toBe(REVISION);
    expect(sourceHashes.get(`${BACK}/server/staffAvailability.ts`)).toBe("3c4cf10851200c4af326b9af7c985294275b5ec71d163c501c7bbf829603de2b");
    expect(sourceHashes.get(`${BACK}/server/jobService.ts`)).toBe("d55c322a3d9fc28a961b4014bf36509c2f7c0f6ce958089cdc1dde6cc791c13f");
    expect(sourceHashes.get(`${BACK}/server/mobileOperations.ts`)).toBe("830b8d866288daa3e6be698ef399e5e43d97de4b4aa8268634e0eca8b77ddc6f");
  });
  it("preserves all four original names, bodies and entire assertion-call hashes verbatim", () => {
    const original = requirementBodies(ORIGINAL);
    const current = requirementBodies("/home/ubuntu/home-service-connection-app/tests/company-calendar-752-acceptance.test.ts");
    expect(original.size).toBe(4); expect(current.size).toBe(4);
    const comparison = requiredNames.map((name) => {
      const previous = original.get(name)!;
      const actual = current.get(name)!;
      expect(actual).toEqual(previous);
      return { name, priorBodySha256: previous.bodySha256, newBodySha256: actual.bodySha256,
        priorAssertionSha256: previous.assertionSha256, newAssertionSha256: actual.assertionSha256, unchanged: true };
    });
    writeFileSync(`${OUT}/requirement-body-sha-comparison.json`, JSON.stringify({ original: ORIGINAL, target: REVISION, assertions: comparison }, null, 2) + "\n");
  });
  it("registers both exact schedule PATCH aliases", () => {
    const source = readFileSync(`${BACK}/server/mobileOperations.ts`, "utf8");
    expect(source).toContain('app.patch(`${BASE}/company/jobs/:jobId/schedule`, rescheduleJob);');
    expect(source).toContain('app.patch(`${BASE}/jobs/:jobId/schedule`, rescheduleJob);');
  });
});

describe("752 focused availability and atomic schedule controls", () => {
  it.each(["block", "off"])("decreasing-clock positive fold rejects %s", async (kind) => {
    const h = fixture(); if (kind === "block") h.block("2026-11-01"); else h.off("2026-11-01");
    await expect(h.check("2026-11-01T06:50:00Z", "2026-11-01T07:10:00Z")).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it.each(["block", "off"])("second-local-date %s conflict returns 409 and rolls back all schedule writes", async (kind) => {
    const h = fixture(); if (kind === "block") h.block("2026-12-02", 0, 24, 9, 60); else h.off("2026-12-02", "approved", 9, 60);
    const before = structuredClone(h.state());
    const result = await h.request(h.handlers.rescheduleJob, { ...mutation(), scheduledStartAt: "2026-12-02T05:00:00Z", scheduledEndAt: "2026-12-02T07:00:00Z" });
    expect(result.status).toBe(409); expect(result.payload.error.code).toBe("CONFLICT");
    expect(h.state()).toEqual(before); expect(h.commits()).toBe(0); expect(h.rollbacks()).toBe(1); expect(h.postCommit).not.toHaveBeenCalled();
    expect(h.calls.filter((call) => call.sql.startsWith("UPDATE fs_jobs SET scheduled"))).toHaveLength(0);
    expect(h.calls.find((call) => call.sql === timeOff.TIME_OFF_STAFF_LOCK_SQL)?.params).toEqual([9, 60]);
  });
  it.each(["INSERT INTO fs_job_assignments", "INSERT INTO fs_alerts", "INSERT INTO fs_job_events"])("actual SQL failure at %s rolls back time/lane/version/history/event", async (failAt) => {
    const h = fixture({ failAt }); const before = structuredClone(h.state());
    const result = await h.request(h.handlers.rescheduleJob, mutation());
    expect(result.status).not.toBe(200); expect(h.state()).toEqual(before); expect(h.rollbacks()).toBe(1); expect(h.commits()).toBe(0); expect(h.postCommit).not.toHaveBeenCalled();
    expect(h.calls.filter((call) => call.sql.startsWith("UPDATE fs_jobs SET scheduled"))).toHaveLength(1);
  });
  it("stale version rejects 409 and restores time/lane/history without postcommit work", async () => {
    const h = fixture(); const before = structuredClone(h.state());
    const result = await h.request(h.handlers.rescheduleJob, { ...mutation(), expectedUpdatedAt: "2026-11-17T14:00:00Z" });
    expect(result.status).toBe(409); expect(h.state()).toEqual(before); expect(h.rollbacks()).toBe(1); expect(h.commits()).toBe(0); expect(h.postCommit).not.toHaveBeenCalled();
  });
  it("ordinary positive schedule commits assigned/time intent together then runs fake postcommit", async () => {
    const h = fixture(); const input = mutation(); const result = await h.request(h.handlers.rescheduleJob, input);
    expect(result.status).toBe(200); expect(result.payload).toEqual({ success: true, jobId: h.id, assignedUserId: 60, scheduledStartAt: input.scheduledStartAt, scheduledEndAt: input.scheduledEndAt });
    expect(h.state().job.assigned_user_id).toBe(60); expect(h.state().job.scheduled_start_at.toISOString()).toBe(input.scheduledStartAt); expect(h.state().job.scheduled_end_at.toISOString()).toBe(input.scheduledEndAt);
    expect(h.state().assignments).toHaveLength(2); expect(h.state().events).toHaveLength(1); expect(h.state().alerts).toHaveLength(1);
    expect(h.commits()).toBe(1); expect(h.rollbacks()).toBe(0); expect(h.postCommit).toHaveBeenCalledOnce();
    expect(h.order.indexOf("commit")).toBeLessThan(h.order.indexOf("fake booking after commit"));
    const writes = h.calls.filter((call) => call.sql.startsWith("UPDATE fs_jobs SET scheduled"));
    expect(writes).toHaveLength(1); expect(writes[0].sql).toContain("assigned_user_id = ?"); expect(writes[0].sql).toContain("AND updated_at = ?"); expect(writes[0].params.at(-1).toISOString()).toBe(input.expectedUpdatedAt);
  });
  it("half-open block boundaries exclude touching endpoints but retain positive interior overlap", async () => {
    const h = fixture(); h.block("2026-12-01", 8, 9); h.block("2026-12-01", 11, 12);
    await expect(h.check("2026-12-01T15:00:00Z", "2026-12-01T17:00:00Z")).resolves.toBeUndefined();
    h.block("2026-12-01", 10, 11);
    await expect(h.check("2026-12-01T15:59:30Z", "2026-12-01T16:00:30Z")).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("Company database timezone governs availability", async () => {
    const h = fixture({ zone: "America/New_York" }); h.block("2026-12-02", 0, 1);
    await expect(h.check("2026-12-02T05:00:00Z", "2026-12-02T06:00:00Z")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.calls.find((call) => call.sql.includes("FROM fs_schedule_blocks"))?.params).toEqual([9, 50, "2026-12-02"]);
  });
  it("pending/denied time-off and foreign Company/member cannot leak unavailability", async () => {
    const h = fixture(); h.off("2026-12-01", "pending"); h.off("2026-12-01", "denied"); h.off("2026-12-01", "approved", 10, 50); h.block("2026-12-01", 0, 24, 9, 60);
    await expect(h.check("2026-12-01T15:00:00Z", "2026-12-01T17:00:00Z")).resolves.toBeUndefined();
    for (const call of h.calls.filter((value) => value.sql.includes("FROM fs_schedule_blocks") || value.sql === timeOff.TIME_OFF_APPROVED_AVAILABILITY_SQL)) expect(call.params.slice(0, 2)).toEqual([9, 50]);
  });
  it("invalid and nonpositive UTC intervals reject", async () => {
    const h = fixture();
    for (const [start, end] of [["bad", "2026-12-01T17:00:00Z"], ["2026-12-01T17:00:00Z", "2026-12-01T17:00:00Z"], ["2026-12-01T18:00:00Z", "2026-12-01T17:00:00Z"]]) {
      await expect(h.check(start, end)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });
  it("live technician role defeats an owner JWT before Job SQL", async () => {
    const h = fixture({ role: "technician" }); const before = structuredClone(h.state());
    const result = await h.request(h.handlers.rescheduleJob, mutation());
    expect(result.status).toBe(403); expect(h.state()).toEqual(before); expect(h.calls.filter((call) => call.sql.includes("fs_jobs"))).toHaveLength(0);
  });
  it("tenant-bound request cannot reschedule another Company's Job", async () => {
    const h = fixture(); h.state().job.company_id = 10; const before = structuredClone(h.state());
    expect((await h.request(h.handlers.rescheduleJob, mutation())).status).toBe(404); expect(h.state()).toEqual(before); expect(h.rollbacks()).toBe(1); expect(h.commits()).toBe(0);
  });
});
