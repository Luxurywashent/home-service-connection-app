import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authority, dates, fixture, readBackend, response, sourceHashes } from "./recurrence-fixtures/verified-source-fixture";
import { companyJobRecurrenceCalendarDates, normalizeCompanyJobDurableRecurrenceReadback,
  normalizeCompanyJobRecurrenceReceipt, verifyCompanyJobDurableRecurrenceReadback,
  type CompanyJobRecurrenceInput } from "../lib/company-job-recurrence";
import { createCompanyJobController, type CompanyCreateJobTransport } from "../lib/company-create-job";
import { createCompanyCreationStore, type CompanyCreationRecord } from "../lib/company-job-creation-storage";
import { normalizeJobSyncCompanyJobDetail, normalizeCompanyJobQuote, type JobSyncNativeSession, type JobSyncCompanyJobCreateResult } from "../lib/jobsync-mobile-api";
import { companyRecurrenceReleaseReady } from "../lib/company-verified-contract-release";
vi.mock("expo-crypto", () => ({ randomUUID, digestStringAsync: async (_: string, text: string) => createHash("sha256").update(text).digest("hex"), CryptoDigestAlgorithm: { SHA256: "SHA-256" } }));
vi.mock("expo-secure-store", () => ({ WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device-only", getItemAsync: vi.fn(), setItemAsync: vi.fn(), deleteItemAsync: vi.fn() }));
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
const wire = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T;
type Row = Record<string, unknown>;
const rule = (type: CompanyJobRecurrenceInput["type"] = "weekly", term: CompanyJobRecurrenceInput["term"] = "1_month"): CompanyJobRecurrenceInput => ({ type, term, startDate: "2026-11-30", ...(type !== "monthly_date" ? { dayOfWeek: 2 } : {}), ...(type === "monthly_ordinal" ? { ordinal: -1 as const } : {}) });
const base = { customerId: 41, priceBookServiceId: 71, lineItems: [{ priceBookItemId: 71, quantity: 2 }, { priceBookItemId: 72, quantity: 1 }], scheduledStartAt: "2026-12-01T15:00:00.000Z", operationKey: "hsc-offline-recurrence-001", notifyCustomer: false };
beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Production HTTP forbidden"))); });
const exactEvidence: unknown[] = [];
afterAll(() => writeFileSync("/home/ubuntu/hsc-mobile-verified-contracts-20261117/recurrence-raw-fixture-evidence.json", JSON.stringify({ decision: "BLOCKED", fixtureOnly: true,
  sourceHashes: Object.fromEntries(sourceHashes), exactUnmodifiedRuntimeResponses: exactEvidence }, null, 2) + "\n"));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
async function saved(recurrence = rule(), options: Parameters<typeof fixture>[0] = {}, extra: Row = {}) {
  const fake = fixture(options), created = response();
  await fake.routes.createJob({ body: { ...base, recurrence, ...extra } }, created);
  expect(created.statusCode).toBe(201);
  const body = wire<{ job: { id: number; recurrence: unknown }; operation: unknown }>(created.body), jobId = body.job.id;
  const read = response(); await fake.routes.jobRecurrenceSeries({ params: { jobId: String(jobId) } }, read);
  expect(read.statusCode).toBe(200);
  exactEvidence.push(wire({ request: { ...base, recurrence, ...extra }, create: created.body, recurrenceGet: read.body }));
  return { fake, body, jobId, raw: wire<unknown>(read.body) };
}
let userId = 191000;
function actor(): JobSyncNativeSession { return { token: `isolated-${++userId}`, portal: "company", user: { id: userId, role: "owner", name: "Owner", email: null }, company: { id: 9, name: "Company", slug: "offline", logoUrl: null, primaryColor: null, accentColor: null } }; }
function storage() {
  const data = new Map<string, string>();
  const adapter = { getItemAsync: vi.fn(async (key: string) => data.get(key) ?? null), setItemAsync: vi.fn(async (key: string, text: string) => { data.set(key, text); }), deleteItemAsync: vi.fn(async (key: string) => { data.delete(key); }) };
  const store = createCompanyCreationStore({ platform: "ios", secureStore: adapter });
  return { store, adapter, remove: vi.spyOn(store, "remove") };
}
function harness(fake = fixture(), isolated = true) {
  const session = actor(), secure = storage(), onCreated = vi.fn(async () => true);
  const detail = async (_token: string, jobId: number, companyId: number) => {
    const read = normalizeJobSyncCompanyJobDetail({ job: wire(await fake.service.getJobDetail(fake.db, authority(), jobId)) }, jobId, companyId);
    if (!read) throw new Error("Exact archived detail could not normalize"); return read;
  };
  const api: CompanyCreateJobTransport = {
    ...(isolated ? { recurrenceEnvironment: "isolated-fixture" as const } : {}), session: vi.fn(async () => session), settings: vi.fn(async () => ({ id: 9, timezone: "America/Chicago" }) as Awaited<ReturnType<CompanyCreateJobTransport["settings"]>>),
    priceBook: vi.fn(async () => [{ serviceId: "71", basePrice: 100, vehiclePrices: {} }, { serviceId: "72", basePrice: 50, vehiclePrices: {} }] as Awaited<ReturnType<CompanyCreateJobTransport["priceBook"]>>),
    customer: vi.fn(async () => ({ id: 41, companyId: 9 })), jobs: vi.fn(async () => []), detail: vi.fn(detail),
    quote: vi.fn(async (_token, _company, input) => { const res = response(); await fake.routes.quoteJob({ body: input }, res); const quote = normalizeCompanyJobQuote(wire<{ quote: unknown }>(res.body).quote, input); if (!quote) throw new Error("Exact quote unavailable"); return quote; }),
    create: vi.fn(async (_token, companyId, input) => {
      const res = response(); await fake.routes.createJob({ body: wire(input) }, res);
      if (res.statusCode !== 201 && res.statusCode !== 200) throw new Error(JSON.stringify(res.body));
      const body = wire<{ job: Row; operation: JobSyncCompanyJobCreateResult["operation"] }>(res.body), id = body.job.id as number;
      const canonical = await detail("", id, companyId);
      return { ...canonical, companyId, priceBookServiceId: body.job.priceBookServiceId as number | null, operation: body.operation,
        recurrence: normalizeCompanyJobRecurrenceReceipt(body.job.recurrence, input.recurrence!, id) };
    }),
    operation: vi.fn(async (_token, _company, operationKey) => { const res = response(); await fake.routes.jobCreationOperation({ params: { operationKey } }, res); return wire<{ operation: Awaited<ReturnType<NonNullable<CompanyCreateJobTransport["operation"]>>> }>(res.body).operation; }),
    recurrenceReadback: vi.fn(async (_token, _company, jobId) => { const res = response(); await fake.routes.jobRecurrenceSeries({ params: { jobId: String(jobId) } }, res); return wire(res.body); }),
  };
  const input = { session, transport: api, store: secure.store, isCurrent: () => true, verifyAssignment: vi.fn(async () => true), onCreated, onState: vi.fn(), newOperationKey: vi.fn(() => base.operationKey) };
  const controller = createCompanyJobController(input);
  return { fake, session, secure, api, input, controller, onCreated, draft: { customerId: 41, lineItems: wire<typeof base.lineItems>(base.lineItems), date: rule().startDate, startHour: 9, recurrence: rule(), notifyCustomer: false } };
}
describe("exact final-archive source facts, not a deployment certificate", () => {
  it("pins both named archives and proves the mobile REST persistence mismatch", () => {
    expect(createHash("sha256").update(readBackend("server/mobileOperations.ts")).digest("hex")).toBe("ce54e2c21ac268807480a39610f8a7f163a764556e931ae99a021615c39185b7");
    expect(createHash("sha256").update(readBackend("server/jobService.ts")).digest("hex")).toBe("c8ff64ada4e8a4a6674da3944b5732b3395f8af86fdfbb023cae4c696fe9cdb5");
    const earlier = readFileSync("/home/ubuntu/hsc-mobile-verified-contracts-20261117/backend-source-b8fe61b18692b49aba81431e84afd4f2e0afbb48/server/jobService.ts", "utf8");
    expect(earlier.slice(earlier.indexOf("export async function createJobFromPriceBook"), earlier.indexOf("function isMysqlDuplicate"))).toBe(readBackend("server/jobService.ts").slice(readBackend("server/jobService.ts").indexOf("export async function createJobFromPriceBook"), readBackend("server/jobService.ts").indexOf("function isMysqlDuplicate")));
    expect(companyRecurrenceReleaseReady()).toBe(false);
  });
  it.each(["weekly", "biweekly", "monthly_date", "monthly_ordinal"] as const)("normalizes raw %s GET without synthesizing null provenance", async type => {
    const recurrence = rule(type), first = dates.buildStoredRecurrenceRule(recurrence, recurrence.startDate).firstDate;
    const h = await saved(recurrence, { mysqlDates: true }, { scheduledStartAt: `${first}T15:00:00.000Z` });
    const read = normalizeCompanyJobDurableRecurrenceReadback(h.raw, h.jobId);
    expect(read).toEqual(h.raw); expect(Object.isFrozen(read)).toBe(true); expect(read.occurrences.every(Object.isFrozen)).toBe(true);
    expect(read.recurrence).toMatchObject({ operationKey: null, requestedTerm: null, creationTimezone: null, anchorJobId: h.jobId });
    expect(read.recurrence).not.toHaveProperty("startDate"); expect(read.pricing.subtotal).toBe(0); // exact backend camel-case bug, not corrected locally
    expect(h.fake.state().rules[0]).not.toHaveProperty("operation_key");
    expect(h.fake.queries.find(query => query.sql.startsWith("INSERT INTO fs_service_recurrence_rules"))?.sql).not.toContain("operation_key");
    const receipt = normalizeCompanyJobRecurrenceReceipt(h.body.job.recurrence, recurrence, h.jobId);
    expect(receipt.occurrences.every(row => Date.parse(row.scheduledEndAt) - Date.parse(row.scheduledStartAt) === 9_000_000)).toBe(true);
    expect(() => verifyCompanyJobDurableRecurrenceReadback(read, { companyId: 9, customerId: 41, jobId: h.jobId, operationKey: base.operationKey, recurrence, timezone: "America/Chicago", scheduledStartAt: receipt.occurrences[0].scheduledStartAt, pricing: { subtotalAmount: 250, discountAmount: 0, totalAmount: 260 } })).toThrow(/original request remains locked/);
  });
  it.each(["1_month", "3_months", "6_months", "1_year", "never_ends"] as const)("retains actual %s occurrence counts and dates", async term => {
    const recurrence = rule("weekly", term), h = await saved(recurrence), read = normalizeCompanyJobDurableRecurrenceReadback(h.raw, h.jobId);
    const built = dates.buildStoredRecurrenceRule(recurrence, recurrence.startDate);
    expect(read.occurrences).toHaveLength(dates.generateRecurringDates(built.firstDate, built.rule).length);
    if (term === "never_ends") expect(read.occurrences).toHaveLength(13);
    expect(read.verification.consistentSnapshot).toBe(true); expect(h.fake.connection.beginTransaction).toHaveBeenCalled();
  });
  it("original anchors collapse and operation GET omits payload binding", async () => {
    const a = await saved(), b = await saved({ ...rule(), startDate: "2026-12-01" });
    expect(a.fake.state().operations[0].payload_fingerprint).toBe(b.fake.state().operations[0].payload_fingerprint);
    const read = response(); await a.fake.routes.jobCreationOperation({ params: { operationKey: base.operationKey } }, read);
    expect(wire<{ operation: Row }>(read.body).operation).not.toHaveProperty("payloadFingerprint");
    expect(wire<{ operation: Row }>(read.body).operation).toMatchObject({ key: base.operationKey, state: "saved", jobId: a.jobId });
  });
  it("missing occurrence/cancelled/sibling customer stays visible and cannot become success", async () => {
    const h = await saved(); h.fake.state().jobs.splice(1, 1); h.fake.state().jobs[1].customer_id = 42;
    const res = response(); await h.fake.routes.jobRecurrenceSeries({ params: { jobId: String(h.jobId) } }, res);
    const read = normalizeCompanyJobDurableRecurrenceReadback(wire(res.body), h.jobId);
    expect(read.verification.complete).toBe(false); expect(read.verification.missingOccurrenceNumbers).toEqual([1]); expect(read.occurrences[1].customerId).toBe(42);
  });
  it("cross-Company and technician writes are rejected by exact backend authorization", async () => {
    const fake = fixture(); const denied = response(); await fake.routes.createJob({ role: "technician", body: { ...base, recurrence: rule() } }, denied);
    expect(denied.statusCode).toBe(403); expect(fake.state().jobs).toHaveLength(0);
    const h = await saved(), foreign = response(); await h.fake.routes.jobRecurrenceSeries({ companyId: 10, params: { jobId: String(h.jobId) } }, foreign);
    expect(foreign.statusCode).toBe(404);
  });
  it("calendar targets use canonical Company dates even when original and UTC dates differ", async () => {
    const h = await saved(rule(), { timezone: "Australia/Lord_Howe" }, { scheduledStartAt: "2026-11-30T22:00:00.000Z" });
    const receipt = normalizeCompanyJobRecurrenceReceipt(h.body.job.recurrence, rule(), h.jobId);
    const callback = vi.fn((dates: readonly string[]) => dates[0] === "2026-12-01");
    expect(callback(companyJobRecurrenceCalendarDates(receipt))).toBe(true); expect(callback.mock.calls[0][0][0]).not.toBe(rule().startDate);
    expect(receipt.occurrences[0].scheduledStartAt.slice(0, 10)).toBe("2026-11-30");
  });
});
describe("raw durable DTO cannot manufacture omitted authority", () => {
  it("even repaired-looking provenance cannot prove the original request or sibling pricing snapshot", async () => {
    const h = await saved();
    // Negative input hardening ONLY, not an actual backend success fixture.
    const raw = wire<{ recurrence: Row; pricing: Row }>(h.raw);
    Object.assign(raw.recurrence, { operationKey: base.operationKey, requestedTerm: "1_month", creationTimezone: "America/Chicago" });
    raw.pricing.subtotal = 250;
    const read = normalizeCompanyJobDurableRecurrenceReadback(raw, h.jobId);
    expect(() => verifyCompanyJobDurableRecurrenceReadback(read, { companyId: 9, customerId: 41, jobId: h.jobId, operationKey: base.operationKey,
      recurrence: rule(), timezone: "America/Chicago", scheduledStartAt: base.scheduledStartAt, pricing: { subtotalAmount: 250, discountAmount: 0, totalAmount: 260 } })).toThrow(/does not persist or expose the original recurrence startDate/);
  });
  it.each(["startDateEcho", "pricingEcho", "accessor", "sparse", "duplicate", "wrongKey"])("rejects %s raw JSON instead of enriching it", async kind => {
    const h = await saved(), raw = wire<{ recurrence: Row; occurrences: Row[]; pricing: Row }>(h.raw);
    if (kind === "startDateEcho") raw.recurrence.startDate = rule().startDate;
    if (kind === "pricingEcho") raw.pricing.tax = 10;
    if (kind === "accessor") Object.defineProperty(raw.recurrence, "operationKey", { enumerable: true, get: () => { throw new Error("Must not execute getter"); } });
    if (kind === "sparse") delete raw.occurrences[1];
    if (kind === "duplicate") raw.occurrences[1].jobId = raw.occurrences[0].jobId;
    if (kind === "wrongKey") raw.occurrences[0].occurrenceKey = "302:0";
    expect(() => normalizeCompanyJobDurableRecurrenceReadback(raw, h.jobId)).toThrow();
  });
  it("GET snapshot claim is true even without a transaction and trailing omissions can be reported complete", async () => {
    const h = await saved(); h.fake.state().jobs.pop();
    const raw = await h.fake.service.getJobRecurrenceSeries({ execute: h.fake.db.execute }, authority(), h.jobId);
    const read = normalizeCompanyJobDurableRecurrenceReadback(wire(raw), h.jobId);
    expect(read.verification.consistentSnapshot).toBe(true); expect(read.verification.complete).toBe(true);
    expect(read.occurrences).toHaveLength(4); // original server CREATE had 5; provenance count absent
  });
});
describe("existing Company controller isolated creation / GET-only durable recovery", () => {
  it("submits exactly once with original intent, server-duration Auto, duplicate taps locked and no unverified callback", async () => {
    const h = harness();
    const pending = h.controller.submit(h.draft);
    const duplicate = h.controller.submit(h.draft);
    expect(await pending).toBe(false); expect(await duplicate).toBe(false);
    expect(h.api.create).toHaveBeenCalledTimes(1); expect(h.input.newOperationKey).toHaveBeenCalledTimes(1);
    const savedRecord = await h.secure.store.read(9, h.session.user.id);
    expect(savedRecord).toMatchObject({ operationKey: base.operationKey, timezone: "America/Chicago", phase: "saved", jobId: 501, recurrenceRuleId: 301,
      payload: { recurrence: rule(), scheduledStartAt: "2026-12-01T15:00:00.000Z", lineItems: base.lineItems, notifyCustomer: false } });
    expect(savedRecord?.payload).not.toHaveProperty("scheduledEndAt"); expect(h.api.recurrenceReadback).toHaveBeenCalledTimes(2);
    expect(h.onCreated).not.toHaveBeenCalled(); expect(h.secure.remove).not.toHaveBeenCalled();
    expect(h.controller.getState().detailError).toMatch(/original request remains locked/); h.controller.detach();
  });
  it("copies nested intent before delayed auth then restores uncertain POST read-only after restart", async () => {
    const h = harness(); let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
    vi.mocked(h.api.session).mockImplementationOnce(async () => { await hold; return h.session; });
    const real = h.api.create; h.api.create = vi.fn(async (...args: Parameters<CompanyCreateJobTransport["create"]>) => { await real(...args); throw new Error("Response lost after commit"); });
    const submitting = h.controller.submit(h.draft); h.draft.lineItems[0].quantity = 1; h.draft.recurrence.startDate = "2026-12-15"; release();
    expect(await submitting).toBe(false); expect(h.controller.getState().phase).toBe("uncertain");
    expect((await h.secure.store.read(9, h.session.user.id))?.payload.recurrence?.startDate).toBe("2026-11-30"); h.controller.detach();
    const restarted = createCompanyJobController(h.input); expect(await restarted.restore()).toBe(false);
    expect(h.api.operation).toHaveBeenCalledWith(h.session.token, 9, base.operationKey); expect(h.api.create).toHaveBeenCalledTimes(1);
    expect((await h.secure.store.read(9, h.session.user.id))?.jobId).toBe(501); expect(h.secure.remove).not.toHaveBeenCalled(); expect(h.onCreated).not.toHaveBeenCalled(); restarted.detach();
  });
  it.each(["unknown", "pending", "unavailable"])("%s outcome cannot auto-write or use a new key", async kind => {
    const h = harness(); h.api.create = vi.fn(async () => { throw new Error("Uncertain POST"); }); await h.controller.submit(h.draft);
    h.api.operation = vi.fn(async () => { if (kind === "unavailable") throw new Error("Unavailable GET"); return { key: base.operationKey, state: kind === "pending" ? "pending" as const : "unknown" as const, jobId: null, rejectionCode: null, rejectionMessage: null, createdAt: null, updatedAt: null }; });
    expect(await h.controller.reconcile()).toBe(false); expect(await h.controller.submit(h.draft)).toBe(false); expect(h.api.create).toHaveBeenCalledTimes(1); expect(h.input.newOperationKey).toHaveBeenCalledTimes(1); expect(h.onCreated).not.toHaveBeenCalled(); h.controller.detach();
  });
  it.each(["customer", "pricing", "snapshot", "rule", "timezone", "originalStart", "incomplete"])("rejects %s mismatch without callback/removal or repair writes", async kind => {
    const h = harness(); await h.controller.submit(h.draft); const initial = await h.secure.store.read(9, h.session.user.id); expect(initial?.jobId).toBe(501);
    if (kind === "customer") h.fake.state().jobs[1].customer_id = 42;
    if (kind === "pricing") h.fake.state().lineItems.find(row => row.job_id === 502)!.unit_price = 101;
    if (kind === "incomplete") h.fake.state().jobs.splice(1, 1);
    if (kind === "rule") h.fake.state().rules[0].id = 302;
    if (kind === "timezone") h.fake.state().rules[0].creation_timezone = "Pacific/Honolulu";
    if (kind === "originalStart") h.fake.state().rules[0].starts_on = "2026-12-08";
    if (kind === "snapshot") {
      const original = h.api.recurrenceReadback!; let calls = 0;
      h.api.recurrenceReadback = vi.fn(async (...args: Parameters<NonNullable<CompanyCreateJobTransport["recurrenceReadback"]>>) => { const raw = await original(...args); if (++calls === 2) (raw as { verification: { consistentSnapshot: boolean } }).verification.consistentSnapshot = false; return raw; });
    }
    expect(await h.controller.reconcile()).toBe(false); expect(h.onCreated).not.toHaveBeenCalled(); expect(h.secure.remove).not.toHaveBeenCalled(); expect(h.api.create).toHaveBeenCalledTimes(1);
    expect((await h.secure.store.read(9, h.session.user.id))?.operationKey).toBe(base.operationKey); h.controller.detach();
  });
  it("secured original recurrence, timezone and observed rule identity cannot be changed during recovery", async () => {
    const h = harness(); await h.controller.submit(h.draft);
    const stored = (await h.secure.store.read(9, h.session.user.id))!;
    await expect(h.secure.store.update({ ...stored, timezone: "Pacific/Honolulu" })).rejects.toThrow(/Do not submit another Job/);
    await expect(h.secure.store.update({ ...stored, recurrenceRuleId: 302 })).rejects.toThrow(/Do not submit another Job/);
    await expect(h.secure.store.update({ ...stored, payload: { ...stored.payload, recurrence: { ...stored.payload.recurrence!, startDate: "2026-12-01" } } })).rejects.toThrow(/Do not submit another Job/);
    expect((await h.secure.store.read(9, h.session.user.id))?.payload.recurrence).toEqual(rule()); expect(h.secure.remove).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("manual recurring end rejects preflight while legacy one-time remains unchanged", async () => {
    const h = harness(); expect(await h.controller.submit({ ...h.draft, endHour: 10 })).toBe(false); expect(h.api.create).not.toHaveBeenCalled(); expect(h.input.newOperationKey).not.toHaveBeenCalled(); h.controller.detach();
  });
  it("default transport and legacy semantic collaborator cannot enable recurrence or call production", async () => {
    const h = harness(fixture(), false); h.api.series = vi.fn();
    expect(await h.controller.submit(h.draft)).toBe(false); expect(h.api.create).not.toHaveBeenCalled(); expect(h.api.quote).not.toHaveBeenCalled(); expect(h.input.newOperationKey).not.toHaveBeenCalled(); h.controller.detach();
    const defaultController = createCompanyJobController({ ...h.input, session: actor(), transport: undefined });
    expect(await defaultController.submit(h.draft)).toBe(false); expect(fetch).not.toHaveBeenCalled(); defaultController.detach();
  });
  it("restored recurrence under a blocked production gate never calls operation/detail transport", async () => {
    const h = harness(fixture(), false);
    const { operationKey, ...payload } = base;
    const record: CompanyCreationRecord = { version: 1, companyId: 9, userId: h.session.user.id, operationKey, payload: { ...payload, recurrence: rule() }, timezone: "America/Chicago", phase: "uncertain", jobId: null, createdAt: "2026-11-17T12:00:00.000Z", updatedAt: "2026-11-17T12:00:00.000Z" };
    await h.secure.store.reserve(record); expect(await h.controller.restore()).toBe(false); expect(h.api.operation).not.toHaveBeenCalled(); expect(h.api.detail).not.toHaveBeenCalled(); expect(h.api.create).not.toHaveBeenCalled(); h.controller.detach();
  });
});
