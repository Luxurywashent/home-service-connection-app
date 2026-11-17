import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  companyFieldworkBlockReason, companyJobActorBlockReason, companyJobMilestoneFields,
  createCompanyJobController, isAssignedCompanyFieldActor, type CompanyJobState, type CompanyJobTransport,
} from "../lib/company-job-fieldwork";
import {
  JobSyncApiError, normalizeJobSyncCompanyJobDetail, type JobSyncCompanyJobDetail, type JobSyncNativeSession,
} from "../lib/jobsync-mobile-api";

const BASE = "/home/ubuntu/hsc-mobile-final-phase2-20261116/backend-source-f3576bcb";
const VERSION = "2026-11-16T12:00:00.000Z";
const source = (file: string) => readFileSync(`${BASE}/${file}`, "utf8");
type RecordValue = Record<string, any>;

/** Extract exact declarations, not reimplemented policies. No backend imports, pool, storage or delivery module loads. */
function declarations(file: string, names: string[], injections: RecordValue = {}): RecordValue {
  const ast = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true);
  const selected = ast.statements.filter((node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) return names.includes(node.name.text);
    return ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && names.includes(item.name.text));
  });
  for (const name of names) {
    if (!selected.some((node) => node.getText(ast).match(new RegExp(`\\b${name}\\b`)))) throw new Error(`Missing exact backend declaration ${file}:${name}`);
  }
  const javascript = ts.transpileModule(selected.map((node) => node.getText(ast).replace(/^export\s+/, "")).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(injections), `${javascript}\nreturn {${names.join(",")}};`)(...Object.values(injections));
}

const errors = declarations("server/domainErrors.ts", ["DomainError", "domainHttpStatus", "domainMobileCode"]);
const statuses = declarations("shared/jobStatuses.ts", ["JOB_STATUSES"]);
const lifecycle = declarations("server/jobLifecycle.ts", [
  "FIELD_TECH_STATUSES", "JOB_STATUS_TRANSITIONS", "isJobStatus", "assertJobStatusTransition", "statusFromLifecycleEvent", "firstLifecycleTimestamps",
], { ...errors, ...statuses });
const context = declarations("server/companyContext.ts", [
  "DEFAULT_COMPANY_TIMEZONE", "isCompanyRole", "isManagerRole", "permissionsForRole", "normalizeCompanyTimezone",
  "createCompanyContext", "companyContextFromMobile", "requireManager", "technicianScopeSql",
], { ...errors, isSupportedCompanyTimezone: (value: string) => value === "America/Chicago" });
const confirmation = declarations("server/appointmentConfirmation.ts", [
  "APPOINTMENT_PURPOSES", "appointmentStartUnix", "sameAppointmentStart", "isAppointmentConfirmed", "confirmationStatusFromJob",
  "confirmationProjection", "resolveUnconfirmedAppointmentAlerts", "cancelStaleQueuedAppointmentCommunications",
], errors);
const dto = declarations("server/mobileCompanyJobDto.ts", ["asNumber", "asNullableInt", "asIso", "firstNonEmptyString", "projectMobileCompanyJob"]);
const format = declarations("server/formatServiceName.ts", ["formatServiceName"]);

type Role = "owner" | "dispatcher" | "technician";
type Row = { id: number; company_id: number; assigned_user_id: number | null; status: string; updated_at: string; completed_at: string | null } & RecordValue;

/** Explicit SQL interpreter for this finite fixture. Every unrecognized query throws; no connection to a real DB exists. */
function fixture(options: { role?: Role; assignedUserId?: number | null; calendar?: boolean | null; companyId?: number; status?: string } = {}) {
  const member = { id: 41, company_id: 9, role: options.role ?? "owner", is_active: 1, workspace_status: "active",
    calendar_eligible_override: options.calendar ?? null, payment_collection_enabled: 0, member_id: "OFFLINE-41",
    first_name: "Offline", last_name: "Member", email: "status@example.invalid", company_name: "Offline Company", company_slug: "offline" };
  let rows: Row[] = [{ id: 47, company_id: options.companyId ?? 9, assigned_user_id: options.assignedUserId === undefined ? 41 : options.assignedUserId,
    status: options.status ?? "scheduled", updated_at: VERSION, completed_at: null, title: "Offline fixture Job", service_name: "pb_basic",
    customer_id: 70, amount: 100, subtotal_amount: 100, discount_amount: 0, scheduled_start_at: "2026-11-16T15:00:00.000Z",
    scheduled_end_at: "2026-11-16T17:00:00.000Z", internal_notes: "Private fixture note", service_notes: "Customer fixture note" }];
  let events: RecordValue[] = [];
  let audits: RecordValue[] = [];
  let alerts: RecordValue[] = [];
  let changes = 0;
  const queries: { sql: string; params: any[] }[] = [];
  const finance = vi.fn(async () => ({ jobTotal: 100, paid: 0, refundTotal: 0, appliedEstimateCredit: 0, balance: 100, paymentStatus: "unpaid" }));
  const execute = vi.fn(async (raw: string, params: any[] = []) => {
    const sql = raw.replace(/\s+/g, " ").trim();
    queries.push({ sql, params });
    if (sql.startsWith("SELECT cu.id")) {
      expect(sql).toContain("cu.is_active = 1 AND c.workspace_status = 'active'");
      return [[member.id === params[0] && member.company_id === params[1] && member.is_active === 1 && member.workspace_status === "active" ? { ...member } : null].filter(Boolean)];
    }
    if (sql.startsWith("SELECT role, payment_collection_enabled")) {
      return [[member.id === params[0] && member.company_id === params[1] && member.is_active === 1 ? { ...member } : null].filter(Boolean)];
    }
    if (sql.startsWith("SELECT users.id")) {
      expect(sql).toContain("users.is_active = 1");
      expect(sql).toContain("COALESCE(users.calendar_eligible_override, positions.calendar_eligible) = 1");
      return [[member.id === params[0] && member.company_id === params[1] && member.is_active === 1 && member.calendar_eligible_override === true ? { id: member.id } : null].filter(Boolean)];
    }
    if (sql.startsWith("UPDATE fs_jobs SET service_notes = COALESCE")) {
      const row = rows.find((job) => job.id === params[2] && job.company_id === params[3]);
      if (!row) return [{ affectedRows: 0 }];
      row.service_notes = params[0] ?? row.service_notes; row.internal_notes = params[1] ?? row.internal_notes;
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("SELECT id, customer_id, assigned_user_id") && sql.includes("FROM fs_jobs WHERE")) {
      const job = rows.find((row) => row.id === params[0] && row.company_id === params[1]
        && (!sql.includes("AND assigned_user_id = ?") || row.assigned_user_id === params[2]));
      return [job ? [{ ...job }] : []];
    }
    if (sql.startsWith("SELECT j.*") || sql.startsWith("SELECT j.id,")) {
      const single = sql.startsWith("SELECT j.*");
      const company = single ? params[1] : params[0];
      const assignee = single ? params[2] : params[1];
      expect(sql).toContain("c.company_id = j.company_id");
      return [rows.filter((row) => row.company_id === company && (!single || row.id === params[0])
        && (!sql.includes("AND j.assigned_user_id = ?") || row.assigned_user_id === assignee)).map((row) => ({ ...row, customer_name: "Offline Customer", technician_name: "Offline Member" }))];
    }
    if (sql.startsWith("UPDATE fs_jobs SET status = ?")) {
      const row = rows.find((job) => job.id === params[2] && job.company_id === params[3]);
      if (!row || (sql.includes("AND updated_at = ?") && new Date(row.updated_at).getTime() !== new Date(params[4]).getTime())) return [{ affectedRows: 0 }];
      changes += 1;
      row.status = params[0]; row.updated_at = `2026-11-16T12:${String(changes).padStart(2, "0")}:00.000Z`;
      if (params[1] === "completed") row.completed_at ??= row.updated_at;
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("INSERT INTO fs_job_events")) {
      events.push({ company_id: params[0], job_id: params[1], actor_user_id: params[2], event_type: params[3], message: params[4], created_at: rows[0].updated_at });
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("INSERT INTO fs_audit_logs")) {
      audits.push({ company_id: params[0], actor_user_id: params[1], action: params[2], entity_id: params[4], details: JSON.parse(params[5]) });
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("SELECT id FROM company_users")) return [[{ id: 52 }]];
    if (sql.startsWith("INSERT INTO fs_alerts")) { alerts.push({ companyId: params[0], userId: params[1], jobId: params[2], type: params[3] }); return [{ affectedRows: 1 }]; }
    if (sql.includes("FROM fs_job_events")) return [events.filter((event) => event.company_id === params[0] && event.job_id === params[1]).map((event) => ({ ...event, actor_name: "Offline Member" }))];
    if (/^SELECT .*FROM (fs_job_payments|fs_inventory_transactions|fs_job_photos|fs_job_site_inspections|fs_company_email_deliveries|fs_job_lifecycle_timing_overrides|fs_job_line_items)\b/.test(sql)) return [[]];
    if (sql.startsWith("UPDATE fs_alerts SET read_at") || sql.startsWith("UPDATE fs_company_communications SET state = 'cancelled'")) return [{ affectedRows: 0 }];
    throw new Error(`Offline fixture rejects unexpected SQL: ${sql}`);
  });
  let snapshot: { rows: Row[]; events: RecordValue[]; audits: RecordValue[]; alerts: RecordValue[]; changes: number };
  const connection = { execute, beginTransaction: vi.fn(async () => { snapshot = structuredClone({ rows, events, audits, alerts, changes }); }),
    commit: vi.fn(async () => undefined), rollback: vi.fn(async () => { ({ rows, events, audits, alerts, changes } = snapshot); }), release: vi.fn() };
  const db = { execute, getConnection: vi.fn(async () => connection) };
  const service = declarations("server/jobService.ts", [
    "toNumber", "iso", "withTransaction", "requireOwnedJob", "optimisticClause", "optimisticParams", "concurrencyMessage",
    "createAlert", "notifyDispatchers", "insertJobEvent", "writeCompanyAuditLog", "changeJobStatus", "getJob", "mapListedJob", "listJobs",
    "lifecycleTimingOverrideForJob", "effectiveLifecycleTimestamps", "getJobDetail", "updateJobNotes",
  ], { ...context, ...errors, ...lifecycle, ...confirmation, ...format,
    recurrenceLabelFromParts: () => null, getJobPaymentBalance: finance,
    listJobPaymentBalances: vi.fn(async (_db: unknown, _company: unknown, ids: number[]) => new Map(await Promise.all(ids.map(async (id) => [id, await finance()] as const)))) });
  const calendarSeed = vi.fn(async () => undefined);
  const calendar = declarations("server/jobService.ts", ["requireCalendarEligibleMember"], { ...errors, ensureCompanyTeamPositions: calendarSeed });
  const claims = { accountType: "company", accountId: 41, companyId: 9, role: options.role ?? "owner", name: "Offline Member" };
  const auth = declarations("server/mobileAuth.ts", ["MobileAuthError", "mobileBearerToken", "withLiveMembershipRole", "companyProfile", "requireMobileCompany"], {
    getDb: async () => db, verifyMobileAccessToken: vi.fn(async (token: string) => {
      if (token !== "offline-final-status") throw new Error("Unexpected offline token");
      return { ...claims };
    }), mobileDate: () => null, signedStorageUrlFromStoredUrl: () => null,
  });
  const operations = declarations("server/mobileOperations.ts", [
    "managerRoles", "paymentCollectorRoles", "mobileCompany", "requireManager", "requireMobilePaymentCollector",
    "mobileErrorStatus", "mobileTrpcError", "operationalError", "jobStatus", "assertMobileJobPhotoAccess",
  ], { ...auth, ...errors, ...context, ...service, z });
  const req = (body: RecordValue = {}) => ({ header: () => "Bearer offline-final-status", params: { jobId: "47" }, body });
  const company = async () => (await operations.mobileCompany(req())).company;
  const session = async (): Promise<JobSyncNativeSession> => {
    const live = await auth.companyProfile(41, 9);
    return { token: "offline-final-status", portal: "company", user: { ...live.user, role: live.user.role as Role }, company: live.company };
  };
  const patch = async (body: RecordValue) => {
    const res = { statusCode: 200, payload: null as any, status(code: number) { this.statusCode = code; return this; }, json(payload: unknown) { this.payload = payload; return this; } };
    await operations.jobStatus(req(body), res);
    return res;
  };
  const mobileDetail = async (): Promise<JobSyncCompanyJobDetail> => {
    const detail = await service.getJobDetail(db, await company(), 47);
    const result = normalizeJobSyncCompanyJobDetail({ job: { ...detail, ...dto.projectMobileCompanyJob(detail), photos: [] } }, 47, 9);
    if (!result) throw new Error("Invalid fixture detail projection");
    return result;
  };
  const api: CompanyJobTransport = {
    session: vi.fn(session), detail: vi.fn(mobileDetail), list: vi.fn(async () => service.listJobs(db, await company())),
    cancel: vi.fn(async () => { throw new Error("Cancellation not exercised through field controller fixture"); }),
    status: vi.fn(async (_token, _id, input) => {
      const result = await patch(input);
      if (result.statusCode !== 200) throw new JobSyncApiError("Offline fixture denied status", result.statusCode, result.payload.error.code);
      return result.payload;
    }),
  };
  return { db, connection, queries, member, claims, service, operations, auth, calendar, calendarSeed, req, company, session, patch, mobileDetail, api,
    row: () => rows[0], events: () => events, audits: () => audits, alerts: () => alerts, changes: () => changes };
}

beforeEach(() => vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Live HTTP prohibited in exact backend status fixtures"); })));
afterEach(() => vi.unstubAllGlobals());

describe("f3576bcb exact active Company status/read/list authority", () => {
  it.each(["owner", "dispatcher", "technician"] as const)("%s authority is unchanged by calendar or payment capability and remains tenant/assignment scoped", async (role) => {
    for (const calendar of [true, false, null]) for (const assignedUserId of [41, 42, null, 0]) {
      const f = fixture({ role, calendar, assignedUserId });
      const c = await f.company();
      expect(c.permissions.canUpdateFieldStatus).toBe(true);
      const eligible = role !== "technician" || assignedUserId === 41;
      expect(companyFieldworkBlockReason(await f.session(), { id: 47, companyId: 9, assignedUserId, status: "scheduled", updatedAt: VERSION } as JobSyncCompanyJobDetail) === null).toBe(eligible);
      if (eligible) {
        expect((await f.service.getJob(f.db, c, 47)).id).toBe(47);
        expect(await f.service.listJobs(f.db, c)).toHaveLength(1);
        expect((await f.patch({ status: "en_route", expectedUpdatedAt: VERSION })).statusCode).toBe(200);
        expect(f.changes()).toBe(1); expect(f.events()).toHaveLength(1); expect(f.audits()).toHaveLength(1);
      } else {
        await expect(f.service.getJob(f.db, c, 47)).rejects.toMatchObject({ code: "NOT_FOUND" });
        expect(await f.service.listJobs(f.db, c)).toEqual([]);
        expect((await f.patch({ status: "en_route", expectedUpdatedAt: VERSION })).statusCode).toBe(404);
      expect(f.changes()).toBe(0); expect(f.events()).toEqual([]); expect(f.audits()).toEqual([]);
    }
      expect(f.queries.some(({ sql }) => sql.includes("company_team_positions"))).toBe(false);
    }
  });
  it.each(["owner", "dispatcher", "technician"] as const)("denies another tenant's Job to %s for reads, list and PATCH", async (role) => {
    const f = fixture({ role, companyId: 10 }); const c = await f.company();
    await expect(f.service.getJob(f.db, c, 47)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await f.service.listJobs(f.db, c)).toEqual([]);
    expect((await f.patch({ status: "en_route", expectedUpdatedAt: VERSION })).statusCode).toBe(404);
    expect(f.changes()).toBe(0); expect(f.events()).toEqual([]); expect(f.audits()).toEqual([]);
  });
  it.each(["inactive", "suspended Company", "different membership", "wrong portal", "no bearer", "unsupported live role"])("fails closed for %s before status mutation", async (change) => {
    const f = fixture();
    if (change === "inactive") f.member.is_active = 0;
    if (change === "suspended Company") f.member.workspace_status = "suspended";
    if (change === "different membership") f.member.company_id = 10;
    if (change === "wrong portal") f.claims.accountType = "platform_admin";
    if (change === "unsupported live role") f.member.role = "sales" as Role;
    if (change === "no bearer") await expect(f.auth.requireMobileCompany({ header: () => "" })).rejects.toMatchObject({ status: 401 });
    else expect((await f.patch({ status: "en_route", expectedUpdatedAt: VERSION })).statusCode).toBe(change === "wrong portal" || change === "unsupported live role" ? 403 : 401);
    expect(f.changes()).toBe(0); expect(f.events()).toEqual([]);
  });
  it("uses live technician role instead of cached owner claims; Admin is dispatcher, not an access-role bypass", async () => {
    expect(source("server/mobileAuth.ts")).toContain("'Admin', 'dispatcher', 0, 1, 5");
    const f = fixture({ role: "owner", assignedUserId: 42 }); f.member.role = "technician";
    expect((await f.company()).role).toBe("technician");
    expect((await f.patch({ status: "en_route", expectedUpdatedAt: VERSION })).statusCode).toBe(404);
    expect(f.changes()).toBe(0);
    expect(() => context.createCompanyContext({ companyId: 9, userId: 41, role: "admin" })).toThrow();
  });
});

describe("f3576bcb actual transaction, transition, version, history and idempotency path", () => {
  it.each(["owner", "dispatcher", "technician"] as const)("%s lifecycle records canonical milestones once, rolls through actual list/detail readback", async (role) => {
    const f = fixture({ role });
    for (const status of ["en_route", "on_site", "completed"]) {
      const expectedUpdatedAt = f.row().updated_at;
      const result = await f.patch({ status, expectedUpdatedAt });
      expect(result.statusCode).toBe(200); expect(result.payload).toEqual({ success: true, status });
      const c = await f.company(); const d = await f.service.getJobDetail(f.db, c, 47);
      expect(d.status).toBe(status); expect(d.events.at(-1).actor_user_id).toBe(41);
      expect((await f.service.listJobs(f.db, c))[0].status).toBe(status);
      expect(d.enRouteAt).toBe("2026-11-16T12:01:00.000Z");
      if (status !== "en_route") expect(d.onSiteAt).toBe("2026-11-16T12:02:00.000Z");
      if (status === "completed") expect(d.completedAt).toBe("2026-11-16T12:03:00.000Z");
      const before = f.queries.length;
      const repeat = await f.patch({ status, expectedUpdatedAt }); // actual same-state path is a no-op even with old version
      expect(repeat.statusCode).toBe(200);
      expect(f.queries.slice(before).some(({ sql }) => /^(INSERT|UPDATE)/.test(sql))).toBe(false);
    }
    expect(f.changes()).toBe(3); expect(f.events()).toHaveLength(3); expect(f.audits()).toHaveLength(3);
    expect(f.audits().map((audit) => audit.details.from)).toEqual(["scheduled", "en_route", "on_site"]);
    expect(f.connection.commit).toHaveBeenCalledTimes(6); expect(f.connection.release).toHaveBeenCalledTimes(6);
    expect(f.alerts()).toHaveLength(role === "technician" ? 3 : 0); // mocked in-app rows only, never customer delivery
    expect(f.queries.some(({ sql }) => sql.startsWith("UPDATE fs_company_communications SET state = 'cancelled'"))).toBe(true);
  });
  it("uses FOR UPDATE and expected version, with conflict rollback and no history/alerts", async () => {
    const f = fixture({ role: "technician" }); f.row().updated_at = "2026-11-16T11:59:00.000Z";
    const result = await f.patch({ status: "en_route", expectedUpdatedAt: VERSION });
    expect(result.statusCode).toBe(409); expect(result.payload.error.code).toBe("CONFLICT");
    expect(f.queries.find(({ sql }) => sql.includes("FROM fs_jobs WHERE"))!.sql).toContain("AND assigned_user_id = ? LIMIT 1 FOR UPDATE");
    const update = f.queries.find(({ sql }) => sql.startsWith("UPDATE fs_jobs SET status"))!;
    expect(update.sql).toContain("AND updated_at = ?"); expect(update.params[4]).toEqual(new Date(VERSION));
    expect(f.row().status).toBe("scheduled"); expect(f.events()).toEqual([]); expect(f.audits()).toEqual([]); expect(f.alerts()).toEqual([]);
    expect(f.connection.rollback).toHaveBeenCalledOnce(); expect(f.connection.release).toHaveBeenCalledOnce();
  });
  it.each([
    ["draft", "en_route", "owner", 409], ["completed", "on_site", "owner", 409], ["cancelled", "en_route", "dispatcher", 409],
    ["unknown", "completed", "owner", 409], ["scheduled", "cancelled", "technician", 403], ["scheduled", "scheduled_local", "owner", 400],
  ])("rejects %s -> %s by %s with HTTP %s and no writes", async (status, target, role, http) => {
    const f = fixture({ status: String(status), role: role as Role });
    expect((await f.patch({ status: target, expectedUpdatedAt: VERSION })).statusCode).toBe(http);
    expect(f.changes()).toBe(0); expect(f.events()).toEqual([]); expect(f.audits()).toEqual([]);
  });
  it("retains existing follow_up -> completed for technicians without inventing mobile status", async () => {
    const f = fixture({ role: "technician", status: "follow_up" });
    expect((await f.patch({ status: "completed", expectedUpdatedAt: VERSION })).statusCode).toBe(200);
    expect(f.events()[0].message).toBe("Status updated to completed");
  });
  it("rolls back the status and event when an actual downstream audit SQL operation fails", async () => {
    const f = fixture(); const execute = f.db.execute;
    f.connection.execute = vi.fn(async (sql: string, params?: any[]) => {
      if (sql.startsWith("INSERT INTO fs_audit_logs")) throw new Error("Offline audit failure");
      return execute(sql, params);
    });
    await expect(f.service.changeJobStatus(f.db, await f.company(), { jobId: 47, status: "en_route", expectedUpdatedAt: VERSION })).rejects.toThrow("Offline audit failure");
    expect(f.row().status).toBe("scheduled"); expect(f.changes()).toBe(0); expect(f.events()).toEqual([]); expect(f.audits()).toEqual([]);
    expect(f.connection.rollback).toHaveBeenCalledOnce(); expect(f.connection.commit).not.toHaveBeenCalled(); expect(f.connection.release).toHaveBeenCalledOnce();
  });
});

describe("independent calendar, private-note, photo and payment gates", () => {
  it("calendar eligibility is a new-assignment gate, not permission to mutate an unassigned technician Job", async () => {
    const f = fixture({ role: "technician", calendar: true, assignedUserId: null });
    const c = await f.company(); await f.calendar.requireCalendarEligibleMember(f.db, c, 41);
    expect(f.calendarSeed).toHaveBeenCalledOnce();
    expect((await f.patch({ status: "en_route", expectedUpdatedAt: VERSION })).statusCode).toBe(404);
    const g = fixture({ role: "owner", calendar: false }); const manager = await g.company();
    await expect(g.calendar.requireCalendarEligibleMember(g.db, manager, 41)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(companyFieldworkBlockReason(await g.session(), await g.mobileDetail())).toBeNull();
    expect(isAssignedCompanyFieldActor(await g.session(), await g.mobileDetail())).toBe(false);
    expect((await g.patch({ status: "en_route", expectedUpdatedAt: VERSION })).statusCode).toBe(200);
  });
  it.each(["owner", "dispatcher", "technician"] as const)("%s field status does not grant unrelated permissions", async (role) => {
    const f = fixture({ role }); const c = await f.company();
    expect((await f.patch({ status: "en_route", expectedUpdatedAt: VERSION })).statusCode).toBe(200);
    if (role === "technician") {
      expect(() => context.requireManager(c)).toThrow();
      await expect(f.operations.requireMobilePaymentCollector(f.db, c)).rejects.toMatchObject({ status: 403 });
    } else if (role === "dispatcher") await expect(f.operations.requireMobilePaymentCollector(f.db, c)).rejects.toMatchObject({ status: 403 });
    else await expect(f.operations.requireMobilePaymentCollector(f.db, c)).resolves.toBeUndefined();
    expect((await f.operations.assertMobileJobPhotoAccess(f.req(), 47)).company.role).toBe(role);
    const before = f.changes();
    if (role === "technician") {
      f.row().assigned_user_id = 42;
      await expect(f.operations.assertMobileJobPhotoAccess(f.req(), 47)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(f.changes()).toBe(before);
  });
  it.each(["owner", "dispatcher", "technician"] as const)("actual notes service grants %s only its independent manager permission", async (role) => {
    const f = fixture({ role }); const c = await f.company();
    if (role === "technician") {
      await expect(f.service.updateJobNotes(f.db, c, { jobId: 47, privateNotes: "Offline changed private note" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(f.row().internal_notes).toBe("Private fixture note"); expect(f.events()).toEqual([]);
    } else {
      await expect(f.service.updateJobNotes(f.db, c, { jobId: 47, privateNotes: "Offline changed private note" })).resolves.toEqual({ success: true });
      expect(f.row().internal_notes).toBe("Offline changed private note"); expect(f.row().service_notes).toBe("Customer fixture note");
      expect(f.events()[0].event_type).toBe("private_notes_updated"); expect(f.audits()[0].details).toEqual({ privateNotesChanged: true, serviceNotesChanged: false });
      expect(JSON.stringify(f.events()) + JSON.stringify(f.audits())).not.toContain("Offline changed private note");
    }
  });
  it("documents exact private-notes mobile adapter missing permissions rather than treating a new route as working", async () => {
    const f = fixture(); const companyId = 9; const claims = f.claims;
    const ast = ts.createSourceFile("mobileOperations.ts", source("server/mobileOperations.ts"), ts.ScriptTarget.Latest, true);
    const route = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "updatePrivateJobNotes") as ts.FunctionDeclaration;
    let declaration: ts.VariableStatement | undefined;
    function visit(node: ts.Node) {
      if (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && item.name.text === "company")) declaration = node;
      ts.forEachChild(node, visit);
    }
    visit(route);
    if (!declaration) throw new Error("Exact private-note route Company context missing");
    const javascript = ts.transpileModule(declaration.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
    const adapterCompany = new Function("companyId", "claims", `${javascript}; return company;`)(companyId, claims);
    expect(adapterCompany.permissions).toBeUndefined();
    await expect(f.service.updateJobNotes(f.db, adapterCompany, { jobId: 47, privateNotes: "Must not be sent" })).rejects.toThrow(TypeError);
    expect(f.events()).toEqual([]); expect(f.row().internal_notes).toBe("Private fixture note");
  });
  it("explicit payment capability can enable a dispatcher, never an assigned technician's payment route", async () => {
    const f = fixture({ role: "dispatcher" }); f.member.payment_collection_enabled = 1;
    await expect(f.operations.requireMobilePaymentCollector(f.db, await f.company())).resolves.toBeUndefined();
    const g = fixture({ role: "technician" }); g.member.payment_collection_enabled = 1;
    await expect(g.operations.requireMobilePaymentCollector(g.db, await g.company())).rejects.toMatchObject({ status: 403 });
    expect((await g.patch({ status: "en_route", expectedUpdatedAt: VERSION })).statusCode).toBe(200);
  });
  it("keeps private editing manager-only and technician photo deletion uploader-only in exact routes", () => {
    const notes = source("server/mobileOperations.ts");
    expect(notes).toContain("requireManager(claims.role);");
    expect(notes).toContain('z.object({ privateNotes: z.string().max(4000) }).strict()');
    expect(notes).toContain('await updateJobNotes(db, company, { jobId, privateNotes: input.privateNotes });');
    expect(notes).toContain('company.role === "technician" && Number(photo.uploaded_by_user_id) !== company.userId');
    const ast = ts.createSourceFile("jobService.ts", source("server/jobService.ts"), ts.ScriptTarget.Latest, true);
    const node = ast.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === "updateJobNotes")!;
    expect(node.getText(ast)).toContain("requireManager(company);");
    expect(node.getText(ast)).toContain("await requireOwnedJob(db, company, input.jobId);");
  });
});

describe("real mobile field controller joined to exact offline backend status and canonical readbacks", () => {
  it.each(["owner", "dispatcher", "technician"] as const)("%s On My Way / Arrived-Start / Finish updates history and calendar only after readback, without duplicate taps", async (role) => {
    const f = fixture({ role, assignedUserId: role === "technician" ? 41 : null, calendar: false });
    let state!: CompanyJobState; const calendar = vi.fn();
    const controller = createCompanyJobController({ session: await f.session(), jobId: 47, isCurrent: () => true,
      api: f.api, onState: (next) => { state = next; }, onList: calendar });
    await controller.refresh();
    for (const target of ["en_route", "on_site", "completed"] as const) {
      const run = controller.advance(target);
      expect(await controller.advance(target)).toBe(false);
      expect(await run).toBe(true); expect(state.detail!.status).toBe(target);
      expect(calendar.mock.calls.at(-1)![0][0].status).toBe(target);
      expect(await controller.advance(target)).toBe(false);
    }
    expect(f.api.status).toHaveBeenCalledTimes(3); expect(f.changes()).toBe(3); expect(f.events()).toHaveLength(3); expect(calendar).toHaveBeenCalledTimes(3);
    expect(companyJobMilestoneFields(state.detail!)).toMatchObject({ status: "finished", onMyWayAt: "2026-11-16T12:01:00.000Z", arrivedAt: "2026-11-16T12:02:00.000Z", finishedAt: "2026-11-16T12:03:00.000Z" });
  });
  it.each(["inactive", "demoted", "reassigned", "other Company"])("fresh %s state before write disables progress without mutation", async (change) => {
    const f = fixture({ role: "technician" }); let state!: CompanyJobState;
    const controller = createCompanyJobController({ session: await f.session(), jobId: 47, isCurrent: () => true, api: f.api, onState: (next) => { state = next; } });
    await controller.refresh();
    if (change === "inactive") f.member.is_active = 0;
    if (change === "demoted") f.member.role = "sales" as Role;
    if (change === "reassigned") f.row().assigned_user_id = 42;
    if (change === "other Company") f.row().company_id = 10;
    expect(await controller.advance("en_route")).toBe(false); expect(f.api.status).not.toHaveBeenCalled(); expect(f.changes()).toBe(0); expect(state.detail).toBeNull();
  });
  it("a committed-but-timeout outcome reconciles canonical detail/list without blind retry or claimed success", async () => {
    const f = fixture({ role: "technician" }); const status = f.api.status;
    f.api.status = vi.fn(async (...args: Parameters<CompanyJobTransport["status"]>) => { await status(...args); throw new JobSyncApiError("Offline ambiguous outcome", null, "TIMEOUT"); });
    let state!: CompanyJobState; const calendar = vi.fn();
    const controller = createCompanyJobController({ session: await f.session(), jobId: 47, isCurrent: () => true, api: f.api, onState: (next) => { state = next; }, onList: calendar });
    await controller.refresh(); expect(await controller.advance("en_route")).toBe(false);
    expect(state.detail!.status).toBe("en_route"); expect(state.success).toBeNull(); expect(state.error).toContain("outcome unconfirmed");
    expect(f.api.status).toHaveBeenCalledOnce(); expect(f.changes()).toBe(1); expect(f.events()).toHaveLength(1); expect(calendar).toHaveBeenCalledOnce();
    expect(await controller.advance("en_route")).toBe(false); expect(f.api.status).toHaveBeenCalledOnce();
  });
  it("fresh actor permission refresh never accepts a tenant, token, role or user mismatch", async () => {
    const f = fixture(); const signed = await f.session();
    for (const changed of [{ ...signed, token: "rotated" }, { ...signed, company: { ...signed.company!, id: 10 } },
      { ...signed, user: { ...signed.user, id: 42 } }, { ...signed, user: { ...signed.user, role: "technician" as const } }]) {
      expect(companyJobActorBlockReason(signed, changed)).not.toBeNull();
    }
  });
});
