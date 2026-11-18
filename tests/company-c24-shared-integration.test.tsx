import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../lib/jobsync-mobile-api";
import { normalizeCompanyJobDurableRecurrenceReadback, verifyCompanyJobDurableRecurrenceReadback, type CompanyJobDurableRecurrenceExpected } from "../lib/company-job-recurrence";
import { createCompanyInvoiceOperationController } from "../lib/company-job-invoice-operation-controller";
import { createCompanyInvoiceOperationStore } from "../lib/company-job-invoice-operation-storage";
import { fixture, response, authority, recovery } from "./recurrence-fixtures/c24-source-fixture";
import { invoiceC24Harness } from "./fixtures/company-invoice-c24-source";
import { COMPANY_VERIFIED_CONTRACT_RELEASE } from "../lib/company-verified-contract-release";

const gate = vi.hoisted(() => ({ isolated: false }));
vi.mock("../lib/company-verified-contract-release", async original => {
  const actual = await original<typeof import("../lib/company-verified-contract-release")>();
  return { ...actual, assertCompanyVerifiedContractRelease: (kind: "recurrence" | "invoice") => {
    if (!gate.isolated) return actual.assertCompanyVerifiedContractRelease(kind);
    if (process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL !== "https://fixture.invalid") throw new Error("Isolated transport only");
  } };
});
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-crypto", () => ({ randomUUID, CryptoDigestAlgorithm: { SHA256: "SHA-256" }, digestStringAsync: async (_: string, text: string) => createHash("sha256").update(text).digest("hex") }));
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only", getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
const token = "synthetic-c24-connected-bearer";
const recurrence = { type: "weekly" as const, term: "1_month" as const, startDate: "2026-11-30", dayOfWeek: 2 };
const base = { customerId: 41, priceBookServiceId: 71, lineItems: [{ priceBookItemId: 71, quantity: 2 }, { priceBookItemId: 72, quantity: 1 }], scheduledStartAt: "2026-12-01T15:00:00.000Z", operationKey: "hsc-c24-shared-create-001", notifyCustomer: false };
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const deny = () => { throw new Error("DENIED live network/provider/SQL"); };
beforeEach(() => { gate.isolated = false; vi.stubEnv("EXPO_PUBLIC_JOBSYNC_API_BASE_URL", "https://fixture.invalid"); vi.stubGlobal("fetch", vi.fn(deny)); });
afterEach(() => { gate.isolated = false; vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function bearer(init?: RequestInit) { expect(init?.headers).toMatchObject({ Authorization: `Bearer ${token}` }); }
function recurrenceHttp(fake = fixture()) {
  const rawResponses: unknown[] = [];
  const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url)); expect(u.origin).toBe("https://fixture.invalid"); bearer(init);
    const res = response(), body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (u.pathname === "/api/mobile/v1/company/jobs" && init?.method === "POST") await fake.routes.createJob({ body }, res);
    else if (u.pathname.endsWith("/quote") && init?.method === "POST") await fake.routes.quoteJob({ body }, res);
    else if (/\/company\/jobs\/\d+\/recurrence$/.test(u.pathname) && init?.method === "GET") await fake.routes.jobRecurrenceSeries({ params: { jobId: u.pathname.split("/").at(-2) } }, res);
    else if (u.pathname.includes("/company/jobs/operations/") && init?.method === "GET") await fake.routes.jobCreationOperation({ params: { operationKey: decodeURIComponent(u.pathname.split("/").at(-1)!) } }, res);
    else deny();
    const raw = copy(res.body); rawResponses.push(raw); return new Response(JSON.stringify(raw), { status: res.statusCode });
  });
  vi.stubGlobal("fetch", http); return { fake, http, rawResponses };
}
function invoiceHttp(h = invoiceC24Harness()) {
  const source = readFileSync("/home/ubuntu/hsc-mobile-c24-contract-alignment-20261117/backend-source-c24d4a1e/server/mobileOperations.ts", "utf8");
  // Registration, not just a direct source handler seam, fixes endpoint authority.
  expect(source).toContain('app.post(`${BASE}/jobs/:jobId/invoice`, sendInvoice)');
  expect(source).toContain('app.get(`${BASE}/jobs/:jobId/invoice-operation`, invoiceOperation)');
  expect(source).not.toContain('app.post(`${BASE}/jobs/:jobId/invoice/send`');
  const http = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url)); expect(u.origin).toBe("https://fixture.invalid"); bearer(init);
    let res: { code: number; payload: unknown };
    if (u.pathname === "/api/mobile/v1/jobs/12/invoice" && init?.method === "POST") res = await h.send(JSON.parse(String(init.body)));
    else if (u.pathname === "/api/mobile/v1/jobs/12/invoice-operation" && init?.method === "GET") res = await h.lookup(u.searchParams.get("operationKey")!, 12);
    else deny();
    return new Response(JSON.stringify(res!.payload), { status: res!.code });
  });
  vi.stubGlobal("fetch", http); return { h, http };
}
function invoiceController() {
  const h = invoiceHttp(), data = new Map<string, string>();
  const store = createCompanyInvoiceOperationStore({ platform: "ios", secureStore: { getItemAsync: async key => data.get(key) ?? null, setItemAsync: async (key, text) => { data.set(key, text); }, deleteItemAsync: async key => { data.delete(key); } } });
  const controller = createCompanyInvoiceOperationController({ store, isolatedTransport: { send: api.sendJobSyncCompanyInvoiceOperation, lookup: api.getJobSyncCompanyInvoiceOperation } });
  const context = { session: { token, portal: "company" as const, company: { id: 9 }, user: { id: 42, role: "owner" } }, job: { id: 12, companyId: 9 }, options: { method: "email" as const, resend: false }, lifetime: { sheetEpoch: 1, focusEpoch: 1 }, operationKey: "c24-connected-invoice-001" };
  return { ...h, data, store, controller, context };
}

describe("c24 canonical bearer adapters and persisted financial readback", () => {
  it("does not let source verification open production paths or issue a request", async () => {
    expect(COMPANY_VERIFIED_CONTRACT_RELEASE.recurrenceDeployed).toBe(false);
    expect(COMPANY_VERIFIED_CONTRACT_RELEASE.invoiceOperationsDeployed).toBe(false);
    await expect(api.getJobSyncCompanyJobRecurrence(token, 9, 501)).rejects.toThrow("awaiting verified backend deployment");
    await expect(api.sendJobSyncCompanyInvoiceOperation(token, 12, { method: "email", resend: false, operationKey: "c24-no-live-send" })).rejects.toThrow("awaiting verified backend deployment");
    await expect(api.getJobSyncCompanyInvoiceOperation(token, 12, "c24-no-live-send")).rejects.toThrow("awaiting verified backend deployment");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([undefined, { kind: "flat" as const, value: 25 }, { kind: "percent" as const, value: 10 }])("preserves persisted c24 proof and nonzero pricing with discount %j", async discount => {
    gate.isolated = true; const h = recurrenceHttp();
    const created = await api.createJobSyncCompanyJob(token, 9, { ...base, recurrence, ...(discount ? { discount } : {}) });
    const raw = await api.getJobSyncCompanyJobRecurrence(token, 9, created.id);
    expect(raw).toEqual(h.rawResponses.at(-1));
    const normalized = normalizeCompanyJobDurableRecurrenceReadback(raw, created.id);
    expect(normalizeCompanyJobDurableRecurrenceReadback(normalized, created.id)).toEqual(normalized);
    expect(normalized.pricing).toMatchObject({ subtotal: 250, durationMinutes: 150, taxRateBps: 500 });
    expect(normalized.pricing.lineItems).toHaveLength(2);
    expect(normalized.recurrence).toMatchObject({ requestedStartDate: "2026-11-30", startsOn: "2026-12-01", operationKey: base.operationKey });
    const detail = api.normalizeJobSyncCompanyJobDetail({ job: copy(await h.fake.service.getJobDetail(h.fake.db, authority(), created.id)) }, created.id, 9)!;
    const expected: CompanyJobDurableRecurrenceExpected = { companyId: 9, customerId: 41, jobId: created.id, recurrence, operationKey: base.operationKey, timezone: "America/Chicago", scheduledStartAt: base.scheduledStartAt, pricing: detail.pricing! };
    // Actual mobile expectation has no independent transformed-input hash: held.
    expect(() => verifyCompanyJobDurableRecurrenceReadback(normalized, expected)).toThrow("no independently comparable original fingerprint");
    const fixtureOnlyHash = recovery.jobCreationPayloadFingerprint(recovery.operationPayloadForJobCreation(h.fake.creationInputs[0]));
    const verified = verifyCompanyJobDurableRecurrenceReadback(normalized, { ...expected, operationPayloadFingerprint: fixtureOnlyHash });
    expect(verified.occurrenceJobIds).toEqual(normalized.occurrences.map(row => row.jobId));
    const operation = await api.getJobSyncCompanyJobCreationOperation(token, 9, base.operationKey);
    expect(operation.state).toBe("saved"); expect(operation).not.toHaveProperty("payloadFingerprint");
    expect(h.fake.booking).not.toHaveBeenCalled();
  });
  it("rejects foreign Company recurrence at the canonical adapter boundary", async () => {
    gate.isolated = true; const h = recurrenceHttp();
    const created = await api.createJobSyncCompanyJob(token, 9, { ...base, recurrence });
    await expect(api.getJobSyncCompanyJobRecurrence(token, 10, created.id)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(h.http.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it("preserves exact one-time multi-service creation and explicit notification OFF", async () => {
    const h = recurrenceHttp(); const created = await api.createJobSyncCompanyJob(token, 9, base);
    expect(created.id).toBeGreaterThan(0); expect(created).not.toHaveProperty("recurrence");
    expect(created.pricing?.lineItems).toHaveLength(2); expect(h.fake.state().jobs).toHaveLength(1);
    expect(h.fake.state().rules).toHaveLength(0); expect(h.fake.booking).not.toHaveBeenCalled();
    expect(JSON.parse(String(h.http.mock.calls[0][1]?.body)).notifyCustomer).toBe(false);
  });
});

describe("c24 registered invoice path, typed conflicts and no-repeat recovery", () => {
  it("uses registered POST once and preserves its raw persisted receipt before GET", async () => {
    gate.isolated = true; const h = invoiceHttp();
    const sent = await api.sendJobSyncCompanyInvoiceOperation(token, 12, { method: "email", resend: false, operationKey: "c24-registered-send-001", recipientEmail: "alternate@example.test" });
    expect(sent).toMatchObject({ operationKey: "c24-registered-send-001", status: "sent", channel: "email", sentTo: "alternate@example.test", communicationId: h.h.rows[0].id });
    const lookup = await api.getJobSyncCompanyInvoiceOperation(token, 12, "c24-registered-send-001");
    expect(lookup).toMatchObject({ communicationId: h.h.rows[0].id, recipientEmail: "alternate@example.test", status: "provider_accepted" });
    expect(h.http.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(h.h.provider.send).toHaveBeenCalledTimes(1);
  });
  it("passes a distinct-key 409 through as conflict and never adopts the winner", async () => {
    gate.isolated = true; const h = invoiceController();
    h.h.beforeInsert(async () => { h.h.beforeInsert(null); await h.h.comm.reserveCompanyTransactionalEmail(h.h.db, { company: h.h.company, purpose: "job_invoice", entityType: "job", entityId: 12, customerId: 41, recipientEmail: "foreign@example.test", fallbackSenderName: "Synthetic", subject: "Invoice", html: "<p>Invoice</p>", intent: { kind: "initial", logicalSendKey: "c24-foreign-winner" }, compatibility: { deliveryType: "invoice", jobId: 12 } }); });
    const result = await h.controller.send(h.context, () => true);
    expect(result.state).toBe("conflict"); expect(result.actualRecipient).toBeNull(); expect(result.communicationId).toBeNull(); expect(result.lookup).toBeNull();
    await h.controller.recover(h.context, () => true);
    expect(h.http.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1); expect(h.h.provider.send).not.toHaveBeenCalled();
  });
  it("holds a lost POST acknowledgment despite a matching accepted GET; reopen performs GET only", async () => {
    gate.isolated = true; const h = invoiceController(), original = fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => { const res = await original(url, init); if (init?.method === "POST") throw new TypeError("Synthetic lost acknowledgment"); return res; }));
    const lost = await h.controller.send(h.context, () => true); expect(lost.state).toBe("uncertain"); expect(lost.communicationId).toBeNull();
    const restarted = createCompanyInvoiceOperationController({ store: h.store, isolatedTransport: { send: api.sendJobSyncCompanyInvoiceOperation, lookup: api.getJobSyncCompanyInvoiceOperation } });
    const recovered = await restarted.recover(h.context, () => true); expect(recovered.state).toBe("uncertain"); expect(recovered.actualRecipient).toBeNull();
    await restarted.send(h.context, () => true);
    expect(h.http.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1); expect(h.h.provider.send).toHaveBeenCalledTimes(1);
  });
  it("preserves SMS by refusing the new email-only operation path without a request", async () => {
    gate.isolated = true;
    await expect(api.sendJobSyncCompanyInvoiceOperation(token, 12, { method: "sms", resend: false, operationKey: "c24-sms-rejected" } as unknown as Parameters<typeof api.sendJobSyncCompanyInvoiceOperation>[2])).rejects.toThrow("captured email invoice operation");
    expect(fetch).not.toHaveBeenCalled();
  });
});
