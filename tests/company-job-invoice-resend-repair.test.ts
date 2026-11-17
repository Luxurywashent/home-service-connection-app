import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  assertCompanyJobInvoiceJob, assertCompanyJobInvoiceSession,
  captureCompanyJobInvoiceIntent, createCompanyJobInvoiceOptions,
} from "../lib/company-job-invoice-intent";

function session(role = "owner") {
  return { token: "synthetic-invoice-token", portal: "company", company: { id: 9 }, user: { id: 42, role } };
}
function captured(method: "email" | "sms" = "email", resend = false) {
  return captureCompanyJobInvoiceIntent(session(), { id: "12", companyId: 9 }, createCompanyJobInvoiceOptions(method, resend));
}

describe("Company invoice captured options (no transport or override)", () => {
  it("initial/default and each fresh open reset to email and resend false", () => {
    const first = createCompanyJobInvoiceOptions();
    expect(first).toEqual({ method: "email", resend: false });
    const explicit = createCompanyJobInvoiceOptions("sms", true);
    expect(explicit.resend).toBe(true);
    expect(createCompanyJobInvoiceOptions()).toEqual(first);
    expect(createCompanyJobInvoiceOptions()).not.toBe(first);
  });
  it.each(["email", "sms"] as const)("%s preserves explicit false and true choices", (method) => {
    for (const resend of [false, true]) expect(captured(method, resend).options).toEqual({ method, resend });
  });
  it.each([null, "true", "false", 0, 1, {}, []])("rejects nonboolean resend %j", (value) => {
    expect(() => createCompanyJobInvoiceOptions("email", value as any)).toThrow("explicit resend");
  });
  it.each(["push", "EMAIL", "", null, undefined, 1])("rejects invalid method %j", (method) => {
    // undefined means the declared default, rather than an invalid choice.
    if (method === undefined) expect(createCompanyJobInvoiceOptions(undefined)).toEqual({ method: "email", resend: false });
    else expect(() => createCompanyJobInvoiceOptions(method as any)).toThrow("delivery method");
  });
  it("captures primitives and freezes nested options before await, ignoring unsupported fields", async () => {
    const signed = session(); const job = { id: "12", companyId: 9 };
    const draft: any = { method: "sms", resend: true, recipientEmail: "override@example.test", overridePhone: "ignored", amount: 1 };
    const intent = captureCompanyJobInvoiceIntent(signed, job, draft);
    const afterAwait = Promise.resolve().then(() => intent);
    signed.token = "changed"; signed.company.id = 99; signed.user.id = 43; signed.user.role = "technician";
    job.id = "13"; job.companyId = 99; draft.method = "email"; draft.resend = false;
    expect(await afterAwait).toEqual({ token: "synthetic-invoice-token", companyId: 9, userId: 42, role: "owner", jobId: 12, options: { method: "sms", resend: true } });
    expect(Object.isFrozen(intent)).toBe(true); expect(Object.isFrozen(intent.options)).toBe(true);
    expect(Object.keys(intent.options)).toEqual(["method", "resend"]);
  });
  it.each(["owner", "dispatcher"])("permits current signed %s without fieldwork/payment-collector inference", (role) => {
    const s = { ...session(role), user: { ...session(role).user, calendarEligible: false, paymentCollectionEnabled: false } };
    const intent = captureCompanyJobInvoiceIntent(s, { id: 12, companyId: 9 }, createCompanyJobInvoiceOptions());
    expect(() => assertCompanyJobInvoiceSession(intent, s)).not.toThrow();
    expect(() => assertCompanyJobInvoiceJob(intent, { id: 12, companyId: 9 })).not.toThrow();
  });
  it.each([null, undefined, { ...session(), portal: "platform" }, { ...session(), token: " " }, session("technician"), session("admin"), { ...session(), company: undefined }, { ...session(), company: { id: 0 } }, { ...session(), user: { id: 0, role: "owner" } }])("rejects missing/invalid cached authority %j", (s) => {
    expect(() => captureCompanyJobInvoiceIntent(s, { id: 12, companyId: 9 }, createCompanyJobInvoiceOptions())).toThrow("signed manager");
  });
  it.each([0, -1, "legacy-12", "ob_12", "12x", 1.5, "", Number.MAX_SAFE_INTEGER + 1, null, undefined])("rejects invalid originating Job id %j", (id) => {
    expect(() => captureCompanyJobInvoiceIntent(session(), { id: id as any, companyId: 9 }, createCompanyJobInvoiceOptions())).toThrow();
  });
  it.each([undefined, 99, 0])("rejects missing/other Company provenance %j", (companyId) => {
    expect(() => captureCompanyJobInvoiceIntent(session(), { id: 12, companyId }, createCompanyJobInvoiceOptions())).toThrow();
  });
  it.each(["company", "user"])("rejects a malformed string signed %s identifier", (field) => {
    const signed: any = session();
    signed[field].id = String(signed[field].id);
    expect(() => captureCompanyJobInvoiceIntent(signed, { id: 12, companyId: field === "company" ? "9" as any : 9 }, createCompanyJobInvoiceOptions())).toThrow();
  });
  it.each([null, { ...session(), portal: "platform" }, { ...session(), token: "rotated" }, { ...session(), company: { id: 99 } }, { ...session(), user: { id: 43, role: "owner" } }, session("dispatcher"), session("technician"), { ...session(), user: undefined }])("denies live changed identity %j", (fresh) => {
    expect(() => assertCompanyJobInvoiceSession(captured(), fresh as any)).toThrow("identity changed");
  });
  it.each([null, undefined, { id: 13, companyId: 9 }, { id: 12, companyId: 99 }, { id: "12", companyId: 9 }])("denies mismatched/noncanonical detail %j", (detail) => {
    expect(() => assertCompanyJobInvoiceJob(captured(), detail as any)).toThrow("originating Company Job");
  });
});

const backendRoot = "/home/ubuntu/hsc-mobile-release-readiness-20261117/backend-source-66141c98/";
const mobileRoot = "/home/ubuntu/home-service-connection-app/";
const deny = () => { throw new Error("DENIED unconfigured I/O/import/provider"); };
// Execute selected actual declarations with empty environment and synthetic
// authentication/SQL/provider seams. This is not live persistence/delivery proof.
function extract(file: string, names: string[], inject: Record<string, any>) {
  const source = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const wanted = new Set(names);
  const declarations = tree.statements.filter((node) => (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && wanted.has(node.name?.getText(tree) ?? ""));
  expect(declarations).toHaveLength(names.length);
  const code = ts.transpileModule(declarations.map((node) => node.getText(tree).replace(/^export\s+/, "")).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const context = vm.createContext({ ...inject, fetch: deny, require: deny, process: { env: Object.freeze({}) } });
  vm.runInContext(code, context, { timeout: 2000, filename: file });
  return context;
}
class DomainError extends Error { constructor(readonly code: string, message: string) { super(message); } }
class MobileAuthError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function harness(role = "owner", payments = true, companyId = 9) {
  const selected: Record<string, any> = {};
  const company = { companyId, userId: 42, role };
  const db = { execute: vi.fn(async (raw: string, params: any[]) => {
    const sql = raw.replace(/\s+/g, " ").trim();
    if (sql.includes("FROM fs_jobs")) return [params[0] === 12 && params[1] === 9 ? [{ id: 12, customer_id: 41, amount: 100, title: "Synthetic Invoice", public_token: "existing-synthetic" }] : []];
    if (sql.includes("FROM fs_customers")) return [params[0] === 41 && params[1] === 9 ? [{ id: 41, first_name: "Synthetic", last_name: "Customer", email: "on-file@example.test" }] : []];
    if (sql.includes("FROM companies")) return [[{ id: 9, name: "Synthetic Company" }]];
    throw new Error("DENIED SQL " + sql);
  }) };
  const recipient = extract(backendRoot + "server/companyCommunicationService.ts", ["resolveOwnedCommunicationRecipient"], { DomainError, toNumber: Number, normalizeEmail: (value: string) => value.trim().toLowerCase(), EMAIL_PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ });
  const manager = (scope: { role: string }) => { if (!["owner", "dispatcher"].includes(scope.role)) throw new DomainError("FORBIDDEN", "Manager required"); };
  const service = extract(backendRoot + "server/paymentService.ts", ["loadOwnedJob", "escapeEmailHtml", "sendJobInvoice", "sendJobInvoiceSms"], {
    DomainError, requireManager: manager, EMAIL_PATTERN: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, toNumber: Number,
    getJobPaymentBalance: async () => ({ jobTotal: 100, paid: 25, balance: 75 }), ensureJobPublicToken: async () => "synthetic-token", publicOrigin: () => "https://synthetic.invalid", publicInvoiceUrl: () => "https://synthetic.invalid/invoice/opaque", emailAdapterFromLegacyMailer: deny,
    reserveCompanyTransactionalEmail: async (_db: any, request: any) => { selected.reservation = request; selected.actualRecipient = await recipient.resolveOwnedCommunicationRecipient(db, request); return { communicationId: 1 }; },
    dispatchReservedCompanyTransactionalEmail: async (_db: any, request: any) => { selected.dispatch = request; return { state: "provider_accepted", communicationId: 1, legacyDeliveryId: 2 }; },
    writeCompanyAuditLog: async (_db: any, audit: any) => { selected.audit = audit; }, redactPublicToken: () => "redacted",
    sendCompanyTransactionalSms: async (_db: any, request: any) => { selected.sms = request; return { state: "provider_accepted", communicationId: 3 }; },
  });
  const route = extract(backendRoot + "server/mobileOperations.ts", ["requireManager", "sendInvoice"], {
    z, managerRoles: new Set(["owner", "dispatcher"]), MobileAuthError, mobileCompany: async () => ({ company, db }),
    requireMobileFeature: () => { if (!payments) throw new MobileAuthError(403, "Payments feature required"); }, readMobileFeatureAccess: async () => ({ payments }), mobileRequestOrigin: () => "https://synthetic.invalid",
    sendJobInvoice: service.sendJobInvoice, sendJobInvoiceSms: service.sendJobInvoiceSms,
    operationalError: (res: any, error: any) => res.status(error.status ?? (error.code === "NOT_FOUND" ? 404 : 400)).json({ error: error.message }),
  });
  const response = { code: 200, payload: null as any, status(code: number) { this.code = code; return this; }, json(payload: any) { this.payload = payload; return this; } };
  return { company, db, selected, service, route, response };
}
function adapter(requestJson: (...args: any[]) => Promise<any>) {
  return extract(mobileRoot + "lib/jobsync-mobile-api.ts", ["asRecord", "firstString", "validCompanyJobId", "createJobSyncBearerHeaders", "JobSyncApiError", "invoiceCommunicationState", "sendJobSyncCompanyJobInvoice"], {
    requestJson, INVOICE_COMMUNICATION_STATES: new Set(["queued", "sending", "provider_accepted", "delivered", "failed", "bounced", "complained", "suppressed", "cancelled"]),
  });
}

describe("Exact 66141 invoice route/services and actual mobile adapter", () => {
  it.each(["email", "sms"] as const)("%s initial/default versus explicit resend uses canonical on-file contact", async (method) => {
    for (const resend of [undefined, false, true]) {
      const h = harness();
      await h.route.sendInvoice({ params: { jobId: "12" }, body: { method, ...(resend === undefined ? {} : { resend }), recipientEmail: "override@example.test", overridePhone: "ignored", amount: 1 } }, h.response);
      expect(h.response.code).toBe(200); expect(h.response.payload.success).toBe(true);
      expect(h.response.payload.communicationState ?? h.response.payload.status).toBe("provider_accepted");
      const request = h.selected.reservation ?? h.selected.sms;
      expect(request.intent.kind).toBe(resend === true ? "resend" : "initial");
      expect(request.customerId).toBe(41); expect(request).not.toHaveProperty("recipientEmail"); expect(request).not.toHaveProperty("overridePhone");
      if (method === "email") { expect(h.selected.actualRecipient.email).toBe("on-file@example.test"); expect(h.selected.dispatch.html).toContain("75.00"); }
    }
  });
  it.each(["owner", "dispatcher"])("permits current %s under authoritative payments feature gate", async (role) => {
    const h = harness(role); await h.route.sendInvoice({ params: { jobId: "12" }, body: { method: "email", resend: true } }, h.response); expect(h.response.code).toBe(200);
  });
  it.each(["technician", "admin", "developer"])("denies %s before service/SQL/provider", async (role) => {
    const h = harness(role); await h.route.sendInvoice({ params: { jobId: "12" }, body: { method: "email", resend: true } }, h.response);
    expect(h.response.code).toBe(403); expect(h.db.execute).not.toHaveBeenCalled(); expect(h.selected.dispatch).toBeUndefined();
  });
  it("denies disabled Company payments feature without SQL/provider", async () => {
    const h = harness("owner", false); await h.route.sendInvoice({ params: { jobId: "12" }, body: { method: "email" } }, h.response);
    expect(h.response.code).toBe(403); expect(h.db.execute).not.toHaveBeenCalled();
  });
  it.each(["true", "false", 1, null])("exact backend rejects nonboolean resend %j before invoice SQL", async (resend) => {
    const h = harness(); await h.route.sendInvoice({ params: { jobId: "12" }, body: { method: "email", resend } }, h.response);
    expect(h.response.code).toBe(400); expect(h.db.execute).not.toHaveBeenCalled();
  });
  it("denies other Company Job before communication reservation/provider", async () => {
    const h = harness("owner", true, 99); await h.route.sendInvoice({ params: { jobId: "12" }, body: { method: "email", resend: true } }, h.response);
    expect(h.response.code).toBe(404); expect(h.selected.reservation).toBeUndefined(); expect(h.selected.dispatch).toBeUndefined();
  });
  it("DEFECT reproduction: requested/acknowledged web override is not the actual resolved recipient", async () => {
    const h = harness(); const acknowledgment = await h.service.sendJobInvoice(h.db, h.company, 12, undefined, "https://synthetic.invalid", { recipientEmail: "override@example.test" });
    expect(acknowledgment.sentTo).toBe("override@example.test"); expect(h.selected.actualRecipient.email).toBe("on-file@example.test");
    expect(h.selected.audit.details.recipientEmail).toBe("override@example.test");
    expect(h.selected.reservation.intent.logicalSendKey).toBe("job-invoice:override@example.test");
    // Passing reproduction is evidence of an OPEN backend acceptance defect.
  });
  it.each(["email", "sms"] as const)("captured %s resend passes exact bearer POST through actual adapter/handler/service", async (method) => {
    const h = harness(); const intent = captured(method, true);
    const transport = vi.fn(async (path: string, init: any) => {
      expect(path).toBe("/api/mobile/v1/jobs/12/invoice"); expect(init.method).toBe("POST");
      expect(init.headers.Authorization).toBe("Bearer synthetic-invoice-token"); expect(JSON.parse(init.body)).toEqual({ method, resend: true });
      await h.route.sendInvoice({ params: { jobId: "12" }, body: JSON.parse(init.body) }, h.response); return h.response.payload;
    });
    const a = adapter(transport); const acknowledgment = await a.sendJobSyncCompanyJobInvoice(intent.token, intent.jobId, intent.options);
    expect(transport).toHaveBeenCalledTimes(1); expect(acknowledgment.channel).toBe(method); expect(acknowledgment.status).toBe("provider_accepted"); expect(acknowledgment.isDelivered).toBe(false);
  });
  it.each(["queued", "sending", "provider_accepted", "failed", "bounced", "complained", "suppressed", "cancelled"])("canonical %s overrides email compatibility sent without claiming delivery", async (communicationState) => {
    const transport = vi.fn().mockResolvedValue({ success: true, publicUrl: "https://synthetic.invalid/invoice/opaque", status: "sent", communicationState });
    const acknowledgment = await adapter(transport).sendJobSyncCompanyJobInvoice("synthetic", 12, { method: "email", resend: true });
    expect(acknowledgment.status).toBe(communicationState); expect(acknowledgment.isDelivered).toBe(false); expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, null, "unverified_future_state", 1])("missing/malformed canonical state %j cannot turn email sent into delivered", async (communicationState) => {
    const acknowledgment = await adapter(vi.fn().mockResolvedValue({ success: true, publicUrl: "synthetic", status: "sent", ...(communicationState === undefined ? {} : { communicationState }) })).sendJobSyncCompanyJobInvoice("synthetic", 12, { method: "email" });
    expect(acknowledgment.status).toBeNull(); expect(acknowledgment.isDelivered).toBe(false);
  });
  it.each(["timeout", "HTTP 403", "ambiguous provider state"])("transport %s performs no blind retry or alternate mutation", async (reason) => {
    const transport = vi.fn().mockRejectedValue(new Error(reason));
    await expect(adapter(transport).sendJobSyncCompanyJobInvoice("synthetic", 12, { method: "sms", resend: true })).rejects.toThrow(reason); expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([{ success: false, publicUrl: "synthetic" }, { success: true }, null])("invalid acknowledgment %j fails once without optimistic success", async (response) => {
    const transport = vi.fn().mockResolvedValue(response);
    await expect(adapter(transport).sendJobSyncCompanyJobInvoice("synthetic", 12, { method: "email", resend: true })).rejects.toThrow("did not confirm"); expect(transport).toHaveBeenCalledTimes(1);
  });
});

// Only the parent owns the screen. Exercise its actual extracted closure with
// the minimal proposed substitutions IN MEMORY, not an alternate production
// controller. This proves a candidate integration, not an installed UI claim.
function parentCandidate(overrides: Record<string, any> = {}) {
  const file = mobileRoot + "app/(tabs)/admin-schedule.tsx";
  const source = readFileSync(file, "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isJsxAttribute(node) && node.name.getText(tree) === "onPress" && node.initializer && ts.isJsxExpression(node.initializer)
      && node.initializer.expression?.getText(tree).includes("sendJobSyncCompanyJobInvoice")) callback = node.initializer.expression;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!callback) throw new Error("Missing actual invoice closure");
  let body = callback.getText(tree);
  const oldRefresh = "const fresh = await getJobSyncMobileSession(token);";
  const oldSend = "sendJobSyncCompanyJobInvoice(token, jobId, { method: invoiceMethod })";
  if (body.includes(oldSend)) {
    expect(body).toContain(oldRefresh);
    body = body.replace(oldRefresh, "const invoiceIntent = captureCompanyJobInvoiceIntent(jobSyncSession, selectedJob, createCompanyJobInvoiceOptions(invoiceMethod, invoiceResend));\nconst fresh = await getJobSyncMobileSession(invoiceIntent.token);")
      .replace("const detail = await getJobSyncCompanyJobDetail(token, jobId, jobSyncSession!.company!.id);", "assertCompanyJobInvoiceSession(invoiceIntent, fresh);\nconst detail = await getJobSyncCompanyJobDetail(invoiceIntent.token, invoiceIntent.jobId, invoiceIntent.companyId);")
      .replace(oldSend, "sendJobSyncCompanyJobInvoice(invoiceIntent.token, invoiceIntent.jobId, invoiceIntent.options)")
      .replace("if (detail.id !== jobId || detail.companyId !== fresh.company?.id)", "assertCompanyJobInvoiceJob(invoiceIntent, detail);\nif (detail.id !== jobId || detail.companyId !== fresh.company?.id)");
  } else {
    expect(body).toContain("captureCompanyJobInvoiceIntent");
    expect(body).toContain("invoiceIntent.options");
  }
  const current = { value: true };
  const context: Record<string, any> = {
    invoiceLockRef: { current: false }, isCurrentInvoice: () => current.value,
    companyJobMode: true, isJobSyncCompany: true, jobSyncLoading: false,
    jobSyncSession: session(), selectedJob: { id: "12", companyId: 9 }, positiveJobSyncId: (value: any) => Number(value),
    invoiceMethod: "sms", invoiceResend: true,
    getJobSyncMobileSession: vi.fn().mockResolvedValue(session()), getJobSyncCompanyJobDetail: vi.fn().mockResolvedValue({ id: 12, companyId: 9 }),
    sendJobSyncCompanyJobInvoice: vi.fn().mockResolvedValue({ communicationState: "provider_accepted", publicUrl: "synthetic" }),
    setInvoiceSending: vi.fn(), setInvoiceSentUrl: vi.fn(), setCompanyInvoiceStatus: vi.fn(), Alert: { alert: vi.fn() },
    fetch: vi.fn(deny), captureCompanyJobInvoiceIntent, createCompanyJobInvoiceOptions,
    assertCompanyJobInvoiceSession, assertCompanyJobInvoiceJob, ...overrides,
  };
  const js = ts.transpileModule(`const extracted = (${body});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const sandbox = vm.createContext(context);
  vm.runInContext(js + "\nthis.send = extracted;", sandbox, { timeout: 2000 });
  return { send: sandbox.send, context, current };
}
function deferred() {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((yes) => { resolve = yes; });
  return { promise, resolve };
}
async function flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); }

describe("Parent resend candidate with preserved actual sheet closure guards", () => {
  it.each(["email", "sms"])("explicit %s resend captures options and synchronously permits one POST", async (method) => {
    const f = parentCandidate({ invoiceMethod: method }); await Promise.all([f.send(), f.send()]);
    expect(f.context.sendJobSyncCompanyJobInvoice).toHaveBeenCalledTimes(1);
    expect(f.context.sendJobSyncCompanyJobInvoice).toHaveBeenCalledWith("synthetic-invoice-token", 12, { method, resend: true });
    expect(f.context.setCompanyInvoiceStatus).toHaveBeenCalledWith("provider_accepted"); expect(f.context.fetch).not.toHaveBeenCalled();
  });
  it("retained pre-submit stale guard performs no signed read or mutation", async () => {
    const f = parentCandidate(); f.current.value = false; await f.send();
    expect(f.context.getJobSyncMobileSession).not.toHaveBeenCalled(); expect(f.context.sendJobSyncCompanyJobInvoice).not.toHaveBeenCalled();
  });
  it("change during signed refresh prevents POST and legacy fallback", async () => {
    const wait = deferred(); const f = parentCandidate({ getJobSyncMobileSession: vi.fn().mockReturnValue(wait.promise) });
    const pending = f.send(); await flush(); f.current.value = false; wait.resolve(session()); await pending;
    expect(f.context.getJobSyncCompanyJobDetail).not.toHaveBeenCalled(); expect(f.context.sendJobSyncCompanyJobInvoice).not.toHaveBeenCalled(); expect(f.context.fetch).not.toHaveBeenCalled();
  });
  it("mutating rendered draft during await cannot change captured method/resend", async () => {
    const wait = deferred(); const f = parentCandidate({ getJobSyncMobileSession: vi.fn().mockReturnValue(wait.promise) });
    const pending = f.send(); await flush(); f.context.invoiceMethod = "email"; f.context.invoiceResend = false;
    wait.resolve(session()); await pending;
    expect(f.context.sendJobSyncCompanyJobInvoice).toHaveBeenCalledWith("synthetic-invoice-token", 12, { method: "sms", resend: true });
  });
  it("closed/reopened stale response cannot populate another invoice sheet", async () => {
    const wait = deferred(); const f = parentCandidate({ sendJobSyncCompanyJobInvoice: vi.fn().mockReturnValue(wait.promise) });
    const pending = f.send(); await flush(); f.current.value = false; wait.resolve({ communicationState: "provider_accepted", publicUrl: "late" }); await pending;
    expect(f.context.setInvoiceSentUrl).not.toHaveBeenCalledWith("late"); expect(f.context.setCompanyInvoiceStatus).not.toHaveBeenCalled();
    expect(f.context.invoiceLockRef.current).toBe(false);
  });
  it.each(["timeout", "HTTP 403", "invalid acknowledgment"])("%s sends once, preserves error, and does not retry/fallback", async (reason) => {
    const f = parentCandidate({ sendJobSyncCompanyJobInvoice: vi.fn().mockRejectedValue(new Error(reason)) }); await f.send();
    expect(f.context.sendJobSyncCompanyJobInvoice).toHaveBeenCalledTimes(1); expect(f.context.fetch).not.toHaveBeenCalled();
    expect(f.context.Alert.alert).toHaveBeenCalledWith("Send Failed", reason); expect(f.context.invoiceLockRef.current).toBe(false);
  });
});
