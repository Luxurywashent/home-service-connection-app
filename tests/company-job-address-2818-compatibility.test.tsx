import React, { act } from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyJobAddressEditor, type CompanyJobAddressEditorProps } from "../components/company-job-address-editor";
import {
  companyJobAddressScope, companyJobAddressWriteBlocked, companyJobAddressesEqual, createCompanyJobAddressPayload,
  createCompanyJobAddressController, normalizeCompanyJobAddress, normalizeCompanyJobAddressDetail, verifyCompanyJobAddressAck,
  type CompanyJobAddressDetail, type CompanyJobAddressDraft,
} from "../lib/company-job-address";
import { normalizeJobSyncCompanyJobDetail, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";
const mocks = vi.hoisted(() => ({ focused: true, state: "active", focusCleanup: null as null | (() => void), listeners: new Set<(state: string) => void>() }));
vi.mock("expo-router", async () => {
  const R = await import("react");
  return { useIsFocused: () => mocks.focused, useFocusEffect: (callback: () => void | (() => void)) => R.useEffect(() => {
    if (!mocks.focused) return;
    const cleanup = callback(); mocks.focusCleanup = typeof cleanup === "function" ? cleanup : null;
    return () => { if (typeof cleanup === "function") cleanup(); };
  }, [callback]) };
});
vi.mock("@/hooks/use-job-sheet-colors", () => ({ useJobSheetColors: () => ({ background: "#101319", foreground: "#f8fafc", muted: "#a5a9b2", border: "#2e333c", primary: "#0068ff", error: "#F06A6A" }) }));
type NativeNode = PhotoTestNode & { nativeProps: Record<string, any> };
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, any>) => R.createElement(name, { ref: (node: PhotoTestNode | null) => { if (node) (node as NativeNode).nativeProps = props; } }, props.children);
  return { View: host("native-view"), Text: host("native-text"), TouchableOpacity: host("native-touch"), TextInput: host("native-input"), ActivityIndicator: host("native-activity"), StyleSheet: { create: (styles: unknown) => styles }, AppState: {
    get currentState() { return mocks.state; }, addEventListener: (_name: string, listener: (state: string) => void) => { mocks.listeners.add(listener); return { remove: () => mocks.listeners.delete(listener) }; },
  } };
});
const backend = "/home/ubuntu/hsc-mobile-backend-compatibility-2818bb72-20261117/backend-source-2818bb72/server";
const read = (file: string) => readFileSync(`${backend}/${file}`, "utf8");
/** Compile only named, untouched AST declarations. No source module imports or startup can execute. */
function exact(file: string, names: string[], globals: Record<string, unknown> = {}) {
  const text = read(file);
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const declarations = ast.statements.filter((node) => (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name && names.includes(node.name.text));
  if (declarations.length !== names.length) throw new Error(`Missing exact declarations in ${file}`);
  const output = ts.transpileModule(declarations.map((node) => node.getFullText(ast)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const context = vm.createContext({ ...globals, exports: {}, Date, Set, Map, Error, Number, String, Boolean, JSON, Math });
  vm.runInContext(`${output}\n globalThis.result = {${names.join(",")}}`, context);
  return context.result as Record<string, any>;
}
const domain = exact("domainErrors.ts", ["DomainError", "domainHttpStatus", "domainMobileCode"]);
const context = exact("companyContext.ts", ["isCompanyRole", "isManagerRole", "permissionsForRole", "normalizeCompanyTimezone", "createCompanyContext", "companyContextFromMobile", "loadCompanyTimezone", "requireManager", "technicianScopeSql"], {
  ...domain, DEFAULT_COMPANY_TIMEZONE: "America/Chicago", isSupportedCompanyTimezone: (tz: string) => tz === "America/Chicago",
});
const project = exact("mobileCompanyJobDto.ts", ["asNumber", "asNullableInt", "asIso", "firstNonEmptyString", "projectMobileCompanyJob"]).projectMobileCompanyJob;
const noProvider = vi.fn(() => { throw new Error("Provider must not execute for address mutation"); });
const service = exact("jobService.ts", ["toNumber", "iso", "latestBookingCommunicationOutcome", "effectiveLifecycleTimestamps", "withTransaction", "writeCompanyAuditLog", "insertJobEvent", "optimisticClause", "optimisticParams", "concurrencyMessage", "requireOwnedJob", "mapListedJob", "listJobs", "getJob", "lifecycleTimingOverrideForJob", "getJobDetail", "updateJobAddress"], {
  ...domain, requireManager: context.requireManager, technicianScopeSql: context.technicianScopeSql,
  formatServiceName: (v: string) => v,
  confirmationProjection: () => ({ confirmationStatus: "unconfirmed", customerConfirmedAt: null }),
  recurrenceLabelFromParts: () => null,
  firstLifecycleTimestamps: () => ({ enRouteAt: null, onSiteAt: null, completedAt: null }),
  getJobPaymentBalance: async () => ({ jobTotal: 125, paid: 0, refundTotal: 0, appliedEstimateCredit: 0, balance: 125, paymentStatus: "unpaid" }),
  listJobPaymentBalances: async () => new Map(),
  attemptBookingConfirmationAfterCommit: noProvider, createCustomer: noProvider, generatePublicToken: noProvider,
});
let sequence = 20000;
const version = "2026-11-17T18:00:00.000Z", advanced = "2026-11-17T18:00:01.000Z";
const draft: CompanyJobAddressDraft = { addressLine1: "  22 New Street  ", city: " Austin ", region: " TX ", postalCode: " 78701 " };
function fixture(role: "owner" | "dispatcher" | "technician" = "owner", assignment: number | null = 93) {
  const companyId = ++sequence;
  const session: JobSyncNativeSession = { portal: "company", token: `offline-address-${companyId}`, user: { id: 71, name: "Offline Team Member", email: null, role }, company: { id: companyId, name: "Offline Company", slug: "offline", logoUrl: null, primaryColor: null, accentColor: null } };
  let stored: Record<string, any> = { id: 42, company_id: companyId, customer_id: 12, assigned_user_id: assignment, title: "Offline Job", service_name: "Service", status: "scheduled", scheduled_start_at: "2026-12-01T15:00:00Z", scheduled_end_at: "2026-12-01T16:00:00Z", updated_at: version, address_line1: "1 Old Street", city: "Old City", region: "FL", postal_code: "32541", amount: 125, subtotal_amount: 125, discount_amount: 0, tax_amount: 0, tax_rate_bps: 0, customer_name: "Offline Customer", customer_notification_enabled: 0 };
  let snapshot: Record<string, any> | null = null, logSnapshot = 0, sameVersion = false, failAudit = false;
  const calls: { sql: string; params: any[] }[] = [];
  const events: any[][] = [];
  const begin = vi.fn(async () => { snapshot = { ...stored }; logSnapshot = events.length; });
  const commit = vi.fn(async () => { snapshot = null; });
  const rollback = vi.fn(async () => { if (snapshot) stored = snapshot; events.splice(logSnapshot); });
  const release = vi.fn();
  const execute = vi.fn(async (sql: string, params: any[] = []) => {
    calls.push({ sql, params });
    if (sql.startsWith("SELECT timezone FROM companies")) return [[{ timezone: "America/Chicago" }]];
    if (sql.startsWith("UPDATE fs_jobs SET address_line1")) {
      if (params[4] !== stored.id || params[5] !== stored.company_id || (params.length === 7 && new Date(params[6]).getTime() !== Date.parse(stored.updated_at))) return [{ affectedRows: 0 }];
      [stored.address_line1, stored.city, stored.region, stored.postal_code] = params;
      if (!sameVersion) stored.updated_at = advanced;
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith("INSERT INTO fs_job_events")) { events.push(params); return [{ affectedRows: 1 }]; }
    if (sql.startsWith("INSERT INTO fs_audit_logs")) { if (failAudit) throw new Error("Fake audit unavailable"); events.push(params); return [{ affectedRows: 1 }]; }
    if (sql.startsWith("SELECT id, customer_id")) return [[...(params[0] === stored.id && params[1] === stored.company_id ? [{ ...stored }] : [])]];
    if (sql.includes("FROM fs_jobs j JOIN fs_customers c")) {
      const matches = sql.includes("WHERE j.id = ?") ? params[0] === stored.id && params[1] === stored.company_id : params[0] === stored.company_id;
      return [[...(matches ? [{ ...stored }] : [])]];
    }
    if (sql.startsWith("SELECT id, price_book_item_id")) return [[{ id: 1, price_book_item_id: 2, name: "Service", quantity: 1, unit_price: 125, total_price: 125, sort_order: 0 }]];
    if (sql.startsWith("SELECT") && /fs_job_events|fs_job_payments|fs_inventory_transactions|fs_job_photos|fs_job_site_inspections|fs_job_line_items|fs_company_communications|fs_company_email_deliveries|fs_job_lifecycle_timing_overrides/.test(sql)) return [[]];
    throw new Error(`Unexpected offline SQL: ${sql}`);
  });
  const connection = { execute, beginTransaction: begin, commit, rollback, release };
  const db = { execute, getConnection: vi.fn(async () => connection) };
  let actualActor = session;
  const auth = vi.fn(async () => ({ claims: { accountId: actualActor.user.id, role: actualActor.user.role, name: actualActor.user.name }, companyId: actualActor.company!.id, db }));
  const handlers = exact("mobileOperations.ts", ["MobileAuthError", "mobileErrorStatus", "mobileTrpcError", "operationalError", "mobileCompany", "requireManager", "iso", "updateJobAddressRoute", "jobDetail", "jobsList"], {
    z, ...domain, ...service, ...context, requireMobileCompany: auth, managerRoles: new Set(["owner", "dispatcher"]), projectMobileCompanyJob: project,
    signedStorageUrlFromStoredUrl: (v: string) => v,
    mobilePageRequest: () => ({ limit: 100, position: null, makeCursor: () => null }),
  });
  async function route(name: string, body: unknown = {}, jobId = 42) {
    let status = 200, payload: any;
    const res = { status: (value: number) => { status = value; return res; }, json: (value: unknown) => { payload = JSON.parse(JSON.stringify(value)); return res; } };
    await handlers[name]({ body, params: { jobId: String(jobId) }, query: {}, headers: { authorization: `Bearer ${session.token}` } }, res);
    return { status, payload };
  }
  async function detail(): Promise<CompanyJobAddressDetail> {
    const response = await route("jobDetail");
    if (response.status !== 200) throw new Error("Fake canonical detail denied");
    const normalized = normalizeJobSyncCompanyJobDetail(response.payload, 42, companyId);
    if (!normalized) throw new Error("Actual mobile detail parser rejected exact DTO");
    // Explicit PARENT INTEGRATION fixture: optional existing aliases lack complete snapshot availability evidence.
    return { ...normalized, serviceAddress: normalizeCompanyJobAddressDetail(response.payload.job) };
  }
  const api = { session: vi.fn(async () => actualActor), detail: vi.fn(async () => detail()) };
  const write = vi.fn(async (_token: string, id: number, mutation: unknown) => {
    const result = await route("updateJobAddressRoute", mutation, id);
    if (result.status !== 200) throw Object.assign(new Error("Fake REST denied"), { status: result.status, code: result.payload.error.code });
    return result.payload;
  });
  const onVerified = vi.fn(async (saved: CompanyJobAddressDetail, current: () => boolean) => {
    const list = (await route("jobsList")).payload.jobs;
    const row = list.find((item: any) => item.id === saved.id);
    return current() && row?.updatedAt === saved.updatedAt && row?.addressLine1 === saved.serviceAddress?.addressLine1 && row?.city === saved.serviceAddress?.city;
  });
  const controller = async (isCurrent = () => true) => createCompanyJobAddressController({ session, baseline: await detail(), api, write, onVerified, isCurrent });
  return { companyId, session, api, write, onVerified, controller, route, detail, calls, events, begin, commit, rollback, release,
    stored: () => ({ ...stored }), actor: (actor: JobSyncNativeSession) => { actualActor = actor; }, change: (patch: Record<string, unknown>) => Object.assign(stored, patch),
    sameVersion: () => { sameVersion = true; }, failAudit: () => { failAudit = true; } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }

describe("exact bearer authority uses live active Team Member role, fake JWT/SQL only", () => {
  function authority(options: { role?: string; revoked?: boolean; active?: boolean; accountType?: string } = {}) {
    const execute = vi.fn(async (sql: string, params: unknown[]) => {
      expect(sql).toContain("cu.is_active = 1 AND c.workspace_status = 'active'");
      expect(params).toEqual([71, 9]);
      return options.active === false ? [[]] : [[{ id: 71, company_id: 9, role: options.role ?? "owner", first_name: "Team", last_name: "Member" }]];
    });
    const revoked = vi.fn(async () => options.revoked === true);
    const verify = vi.fn(async () => ({ payload: { accountType: options.accountType ?? "company", kind: options.accountType === "platform_admin" ? "mobile_platform_admin" : "mobile_company", accountId: 71, companyId: 9, role: "owner", name: "Team Member" } }));
    const auth = exact("mobileAuth.ts", ["MobileAuthError", "mobileSecret", "mobileDate", "mobileBearerToken", "verifyMobileAccessToken", "companyProfile", "withLiveMembershipRole", "requireMobileCompany"], {
      process: { env: { JWT_SECRET: "offline-test-only" } }, TextEncoder, MOBILE_AUDIENCE: "hsc-mobile", jwtVerify: verify,
      getDb: async () => ({ execute }), isCompanySessionRevoked: revoked, signedStorageUrlFromStoredUrl: () => null,
    });
    const req = { header: () => "Bearer offline-address-authority" };
    return { auth, execute, revoked, verify, req };
  }
  it.each(["owner", "dispatcher", "technician"])("live %s role overrides the minted owner snapshot", async (role) => {
    const f = authority({ role }); const result = await f.auth.requireMobileCompany(f.req);
    expect(result.claims.role).toBe(role); expect(result.companyId).toBe(9);
    expect(f.verify).toHaveBeenCalledTimes(1); expect(f.revoked).toHaveBeenCalledTimes(1); expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it.each(["revoked", "inactive", "platform"])("%s authority cannot enter the Company handler", async (kind) => {
    const f = authority({ revoked: kind === "revoked", active: kind !== "inactive", accountType: kind === "platform" ? "platform_admin" : "company" });
    await expect(f.auth.requireMobileCompany(f.req)).rejects.toMatchObject({ status: kind === "platform" ? 403 : 401 });
  });
});

describe("BACKEND REQUIREMENT — mandatory expected version (defect is not acceptance)", () => {
  it("must reject omitted expectedUpdatedAt before SQL as documented, instead of an unversioned write", async () => {
    const f = fixture();
    const response = await f.route("updateJobAddressRoute", { addressLine1: "Unversioned overwrite" });
    expect(response.status).toBe(400);
    expect(f.begin).not.toHaveBeenCalled();
  });
});

describe("exact 2818bb72 address REST schema/service/DTO with isolated SQL", () => {
  beforeEach(() => { noProvider.mockClear(); });
  afterEach(() => expect(noProvider).not.toHaveBeenCalled());
  it.each(["owner", "dispatcher"] as const)("%s updates only the saved Job snapshot and canonical GET/list agree", async (role) => {
    const f = fixture(role); const before = f.stored();
    const response = await f.route("updateJobAddressRoute", createCompanyJobAddressPayload(draft, version));
    expect(response.status).toBe(200);
    expect(response.payload.address).toEqual({ addressLine1: "22 New Street", city: "Austin", region: "TX", postalCode: "78701" });
    expect(response.payload.updatedAt).toBe(advanced);
    expect(response.payload.job).not.toHaveProperty("companyId");
    const canonical = await f.detail(); expect(canonical.serviceAddress).toEqual(response.payload.address);
    const list = (await f.route("jobsList")).payload.jobs[0]; expect(list.addressLine1).toBe("22 New Street"); expect(list.city).toBe("Austin");
    expect(list).not.toHaveProperty("region"); expect(list).not.toHaveProperty("postalCode");
    expect(f.begin).toHaveBeenCalledTimes(1); expect(f.commit).toHaveBeenCalledTimes(1); expect(f.rollback).not.toHaveBeenCalled(); expect(f.release).toHaveBeenCalledTimes(1);
    expect(f.calls.some((c) => c.sql.endsWith("LIMIT 1 FOR UPDATE"))).toBe(true);
    expect(f.calls.filter((c) => /^(UPDATE|INSERT|DELETE)/.test(c.sql)).map((c) => c.sql.split(" ").slice(0, 3).join(" "))).toEqual(["UPDATE fs_jobs SET", "INSERT INTO fs_job_events", "INSERT INTO fs_audit_logs"]);
    expect(f.events[0]).toEqual([f.companyId, 42, 71, "job_address_updated", "Job service address updated."]);
    const after = f.stored(); for (const key of Object.keys(before).filter((key) => !["address_line1", "city", "region", "postal_code", "updated_at"].includes(key))) expect(after[key]).toEqual(before[key]);
  });
  it.each([71, null, 93])("technician assigned=%s receives 403 before address SQL", async (assigned) => {
    const f = fixture("technician", assigned); const before = f.stored();
    expect((await f.route("updateJobAddressRoute", createCompanyJobAddressPayload(draft, version))).status).toBe(403);
    expect(f.stored()).toEqual(before); expect(f.begin).not.toHaveBeenCalled(); expect(f.events).toEqual([]);
  });
  it("cross-Company saved Job returns 404 with no mutation/event and rollback", async () => {
    const f = fixture(); const before = f.stored(); f.actor({ ...f.session, company: { ...f.session.company!, id: f.companyId + 1 } });
    expect((await f.route("updateJobAddressRoute", createCompanyJobAddressPayload(draft, version))).status).toBe(404);
    expect(f.stored()).toEqual(before); expect(f.events).toEqual([]); expect(f.rollback).toHaveBeenCalledTimes(1);
  });
  it("stale expectedUpdatedAt conflicts atomically, without event/audit", async () => {
    const f = fixture(); f.change({ updated_at: advanced }); const before = f.stored();
    const response = await f.route("updateJobAddressRoute", createCompanyJobAddressPayload(draft, version));
    expect(response.status).toBe(409); expect(response.payload.error.code).toBe("CONFLICT"); expect(f.stored()).toEqual(before); expect(f.events).toEqual([]); expect(f.rollback).toHaveBeenCalledTimes(1);
  });
  it.each([{}, { city: null, region: null, postalCode: null }, { city: " ", region: " ", postalCode: " " }])("omitted/null/whitespace optional fields clear to null: %j", async (extra) => {
    const f = fixture(); const response = await f.route("updateJobAddressRoute", { addressLine1: " New Street ", expectedUpdatedAt: version, ...extra });
    expect(response.status).toBe(200); expect(response.payload.address).toEqual({ addressLine1: "New Street", city: null, region: null, postalCode: null });
  });
  it.each([{ addressLine1: "" }, { addressLine1: " " }, { addressLine1: null }, { addressLine1: "a".repeat(256) }, { addressLine1: "New", city: "a".repeat(97) }, { addressLine1: "New", postalCode: "a".repeat(25) }, { addressLine1: "New", customerId: 99 }, { addressLine1: "New", expectedUpdatedAt: "invalid" }])("invalid/foreign strict body rejected before mutation: %j", async (body) => {
    const f = fixture(); expect((await f.route("updateJobAddressRoute", body)).status).toBe(400); expect(f.begin).not.toHaveBeenCalled(); expect(f.events).toEqual([]);
  });
  it("audit failure rolls address and event back", async () => {
    const f = fixture(); const before = f.stored(); f.failAudit();
    expect((await f.route("updateJobAddressRoute", createCompanyJobAddressPayload(draft, version))).status).toBe(400);
    expect(f.stored()).toEqual(before); expect(f.events).toEqual([]); expect(f.rollback).toHaveBeenCalledTimes(1);
  });
  it("documents parser/OpenAPI mismatch: runtime accepts omitted expectedUpdatedAt (not safe client usage)", async () => {
    const f = fixture(); expect((await f.route("updateJobAddressRoute", { addressLine1: "Unversioned" })).status).toBe(200);
    expect(f.calls.find((call) => call.sql.startsWith("UPDATE fs_jobs"))?.params).toHaveLength(6);
    expect(read("mobileOperations.ts")).toContain('required: ["addressLine1", "expectedUpdatedAt"]');
  });
});

describe("owned immutable mobile address controller (parent-normalization callback fixture)", () => {
  it.each(["owner", "dispatcher"] as const)("%s saves once only after exact ACK + fresh GET + canonical list", async (role) => {
    const f = fixture(role); const c = await f.controller(); const result = await c.save(draft);
    expect(result.status).toBe("saved"); expect(f.write).toHaveBeenCalledTimes(1); expect(f.onVerified).toHaveBeenCalledTimes(1);
    expect(f.write.mock.calls[0][2]).toEqual({ addressLine1: "22 New Street", city: "Austin", region: "TX", postalCode: "78701", expectedUpdatedAt: version });
    expect(Object.isFrozen(f.write.mock.calls[0][2])).toBe(true);
    expect((await c.save(draft)).status).toBe("blocked"); expect(companyJobAddressWriteBlocked(f.session, 42)).toBe(false);
  });
  it("integrated canonical adapter retains complete saved address while incomplete evidence remains unavailable", async () => {
    const f = fixture(); const wire = (await f.route("jobDetail")).payload;
    const normalized = normalizeJobSyncCompanyJobDetail(wire, 42, f.companyId)!;
    expect(normalized.serviceAddress).toEqual(normalizeCompanyJobAddressDetail(wire.job));
    delete wire.job.region;
    const incomplete = normalizeJobSyncCompanyJobDetail(wire, 42, f.companyId)!;
    expect(incomplete.serviceAddress).toBeUndefined();
    const c = createCompanyJobAddressController({ session: f.session, baseline: incomplete, api: f.api, write: f.write, onVerified: f.onVerified, isCurrent: () => true });
    expect((await c.save(draft)).status).toBe("blocked"); expect(f.write).not.toHaveBeenCalled();
  });
  it.each([71, null, 93])("technician assigned=%s cannot create a mutation", async (assignment) => {
    const f = fixture("technician", assignment); expect(companyJobAddressScope(f.session)).toBeNull(); const c = await f.controller();
    expect((await c.save(draft)).status).toBe("blocked"); expect(f.write).not.toHaveBeenCalled();
  });
  it.each(["role", "token", "company", "actor"]) ("fresh signed %s change blocks before PATCH", async (kind) => {
    const f = fixture(); const c = await f.controller();
    f.actor({ ...f.session, token: kind === "token" ? "new-offline" : f.session.token, company: { ...f.session.company!, id: kind === "company" ? f.companyId + 1 : f.companyId }, user: { ...f.session.user, role: kind === "role" ? "technician" : "owner", id: kind === "actor" ? 88 : 71 } });
    expect((await c.save(draft)).status).toBe("blocked"); expect(f.write).not.toHaveBeenCalled();
  });
  it("changed Job version is preflight conflict with no PATCH", async () => {
    const f = fixture(); const c = await f.controller(); f.change({ updated_at: advanced }); expect((await c.save(draft)).status).toBe("conflict"); expect(f.write).not.toHaveBeenCalled();
  });
  it("tenant/provenance mismatch or missing version cannot write", async () => {
    for (const patch of [{ companyId: null }, { companyId: 999 }, { updatedAt: null }, { customerId: 0 }]) {
      const f = fixture(); const c = createCompanyJobAddressController({ session: f.session, baseline: { ...await f.detail(), ...patch }, api: f.api, write: f.write, onVerified: f.onVerified, isCurrent: () => true });
      expect((await c.save(draft)).status).toBe("blocked"); expect(f.write).not.toHaveBeenCalled();
    }
  });
  it("duplicate concurrent controllers share one lifetime lock and capture the draft before await", async () => {
    const f = fixture(); const c = await f.controller(), second = await f.controller(); const wait = deferred<JobSyncNativeSession>(); f.api.session.mockReturnValueOnce(wait.promise);
    const mutable = { ...draft }; const saving = c.save(mutable); mutable.addressLine1 = "Changed after tap";
    expect((await second.save(draft)).status).toBe("blocked"); wait.resolve(f.session); expect((await saving).status).toBe("saved");
    expect(f.write).toHaveBeenCalledTimes(1); expect((f.write.mock.calls[0][2] as any).addressLine1).toBe("22 New Street");
  });
  it.each(["lost", "malformed", "mismatch", "list", "version"])("%s result stays uncertain, requires GET-only review, never retries", async (kind) => {
    const f = fixture(); const originalWrite = f.write.getMockImplementation()!;
    if (kind === "version") f.sameVersion();
    if (kind === "list") f.onVerified.mockResolvedValue(false);
    if (["lost", "malformed", "mismatch"].includes(kind)) f.write.mockImplementation(async (token, id, mutation) => {
      const ack = await originalWrite(token, id, mutation);
      if (kind === "lost") throw new Error("Response lost after commit");
      if (kind === "malformed") return { success: true };
      return { ...ack, address: { ...ack.address, city: "Wrong" } };
    });
    const c = await f.controller(); expect((await c.save(draft)).status).toBe("uncertain"); expect(f.stored().address_line1).toBe("22 New Street");
    expect(companyJobAddressWriteBlocked(f.session, 42)).toBe(true); expect((await c.save(draft)).status).toBe("blocked");
    const reopened = await f.controller(); expect((await reopened.save(draft)).status).toBe("blocked");
    f.onVerified.mockResolvedValue(true); expect(await reopened.refresh()).not.toBeNull(); expect(f.write).toHaveBeenCalledTimes(1);
    expect(companyJobAddressWriteBlocked(f.session, 42)).toBe(false); expect((await c.save(draft)).status).toBe("blocked");
  });
  it("in-flight conflict never resubmits, honest canonical read-only review", async () => {
    const f = fixture(); const c = await f.controller(); const original = f.write.getMockImplementation()!;
    f.write.mockImplementation(async (token, id, mutation) => { f.change({ updated_at: advanced, address_line1: "Another manager" }); return original(token, id, mutation); });
    expect((await c.save(draft)).status).toBe("uncertain"); expect(f.stored().address_line1).toBe("Another manager"); expect(await c.refresh()).not.toBeNull(); expect(f.write).toHaveBeenCalledTimes(1);
  });
  it.each(["preflight", "inflight"])("stale sheet/focus/background during %s never publishes", async (phase) => {
    const f = fixture(); let current = true; const c = await f.controller(() => current);
    if (phase === "preflight") { const wait = deferred<JobSyncNativeSession>(); f.api.session.mockReturnValueOnce(wait.promise); const saving = c.save(draft); current = false; wait.resolve(f.session); expect((await saving).status).toBe("stale"); expect(f.write).not.toHaveBeenCalled(); }
    else { const original = f.write.getMockImplementation()!; f.write.mockImplementation(async (token, id, mutation) => { const ack = await original(token, id, mutation); current = false; return ack; }); expect((await c.save(draft)).status).toBe("stale"); expect(f.onVerified).not.toHaveBeenCalled(); expect(companyJobAddressWriteBlocked(f.session, 42)).toBe(true); }
  });
  it("raw detail normalization never invents null or uses customer-profile fallback", () => {
    expect(normalizeCompanyJobAddressDetail({ customer_address: "Customer primary", city: null, region: null, postal_code: null })).toBeUndefined();
    expect(normalizeCompanyJobAddress({ addressLine1: "Main", city: null })).toBeUndefined();
    expect(normalizeCompanyJobAddressDetail({ address_line1: "Main", addressLine1: "Other", city: null, region: null, postal_code: null })).toBeUndefined();
    expect(companyJobAddressesEqual(normalizeCompanyJobAddress({ addressLine1: null, city: null, region: null, postalCode: null }), undefined)).toBe(false);
    expect(() => createCompanyJobAddressPayload({ ...draft, city: null } as any, version)).toThrow();
  });
  it("wrong Job/customer/Company/version acknowledgment cannot claim saved", async () => {
    const f = fixture(); const baseline = await f.detail(); const mutation = createCompanyJobAddressPayload(draft, version); const ack = (await f.route("updateJobAddressRoute", mutation)).payload;
    expect(verifyCompanyJobAddressAck(ack, baseline, mutation)).toBe(true);
    for (const patch of [{ id: 99 }, { customerId: 99 }, { companyId: 99 }, { updatedAt: version }]) expect(verifyCompanyJobAddressAck({ ...ack, job: { ...ack.job, ...patch } }, baseline, mutation)).toBe(false);
  });
});

const nativeRequire = createRequire(import.meta.url);
const { createRoot } = nativeRequire("react-dom/client") as { createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void } };
describe("real owned editor lifecycle with minimal ReactDOM host (not native device)", () => {
  let root: ReturnType<typeof createRoot>, container: PhotoTestNode, props: CompanyJobAddressEditorProps, f: ReturnType<typeof fixture>;
  function find(label: string) {
    const walk = (node: PhotoTestNode): NativeNode[] => [node as NativeNode, ...node.childNodes.flatMap(walk)];
    return walk(container).find((node) => node.nativeProps?.accessibilityLabel === label)?.nativeProps;
  }
  async function render(patch: Partial<CompanyJobAddressEditorProps> = {}) { props = { ...props, ...patch }; await act(async () => root.render(<CompanyJobAddressEditor {...props} />)); }
  async function state(next: string) { await act(async () => { mocks.state = next; mocks.listeners.forEach((listener) => listener(next)); }); }
  async function open() { await render(); await act(async () => find("Edit Job address")!.onPress()); await act(async () => find("Street address")!.onChangeText("22 New Street")); }
  beforeEach(async () => {
    mocks.focused = true; mocks.state = "active";
    const doc = installPhotoTestDOM(); container = doc.createElement("main"); doc.body.appendChild(container); root = createRoot(container);
    f = fixture(); const detail = await f.detail(); props = { session: f.session, jobId: 42, job: { detail, actor: f.session, loading: false, pending: false, error: null }, api: f.api, writeAddress: f.write, isCurrent: () => true, onVerified: f.onVerified, onSaved: vi.fn() };
  });
  afterEach(async () => { await act(async () => root.unmount()); expect(mocks.listeners.size).toBe(0); });
  it("retains all structured values; blank city explicitly clears and canonical-only saved publication", async () => {
    await open(); expect(find("State or region")!.value).toBe("FL"); expect(find("Postal code")!.value).toBe("32541");
    await act(async () => find("City")!.onChangeText("")); await act(async () => find("Save Job address")!.onPress());
    expect(f.write).toHaveBeenCalledTimes(1); expect((f.write.mock.calls[0][2] as any).city).toBeNull(); expect((f.write.mock.calls[0][2] as any).region).toBe("FL");
    expect(props.onSaved).toHaveBeenCalledTimes(1); expect(container.textContent).toContain("saved and verified");
  });
  it.each(["assigned", "unassigned", "other"])("technician %s sees no manager editor even with writer", async () => {
    const actor = { ...f.session, user: { ...f.session.user, role: "technician" as const } };
    await render({ session: actor, job: { ...props.job, actor } }); expect(find("Edit Job address")).toBeUndefined(); expect(container.textContent).toBe("");
  });
  it.each(["guard", "parent", "focus", "background", "tenant", "role", "version", "writer", "unmount"])("retained save after %s never writes", async (kind) => {
    await open(); const save = find("Save Job address")!.onPress;
    if (kind === "guard") await render({ isCurrent: () => false });
    if (kind === "parent") await render({ isCurrent: () => true });
    if (kind === "focus") { await act(async () => mocks.focusCleanup?.()); mocks.focused = false; await render(); }
    if (kind === "background") { await state("background"); await state("active"); }
    if (kind === "tenant") await render({ job: { ...props.job, detail: { ...props.job.detail!, companyId: 99 } } });
    if (kind === "role") await render({ session: { ...f.session, user: { ...f.session.user, role: "technician" } } });
    if (kind === "version") await render({ job: { ...props.job, detail: { ...props.job.detail!, updatedAt: advanced } } });
    if (kind === "writer") await render({ writeAddress: vi.fn() });
    if (kind === "unmount") await act(async () => root.render(null));
    await act(async () => save()); expect(f.write).not.toHaveBeenCalled(); expect(props.onSaved).not.toHaveBeenCalled();
  });
  it("cancel/reopen never revives retained save or input callbacks", async () => {
    await open(); const oldSave = find("Save Job address")!.onPress, oldChange = find("Street address")!.onChangeText;
    await act(async () => find("Cancel address edit")!.onPress()); await act(async () => find("Edit Job address")!.onPress());
    await act(async () => oldChange("Stale draft")); await act(async () => oldSave()); expect(f.write).not.toHaveBeenCalled(); expect(find("Street address")!.value).toBe("1 Old Street");
  });
  it("lost response never displays saved, and review is GET-only", async () => {
    const original = f.write.getMockImplementation()!; f.write.mockImplementation(async (token, id, mutation) => { await original(token, id, mutation); throw new Error("Lost response"); });
    await open(); await act(async () => find("Save Job address")!.onPress()); expect(container.textContent).toContain("could not be confirmed"); expect(props.onSaved).not.toHaveBeenCalled();
    await act(async () => find("Refresh and review Job address")!.onPress()); expect(f.write).toHaveBeenCalledTimes(1); expect(props.onSaved).toHaveBeenCalledTimes(1);
  });
});
