import React, { act } from "react";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPhotoTestDOM, PhotoTestNode } from "./helpers/company-photo-test-dom";
import { CompanyJobPrivateNotes, type CompanyJobPrivateNotesProps } from "../components/company-job-private-notes";
import {
  canEditCompanyJobPrivateNotes, canReadCompanyJobPrivateNotes,
  normalizeCompanyJobPrivateNotes, normalizeCompanyJobPrivateNotesVersion,
} from "../lib/company-job-private-notes";
import {
  companyJobPrivateNotesWriteBlocked, createCompanyJobPrivateNotesController,
  verifyCompanyJobPrivateNotesAck,
} from "../lib/company-job-private-notes-api";
import { JobSyncApiError, normalizeJobSyncCompanyJobDetail, type JobSyncNativeSession } from "../lib/jobsync-mobile-api";

const mocks = vi.hoisted(() => ({
  focused: true, state: "active", listeners: new Set<(state: string) => void>(),
  session: vi.fn(), detail: vi.fn(),
}));
vi.mock("../lib/jobsync-mobile-api", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getJobSyncMobileSession: mocks.session, getJobSyncCompanyJobDetail: mocks.detail,
}));
vi.mock("expo-router", async () => {
  const R = await import("react");
  return {
    useIsFocused: () => mocks.focused,
    useFocusEffect: (callback: () => void | (() => void)) => R.useEffect(callback, [callback]),
  };
});
vi.mock("@/hooks/use-job-sheet-colors", () => ({
  useJobSheetColors: () => ({ background: "#101319", foreground: "#f8fafc", muted: "#a5a9b2", border: "#2e333c", primary: "#0068ff", error: "#F06A6A" }),
}));
type NativeNode = PhotoTestNode & { nativeProps?: Record<string, any> };
vi.mock("react-native", async () => {
  const R = await import("react");
  const host = (name: string) => (props: Record<string, any>) => R.createElement(name, {
    ref: (node: NativeNode | null) => { if (node) node.nativeProps = props; },
  }, props.children);
  return {
    View: host("native-view"), Text: host("native-text"), TouchableOpacity: host("native-touch"),
    TextInput: host("native-input"), ActivityIndicator: host("native-activity"),
    StyleSheet: { create: (styles: unknown) => styles },
    AppState: {
      get currentState() { return mocks.state; },
      addEventListener: (_name: string, callback: (state: string) => void) => {
        mocks.listeners.add(callback); return { remove: () => mocks.listeners.delete(callback) };
      },
    },
  };
});
const nativeRequire = createRequire(import.meta.url);
const { createRoot } = nativeRequire("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: React.ReactNode) => void; unmount: () => void };
};
const BACKEND = "/home/ubuntu/hsc-mobile-backend-compatibility-2818bb72-20261117/backend-source-2818bb72";
const V0 = "2026-11-17T12:00:00.000Z";
const V1 = "2026-11-17T12:00:01.000Z";
const V2 = "2026-11-17T12:00:02.000Z";

/** Exact AST declarations, not rewritten handlers or regex substitutes. No module side effects. */
function exact(relative: string, names: string[], deps: Record<string, unknown> = {}) {
  const path = `${BACKEND}/${relative}`;
  const text = readFileSync(path, "utf8");
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const declarations = ast.statements.filter((node) => names.includes((node as ts.FunctionDeclaration).name?.text ?? ""));
  expect(declarations).toHaveLength(names.length);
  const code = declarations.map((node) => node.getText(ast).replace(/^export\s+/, "")).join("\n") + `\nmodule.exports = {${names.join(",")}};`;
  const output = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const deny = () => { throw new Error("External backend operation forbidden"); };
  const sandbox = { module: { exports: {} }, fetch: deny, require: deny, process: { env: Object.freeze({}) }, Date, ...deps };
  vm.runInNewContext(output, sandbox, { filename: path, timeout: 2000 });
  return sandbox.module.exports as Record<string, (...args: any[]) => any>;
}
const domain = exact("server/domainErrors.ts", ["DomainError", "domainHttpStatus", "domainMobileCode"]);
const company = exact("server/companyContext.ts", [
  "isCompanyRole", "isManagerRole", "permissionsForRole", "normalizeCompanyTimezone", "createCompanyContext",
  "companyContextFromMobile", "loadCompanyTimezone", "requireManager", "technicianScopeSql",
], { ...domain, DEFAULT_COMPANY_TIMEZONE: "America/Chicago", isSupportedCompanyTimezone: (value: string) => value === "America/Chicago" });
const projector = exact("server/mobileCompanyJobDto.ts", ["asNumber", "asNullableInt", "asIso", "firstNonEmptyString", "projectMobileCompanyJob"]);
let actorSequence = 281800;

function backendFixture(role: "owner" | "dispatcher" | "technician" = "owner", assignment: number | null = null) {
  const actorId = ++actorSequence;
  const session: JobSyncNativeSession = {
    token: `offline-${actorId}`, portal: "company",
    user: { id: actorId, role, name: "Offline Team Member", email: null },
    company: { id: 9, name: "Offline Company", slug: "offline", logoUrl: null, primaryColor: null, accentColor: null },
  };
  const state = {
    row: { id: 42, company_id: 9, customer_id: 12, assigned_user_id: assignment, title: "Offline Job", service_name: "Service", status: "scheduled",
      scheduled_start_at: new Date("2026-11-18T15:00:00Z"), scheduled_end_at: new Date("2026-11-18T16:00:00Z"),
      updated_at: new Date(V0), internal_notes: "Private baseline", service_notes: "Public service instructions", amount: 125,
      address_line1: "123 Fake St", city: "Chicago", customer_name: "Offline Customer", customer_notification_enabled: 1 },
    calls: [] as { sql: string; params: any[] }[], events: [] as any[][], audits: [] as any[][],
    nextVersion: V1, failEvent: false, failAudit: false, active: true, liveRole: role as string, claimedRole: role as string,
    accountType: "company", companyId: 9, reads: 0, patches: 0,
  };
  const execute = vi.fn(async (sql: string, params: any[] = []) => {
    state.calls.push({ sql, params });
    if (sql.startsWith("SELECT timezone FROM companies")) return [[{ timezone: "America/Chicago" }], []];
    if (sql.includes("FROM fs_jobs j JOIN fs_customers")) {
      return [[...(params[0] === state.row.id && params[1] === state.row.company_id ? [{ ...state.row }] : [])], []];
    }
    if (sql.startsWith("SELECT id, customer_id, assigned_user_id")) {
      return [[...(params[0] === state.row.id && params[1] === state.row.company_id ? [{ ...state.row }] : [])], []];
    }
    if (sql.startsWith("UPDATE fs_jobs SET service_notes = COALESCE")) {
      if (params[2] !== state.row.id || params[3] !== state.row.company_id ||
        (sql.includes("AND updated_at = ?") && state.row.updated_at.getTime() !== params[4].getTime())) return [{ affectedRows: 0 }, []];
      if (params[0] !== null) state.row.service_notes = params[0];
      if (params[1] !== null) state.row.internal_notes = params[1];
      state.row.updated_at = new Date(state.nextVersion); // Fake storage ON UPDATE; no actual SQL.
      return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith("INSERT INTO fs_job_events")) {
      if (state.failEvent) throw new Error("Fake event insert failure");
      state.events.push(params); return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith("INSERT INTO fs_audit_logs")) {
      if (state.failAudit) throw new Error("Fake audit insert failure");
      state.audits.push(params); return [{ affectedRows: 1 }, []];
    }
    if (sql.startsWith("SELECT") && ["fs_job_events", "fs_job_payments", "fs_inventory_transactions", "fs_job_photos", "fs_job_site_inspections", "fs_job_line_items", "fs_company_communications", "fs_company_email_deliveries", "fs_job_lifecycle_timing_overrides"].some((table) => sql.includes(`FROM ${table}`))) return [[], []];
    throw new Error(`Unsupported fake SQL: ${sql}`);
  });
  const db = { execute, getConnection: vi.fn(async () => { throw new Error("Transaction adapter not implemented in fixture"); }) };
  // Execute exact notes functions and exact canonical detail service. Unrelated finance/recurrence collaborators are pure fakes.
  const service = exact("server/jobService.ts", [
    "toNumber", "iso", "optimisticClause", "optimisticParams", "concurrencyMessage", "requireOwnedJob",
    "insertJobEvent", "writeCompanyAuditLog", "getJob", "getJobDetail", "lifecycleTimingOverrideForJob", "latestBookingCommunicationOutcome", "updateJobNotes",
  ], { ...domain, ...company,
    confirmationProjection: () => ({ confirmationStatus: "unconfirmed", customerConfirmedAt: null }),
    recurrenceLabelFromParts: () => null, formatServiceName: (name: string) => name,
    firstLifecycleTimestamps: () => ({ enRouteAt: null, onSiteAt: null, completedAt: null }),
    effectiveLifecycleTimestamps: (value: unknown) => value,
    getJobPaymentBalance: async () => ({ jobTotal: 125, paid: 0, refundTotal: 0, appliedEstimateCredit: 0, balance: 125, paymentStatus: "unpaid" }),
  });
  const auth = exact("server/mobileAuth.ts", ["MobileAuthError", "mobileBearerToken", "withLiveMembershipRole", "requireMobileCompany"], {
    verifyMobileAccessToken: async (token: string) => {
      if (token !== session.token) throw new (domain.DomainError as any)("UNAUTHORIZED", "Fake invalid bearer");
      return { accountType: state.accountType, accountId: actorId, companyId: state.companyId, role: state.claimedRole, name: "Offline Team Member" };
    },
    companyProfile: async () => {
      if (!state.active) throw new (domain.DomainError as any)("UNAUTHORIZED", "Fake inactive membership");
      return { user: { role: state.liveRole } };
    }, getDb: async () => db,
  });
  const handlers = exact("server/mobileOperations.ts", ["MobileAuthError", "mobileErrorStatus", "mobileTrpcError", "operationalError", "mobileCompany", "requireManager", "iso", "updatePrivateJobNotes", "jobDetail"], {
    ...domain, ...company, requireMobileCompany: auth.requireMobileCompany, managerRoles: new Set(["owner", "dispatcher"]), z,
    getJobDetail: service.getJobDetail, ...projector,
    signedStorageUrlFromStoredUrl: () => { throw new Error("Storage provider forbidden"); },
    require: (specifier: string) => { if (specifier === "./jobService.js") return service; throw new Error("External module forbidden"); },
  });
  async function invoke(name: "updatePrivateJobNotes" | "jobDetail", body: unknown = {}, token = session.token, jobId = 42) {
    const req = { body, params: { jobId: String(jobId) }, query: {}, header: (name: string) => name === "authorization" ? `Bearer ${token}` : "" };
    let status = 200; let payload: any;
    const res = { status(value: number) { status = value; return res; }, json(value: unknown) { payload = value; return res; } };
    await handlers[name](req, res);
    // HTTP serializes the backend's VM objects/Dates before the real mobile normalizer sees them.
    return { status, payload: JSON.parse(JSON.stringify(payload)) };
  }
  const api = {
    session: vi.fn(async () => {
      const authorized = await auth.requireMobileCompany({ header: () => `Bearer ${session.token}` });
      return { ...session, user: { ...session.user, role: authorized.claims.role } };
    }),
    detail: vi.fn(async () => {
      state.reads++;
      const response = await invoke("jobDetail");
      if (response.status !== 200) throw new JobSyncApiError("Fake detail denied", response.status, response.payload.error.code);
      const detail = normalizeJobSyncCompanyJobDetail(response.payload, 42, 9);
      if (!detail) throw new Error("Actual mobile detail normalizer rejected canonical GET");
      return detail;
    }),
  };
  const write = vi.fn(async (_token: string, _jobId: number, privateNotes: string, expectedUpdatedAt: string) => {
    state.patches++;
    const response = await invoke("updatePrivateJobNotes", { privateNotes, expectedUpdatedAt });
    if (response.status !== 200) throw new JobSyncApiError("Fake safe backend error", response.status, response.payload.error.code);
    return response.payload;
  });
  async function controller(isCurrent: () => boolean = () => true) {
    const detail = await api.detail();
    return { detail, controller: createCompanyJobPrivateNotesController({ session, jobId: 42, detail, isCurrent, api, write }) };
  }
  return { state, db, session, service, invoke, api, write, controller };
}

beforeEach(() => {
  mocks.focused = true; mocks.state = "active"; mocks.listeners.clear(); mocks.session.mockReset(); mocks.detail.mockReset();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Real HTTP forbidden"); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("exact unpublished 2818bb72 notes handler/service acceptance", () => {
  it.each(["owner", "dispatcher"] as const)("%s succeeds with complete context, canonical ack/GET and private-only audit", async (role) => {
    const f = backendFixture(role);
    const response = await f.invoke("updatePrivateJobNotes", { privateNotes: "  SECRET\n  ", expectedUpdatedAt: V0 });
    expect(response.status).toBe(200);
    expect(response.payload).toEqual({ success: true, jobId: 42, privateNotes: "  SECRET\n  ", updatedAt: V1 });
    expect(f.state.row.service_notes).toBe("Public service instructions");
    expect(f.state.events).toEqual([[9, 42, f.session.user.id, "private_notes_updated", "Private notes updated."]]);
    expect(JSON.stringify(f.state.audits)).not.toContain("SECRET");
    const detail = await f.api.detail();
    expect(detail.privateNotes).toBe("  SECRET\n  "); expect(detail.updatedAt).toBe(V1);
  });
  it.each([null, "self", "other"] as const)("technician %s reads same-Company canonical notes but PATCH is forbidden", async (assignment) => {
    const f = backendFixture("technician");
    f.state.row.assigned_user_id = assignment === "self" ? f.session.user.id : assignment === "other" ? 93 : null;
    expect((await f.api.detail()).privateNotes).toBe("Private baseline");
    expect((await f.invoke("updatePrivateJobNotes", { privateNotes: "Denied", expectedUpdatedAt: V0 })).status).toBe(403);
    expect(f.state.events).toHaveLength(0); expect(f.state.calls.some((call) => call.sql.startsWith("UPDATE"))).toBe(false);
  });
  it("uses fresh live technician role despite stale owner claim", async () => {
    const f = backendFixture(); f.state.liveRole = "technician";
    expect((await f.invoke("updatePrivateJobNotes", { privateNotes: "Denied", expectedUpdatedAt: V0 })).status).toBe(403);
    expect(f.state.row.internal_notes).toBe("Private baseline");
  });
  it.each(["tenant", "inactive", "platform", "bearer", "missing job"])("rejects %s before any note mutation", async (kind) => {
    const f = backendFixture();
    if (kind === "tenant") f.state.companyId = 10;
    if (kind === "inactive") f.state.active = false;
    if (kind === "platform") f.state.accountType = "platform_admin";
    const response = await f.invoke("updatePrivateJobNotes", { privateNotes: "Denied", expectedUpdatedAt: V0 }, kind === "bearer" ? "foreign" : f.session.token, kind === "missing job" ? 43 : 42);
    expect(response.status).toBe(kind === "tenant" || kind === "missing job" ? 404 : kind === "platform" ? 403 : 401);
    expect(f.state.events).toHaveLength(0); expect(f.state.row.internal_notes).toBe("Private baseline");
  });
  it.each(["", "   \n\t  ", "x".repeat(4000)])("preserves clear/whitespace/limit semantics (%#)", async (privateNotes) => {
    const f = backendFixture(); const response = await f.invoke("updatePrivateJobNotes", { privateNotes, expectedUpdatedAt: V0 });
    expect(response.status).toBe(200); expect(response.payload.privateNotes).toBe(privateNotes);
  });
  it.each([
    { privateNotes: null }, { privateNotes: 3 }, { privateNotes: "x".repeat(4001) },
    { privateNotes: "x", expectedUpdatedAt: "not-a-version" }, { privateNotes: "x", expectedVersion: V0 },
    { privateNotes: "x", serviceNotes: "public" }, { privateNotes: "x", expectedUpdatedAt: null },
  ])("strict real parser rejects malformed or public fields (%#)", async (body) => {
    const f = backendFixture(); expect((await f.invoke("updatePrivateJobNotes", body)).status).toBe(400);
    expect(f.state.row.internal_notes).toBe("Private baseline"); expect(f.state.events).toHaveLength(0);
  });
  it("stale version produces 409 with zero note/event/audit mutation", async () => {
    const f = backendFixture(); f.state.row.updated_at = new Date(V1);
    const response = await f.invoke("updatePrivateJobNotes", { privateNotes: "Stale", expectedUpdatedAt: V0 });
    expect(response.status).toBe(409); expect(response.payload.error.code).toBe("CONFLICT");
    expect(f.state.row.internal_notes).toBe("Private baseline"); expect(f.state.events).toHaveLength(0); expect(f.state.audits).toHaveLength(0);
    expect(f.state.calls.find((call) => call.sql.startsWith("UPDATE"))?.params[4]).toEqual(new Date(V0));
  });
  it("legacy omitted expectedUpdatedAt remains accepted (client must always supply it)", async () => {
    const f = backendFixture(); expect((await f.invoke("updatePrivateJobNotes", { privateNotes: "Legacy" })).status).toBe(200);
  });
  it("acceptance: note plus audit must rollback if audit fails", async () => {
    const f = backendFixture(); f.state.failAudit = true;
    const response = await f.invoke("updatePrivateJobNotes", { privateNotes: "Must rollback", expectedUpdatedAt: V0 });
    expect(response.status).toBe(400);
    expect(f.state.row.internal_notes).toBe("Private baseline"); // ACTIVE acceptance gate; not an expected defect.
    expect(f.state.events).toHaveLength(0);
  });
  it("acceptance: manager reuse of a colliding persisted version must not overwrite", async () => {
    const f = backendFixture(); f.state.nextVersion = V0; // Persisted timestamp collision model, not a real DB claim.
    expect((await f.invoke("updatePrivateJobNotes", { privateNotes: "Manager A", expectedUpdatedAt: V0 })).status).toBe(200);
    const second = await f.invoke("updatePrivateJobNotes", { privateNotes: "Manager B stale", expectedUpdatedAt: V0 });
    expect(second.status).toBe(409); // ACTIVE acceptance gate; exact service has no advancing version contract.
    expect(f.state.row.internal_notes).toBe("Manager A");
  });
});

describe("real mobile controller wired to exact fake-backed canonical handlers", () => {
  it.each(["owner", "dispatcher"] as const)("%s sends GET version, requires changed ack version plus exact canonical GET", async (role) => {
    const f = backendFixture(role); const { controller, detail } = await f.controller();
    expect((await controller.save("  New private note  ")).status).toBe("saved");
    expect(f.write).toHaveBeenCalledWith(f.session.token, 42, "  New private note  ", V0);
    expect(detail.privateNotes).toBe("Private baseline"); expect(detail.updatedAt).toBe(V0);
    expect((await controller.save("Duplicate")).status).toBe("blocked"); expect(f.state.patches).toBe(1);
  });
  it.each([null, "self", "other"] as const)("technician %s stays GET-only in controller", async (assignment) => {
    const f = backendFixture("technician");
    f.state.row.assigned_user_id = assignment === "self" ? f.session.user.id : assignment === "other" ? 93 : null;
    const { controller, detail } = await f.controller();
    const job = { detail, actor: f.session, loading: false, pending: false, error: null };
    expect(canReadCompanyJobPrivateNotes(f.session, 42, job)).toBe(true); expect(canEditCompanyJobPrivateNotes(f.session, 42, job)).toBe(false);
    expect((await controller.save("Denied")).status).toBe("blocked"); expect(await controller.refresh()).toBe(true); expect(f.write).not.toHaveBeenCalled();
  });
  it("intervening manager edit after preflight is 409 conflict, lock retained until GET-only review", async () => {
    const f = backendFixture(); const { controller } = await f.controller();
    f.write.mockImplementationOnce(async (_token, _id, privateNotes, expectedUpdatedAt) => {
      f.state.row.internal_notes = "Manager A latest"; f.state.row.updated_at = new Date(V1);
      const response = await f.invoke("updatePrivateJobNotes", { privateNotes, expectedUpdatedAt });
      throw new JobSyncApiError("SECRET error must never render", response.status, response.payload.error.code);
    });
    const result = await controller.save("Stale draft"); expect(result.status).toBe("conflict"); expect(result.message).not.toContain("SECRET");
    expect(companyJobPrivateNotesWriteBlocked(f.session, 42)).toBe(true); expect(await controller.refresh()).toBe(true);
    expect(companyJobPrivateNotesWriteBlocked(f.session, 42)).toBe(false); expect(f.write).toHaveBeenCalledTimes(1);
    expect(f.state.row.internal_notes).toBe("Manager A latest");
  });
  it.each(["lost response", "malformed ack", "missing ack version", "same ack version", "different readback version", "missing readback version"])("%s never claims saved or retries; review is GET-only", async (kind) => {
    const f = backendFixture(); const { controller } = await f.controller(); const originalWrite = f.write.getMockImplementation()!;
    f.write.mockImplementationOnce(async (...args) => {
      const ack = await originalWrite(...args);
      if (kind === "lost response") throw new Error("SECRET transport uncertainty");
      if (kind === "malformed ack") return { success: true };
      if (kind === "missing ack version") delete ack.updatedAt;
      if (kind === "same ack version") ack.updatedAt = V0;
      if (kind === "different readback version") f.state.row.updated_at = new Date(V2);
      if (kind === "missing readback version") f.api.detail.mockResolvedValueOnce({ ...(await f.api.detail()), updatedAt: null });
      return ack;
    });
    const result = await controller.save("Submitted SECRET"); expect(result.status).toBe("uncertain"); expect(result.message).not.toContain("SECRET");
    expect(companyJobPrivateNotesWriteBlocked(f.session, 42)).toBe(true);
    const reopened = await f.controller(); expect((await reopened.controller.save("Blind retry")).status).toBe("blocked");
    expect(await reopened.controller.refresh()).toBe(true); expect(f.write).toHaveBeenCalledTimes(1);
    expect((await controller.save("Consumed retry")).status).toBe("blocked");
  });
  it.each(["preflight changed", "live role changed", "wrong tenant", "stale focus"])("%s prevents PATCH", async (kind) => {
    const f = backendFixture(); let current = true; const { controller } = await f.controller(() => current);
    if (kind === "preflight changed") f.state.row.updated_at = new Date(V1);
    if (kind === "live role changed") f.state.liveRole = "technician";
    if (kind === "wrong tenant") f.state.companyId = 10;
    if (kind === "stale focus") current = false;
    expect((await controller.save("Denied")).status).not.toBe("saved"); expect(f.write).not.toHaveBeenCalled();
  });
  it("synchronous duplicate lock survives reopened controller while PATCH is pending", async () => {
    const f = backendFixture(); const { controller, detail } = await f.controller();
    let resolve!: (value: unknown) => void; f.write.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = controller.save("New");
    await vi.waitFor(() => expect(f.write).toHaveBeenCalledTimes(1));
    const other = createCompanyJobPrivateNotesController({ session: f.session, jobId: 42, detail, isCurrent: () => true, api: f.api, write: f.write });
    expect((await other.save("Duplicate")).status).toBe("blocked");
    resolve({ success: true, jobId: 42, privateNotes: "New", updatedAt: V1 });
    expect((await pending).status).toBe("uncertain"); expect(f.write).toHaveBeenCalledTimes(1);
  });
  it("interrupted PATCH completion stays stale and only canonical GET can clear uncertainty", async () => {
    const f = backendFixture(); let current = true; const { controller } = await f.controller(() => current);
    const original = f.write.getMockImplementation()!;
    f.write.mockImplementationOnce(async (...args) => { const ack = await original(...args); current = false; return ack; });
    expect((await controller.save("New")).status).toBe("stale"); expect(companyJobPrivateNotesWriteBlocked(f.session, 42)).toBe(true);
    const reopened = await f.controller(); expect(await reopened.controller.refresh()).toBe(true); expect(f.write).toHaveBeenCalledTimes(1);
  });
});

describe("strict detail/version/ack normalization", () => {
  it.each([null, undefined, "", "not-a-date", "2026-02-30T12:00:00Z", "2026-11-17 12:00:00", "2026-11-17T12:00:00+00:00"])("rejects noncanonical version %s", (value) => {
    expect(normalizeCompanyJobPrivateNotesVersion(value)).toBeNull();
  });
  it("normalizes verified UTC precision only", () => { expect(normalizeCompanyJobPrivateNotesVersion("2026-11-17T12:00:00Z")).toBe(V0); });
  it.each([
    { success: true, jobId: 42, privateNotes: "new" }, { success: true, jobId: 42, privateNotes: "new", updatedAt: null },
    { success: true, jobId: 42, privateNotes: "new", updatedAt: V0 }, { success: true, jobId: 43, privateNotes: "new", updatedAt: V1 },
    { success: true, jobId: "42", privateNotes: "new", updatedAt: V1 }, { success: true, jobId: 42, privateNotes: "other", updatedAt: V1 },
    Object.create({ success: true, jobId: 42, privateNotes: "new", updatedAt: V1 }),
  ])("rejects unverified acknowledgment (%#)", (ack) => { expect(verifyCompanyJobPrivateNotesAck(ack, 42, "new", V0)).toBe(false); });
  it("never falls back to public/customer notes or unverified aliases", () => {
    expect(normalizeCompanyJobPrivateNotes({ notes: "PUBLIC", customer: { notes: "CUSTOMER" }, privateNotes: "UNVERIFIED" })).toBeUndefined();
    expect(normalizeCompanyJobPrivateNotes({ private_notes: "secret", internal_notes: "other" })).toBeUndefined();
    expect(normalizeCompanyJobPrivateNotes({ private_notes: null, internal_notes: null, notes: "PUBLIC" })).toBeNull();
  });
});

describe("actual notes component with exact fake-backed canonical detail", () => {
  let root: ReturnType<typeof createRoot>; let container: PhotoTestNode; let props: CompanyJobPrivateNotesProps;
  function all(node: PhotoTestNode = container): NativeNode[] { return [node as NativeNode, ...node.childNodes.flatMap((child) => all(child))]; }
  function button(label: string) { return all().find((node) => node.nativeProps?.accessibilityLabel === label); }
  async function render() { await act(async () => root.render(<CompanyJobPrivateNotes {...props} />)); }
  async function prepare(role: "owner" | "dispatcher" | "technician" = "owner") {
    const f = backendFixture(role); const detail = await f.api.detail();
    mocks.session.mockImplementation(f.api.session); mocks.detail.mockImplementation(f.api.detail);
    props = { session: f.session, jobId: 42, job: { detail, actor: f.session, loading: false, pending: false, error: null, refresh: vi.fn() }, isCurrent: () => true, writePrivateNotes: f.write };
    await render(); return f;
  }
  async function edit(value = "Draft SECRET") {
    await act(async () => button("Edit private job notes")!.nativeProps!.onPress());
    const input = all().find((node) => node.nativeProps?.testID === "company-job-private-notes-editor")!;
    await act(async () => input.nativeProps!.onChangeText(value));
  }
  beforeEach(() => { const dom = installPhotoTestDOM(); container = dom.createElement("div"); dom.body.appendChild(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); });
  it("saves with versioned writer, never mutates parent detail optimistically", async () => {
    const f = await prepare(); await edit();
    await act(async () => button("Save private job notes")!.nativeProps!.onPress());
    expect(f.write).toHaveBeenCalledWith(f.session.token, 42, "Draft SECRET", V0);
    expect(props.job.detail?.privateNotes).toBe("Private baseline");
    expect(props.job.refresh).toHaveBeenCalledTimes(1); expect(container.textContent).toContain("saved and verified");
  });
  it("unknown completion has no saved feedback, refresh GET-only and no submitted text exposure", async () => {
    const f = await prepare(); f.write.mockRejectedValueOnce(new Error("SERVER SECRET")); await edit();
    await act(async () => button("Save private job notes")!.nativeProps!.onPress());
    expect(container.textContent).not.toContain("SERVER SECRET"); expect(container.textContent).not.toContain("Draft SECRET");
    expect(container.textContent).toContain("Save could not be confirmed"); expect(props.job.refresh).not.toHaveBeenCalled();
    await act(async () => button("Refresh private job notes")!.nativeProps!.onPress());
    expect(f.write).toHaveBeenCalledTimes(1); expect(props.job.refresh).toHaveBeenCalledTimes(1);
  });
  it.each(["background", "focus", "sheet", "tenant", "version"])("retained save callback is fenced after %s change", async (kind) => {
    const f = await prepare(); await edit(); const retained = button("Save private job notes")!.nativeProps!.onPress;
    if (kind === "background") await act(async () => { mocks.state = "background"; mocks.listeners.forEach((listener) => listener("background")); });
    if (kind === "focus") { mocks.focused = false; await render(); }
    if (kind === "sheet") { props = { ...props, isCurrent: () => false }; await render(); }
    if (kind === "tenant") { props = { ...props, session: { ...f.session, company: { ...f.session.company!, id: 10 } } }; await render(); }
    if (kind === "version") { props = { ...props, job: { ...props.job, detail: { ...props.job.detail!, updatedAt: V1 } } }; await render(); }
    await act(async () => retained()); expect(f.write).not.toHaveBeenCalled();
  });
  it("technician displays internal note read-only, no manager editor", async () => {
    await prepare("technician"); expect(container.textContent).toContain("Private baseline"); expect(button("Edit private job notes")).toBeUndefined();
  });
});
