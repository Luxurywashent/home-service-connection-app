import React, { act, useLayoutEffect } from "react";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../lib/jobsync-mobile-api";
import { useCompanyInvoiceOperation } from "../hooks/use-company-invoice-operation";
import { createCompanyInvoiceOperationStore } from "../lib/company-job-invoice-operation-storage";
import type { CompanyInvoiceOperationContext } from "../lib/company-job-invoice-operation";
import { captureCompanyJobB29OriginalIntent } from "../lib/company-job-recurrence-b29-intent";
import { verifyCompanyJobB29RecurrenceReadback, type CompanyJobSavedSeries } from "../lib/company-job-recurrence";
import { fixture, authority, response } from "./recurrence-fixtures/b29-source-fixture";
import { invoiceB29Harness } from "./fixtures/company-invoice-b29-source";

const mocks = vi.hoisted(() => ({ positive: false, session: vi.fn(), detail: vi.fn(), appState: "active", listeners: new Set<(state: string) => void>() }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" }, AppState: { get currentState() { return mocks.appState; }, addEventListener: (_event: string, handler: (state: string) => void) => { mocks.listeners.add(handler); return { remove: () => mocks.listeners.delete(handler) }; } } }));
vi.mock("expo-crypto", () => ({ randomUUID: () => randomUUID(), CryptoDigestAlgorithm: { SHA256: "SHA-256" }, digestStringAsync: async (_algorithm: unknown, text: string) => createHash("sha256").update(text).digest("hex") }));
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: "protected", getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
vi.mock("../lib/company-verified-contract-release", async original => {
  const actual = await original<typeof import("../lib/company-verified-contract-release")>();
  return { ...actual, assertCompanyVerifiedContractRelease: (kind: "recurrence" | "invoice") => {
    if (!mocks.positive) return actual.assertCompanyVerifiedContractRelease(kind);
    if (process.env.EXPO_PUBLIC_JOBSYNC_API_BASE_URL !== "https://fixture.invalid") throw new Error("Isolated adapter origin required");
  } };
});
vi.mock("../lib/jobsync-mobile-api", async original => ({ ...await original<typeof import("../lib/jobsync-mobile-api")>(), getJobSyncMobileSession: mocks.session, getJobSyncCompanyJobDetail: mocks.detail }));
const wire = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const manager = { token: "synthetic-b29-parent", portal: "company", company: { id: 9 }, user: { id: 42, role: "owner" } };
const require = createRequire(import.meta.url);
const renderer = (() => { try { return require("react-test-renderer"); } catch { return require("/tmp/hsc-invoice-hook-renderer/node_modules/react-test-renderer"); } })() as { create(node: React.ReactNode): { unmount(): void; update(node: React.ReactNode): void } };
type Input = Parameters<typeof useCompanyInvoiceOperation>[0];
type Value = ReturnType<typeof useCompanyInvoiceOperation>;
const roots = new Set<ReturnType<typeof renderer.create>>();
function Probe({ input, observe }: { input: Input; observe(value: Value): void }) {
  const value = useCompanyInvoiceOperation(input);
  useLayoutEffect(() => observe(value), [value, observe]);
  return null;
}
function invoiceContext(): CompanyInvoiceOperationContext { return { session: manager, job: { id: 12, companyId: 9 }, options: { method: "email", resend: false }, lifetime: { sheetEpoch: 1, focusEpoch: 1 } }; }
function secure() {
  const values = new Map<string, string>();
  const adapter = { getItemAsync: vi.fn(async (key: string) => values.get(key) ?? null), setItemAsync: vi.fn(async (key: string, value: string) => { values.set(key, value); }), deleteItemAsync: vi.fn(async (key: string) => { values.delete(key); }) };
  return { values, adapter, store: createCompanyInvoiceOperationStore({ platform: "ios", secureStore: adapter }) };
}
async function mount(input: Input) {
  let value: Value | undefined;
  const observe = (next: Value) => { value = next; };
  let root!: ReturnType<typeof renderer.create>;
  await act(async () => { root = renderer.create(<Probe input={input} observe={observe} />); });
  roots.add(root);
  return { get value() { if (!value) throw new Error("Missing committed hook result"); return value; },
    async update(change: Partial<Input>) { input = { ...input, ...change }; await act(async () => { root.update(<Probe input={input} observe={observe} />); }); },
    async close() { await act(async () => root.unmount()); roots.delete(root); } };
}
async function sourceSeries() {
  const f = fixture();
  const body = { customerId: 41, priceBookServiceId: 71, lineItems: [{ priceBookItemId: 71, quantity: 2 }, { priceBookItemId: 72, quantity: 1 }], discount: { kind: "percent" as const, value: 10, code: "TEN" }, assignedUserId: 8, scheduledStartAt: "2026-12-01T15:00:00.000Z", operationKey: "b29-parent-series-001", recurrence: { type: "weekly" as const, term: "1_month" as const, dayOfWeek: 2, startDate: "2026-11-30" }, notifyCustomer: false };
  const created = response(); await f.routes.createJob({ body: wire(body) }, created); expect(created.statusCode).toBe(201);
  const jobId = (wire(created.body) as { job: { id: number } }).job.id;
  const read = response(); await f.routes.jobRecurrenceSeries({ params: { jobId: String(jobId) } }, read); expect(read.statusCode).toBe(200);
  const rows = await Promise.all(f.state().jobs.map(async row => {
    const rowId = row.id; if (typeof rowId !== "number") throw new Error("Invalid persisted occurrence ID");
    const detail = api.normalizeJobSyncCompanyJobDetail({ job: wire(await f.service.getJobDetail(f.db, authority(), rowId)) }, rowId, 9);
    if (!detail?.pricing) throw new Error("Missing actual stored detail pricing"); return detail;
  }));
  const original = await captureCompanyJobB29OriginalIntent(9, body.operationKey, body);
  const expected = { companyId: 9, customerId: 41, jobId, operationKey: body.operationKey, recurrence: body.recurrence, timezone: "America/Chicago", scheduledStartAt: body.scheduledStartAt, operationPayloadFingerprint: original.payloadFingerprint, pricing: rows[0].pricing! };
  return { f, body, jobId, raw: wire(read.body), rows, expected, series: verifyCompanyJobB29RecurrenceReadback(wire(read.body), expected) };
}
function installFetch(f: Awaited<ReturnType<typeof sourceSeries>>["f"], change?: (data: unknown) => unknown) {
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const pathname = new URL(String(url)).pathname;
    expect(init?.headers).toHaveProperty("Authorization", `Bearer ${manager.token}`);
    const res = response();
    if (pathname.includes("/operations/")) await f.routes.jobCreationOperation({ params: { operationKey: decodeURIComponent(pathname.split("/").at(-1)!) } }, res);
    else if (pathname.endsWith("/recurrence")) await f.routes.jobRecurrenceSeries({ params: { jobId: pathname.split("/").at(-2)! } }, res);
    else throw new Error("DENIED unconfigured adapter path");
    return new Response(JSON.stringify(change ? change(wire(res.body)) : wire(res.body)), { status: res.statusCode, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetch); return fetch;
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.positive = false; mocks.appState = "active"; mocks.listeners.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("DENIED live HTTP"); }));
  vi.stubEnv("EXPO_PUBLIC_JOBSYNC_API_BASE_URL", "https://fixture.invalid");
  mocks.session.mockResolvedValue(manager);
  mocks.detail.mockResolvedValue({ id: 12, companyId: 9, customerId: 41, customerEmail: "on-file@example.test", status: "completed", price: 100, jobAmount: 100, balance: 100, paidAmount: 0 });
});
afterEach(async () => { for (const root of roots) await act(async () => root.unmount()); roots.clear(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("b29 actual response adapters preserve original proof without deployment", () => {
  it("preserves the actual persisted operation fingerprint and full nonzero series pricing", async () => {
    const h = await sourceSeries(); mocks.positive = true; const fetch = installFetch(h.f);
    const op = await api.getJobSyncCompanyJobCreationOperation(manager.token, 9, h.body.operationKey);
    expect(op.payloadFingerprint).toBe(h.expected.operationPayloadFingerprint);
    const raw = await api.getJobSyncCompanyJobRecurrence(manager.token, 9, h.jobId);
    expect(raw).toMatchObject({ recurrence: { requestedStartDate: "2026-11-30", startsOn: "2026-12-01", operationPayloadFingerprint: op.payloadFingerprint }, pricing: { subtotal: 250, discount: 25, tax: 9, total: 234 }, verification: { complete: true, operationBound: true } });
    expect(verifyCompanyJobB29RecurrenceReadback(raw, h.expected).occurrenceJobIds).toEqual(h.series.occurrenceJobIds);
    expect(fetch.mock.calls.every(call => call[1]?.method === "GET")).toBe(true);
  });
  it("does not invent a fingerprint for actual unknown operation GET", async () => {
    const f = fixture(); installFetch(f);
    const op = await api.getJobSyncCompanyJobCreationOperation(manager.token, 9, "b29-unwritten-operation");
    expect(op.state).toBe("unknown"); expect(op).not.toHaveProperty("payloadFingerprint");
  });
  it.each([null, 3, "short", "A".repeat(64)])("rejects malformed persisted fingerprint %s before adopting an operation", async fingerprint => {
    const h = await sourceSeries(); installFetch(h.f, value => ({ ...(value as object), operation: { ...((value as { operation: object }).operation), payloadFingerprint: fingerprint } }));
    await expect(api.getJobSyncCompanyJobCreationOperation(manager.token, 9, h.body.operationKey)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("rejects a different Company in a full recurring GET", async () => {
    const h = await sourceSeries(); mocks.positive = true; installFetch(h.f, value => ({ ...(value as object), companyId: 10 }));
    await expect(api.getJobSyncCompanyJobRecurrence(manager.token, 9, h.jobId)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("keeps production recurrence and invoice adapters closed with zero HTTP", async () => {
    await expect(api.getJobSyncCompanyJobRecurrence(manager.token, 9, 501)).rejects.toThrow("awaiting verified backend deployment");
    await expect(api.getJobSyncCompanyInvoiceOperation(manager.token, 12, "b29-operation-none")).rejects.toThrow("awaiting verified backend deployment");
    await expect(api.sendJobSyncCompanyInvoiceOperation(manager.token, 12, { method: "email", resend: false, operationKey: "b29-operation-none" })).rejects.toThrow("awaiting verified backend deployment");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves all twelve actual invoice GET fields and validates requested Job", async () => {
    const h = invoiceB29Harness(); await h.send({ method: "email", resend: false, operationKey: "b29-adapter-invoice", recipientEmail: "alternate@example.test" }); mocks.positive = true;
    vi.stubGlobal("fetch", vi.fn(async () => { const r = await h.lookup("b29-adapter-invoice"); return new Response(JSON.stringify(r.payload), { status: r.code }); }));
    const row = await api.getJobSyncCompanyInvoiceOperation(manager.token, 12, "b29-adapter-invoice");
    expect(row).toMatchObject({ companyId: 9, jobId: 12, customerId: 41, intentKind: "initial", recipientEmail: "alternate@example.test", communicationId: h.rows[0].id, providerDispatchState: "provider_accepted" });
    expect(Object.keys(row as object)).toHaveLength(12);
    await expect(api.getJobSyncCompanyInvoiceOperation(manager.token, 13, "b29-adapter-invoice")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

describe("mounted hook captures original evidence before dispatch and uses only journal evidence on restart", () => {
  function controls(h = invoiceB29Harness(), secured = secure(), lose = false) {
    const transport = { send: vi.fn(async (_token: string, _id: number, body: unknown) => {
      const result = await h.send(body); if (result.code !== 200) throw Object.assign(new Error("Synthetic conflict"), { status: result.code });
      if (lose) throw new Error("Synthetic lost POST acknowledgment"); return wire(result.payload) as unknown;
    }), lookup: vi.fn(async (_token: string, id: number, key: string) => { const result = await h.lookup(key, id); if (result.code !== 200) throw new Error("Synthetic unavailable"); return wire(result.payload) as unknown; }) };
    return { h, secured, transport, options: { store: secured.store, isolatedTransport: transport } };
  }
  it("captures original Customer and on-file recipient into protected journal before first POST", async () => {
    const h = controls(); const ctx = invoiceContext(); const ui = await mount({ context: ctx, visible: true, focused: true, isCurrent: () => true, isolatedController: h.options });
    await act(async () => { await ui.value.send(); });
    const record = await h.secured.store.read(9, 42, 12);
    expect(record?.originalEvidence).toEqual({ customerId: 41, recipientEmail: "on-file@example.test", intentKind: "initial" });
    expect(record?.phase).toBe("verified"); expect(h.transport.send).toHaveBeenCalledTimes(1); expect(h.h.provider.send).toHaveBeenCalledTimes(1);
    expect(ui.value.result?.actualRecipient).toBe("on-file@example.test"); expect(ui.value.result?.isDelivered).toBe(false);
  });
  it("recovers a completely lost POST acknowledgment after remount without adopting current Customer/contact", async () => {
    const h = controls(undefined, undefined, true); const ctx = invoiceContext(); const first = await mount({ context: ctx, visible: true, focused: true, isCurrent: () => true, isolatedController: h.options });
    await act(async () => { await first.value.send(); }); expect(h.h.provider.send).toHaveBeenCalledTimes(1); await first.close();
    h.h.job.customer_id = 99; h.h.customer.email = "changed@example.test";
    mocks.detail.mockResolvedValue({ id: 12, companyId: 9, customerId: 99, customerEmail: "changed@example.test", status: "completed", price: 100 });
    const second = await mount({ context: ctx, visible: true, focused: true, isCurrent: () => true, isolatedController: h.options });
    expect(second.value.result?.state).toBe("completed"); expect(second.value.result?.actualRecipient).toBe("on-file@example.test");
    expect(second.value.result?.lookup).toMatchObject({ customerId: 41, intentKind: "initial" });
    expect(h.transport.send).toHaveBeenCalledTimes(1); expect(h.h.provider.send).toHaveBeenCalledTimes(1);
  });
  it("denies new dispatch when canonical original Customer cannot be verified", async () => {
    const h = controls(); mocks.detail.mockResolvedValue({ id: 12, companyId: 9, customerId: null, customerEmail: "on-file@example.test" });
    const ui = await mount({ context: invoiceContext(), visible: true, focused: true, isCurrent: () => true, isolatedController: h.options });
    await act(async () => { await ui.value.send(); });
    expect(h.transport.send).not.toHaveBeenCalled(); expect(ui.value.error).toContain("Customer could not be verified");
    expect(await h.secured.store.read(9, 42, 12)).toBeNull();
  });
  it("fences retained send after close or identity replacement before any dispatch", async () => {
    const h = controls(); const ui = await mount({ context: invoiceContext(), visible: true, focused: true, isCurrent: () => true, isolatedController: h.options });
    const retained = ui.value.send; await ui.update({ visible: false }); await act(async () => { await retained(); });
    expect(h.transport.send).not.toHaveBeenCalled();
  });
  it("preserves default disabled screen operations without session, detail or provider calls", async () => {
    const ui = await mount({ context: invoiceContext(), visible: true, focused: true, isCurrent: () => true });
    await act(async () => { await ui.value.send(); await ui.value.recover(); });
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.detail).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});

function calendarPredicate(path: string): (series: CompanyJobSavedSeries, rows: Awaited<ReturnType<typeof sourceSeries>>["rows"], companyId?: number, timezone?: string) => boolean {
  const text = readFileSync(path, "utf8"), tree = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  const find = (node: ts.Node) => { if (ts.isIfStatement(node) && node.expression.getText(tree).startsWith("expectedSeries &&")) expression = node.expression; ts.forEachChild(node, find); }; find(tree);
  if (!expression) throw new Error("Missing installed complete-series convergence predicate");
  const js = ts.transpileModule(`const predicate = ${expression.getText(tree)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const run = new Function("expectedSeries", "serverJobs", "companyJobs", "companyId", "jobSyncSession", "companyTimezone", `${js}; return !predicate;`) as (...args: unknown[]) => boolean;
  return (series, rows, companyId = 9, timezone = "America/Chicago") => run(series, rows, rows, companyId, { company: { id: companyId } }, timezone);
}
describe.each(["admin-schedule", "schedule"])("unchanged installed %s calendar only accepts complete canonical series", screen => {
  it("accepts the exact persisted series but rejects omitted, cancelled, foreign and altered-time rows", async () => {
    const h = await sourceSeries(), accepts = calendarPredicate(`/home/ubuntu/home-service-connection-app/app/(tabs)/${screen}.tsx`);
    expect(accepts(h.series, h.rows)).toBe(true);
    expect(accepts(h.series, h.rows.slice(0, -1))).toBe(false);
    expect(accepts(h.series, h.rows.map((r, i) => i === 0 ? { ...r, status: "cancelled" } : r))).toBe(false);
    expect(accepts(h.series, h.rows.map((r, i) => i === 0 ? { ...r, customerId: 99 } : r))).toBe(false);
    expect(accepts(h.series, h.rows.map((r, i) => i === 0 ? { ...r, scheduledStartAt: "2026-12-01T18:00:00.000Z" } : r))).toBe(false);
    expect(accepts(h.series, h.rows, 10)).toBe(false); expect(accepts(h.series, h.rows, 9, "America/New_York")).toBe(false);
  });
});
